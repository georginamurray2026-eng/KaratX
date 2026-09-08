import { describe, expect, it } from 'vitest'

import { type Holiday, type SessionRule } from '../calendar'
import {
  aggregate,
  type AggregateTimeframe,
  type BoundaryConfig,
  type ConstituentBar,
} from './aggregate'

/**
 * Aggregation onto the session calendar.
 *
 * THE RULES BELOW ARE THE REAL ONES, at migration 0004's corrected boundaries:
 * weekly open Sunday 18:00 New York, daily break 17:00-18:00 Monday to
 * Thursday, weekly close Friday 17:00. Synthetic bars, real calendar - so a
 * failure here is the aggregation disagreeing with the calendar T1.5 already
 * validated, not with an assumption invented for this file.
 */

const NY = 'America/New_York'
const UK = 'Europe/London'

const rule = (
  id: number,
  ruleType: SessionRule['ruleType'],
  dayOfWeek: number,
  localStart: string,
  localEnd: string | null,
  timezone = NY,
): SessionRule => ({
  id,
  ruleType,
  dayOfWeek,
  localStart,
  localEnd,
  timezone,
  effectiveFrom: '2020-01-24',
  effectiveTo: null,
})

const RULES: readonly SessionRule[] = [
  rule(1, 'weekly_open', 7, '18:00:00', null),
  rule(2, 'daily_break', 1, '17:00:00', '18:00:00'),
  rule(3, 'daily_break', 2, '17:00:00', '18:00:00'),
  rule(4, 'daily_break', 3, '17:00:00', '18:00:00'),
  rule(5, 'daily_break', 4, '17:00:00', '18:00:00'),
  rule(6, 'weekly_close', 5, '17:00:00', null),
]

/** The 24/7 era: no break, no close. ADR-008 - Twelve Data ran continuously. */
const RULES_247: readonly SessionRule[] = [
  rule(1, 'weekly_open', 7, '18:00:00', null),
  rule(6, 'weekly_close', 7, '17:59:00', null),
]

const NO_HOLIDAYS: readonly Holiday[] = []

const config = (
  rules: readonly SessionRule[] = RULES,
  holidays: readonly Holiday[] = NO_HOLIDAYS,
  dailyBoundaryLocal = '18:00:00',
): BoundaryConfig => ({ rules, holidays, dailyBoundaryLocal })

const ms = (iso: string): number => Date.parse(iso)

/** A constituent with distinct, orderable prices derived from its index. */
const bar = (openTime: number, n: number, overrides: Partial<ConstituentBar> = {}) => ({
  openTime,
  open: `${String(4000 + n)}.00000`,
  high: `${String(4010 + n)}.00000`,
  low: `${String(3990 + n)}.00000`,
  close: `${String(4005 + n)}.00000`,
  volume: null,
  isFinal: true,
  ...overrides,
})

/** Fifteen-minute bars covering [fromIso, toIso), one per slot. */
const bars = (fromIso: string, toIso: string, overrides: Partial<ConstituentBar> = {}) => {
  const out: ConstituentBar[] = []
  let n = 0
  for (let at = ms(fromIso); at < ms(toIso); at += 900_000) {
    out.push(bar(at, n, overrides))
    n += 1
  }
  return out
}

describe('aggregate - what it refuses', () => {
  it('REFUSES 4h, and the message says the rule is absent rather than disabled', () => {
    // Obligation 59. Asserted because a future session reading "not supported"
    // would reasonably add a branch; the message must say why it must not.
    // '4h' is deliberately outside AggregateTimeframe, so the type system
    // already refuses it. The cast reaches the RUNTIME guard, which is what
    // protects a caller crossing the boundary from untyped JavaScript.
    const fourHour = '4h' as unknown as AggregateTimeframe
    expect(() =>
      aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z'), fourHour, config()),
    ).toThrow(/obligation 59/i)
  })

  it('refuses an empty calendar rather than reporting a clean zero', () => {
    expect(() =>
      aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z'), '1h', config([])),
    ).toThrow(/EMPTY calendar/i)
  })

  it('refuses a daily boundary that disagrees with weekly_open', () => {
    // Calendar Sunday midnight is the specific wrong answer BUILD-PLAN forbids.
    expect(() =>
      aggregate(
        bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z'),
        '1D',
        config(RULES, NO_HOLIDAYS, '00:00:00'),
      ),
    ).toThrow(/disagrees with the weekly_open rule/i)
  })

  it('refuses two bars at the same instant rather than preferring one price', () => {
    const at = ms('2026-06-16T00:00:00Z')
    expect(() => aggregate([bar(at, 0), bar(at, 1), bar(at + 900_000, 2)], '1h', config())).toThrow(
      /share the instant/i,
    )
  })

  it('returns an empty result for empty input, and does not call the calendar', () => {
    const r = aggregate([], '1h', config())
    expect(r.bars).toEqual([])
    expect(r.periodsExpected).toBe(0)
    expect(r.expectsBarAtCalls).toBe(0)
  })
})

