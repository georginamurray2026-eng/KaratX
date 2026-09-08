import { localMomentOf, type BarExpectation, type Holiday, type SessionRule } from '../calendar'
import { expectedGrid } from '../expected-grid'

/**
 * Derive 1H and 1D bars from stored 15M bars, on the session calendar.
 *
 * PURE. No I/O, no clock, no randomness. Every instant is passed in, and the
 * calendar arrives as rules and holidays rather than as a database handle.
 *
 * ---------------------------------------------------------------------------
 * 1H AND 1D ONLY. THERE IS NO 4H BRANCH, NOT EVEN AN UNREACHABLE ONE.
 * ---------------------------------------------------------------------------
 *
 * Obligation 59. The session day is 23 hours before 2025 and 24 hours in the
 * 24/7 era, so no single division into four-hour periods is correct across
 * both, and no 4H golden fixture exists to validate a choice against. **A
 * dead branch encoding an undecided rule reads to the next person as a decided
 * one** - it would be found, trusted, and enabled by deleting a guard. So the
 * rule is absent rather than disabled, and `aggregate` throws on '4h'.
 *
 * ---------------------------------------------------------------------------
 * THE REQUIRED CONSTITUENT COUNT COMES FROM THE CALENDAR. NEVER FROM 4 OR 96.
 * ---------------------------------------------------------------------------
 *
 * This is the invariant the whole module is arranged around, and the failure it
 * prevents is specific: **a shortened session satisfied by a full count, or a
 * full session satisfied by fewer, is a wrong bar that looks entirely right.**
 *
 * A day with an early close has fewer 15M bars than a normal one. If the rule
 * were "96 bars make a day", that day would never aggregate - or worse, with
 * "at least N", a normal day missing four bars would silently pass as complete
 * and produce a daily bar whose high, low and close are wrong by however much
 * happened in the hour nobody noticed was absent.
 *
 * So the required set is `expectedGrid(...)` over the period: the same
 * calendar, the same function, and the same answer that T1.5's `missing_bar`
 * detector uses. **ONE IMPLEMENTATION, ONE ANSWER.** There is deliberately no
 * arithmetic shortcut that derives a count from session boundaries, because
 * that would be a second implementation of the session rules, free to drift
 * from the first.
 *
 * THE COST OF THAT CHOICE IS REAL AND IS RECORDED RATHER THAN HIDDEN: it asks
 * the calendar about every 15-minute slot in the range, so `expectsBarAt` is
 * called once PER 15M SLOT and not once per session day. See the note on
 * `AggregateResult.expectsBarAtCalls`, and OQ-21, which this falsifies.
 *
 * ---------------------------------------------------------------------------
 * NO LOCAL WALL CLOCK IS EVER CONVERTED TO AN INSTANT
 * ---------------------------------------------------------------------------
 *
 * `expected-grid.ts` sets out why at length: local -> instant is not a
 * function, mapping to zero instants on spring-forward and two on autumn-back.
 * This module inherits that discipline exactly. Session days are assigned by
 * taking an instant and asking what it renders as locally, which is total; the
 * 18:00 boundary is never turned into a UTC time.
 *
 * The consequence is that an aggregate's `openTime` is **the first expected
 * constituent's instant**, not a computed period start. On an ordinary day
 * those coincide. When they would not, the data is right and the computation
 * would have been a guess.
 */

/** A stored 15M bar, as the aggregation needs to see it. */
export interface ConstituentBar {
  /** UTC instant of the bar's open, in milliseconds. */
  readonly openTime: number
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  /** NUMERIC(20,0) as text, or null where the feed carries no volume. */
  readonly volume: string | null
  readonly isFinal: boolean
}

