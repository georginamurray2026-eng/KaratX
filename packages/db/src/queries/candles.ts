import { CandleUpsertOutcome, candleUpsertWrote } from '@karatx/contracts'
import type { Pool, PoolClient } from 'pg'

/**
 * Idempotent candle storage. ADR-013 settles every rule expressed here.
 *
 * The six outcomes are reported, never persisted: `data_quality_events` is
 * T1.5's table and T1.5's detection logic must be pure and live in
 * `packages/core`. This layer says what happened; the caller decides.
 */

/** Nullable columns, in one place. Every predicate below iterates this. */
const NULLABLE = ['volume', 'bid', 'ask'] as const

/**
 * ⚠️ READ BEFORE EDITING ANY PREDICATE BELOW.
 *
 * EACH ONE IS USED TWICE IN A SINGLE STATEMENT: once in the `DO UPDATE ... WHERE`
 * that decides whether to write (as `candles` / `EXCLUDED`), and once in the
 * classification `CASE` that decides what to report (as `p` / `i`). Those two
 * must agree exactly. BOTH DRIFT SHAPES BELOW WERE OBSERVED, not imagined -
 * each was produced by deliberately mutating one copy and running the suite:
 *
 *   Dropping `enrichSome` from the WHERE only (mutation M7) made an identical
 *   final re-delivery WRITE while the CASE still reported `noop`.
 *
 *   Replacing `IS NOT DISTINCT FROM` with `=` (mutation M3) made `enrichOnly`
 *   evaluate to UNKNOWN, so the WHERE SUPPRESSED the write while the CASE
 *   reported `enriched` - a write that never happened, reported as one that did.
 *
 * Both are lies about the one thing this module exists to get right.
 *
 * They are therefore FUNCTIONS OF THEIR TABLE ALIASES: one definition, two call
 * sites. Editing one edits both, which is the entire point. DO NOT inline any of
 * them at either call site, and do not add a fourth predicate without using the
 * same shape.
 *
 * This is mitigation, not elimination. `assertOutcomeMatchesWrite` below is the
 * runtime check that catches drift if it happens anyway.
 */

/** OHLC identity. These columns are NOT NULL, so this is equivalent to `=`; the
 *  null-safe form is kept so every comparison in this file reads the same way. */
const coreSame = (s: string, i: string) =>
  `(${s}.open, ${s}.high, ${s}.low, ${s}.close) ` +
  `IS NOT DISTINCT FROM (${i}.open, ${i}.high, ${i}.low, ${i}.close)`

/** Every nullable column is either unchanged, or filling a NULL. */
const enrichOnly = (s: string, i: string) =>
  NULLABLE.map(
    (c) =>
      `(${s}.${c} IS NOT DISTINCT FROM ${i}.${c}` +
      ` OR (${s}.${c} IS NULL AND ${i}.${c} IS NOT NULL))`,
  ).join(' AND ')

/** At least one nullable column is STRICTLY null -> value. The asymmetry is the
 *  point: value -> null is a provider LOSING data and is a conflict. */
const enrichSome = (s: string, i: string) =>
  NULLABLE.map((c) => `(${s}.${c} IS NULL AND ${i}.${c} IS NOT NULL)`).join(' OR ')

/** Anything at all differs, nulls included. Forming-bar path only. */
const anyDiff = (s: string, i: string) =>
  `(NOT (${coreSame(s, i)})` +
  NULLABLE.map((c) => ` OR ${s}.${c} IS DISTINCT FROM ${i}.${c}`).join('') +
  ` OR ${s}.raw_datetime IS DISTINCT FROM ${i}.raw_datetime)`

