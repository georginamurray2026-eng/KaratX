import { describe, expect, it } from 'vitest'

import { DatabaseError, NetworkError, ProviderError, ValidationError } from './errors'
import {
  DEFAULT_RETRY_POLICY,
  describeStopReason,
  nextRetry,
  type RetryPolicy,
  type RetryInput,
} from './retry'

const retryable = new NetworkError('connection reset')

function decide(overrides: Partial<RetryInput> = {}): ReturnType<typeof nextRetry> {
  return nextRetry({ error: retryable, attempt: 1, elapsedMs: 0, random01: 0, ...overrides })
}

describe('obligation 5 - the retry POLICY from the error taxonomy is what decides', () => {
  it('retries errors whose policy is retry', () => {
    // These are the two the taxonomy classifies `retry`, and they are exactly
    // the ones a backfill meets: a rate limit and a dropped connection.
    expect(decide({ error: new NetworkError('reset') }).action).toBe('retry')
    expect(decide({ error: new ProviderError('429') }).action).toBe('retry')
  })

  it('refuses to retry a DatabaseError, whose policy is alert', () => {
    // Load-bearing rather than tidy. DatabaseError covers constraint
    // violations, and a 23505 retried is a 23505 repeated - six times, with
    // backoff, before failing anyway.
    const decision = decide({ error: new DatabaseError('duplicate key') })

    expect(decision).toEqual({ action: 'stop', reason: 'policy' })
  })

  it('refuses to retry a ValidationError, whose policy is quarantine', () => {
    // A malformed provider body is not transient. Retrying it re-downloads the
    // same malformed body.
    expect(decide({ error: new ValidationError('bad shape') })).toEqual({
      action: 'stop',
      reason: 'policy',
    })
  })

  it('honours an explicit policy override at the throw site', () => {
    // The taxonomy's escape hatch: a caller that KNOWS an error is transient
    // says so where the context is.
    const transient = new DatabaseError('connection terminated', { policy: 'retry' })

    expect(decide({ error: transient }).action).toBe('retry')
  })

  it('refuses to retry a plain Error', () => {
    // Unclassified means `unexpected`, which is not retryable. A bug does not
    // become correct on the second attempt.
    expect(decide({ error: new Error('boom') })).toEqual({ action: 'stop', reason: 'policy' })
  })
})

describe('§23 - the bound is three limits, and each is tested alone', () => {
  it('stops after maxAttempts', () => {
    expect(decide({ attempt: DEFAULT_RETRY_POLICY.maxAttempts })).toEqual({
      action: 'stop',
      reason: 'attempts',
    })
    expect(decide({ attempt: DEFAULT_RETRY_POLICY.maxAttempts - 1 }).action).toBe('retry')
  })

  it('stops when the NEXT WAIT would exceed the budget, not merely when elapsed does', () => {
    // Checked against elapsed + delay. Checking elapsed alone overshoots the
    // stated bound by up to one full maxDelayMs, so the documented budget
    // would not be the real one.
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, totalBudgetMs: 10_000 }

    // attempt 1, random01 0 -> delay 500ms. 9_600 + 500 > 10_000.
    expect(decide({ attempt: 1, elapsedMs: 9_600, random01: 0, policy })).toEqual({
      action: 'stop',
      reason: 'budget',
    })
    expect(decide({ attempt: 1, elapsedMs: 9_400, random01: 0, policy }).action).toBe('retry')
  })

  it('caps any single wait at maxDelayMs', () => {
    // Attempt 20 would otherwise ask for 2^19 seconds - about six days.
    const decision = decide({
      attempt: 20,
      random01: 1,
      policy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 100, totalBudgetMs: Number.MAX_SAFE_INTEGER },
    })

    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') {
      expect(decision.delayMs).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxDelayMs)
    }
  })

  it('never loops forever - every path from a retryable error terminates', () => {
    // The §23 property stated directly rather than implied by the three tests
    // above. Walks a full sequence and asserts it ends.
    let elapsed = 0
    let attempt = 1
    const seen: number[] = []

    for (;;) {
      const decision = nextRetry({ error: retryable, attempt, elapsedMs: elapsed, random01: 0.5 })
      if (decision.action === 'stop') break
      seen.push(decision.delayMs)
      elapsed += decision.delayMs
      attempt += 1
      expect(attempt, 'the sequence did not terminate').toBeLessThan(1000)
    }

    expect(seen.length).toBe(DEFAULT_RETRY_POLICY.maxAttempts - 1)
    expect(elapsed).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.totalBudgetMs)
  })
})

