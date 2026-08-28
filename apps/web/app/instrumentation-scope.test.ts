import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The boot guard covers the whole SEQUENCE, not one call inside it.
 *
 * THE BUG THIS EXISTS FOR. `validateConfiguration()` once wrapped only
 * `loadConfig()` in its try, because a bad environment was the failure being
 * thought about when it was written. `loadEnvFileIfPresent()` sat outside it,
 * and `findRepoRoot` throws when its upward walk fails - which is reachable
 * under Next's bundling, where `import.meta.url` points inside `.next/`.
 *
 * That throw propagated out of `register()`, where Next SWALLOWS it. The result
 * is the exact T0.7 failure the `process.exit(1)` exists to prevent - "✓ Ready"
 * followed by HTTP 500 from every endpoint, including /api/health, which is
 * defined as touching nothing - reached by a path the T0.7 fix did not cover.
 *
 * A GUARD AROUND ONE CALL IS NOT A GUARD AROUND A CONTRACT. The contract is
 * "any failure in boot exits non-zero". This asserts the contract rather than
 * the one line that prompted it.
 *
 * Why a unit test and not an integration one: the root walk cannot be made to
 * FAIL inside a real `next start`. It runs from the built module's location and
 * always finds `pnpm-workspace.yaml` above it. Forcing failure would mean
 * mutating the repository root, which races every other suite. So the scope is
 * asserted here by making the dependency throw, and the real path is exercised
 * on the deployment platform (STATUS.md obligation 19).
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('@karatx/config')
})

describe('a failure ANYWHERE in the boot sequence', () => {
  it('exits non-zero when loadEnvFileIfPresent throws, not just loadConfig', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    vi.doMock('@karatx/config', () => ({
      loadEnvFileIfPresent: () => {
        // Exactly what findRepoRoot throws when the upward walk fails.
        throw new Error('Could not find the repository root: no pnpm-workspace.yaml')
      },
      loadConfig: () => undefined,
    }))

    const { validateConfiguration } = await import('../instrumentation-node')
    await validateConfiguration()

    // THE ASSERTION THAT MATTERS. The bug was not a wrong message - it was the
    // process CONTINUING. A test asserting only the stderr text would pass
    // against the defective version, because that version printed nothing and
    // kept running.
    expect(
      exit,
      'boot did not exit. A throw outside the guard reaches Next, which swallows it, ' +
        'and the server serves 500s while reporting itself ready',
    ).toHaveBeenCalledWith(1)

    expect(stderr.mock.calls.join('')).toContain('repository root')
  })

  it('still exits non-zero when loadConfig throws, which was always covered', async () => {
    // The original case, kept so widening the guard cannot silently drop it.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    vi.doMock('@karatx/config', () => ({
      loadEnvFileIfPresent: () => undefined,
      loadConfig: () => {
        throw new Error('Invalid environment configuration')
      },
    }))

    const { validateConfiguration } = await import('../instrumentation-node')
    await validateConfiguration()

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('does NOT exit when the boot sequence succeeds', async () => {
    // The positive control. Without it, a `validateConfiguration` that exited
    // unconditionally would satisfy both tests above while breaking every
    // successful boot.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    vi.doMock('@karatx/config', () => ({
      loadEnvFileIfPresent: () => undefined,
      loadConfig: () => undefined,
    }))

    const { validateConfiguration } = await import('../instrumentation-node')
    await validateConfiguration()

    expect(exit).not.toHaveBeenCalled()
  })
})