const UPSERT_SQL = `
WITH input AS (
  SELECT $1::integer        AS instrument_id,
         $2::integer        AS provider_id,
         $3::text           AS timeframe,
         $4::timestamptz    AS open_time,
         $5::numeric(12,5)  AS open,
         $6::numeric(12,5)  AS high,
         $7::numeric(12,5)  AS low,
         $8::numeric(12,5)  AS close,
         $9::numeric(20,0)  AS volume,
         $10::numeric(12,5) AS bid,
         $11::numeric(12,5) AS ask,
         $12::text          AS raw_datetime,
         $13::boolean       AS is_final
),
-- Reads the PRE-WRITE state. Every sub-statement of a WITH runs under ONE
-- snapshot and cannot see the others' effects on the target table, so this is
-- the row as it stood before \`w\` touched it. THE WHOLE CLASSIFICATION RESTS ON
-- THAT: if it ever read post-write state, an \`applied\` update would compare the
-- row against itself, coreSame would be trivially true, and every write would
-- report \`noop\`. The forming-rewrite test is what fails if this is wrong.
prior AS (
  SELECT c.* FROM candles c, input i
   WHERE c.instrument_id = i.instrument_id
     AND c.provider_id   = i.provider_id
     AND c.timeframe     = i.timeframe
     AND c.open_time     = i.open_time
),
w AS (
  INSERT INTO candles (instrument_id, provider_id, timeframe, open_time,
                       open, high, low, close, volume, bid, ask,
                       raw_datetime, is_final)
  SELECT instrument_id, provider_id, timeframe, open_time,
         open, high, low, close, volume, bid, ask,
         raw_datetime, is_final
    FROM input
  ON CONFLICT ON CONSTRAINT candles_pk DO UPDATE SET
    open   = CASE WHEN candles.is_final THEN candles.open  ELSE EXCLUDED.open  END,
    high   = CASE WHEN candles.is_final THEN candles.high  ELSE EXCLUDED.high  END,
    low    = CASE WHEN candles.is_final THEN candles.low   ELSE EXCLUDED.low   END,
    close  = CASE WHEN candles.is_final THEN candles.close ELSE EXCLUDED.close END,
    volume = CASE WHEN candles.is_final THEN COALESCE(candles.volume, EXCLUDED.volume)
                  ELSE EXCLUDED.volume END,
    bid    = CASE WHEN candles.is_final THEN COALESCE(candles.bid, EXCLUDED.bid)
                  ELSE EXCLUDED.bid END,
    ask    = CASE WHEN candles.is_final THEN COALESCE(candles.ask, EXCLUDED.ask)
                  ELSE EXCLUDED.ask END,
    raw_datetime = CASE WHEN candles.is_final THEN candles.raw_datetime
                        ELSE EXCLUDED.raw_datetime END,
    is_final     = candles.is_final OR EXCLUDED.is_final,
    updated_at   = now()
  WHERE (NOT candles.is_final
         AND (${anyDiff('candles', 'EXCLUDED')} OR EXCLUDED.is_final))
     OR (candles.is_final AND EXCLUDED.is_final
         AND ${coreSame('candles', 'EXCLUDED')}
         AND ${enrichOnly('candles', 'EXCLUDED')}
         AND (${enrichSome('candles', 'EXCLUDED')}))
  -- xmax = 0 distinguishes a fresh INSERT from an ON CONFLICT update. Standard
  -- idiom, and not perfectly airtight: a concurrently-locked fresh row can show
  -- a non-zero xmax. That bound is acceptable because the only consequence is a
  -- spurious retry, which is idempotent and cannot produce a wrong outcome.
  RETURNING (xmax = 0) AS inserted_fresh
)
SELECT
  CASE
    WHEN p.instrument_id IS NULL                             THEN 'inserted'
    -- MUST precede every value comparison. Stored-final + incoming-non-final
    -- with IDENTICAL values would otherwise fall through to 'noop', reporting
    -- an attempt to un-finalise history as healthy duplicate delivery.
    WHEN p.is_final AND NOT i.is_final                       THEN 'rejected'
    WHEN NOT p.is_final AND (${anyDiff('p', 'i')} OR i.is_final) THEN 'applied'
    WHEN NOT p.is_final                                      THEN 'noop'
    WHEN NOT (${coreSame('p', 'i')} AND ${enrichOnly('p', 'i')}) THEN 'conflict'
    WHEN (${enrichSome('p', 'i')})                           THEN 'enriched'
    ELSE 'noop'
  END                                     AS outcome,
  EXISTS (SELECT 1 FROM w)                AS wrote,
  (SELECT bool_or(inserted_fresh) FROM w) AS wrote_fresh
FROM input i LEFT JOIN prior p ON true`

