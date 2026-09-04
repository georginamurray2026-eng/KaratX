/**
 * A token bucket, as a pure function of state and time.
 *
 * PACING IS THE PRIMARY MECHANISM; BACKOFF IS THE FALLBACK. Twelve Data's free
 * tier documents 8 credits per minute, so a backfill that simply asks as fast
 * as it can will collect 429s and spend its retry budget on a limit it could
 * have stayed under. Staying under it costs nothing: the full 6.6-year backfill
 * is 35-47 requests, so at 7/minute it finishes in about five minutes either
 * way. The rate limit binds on wall-clock, not on cost.
 *
 * THE 8/MINUTE FIGURE IS VENDOR DOCUMENTATION AND HAS NEVER BEEN TESTED - OQ-1.
 * That is the reason for pacing at 7 rather than 8: one token of margin against
 * a number nobody here has measured, on a provider where two of this project's
 * three documented rate figures turned out to be wrong in some direction.
 *
 * Pure, like the retry decision and for the same reason: `now` is a parameter,
 * so the tests assert exact waits without any real time passing.
 */

export interface TokenBucketPolicy {
  /** Maximum tokens held. Also the largest burst permitted. */
  readonly capacity: number
  /** Tokens added per minute. */
  readonly refillPerMinute: number
}

export interface TokenBucketState {
  readonly tokens: number
  /** When `tokens` was last computed, in the caller's own clock. */
  readonly updatedAtMs: number
}

/**
 * Deliberately one below the documented 8/minute. See the file header.
 *
 * Capacity 1 rather than 7: a burst of 7 immediate requests is precisely what
 * trips a per-minute limiter, and the backfill has no reason to burst - it is a
 * sequential walk through pages, not a latency-sensitive workload.
 */
export const TWELVEDATA_FREE_TIER_PACE: TokenBucketPolicy = {
  capacity: 1,
  refillPerMinute: 7,
}

export function initialBucket(policy: TokenBucketPolicy, nowMs: number): TokenBucketState {
  return { tokens: policy.capacity, updatedAtMs: nowMs }
}

export interface TokenTakeResult {
  /** The bucket after this call. Pass it to the next one. */
  readonly state: TokenBucketState
  /** Milliseconds to wait before proceeding. `0` means go now. */
  readonly waitMs: number
}

/**
 * Take one token, or report how long until one is available.
 *
 * The caller sleeps for `waitMs` and then proceeds - it does NOT call again
 * after waiting. The token is deducted here either way, so a caller that honours
 * the wait is exactly on pace, and one that ignores it is over pace by a
 * measurable amount rather than silently.
 */
export function takeToken(
  state: TokenBucketState,
  policy: TokenBucketPolicy,
  nowMs: number,
): TokenTakeResult {
  const perMs = policy.refillPerMinute / 60_000

  // A clock that goes backwards must not mint tokens. It happens: NTP steps,
  // suspend and resume, and a test that passes a stale timestamp.
  const elapsedMs = Math.max(0, nowMs - state.updatedAtMs)
  const refilled = Math.min(policy.capacity, state.tokens + elapsedMs * perMs)

  if (refilled >= 1) {
    return { state: { tokens: refilled - 1, updatedAtMs: nowMs }, waitMs: 0 }
  }

  // Round up: waiting a fraction of a millisecond too little means arriving
  // before the token exists, which is the failure this exists to prevent.
  const waitMs = Math.ceil((1 - refilled) / perMs)

  return { state: { tokens: refilled - 1, updatedAtMs: nowMs }, waitMs }
}
