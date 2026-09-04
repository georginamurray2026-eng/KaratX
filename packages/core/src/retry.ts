import { policyOf } from './errors'

/**
 * When to retry, how long to wait, and when to give up.
 *
 * PURE, AND THAT IS WHY IT IS HERE RATHER THAN IN THE ADAPTER. Backoff needs a
 * clock and a random number, both forbidden in this package (F.3 invariant 1).
 * So the DECISION lives here and takes elapsed time and a random value as
 * arguments, while the SLEEPING lives in `packages/providers`. The consequence
 * is that every branch below - including exhaustion, which is the one that
 * matters at 3am - is testable without waiting for real time to pass.
 *
 * OBLIGATION 5's FIRST CONSUMER. T0.5 defined `retry` as a HANDLING POLICY in
 * the error taxonomy and nothing ever read it. This does: `nextRetry` retries
 * only when `policyOf(error) === 'retry'`. That is load-bearing rather than
 * tidy - `DatabaseError` defaults to `alert` precisely because it covers
 * constraint violations, and retrying a 23505 would repeat it forever.
 *
 * §23 - bounded exponential backoff with jitter, never an infinite tight loop.
 */

export interface RetryPolicy {
  /** Total attempts including the first. 1 means "never retry". */
  readonly maxAttempts: number
  /** Delay before the second attempt, doubling from there. */
  readonly baseDelayMs: number
  /** Ceiling on any single wait. */
  readonly maxDelayMs: number
  /** Ceiling on the whole sequence, measured from the first attempt. */
  readonly totalBudgetMs: number
}

/**
 * THE BOUND IS THREE LIMITS, BECAUSE EACH FAILS DIFFERENTLY.
 *
 * `maxAttempts` alone still permits hours of waiting behind long delays.
 * `totalBudgetMs` alone permits a tight loop against instantly-failing calls.
 * `maxDelayMs` alone permits an unbounded number of one-minute waits. Any one
 * of them removed leaves a shape §23 forbids, which is why all three are here
 * and why none is optional.
 *
 * The values are sized for T1.4's backfill against Twelve Data: a 35-47 request
 * run at roughly 7 requests/minute, where the realistic failure is a 429 or a
 * dropped connection rather than a sustained outage. Fifteen minutes of retry
 * budget against a five-minute run means a stall is bounded at roughly four
 * times the expected duration before the run gives up and reports.
 *
 * GIVING UP IS SAFE HERE, which is what lets the budget be this tight: the
 * backfill resumes from `max(open_time)` in the database, so an exhausted run
 * loses nothing but the pages it had not fetched.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 6,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  totalBudgetMs: 15 * 60_000,
}

export type RetryStopReason =
  /** The error's handling policy is not `retry`. Retrying would repeat it. */
  | 'policy'
  /** `maxAttempts` reached. */
  | 'attempts'
  /** The next wait would exceed `totalBudgetMs`. */
  | 'budget'

export type RetryDecision =
  | { readonly action: 'retry'; readonly delayMs: number }
  | { readonly action: 'stop'; readonly reason: RetryStopReason }

export interface RetryInput {
  /** The error the attempt failed with. Its handling policy decides eligibility. */
  readonly error: unknown
  /** 1-based index of the attempt that just failed. */
  readonly attempt: number
  /** Milliseconds since the first attempt began. Passed in - no clock here. */
  readonly elapsedMs: number
  /** A value in [0, 1). Passed in - no randomness here. */
  readonly random01: number
  readonly policy?: RetryPolicy
  /**
   * A server-supplied wait, if one was sent.
   *
   * UNVERIFIED FOR THIS PROVIDER. Whether Twelve Data sends `Retry-After` at
   * all is OQ-2 - no error response has ever been observed by this project.
   * The path exists because guessing wrong in the other direction means
   * ignoring an explicit instruction from the provider.
   */
  readonly retryAfterMs?: number
}

/**
 * Decide what to do after a failed attempt.
 *
 * Deterministic given its inputs, which is the whole point: the same attempt,
 * elapsed time and random value always yield the same decision, so the tests
 * assert exact delays rather than ranges.
 */
export function nextRetry(input: RetryInput): RetryDecision {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY

  // Eligibility comes from the taxonomy, not from inspecting the error here.
  // A caller that wants a DatabaseError retried says so at the throw site with
  // `{ policy: 'retry' }`, which keeps that judgement where the context is.
  if (policyOf(input.error) !== 'retry') return { action: 'stop', reason: 'policy' }

  if (input.attempt >= policy.maxAttempts) return { action: 'stop', reason: 'attempts' }

  const delayMs = computeDelay(input, policy)

  // Checked against the delay we are about to sleep, not against elapsed time
  // alone. Otherwise the budget is exceeded by up to one full maxDelayMs and
  // the stated bound is not the real one.
  if (input.elapsedMs + delayMs > policy.totalBudgetMs) return { action: 'stop', reason: 'budget' }

  return { action: 'retry', delayMs }
}

/**
 * Exponential backoff with EQUAL JITTER, or a server-supplied wait plus jitter.
 *
 * WHY JITTER IS HERE, AND IT IS NOT THE THUNDERING HERD. The usual argument for
 * jitter is many clients retrying in unison, and this system is a singleton
 * worker (ADR-001, ADR-011) - so that argument does not apply and an earlier
 * draft of this reasoning wrongly concluded jitter buys nothing here.
 *
 * THE REAL REASON IS PHASE LOCK, AND IT IS A SINGLE-CLIENT PROPERTY. The
 * backfill is paced by a token bucket at a fixed rate. With a fixed backoff,
 * every retry after a 429 lands at the SAME OFFSET relative to that pacer, and
 * therefore at the same offset relative to the provider's own rate-limit window
 * - whose boundary we do not know and cannot observe. A run that is unlucky in
 * that alignment stays unlucky on every retry, deterministically, and looks
 * like the provider refusing us rather than like a schedule beating against a
 * boundary. Jitter breaks that lock.
 *
 * A future session reading "jitter buys nothing with one worker" is one step
 * from deleting it, so the reason it is actually needed is recorded here.
 *
 * EQUAL JITTER RATHER THAN FULL JITTER. Full jitter (`random * capped`) can
 * return a delay of nearly zero, which against a per-minute quota spends a
 * request to be refused again. Equal jitter keeps half the delay as a floor and
 * randomises the rest, which breaks the phase lock while still backing off.
 */
function computeDelay(input: RetryInput, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** (input.attempt - 1)
  const capped = Math.min(exponential, policy.maxDelayMs)

  if (input.retryAfterMs !== undefined) {
    // The server's instruction wins, capped so a wildly large value cannot
    // stall the run past its budget in one wait. Jitter is ADDED rather than
    // applied, for the phase-lock reason above: retrying at exactly the
    // boundary the server named is itself a fixed offset.
    const honoured = Math.min(input.retryAfterMs, policy.maxDelayMs)
    return Math.round(honoured + input.random01 * policy.baseDelayMs)
  }

  return Math.round(capped / 2 + input.random01 * (capped / 2))
}

/** Human-readable reason, for the error raised when retries are exhausted. */
export function describeStopReason(reason: RetryStopReason, policy: RetryPolicy): string {
  switch (reason) {
    case 'policy':
      return 'the error is not classified as retryable, so retrying would only repeat it'
    case 'attempts':
      return `all ${String(policy.maxAttempts)} attempts were used`
    case 'budget':
      return `the ${String(Math.round(policy.totalBudgetMs / 1000))}s retry budget would be exceeded by the next wait`
  }
}