describe('aggregate - 1H exact boundaries', () => {
  it('aggregates one complete hour from four 15M bars', () => {
    // Tuesday 00:00-01:00 UTC = Monday 20:00-21:00 New York, mid-session.
    const r = aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z'), '1h', config())

    expect(r.bars).toHaveLength(1)
    const out = r.bars[0]!
    expect(out.openTime).toBe(ms('2026-06-16T00:00:00Z'))
    expect(out.constituentCount).toBe(4)
    expect(out.isFinal).toBe(true)
    expect(out.rawDatetime).toBeNull()
    // open from the FIRST, close from the LAST, high max, low min.
    expect(out.open).toBe('4000.00000')
    expect(out.close).toBe('4008.00000')
    expect(out.high).toBe('4013.00000')
    expect(out.low).toBe('3990.00000')
  })

  it('does not let a bar leak between adjacent hours', () => {
    const r = aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T02:00:00Z'), '1h', config())
    expect(r.bars).toHaveLength(2)
    expect(r.bars[0]!.constituentCount).toBe(4)
    expect(r.bars[1]!.constituentCount).toBe(4)
    expect(r.bars[1]!.openTime).toBe(ms('2026-06-16T01:00:00Z'))
    expect(r.bars[0]!.close).not.toBe(r.bars[1]!.open)
  })

  it('a single bar yields no hour, because three constituents are absent', () => {
    const r = aggregate([bar(ms('2026-06-16T00:00:00Z'), 0)], '1h', config())
    expect(r.bars).toEqual([])
    expect(r.periodsExpected).toBe(1)
    expect(r.periodsRejectedForMissingConstituents).toBe(1)
  })
})

describe('aggregate - the completeness rule', () => {
  it('MISSING constituent yields no aggregate at all, not a partial one', () => {
    const four = bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z')
    const three = four.filter((b) => b.openTime !== ms('2026-06-16T00:30:00Z'))

    const r = aggregate(three, '1h', config())
    expect(r.bars).toEqual([])
    expect(r.periodsExpected).toBe(1)
    expect(r.periodsRejectedForMissingConstituents).toBe(1)
  })

  it('NON-FINAL constituent yields no aggregate - forming and missing are one answer', () => {
    const four = bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z').map((b) =>
      b.openTime === ms('2026-06-16T00:45:00Z') ? { ...b, isFinal: false } : b,
    )

    const r = aggregate(four, '1h', config())
    expect(r.bars).toEqual([])
    expect(r.periodsRejectedForMissingConstituents).toBe(1)
  })

  it('PARTIAL-FINAL: the complete hour survives while its incomplete neighbour does not', () => {
    // The positive control for the two tests above. Without it, a function that
    // rejected EVERYTHING would pass both.
    const two = bars('2026-06-16T00:00:00Z', '2026-06-16T02:00:00Z').filter(
      (b) => b.openTime !== ms('2026-06-16T01:30:00Z'),
    )

    const r = aggregate(two, '1h', config())
    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.openTime).toBe(ms('2026-06-16T00:00:00Z'))
    expect(r.periodsExpected).toBe(2)
    expect(r.periodsRejectedForMissingConstituents).toBe(1)
  })

  it('every output row is final, and no output row carries a rawDatetime', () => {
    const r = aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T04:00:00Z'), '1h', config())
    expect(r.bars).toHaveLength(4)
    expect(r.bars.every((b) => b.isFinal)).toBe(true)
    expect(r.bars.every((b) => b.rawDatetime === null)).toBe(true)
  })

  it('the decomposition balances: expected == written + rejected', () => {
    const some = bars('2026-06-16T00:00:00Z', '2026-06-16T04:00:00Z').filter(
      (b) => b.openTime !== ms('2026-06-16T02:15:00Z'),
    )
    const r = aggregate(some, '1h', config())
    expect(r.periodsExpected).toBe(r.bars.length + r.periodsRejectedForMissingConstituents)
  })

  it('periodsExpected is calendar-derived: dropping a bar moves rejected, NOT expected', () => {
    // OQ-20. THIS IS THE TEST THAT DISTINGUISHES A DECOMPOSITION FROM AN
    // IDENTITY. If periodsExpected were computed as written + rejected it would
    // be unchanged here too - so the assertion that matters is that written
    // fell by exactly one while expected held.
    const full = bars('2026-06-16T00:00:00Z', '2026-06-16T04:00:00Z')
    const before = aggregate(full, '1h', config())
    const after = aggregate(
      full.filter((b) => b.openTime !== ms('2026-06-16T02:15:00Z')),
      '1h',
      config(),
    )

    expect(after.periodsExpected).toBe(before.periodsExpected)
    expect(after.bars.length).toBe(before.bars.length - 1)
    expect(after.periodsRejectedForMissingConstituents).toBe(
      before.periodsRejectedForMissingConstituents + 1,
    )
  })
})

