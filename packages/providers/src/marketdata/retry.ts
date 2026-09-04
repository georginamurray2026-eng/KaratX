import {
  DEFAULT_RETRY_POLICY,
  describeStopReason,
  nextRetry,
  ProviderError,
  type RetryPolicy,
} from '@karatx/core'

/**
 * The impure half of the retry policy: the part that actually waits.
 *
 * The DECISION lives in `packages/core` (`nextRetry`) and is pure - no clock,
 * no randomness. This file supplies both, plus the loop. The split is what lets
 * every branch of the policy, exhaustion included, be tested without waiting
 * for real time to pass.
 *
 * EXHAUSTION IS SAFE, AND THAT IS A PROPERTY OF THE CALLER, NOT OF THIS FILE.
 * The backfill resumes from `max(open_time)` in the database, so a run that
 * gives up loses only the pages it had not fetched. If this wrapper is ever
 * reused somewhere without that property, the budget needs revisiting.
 */

export interface WithRetryOptions {
  readonly policy?: RetryPolicy
  /** Injected so tests do not wait. Defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Injected so tests control elapsed time. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Injected so tests are deterministic. Defaults to `Math.random`. */
  readonly random?: () => number
  /** Called before each wait. For logging a retry rather than swallowing it. */
  readonly onRetry?: (info: {
    readonly attempt: number
    readonly delayMs: number
    readonly elapsedMs: number
    readonly error: unknown
  }) => void
  /** A label for the exhaustion message, e.g. `time_series page 3`. */
  readonly describe?: string
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Read a server-supplied wait out of an error's context.
 *
 * The client puts `retryAfterMs` there when the response carried the header.
 * Whether Twelve Data ever sends it is UNVERIFIED - OQ-2.
 */
function retryAfterMsOf(error: unknown): number | undefined {
  const context = (error as { context?: Record<string, unknown> })?.context
  const value = context?.['retryAfterMs']
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Run `fn`, retrying per the policy while the error's classification allows it.
 *
 * @throws the original error when it is not retryable - unwrapped, because
 * wrapping a `ValidationError` in a `ProviderError` would move it into a
 * different handling policy and change what the caller does with it.
 * @throws {ProviderError} when retries are exhausted, with the last error as
 * its cause and the reason in its message.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random

  const startedAt = now()
  let attempt = 0

  for (;;) {
    attempt += 1
    try {
      return await fn()
    } catch (error) {
      const elapsedMs = now() - startedAt
      const decision = nextRetry({
        error,
        attempt,
        elapsedMs,
        random01: random(),
        policy,
        ...(retryAfterMsOf(error) === undefined ? {} : { retryAfterMs: retryAfterMsOf(error) }),
      })

      if (decision.action === 'stop') {
        // A non-retryable error is rethrown AS IS. Its classification is the
        // information the caller needs, and wrapping would destroy it.
        if (decision.reason === 'policy') throw error

        throw new ProviderError(
          `Retries exhausted${options.describe === undefined ? '' : ` for ${options.describe}`}: ` +
            `${describeStopReason(decision.reason, policy)}. ` +
            `${String(attempt)} attempt${attempt === 1 ? '' : 's'} over ${String(Math.round(elapsedMs / 1000))}s.\n\n` +
            `The run stops here rather than looping (§23). Nothing is lost: the backfill ` +
            `resumes from max(open_time) in the database, so re-running continues from ` +
            `where this stopped.`,
          {
            cause: error,
            context: { attempts: attempt, elapsedMs, reason: decision.reason },
          },
        )
      }

      options.onRetry?.({ attempt, delayMs: decision.delayMs, elapsedMs, error })
      await sleep(decision.delayMs)
    }
  }
}
