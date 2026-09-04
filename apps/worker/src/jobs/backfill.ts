import { type CandleUpsertOutcome, CANDLE_UPSERT_OUTCOMES } from '@karatx/contracts'
import type { Secret } from '@karatx/config'
import { ConfigError, ProviderError } from '@karatx/core'
import { latestFinalOpenTime, upsertCandle, type CandleInput, type SeriesKey } from '@karatx/db'
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

function toCandleInput(series: BackfillSeries, bar: ProviderBar): CandleInput {
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
    // ALWAYS FINAL. A historical backfill imports closed bars only; the forming
    // bar belongs to T1.7's live feed. This is why `applied` and `rejected`
    // must never appear in a backfill's counts - if they do, this line is wrong.
    isFinal: true,
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

    for (const bar of parsed.bars) {
      if (options.to !== undefined && bar.openTime.getTime() > options.to.getTime()) break

      const { outcome } = await upsertCandle(pool, toCandleInput(series, bar))
      counts[outcome] += 1
      barsSeen += 1

      // THE FRONTIER ADVANCES ON A CONFLICT TOO, AND THAT IS NOT A BUG.
      //
      // It reads like one: a resumed run moving past a bar whose stored values
      // disagree with the provider looks exactly like silent data loss. It is
      // not. `conflict` means the row EXISTS - the stored version was kept and
      // the incoming one discarded, because finalised history is never
      // overwritten (§7, ADR-013). So the bar IS present at that open_time and
      // the frontier is truthful.
      //
      // What must NOT happen is the run continuing as though nothing occurred,
      // and it does not: CONFLICT_THRESHOLD is 1, so the loop stops immediately
      // below. The frontier is advanced so that a later resumed run does not
      // re-fetch a page it has already fully processed, and the conflict itself
      // is reported rather than absorbed.
      if (frontier === null || bar.openTime.getTime() > frontier.getTime()) {
        frontier = bar.openTime
        advanced = true
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
