import { type CandleUpsertOutcome, CANDLE_UPSERT_OUTCOMES } from '@karatx/contracts'
import type { Secret } from '@karatx/config'
import { ConfigError, ProviderError } from '@karatx/core'
import {
  finaliseAndOpen,
  isStoredFinal,
  latestFinalOpenTime,
  upsertCandle,
  type CandleInput,
  type SeriesKey,
} from '@karatx/db'
import type { Pacer, ProviderBar, TwelveDataClient } from '@karatx/providers'
import type { Pool } from 'pg'

/**
 * Historical backfill. Resumable, idempotent, and bounded.
 *
 * THE RESUME POINT IS READ FROM THE DATABASE, NEVER STORED. `latestFinalOpenTime`
 * is the frontier, so the write and the checkpoint are the same fact - there is
 * no window in which a crash leaves them disagreeing. Everything else here
 * follows from that: `job_runs` carries observability only, and its counters may
 * be wrong after a crash while the data cannot be.
 *
 * PACING FIRST, RETRY SECOND. The pacer keeps the run under the provider's
 * documented limit so a 429 is unusual; `withRetry` handles the ones that
 * happen anyway. Both are injected, so this file has no clock of its own.
 */

export type OutcomeCounts = Record<CandleUpsertOutcome, number>

export function emptyCounts(): OutcomeCounts {
  return Object.fromEntries(CANDLE_UPSERT_OUTCOMES.map((o) => [o, 0])) as OutcomeCounts
}

export interface BackfillSeries extends SeriesKey {
  /** The provider's own symbol, from `provider_instruments`. */
  readonly providerSymbol: string
  /** The provider's interval string, e.g. `15min`. */
  readonly providerInterval: string
}

export interface BackfillOptions {
  readonly pool: Pool
  readonly client: TwelveDataClient
  readonly pacer: Pacer
  readonly series: BackfillSeries
  /** Where to start when the series is empty. Inclusive. */
  readonly from: Date
  /**
   * Where a run begins when the series ALREADY HOLDS BARS.
   *
   * `frontier` (default) resumes from `max(open_time)` - the ordinary case, and
   * what makes a re-run cheap: one request that returns the overlap bar, sees
   * nothing new, and stops.
   *
   * `from` re-offers the WHOLE range instead. It is a deliberate
   * re-verification pass: every stored bar is compared against the provider
   * again, so it costs a full backfill's requests and is the only mode that can
   * detect restated history in bars already passed.
   *
   * THE LIMITATION THIS OPTION EXISTS TO MAKE VISIBLE: an ordinary resumed run
   * CANNOT SEE a conflict in a bar behind its frontier, because it never asks
   * for that bar again. Backfill conflict detection therefore covers the
   * overlap bar and anything newly fetched - not history. Catching a provider
   * restating old bars is T1.9's reconciliation job, which is exactly what
   * ADR-008's first reversal condition names. Stated here because "the backfill
   * would notice" is an easy and wrong assumption to carry into Phase 9.
   */
  readonly resumeFrom?: 'frontier' | 'from'
  /** Stop once bars reach here. Inclusive. Defaults to no upper bound. */
  readonly to?: Date
  /** Bars per request. The measured maximum at 15min is 5,000. */
  readonly pageSize?: number
  /** Wraps each request. Injected so tests need no real timers. */
  readonly withRetry: <T>(fn: () => Promise<T>, describe: string) => Promise<T>
  readonly onPage?: (info: {
    readonly page: number
    readonly bars: number
    readonly through: Date | null
  }) => void
  /**
   * Hard ceiling on pages, so a provider that keeps returning bars cannot spin
   * forever. §23 applies to loops that are not retry loops too.
   */
  readonly maxPages?: number
}

export interface BackfillResult {
  readonly counts: OutcomeCounts
  readonly requestsMade: number
  readonly barsSeen: number
  /** The frontier after the run. */
  readonly through: Date | null
  readonly stoppedBecause: 'complete' | 'conflict' | 'maxPages'
}

