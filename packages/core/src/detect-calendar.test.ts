import { describe, expect, it } from 'vitest'

import { type Holiday, type SessionRule } from './calendar'
import { basisOf, canonicalisePayload, scanCalendar } from './detect-calendar'

const NY = 'America/New_York'
const rule = (
  id: number,
  ruleType: SessionRule['ruleType'],
  dayOfWeek: number,
  localStart: string,
  localEnd: string | null,
): SessionRule => ({
  id,
  ruleType,
  dayOfWeek,
  localStart,
  localEnd,
  timezone: NY,
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
const NONE: readonly Holiday[] = []
const ms = (iso: string) => Date.parse(iso)

describe('scanCalendar', () => {
  /** Wednesday 2026-04-01, a full open day, 15min. */
  const from = ms('2026-04-01T12:00:00Z')
  const to = ms('2026-04-01T16:00:00Z')

  it('reports nothing when every expected bar is present', () => {
    const stored: number[] = []
    for (let at = from; at < to; at += 900_000) stored.push(at)
    const scan = scanCalendar(RULES, NONE, '15min', from, to, stored)
    expect(scan.missing).toHaveLength(0)
    expect(scan.unexpected).toHaveLength(0)
    expect(scan.scanned).toBe(16)
    expect(scan.expectedOpen).toBe(16)
  })

  it('reports a missing bar when one expected instant has no bar', () => {
    const stored: number[] = []
    for (let at = from; at < to; at += 900_000) if (at !== from + 900_000) stored.push(at)
    const scan = scanCalendar(RULES, NONE, '15min', from, to, stored)
    expect(scan.missing).toEqual([from + 900_000])
    expect(scan.unexpected).toHaveLength(0)
  })

  /**
   * Saturday: the calendar says closed, so a stored bar is unexpected and
   * NOTHING is missing - the two detectors must not both fire on one instant.
   */
  it('reports an unexpected bar inside the weekly closure', () => {
    const sat = ms('2026-04-04T12:00:00Z')
    const scan = scanCalendar(RULES, NONE, '15min', sat, sat + 900_000, [sat])
    expect(scan.unexpected).toEqual([{ openTimeMs: sat, window: 'weekly_closure' }])
    expect(scan.missing).toHaveLength(0)
  })

  /**
   * THE SPLIT MATTERS, NOT JUST THE TOTAL. The recorded baseline is a sum of
   * two windows - 9,645 weekly-closure and 1,168 daily-break - so a total that
   * matched while the classification was wrong would look like a pass.
   */
  it('classifies a break bar as daily_break, not weekly_closure', () => {
    const tue1730 = ms('2026-03-31T21:30:00Z') // Tue 17:30 NY
    const scan = scanCalendar(RULES, NONE, '15min', tue1730, tue1730 + 900_000, [tue1730])
    expect(scan.unexpected).toEqual([{ openTimeMs: tue1730, window: 'daily_break' }])
  })

  describe('unknown is a third outcome and never becomes a finding', () => {
    /**
     * A stored bar the calendar cannot answer for is NOT unexpected. Calling it
     * one would manufacture events out of an incomplete calendar - and the
     * count of unknowns is the symptom that the calendar is incomplete.
     */
    it('does not report a stored bar at an uncovered instant as unexpected', () => {
      const before = ms('2019-06-05T12:00:00Z')
      const scan = scanCalendar(RULES, NONE, '15min', before, before + 900_000, [before])
      expect(scan.unexpected).toHaveLength(0)
      expect(scan.unknownStored).toEqual([before])
    })

    it('does not report uncovered instants as missing', () => {
      const before = ms('2019-06-05T12:00:00Z')
      const scan = scanCalendar(RULES, NONE, '15min', before, before + 900_000, [])
      expect(scan.missing).toHaveLength(0)
      expect(scan.unknownExpected).toEqual([before])
    })
  })
})

describe('basisOf - the caveat as data', () => {
  it('carries the rule ids, the migration and the provenance sentence', () => {
    const basis = basisOf(RULES)
    expect(basis.rule_ids).toEqual([1, 2, 3, 4, 5, 6])
    expect(basis.calendar_migration).toBe('0004_calendar_measured_against_twelve_data')
    expect(basis.note).toMatch(/SELF-CONSISTENCY, NOT CORRECTNESS/)
  })

  /**
   * THE HASH DEPENDS ON THIS. Anything varying per run turns every re-run into
   * a fresh row instead of an increment, which is the exact failure the
   * idempotency proof exists to catch.
   */
  it('is deterministic across calls', () => {
    expect(canonicalisePayload(basisOf(RULES))).toBe(canonicalisePayload(basisOf(RULES)))
  })
})

describe('canonicalisePayload', () => {
  it('sorts keys at every level', () => {
    expect(canonicalisePayload({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  /**
   * The NUMERIC(12,5) trap: the provider's `4375.5959` comes back padded as
   * `4375.59590`. Same number, different string. Hashing the raw text would
   * make every re-detection a new event and the table would grow without
   * bound while reporting nothing new.
   */
  it('strips trailing fractional zeros so padded and unpadded agree', () => {
    expect(canonicalisePayload({ p: '4375.59590' })).toBe(canonicalisePayload({ p: '4375.5959' }))
    expect(canonicalisePayload({ p: '4375.00000' })).toBe(canonicalisePayload({ p: '4375' }))
  })

  /**
   * PURE STRING WORK, NEVER `Number()`. This value does not survive float64 -
   * parsing it would destroy exactly the precision ADR-008 preserves.
   */
  it('preserves precision beyond float64', () => {
    expect(canonicalisePayload({ p: '4600.123456789012345' })).toBe('{"p":"4600.123456789012345"}')
    expect(canonicalisePayload({ p: '4600.1234567890123450' })).toBe('{"p":"4600.123456789012345"}')
  })

  it('leaves non-numeric strings alone', () => {
    expect(canonicalisePayload({ s: 'weekly_closure' })).toBe('{"s":"weekly_closure"}')
    // Trailing zeros in a non-decimal string are not fractional zeros.
    expect(canonicalisePayload({ s: '100' })).toBe('{"s":"100"}')
  })

  it('refuses a non-finite number rather than hashing NaN', () => {
    expect(() => canonicalisePayload({ n: Number.NaN })).toThrow(/non-finite/)
  })
})
