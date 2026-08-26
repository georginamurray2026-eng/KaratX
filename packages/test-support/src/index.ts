/**
 * `@karatx/test-support` - shared test infrastructure. Never imported by
 * production code.
 *
 * It exists so that filesystem and database access needed by tests lives in
 * one audited place rather than being duplicated across packages. That matters
 * most for `packages/core`, which may not touch `node:fs` at all - not even in
 * its own tests. Core's tests import this package instead, and the ESLint
 * boundary continues to forbid everything else.
 */

export {
  adminUrl,
  createEphemeralDatabase,
  databaseNameFromUrl,
  dropTestDatabase,
  formatTimestamp,
  isStale,
  KEEP_ENV_VAR,
  listDatabases,
  makeTestDatabaseName,
  MAX_IDENTIFIER_BYTES,
  parseTestDatabaseTimestamp,
  STALE_AFTER_MS,
  sweepStaleDatabases,
  testDatabasePattern,
  withDatabase,
} from './db'
export { findRepoRoot, loadRepoEnv } from './env'
export {
  FIXTURES_ROOT,
  fixturePath,
  readCsvFixture,
  readFixture,
  readJsonFixture,
  type CsvFixture,
} from './fixtures'

export const TEST_SUPPORT_PACKAGE_NAME = '@karatx/test-support' as const
