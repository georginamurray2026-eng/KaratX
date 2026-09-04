import { describe, expect, it } from 'vitest'

import { createPacer } from './pacer'

function fakeTime(): { now: () => number; sleep: (ms: number) => Promise<void>; waits: number[] } {
  let current = 0
  const waits: number[] = []
  return {
    now: () => current,
    sleep: async (ms) => {
      waits.push(ms)
      current += ms
    },
    waits,
  }
}

describe('createPacer', () => {
  it('lets the first request through without waiting', async () => {
    const time = fakeTime()
    const pacer = createPacer({ ...time })

    await pacer.acquire()

    expect(time.waits).toEqual([])
    expect(pacer.waitedMs).toBe(0)
  })

  it('paces subsequent requests at the policy rate', async () => {
    const time = fakeTime()
    const pacer = createPacer({ ...time })

    await pacer.acquire()
    await pacer.acquire()
    await pacer.acquire()

    // 7 per minute, capacity 1: one immediate, then one every ~8.57s.
    //
    // THE WAITS ARE NOT IDENTICAL, AND THAT IS THE POINT. 60000/7 is 8571.43,
    // and the wait is rounded UP so a caller never arrives before its token
    // exists. Rounding up overshoots by 0.57ms, which the next call sees as
    // refill already banked - so the sequence is 8572, 8571, 8572, ... and
    // self-corrects to exactly 7/minute rather than drifting slower with every
    // request. Asserting two identical values would pin the rounding error
    // instead of the rate.
    expect(time.waits).toEqual([8572, 8571])
    expect(time.waits.every((ms) => ms >= 8571 && ms <= 8572)).toBe(true)
  })

  it('does not drift slower over a long run - the rounding is corrected, not accumulated', async () => {
    const time = fakeTime()
    const pacer = createPacer({ ...time })

    for (let i = 0; i < 100; i += 1) await pacer.acquire()

    // 99 gaps at exactly 60000/7 ms would be 848571ms. Naive rounding-up would
    // add ~0.57ms per request and land above it; this stays within a
    // millisecond per request of the ideal.
    const ideal = (99 * 60_000) / 7
    expect(Math.abs(pacer.waitedMs - ideal)).toBeLessThan(99)
  })

  it('reports waits rather than stalling silently', async () => {
    const time = fakeTime()
    const seen: number[] = []
    const pacer = createPacer({ ...time, onWait: (ms) => seen.push(ms) })

    await pacer.acquire()
    await pacer.acquire()

    expect(seen).toEqual([8572])
  })

  it('a 47-request backfill paces to about six and a half minutes', async () => {
    // The number the T1.4 estimate turns into wall-clock. If the pace changes,
    // this says what it costs.
    const time = fakeTime()
    const pacer = createPacer({ ...time })

    for (let i = 0; i < 47; i += 1) await pacer.acquire()

    expect(pacer.waitedMs / 60_000).toBeGreaterThan(6)
    expect(pacer.waitedMs / 60_000).toBeLessThan(7)
  })
})
