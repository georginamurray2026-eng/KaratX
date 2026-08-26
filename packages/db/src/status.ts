import { Client } from 'pg'

import journal from '../migrations/meta/_journal.json' with { type: 'json' }

/**
 * Database readiness, for `/api/ready`.
 *
 * Answers one question honestly: can this process reach the database, and does
 * the schema it finds match the migrations this build ships?
 *
 * WHAT THIS IS NOT: it is not tampering detection, and it must not be recorded
 * as partially discharging that obligation. It compares a running database
 * against the repository journal AT THAT MOMENT. Someone who edits a migration
 * and rebases has changed both sides, and this sees nothing. It is also
 * runtime-only, so it cannot fail a pull request. Preventing edits to applied
 * migrations needs a CI check comparing migration files against their state on
 * main - a different mechanism entirely (STATUS.md obligation 2).
 */

/** One entry from `migrations/meta/_journal.json`. */
export interface JournalEntry {
  readonly idx: number
  readonly when: number
  readonly tag: string
}

export interface MigrationStatus {
  /** Migrations recorded as applied in the database. */
  readonly appliedCount: number
  /** Migrations this build ships. */
  readonly expectedCount: number
  /** Human-readable tag of the newest applied migration. */
  readonly latestApplied: string | undefined
  /** Shipped migrations the database has not applied. */
  readonly pending: readonly string[]
  /** Applied migrations this build does not know about - the database is ahead. */
  readonly unknown: readonly number[]
  readonly inSync: boolean
}

export interface DatabaseStatus {
  readonly connected: boolean
  readonly migrations?: MigrationStatus
  /** Safe summary. Never contains the connection string. */
  readonly error?: { readonly code?: string; readonly message: string }
}

/** The migrations this build ships, from the committed journal. */
export function shippedMigrations(): readonly JournalEntry[] {
  return journal.entries as readonly JournalEntry[]
}

/**
 * Compare what the database has applied against what this build ships.
 *
 * Pure - both sides are passed in, so every drift case is unit-testable with
 * no database involved.
 *
 * Matching is by timestamp because that is what Drizzle records: the migrator
 * writes the journal entry's `when` into `__drizzle_migrations.created_at`.
 * The database itself stores no migration name, so the human-readable tag is
 * recovered by joining on that timestamp rather than being read directly.
 */
export function compareMigrations(
  shipped: readonly JournalEntry[],
  appliedWhen: readonly number[],
): MigrationStatus {
  const applied = new Set(appliedWhen)
  const shippedWhen = new Set(shipped.map((entry) => entry.when))

  const pending = shipped.filter((entry) => !applied.has(entry.when)).map((entry) => entry.tag)

  // The database has migrations this build does not ship - it is running ahead
  // of the code, which happens on a rollback to an older image.
  const unknown = appliedWhen.filter((when) => !shippedWhen.has(when))

  const latestAppliedWhen = appliedWhen.length === 0 ? undefined : Math.max(...appliedWhen)
  const latestApplied = shipped.find((entry) => entry.when === latestAppliedWhen)?.tag

  return {
    appliedCount: appliedWhen.length,
    expectedCount: shipped.length,
    latestApplied,
    pending,
    unknown,
    inSync: pending.length === 0 && unknown.length === 0,
  }
}

/**
 * Remove a connection string from text before it can be returned or logged.
 *
 * `DATABASE_URL` contains a password, and a readiness endpoint is exactly the
 * kind of thing that ends up in a public status page or a screenshot. Driver
 * errors do not usually embed the URL, but "usually" is not a guarantee worth
 * relying on for a credential.
 */
function redact(message: string, url: string): string {
  let safe = message.split(url).join('[REDACTED]')

  try {
    const parsed = new URL(url)
    if (parsed.password !== '') safe = safe.split(parsed.password).join('[REDACTED]')
  } catch {
    // An unparseable URL means there is no password component to strip; the
    // whole-string replacement above still applied.
    return safe
  }

  return safe
}

/**
 * Check the database and report what it finds.
 *
 * Opens a fresh connection rather than using a pool. A readiness probe should
 * answer "can this process reach the database RIGHT NOW", and a pooled
 * connection can report success while new connections fail - for instance when
 * the server has run out of them. The connection is short-lived and this
 * endpoint is polled, not hot.
 *
 * Never throws: a readiness check that throws is a readiness check that cannot
 * report unreadiness.
 */
export async function checkDatabase(url: string, timeoutMs = 3_000): Promise<DatabaseStatus> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs })

  try {
    await client.connect()

    const result = await client.query<{ created_at: string }>(
      'select created_at from drizzle.__drizzle_migrations order by created_at',
    )
    const appliedWhen = result.rows.map((row) => Number(row.created_at))

    return { connected: true, migrations: compareMigrations(shippedMigrations(), appliedWhen) }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string }).code

    return {
      connected: false,
      error: { ...(code === undefined ? {} : { code }), message: redact(raw, url) },
    }
  } finally {
    // `end()` on a client that never connected rejects; the readiness check
    // must not fail because its own cleanup did.
    await client.end().catch(() => undefined)
  }
}
