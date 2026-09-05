import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { shippedMigrations } from './status'

/** Absolute path to the committed SQL migrations. */
export const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
)

/** One migration this run actually applied. */
export interface AppliedMigration {
  /** The journal tag, e.g. `0004_calendar_corrected`. */
  readonly tag: string
  /** The journal `when`, which is what Drizzle records in the ledger. */
  readonly when: number
}

/**
 * Read the applied-migration timestamps, tolerating a database with no ledger.
 *
 * An unmigrated database has no `drizzle` schema at all, and that is an
 * ORDINARY state - it is what every fresh database is in - so it answers "none
 * applied" rather than throwing.
 */
async function appliedTimestamps(pool: Pool): Promise<number[]> {
  const exists = await pool.query<{ present: string | null }>(
    `select to_regclass('drizzle.__drizzle_migrations')::text as present`,
  )
  if (exists.rows[0]?.present == null) return []

  const { rows } = await pool.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations order by created_at',
  )
  return rows.map((r) => Number(r.created_at))
}

/**
 * Apply every pending migration, then close the connection.
 *
 * Takes the connection string as an argument rather than reading configuration
 * itself, so the integration test can point it at a throwaway database without
 * touching process.env. The CLI wrapper in bin/migrate.ts supplies the real
 * value.
 *
 * This is the ONLY code path that applies migrations. Nothing runs it at boot
 * (OPS-2 / ADR-003): the worker and web entry points neither import nor
 * transitively reach this module.
 *
 * RETURNS WHAT IT APPLIED - obligation 39, and the reason is that a run which
 * applied NOTHING used to be byte-identical to one that applied three. The exit
 * code and the message were both satisfied by a run that did nothing, so the
 * only way to know what had happened was to query the ledger separately - which
 * is exactly what the 0002 and 0003 verifications had to do by hand.
 *
 * DERIVED BY DIFFING THE LEDGER, not reported by Drizzle. `migrate()` returns
 * nothing, and the database stores no migration NAME - only the journal `when`
 * timestamp. So the tags are recovered by reading the ledger either side and
 * joining the new timestamps against the shipped journal, which is the same
 * join `compareMigrations` already documents.
 */
export async function runMigrations(databaseUrl: string): Promise<readonly AppliedMigration[]> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const before = new Set(await appliedTimestamps(pool))

    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })

    const after = await appliedTimestamps(pool)
    const added = after.filter((when) => !before.has(when))

    const byWhen = new Map(shippedMigrations().map((entry) => [entry.when, entry.tag]))

    return added
      .sort((a, b) => a - b)
      .map((when) => ({
        when,
        // A timestamp with no journal entry means the database applied
        // something this build does not ship. `compareMigrations` calls that
        // `ahead`; here it is named rather than hidden behind a blank.
        tag: byWhen.get(when) ?? `(unknown migration, when=${String(when)})`,
      }))
  } finally {
    // Always released, including when a migration throws, so a failed run
    // cannot leave a connection pinned against the database.
    await pool.end()
  }
}
