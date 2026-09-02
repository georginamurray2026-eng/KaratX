import { z } from 'zod'

/**
 * What happened when a candle was offered to the database.
 *
 * DEFINED HERE ONCE, AND CONSUMED - NEVER REDEFINED. T1.5 builds the
 * data-quality event model and will import this type to decide what to record.
 * If T1.5 declares its own copy, the two are free to diverge silently, which is
 * exactly the drift F.1 exists to prevent: two implementations of one concept,
 * both compiling, disagreeing only at runtime. ADR-013 records this as a
 * condition of the design, not a preference.
 *
 * WHY THE OUTCOME IS A VALUE AND NOT AN EVENT ROW. `data_quality_events` is
 * T1.5's table, and T1.5 requires its detection logic to be PURE and to live in
 * `packages/core`. If T1.3 wrote event rows it would have to define that table
 * first, so the schema would be designed twice by two tasks with different
 * information - and the second design would inherit the first's guesses. T1.3
 * therefore reports what happened and persists nothing; the caller decides.
 *
 * BUILD-PLAN's T1.3 criterion originally read "raises a data-quality event".
 * That criterion is AMENDED rather than reinterpreted - see ADR-013.
 */
export const CANDLE_UPSERT_OUTCOMES = [
  /** No row existed for this key. The candle was stored. */
  'inserted',

  /**
   * The stored bar was still forming, so it was rewritten - possibly finalised
   * in the same step. NOT a conflict: the forming bar legitimately changes on
   * every poll, and treating that as a conflict would raise a false event on
   * every single tick of the current bar.
   */
  'applied',

  /**
   * A final bar was re-delivered unchanged. Nothing was written - not even
   * `updated_at`, which is what keeps that column meaning "when this row last
   * changed" rather than "when we last saw it".
   */
  'noop',

  /**
   * A final bar gained a value where it previously held NULL, on `volume`,
   * `bid` or `ask`, with every other column identical.
   *
   * STRICTLY null -> value. The reverse, value -> null, is a provider LOSING
   * data and is a `conflict`, not enrichment. Without that asymmetry stated the
   * case becomes a hole through which real data loss passes as an upgrade.
   *
   * This arises only from a tier change within one provider that begins
   * supplying bid/ask, because `provider_id` is part of the primary key - a
   * different provider creates different rows, never a conflict.
   */
  'enriched',

  /**
   * A final bar was re-delivered with a DIFFERENT value. Nothing was written
   * and the stored row is untouched: finalised history is not overwritten.
   */
  'conflict',

  /**
   * A final bar was re-delivered as still forming. Nothing was written and the
   * row was not un-finalised. Distinct from `conflict` because the values may
   * be identical - what is wrong is the direction of travel.
   */
  'rejected',
] as const

export const CandleUpsertOutcome = z.enum(CANDLE_UPSERT_OUTCOMES)
export type CandleUpsertOutcome = z.infer<typeof CandleUpsertOutcome>

/** Outcomes where the database was modified. */
export const CANDLE_UPSERT_WROTE = ['inserted', 'applied', 'enriched'] as const

/**
 * Outcomes that mean a candle was REFUSED and something is wrong with the feed.
 *
 * `noop` is deliberately absent: it is the healthy result of ordinary duplicate
 * delivery, and folding it in here would make every re-delivery look like a
 * problem.
 */
export const CANDLE_UPSERT_REFUSED = ['conflict', 'rejected'] as const

export function candleUpsertWrote(outcome: CandleUpsertOutcome): boolean {
  return (CANDLE_UPSERT_WROTE as readonly string[]).includes(outcome)
}

export function candleUpsertRefused(outcome: CandleUpsertOutcome): boolean {
  return (CANDLE_UPSERT_REFUSED as readonly string[]).includes(outcome)
}