export interface CandleInput {
  readonly instrumentId: number
  readonly providerId: number
  readonly timeframe: string
  readonly openTime: Date | string
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  readonly volume?: string | null
  readonly bid?: string | null
  readonly ask?: string | null
  readonly rawDatetime: string
  readonly isFinal: boolean
}

export interface CandleUpsertResult {
  readonly outcome: CandleUpsertOutcome
  readonly wrote: boolean
}

export class PredicateDriftError extends Error {
  constructor(outcome: string, wrote: boolean) {
    super(
      `PREDICATE DRIFT in the candle upsert: outcome "${outcome}" but wrote=${String(wrote)}.\n\n` +
        `The DO UPDATE ... WHERE and the classification CASE are two uses of the\n` +
        `same predicates. They have disagreed, which means one was edited without\n` +
        `the other - and the reported outcome is now a lie about what the database\n` +
        `did. Do not "handle" this: fix the predicates in packages/db/src/queries/\n` +
        `candles.ts so the two agree again.`,
    )
    this.name = 'PredicateDriftError'
  }
}

export class SingletonViolationError extends Error {
  constructor(detail: string) {
    super(
      `TWO WRITERS ARE WRITING CANDLES. ADR-001's singleton guarantee has FAILED.\n\n` +
        `${detail}\n\n` +
        `The upsert classified this as a fresh insert, then found the row had been\n` +
        `written by someone else between reading and writing. Under ADR-001 the\n` +
        `feed is a SINGLETON and under ADR-011 exactly one local worker runs, so\n` +
        `there should be no second writer to race with.\n\n` +
        `THIS PATH FIRING IS ITSELF THE FINDING - it matters far more than the\n` +
        `retry it triggers. Look for: a second worker process, a stray script, a\n` +
        `duplicated job, or a deployment that overlapped two instances.`,
    )
    this.name = 'SingletonViolationError'
  }
}

/**
 * `outcome` and `wrote` come from two uses of the same predicates. This is the
 * RUNTIME POSITIVE CONTROL for that duplication: if they ever disagree, the
 * predicates have drifted and the outcome is not trustworthy.
 *
 * It throws rather than returning something plausible, because a plausible wrong
 * answer here is exactly the corruption T1.3 exists to prevent - a `conflict`
 * silently reported after an overwrite would be indistinguishable from a healthy
 * refusal.
 */
function assertOutcomeMatchesWrite(outcome: CandleUpsertOutcome, wrote: boolean): void {
  if (candleUpsertWrote(outcome) !== wrote) throw new PredicateDriftError(outcome, wrote)
}

async function runUpsert(
  client: Pool | PoolClient,
  candle: CandleInput,
): Promise<{ outcome: CandleUpsertOutcome; wrote: boolean; wroteFresh: boolean | null }> {
  const { rows } = await client.query<{
    outcome: string
    wrote: boolean
    wrote_fresh: boolean | null
  }>(UPSERT_SQL, [
    candle.instrumentId,
    candle.providerId,
    candle.timeframe,
    candle.openTime,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume ?? null,
    candle.bid ?? null,
    candle.ask ?? null,
    candle.rawDatetime,
    candle.isFinal,
  ])

  const row = rows[0]
  if (row === undefined) {
    throw new Error('candle upsert returned no row - the statement always yields exactly one')
  }
  return {
    outcome: CandleUpsertOutcome.parse(row.outcome),
    wrote: row.wrote,
    wroteFresh: row.wrote_fresh,
  }
}

/**
 * Store one candle, idempotently. Returns what happened; writes no event row.
 *
 * @throws PredicateDriftError if the reported outcome disagrees with whether the
 * database was actually written.
 * @throws SingletonViolationError if a second writer raced this one and the race
 * did not resolve on retry.
 */