describe('aggregate - the constituent count comes from the calendar', () => {
  it('the daily break is EXCLUDED, so the 17:00 New York hour is not a period', () => {
    // Monday 21:00-22:00 UTC = 17:00-18:00 New York in EDT: the daily break.
    // The calendar expects nothing there, so no period exists - even though
    // four bars are supplied, which is what T1.5 counts as unexpected_bar.
    const supplied = bars('2026-06-15T21:00:00Z', '2026-06-15T22:00:00Z')
    const r = aggregate(supplied, '1h', config())

    expect(r.bars).toEqual([])
    expect(r.periodsExpected).toBe(0)
    expect(r.unexpectedBarsExcluded).toBe(4)
  })

  it('a SHORT session is not satisfied by a full count, nor a full one by fewer', () => {
    // The invariant stated as a test. An early close on the Tuesday session
    // shortens the day; a rule of "96 bars make a day" would reject the short
    // day and, worse, accept a normal day that was missing the same number.
    const holidays: readonly Holiday[] = [
      { holidayDate: '2026-06-16', closureType: 'early_close', localClose: '12:00:00' },
    ]
    const full = aggregate(
      bars('2026-06-15T22:00:00Z', '2026-06-16T22:00:00Z'),
      '1D',
      config(RULES, NO_HOLIDAYS),
    )
    const short = aggregate(
      bars('2026-06-15T22:00:00Z', '2026-06-16T22:00:00Z'),
      '1D',
      config(RULES, holidays),
    )

    expect(full.bars).toHaveLength(1)
    expect(short.bars).toHaveLength(1)
    // Both complete, and the counts DIFFER - the calendar decided each.
    expect(short.bars[0]!.constituentCount).toBeLessThan(full.bars[0]!.constituentCount)
  })
})

describe('aggregate - 1D on the session boundary', () => {
  it('a session day opens 18:00 New York and is keyed to the day it opens', () => {
    // 2026-06-15 22:00Z is 18:00 EDT: the Tuesday session begins.
    const r = aggregate(bars('2026-06-15T22:00:00Z', '2026-06-16T21:00:00Z'), '1D', config())

    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.openTime).toBe(ms('2026-06-15T22:00:00Z'))
    // 18:00 to 17:00 next day, break excluded: 23 hours of bars.
    expect(r.bars[0]!.constituentCount).toBe(92)
  })

  it('IANA zone, not a fixed offset: the same local 18:00 is 21:00Z under EST', () => {
    // January - EST, UTC-5. The session opens at 23:00Z, not 22:00Z. A fixed
    // -4 offset would put the boundary an hour out and silently reshape the day.
    const r = aggregate(bars('2026-01-12T23:00:00Z', '2026-01-13T22:00:00Z'), '1D', config())

    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.openTime).toBe(ms('2026-01-12T23:00:00Z'))
    expect(r.bars[0]!.constituentCount).toBe(92)
  })

  it('weekly alignment comes from weekly_open, not calendar Sunday', () => {
    // Sunday 2026-06-14. Calendar Sunday starts 00:00Z; the market opens
    // 22:00Z. A calendar-Sunday boundary would open the week 22 hours early and
    // find nothing there.
    const r = aggregate(bars('2026-06-14T22:00:00Z', '2026-06-15T21:00:00Z'), '1D', config())

    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.openTime).toBe(ms('2026-06-14T22:00:00Z'))
  })
})

