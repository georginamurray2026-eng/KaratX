import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * ============================================================================
 * IF THIS TEST IS FAILING, PLEASE READ THIS BEFORE CHANGING ANYTHING.
 * ============================================================================
 *
 * It starts a real Next.js server with a broken environment and asserts the
 * process REFUSES TO RUN. It is not a unit test of loadConfig(); it exists
 * because SEC-2 requires configuration to fail "before any other work", and
 * only a real boot can prove that.
 *
 * It fails if `process.exit(1)` is removed from instrumentation.ts.
 *
 * WITHOUT THAT EXIT, Next catches the error and keeps serving. Measured:
 *
 *     ✓ Ready in 398ms
 *     Failed to prepare server: ... instrumentation hook: Invalid
 *     environment configuration
 *
 * "✓ Ready" prints BEFORE the failure. The process stays alive, binds its
 * port, and returns HTTP 500 to everything - including /api/health, which is
 * defined as touching nothing. Every signal a platform uses to judge a
 * deployment reports success while every request fails.
 *
 * THE FIX IS TO RESTORE THE EXIT, NOT TO DELETE THIS TEST.
 * ============================================================================
 */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const WHY =
  'Without process.exit(1) in instrumentation.ts, Next.js catches a configuration failure and keeps serving. It prints "✓ Ready" BEFORE the error, binds its port, and returns HTTP 500 to every request - including /api/health, which is defined as touching nothing. Railway would report a successful deployment. SEC-2 requires the process to fail fast and loudly, which means refusing to run. Restore the exit in instrumentation.ts - do not delete this test.'

interface BootResult {
  code: number | null
  output: string
}

/** Start the built server with the given environment and wait for it to exit. */
function bootWith(env: Record<string, string>, timeoutMs = 45_000): Promise<BootResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['node_modules/next/dist/bin/next', 'start', '-p', '3458'], {
      cwd: webRoot,
      // An explicitly-set DATABASE_URL wins over the repository .env, which is
      // why instrumentation.ts preserves already-set variables. Renaming .env
      // instead would race with any other suite reading it.
      env: { ...process.env, ...env },
      shell: false,
    })

    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `The server did not exit within ${String(timeoutMs)}ms.\n\n${WHY}\n\nServer output:\n${output}`,
        ),
      )
    }, timeoutMs)

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
    child.on('error', reject)
  })
}

describe('boot with a broken environment', () => {
  it('has a production build to start', () => {
    // `next start` requires `next build` to have run. Stated as its own
    // assertion so a missing build reports itself rather than surfacing as a
    // confusing timeout.
    expect(
      existsSync(path.join(webRoot, '.next')),
      'apps/web has not been built. Run `pnpm --filter @karatx/web build` before the integration suite.',
    ).toBe(true)
  })

  it('REFUSES TO START when DATABASE_URL is invalid', async () => {
    const result = await bootWith({ DATABASE_URL: 'not-a-postgres-url' })

    expect(result.code, `The server did not exit non-zero.\n\n${WHY}`).not.toBe(0)
    expect(result.code, `The server did not exit at all.\n\n${WHY}`).not.toBeNull()
  })

  it('says which variable is wrong, so a deploy log is actionable', async () => {
    const result = await bootWith({ DATABASE_URL: 'not-a-postgres-url' })

    expect(result.output).toContain('DATABASE_URL')
    expect(result.output).toContain('ConfigValidationError')
    // The message names what was expected, not merely that something failed.
    expect(result.output).toContain('postgres://')
  })

  it('never prints the rejected value, which may be a real credential', async () => {
    // A malformed DATABASE_URL still contains a password, and this output goes
    // straight into a deploy log.
    const secretish = 'p4ssw0rd-should-never-be-printed'
    const result = await bootWith({ DATABASE_URL: `garbage-${secretish}` })

    expect(result.output).not.toContain(secretish)
  })
})
