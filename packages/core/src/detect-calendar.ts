import { expectsBarAt, type Holiday, type SessionRule } from './calendar'
import { expectedGrid } from './expected-grid'

/**
 * Detectors 1 and 2 - `unexpected_bar` and `missing_bar`.
 *
 * PURE. Takes the bars already fetched and the calendar already loaded, and
 * returns descriptions of events. It never learns where the bars came from,
 * which is what lets the backtest run this identical code path (F.3).
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE TWO DETECTORS DO NOT MEAN
 * ---------------------------------------------------------------------------
 *
 * **The calendar's weekly-open boundary was corrected against THIS FEED in
 * migration 0004.** So these detectors compare the feed to a calendar partly
 * derived from the feed, and agreement is SELF-CONSISTENCY, NOT CORRECTNESS.
 *
 * That caveat is not left to the documentation. It is written into
 * `payload.basis` on every event these detectors emit, so the number cannot be
 * read back out of the database without it. `implausible_gap` and `stale_feed`
 * carry no such field, because they are not calendar claims - which makes them
 * the only baseline findings carrying independent information.
 *
 * ---------------------------------------------------------------------------
 * THREE OUTCOMES PER INSTANT, NOT TWO
 * ---------------------------------------------------------------------------
 *
 * A stored bar at an instant the calendar cannot answer for is NOT
 * `unexpected_bar`. An expected instant the calendar cannot answer for is NOT
 * `missing_bar`. Both are counted separately and reported, because calling an
 * unknown a finding would manufacture events out of an incomplete calendar -
 * and the count of unknowns is the symptom that the calendar is incomplete.
 */

/** Which closed window a bar fell into. Part of the finding, so part of the hash. */
export type ClosedWindow = 'weekly_closure' | 'daily_break'

export interface CalendarScan {
  /** Stored bars the calendar says should not exist. */
  readonly unexpected: readonly { readonly openTimeMs: number; readonly window: ClosedWindow }[]
  /** Expected instants with no stored bar. */
  readonly missing: readonly number[]
  /** Stored bars at instants the calendar cannot answer for. NOT unexpected. */
  readonly unknownStored: readonly number[]
  /** Grid instants the calendar cannot answer for. NOT missing. */
  readonly unknownExpected: readonly number[]
  /** Stored bars examined. The denominator for every rate derived from this. */
  readonly scanned: number
  /** Instants the calendar said were open. The denominator for `missing`. */
  readonly expectedOpen: number
}

/**
 * Which rule closed this instant.
 *
 * A bar inside 17:00-18:00 on a weekday is a DAILY BREAK bar; anything else
 * closed is inside the weekly closure. Distinguished because the recorded
 * baseline is a SUM OF TWO WINDOWS - 9,645 and 1,168 - and a total that
 * matched while the split was wrong would look like a pass.
 */
const closedWindowOf = (
  rules: readonly SessionRule[],
  holidays: readonly Holiday[],
  instantMs: number,
): ClosedWindow => {
  // If removing the daily breaks would make this instant open, a break is what
  // closed it. Derived from the rules rather than from a second time
  // calculation, so the two can never disagree.
  const withoutBreaks = rules.filter((rule) => rule.ruleType !== 'daily_break')
  return expectsBarAt(withoutBreaks, holidays, instantMs) === 'open'
    ? 'daily_break'
    : 'weekly_closure'
}

/**
 * Compare stored bars against the calendar over `[fromMs, toMs)`.
 *
 * `storedOpenTimesMs` must be ascending and contain only instants inside the
 * range. Both are the caller's job; violating either produces silent
 * nonsense rather than an error, so the query that feeds this is bounded by
 * the same range.
 */
export const scanCalendar = (
  rules: readonly SessionRule[],
  holidays: readonly Holiday[],
  timeframe: string,
  fromMs: number,
  toMs: number,
  storedOpenTimesMs: readonly number[],
): CalendarScan => {
  const stored = new Set(storedOpenTimesMs)
  const { expected, unknown: unknownExpected } = expectedGrid(
    rules,
    holidays,
    timeframe,
    fromMs,
    toMs,
  )

  const unexpected: { openTimeMs: number; window: ClosedWindow }[] = []
  const unknownStored: number[] = []
  for (const openTimeMs of storedOpenTimesMs) {
    const answer = expectsBarAt(rules, holidays, openTimeMs)
    if (answer === 'closed') {
      unexpected.push({ openTimeMs, window: closedWindowOf(rules, holidays, openTimeMs) })
    } else if (answer === 'unknown') {
      unknownStored.push(openTimeMs)
    }
  }

  const missing = expected.filter((instant) => !stored.has(instant))

  return {
    unexpected,
    missing,
    unknownStored,
    unknownExpected,
    scanned: storedOpenTimesMs.length,
    expectedOpen: expected.length,
  }
}

/**
 * THE SELF-CONSISTENCY CAVEAT, as data rather than prose.
 *
 * Carried on every calendar-derived event so the count cannot be quoted
 * without it. Deterministic - rule ids and dates only, never a timestamp or a
 * run id, because this is inside the hash and anything varying per run would
 * turn every re-run into a fresh row instead of an increment.
 */
export interface CalendarBasis {
  readonly rule_ids: readonly number[]
  readonly effective_from: readonly string[]
  readonly calendar_migration: string
  readonly note: string
}

export const CALENDAR_PROVENANCE =
  'Boundaries originally from Massive; corrected against Twelve Data in migration 0004. ' +
  'These detectors compare the feed to a calendar partly derived from that feed, so ' +
  'agreement is SELF-CONSISTENCY, NOT CORRECTNESS.'

export const basisOf = (rules: readonly SessionRule[]): CalendarBasis => ({
  rule_ids: [...rules.map((rule) => rule.id)].sort((a, b) => a - b),
  effective_from: [...new Set(rules.map((rule) => rule.effectiveFrom))].sort(),
  calendar_migration: '0004_calendar_measured_against_twelve_data',
  note: CALENDAR_PROVENANCE,
})

/**
 * Canonical rendering of a payload, for hashing.
 *
 * THE HASH IS THE UNIQUENESS KEY, so this function's stability is a schema
 * concern - see the comment on `data_quality_events.payload_hash`. Whoever
 * edits this is editing that constraint, and changing it changes RETROACTIVELY
 * what counts as a distinct event.
 *
 * Keys sorted at every level; numeric strings stripped of trailing fractional
 * zeros. **PURE STRING WORK - NEVER `Number()`.** Prices cross this boundary as
 * text and `NUMERIC(12,5)` pads to scale, so the provider's `4375.5959` returns
 * as `4375.59590`: same number, different string, and hashing the raw text
 * would make every re-detection a new event. Parsing to normalise would destroy
 * the precision ADR-008 preserves - `4600.123456789012345` survives stripping
 * and does not survive float64.
 *
 * The SHA-256 itself is NOT here: it needs a Node builtin, which this package
 * may not name. The canonicalisation is the part with the domain rule in it.
 */
const NUMERIC_TEXT = /^-?\d+\.\d+$/

const stripTrailingZeros = (value: string): string => {
  if (!NUMERIC_TEXT.test(value)) return value
  let end = value.length
  while (end > 0 && value[end - 1] === '0') end -= 1
  if (end > 0 && value[end - 1] === '.') end -= 1
  return value.slice(0, end)
}

export const canonicalisePayload = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(stripTrailingZeros(value))
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Payload holds a non-finite number: ${String(value)}`)
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalisePayload(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalisePayload(item)}`)
      .join(',')}}`
  }
  throw new Error(`Payload holds a value that cannot be canonicalised: ${typeof value}`)
}