/**
 * DST, all four transitions.
 *
 * WHAT IS MEASURED AND WHAT IS REASONED, kept apart:
 *
 * The US transitions fall INSIDE the weekend closure for every one of the 13
 * transitions in the stored range - OQ-16 confirmed that against real bars, and
 * `expected-grid.test.ts` carries that measurement. So the US cases here assert
 * that the SESSION BOUNDARY tracks the offset change, which is what aggregation
 * depends on, rather than re-asserting a bar count already covered elsewhere.
 *
 * **THE AUTUMN DOUBLED HOUR IN THE 24/7 ERA IS REASONED, NOT MEASURED.** In the
 * continuous era a session spans 02:00 local and the autumn transition makes
 * 01:00-02:00 happen twice, so the day holds 100 fifteen-minute slots rather
 * than 96. The next such transition is 2026-11-01, which is PAST THE END OF THE
 * STORED DATA (2026-09-05). Nothing has ever observed one. These assertions
 * follow from the generator's construction and are labelled so that a future
 * session does not mistake them for evidence.
 */
describe('aggregate - DST', () => {
  it('US spring forward: the session boundary follows the offset, EST to EDT', () => {
    // 2026-03-08. Before: 18:00 EST = 23:00Z. After: 18:00 EDT = 22:00Z.
    const before = aggregate(bars('2026-03-05T23:00:00Z', '2026-03-06T22:00:00Z'), '1D', config())
    const after = aggregate(bars('2026-03-09T22:00:00Z', '2026-03-10T21:00:00Z'), '1D', config())

    expect(before.bars).toHaveLength(1)
    expect(after.bars).toHaveLength(1)
    expect(before.bars[0]!.openTime).toBe(ms('2026-03-05T23:00:00Z'))
    expect(after.bars[0]!.openTime).toBe(ms('2026-03-09T22:00:00Z'))
    // Both are ordinary 23-hour sessions; only the UTC instant moved.
    expect(before.bars[0]!.constituentCount).toBe(92)
    expect(after.bars[0]!.constituentCount).toBe(92)
  })

  it('US fall back: the session boundary follows the offset, EDT to EST', () => {
    // 2025-11-02. Before: 18:00 EDT = 22:00Z. After: 18:00 EST = 23:00Z.
    const before = aggregate(bars('2025-10-29T22:00:00Z', '2025-10-30T21:00:00Z'), '1D', config())
    const after = aggregate(bars('2025-11-04T23:00:00Z', '2025-11-05T22:00:00Z'), '1D', config())

    expect(before.bars[0]!.openTime).toBe(ms('2025-10-29T22:00:00Z'))
    expect(after.bars[0]!.openTime).toBe(ms('2025-11-04T23:00:00Z'))
    expect(before.bars[0]!.constituentCount).toBe(92)
    expect(after.bars[0]!.constituentCount).toBe(92)
  })

  it('UK spring forward: a London-zoned calendar tracks GMT to BST', () => {
    // 2026-03-29. A UK-zoned session, asserted independently because the US and
    // UK transitions are three weeks apart and a zone hard-coded to New York
    // would pass every US case above while being wrong here.
    const ukRules: readonly SessionRule[] = [
      rule(1, 'weekly_open', 7, '18:00:00', null, UK),
      rule(6, 'weekly_close', 5, '17:00:00', null, UK),
    ]
    // Before: 18:00 GMT = 18:00Z. After: 18:00 BST = 17:00Z.
    const before = aggregate(
      bars('2026-03-25T18:00:00Z', '2026-03-26T18:00:00Z'),
      '1D',
      config(ukRules),
    )
    const after = aggregate(
      bars('2026-03-31T17:00:00Z', '2026-04-01T17:00:00Z'),
      '1D',
      config(ukRules),
    )

    expect(before.bars[0]!.openTime).toBe(ms('2026-03-25T18:00:00Z'))
    expect(after.bars[0]!.openTime).toBe(ms('2026-03-31T17:00:00Z'))
    // These UK rules carry no daily_break, so a session day is a full 24 hours
    // either side of the transition - the OFFSET moved, the length did not.
    expect(before.bars[0]!.constituentCount).toBe(96)
    expect(after.bars[0]!.constituentCount).toBe(96)
  })

  it('UK fall back: a London-zoned calendar tracks BST to GMT', () => {
    // 2025-10-26.
    const ukRules: readonly SessionRule[] = [
      rule(1, 'weekly_open', 7, '18:00:00', null, UK),
      rule(6, 'weekly_close', 5, '17:00:00', null, UK),
    ]
    const before = aggregate(
      bars('2025-10-22T17:00:00Z', '2025-10-23T17:00:00Z'),
      '1D',
      config(ukRules),
    )
    const after = aggregate(
      bars('2025-10-29T18:00:00Z', '2025-10-30T18:00:00Z'),
      '1D',
      config(ukRules),
    )

    expect(before.bars[0]!.openTime).toBe(ms('2025-10-22T17:00:00Z'))
    expect(after.bars[0]!.openTime).toBe(ms('2025-10-29T18:00:00Z'))
    expect(before.bars[0]!.constituentCount).toBe(96)
    expect(after.bars[0]!.constituentCount).toBe(96)
  })

  it('REASONED, NOT MEASURED: the 24/7 autumn doubled hour gives a 100-slot day', () => {
    // 2026-11-01, past the stored data (2026-09-05). Nothing has observed this.
    // In the continuous era the session spans 02:00 local, and 01:00-02:00
    // happens twice - 100 slots, not 96. A local-time generator returns 96 and
    // emits one 01:30 where there are two.
    const r = aggregate(
      bars('2026-10-31T22:00:00Z', '2026-11-01T23:00:00Z'),
      '1D',
      config(RULES_247),
    )

    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.constituentCount).toBe(100)
  })

  it('REASONED, NOT MEASURED: the 24/7 spring lost hour gives a 92-slot day', () => {
    // 2026-03-08, the mirror of the case above. Asserted as a pair so that a
    // generator stuck on 96 fails both rather than only one.
    const r = aggregate(
      bars('2026-03-07T23:00:00Z', '2026-03-08T22:00:00Z'),
      '1D',
      config(RULES_247),
    )

    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.constituentCount).toBe(92)
  })
})

