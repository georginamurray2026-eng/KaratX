/**
 * A real Node process that installs the REAL crash handlers and then crashes.
 *
 * TEST INFRASTRUCTURE. Never imported by production code, never shipped.
 *
 * WHY THIS EXISTS. `crash-logging.test.ts` proves the handlers by pulling the
 * registered listener off `process` and invoking it directly. That is a good
 * test of the function, and it is not a test of the process: invoking a
 * listener and actually crashing are different events, and only the second one
 * answers "does a fatal JSON line reach stdout before the process dies".
 *
 * WHY A HARNESS AND NOT A PRODUCTION HOOK. The obvious alternative is a
 * `KARATX_CRASH_TEST` environment variable in the worker. That would be a
 * production affordance existing only for a test - the kind of thing found in a
 * security review, and a genuine remote-crash primitive in a long-lived
 * process. This file imports the same module the worker imports and crashes
 * itself instead.
 *
 * WHAT THIS DOES NOT PROVE: that `index.ts` wires `installCrashLogging` in
 * correctly. Delete that call from `main()` and every test here still passes.
 * Recorded as STATUS.md obligation 23 rather than buried in a comment.
 *
 * Usage: node --import tsx test/crash-harness.ts <uncaught|unhandled>
 */
import { DatabaseError } from '@karatx/core'
import { createLogger } from '@karatx/providers'

import { installCrashLogging } from '../src/crash-logging'

const mode = process.argv[2]

if (mode !== 'uncaught' && mode !== 'unhandled') {
  process.stderr.write(`usage: crash-harness.ts <uncaught|unhandled>, got ${String(mode)}\n`)
  process.exit(2)
}

const logger = createLogger({ level: 'trace', name: 'crash-harness' })

// The REAL module the worker uses, not a copy.
installCrashLogging(logger)

// A classified error, so the assertions can check that `category` and `policy`
// survive the trip through a real crash rather than only through a direct call.
const boom = new DatabaseError('deliberate crash from the test harness', {
  context: { harness: true },
})

// Printed before crashing so a failure can distinguish "never started" from
// "started and produced nothing".
process.stdout.write('HARNESS_READY\n')

if (mode === 'uncaught') {
  // From a timer, not the module top level: a top-level throw is caught by the
  // module loader in some runners, which would test the loader rather than the
  // handler.
  setTimeout(() => {
    throw boom
  }, 0)
} else {
  // A rejection nobody awaits.
  setTimeout(() => {
    void Promise.reject(boom)
  }, 0)
}
