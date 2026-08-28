import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Crash logging, in a REAL spawned process. STATUS.md obligation 20.
 *
 * `crash-logging.test.ts` invokes the registered listener directly, which
 * proves the rethrow, the fatal level and the taxonomy fields. It cannot prove
 * that a genuinely crashing process emits that line to stdout before it dies -
 * pino buffers, and a process on its way out is exactly where buffered output
 * gets lost.
 *
 * So this spawns `test/crash-harness.ts`, which installs the REAL
 * `installCrashLogging` and then crashes itself.
 */

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Long enough for `tsx` to compile the import graph, short enough to be a finding. */
const HANG_TIMEOUT_MS = 30_000

interface CrashResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  /** True when WE killed it because it never exited. */
  readonly timedOut: boolean
}

function runHarness(mode: 'uncaught' | 'unhandled'): Promise<CrashResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'test/crash-harness.ts', mode], {
      cwd: WORKER_DIR,
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // OUR OWN WATCHDOG, not the test runner's timeout. If the runner times out
    // it reports "test exceeded 60000ms", which is true and useless. This
    // reports the actual finding: the process never exited, which means a
    // handler returned instead of rethrowing and suppressed the crash.
    const watchdog = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, HANG_TIMEOUT_MS)

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))

    child.on('close', (code, signal) => {
      clearTimeout(watchdog)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}

/** Fatal (level 60) JSON lines from the harness's stdout. */
function fatalLines(stdout: string): Record<string, unknown>[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
    .filter((entry) => entry['level'] === 60)
}

describe.each(['uncaught', 'unhandled'] as const)('a real process crashing (%s)', (mode) => {
  it('starts, crashes, and EXITS - the handler does not suppress it', async () => {
    const result = await runHarness(mode)

    // Assertion 1: the observation is valid. Without this, "no fatal line" and
    // "the harness never started" are indistinguishable.
    expect(result.stdout).toContain('HARNESS_READY')

    // Assertion 2: it did not hang. Stated explicitly rather than left to the
    // runner, so the failure names the cause.
    expect(
      result.timedOut,
      'the process never exited: a crash handler returned instead of rethrowing, ' +
        'which SUPPRESSES the exit and leaves the process alive in an unknown state',
    ).toBe(false)

    // Assertion 3: Node still terminated it. The handlers exist to add a log
    // line, never to change this.
    expect(result.code).not.toBe(0)
  })

  it('emits a fatal JSON line carrying the taxonomy, before dying', async () => {
    const result = await runHarness(mode)
    const fatals = fatalLines(result.stdout)

    // The whole point of the handlers: Node's default prints a stack trace to
    // stderr, which reaches an aggregator as plain text with no level, no
    // category and no policy. If pino's buffered output were lost on the way
    // out, this is where that would show up.
    expect(fatals.length).toBeGreaterThan(0)

    const fatal = fatals[0]
    expect(fatal?.['name']).toBe('crash-harness')
    expect(fatal?.['err']).toMatchObject({
      type: 'DatabaseError',
      category: 'database',
      message: 'deliberate crash from the test harness',
    })
    expect(fatal?.['policy']).toBe('alert')
  })
})
