import { Client } from 'pg'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, inject, it } from 'vitest'

/**
 * The worker's boot sequence, run as a real process against a real database.
 *
 * NOTHING HERE IS MOCKED, and that is the point. T0.7 produced three defects
 * that were wrong diagnoses rather than crashes, and every one of them was
 * invisible until the code met real infrastructure. A stubbed `checkDatabase`
 * returns whatever the test author already believed, so it agrees with the
 * implementation by construction and proves nothing.
 *
 * In particular the empty-database case below runs against a database that was
 * genuinely created and never migrated.
 */

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface RunResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

let running: ChildProcess | undefined

afterEach(() => {
  if (running?.killed === false) running.kill()
  running = undefined
})

/**
 * Start the worker and collect everything it produced.
 *
 * `onReady` fires once the worker has logged that it is running, which is the
 * only sound moment to signal it - sending SIGTERM before the shutdown hooks
 * are registered would test a race, not a shutdown.
 */
function runWorker(
  env: Record<string, string>,
  onReady?: (child: ChildProcess) => void,
): Promise<RunResult> {
  return new Promise((resolve) => {
    // `node --import tsx` rather than `pnpm exec tsx` through a shell: no
    // shell means no argument-escaping hazard (Node deprecates that pairing),
    // no intermediate pnpm process between the signal and the worker, and one
    // fewer startup to pay for on every one of these spawns.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: WORKER_DIR,
      env: { ...process.env, ...env },
    })
    running = child

    let stdout = ''
    let stderr = ''
    let readyFired = false

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (!readyFired && stdout.includes('worker running')) {
        readyFired = true
        onReady?.(child)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

/** Every JSON line the worker logged, ignoring anything that is not JSON. */
function logLines(stdout: string): Record<string, unknown>[] {
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
}

describe('booting against a migrated database', () => {
  it('writes exactly one process.started row to system_events', async () => {
    const databaseUrl = inject('migratedUrl')

    // The worker has no work to do yet, so it would run forever. Stopping it
    // once it reports readiness is what makes this terminate.
    const result = await runWorker({ DATABASE_URL: databaseUrl, LOG_LEVEL: 'debug' }, (child) => {
      child.kill()
    })

    const client = new Client({ connectionString: databaseUrl })
    await client.connect()
    try {
      const rows = await client.query<{ source: string; event_type: string; context: unknown }>(
        "select source, event_type, context from system_events where event_type = 'process.started'",
      )

      expect(rows.rowCount).toBe(1)
      expect(rows.rows[0]?.source).toBe('worker')
    } finally {
      await client.end()
    }

    expect(result.stderr).toBe('')
  })

  it('validates configuration BEFORE it touches the database', async () => {
    // T0.3's unproven criterion, for the worker. Proven by ORDER in the log,
    // not by inspecting the source: the configuration line must precede the
    // schema line, and both must precede anything else.
    const result = await runWorker({ DATABASE_URL: inject('migratedUrl') }, (child) => {
      child.kill()
    })

    const messages = logLines(result.stdout).map((line) => line['msg'])
    const configIndex = messages.indexOf('configuration validated')
    const schemaIndex = messages.indexOf('database schema verified')

    expect(configIndex).toBe(0)
    expect(schemaIndex).toBeGreaterThan(configIndex)
  })

  it('never writes the connection string to stdout or stderr', async () => {
    const databaseUrl = inject('migratedUrl')
    const password = new URL(databaseUrl).password

    expect(password).not.toBe('')

    const result = await runWorker({ DATABASE_URL: databaseUrl }, (child) => {
      child.kill()
    })

    expect(result.stdout).not.toContain(password)
    expect(result.stdout).not.toContain(databaseUrl)
    expect(result.stderr).not.toContain(password)
  })
})

/**
 * OPS-3 end to end, which CANNOT RUN ON WINDOWS.
 *
 * Measured, not assumed: `process.kill(pid, 'SIGTERM')` on win32 calls
 * TerminateProcess. The child dies immediately with exit code 1, its
 * `process.on('SIGTERM')` listener never runs, and `signal` on the close event
 * is null. There is no way to deliver a catchable SIGTERM to a Node child on
 * Windows, so this would FAIL here rather than pass vacuously.
 *
 * It is therefore skipped on win32 and runs on Linux, which is where T0.9's CI
 * will execute it - and where the deployment target runs. The shutdown
 * MECHANISM is covered without any OS involvement by lifecycle.test.ts,
 * including the handler-to-exit-code wiring; what only this can prove is that
 * a real SIGTERM from a real supervisor reaches it.
 *
 * STATUS.md obligation: until CI has run this on Linux, OPS-3's end-to-end
 * criterion is unproven, and must not be ticked.
 */
describe.skipIf(process.platform === 'win32')('receiving SIGTERM', () => {
  it('shuts down cleanly and exits 0', async () => {
    const result = await runWorker({ DATABASE_URL: inject('migratedUrl') }, (child) => {
      child.kill('SIGTERM')
    })

    expect(result.code).toBe(0)

    const messages = logLines(result.stdout).map((line) => line['msg'])
    expect(messages).toContain('worker stopped')
  })
})

describe('booting against a genuinely empty database', () => {
  it('refuses to start, and says the schema is missing rather than blaming the connection', async () => {
    // The T0.7 lesson in its worker form. This database is real, reachable and
    // has never been migrated - which is the normal state of a first deploy,
    // not a broken one. Reporting it as a connection failure would send
    // someone to debug the network when the answer is one command.
    const result = await runWorker({ DATABASE_URL: inject('emptyUrl') })

    expect(result.code).not.toBe(0)

    const output = result.stdout + result.stderr
    expect(output).toContain('schema is missing')
    expect(output).toContain('pnpm db:migrate')
    expect(output).not.toMatch(/unreachable|ECONNREFUSED/)
  })

  it('logs the refusal as structured JSON, not only as stderr prose', async () => {
    // A logger exists by this point in the boot, so the failure must reach an
    // aggregator as one parseable line carrying its handling policy.
    const result = await runWorker({ DATABASE_URL: inject('emptyUrl') })

    const fatal = logLines(result.stdout).find((line) => line['msg'] === 'boot failed')

    expect(fatal).toBeDefined()
    expect(fatal?.['policy']).toBe('stop')
    expect(fatal?.['err']).toMatchObject({ type: 'DatabaseError', category: 'database' })
  })
})

describe('booting with an unreachable database', () => {
  it('refuses to start, and does NOT tell the operator to run migrations', async () => {
    // Port 1 is reserved and nothing listens on it.
    const result = await runWorker({
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/karatx',
    })

    expect(result.code).not.toBe(0)

    const output = result.stdout + result.stderr
    expect(output).toContain('unreachable')
    expect(output).not.toContain('pnpm db:migrate')
  })
})

describe('booting with broken configuration', () => {
  it('exits non-zero and names the variable', async () => {
    const result = await runWorker({ DATABASE_URL: 'not-a-connection-string' })

    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('DATABASE_URL')
  })

  it('never echoes the rejected value, which may itself be a secret', async () => {
    // A malformed DATABASE_URL is still likely to contain a real password -
    // that is usually WHY it is malformed. Zod's default messages echo
    // received values, which is why packages/config builds its own text.
    const result = await runWorker({ DATABASE_URL: 'postgresql://user:hunter2@@@broken' })

    expect(result.code).not.toBe(0)
    expect(result.stderr).not.toContain('hunter2')
  })

  it('produces no JSON log line at all, because the logger cannot exist yet', async () => {
    // The one failure this system reports as plain text. The logger's level
    // and its secret list both come from the configuration that just failed.
    const result = await runWorker({ DATABASE_URL: 'not-a-connection-string' })

    expect(logLines(result.stdout)).toHaveLength(0)
    expect(result.stderr).toContain('FATAL')
  })
})