/** A derived bar. Never partial, never forming. */
export interface AggregatedBar {
  /** The first expected constituent's instant. */
  readonly openTime: number
  readonly timeframe: AggregateTimeframe
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  readonly volume: string | null
  /**
   * ALWAYS NULL. No vendor sent this bar, and ADR-014 makes NULL the honest
   * value rather than an invented datetime string.
   */
  readonly rawDatetime: null
  /** ALWAYS TRUE. A period that could not be completed emits nothing at all. */
  readonly isFinal: true
  /** How many 15M bars went in. Carried so a caller can assert it. */
  readonly constituentCount: number
}

export type AggregateTimeframe = '1h' | '1D'

export interface BoundaryConfig {
  readonly rules: readonly SessionRule[]
  readonly holidays: readonly Holiday[]
  /**
   * Local wall-clock time at which a session DAY turns over, `HH:MM:SS`.
   *
   * **Must equal the `weekly_open` rule's `localStart`, and is checked against
   * it.** The daily boundary and the weekly open are the same instant of the
   * week, so allowing them to disagree would let a caller align days to
   * calendar Sunday while the market opens somewhere else - which is the exact
   * thing BUILD-PLAN T1.6 forbids. Passed explicitly rather than only derived,
   * so the agreement is asserted rather than assumed.
   */
  readonly dailyBoundaryLocal: string
}

export interface AggregateResult {
  /** Ascending by `openTime`. */
  readonly bars: readonly AggregatedBar[]
  /**
   * Periods the CALENDAR says exist in the covered range.
   *
   * **COMPUTED INDEPENDENTLY, WHICH IS THE ONLY THING THAT MAKES THE
   * DECOMPOSITION MEANINGFUL.** This is the count of distinct periods holding
   * at least one expected 15M slot - derived from the calendar alone, with no
   * reference to what aggregation produced. OQ-20 records why: computed as
   * written + rejected it becomes an identity that cannot fail for any input,
   * and a decomposition that cannot fail is a confirmation wearing a
   * decomposition's clothes.
   */
  readonly periodsExpected: number
  /** Periods that produced no bar because a constituent was absent or forming. */
  readonly periodsRejectedForMissingConstituents: number
  /**
   * Instants the calendar could not answer for, ascending.
   *
   * **A period containing one of these produces NO BAR**, and is counted as
   * rejected. An unknown instant means the required count is unknown, and a
   * period aggregated without knowing what it required is exactly the silent
   * wrong-bar this module exists to prevent. Obligation 55.
   */
  readonly unknownInstants: readonly number[]
  /**
   * Input bars sitting at instants the calendar does NOT expect, and therefore
   * EXCLUDED from every aggregate.
   *
   * Reported rather than silently dropped. T1.5 counted 10,813 such bars in the
   * stored range - real observations inside closed windows. Feeding one into an
   * aggregate would let a calendar disagreement change a published price
   * without anything saying so.
   */
  readonly unexpectedBarsExcluded: number
  /**
   * How many times `expectsBarAt` was called, via `expectedGrid`.
   *
   * Carried because obligation 57 measured that call at ~29 us and OQ-21
   * predicted fewer than 4,000 of them. **This implementation calls it once per
   * 15M slot in the covered range, so the number is large and OQ-21 is
   * falsified.** Returned rather than described, so the next session compares a
   * number to a number.
   */
  readonly expectsBarAtCalls: number
}

const FIFTEEN_MIN_MS = 900_000
const HOUR_MS = 3_600_000

/** `HH:MM:SS` to minutes since local midnight. */
const minutesOfLocalTime = (value: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (match === null) {
    throw new Error(`Local boundary time must be HH:MM:SS, received ${JSON.stringify(value)}`)
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    throw new Error(`Local boundary time is not a real time of day: ${value}`)
  }
  return hours * 60 + minutes
}

/**
 * The next calendar date after `YYYY-MM-DD`.
 *
 * PURE CALENDAR ARITHMETIC, NOT A ZONE CONVERSION. `Date.UTC` is used only to
 * carry month lengths and leap years; no local time is involved in either
 * direction, so none of the DST hazards apply.
 */
