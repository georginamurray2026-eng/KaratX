import { defineConfig } from 'vitest/config'

/**
 * Integration tests for the test harness itself: these talk to a real
 * PostgreSQL server and create and drop real databases.
 *
 * Separate from the unit config so `pnpm test` stays fast and database-free.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // These create and drop databases on a shared server; running files
    // concurrently would let them observe each other's databases mid-sweep.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