export async function upsertCandle(
  client: Pool | PoolClient,
  candle: CandleInput,
): Promise<CandleUpsertResult> {
  let result = await runUpsert(client, candle)

  // THE RACE, AND WHY IT IS NOT MERELY A RETRY.
  //
  // `prior` saw no row, so the statement classified this as `inserted`. If the
  // write did not actually insert a fresh row, another writer inserted between
  // our snapshot and our write - and `inserted` would be a FALSE report.
  //
  // Retrying resolves the report: the second attempt runs under a new snapshot,
  // sees the committed row, and classifies correctly.
  //
  // BUT THE RETRY IS THE SMALLER HALF. ADR-001 makes the feed a SINGLETON and
  // ADR-011 runs exactly one local worker. If this condition fires in
  // production, TWO WRITERS EXIST and that guarantee has already failed. The
  // retry papers over the symptom; the anomaly is the finding. It is raised
  // loudly rather than absorbed.
  if (result.outcome === 'inserted' && (!result.wrote || result.wroteFresh === false)) {
    const first = `first attempt: outcome=inserted wrote=${String(result.wrote)} wroteFresh=${String(result.wroteFresh)}`
    result = await runUpsert(client, candle)

    if (result.outcome === 'inserted' && (!result.wrote || result.wroteFresh === false)) {
      throw new SingletonViolationError(
        `${first}; retry produced the same contradiction for ` +
          `instrument=${String(candle.instrumentId)} provider=${String(candle.providerId)} ` +
          `timeframe=${candle.timeframe} openTime=${String(candle.openTime)}`,
      )
    }
  }

  assertOutcomeMatchesWrite(result.outcome, result.wrote)
  return { outcome: result.outcome, wrote: result.wrote }
}

/**
 * Finalise bar N and store bar N+1 IN ONE TRANSACTION.
 *
 * THE TRANSACTION IS OWNED HERE, NOT BY THE CALLER. `candles_one_forming_idx`
 * permits at most one forming bar per series, so N must be finalised before N+1
 * can be inserted. If that pair were the caller's to wrap, ADR-013's accepted
 * feed-stall consequence would become an accident waiting on caller discipline.
 *
 * A caller that instead calls `upsertCandle` twice gets a 23505 on
 * `candles_one_forming_idx`, rethrown by `describeFormingConflict` with an
 * explanation rather than a bare constraint name.
 */
export async function finaliseAndOpen(
  pool: Pool,
  bars: { readonly finalise: CandleInput; readonly open: CandleInput },
): Promise<{ readonly finalised: CandleUpsertResult; readonly opened: CandleUpsertResult }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const finalised = await upsertCandle(client, { ...bars.finalise, isFinal: true })
    const opened = await upsertCandle(client, { ...bars.open, isFinal: false })
    await client.query('COMMIT')
    return { finalised, opened }
  } catch (error) {
    await client.query('ROLLBACK')
    throw describeFormingConflict(error)
  } finally {
    client.release()
  }
}

/**
 * Turn a bare 23505 on the forming index into an explanation.
 *
 * Postgres says "duplicate key value violates unique constraint
 * candles_one_forming_idx" and nothing about what that means. At 3am the index
 * name is not enough: the constraint is the enforcement, this message is what
 * makes it diagnosable.
 */
export function describeFormingConflict(error: unknown): unknown {
  const e = error as { code?: string; constraint?: string }
  if (e?.code !== '23505' || e.constraint !== 'candles_one_forming_idx') return error

  return new Error(
    `A FORMING BAR ALREADY EXISTS for this instrument/provider/timeframe.\n\n` +
      `candles_one_forming_idx permits at most one non-final bar per series, so\n` +
      `bar N must be FINALISED before bar N+1 can be inserted. Calling\n` +
      `upsertCandle twice does not do that; use finaliseAndOpen, which owns the\n` +
      `transaction that makes the pair atomic.\n\n` +
      `IF THE FEED HAS STALLED, THIS IS WHY. ADR-013 accepts that a bar which\n` +
      `fails to finalise blocks every later bar in its series - deliberately, so\n` +
      `corrupt history is refused rather than written. It is not self-clearing:\n` +
      `find the stuck forming bar and resolve it. T1.7 must ALERT on this rather\n` +
      `than retry silently.`,
    { cause: error },
  )
}

export interface SeriesKey {
  readonly instrumentId: number
  readonly providerId: number
  readonly timeframe: string
}

