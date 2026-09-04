import { DatabaseError, NetworkError, ProviderError, ValidationError } from '@karatx/core'
import { describe, expect, it } from 'vitest'

import { withRetry } from './retry'

/** A clock and sleeper that advance only when the code under test sleeps. */
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

const deterministic = { random: () => 0 }

describe('withRetry - succeeds', () => {
  it('returns the value without sleeping when the call succeeds first time', async () => {
    const time = fakeTime()
    const result = await withRetry(async () => 'ok', { ...time, ...deterministic })

    expect(result).toBe('ok')
    expect(time.waits).toEqual([])
  })

  it('returns the value after transient failures', async () => {
    const time = fakeTime()
    let calls = 0

    const result = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new NetworkError('reset')
        return 'ok'
      },
      { ...time, ...deterministic },
    )

    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(time.waits).toEqual([500, 1_000])
  })
})

describe('withRetry - gives up, and says why', () => {
  it('rethrows a non-retryable error UNWRAPPED', async () => {
    // Wrapping a ValidationError in a ProviderError would move it from
    // `quarantine` to `retry`, changing what the caller does with it. The
    // classification IS the information.
    const time = fakeTime()

    await expect(
      withRetry(
        async () => {
          throw new ValidationError('bad shape')
        },
        { ...time, ...deterministic },
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(time.waits).toEqual([])
  })

  it('does not retry a DatabaseError - a constraint violation would just repeat', async () => {
    const time = fakeTime()
    let calls = 0

    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new DatabaseError('duplicate key value violates unique constraint')
        },
        { ...time, ...deterministic },
      ),
    ).rejects.toBeInstanceOf(DatabaseError)

    expect(calls).toBe(1)
  })

  it('raises ProviderError when attempts are exhausted, keeping the last error as cause', async () => {
    const time = fakeTime()
    const last = new NetworkError('reset')
    let calls = 0

    const thrown = await withRetry(
      async () => {
        calls += 1
        throw last
      },
      { ...time, ...deterministic, describe: 'time_series page 3' },
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(ProviderError)
    expect(calls).toBe(6)
    expect((thrown as ProviderError).message).toContain('all 6 attempts were used')
    expect((thrown as ProviderError).message).toContain('time_series page 3')
    expect((thrown as ProviderError).cause).toBe(last)
  })

  it('the exhaustion message says the run is resumable, because it is', async () => {
    // At 3am the question is "have I lost the backfill?". The answer is no,
    // and the message says so rather than leaving it to be worked out.
    const time = fakeTime()

    const thrown = await withRetry(
      async () => {
        throw new NetworkError('reset')
      },
      { ...time, ...deterministic },
    ).catch((error: unknown) => error)

    expect((thrown as ProviderError).message).toContain('Nothing is lost')
    expect((thrown as ProviderError).message).toContain('max(open_time)')
  })

  it('terminates rather than looping - the §23 property, observed', async () => {
    const time = fakeTime()
    let calls = 0

    await expect(
      withRetry(
        async () => {
          calls += 1
          if (calls > 100) throw new Error('LOOPED - the bound does not hold')
          throw new NetworkError('reset')
        },
        { ...time, ...deterministic },
      ),
    ).rejects.toBeInstanceOf(ProviderError)

    expect(calls).toBe(6)
  })
})

describe('withRetry - observability and pacing', () => {
  it('reports each retry rather than swallowing it', async () => {
    const time = fakeTime()
    const seen: number[] = []
    let calls = 0

    await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw new NetworkError('reset')
        return 'ok'
      },
      { ...time, ...deterministic, onRetry: (info) => seen.push(info.attempt) },
    )

    expect(seen).toEqual([1, 2])
  })

  it('honours a Retry-After carried on the error context', async () => {
    // The client puts it there when the header was present. UNVERIFIED for
    // this provider - OQ-2.
    const time = fakeTime()
    let calls = 0

    await withRetry(
      async () => {
        calls += 1
        if (calls === 1) {
          throw new ProviderError('429', { context: { status: 429, retryAfterMs: 17_000 } })
        }
        return 'ok'
      },
      { ...time, ...deterministic },
    )

    expect(time.waits).toEqual([17_000])
  })

  it('ignores a malformed Retry-After rather than trusting it', async () => {
    const time = fakeTime()
    let calls = 0

    await withRetry(
      async () => {
        calls += 1
        if (calls === 1) {
          throw new ProviderError('429', { context: { status: 429, retryAfterMs: -5 } })
        }
        return 'ok'
      },
      { ...time, ...deterministic },
    )

    expect(time.waits).toEqual([500])
  })

  it('uses real randomness by default, so consecutive runs do not phase-lock', async () => {
    // The single-client reason jitter exists: with a fixed backoff every retry
    // lands at the same offset relative to our pacer, and therefore relative
    // to the provider's rate-limit window.
    const observed = new Set<number>()

    for (let run = 0; run < 12; run += 1) {
      const time = fakeTime()
      let calls = 0
      await withRetry(
        async () => {
          calls += 1
          if (calls < 2) throw new NetworkError('reset')
          return 'ok'
        },
        { now: time.now, sleep: time.sleep },
      )
      observed.add(time.waits[0] ?? -1)
    }

    expect(observed.size).toBeGreaterThan(1)
  })
})
