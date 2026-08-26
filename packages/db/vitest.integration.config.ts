import { defineConfig } from 'vitest/config'

/**
 * Integration tests: these talk to a real PostgreSQL server.
 *
 * Separate config and separate script, so `pnpm test` stays fast and
 * database-free. Nothing here runs during a unit-test run.
 *
 * `globalSetup` creates one ephemeral database for the whole run and drops it
 * afterwards, which is what satisfies T0.6's "isolated per run".
 *
 * Files within a run still share that one database and rely on
 * `fileParallelism: false`. Revisit per-worker schemas if the integration
 * suite becomes slow in Phase 1.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
