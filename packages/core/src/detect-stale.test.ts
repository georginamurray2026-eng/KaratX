import { describe, expect, it } from 'vitest'

import { type Holiday, type SessionRule } from './calendar'
import { detectStaleFeed, STALE_GRACE_BARS } from './detect-stale'

/**
 * EVERY INSTANT HERE IS FIXED AND NAMED. Nothing reads the real clock, in the
 * function or in the test. A time-dependent test that passes today is the shape
 * that fails at 3am on a Sunday - and this detector's subject IS elapsed time,
 * against a calendar with a weekend in it, so that failure would be seasonal
 * and baffling.
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
const NONE: readonly Holiday[] = []
const STEP = 900_000
const at = (iso: string) => Date.parse(iso)

const detect = (lastBarIso: string, nowIso: string) =>
  detectStaleFeed(RULES, NONE, '15min', STEP, at(lastBarIso), at(nowIso))

// Wednesday 2026-04-01 is an ordinary open session in New York.
const WED_12_00Z = '2026-04-01T12:00:00Z'

describe('detectStaleFeed', () => {
  /**
   * THE POSITIVE CONTROL, AND THE ONLY REASON THE STALE CASE PROVES ANYTHING.
   *
   * The live run is predicted to emit exactly one row, which a detector that
   * emitted one row unconditionally would also do. These cases are what
   * separate the two: the SAME code path, a frontier that is current, and the
   * answer is null.
   */
  describe('NOT stale — the control', () => {
    it('is not stale when the last bar is the one just closed', () => {
      expect(detect(WED_12_00Z, '2026-04-01T12:15:00Z')).toBeNull()
    })

    it('is not stale inside the grace window', () => {
      // Two expected bars absent, and the grace is two.
      expect(detect(WED_12_00Z, '2026-04-01T12:45:00Z')).toBeNull()
    })

    it('is not stale when now precedes the last bar', () => {
      expect(detect(WED_12_00Z, '2026-04-01T11:00:00Z')).toBeNull()
    })

    /**
     * A FEED IS NOT STALE FOR FAILING TO DELIVER A WEEKEND. Friday 17:00 NY to
     * Sunday 18:00 NY is 49 hours with no expected bar, so an entire weekend
     * passes without staleness - which is the case that would otherwise fire
     * every Saturday, for ever.
     */
    it('is not stale across the whole weekend closure', () => {
      // Last bar Friday 16:45 NY; now Saturday midday. 43 hours of silence.
      expect(detect('2026-04-03T20:45:00Z', '2026-04-04T16:00:00Z')).toBeNull()
    })

    it('is not stale across a daily break', () => {
      // Last bar Tue 16:45 NY, now Tue 17:45 NY - the break, nothing expected.
      expect(detect('2026-03-31T20:45:00Z', '2026-03-31T21:45:00Z')).toBeNull()
    })

    /**
     * An uncovered date cannot support the claim that a bar was expected, so
     * `unknown` never contributes to staleness.
     */
    it('is not stale over instants the calendar cannot answer for', () => {
      expect(detect('2019-06-05T12:00:00Z', '2019-06-05T20:00:00Z')).toBeNull()
    })
  })

  describe('stale', () => {
    it('fires once the grace window is exceeded', () => {
      const found = detect(WED_12_00Z, '2026-04-01T13:00:00Z')
      expect(found).not.toBeNull()
      expect(found!.absentBars).toBe(STALE_GRACE_BARS + 1)
    })

    /**
     * `occurred_at` IS THE FIRST EXPECTED-AND-ABSENT BAR - not the last that
     * arrived, and not now.
     */
    it('anchors occurred_at to the first absent bar', () => {
      const found = detect(WED_12_00Z, '2026-04-01T14:00:00Z')
      expect(new Date(found!.occurredAtMs).toISOString()).toBe('2026-04-01T12:15:00.000Z')
      expect(found!.lastBarMs).toBe(at(WED_12_00Z))
    })

    /**
     * THE IDEMPOTENCY PROPERTY, AND THE WHOLE REASON FOR THE RULE.
     *
     * While the frontier does not move, `occurred_at` must not move either -
     * however much later the check runs. If it drifted, the payload would
     * change, the hash would change, and every poll would write a NEW ROW
     * rather than incrementing one. The table would fill with one event per
     * check while reporting nothing new.
     */
    it('holds occurred_at IDENTICAL across checks hours apart', () => {
      const first = detect(WED_12_00Z, '2026-04-01T14:00:00Z')
      const later = detect(WED_12_00Z, '2026-04-01T19:00:00Z')
      const muchLater = detect(WED_12_00Z, '2026-04-02T14:00:00Z')

      expect(first!.occurredAtMs).toBe(later!.occurredAtMs)
      expect(first!.occurredAtMs).toBe(muchLater!.occurredAtMs)
      expect(first!.lastBarMs).toBe(muchLater!.lastBarMs)
    })

    /**
     * The counterpart: `absentBars` DOES move, which is why it must never
     * enter the payload. Asserted so that anyone tempted to hash it sees the
     * property stated rather than discovering it in production.
     */
    it('lets absentBars grow — which is why it is NOT hashed', () => {
      const first = detect(WED_12_00Z, '2026-04-01T14:00:00Z')
      const later = detect(WED_12_00Z, '2026-04-01T19:00:00Z')
      expect(later!.absentBars).toBeGreaterThan(first!.absentBars)
    })

    /**
     * Staleness that begins before a weekend keeps its original anchor rather
     * than restarting at the Sunday open.
     */
    it('keeps the anchor when the outage spans a weekend', () => {
      const found = detect('2026-04-01T12:00:00Z', '2026-04-07T12:00:00Z')
      expect(new Date(found!.occurredAtMs).toISOString()).toBe('2026-04-01T12:15:00.000Z')
    })
  })

  it('reads no clock — identical arguments give identical answers', () => {
    const a = detect(WED_12_00Z, '2026-04-01T14:00:00Z')
    const b = detect(WED_12_00Z, '2026-04-01T14:00:00Z')
    expect(a).toEqual(b)
  })
})