describe('aggregate - the era change', () => {
  it('spans the 2025 era change without a rule that switches at a date', () => {
    // Input crossing a weekend under the weekday-only rules: the closure is
    // simply not a period, and the sessions either side are ordinary.
    const r = aggregate(bars('2026-06-12T20:00:00Z', '2026-06-15T22:00:00Z'), '1h', config())

    // Friday 17:00 NY (21:00Z) closes the week; Sunday 18:00 NY (22:00Z) opens
    // it. Nothing between is a period.
    const openTimes = r.bars.map((b) => b.openTime)
    expect(openTimes).toContain(ms('2026-06-12T20:00:00Z'))
    expect(openTimes).not.toContain(ms('2026-06-13T12:00:00Z'))
    expect(r.periodsExpected).toBe(r.bars.length + r.periodsRejectedForMissingConstituents)
  })

  it('the 24/7 calendar makes the weekend a session, and the weekday one does not', () => {
    const weekend = bars('2026-06-13T00:00:00Z', '2026-06-13T04:00:00Z')
    const closed = aggregate(weekend, '1h', config())
    const open = aggregate(weekend, '1h', config(RULES_247))

    expect(closed.bars).toHaveLength(0)
    expect(closed.periodsExpected).toBe(0)
    expect(open.bars).toHaveLength(4)
  })
})

describe('aggregate - reported costs', () => {
  it('reports one expectsBarAt call per 15M slot, which FALSIFIES OQ-21', () => {
    // OQ-21 predicted under 4,000 calls for a full run, reasoning that a
    // session boundary is a property of a day. It is - but the REQUIRED
    // CONSTITUENT COUNT is a property of every slot, and that is the invariant
    // that wins. Asserted rather than described so the shape cannot drift
    // silently.
    //
    // 4 hours of input = 16 slots, plus a one-hour pad at each end (4 slots
    // each) so that the first and last periods are asked about in full. The
    // pad is what fixed a real defect: without it a single bar defined its own
    // required set and satisfied it.
    const r = aggregate(bars('2026-06-16T00:00:00Z', '2026-06-16T04:00:00Z'), '1h', config())
    expect(r.expectsBarAtCalls).toBe(24)
  })

  it('counts unexpected bars rather than silently folding them into a price', () => {
    const inSession = bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z')
    const inBreak = bars('2026-06-15T21:00:00Z', '2026-06-15T21:30:00Z')
    const r = aggregate([...inBreak, ...inSession], '1h', config())

    expect(r.unexpectedBarsExcluded).toBe(2)
    expect(r.bars).toHaveLength(1)
    expect(r.bars[0]!.constituentCount).toBe(4)
  })
})

describe('aggregate - volume', () => {
  it('sums volumes when every constituent has one', () => {
    const four = bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z', { volume: '25' })
    const r = aggregate(four, '1h', config())
    expect(r.bars[0]!.volume).toBe('100')
  })

  it('null propagates - 0 and "not supplied" are different facts', () => {
    const four = bars('2026-06-16T00:00:00Z', '2026-06-16T01:00:00Z', { volume: '25' }).map((b) =>
      b.openTime === ms('2026-06-16T00:30:00Z') ? { ...b, volume: null } : b,
    )
    const r = aggregate(four, '1h', config())
    expect(r.bars[0]!.volume).toBeNull()
  })
})
