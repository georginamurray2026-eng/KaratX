import { policyOf, toKaratxError } from '@karatx/core'
import type { Logger } from '@karatx/providers'

/**
 * Route a crash through the logger, then let Node do what it was going to do.
 *
 * NOT THE SAME THING AS T0.7'S `process.exit(1)`, and the difference matters
 * enough to state plainly here, because these two handlers otherwise look like
 * exactly the kind of ceremony a later reader deletes as redundant with Node.
 *
 * T0.7's exit exists because Next.js CATCHES the instrumentation failure and
 * keeps serving 500s. Without that exit, the process lies about being healthy.
 *
 * These handlers force nothing. Measured under `tsx` during T0.8: an uncaught
 * exception and an unhandled rejection each terminate the worker with exit 1,
 * before boot and after it, with no handler installed. Node's default
 * behaviour is already correct and is NOT being overridden here.
 *
 * What Node's default does not do is produce structured output. It prints a
 * stack trace to stderr, which reaches an aggregator as a dozen unrelated
 * plain-text lines carrying no level, no correlation ID, no error category and
 * no handling policy - so the crash is invisible to precisely the tooling
 * meant to catch it. These handlers exist to emit one JSON line first.
 *
 * THE RETHROW IS LOAD-BEARING. Returning normally from an `uncaughtException`
 * handler SUPPRESSES the exit and leaves the process running in an unknown
 * state - which is the T0.7 failure mode exactly, reintroduced by the very
 * code meant to make crashes visible. Installing a handler is what disables
 * Node's default; throwing from inside it is what puts the default back.
 *
 * @returns a function that removes the handlers.
 */
export function installCrashLogging(logger: Logger): () => void {
  const onUncaught = (error: unknown): never => {
    logger.fatal({ err: toKaratxError(error), policy: policyOf(error) }, 'uncaught exception')
    throw error
  }

  const onUnhandled = (reason: unknown): never => {
    logger.fatal({ err: toKaratxError(reason), policy: policyOf(reason) }, 'unhandled rejection')
    throw reason
  }

  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onUnhandled)

  return (): void => {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onUnhandled)
  }
}
