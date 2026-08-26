import { policyOf } from '@karatx/core'

import { boot, formatPreLoggerFailure, isPreLoggerFailure } from './boot'
import { installCrashLogging } from './crash-logging'
import { Lifecycle, installSignalHandlers } from './lifecycle'

/**
 * `@karatx/worker` - the long-lived Node process: feed consumer, scheduler,
 * technical engine, event detector, state machine, planner, dispatcher.
 *
 * Kept out of Next.js deliberately (audit H6): a dashboard deploy must not
 * drop the market feed, and the engine must be testable without booting a
 * framework (NFR-9).
 *
 * There is no work here yet. The feed arrives in T1.7; what T0.8 delivers is
 * the process shape it will run inside - boot, shutdown, and a heartbeat that
 * distinguishes "running" from "hung".
 *
 * THIS MODULE RUNS ON IMPORT and exports nothing. Everything worth testing
 * lives in ./boot, ./lifecycle and ./crash-logging, so a test can reach it
 * without starting a worker. Exporting a helper from a file with a load-time
 * side effect is a trap - the same one that split apps/web's instrumentation
 * hook in two.
 */

/**
 * How often the worker reports that it is still alive.
 *
 * At `debug`, not `info`. Until T1.7 there is nothing to report but the fact
 * of being alive, and an info-level line every minute would fill the log with
 * noise that trains people to stop reading it. It is a debug-level answer to
 * "is this process hung, or merely idle" - a question only asked when
 * something is already wrong.
 */
const HEARTBEAT_INTERVAL_MS = 60_000

/**
 * Start the worker and keep it running until a signal arrives.
 *
 * The lifecycle is created BEFORE boot, so anything boot acquires can register
 * its own release as it is acquired. A lifecycle created after a successful
 * boot could not release a resource acquired by a boot that failed halfway.
 */
async function main(): Promise<void> {
  const lifecycle = new Lifecycle()

  const { logger } = await boot({ lifecycle })

  installCrashLogging(logger)

  const removeSignalHandlers = installSignalHandlers(lifecycle, (code) => {
    logger.info({ code }, 'worker stopped')
    // Removed once shutdown is done, so nothing is left listening that could
    // hold the event loop open or handle a signal after the resources it
    // would release are already gone.
    removeSignalHandlers()
    // `exitCode` rather than `exit()`: the difference is whether pino's
    // buffered output reaches stdout. `exit()` truncates it, which would
    // discard the line above - the one saying the shutdown was clean.
    process.exitCode = code
  })

  const heartbeat = setInterval(() => {
    logger.debug({ uptimeSeconds: Math.round(process.uptime()) }, 'heartbeat')
  }, HEARTBEAT_INTERVAL_MS)

  // Registered after the pool, so it stops BEFORE the pool closes. `unref` so
  // the timer alone never holds the process open once shutdown has finished.
  heartbeat.unref()
  lifecycle.onShutdown('heartbeat', () => clearInterval(heartbeat))

  logger.info({ heartbeatMs: HEARTBEAT_INTERVAL_MS }, 'worker running')
}

/**
 * The top-level failure path.
 *
 * `policyOf` is consulted rather than assumed, so the failure reports HOW it
 * should be handled and not merely that it happened. Every boot failure is
 * `stop` today; the call stays because the alternative is a hard-coded 'stop'
 * that silently disagrees with the taxonomy the first time boot can fail in a
 * recoverable way.
 */
main().catch((error: unknown) => {
  if (isPreLoggerFailure(error)) {
    // The one failure that cannot be reported as JSON: the logger's level and
    // its secret list come from the configuration that just failed to parse.
    process.stderr.write(formatPreLoggerFailure(error))
  } else {
    // Past step 3 a logger exists, but not out here - `boot` owns it and did
    // not return. Repeating the message on stderr is deliberate: the JSON line
    // is the machine-readable record, this is the one a human reads in a
    // deploy log that has already scrolled past.
    process.stderr.write(`${formatPreLoggerFailure(error)}`)
  }

  process.stderr.write(`Handling policy: ${policyOf(error)}\n\n`)

  // No `process.exit()`. Measured during T0.8: a rejected top-level promise
  // already exits 1 under tsx, and setting the code rather than forcing the
  // exit lets buffered output flush first. An explicit exit would not change
  // the outcome - it would only imply a danger that does not exist, which a
  // later reader takes as evidence that Node does not crash on its own.
  process.exitCode = 1
})
