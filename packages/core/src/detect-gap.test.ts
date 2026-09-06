import { describe, expect, it } from 'vitest'

import { ATR_MULTIPLIER, ATR_PERIOD, scanGaps, type GapBar } from './detect-gap'

const MIN = 900_000
const never = () => false

/** A run of flat bars: range 1.00 each, close unchanged. ATR settles at 1. */
const flatRun = (count: number, close = '4600.00000'): GapBar[] =>
  Array.from({ length: count }, (_, i) => ({
    openTimeMs: i * MIN,
    high: '4600.50000',
    low: '4599.50000',
    close,
  }))

describe('scanGaps', () => {
  describe('the warmup is COUNTED, never silently skipped', () => {
    /**
     * The whole reason `unscannable` is a returned number rather than an
     * internal `continue`: a detector that declines to examine bars while
     * reporting a finding count is claiming a scan it never performed.
     */
    it('reports the first ATR_PERIOD bars of a run as unscannable', () => {
      const scan = scanGaps([flatRun(20)], never)
      expect(scan.unscannable).toBe(ATR_PERIOD)
      expect(scan.examined).toBe(20 - ATR_PERIOD)
    })

    it('counts the warmup once PER RUN, not once overall', () => {
      const scan = scanGaps([flatRun(20), flatRun(20), flatRun(20)], never)
      expect(scan.unscannable).toBe(3 * ATR_PERIOD)
    })

    it('reports a run shorter than the window as entirely unscannable', () => {
      const scan = scanGaps([flatRun(5)], never)
      expect(scan.unscannable).toBe(5)
      expect(scan.examined).toBe(0)
      expect(scan.findings).toHaveLength(0)
    })
  })

  describe('the threshold', () => {
    /** ATR is 1.00 after the warmup, so 8 x ATR is 8.00. */
    const withFinalMove = (moveTo: string): GapBar[] => {
      const run = flatRun(20)
      run.push({
        openTimeMs: 20 * MIN,
        high: moveTo,
        low: '4600.00000',
        close: moveTo,
      })
      return run
    }

    it('does not fire at exactly 8 x ATR - the comparison is strict', () => {
      const scan = scanGaps([withFinalMove('4608.00000')], never)
      expect(scan.findings).toHaveLength(0)
    })

    it('fires just above 8 x ATR', () => {
      const scan = scanGaps([withFinalMove('4608.00001')], never)
      expect(scan.findings).toHaveLength(1)
      expect(scan.findings[0]!.atr).toBe('1')
    })

    /**
     * THE POSITIVE CONTROL FOR THE PAIR ABOVE. Both assert behaviour at 8x; a
     * detector that never fired would pass the first and a detector that always
     * fired would pass the second. This pins the middle.
     */
    it('does not fire on an ordinary move well inside the threshold', () => {
      const scan = scanGaps([withFinalMove('4602.00000')], never)
      expect(scan.findings).toHaveLength(0)
      expect(scan.examined).toBe(7)
    })

    it('fires on a move DOWN as well as up', () => {
      const scan = scanGaps([withFinalMove('4591.00000')], never)
      expect(scan.findings).toHaveLength(1)
    })
  })

  describe('boundary crossings are excluded and counted separately', () => {
    /**
     * The gap across a closure IS the closure. Counting it as a price event
     * would put a finding on all ~345 weekly opens - and OQ-17 predicts around
     * 60 findings total, so the artefact would be six times the signal.
     */
    it('skips the comparison and counts it when the bars straddle a closure', () => {
      const run = flatRun(20)
      run.push({
        openTimeMs: 20 * MIN,
        high: '4700.00000',
        low: '4600.00000',
        close: '4700.00000',
      })
      const scan = scanGaps([run], (prev) => prev === 19 * MIN)
      expect(scan.findings).toHaveLength(0)
      expect(scan.boundaryCrossings).toBe(1)
    })
  })

  describe('prices stay exact', () => {
    /**
     * ADR-008 keeps precision float64 destroys. ATR is a ratio against a
     * threshold rather than a stored value, so it is computed in a scaled
     * INTEGER domain - never parsed to a float.
     */
    it('refuses a price with more precision than NUMERIC(12,5) can hold', () => {
      const run = flatRun(20)
      run.push({
        openTimeMs: 20 * MIN,
        high: '4600.123456789012345',
        low: '4600.00000',
        close: '4600.123456789012345',
      })
      expect(() => scanGaps([run], never)).toThrow(/losing precision/)
    })

    it('handles the padding NUMERIC(12,5) applies', () => {
      const scan = scanGaps([flatRun(20, '4600.00000')], never)
      expect(scan.findings).toHaveLength(0)
    })
  })

  describe('a zero ATR is unscannable, not infinitely sensitive', () => {
    /**
     * Fourteen bars with no range at all would make 8 x ATR zero, and then
     * EVERY subsequent move exceeds it. That is a division-by-zero dressed as a
     * finding, so those bars are counted as unscannable instead.
     */
    it('does not flag every bar when the trailing window has no range', () => {
      const run: GapBar[] = Array.from({ length: 20 }, (_, i) => ({
        openTimeMs: i * MIN,
        high: '4600.00000',
        low: '4600.00000',
        close: '4600.00000',
      }))
      run.push({
        openTimeMs: 20 * MIN,
        high: '4600.10000',
        low: '4600.00000',
        close: '4600.10000',
      })
      const scan = scanGaps([run], never)
      expect(scan.findings).toHaveLength(0)
      expect(scan.unscannable).toBeGreaterThan(ATR_PERIOD)
    })
  })

  it('exposes the constants it was fixed with', () => {
    expect(ATR_PERIOD).toBe(14)
    expect(ATR_MULTIPLIER).toBe(8)
  })
})
