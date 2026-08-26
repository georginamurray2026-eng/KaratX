import { defineConfig } from 'vitest/config'

/**
 * Integration tests: these start a real worker process against a real
 * PostgreSQL server.
 *
 * Separate config and separate script, so `pnpm test` stays fast and
 * database-free. Nothing here runs during a unit-test run.
 *
 * `globalSetup` creates two ephemeral databases for the run - one migrated,
 * one deliberately left empty - and drops both afterwards.
 *
 * Timeouts are generous because each test spawns `tsx`, which compiles the
 * worker's whole import graph before the process starts.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
