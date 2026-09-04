import { describe, expect, it } from 'vitest'

import {
  initialBucket,
  takeToken,
  TWELVEDATA_FREE_TIER_PACE,
  type TokenBucketPolicy,
  type TokenBucketState,
} from './rate-limit'

const POLICY: TokenBucketPolicy = { capacity: 1, refillPerMinute: 60 } // one per second

describe('takeToken', () => {
  it('lets the first request through immediately', () => {
    const result = takeToken(initialBucket(POLICY, 0), POLICY, 0)
    expect(result.waitMs).toBe(0)
  })

  it('makes the second request wait for a token', () => {
    let state = initialBucket(POLICY, 0)
    state = takeToken(state, POLICY, 0).state

    expect(takeToken(state, POLICY, 0).waitMs).toBe(1_000)
  })

  it('lets a request through once enough time has passed', () => {
    let state = initialBucket(POLICY, 0)
    state = takeToken(state, POLICY, 0).state

    expect(takeToken(state, POLICY, 1_000).waitMs).toBe(0)
  })

  it('charges partial waits, so a caller half-way there waits only the remainder', () => {
    let state = initialBucket(POLICY, 0)
    state = takeToken(state, POLICY, 0).state

    expect(takeToken(state, POLICY, 600).waitMs).toBe(400)
  })

  it('does not accumulate credit beyond capacity while idle', () => {
    // Otherwise an hour of idleness buys an hour's worth of burst, and the
    // first thing the backfill does after a pause is trip the limit.
    let state = initialBucket(POLICY, 0)
    state = takeToken(state, POLICY, 0).state

    // One hour later: capacity is 1, so exactly one free request, then a wait.
    const first = takeToken(state, POLICY, 3_600_000)
    expect(first.waitMs).toBe(0)
    expect(takeToken(first.state, POLICY, 3_600_000).waitMs).toBe(1_000)
  })

  it('does not mint tokens when the clock goes backwards', () => {
    // NTP steps and suspend/resume both do this.
    let state = initialBucket(POLICY, 10_000)
    state = takeToken(state, POLICY, 10_000).state

    expect(takeToken(state, POLICY, 5_000).waitMs).toBe(1_000)
  })

  it('rounds the wait UP', () => {
    // Arriving a fraction of a millisecond early is the exact failure this
    // exists to prevent.
    const policy: TokenBucketPolicy = { capacity: 1, refillPerMinute: 7 }
    let state = initialBucket(policy, 0)
    state = takeToken(state, policy, 0).state

    const wait = takeToken(state, policy, 0).waitMs
    expect(wait).toBe(Math.ceil(60_000 / 7))
    expect(wait).toBe(8_572)
  })
})

describe('TWELVEDATA_FREE_TIER_PACE', () => {
  it('paces below the documented limit rather than at it', () => {
    // The 8/minute figure is VENDOR DOCUMENTATION and has never been tested
    // (OQ-1). One token of margin costs nothing on a 35-47 request run.
    expect(TWELVEDATA_FREE_TIER_PACE.refillPerMinute).toBeLessThan(8)
    expect(TWELVEDATA_FREE_TIER_PACE.refillPerMinute).toBe(7)
  })

  it('does not burst', () => {
    // A burst of 7 immediate requests is precisely what trips a per-minute
    // limiter, and a sequential page walk has no reason to want one.
    expect(TWELVEDATA_FREE_TIER_PACE.capacity).toBe(1)
  })

  it('a full backfill paces to roughly the estimated five minutes', () => {
    // Ties the pacer to the T1.4 estimate: 35-47 requests at 7/minute. If
    // someone changes the pace, this says what it costs.
    let state: TokenBucketState = initialBucket(TWELVEDATA_FREE_TIER_PACE, 0)
    let now = 0

    for (let request = 0; request < 47; request += 1) {
      const result = takeToken(state, TWELVEDATA_FREE_TIER_PACE, now)
      now += result.waitMs
      state = result.state
    }

    const minutes = now / 60_000
    expect(minutes).toBeGreaterThan(6)
    expect(minutes).toBeLessThan(7)
  })
})
