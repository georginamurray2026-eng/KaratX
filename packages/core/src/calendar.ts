/**
 * "Should a bar exist at this instant?" - the question every T1.5 detector asks.
 *
 * THREE-VALUED, NEVER A BOOLEAN, and that is the whole point of the function.
 * `market_hours` carries a prominent comment on why the table must not be
 * empty: an empty calendar answers "nothing expected" to every question, so
 * weekend detection finds nothing, every assertion passes, and there is no
 * error, no alert and no symptom. A boolean cannot express the difference
 * between CLOSED and NOT KNOWN, so the empty table would be silently wrong.
 *
 * With `unknown` as a distinct answer, an uncovered date is LOUD instead:
 * nothing may treat it as closed, and the staleness alarm is never suppressed
 * by it. That is the query-time half of obligation 55.
 *
 * ---------------------------------------------------------------------------
 * TIME ZONES, AND THE ONE DIRECTION THIS FUNCTION TRAVELS
 * ---------------------------------------------------------------------------
 *
 * Rules are stored as LOCAL WALL-CLOCK TIME PLUS AN IANA ZONE, never a UTC
 * offset, because 17:00 New York is 22:00Z under EST and 21:00Z under EDT.
 * Resolving that needs a tzdata lookup, and this function does it with
 * `Intl.DateTimeFormat`, which is an ECMAScript global rather than a Node
 * builtin: no I/O, no clock read, and deterministic given an instant and a
 * zone. `new Date(ms)` is explicitly permitted in this package; `new Date()`
 * is not, and does not appear here.
 *
 * THIS FUNCTION ONLY EVER CONVERTS INSTANT -> LOCAL, NEVER THE REVERSE, and
 * that asymmetry is deliberate rather than incidental. Instant -> local is
 * total: every instant has exactly one local rendering. Local -> instant is
 * NOT: on the autumn transition 01:30 America/New_York happens twice and maps
 * to two instants, and on the spring transition 02:30 never happens at all.
 * Verified rather than assumed - 2020-11-01T05:30Z and 2020-11-01T06:30Z both
 * render as 01:30 local, and 2020-03-08T06:30Z renders as 01:30 while
 * 07:30Z renders as 03:30.
 *
 * The session boundaries this project uses (17:00 and 18:00) are nowhere near
 * the ambiguous window, so the risk is theoretical TODAY. It stops being
 * theoretical the moment a rule is added near midnight, which is why the
 * direction is stated as an invariant rather than left as a happy accident.
 *
 * TZDATA IS AN ENVIRONMENT DEPENDENCY AND THIS PACKAGE CANNOT CHECK IT.
 * `Intl` resolves against the ICU data bundled with the runtime, and tzdata
 * revises HISTORICAL rules from time to time - so a runtime upgrade could in
 * principle change the answer for a 2020 instant and silently move the
 * baseline. Reading `process.versions.tz` would settle it, and `process` is
 * exactly what this package may not name. The check therefore lives outside
 * core; the pinning tests beside this file are the in-package half, and they
 * fail loudly if a historical conversion ever moves.
 *
 * NOTHING HERE READS A CLOCK. The instant is a parameter (F.3 invariant 1).
 */

/**
 * `open` - a bar is expected.
 * `closed` - no bar is expected; one arriving is `unexpected_bar`.
 * `unknown` - THE CALENDAR DOES NOT COVER THIS INSTANT. Never treat as closed.
 */
export type BarExpectation = 'open' | 'closed' | 'unknown'

/** A `market_hours` row, as the domain sees it. */
export interface SessionRule {
  readonly id: number
  readonly ruleType: 'weekly_open' | 'weekly_close' | 'daily_break'
  /** ISO day of week: 1 = Monday .. 7 = Sunday, matching Postgres `isodow`. */
  readonly dayOfWeek: number
  /** Local wall-clock `HH:MM:SS` in `timezone`. */
  readonly localStart: string
  /** Null for instant rules (`weekly_open`, `weekly_close`). */
  readonly localEnd: string | null
  /** IANA name. Never an abbreviation or a UTC offset. */
  readonly timezone: string
  /** `YYYY-MM-DD`, inclusive. */
  readonly effectiveFrom: string
  /** `YYYY-MM-DD`, EXCLUSIVE. Null means still in force. */
  readonly effectiveTo: string | null
}

/** A `market_holidays` row, as the domain sees it. */
export interface Holiday {
  /** `YYYY-MM-DD` in the instrument's session timezone. */
  readonly holidayDate: string
  readonly closureType: 'full' | 'early_close'
  /** Local wall-clock close for `early_close`; null for `full`. */
  readonly localClose: string | null
}

/** Local wall clock, resolved from an instant. */
interface LocalMoment {
  /** `YYYY-MM-DD` in the session zone. */
  readonly date: string
  /** ISO day of week: 1 = Monday .. 7 = Sunday. */
  readonly isoDow: number
  /** Minutes since local midnight. */
  readonly minuteOfDay: number
}

const ISO_DOW_BY_NAME: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

/**
 * `HH:MM:SS` -> minutes since midnight.
 *
 * SECONDS ARE REJECTED RATHER THAN TRUNCATED. Every rule this project stores
 * lands on a minute boundary, and a rule at 17:00:30 would mean the boundary
 * falls inside a bar - a situation with no correct answer here, which the
 * caller must resolve rather than have silently rounded away.
 */
