import { defineConfig } from 'vitest/config'

/**
 * Integration tests for the route handlers: these reach a real PostgreSQL.
 *
 * Separate config and script so `pnpm test` stays database-free.
 */
export default defineConfig({
  test: {
    include: ['app/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
