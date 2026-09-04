import {
  initialBucket,
  takeToken,
  TWELVEDATA_FREE_TIER_PACE,
  type TokenBucketPolicy,
  type TokenBucketState,
} from '@karatx/core'

/**
 * The impure half of the pacer: it holds the bucket and does the waiting.
 *
 * Same split as the retry policy - the arithmetic is pure and lives in
 * `packages/core`, the clock and the sleeping live here.
 */

export interface PacerOptions {
  readonly policy?: TokenBucketPolicy
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /** Called when a request is actually delayed. For logging the pace. */
  readonly onWait?: (waitMs: number) => void
}

export interface Pacer {
  /** Resolves when it is this caller's turn. */
  acquire: () => Promise<void>
  /** Total milliseconds spent waiting. Recorded on the job_runs row. */
  readonly waitedMs: number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export function createPacer(options: PacerOptions = {}): Pacer {
  const policy = options.policy ?? TWELVEDATA_FREE_TIER_PACE
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep

  let state: TokenBucketState = initialBucket(policy, now())
  let waitedMs = 0

  return {
    async acquire(): Promise<void> {
      const result = takeToken(state, policy, now())
      state = result.state

      if (result.waitMs > 0) {
        waitedMs += result.waitMs
        options.onWait?.(result.waitMs)
        await sleep(result.waitMs)
      }
    },
    get waitedMs(): number {
      return waitedMs
    },
  }
}
