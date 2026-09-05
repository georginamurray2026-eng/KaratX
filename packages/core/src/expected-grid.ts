import { expectsBarAt, type BarExpectation, type Holiday, type SessionRule } from './calendar'

/**
 * The instants at which a bar SHOULD exist - the input to `missing_bar`.
 *
 * ---------------------------------------------------------------------------
 * THIS GENERATOR NEVER CONVERTS LOCAL -> INSTANT, AND THAT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 *
 * The obvious implementation walks local wall-clock time: take the rule's
 * 18:00, work out which instant that is, step forward in local time. **That
 * direction is not a function.** A local time maps to ZERO instants on
 * spring-forward - 02:30 America/New_York does not exist on that day - and to
 * TWO on autumn-back, where 01:30 happens either side of the change.
 *
 * So this steps UTC INSTANTS at the timeframe interval and asks `expectsBarAt`
 * about each one. That direction is TOTAL: every instant has exactly one local
 * rendering. The ambiguity cannot arise because the ambiguous construction is
 * never performed.
 *
 * Consequences, stated so nobody has to re-derive them:
 *
 *   - Spring forward: no instant renders as 02:30 local, so a rule at 02:30
 *     matches nothing and no bar is emitted. Correct by construction.
 *   - Autumn back: TWO instants render as 01:30 local and BOTH are emitted,
 *     because both are real fifteen-minute periods and the market genuinely is
 *     open for 25 hours that day. A local-time generator emits one and
 *     under-counts by four bars.
 *
 * ---------------------------------------------------------------------------
 * WHY TODAY'S DATA WOULD NOT CATCH A LOCAL-TIME GENERATOR (measured, OQ-16)
 * ---------------------------------------------------------------------------
 *
 * **No session week ever contains a DST transition.** US transitions are at
 * 02:00 on a Sunday; the market is closed Friday 17:00 to Sunday 18:00; 02:00
 * is inside that window, in both directions, for all 13 transitions in the
 * stored range.
 *
 * Confirmed against real bars rather than argued: session weeks containing a
 * transition hold **460 bars, identical to their neighbours** - and 460 is
 * 5 x 23h x 4, the calendar's exact expectation. A spring week losing an hour
 * would show 456; an autumn week gaining one would show 464. Neither appears.
 *
 * **So a local-time generator would pass every test built on the real rule
 * placement.** It is wrong anyway, because the finding above is a fact about
 * WHERE THE RULES HAPPEN TO SIT and not a property of the calendar. Move the
 * weekly open to 01:00, or add an instrument in a zone that changes at
 * midnight, and the ambiguity lands inside a live session.
 *
 * **THE DESIGN IS THEREFORE DISCRIMINATED SEPARATELY**, in
 * `expected-grid.test.ts`: the REAL transition dates with the weekly open
 * moved to Sunday 00:00, so the transition falls inside a live session. This
 * generator returns 92 bars on the spring Sunday, 100 on the autumn one and 96
 * on an ordinary one; a local-time generator returns 96 for all three, and
 * emits one 01:30 where there are two.
 *
 * ---------------------------------------------------------------------------
 * FAILURE MODE, AND THE PREDICTION THAT IS ALREADY WATCHING FOR IT
 * ---------------------------------------------------------------------------
 *
 * If this is wrong on DST weeks it emits a burst of `missing_bar` or
 * `unexpected_bar` twice a year - four bars per transition, so roughly 52
 * events clustered on 13 dates in March and November.
 *
 * **T1.5's `missing_bar` prediction already names this**: OQ-13a records
 * "above ~5,000 means the expected grid is wrong, most likely on DST weeks".
 * That is this failure seen from the other end. The link is written here so it
 * survives someone who reads the code and never opens the doc.
 *
 * **The signature is a residual clustered on those 13 dates**, which is
 * distinguishable from holidays - they cluster in late December.
 *
 * **NOT YET OBSERVABLE: there is no autumn transition inside the 24/7 era.**
 * The feed went 24/7 in 2026 and the data ends 2026-09-05; the next
 * autumn-back is 2026-11-01. The doubled hour has never been seen on a day the
 * feed was delivering around the clock, so that case is reasoned, not measured.
 *
 * **And nothing here will ever show up in local manual checking: development
 * happens in Bangkok, UTC+7, which has no DST.**
 *
 * Pure - no clock, no I/O. The range is passed in (F.3 invariant 1).
 */

/** Milliseconds per bar, by timeframe. */
export const INTERVAL_MS: Readonly<Record<string, number>> = {
  '1min': 60_000,
  '15min': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1D': 86_400_000,
}

export interface ExpectedGrid {
  /** Instants at which a bar is expected, ascending. */
  readonly expected: readonly number[]
  /**
   * Instants the calendar could not answer for.
   *
   * **NOT merged into `expected` and NOT silently dropped.** An `unknown`
   * instant is one the calendar does not cover, and treating it as either
   * answer invents a fact. A caller that finds this non-empty has an
   * incomplete calendar and should say so rather than report a clean scan -
   * this is the query-time half of obligation 55.
   */
  readonly unknown: readonly number[]
}

/**
 * Every expected bar instant in `[fromMs, toMs)`.
 *
 * `fromMs` must be aligned to the timeframe. An unaligned start would silently
 * produce a grid offset from every stored bar, so every instant would be
 * reported missing and every bar unexpected - a total failure that looks like
 * a data catastrophe rather than a bug, which is exactly the kind worth
 * refusing at the boundary.
 */
export const expectedGrid = (
  rules: readonly SessionRule[],
  holidays: readonly Holiday[],
  timeframe: string,
  fromMs: number,
  toMs: number,
): ExpectedGrid => {
  const step = INTERVAL_MS[timeframe]
  if (step === undefined) {
    throw new Error(`No interval known for timeframe ${timeframe}`)
  }
  if (fromMs % step !== 0) {
    throw new Error(`Grid start ${fromMs} is not aligned to a ${timeframe} boundary`)
  }
  if (toMs < fromMs) {
    throw new Error(`Grid range ends before it starts: ${fromMs} .. ${toMs}`)
  }

  const expected: number[] = []
  const unknown: number[] = []

  // Stepping UTC instants. `at` is a count of milliseconds and never a local
  // wall-clock value, so DST cannot shift, duplicate or erase an iteration.
  for (let at = fromMs; at < toMs; at += step) {
    const answer: BarExpectation = expectsBarAt(rules, holidays, at)
    if (answer === 'open') expected.push(at)
    else if (answer === 'unknown') unknown.push(at)
  }

  return { expected, unknown }
}
