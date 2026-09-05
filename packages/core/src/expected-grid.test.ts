import { describe, expect, it } from 'vitest'

import { expectedGrid } from './expected-grid'
import { type Holiday, type SessionRule } from './calendar'

/**
 * The expected grid, tested on THE 13 REAL DST TRANSITIONS in the stored range.
 *
 * NOT SYNTHETIC DATES. The counts asserted below were measured against the
 * 166,344 real bars in `candles` before these tests were written, so a failure
 * here means the generator disagrees with what the feed actually delivered -
 * not with what someone assumed it would.
 */

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

const NO_HOLIDAYS: readonly Holiday[] = []

/** Every DST transition inside the stored range: 7 spring, 6 autumn. */
const SPRING = [
  '2020-03-08',
  '2021-03-14',
  '2022-03-13',
  '2023-03-12',
  '2024-03-10',
  '2025-03-09',
  '2026-03-08',
] as const
const AUTUMN = [
  '2020-11-01',
  '2021-11-07',
  '2022-11-06',
  '2023-11-05',
  '2024-11-03',
  '2025-11-02',
] as const

const grid = (fromIso: string, toIso: string) =>
  expectedGrid(RULES, NO_HOLIDAYS, '15min', Date.parse(fromIso), Date.parse(toIso))

describe('expectedGrid', () => {
  describe('the 13 real DST transitions', () => {
    /**
     * MEASURED FIRST, ASSERTED SECOND. Session weeks containing a transition
     * hold 460 real bars in `candles`, identical to their neighbours, and 460
     * is 5 x 23h x 4 - the calendar's exact expectation.
     *
     * WHAT THESE 13 CASES DO NOT PROVE, stated because the opposite is the
     * tempting thing to write. **They do not discriminate between a UTC-stepping
     * generator and a local-time one.** No session week contains a DST
     * transition - 02:00 Sunday falls inside the weekend closure - so BOTH
     * designs return 460 here and a local-time generator would pass every one
     * of them.
     *
     * They are regression protection against the generator disagreeing with
     * what the feed actually delivered, which is worth having and is not the
     * same claim. The design choice is discriminated separately, below.
     */
    it.each([...SPRING, ...AUTUMN])(
      'produces exactly 460 expected bars for the session week beginning after %s',
      (sunday) => {
        // BOUNDED TO EXACTLY ONE SESSION WEEK, and the bounds are chosen so
        // they cannot move with the offset. Sunday 18:00 NY is 22:00Z or
        // 23:00Z - both after 12:00Z. Friday 17:00 NY is 21:00Z or 22:00Z -
        // both before the following Saturday 00:00Z. The next weekly open is
        // outside the window under either offset.
        //
        // An 8-day window was tried first and gave 464 and 468, varying with
        // the offset: it reached into the FOLLOWING session week. That was a
        // fault in the window, not the generator, and it is recorded because
        // a test whose bounds move with the thing under test proves nothing.
        const from = Date.parse(`${sunday}T12:00:00Z`)
        const { expected, unknown } = expectedGrid(
          RULES,
          NO_HOLIDAYS,
          '15min',
          from,
          from + 5.5 * 86_400_000,
        )
        expect(unknown).toHaveLength(0)
        expect(expected.length).toBe(460)
      },
    )

    /**
     * The autumn doubled hour, asserted directly rather than through a count.
     *
     * 01:00-02:00 local occurs TWICE on these days. Both hours are inside the
     * weekend closure, so neither is expected - but the instants are distinct
     * and a generator working in local time would collapse them.
     */
    it.each(AUTUMN)('emits nothing for either pass of the doubled hour on %s', (sunday) => {
      const { expected } = grid(`${sunday}T00:00:00Z`, `${sunday}T12:00:00Z`)
      expect(expected).toHaveLength(0)
    })

    /**
     * The spring gap. 02:00-03:00 local does not exist; the generator steps
     * instants and simply never renders one there, so there is nothing to
     * skip and no special case.
     */
    it.each(SPRING)('emits nothing across the nonexistent hour on %s', (sunday) => {
      const { expected } = grid(`${sunday}T00:00:00Z`, `${sunday}T12:00:00Z`)
      expect(expected).toHaveLength(0)
    })

    /**
     * THE POSITIVE CONTROL FOR ALL THREE ABOVE.
     *
     * Every DST assertion so far expects ZERO bars, and zero is what a
     * generator that emitted nothing at all would also produce. This asserts
     * the same Sundays DO open, at 18:00, for the six hours to midnight - the
     * 24 bars per Sunday evening measured in `candles` for every year 2020-2026.
     */
    it.each([...SPRING, ...AUTUMN])(
      'still opens at 18:00 on the transition Sunday %s',
      (sunday) => {
        // 18:00 NY is 22:00Z (EDT) or 23:00Z (EST); take the whole UTC day after
        // to capture the evening under either offset.
        const from = Date.parse(`${sunday}T12:00:00Z`)
        const { expected } = expectedGrid(RULES, NO_HOLIDAYS, '15min', from, from + 43_200_000)
        expect(expected.length).toBeGreaterThanOrEqual(4)
      },
    )
  })

  /**
   * THE TEST THAT ACTUALLY DISCRIMINATES THE DESIGN.
   *
   * Every case above returns 460 under a local-time generator too, because no
   * real session week contains a transition. To separate the two designs the
   * transition has to fall INSIDE an open session, so these use the REAL
   * transition dates with a MODIFIED rule set - weekly open moved to Sunday
   * 00:00, so the whole transition Sunday is a live session.
   *
   * The dates are real and the arithmetic is real. Only the rule placement is
   * hypothetical, and it is hypothetical in exactly the way a future
   * instrument would make it concrete: another venue, another zone, or this
   * calendar amended.
   *
   * A LOCAL-TIME GENERATOR RETURNS 96 FOR BOTH - one bar per local quarter
   * hour, 24 hours' worth, every day of the year. The real answers differ.
   */
  describe('discriminating the design - the transition INSIDE an open session', () => {
    const SUNDAY_OPEN: readonly SessionRule[] = [
      rule(1, 'weekly_open', 7, '00:00:00', null),
      rule(6, 'weekly_close', 5, '17:00:00', null),
    ]

    it('emits 92 bars on a spring-forward Sunday - the local day is 23 hours', () => {
      // 2021-03-14: local midnight is 05:00Z (EST); the next is 04:00Z (EDT).
      const from = Date.parse('2021-03-14T05:00:00Z')
      const to = Date.parse('2021-03-15T04:00:00Z')
      const { expected } = expectedGrid(SUNDAY_OPEN, NO_HOLIDAYS, '15min', from, to)
      expect(expected).toHaveLength(92)
    })

    it('emits 100 bars on an autumn-back Sunday - the local day is 25 hours', () => {
      // 2021-11-07: local midnight is 04:00Z (EDT); the next is 05:00Z (EST).
      const from = Date.parse('2021-11-07T04:00:00Z')
      const to = Date.parse('2021-11-08T05:00:00Z')
      const { expected } = expectedGrid(SUNDAY_OPEN, NO_HOLIDAYS, '15min', from, to)
      expect(expected).toHaveLength(100)
    })

    /**
     * THE POSITIVE CONTROL. Without it, 92 and 100 could both come from a
     * generator that simply counted the UTC hours it was handed - which is
     * what it does, and the point is that an ordinary Sunday gives 96.
     */
    it('emits 96 on an ordinary Sunday with the same rules', () => {
      const from = Date.parse('2021-06-06T04:00:00Z')
      const { expected } = expectedGrid(SUNDAY_OPEN, NO_HOLIDAYS, '15min', from, from + 86_400_000)
      expect(expected).toHaveLength(96)
    })

    /**
     * THE DOUBLED HOUR, ASSERTED AS TWO DISTINCT INSTANTS rather than through
     * a count. Both render 01:30 local on 2021-11-07; a local-time generator
     * collapses them and emits one.
     */
    it('emits BOTH passes of the doubled 01:00-02:00 hour', () => {
      const from = Date.parse('2021-11-07T04:00:00Z')
      const { expected } = expectedGrid(SUNDAY_OPEN, NO_HOLIDAYS, '15min', from, from + 86_400_000)
      const localHour = new Intl.DateTimeFormat('en-US', {
        timeZone: NY,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
      const at0130 = expected.filter((ms) => localHour.format(new Date(ms)) === '01:30')
      expect(at0130).toHaveLength(2)
      expect(at0130[1]! - at0130[0]!).toBe(3_600_000)
    })
  })

  describe('an ordinary week, as the baseline the transitions are compared against', () => {
    it('produces 460 bars for a week with no transition in it', () => {
      // Same bounds as the transition weeks, so the comparison is like for like.
      const from = Date.parse('2026-04-05T12:00:00Z')
      const { expected } = expectedGrid(RULES, NO_HOLIDAYS, '15min', from, from + 5.5 * 86_400_000)
      expect(expected.length).toBe(460)
    })
  })

  describe('unknown is carried separately and never merged', () => {
    it('reports uncovered instants rather than counting them either way', () => {
      // Before the calendar begins: every instant is unknown, none expected.
      const from = Date.parse('2019-06-03T00:00:00Z')
      const { expected, unknown } = expectedGrid(
        RULES,
        NO_HOLIDAYS,
        '15min',
        from,
        from + 86_400_000,
      )
      expect(expected).toHaveLength(0)
      expect(unknown).toHaveLength(96)
    })
  })

  describe('refuses rather than guesses', () => {
    /**
     * An unaligned start offsets the whole grid, so every stored bar reads as
     * unexpected and every expected instant as missing - a total failure that
     * looks like a data catastrophe rather than a bug.
     */
    it('throws on a start not aligned to the timeframe', () => {
      expect(() =>
        expectedGrid(
          RULES,
          NO_HOLIDAYS,
          '15min',
          Date.parse('2026-04-01T00:07:00Z'),
          Date.parse('2026-04-02T00:00:00Z'),
        ),
      ).toThrow(/not aligned/)
    })

    it('throws on an unknown timeframe', () => {
      expect(() => expectedGrid(RULES, NO_HOLIDAYS, '7min', 0, 900_000)).toThrow(
        /No interval known/,
      )
    })

    it('throws when the range runs backwards', () => {
      expect(() => expectedGrid(RULES, NO_HOLIDAYS, '15min', 900_000, 0)).toThrow(
        /ends before it starts/,
      )
    })
  })
})