const minutesOfDay = (localTime: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(localTime)
  if (match === null) {
    throw new Error(`Not a local wall-clock time: ${localTime}`)
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (hours > 23 || minutes > 59 || seconds !== 0) {
    throw new Error(`Rule times must land on a whole minute within a day: ${localTime}`)
  }
  return hours * 60 + minutes
}

/** Minutes from Monday 00:00 local, for a rule's day and time. */
const weekMinutesOf = (isoDow: number, localTime: string): number =>
  (isoDow - 1) * 24 * 60 + minutesOfDay(localTime)

/**
 * An instant, rendered in a zone. The ONE direction this module travels.
 *
 * A new formatter per call would be the obvious way to write this and is
 * measurably slower; the detectors ask this question 166,344 times. The cache
 * is keyed by zone, holds only formatters, and is invisible to callers - it
 * cannot change an answer, only how long it takes to get one.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timezone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timezone)
  if (cached !== undefined) return cached
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  })
  formatters.set(timezone, made)
  return made
}

const localMomentOf = (instantMs: number, timezone: string): LocalMoment => {
  const parts = formatterFor(timezone).formatToParts(new Date(instantMs))
  let year = ''
  let month = ''
  let day = ''
  let hour = ''
  let minute = ''
  let weekday = ''
  for (const part of parts) {
    if (part.type === 'year') year = part.value
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
    else if (part.type === 'hour') hour = part.value
    else if (part.type === 'minute') minute = part.value
    else if (part.type === 'weekday') weekday = part.value
  }
  const isoDow = ISO_DOW_BY_NAME[weekday]
  if (isoDow === undefined) {
    throw new Error(`Unrecognised weekday "${weekday}" for zone ${timezone}`)
  }
  // `hourCycle: 'h23'` renders midnight as 24 in some ICU versions. Checked
  // rather than assumed, and normalised here so the arithmetic below cannot
  // silently produce a minute-of-day of 1440.
  const hourNumber = Number(hour) % 24
  return {
    date: `${year}-${month}-${day}`,
    isoDow,
    minuteOfDay: hourNumber * 60 + Number(minute),
  }
}

/** Rules in force on a local date. `effectiveTo` is EXCLUSIVE. */
const rulesInForce = (rules: readonly SessionRule[], localDate: string): readonly SessionRule[] =>
  rules.filter(
    (rule) =>
      rule.effectiveFrom <= localDate &&
      (rule.effectiveTo === null || localDate < rule.effectiveTo),
  )

/**
 * Should a bar exist at `instantMs`?
 *
 * Returns `unknown` when the calendar cannot answer - no rules in force, or a
 * set of rules that does not describe a week. **`unknown` is not a failure and
 * must not be collapsed into `closed`**; a caller that cannot handle it should
 * refuse, not guess.
 */
export const expectsBarAt = (
  rules: readonly SessionRule[],
  holidays: readonly Holiday[],
  instantMs: number,
): BarExpectation => {
  if (rules.length === 0) return 'unknown'

  // Every rule for one instrument shares a zone; the calendar is per
  // instrument, not per venue. Mixed zones mean the caller has combined two
  // instruments' rules, which no correct answer can be given for.
  const zones = new Set(rules.map((rule) => rule.timezone))
  if (zones.size > 1) {
    throw new Error(`Rules span multiple time zones: ${[...zones].sort().join(', ')}`)
  }
  const timezone = rules[0]!.timezone

  const moment = localMomentOf(instantMs, timezone)
  const inForce = rulesInForce(rules, moment.date)
  if (inForce.length === 0) return 'unknown'

  const open = inForce.find((rule) => rule.ruleType === 'weekly_open')
  const close = inForce.find((rule) => rule.ruleType === 'weekly_close')

  // A calendar without both boundaries does not describe a week. UNKNOWN
  // rather than an assumption - this is the shape obligation 55 warns about,
  // where rows exist but cover nothing.
  if (open === undefined || close === undefined) return 'unknown'

  const now = (moment.isoDow - 1) * 24 * 60 + moment.minuteOfDay
  const opensAt = weekMinutesOf(open.dayOfWeek, open.localStart)
  const closesAt = weekMinutesOf(close.dayOfWeek, close.localStart)

  // THE WEEK WRAPS. Gold opens Sunday evening and closes Friday afternoon, so
  // the OPEN interval spans the week boundary while the CLOSED one does not.
  // Written as an explicit wrap rather than as a comparison that happens to
  // work, because the two orderings need opposite tests and a future
  // instrument may well use the other one.
  const openSpansWrap = opensAt > closesAt
  const withinWeeklySession = openSpansWrap
    ? now >= opensAt || now < closesAt
    : now >= opensAt && now < closesAt

  if (!withinWeeklySession) return 'closed'

  // Daily breaks carve holes out of the weekly session. `localEnd` is
  // guaranteed non-null for `daily_break` by `market_hours_span_check`, but
  // this reads it defensively: a rule that reached here with a null end would
  // otherwise silently mean "closed forever after".
  for (const rule of inForce) {
    if (rule.ruleType !== 'daily_break') continue
    if (rule.localEnd === null) {
      throw new Error(`daily_break rule ${rule.id} has no localEnd`)
    }
    const from = weekMinutesOf(rule.dayOfWeek, rule.localStart)
    const to = weekMinutesOf(rule.dayOfWeek, rule.localEnd)
    if (now >= from && now < to) return 'closed'
  }

  for (const holiday of holidays) {
    if (holiday.holidayDate !== moment.date) continue
    if (holiday.closureType === 'full') return 'closed'
    if (holiday.localClose === null) {
      throw new Error(`early_close holiday ${holiday.holidayDate} has no localClose`)
    }
    if (moment.minuteOfDay >= minutesOfDay(holiday.localClose)) return 'closed'
  }

  return 'open'
}