/**
 * A conflict during backfill stops the run. THRESHOLD ONE, not fifty.
 *
 * A `conflict` means a FINALISED bar was re-delivered with different values.
 * On a first backfill of an empty table it is unreachable - every bar is
 * `inserted`. On a re-run it means the provider restated history, which is
 * ADR-008's first reversal condition and precisely what T1.9's reconciliation
 * exists to detect. That is not a thing to tolerate 49 more of.
 *
 * A threshold above one is for a system that expects routine conflicts. This
 * one expects zero, and if that turns out to be wrong the number can be raised
 * ON EVIDENCE rather than lowered from a guess.
 */
export const CONFLICT_THRESHOLD = 1

export class BackfillConflictError extends ProviderError {
  override readonly name: string = 'BackfillConflictError'
}

/**
 * Require the API key AT START, by name.
 *
 * The alternative - discovering it on the first request - turns a
 * configuration mistake into a five-minute run that dies at request one, having
 * already opened a `job_runs` row and written a capture directory. Same failure,
 * moved later and made harder to read.
 */
export function requireTwelveDataApiKey(key: Secret<string> | undefined): Secret<string> {
  if (key === undefined) {
    throw new ConfigError(
      'TWELVEDATA_API_KEY is not set, and the backfill cannot run without it.\n\n' +
        'It is OPTIONAL in packages/config on purpose: CI has no key and every test\n' +
        'replays recorded fixtures, so requiring it globally would fail every CI boot\n' +
        'to protect this one job. The job checks instead, here, before doing anything.\n\n' +
        'Set it in .env - see .env.example. It is sent as an Authorization header,\n' +
        'never as a query parameter (ADR-008).',
    )
  }
  return key
}

/** Format an instant the way Twelve Data expects, in UTC. */
export function toProviderDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * WHICH BAR IS FORMING, decided from the DATA and not from a clock.
 *
 * OQ-12 measured that `/time_series` returns the currently-forming bar, and the
 * provider sends NO finality flag - ADR-005 mapped OANDA's `complete` onto
 * `is_final`, ADR-008 replaced the provider, and nothing replaced the flag. So
 * finality has to be derived, and there are two ways to derive it:
 *
 *   BY CLOCK - "this bar's close time has passed". REJECTED. It needs a
 *   publication lag we have measured exactly once (>45 s, uncharacterised), and
 *   it is wrong in both directions: too tight and closed bars are stored as
 *   forming for ever, too loose and partial bars are stored as settled anyway.
 *   That is a guess wearing the shape of a bound.
 *
 *   BY THE DATA - "a LATER bar exists in the same response, so this one closed".
 *   Chosen. It consults nothing but what the provider sent, and it cannot be
 *   wrong: a bar cannot have a successor while it is still forming.
 *
 * THE LAST BAR OF A PAGE IS THEREFORE OF UNKNOWN FINALITY, and it is treated as
 * FORMING - conservatively, in the direction that cannot corrupt history. Mid
 * backfill that costs one extra `applied` rewrite per page (about 36 over a full
 * run) when the next page proves it closed. Reaching the present, it is exactly
 * right.
 *
 * NOTE WHAT THIS DOES NOT DO: it does not distinguish "the page ended because
 * the provider ran out of bars" from "the page ended because outputsize was
 * reached". That distinction WOULD be cheaper, and it rests on OQ-6 - whether a
 * page always fills when it can - which is still UNMEASURED. The same reason
 * termination does not rely on it.
 */
function toCandleInput(series: BackfillSeries, bar: ProviderBar, isFinal: boolean): CandleInput {
  return {
    instrumentId: series.instrumentId,
    providerId: series.providerId,
    timeframe: series.timeframe,
    openTime: bar.openTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    bid: null,
    ask: null,
    rawDatetime: bar.rawDatetime,
    isFinal,
  }
}