/**
 * The resume frontier: the newest FINAL bar stored for a series.
 *
 * THIS IS THE BACKFILL'S CHECKPOINT, AND IT IS DELIBERATELY NOT STORED
 * ANYWHERE. A separate checkpoint column or file would open a window between
 * committing a bar and recording that we had committed it - and no ordering
 * closes that window, because a process can die inside it either way. Deriving
 * the frontier from the data makes the write and the checkpoint THE SAME FACT,
 * so they cannot disagree.
 *
 * `job_runs` therefore records observability only. Its counters may be wrong
 * after a crash; this query cannot be.
 *
 * FINAL BARS ONLY. A forming bar is not history and must never become the point
 * a resumed backfill continues from - it would be re-requested as final and the
 * frontier would advance over a bar that was still moving.
 *
 * REQUIRES ASCENDING, CONTIGUOUS FILL to be meaningful. The backfill walks
 * forward from the oldest bar and asserts every page is ascending, so `max` is
 * the frontier rather than merely the largest of a scattered set. A backwards
 * or gap-filling importer would need a different query, and reusing this one
 * would silently skip everything before the gap.
 *
 * Answered by a backwards scan of `candles_pk` - the three-column equality
 * prefix followed by a range on the trailing column, which is exactly the
 * ordering ADR-013 chose the key for.
 */
export async function latestFinalOpenTime(
  client: Pool | PoolClient,
  series: SeriesKey,
): Promise<Date | null> {
  const { rows } = await client.query<{ max: Date | null }>(
    `SELECT max(open_time) AS max
       FROM candles
      WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3 AND is_final`,
    [series.instrumentId, series.providerId, series.timeframe],
  )

  return rows[0]?.max ?? null
}

/**
 * Is this exact bar already stored as FINAL?
 *
 * THE SECOND HALF OF THE FINALITY RULE. A backfill derives finality from the
 * data - "a later bar exists in this response, so this one closed" - which
 * leaves the LAST bar of a page unknown and therefore treated as forming.
 *
 * But that discards something we already know. If a previous run saw a
 * successor to that bar, it settled it, and offering it as forming again would
 * be a DOWNGRADE: the upsert answers `rejected`, writes nothing, and the run
 * stops. That is exactly what happened on the re-verification pass before this
 * query existed, and the `rejected` guard is what found it.
 *
 * So the full rule is: FINAL IF A LATER BAR EXISTS IN THIS RESPONSE, OR IF WE
 * ALREADY SETTLED IT. This answers the second half.
 *
 * One indexed point lookup on `candles_pk` per page - about 36 over a full
 * backfill, which is nothing against 174,000 rows.
 */
export async function isStoredFinal(
  client: Pool | PoolClient,
  series: SeriesKey,
  openTime: Date,
): Promise<boolean> {
  const { rows } = await client.query<{ is_final: boolean }>(
    `SELECT is_final FROM candles
      WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3 AND open_time = $4`,
    [series.instrumentId, series.providerId, series.timeframe, openTime],
  )

  return rows[0]?.is_final ?? false
}

/** The stored price text for one bar, or `null` if it is not stored. */
export interface StoredPrices {
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  readonly volume: string | null
  readonly isFinal: boolean
}

/**
 * Read one bar's stored prices, to classify a revision against.
 *
 * Only reached on a `conflict`, which step 9 measured at roughly 0.2% of bars,
 * so the extra round trip is paid on two bars in a thousand rather than on
 * every one.
 *
 * RETURNS THE TEXT POSTGRES GIVES BACK, WHICH IS PADDED TO SCALE. `4375.5959`
 * stored in `NUMERIC(12,5)` returns as `4375.59590`. The caller must compare by
 * VALUE - `classifyRevision` does - because a byte comparison against provider
 * text would report every bar as changed.
 */
export async function storedPrices(
  client: Pool | PoolClient,
  series: SeriesKey,
  openTime: Date,
): Promise<StoredPrices | null> {
  const { rows } = await client.query<{
    open: string
    high: string
    low: string
    close: string
    volume: string | null
    is_final: boolean
  }>(
    `SELECT open, high, low, close, volume, is_final FROM candles
      WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3 AND open_time = $4`,
    [series.instrumentId, series.providerId, series.timeframe, openTime],
  )

  const row = rows[0]
  if (row === undefined) return null
  return {
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    isFinal: row.is_final,
  }
}