describe('backoff and jitter', () => {
  it('grows exponentially', () => {
    // random01 = 0 pins the floor of equal jitter: capped/2.
    const delays = [1, 2, 3, 4].map((attempt) => {
      const d = decide({ attempt, random01: 0 })
      return d.action === 'retry' ? d.delayMs : -1
    })

    expect(delays).toEqual([500, 1_000, 2_000, 4_000])
  })

  it('EQUAL jitter - a delay is never near zero', () => {
    // Full jitter can return ~0ms, which against a per-minute quota spends a
    // request to be refused again. The floor is what makes this a backoff.
    for (const random01 of [0, 0.01, 0.5, 0.99]) {
      const decision = decide({ attempt: 3, random01 })
      expect(decision.action).toBe('retry')
      if (decision.action === 'retry') {
        expect(decision.delayMs).toBeGreaterThanOrEqual(2_000)
        expect(decision.delayMs).toBeLessThanOrEqual(4_000)
      }
    }
  })

  it('THE PHASE LOCK - two runs with different randomness retry at different offsets', () => {
    // This is the property jitter actually buys with a SINGLE client, and the
    // reason it is not removable: with a fixed backoff every retry lands at the
    // same offset relative to our own pacer and therefore relative to the
    // provider's rate-limit window, whose boundary we cannot observe. A run
    // unlucky in that alignment stays unlucky, deterministically.
    const a = decide({ attempt: 3, random01: 0.1 })
    const b = decide({ attempt: 3, random01: 0.9 })

    expect(a.action).toBe('retry')
    expect(b.action).toBe('retry')
    if (a.action === 'retry' && b.action === 'retry') {
      expect(a.delayMs).not.toBe(b.delayMs)
      expect(Math.abs(a.delayMs - b.delayMs)).toBeGreaterThan(1_000)
    }
  })

  it('is deterministic given its inputs - no clock, no Math.random', () => {
    // What makes exhaustion testable without waiting fifteen real minutes.
    const first = decide({ attempt: 4, elapsedMs: 1234, random01: 0.37 })
    const second = decide({ attempt: 4, elapsedMs: 1234, random01: 0.37 })

    expect(first).toEqual(second)
  })
})

describe('Retry-After (UNVERIFIED for this provider - OQ-2)', () => {
  it('honours a server-supplied wait over the computed backoff', () => {
    const decision = decide({ attempt: 1, random01: 0, retryAfterMs: 17_000 })

    expect(decision).toEqual({ action: 'retry', delayMs: 17_000 })
  })

  it('adds jitter on top, because the boundary the server named is a fixed offset too', () => {
    const decision = decide({ attempt: 1, random01: 0.5, retryAfterMs: 17_000 })

    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') expect(decision.delayMs).toBe(17_500)
  })

  it('caps a wildly large Retry-After rather than stalling on it', () => {
    const decision = decide({ attempt: 1, random01: 0, retryAfterMs: 86_400_000 })

    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') expect(decision.delayMs).toBe(DEFAULT_RETRY_POLICY.maxDelayMs)
  })

  it('still respects the budget', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, totalBudgetMs: 10_000 }

    expect(decide({ attempt: 1, elapsedMs: 0, random01: 0, retryAfterMs: 17_000, policy })).toEqual(
      {
        action: 'stop',
        reason: 'budget',
      },
    )
  })
})

describe('describeStopReason - the message a stalled run leaves behind', () => {
  it('explains each reason in terms of the policy that produced it', () => {
    expect(describeStopReason('attempts', DEFAULT_RETRY_POLICY)).toBe('all 6 attempts were used')
    expect(describeStopReason('budget', DEFAULT_RETRY_POLICY)).toContain('900s retry budget')
    expect(describeStopReason('policy', DEFAULT_RETRY_POLICY)).toContain(
      'not classified as retryable',
    )
  })
})