export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const { pool, client, pacer, series } = options
  const pageSize = options.pageSize ?? 5000
  const maxPages = options.maxPages ?? 10_000

  const counts = emptyCounts()
  let requestsMade = 0
  let barsSeen = 0
  let page = 0

  // THE RESUME POINT. Read once at the start, then advanced from the bars we
  // actually store rather than re-queried - re-querying would return our own
  // writes and could not detect a page that stored nothing.
  const storedFrontier = await latestFinalOpenTime(pool, series)

  // A re-verification pass starts at `from` and re-offers everything. The
  // frontier still advances normally from there; only the starting point moves.
  let frontier = options.resumeFrom === 'from' ? null : storedFrontier

  for (;;) {
    if (page >= maxPages) {
      return { counts, requestsMade, barsSeen, through: frontier, stoppedBecause: 'maxPages' }
    }

    // Resume from the frontier itself, not from the bar after it. The overlap
    // costs one bar and exercises the idempotent upsert in production, where it
    // matters - a resumed run whose first bar is a `noop` has just proved the
    // idempotency claim on real data.
    const start = frontier ?? options.from

    await pacer.acquire()
    page += 1
    requestsMade += 1

    const parsed = await options.withRetry(
      () =>
        client.timeSeries({
          symbol: series.providerSymbol,
          interval: series.providerInterval,
          startDate: toProviderDatetime(start),
          ...(options.to === undefined ? {} : { endDate: toProviderDatetime(options.to) }),
          outputsize: pageSize,
          order: 'ASC',
        }),
      `${series.providerSymbol} ${series.providerInterval} page ${String(page)} from ${toProviderDatetime(start)}`,
    )

    // An empty page means the provider has nothing further. Ordering is already
    // asserted inside the client, so this is genuinely the end rather than a
    // gap we might have skipped past.
    //
    // A COMPLETED RUN COSTS ONE EXTRA REQUEST, deliberately. Because each page
    // resumes AT the frontier rather than after it, the last page returns just
    // the overlap bar, advances nothing, and ends the run below. The obvious
    // saving - stop when a page returns fewer bars than requested - assumes the
    // provider always fills a page when it can, which is UNMEASURED (OQ-6). One
    // request in ~36 is not worth resting termination on an assumption.
    if (parsed.bars.length === 0) {
      return { counts, requestsMade, barsSeen, through: frontier, stoppedBecause: 'complete' }
    }

    let advanced = false

    const usable =
      options.to === undefined
        ? parsed.bars
        : parsed.bars.filter((b) => b.openTime.getTime() <= (options.to as Date).getTime())

    /** Records one stored bar: counts, frontier, and the two hard stops. */
    const record = (outcome: CandleUpsertOutcome, bar: ProviderBar, storedFinal: boolean): void => {
      counts[outcome] += 1
      barsSeen += 1

      // THE FRONTIER ONLY ADVANCES ON A BAR STORED AS FINAL, and it must:
      // `latestFinalOpenTime` filters on `is_final`, so an in-run frontier that
      // counted the forming bar would disagree with the frontier a RESUMED run
      // computes - and the two must be the same fact.
      //
      // THE FRONTIER ADVANCES ON A CONFLICT TOO, AND THAT IS NOT A BUG. It
      // reads like one: a resumed run moving past a bar whose stored values
      // disagree with the provider looks exactly like silent data loss. It is
      // not. `conflict` means the row EXISTS - the stored version was kept and
      // the incoming one discarded, because finalised history is never
      // overwritten (§7, ADR-013). So the bar IS present at that open_time and
      // the frontier is truthful. What must NOT happen is the run continuing as
      // though nothing occurred, and it does not: CONFLICT_THRESHOLD is 1.
      if (storedFinal && (frontier === null || bar.openTime.getTime() > frontier.getTime())) {
        frontier = bar.openTime
        advanced = true
      }

      // `rejected` is a FINAL bar re-delivered as forming. The provider cannot
      // cause it - only this file can, by downgrading a bar it previously
      // settled. It is a defect in the finality logic above, so it stops the
      // run rather than being counted and carried.
      if (outcome === 'rejected') {
        throw new BackfillConflictError(
          `A STORED FINAL BAR WAS OFFERED AS FORMING at ${bar.rawDatetime} ` +
            `(${series.providerSymbol} ${series.providerInterval}).\n\n` +
            `Nothing was written and the stored bar was not un-finalised. THIS IS OUR ` +
            `BUG, NOT THE PROVIDER'S: only this job decides which bar is forming, and ` +
            `the rule is "every bar except the last of a page is closed". Reaching here ` +
            `means that rule downgraded a bar already settled. Do not relax the rule to ` +
            `make this go away - find why the page ended where it did.`,
          { context: { rawDatetime: bar.rawDatetime, openTime: bar.openTime.toISOString() } },
        )
      }

      if (counts.conflict >= CONFLICT_THRESHOLD) {
        throw new BackfillConflictError(
          `FINALISED HISTORY CHANGED. The provider re-delivered a stored final bar with ` +
            `different values, at ${bar.rawDatetime} (${series.providerSymbol} ` +
            `${series.providerInterval}).\n\n` +
            `Nothing was overwritten - the stored bar is untouched and the incoming one ` +
            `was discarded (§7: never silently repair). The run stops at the FIRST ` +
            `conflict deliberately: on a first backfill this is unreachable, so on a ` +
            `re-run it means Twelve Data restated history. That is ADR-008's first ` +
            `reversal condition and what T1.9 exists to detect - not a bar to skip.\n\n` +
            `The raw payload is in this run's capture directory. Compare it against the ` +
            `stored row before deciding anything.`,
          {
            context: {
              rawDatetime: bar.rawDatetime,
              openTime: bar.openTime.toISOString(),
              instrumentId: series.instrumentId,
              providerId: series.providerId,
              timeframe: series.timeframe,
            },
          },
        )
      }
    }

    // THE PAGE TAIL USES finaliseAndOpen, WHICH IS THE PAIR ADR-013 BUILT IT FOR.
    //
    // `candles_one_forming_idx` permits one forming bar per series, so closing
    // one bar and opening the next is a pair that must not half-happen. In a
    // backfill that pair is the last two bars of every page: the second-to-last
    // is provably closed (a later bar exists), the last becomes the new forming
    // bar. On an INCREMENTAL run it is exactly the live-feed shape - the
    // previously-forming bar is the second-to-last and gets finalised while its
    // successor opens, atomically.
    //
    // AT THE BOUNDARY BETWEEN TWO PAGES the previously-forming bar is NOT in the
    // tail: it sits early in the next page, because the resume point is the last
    // CLOSED bar and the forming bar is the very next one after it. It is
    // finalised by the ordinary head loop below, which empties the forming slot
    // before the tail fills it again. That ordering is guaranteed by ascending
    // iteration, not by discipline.
    //
    // AND IF THE PROCESS DIES BETWEEN HEAD AND TAIL there is simply no forming
    // bar: the frontier is the last closed bar, the next run resumes there, and
    // nothing is stuck. Unlike the live feed, a backfill has no state that a
    // missing forming bar can strand - which is why the head does not need the
    // transaction and the tail does.
    // THE SECOND HALF OF THE FINALITY RULE. "A later bar exists in this
    // response" leaves the last bar of a page unknown, and treating it as
    // forming discards something we may already know: if an earlier run saw a
    // successor to that bar, it settled it. Offering it as forming again is a
    // DOWNGRADE - the upsert answers `rejected`, writes nothing, and the run
    // stops. That is precisely what the re-verification pass did before this
    // check existed, and the `rejected` guard above is what found it.
    //
    // So: FINAL IF A LATER BAR EXISTS IN THIS RESPONSE, **OR** IF WE ALREADY
    // SETTLED IT.
    const lastBar = usable.at(-1)
    const lastAlreadySettled =
      lastBar === undefined ? false : await isStoredFinal(pool, series, lastBar.openTime)

    const useFormingTail = usable.length >= 2 && !lastAlreadySettled
    const head = useFormingTail ? usable.slice(0, -2) : usable
    const tail = useFormingTail ? usable.slice(-2) : []

    for (const b of head) {
      const { outcome } = await upsertCandle(pool, toCandleInput(series, b, true))
      record(outcome, b, true)
    }

    if (tail.length === 2) {
      const [penultimate, last] = tail as [ProviderBar, ProviderBar]
      const result = await finaliseAndOpen(pool, {
        finalise: toCandleInput(series, penultimate, true),
        open: toCandleInput(series, last, false),
      })
      record(result.finalised.outcome, penultimate, true)
      record(result.opened.outcome, last, false)
    }

    options.onPage?.({ page, bars: parsed.bars.length, through: frontier })

    // A page that moved nothing forward means the provider is returning the
    // same window again. Continuing would loop until maxPages.
    if (!advanced) {
      return { counts, requestsMade, barsSeen, through: frontier, stoppedBecause: 'complete' }
    }

    if (
      options.to !== undefined &&
      frontier !== null &&
      frontier.getTime() >= options.to.getTime()
    ) {
      return { counts, requestsMade, barsSeen, through: frontier, stoppedBecause: 'complete' }
    }
  }
}
