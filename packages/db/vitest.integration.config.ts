import { defineConfig } from 'vitest/config'

/**
 * Integration tests: these talk to a real Postgres.
 *
 * Kept in a separate config, and behind a separate script, so that `pnpm test`
 * stays fast and database-free (T0.6's criterion, true today). Nothing here
 * runs during a normal unit-test run.
 *
 * T0.6 owns the general harness and will likely absorb this; it exists now
 * because T0.4 requires an integration test and T0.6 depends on T0.4.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./test/load-env.ts'],
    // These tests create and drop schemas; running files concurrently against
    // the same database would make them interfere.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
