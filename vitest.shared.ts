import type { TestUserConfig } from 'vitest/node'

/**
 * Shared configuration for UNIT test runs.
 *
 * The exclusion is the point. Vitest's default `include` matches every
 * `*.test.ts`, which sweeps up `*.integration.test.ts` as well - so a package
 * that has both kinds of test would silently require a database during
 * `pnpm test`.
 *
 * That is not hypothetical: it happened in T0.6. `packages/test-support` gained
 * integration tests, its unit script had no config, and `pnpm test` began
 * needing PostgreSQL. It looked green only because the database happened to be
 * running, and was caught by stopping it.
 *
 * Every package that runs unit tests uses this, so "unit tests need no
 * database" is a property of the configuration rather than an accident of
 * which files happen to exist.
 */
export const unitTestConfig: TestUserConfig = {
  include: ['src/**/*.test.ts'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
}
