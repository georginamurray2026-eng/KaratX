/**
 * `@karatx/db` - Drizzle schema, migrations, status queries and query helpers.
 *
 * Migrations are applied only by the explicit `pnpm db:migrate` step, never at
 * boot (OPS-2 / ADR-003). The migration RUNNER is intentionally NOT exported
 * from this entry point, so no application code can reach it by importing the
 * package - it is reached only via its own module path.
 *
 * `checkDatabase` is exported: reading migration state is not applying it.
 */

export * from './schema/index'
export {
  describeFormingConflict,
  finaliseAndOpen,
  isStoredFinal,
  latestFinalOpenTime,
  storedPrices,
  upsertCandle,
  type CandleInput,
  type CandleUpsertResult,
  type SeriesKey,
  type StoredPrices,
} from './queries/candles'
export {
  checkDatabase,
  compareMigrations,
  shippedMigrations,
  type DatabaseStatus,
  type JournalEntry,
  type MigrationStatus,
} from './status'

export const DB_PACKAGE_NAME = '@karatx/db' as const

export {
  loadCalendar,
  payloadHash,
  storedOpenTimes,
  writeEvents,
  WRITE_BATCH,
  type EventToWrite,
} from './queries/data-quality-events'