const nextDate = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const at = new Date(Date.UTC(year, month - 1, day) + 86_400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/**
 * Which period does this instant belong to?
 *
 * 1H keys on the UTC hour: 15M bars sit at :00/:15/:30/:45 and every calendar
 * boundary in `market_hours` falls on an hour, so hours never straddle one.
 *
 * 1D keys on the SESSION DAY, by local rendering. An instant at or after the
 * boundary belongs to the session day that has just begun, which is the next
 * calendar date - 18:00 New York on Monday opens Tuesday's session.
 */
const periodKeyOf = (
  instantMs: number,
  timeframe: AggregateTimeframe,
  timezone: string,
  boundaryMinute: number,
): string => {
  if (timeframe === '1h') return String(Math.floor(instantMs / HOUR_MS) * HOUR_MS)
  const moment = localMomentOf(instantMs, timezone)
  return moment.minuteOfDay >= boundaryMinute ? nextDate(moment.date) : moment.date
}

/** Numeric comparison, original text preserved. */
const maxText = (a: string, b: string): string => (Number(b) > Number(a) ? b : a)
const minText = (a: string, b: string): string => (Number(b) < Number(a) ? b : a)

/**
 * Sum volumes, or null if ANY constituent lacks one.
 *
 * BigInt because the column is NUMERIC(20,0) - twenty digits exceeds what a
 * float64 represents exactly, and a volume that silently rounds is a wrong
 * number that looks precise. Null propagates rather than being treated as
 * zero: 0 and "not supplied" are different facts, which the `Candle` contract
 * already says in as many words.
 */
const sumVolume = (bars: readonly ConstituentBar[]): string | null => {
  let total = 0n
  for (const bar of bars) {
    if (bar.volume === null) return null
    if (!/^\d+$/.test(bar.volume)) {
      throw new Error(`Volume is not a non-negative integer: ${JSON.stringify(bar.volume)}`)
    }
    total += BigInt(bar.volume)
  }
  return String(total)
}

/**
 * Aggregate 15M bars onto the session calendar.
 *
 * @throws when `timeframe` is not '1h' or '1D', when the rules span more than
 * one zone, when `dailyBoundaryLocal` disagrees with the `weekly_open` rule, or
 * when the input contains two bars at the same instant.
 */
export const aggregate = (
  candles: readonly ConstituentBar[],
  timeframe: AggregateTimeframe,
  config: BoundaryConfig,
): AggregateResult => {
  if (timeframe !== '1h' && timeframe !== '1D') {
    throw new Error(
      `Aggregation supports '1h' and '1D' only, received ${JSON.stringify(String(timeframe))}. ` +
        `4H is deliberately absent rather than disabled - obligation 59: the session day is 23 ` +
        `hours before 2025 and 24 hours after, so no single four-hour division is correct ` +
        `across both eras, and no 4H fixture exists to validate one against.`,
    )
  }

  const empty: AggregateResult = {
    bars: [],
    periodsExpected: 0,
    periodsRejectedForMissingConstituents: 0,
    unknownInstants: [],
    unexpectedBarsExcluded: 0,
    expectsBarAtCalls: 0,
  }
  if (candles.length === 0) return empty
  if (config.rules.length === 0) {
    throw new Error(
      'Aggregation was given an EMPTY calendar. An empty calendar expects nothing, so every ' +
        'period would be rejected and the run would report a clean zero - obligation 55.',
    )
  }

  const zones = new Set(config.rules.map((rule) => rule.timezone))
  if (zones.size > 1) {
    throw new Error(`Rules span multiple time zones: ${[...zones].sort().join(', ')}`)
  }
  const timezone = config.rules[0]!.timezone

  // THE WEEKLY OPEN IS THE AUTHORITY, and the daily boundary is checked against
  // it rather than trusted. BUILD-PLAN T1.6 requires weekly alignment to the
  // actual market open, never calendar Sunday; a daily boundary free to
  // disagree with the weekly open would reintroduce exactly that.
  const weeklyOpen = config.rules.find((rule) => rule.ruleType === 'weekly_open')
  if (weeklyOpen === undefined) {
    throw new Error(
      'No weekly_open rule. The session day boundary is defined by the market open, so without ' +
        'it there is nothing to align days or weeks to - and calendar Sunday is not a fallback.',
    )
  }
  if (weeklyOpen.localStart !== config.dailyBoundaryLocal) {
    throw new Error(
      `Daily boundary ${config.dailyBoundaryLocal} disagrees with the weekly_open rule at ` +
        `${weeklyOpen.localStart} (${weeklyOpen.timezone}). They are the same instant of the ` +
        `week and must not diverge.`,
    )
  }
  const boundaryMinute = minutesOfLocalTime(config.dailyBoundaryLocal)

  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime)
  const byInstant = new Map<number, ConstituentBar>()
  for (const bar of sorted) {
    if (byInstant.has(bar.openTime)) {
      throw new Error(
        `Two input bars share the instant ${String(bar.openTime)}. Aggregation cannot choose ` +
          `between them, and picking one would silently prefer a price.`,
      )
    }
    byInstant.set(bar.openTime, bar)
  }

  const fromMs = sorted[0]!.openTime
  const toMs = sorted[sorted.length - 1]!.openTime + FIFTEEN_MIN_MS
  if (fromMs % FIFTEEN_MIN_MS !== 0) {
    throw new Error(`Input bar at ${String(fromMs)} is not aligned to a 15-minute boundary`)
  }

  // THE GRID MUST COVER WHOLE PERIODS, NOT THE INPUT SPAN, AND THIS WAS A
  // DEFECT BEFORE IT WAS A COMMENT.
  //
  // Asking the calendar only about [first bar, last bar) truncates the required
  // set of any period the input does not fully cover - so ONE bar at 00:00
  // produced a one-constituent "hourly" bar that satisfied every completeness
  // check, because the check was comparing against a required set the input had
  // itself defined. That is the partial aggregate this module exists to refuse,
  // arriving through the back door.
  //
  // So the grid is widened past both edges and the required set is whatever the
  // calendar says the WHOLE period holds. Edge periods then fail the ordinary
  // completeness check, because their out-of-span constituents are absent -
  // which is the correct answer rather than a special case.
  //
  // The pad is generous rather than exact because computing an exact period
  // start would mean converting a local wall clock to an instant, which is the
  // one thing this module never does. A session day is at most 25 hours.
  const pad = timeframe === '1D' ? 26 * HOUR_MS : HOUR_MS
  const gridFrom = fromMs - pad
  const gridTo = toMs + pad

  const grid = expectedGrid(config.rules, config.holidays, '15min', gridFrom, gridTo)
  const expectsBarAtCalls = (gridTo - gridFrom) / FIFTEEN_MIN_MS

  // Periods holding at least one EXPECTED slot. Built from the calendar alone -
  // nothing here consults `byInstant`, which is what keeps `periodsExpected`
  // independent of the outputs (OQ-20).
  const requiredByPeriod = new Map<string, number[]>()
  for (const at of grid.expected) {
    const key = periodKeyOf(at, timeframe, timezone, boundaryMinute)
    const slots = requiredByPeriod.get(key)
    if (slots === undefined) requiredByPeriod.set(key, [at])
    else slots.push(at)
  }

  // A period containing an UNKNOWN instant cannot state what it requires.
  // Kept per period as well as as a set, because the span filter below has to
  // ask whether a period's UNKNOWN instants reach the input - a period with no
  // expected slots at all has nothing else to answer with.
  const poisonedByUnknown = new Set<string>()
  const unknownByPeriod = new Map<string, number[]>()
  for (const at of grid.unknown) {
    const key = periodKeyOf(at, timeframe, timezone, boundaryMinute)
    poisonedByUnknown.add(key)
    const slots = unknownByPeriod.get(key)
    if (slots === undefined) unknownByPeriod.set(key, [at])
    else slots.push(at)
  }
  for (const key of poisonedByUnknown) {
    if (!requiredByPeriod.has(key)) requiredByPeriod.set(key, [])
  }

  const expectedInstants = new Set(grid.expected)
  let unexpectedBarsExcluded = 0
  for (const bar of sorted) {
    if (!expectedInstants.has(bar.openTime)) unexpectedBarsExcluded += 1
  }

  // Only periods the INPUT actually reaches. The pad above deliberately
  // overshoots, and without this a caller passing one hour of bars would be
  // told that two whole session days were rejected - periods it never claimed
  // to cover, counted against it.
  //
  // THE TEST IS THE SAME WHETHER OR NOT THE CALENDAR COULD ANSWER, AND THAT
  // WAS A DEFECT BEFORE IT WAS A COMMENT. An out-of-span period used to be
  // dropped when the calendar covered it and KEPT when it did not, so the
  // rejection denominator moved with calendar COVERAGE rather than with what
  // the caller supplied: two runs over identical input could report different
  // denominators purely because one had a gap in its pad. A denominator that
  // depends on something the caller cannot see is not a denominator.
  //
  // Unknowns are not lost by this. `unknownInstants` reports every one of them
  // and is deliberately SPAN-INDEPENDENT - a calendar gap is a fact about the
  // calendar, not about the window someone happened to ask for. That is the
  // right home for it (obligation 55), and the rejection count is not.
  const inSpan = (instants: readonly number[]): boolean =>
    instants.some((at) => at >= fromMs && at < toMs)
  for (const [key, slots] of [...requiredByPeriod.entries()]) {
    if (inSpan(slots)) continue
    if (inSpan(unknownByPeriod.get(key) ?? [])) continue
    requiredByPeriod.delete(key)
  }

  const bars: AggregatedBar[] = []
  let rejected = 0

  const periods = [...requiredByPeriod.entries()].sort((a, b) => {
    const left = a[1][0] ?? Number.POSITIVE_INFINITY
    const right = b[1][0] ?? Number.POSITIVE_INFINITY
    return left - right
  })

  for (const [key, required] of periods) {
    if (poisonedByUnknown.has(key) || required.length === 0) {
      rejected += 1
      continue
    }

    const constituents: ConstituentBar[] = []
    let complete = true
    for (const at of required) {
      const bar = byInstant.get(at)
      // MISSING and FORMING are the same answer here, deliberately. A period
      // built from a forming bar would have to be revised when that bar
      // settles, and BUILD-PLAN T1.6 asks for no partial aggregate ever - so
      // the period simply does not exist yet.
      if (bar === undefined || !bar.isFinal) {
        complete = false
        break
      }
      constituents.push(bar)
    }
    if (!complete) {
      rejected += 1
      continue
    }

    const first = constituents[0]!
    const last = constituents[constituents.length - 1]!
    let high = first.high
    let low = first.low
    for (const bar of constituents) {
      high = maxText(high, bar.high)
      low = minText(low, bar.low)
    }

    bars.push({
      openTime: first.openTime,
      timeframe,
      open: first.open,
      high,
      low,
      close: last.close,
      volume: sumVolume(constituents),
      rawDatetime: null,
      isFinal: true,
      constituentCount: constituents.length,
    })
  }

  return {
    bars,
    periodsExpected: requiredByPeriod.size,
    periodsRejectedForMissingConstituents: rejected,
    unknownInstants: grid.unknown,
    unexpectedBarsExcluded,
    expectsBarAtCalls,
  }
}

/** Re-exported so a caller does not have to reach into `calendar` for the type. */
export type { BarExpectation }
