import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

/** Absolute path to the committed SQL migrations. */
export const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
)

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
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    // Always released, including when a migration throws, so a failed run
    // cannot leave a connection pinned against the database.
    await pool.end()
  }
}
