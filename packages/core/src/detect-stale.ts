import { type Holiday, type SessionRule } from './calendar'
import { expectedGrid } from './expected-grid'

/**
 * Detector 4 - `stale_feed`. THE ONLY DETECTOR THAT NEEDS A CLOCK.
 *
 * ---------------------------------------------------------------------------
 * IT STILL READS NO CLOCK. `nowMs` IS A PARAMETER.
 * ---------------------------------------------------------------------------
 *
 * `packages/core` performs no I/O and reads no clock (F.3 invariant 1), and
 * "what time is it" is a clock read however innocent it looks. The worker reads
 * the clock once and passes the instant down, which is also what lets the tests
 * pass a FIXED instant. **A time-dependent test that passes today is the shape
 * that fails at 3am on a Sunday** - and for this detector, whose whole subject
 * is elapsed time and whose calendar has a weekend, that is not hypothetical.
 * Every test below names its instants.
 *
 * ---------------------------------------------------------------------------
 * `occurred_at` IS THE FIRST EXPECTED-AND-ABSENT BAR, NOT THE LAST ONE THAT
 * ARRIVED, AND NOT NOW
 * ---------------------------------------------------------------------------
 *
 * This is what makes the row IDEMPOTENT while the feed stays down. The
 * condition "nothing has arrived since X" is ONE fact, however many times it is
 * detected. Anchoring to the last stored bar would be nearly as stable but
 * means something different - the feed was healthy at that moment and nothing
 * had yet gone wrong. Anchoring to `now` would produce a new event on every
 * poll.
 *
 * **AND THE PAYLOAD MUST CARRY NOTHING THAT MOVES.** The hash covers the
 * payload, so a "minutes stale" or "bars missing" field would change on every
 * check and write a fresh row each time - see the note on
 * `data_quality_events.payload_hash`. Both fields below are fixed by the
 * frontier, not by the clock.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT TELL YOU
 * ---------------------------------------------------------------------------
 *
 * **It cannot distinguish a broken feed from a stopped poller.** Both look
 * identical from the database: bars were expected and none arrived. The
 * detector reports the observable and the caller reports the cause, which is
 * why the runner prints which one it believes and on what grounds.
 */

/** Bars that may be absent before the feed is called stale. */
export const STALE_GRACE_BARS = 2

export interface StaleFeed {
  /** The first instant a bar was expected and did not arrive. Stable. */
  readonly occurredAtMs: number
  /** The last bar actually stored. Stable. */
  readonly lastBarMs: number
  /** How many expected bars are absent. **VARIES WITH `now` - never hashed.** */
  readonly absentBars: number
}

/**
 * Is the feed stale as at `nowMs`?
 *
 * Returns `null` when it is not - which is the answer the positive control
 * depends on. A detector that emitted a row whenever it was called would be
 * indistinguishable from a working one on a stale frontier, so the
 * not-stale case is the half that carries the proof.
 *
 * `unknown` calendar instants do NOT count toward staleness. An uncovered date
 * cannot support the claim that a bar was expected.
 */
export const detectStaleFeed = (
  rules: readonly SessionRule[],
  holidays: readonly Holiday[],
  timeframe: string,
  stepMs: number,
  lastBarMs: number,
  nowMs: number,
): StaleFeed | null => {
  if (nowMs <= lastBarMs) return null

  // Instants strictly after the last stored bar, up to now. `expectedGrid`
  // answers only `open`, so closures and uncovered dates are excluded by
  // construction - a feed is not stale for failing to deliver a weekend.
  const from = lastBarMs + stepMs
  if (from >= nowMs) return null

  const { expected } = expectedGrid(rules, holidays, timeframe, from, nowMs)
  if (expected.length <= STALE_GRACE_BARS) return null

  return {
    // THE EARLIEST INSTANT THE CONDITION HELD. Fixed by the frontier and the
    // calendar, so it does not move while the feed stays down.
    occurredAtMs: expected[0]!,
    lastBarMs,
    absentBars: expected.length,
  }
}
