import { describe, expect, it } from 'vitest'

import { expectsBarAt, type Holiday, type SessionRule } from './calendar'

/**
 * `expectsBarAt` - the three-valued answer everything else in T1.5 depends on.
 *
 * THE RULES BELOW ARE THE REAL ONES, copied from `market_hours` after migration
 * 0004 corrected them against Twelve Data. A test calendar invented for the
 * test would prove the arithmetic and nothing about the system.
 */

const NY = 'America/New_York'

const RULES: readonly SessionRule[] = [
  {
    id: 1,
    ruleType: 'weekly_open',
    dayOfWeek: 7,
    localStart: '18:00:00',
    localEnd: null,
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
  {
    id: 2,
    ruleType: 'daily_break',
    dayOfWeek: 1,
    localStart: '17:00:00',
    localEnd: '18:00:00',
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
  {
    id: 3,
    ruleType: 'daily_break',
    dayOfWeek: 2,
    localStart: '17:00:00',
    localEnd: '18:00:00',
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
  {
    id: 4,
    ruleType: 'daily_break',
    dayOfWeek: 3,
    localStart: '17:00:00',
    localEnd: '18:00:00',
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
  {
    id: 5,
    ruleType: 'daily_break',
    dayOfWeek: 4,
    localStart: '17:00:00',
    localEnd: '18:00:00',
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
  {
    id: 6,
    ruleType: 'weekly_close',
    dayOfWeek: 5,
    localStart: '17:00:00',
    localEnd: null,
    timezone: NY,
    effectiveFrom: '2020-01-24',
    effectiveTo: null,
  },
]

const at = (iso: string) => Date.parse(iso)
const expectation = (iso: string, holidays: readonly Holiday[] = []) =>
  expectsBarAt(RULES, holidays, at(iso))

describe('expectsBarAt', () => {
  describe('UNKNOWN is a distinct answer and never collapses to closed', () => {
    /**
     * The failure `market_hours` warns about: an empty calendar answering
     * "nothing expected" to every question, so every assertion passes and
     * there is no symptom. A boolean return could not express this.
     */
    it('answers unknown for an EMPTY calendar, not closed', () => {
      expect(expectsBarAt([], [], at('2026-04-01T12:00:00Z'))).toBe('unknown')
    })

    /**
     * Obligation 55's shape exactly: rows exist, all constraints are
     * satisfied, and nothing covers the date being asked about.
     */
    it('answers unknown when rules exist but none is in force', () => {
      const expired = RULES.map((rule) => ({ ...rule, effectiveTo: '2021-01-01' }))
      expect(expectsBarAt(expired, [], at('2026-04-01T12:00:00Z'))).toBe('unknown')
    })

    it('answers unknown BEFORE the calendar begins', () => {
      expect(expectation('2019-06-03T12:00:00Z')).toBe('unknown')
    })

    /**
     * A half-calendar does not describe a week. Answering `open` from the
     * breaks alone would be an assumption dressed as a fact.
     */
    it('answers unknown when the weekly boundaries are missing', () => {
      const breaksOnly = RULES.filter((rule) => rule.ruleType === 'daily_break')
      expect(expectsBarAt(breaksOnly, [], at('2026-04-01T12:00:00Z'))).toBe('unknown')
    })

    it('treats effective_to as EXCLUSIVE', () => {
      const closed = RULES.map((rule) => ({ ...rule, effectiveTo: '2026-04-02' }))
      // 2026-04-01 21:00Z is 17:00 NY on the 1st - the last covered local day.
      expect(expectsBarAt(closed, [], at('2026-04-01T15:00:00Z'))).not.toBe('unknown')
      expect(expectsBarAt(closed, [], at('2026-04-02T15:00:00Z'))).toBe('unknown')
    })
  })

  describe('the weekly session, which WRAPS the week boundary', () => {
    it('is open mid-week', () => {
      expect(expectation('2026-04-01T12:00:00Z')).toBe('open') // Wed 08:00 NY
    })

    it('is closed on Saturday', () => {
      expect(expectation('2026-04-04T12:00:00Z')).toBe('closed')
    })

    it('is closed Sunday MORNING and open Sunday EVENING', () => {
      expect(expectation('2026-04-05T12:00:00Z')).toBe('closed') // Sun 08:00 NY
      expect(expectation('2026-04-05T23:00:00Z')).toBe('open') // Sun 19:00 NY
    })

    /**
     * The boundary itself. `weekly_open` is inclusive and `weekly_close` is
     * exclusive, so the market is open AT 18:00 Sunday and closed AT 17:00
     * Friday - an off-by-one here shifts 345 weekly boundaries at once.
     */
    it('opens AT Sunday 18:00 and closes AT Friday 17:00', () => {
      expect(expectation('2026-04-05T21:59:00Z')).toBe('closed') // 17:59 NY
      expect(expectation('2026-04-05T22:00:00Z')).toBe('open') // 18:00 NY
      expect(expectation('2026-04-03T20:59:00Z')).toBe('open') // Fri 16:59 NY
      expect(expectation('2026-04-03T21:00:00Z')).toBe('closed') // Fri 17:00 NY
    })
  })

  describe('the daily break, which carves holes out of an open week', () => {
    it('is closed 17:00-18:00 Monday to Thursday', () => {
      expect(expectation('2026-03-31T21:30:00Z')).toBe('closed') // Tue 17:30 NY
    })

    it('is open either side of it', () => {
      expect(expectation('2026-03-31T20:59:00Z')).toBe('open') // Tue 16:59 NY
      expect(expectation('2026-03-31T22:00:00Z')).toBe('open') // Tue 18:00 NY
    })

    /**
     * Friday has NO break rule - it has a weekly close instead. A detector
     * that assumed five breaks would find one that does not exist.
     */
    it('has no Friday break, because Friday closes for the week', () => {
      expect(expectation('2026-04-03T21:30:00Z')).toBe('closed') // Fri 17:30, weekly
      expect(expectation('2026-04-03T23:00:00Z')).toBe('closed') // Fri 19:00, still weekly
    })
  })

  /**
   * PINNED AGAINST A TZDATA CHANGE.
   *
   * `Intl` resolves against the ICU data bundled with the runtime, and tzdata
   * revises HISTORICAL rules from time to time. This package cannot read
   * `process.versions.tz` to detect that - `process` is exactly what it may
   * not name - so these cases are the in-package alarm: each asserts a
   * conversion whose answer would MOVE if the historical rules changed.
   *
   * A failure here is not necessarily a bug in this file. It may mean the
   * runtime's view of 2020 has changed, which is itself the finding.
   */
  describe('DST, pinned', () => {
    it('holds the Friday close at 17:00 NY under BOTH offsets', () => {
      expect(expectation('2020-01-24T21:59:00Z')).toBe('open') // EST, 16:59
      expect(expectation('2020-01-24T22:00:00Z')).toBe('closed') // EST, 17:00
      expect(expectation('2020-07-24T20:59:00Z')).toBe('open') // EDT, 16:59
      expect(expectation('2020-07-24T21:00:00Z')).toBe('closed') // EDT, 17:00
    })

    it('holds the Sunday open at 18:00 NY under BOTH offsets', () => {
      expect(expectation('2020-01-26T22:59:00Z')).toBe('closed') // EST, 17:59
      expect(expectation('2020-01-26T23:00:00Z')).toBe('open') // EST, 18:00
      expect(expectation('2020-07-26T21:59:00Z')).toBe('closed') // EDT, 17:59
      expect(expectation('2020-07-26T22:00:00Z')).toBe('open') // EDT, 18:00
    })

    /**
     * The transition weekends themselves. Spring forward skips 02:00-03:00
     * local and autumn repeats 01:00-02:00; both happen on a Sunday MORNING,
     * when the market is closed - so they cannot move a boundary today. Pinned
     * anyway, because that is a fact about where the rules happen to sit and
     * not a property of the function.
     */
    it('is closed across both DST transitions, which fall on closed Sundays', () => {
      expect(expectation('2020-03-08T06:30:00Z')).toBe('closed') // 01:30 EST
      expect(expectation('2020-03-08T07:30:00Z')).toBe('closed') // 03:30 EDT
      expect(expectation('2020-11-01T05:30:00Z')).toBe('closed') // 01:30 EDT
      expect(expectation('2020-11-01T06:30:00Z')).toBe('closed') // 01:30 EST, repeated
    })
  })

  describe('holidays', () => {
    it('closes a full holiday that would otherwise be open', () => {
      expect(expectation('2026-04-01T12:00:00Z')).toBe('open')
      expect(
        expectation('2026-04-01T12:00:00Z', [
          { holidayDate: '2026-04-01', closureType: 'full', localClose: null },
        ]),
      ).toBe('closed')
    })

    it('closes an early_close only AFTER its local close', () => {
      const early: readonly Holiday[] = [
        { holidayDate: '2026-04-01', closureType: 'early_close', localClose: '13:00:00' },
      ]
      expect(expectation('2026-04-01T16:59:00Z', early)).toBe('open') // 12:59 NY
      expect(expectation('2026-04-01T17:00:00Z', early)).toBe('closed') // 13:00 NY
    })

    /**
     * The holiday date is a LOCAL date. A holiday matched against the UTC date
     * would close the wrong bars for the five hours the two disagree.
     */
    it('matches the holiday against the LOCAL date, not the UTC one', () => {
      const holidays: readonly Holiday[] = [
        { holidayDate: '2026-04-01', closureType: 'full', localClose: null },
      ]
      // 2026-04-02T01:00Z is still 2026-04-01 21:00 in New York.
      expect(expectation('2026-04-02T01:00:00Z', holidays)).toBe('closed')
      // 2026-04-02T14:00Z is 2026-04-02 10:00 NY - a different local day.
      expect(expectation('2026-04-02T14:00:00Z', holidays)).toBe('open')
    })
  })

  describe('refuses rather than guesses', () => {
    it('throws when rules span multiple time zones', () => {
      const mixed = [...RULES, { ...RULES[0]!, id: 99, timezone: 'Europe/London' }]
      expect(() => expectsBarAt(mixed, [], at('2026-04-01T12:00:00Z'))).toThrow(
        /multiple time zones/,
      )
    })

    it('throws on a rule time that is not a whole minute', () => {
      const odd = RULES.map((rule) =>
        rule.ruleType === 'weekly_open' ? { ...rule, localStart: '18:00:30' } : rule,
      )
      expect(() => expectsBarAt(odd, [], at('2026-04-01T12:00:00Z'))).toThrow(/whole minute/)
    })
  })
})
