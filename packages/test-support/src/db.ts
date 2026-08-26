import { randomBytes } from 'node:crypto'

import { Client } from 'pg'

/**
 * Ephemeral per-run test databases.
 *
 * Integration tests must be isolated per run (T0.6). A single shared test
 * database gives serialisation, not isolation: two runs - CI and local, or two
 * CI jobs - corrupt each other. Each run therefore gets its own database.
 *
 * Everything here that can DROP a database is governed by the rules documented
 * below and agreed before this file was written. The governing principle is
 * that an unrecognised database is never touched.
 */

/** Databases older than this may be swept. See `isStale`. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** PostgreSQL's identifier limit. Exceeding it truncates, which could collide. */
export const MAX_IDENTIFIER_BYTES = 63

/** Set to '1' to keep this run's database for inspection instead of dropping it. */
export const KEEP_ENV_VAR = 'KEEP_TEST_DB'

// ---------------------------------------------------------------------------
// Naming - pure. No I/O, no ambient clock: `now` is passed in.
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `20260826T170800Z` - UTC, so the name carries its own age. */
export function formatTimestamp(now: Date): string {
  const iso = now.toISOString() // 2026-08-26T17:08:00.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`
}

/**
 * The only shape this module will ever create or drop.
 *
 * Anchored deliberately. T0.4 used `name.endsWith('_test')`, which would also
 * accept `production_test`. This accepts only names this scheme generated.
 */
export function testDatabasePattern(baseName: string): RegExp {
  return new RegExp(`^${escapeRegExp(baseName)}_test_(\\d{8}T\\d{6}Z)_[0-9a-f]{6}$`)
}

/**
 * Build a unique name for this run.
 *
 * The random suffix is not decoration: two runs can start within the same
 * second (a CI matrix, or CI alongside a local run), so the timestamp alone is
 * not unique.
 */
export function makeTestDatabaseName(baseName: string, now: Date, suffix?: string): string {
  const random = suffix ?? randomBytes(3).toString('hex')
  const name = `${baseName}_test_${formatTimestamp(now)}_${random}`

  if (Buffer.byteLength(name, 'utf8') > MAX_IDENTIFIER_BYTES) {
    // Postgres would silently truncate, and a truncated name could collide
    // with another run's.
    throw new Error(
      `Test database name exceeds PostgreSQL's ${String(MAX_IDENTIFIER_BYTES)}-byte identifier limit: ${name}`,
    )
  }

  return name
}

/**
 * Recover the creation time encoded in a name.
 *
 * Returns undefined for anything that is not exactly this scheme, or whose
 * timestamp is not a real date. Undefined always means "leave it alone".
 */
export function parseTestDatabaseTimestamp(baseName: string, name: string): Date | undefined {
  const match = testDatabasePattern(baseName).exec(name)
  if (match === null) return undefined

  const stamp = match[1]
  if (stamp === undefined) return undefined

  const parsed = new Date(
    Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(9, 11)),
      Number(stamp.slice(11, 13)),
      Number(stamp.slice(13, 15)),
    ),
  )

  // Round-trip check rejects impossible dates such as 20260231T000000Z, which
  // Date.UTC would otherwise roll forward into March.
  return formatTimestamp(parsed) === stamp ? parsed : undefined
}

/**
 * May this database be swept?
 *
 * True only when the name is unmistakably ours AND it is more than 24 hours
 * old. Every other answer is false, because:
 *
 * - unrecognised name        -> not ours, never touch it
 * - unparseable timestamp    -> cannot establish age, so cannot establish safety
 * - FUTURE-dated timestamp   -> the clock that wrote it disagrees with ours.
 *                               The name is compared against a different
 *                               machine's clock (CI versus local), so skew is
 *                               expected. A wrong clock is a reason to leave a
 *                               database alone, not to delete it.
 * - younger than 24 hours    -> a run could still be using it. This is the
 *                               condition that stops one run destroying
 *                               another's database mid-flight.
 */
export function isStale(baseName: string, name: string, now: Date): boolean {
  const created = parseTestDatabaseTimestamp(baseName, name)
  if (created === undefined) return false

  const age = now.getTime() - created.getTime()
  if (age < 0) return false

  return age > STALE_AFTER_MS
}

// ---------------------------------------------------------------------------
// URLs - pure.
// ---------------------------------------------------------------------------

/** The database name in a connection URL. */
export function databaseNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '')
}

/** The same connection, pointed at a different database. */
export function withDatabase(url: string, databaseName: string): string {
  const next = new URL(url)
  next.pathname = `/${databaseName}`
  return next.toString()
}

/**
 * The maintenance connection.
 *
 * CREATE DATABASE and DROP DATABASE cannot run from inside the database being
 * created or dropped, so they run against `postgres`, which always exists.
 */
export function adminUrl(url: string): string {
  return withDatabase(url, 'postgres')
}

// ---------------------------------------------------------------------------
// Operations - these touch a real server.
// ---------------------------------------------------------------------------

/**
 * Run one statement on a dedicated connection.
 *
 * A `Client`, not a `Pool`. CREATE DATABASE and DROP DATABASE cannot run
 * inside a transaction block, and a single explicitly-opened connection makes
 * it plain that nothing wraps them - no pool reuse, no lingering transaction
 * state from an earlier query. See `runOutsideTransaction`.
 */
async function withAdminClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Postgres SQLSTATE for "cannot run inside a transaction block". */
const ACTIVE_SQL_TRANSACTION = '25001'

/**
 * Run a statement that cannot execute inside a transaction block.
 *
 * How the guarantee is actually established, since this is easy to get wrong:
 *
 * 1. A dedicated `Client`, opened and closed here. Not a `Pool` - a pooled
 *    connection can carry transaction state left by an earlier query.
 * 2. This module never issues BEGIN. Nothing wraps these statements.
 * 3. Postgres enforces it regardless, rejecting with SQLSTATE 25001.
 *
 * An earlier version of this function queried `pg_stat_activity.state` and
 * refused if it contained 'in transaction'. That check CANNOT WORK: while a
 * query is executing the state is always 'active', including inside an open
 * transaction, so it would never have fired. It was removed rather than left
 * in place looking like a safeguard.
 *
 * What remains is enrichment: if Postgres does reject, the error says which
 * statement and why, instead of surfacing a bare driver error.
 */
async function runOutsideTransaction(client: Client, sql: string, label: string): Promise<void> {
  try {
    await client.query(sql)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === ACTIVE_SQL_TRANSACTION) {
      throw new Error(
        `${label} cannot run inside a transaction block (SQLSTATE ${ACTIVE_SQL_TRANSACTION}). This connection must not be pooled or wrapped in BEGIN.`,
        { cause: error },
      )
    }
    throw error
  }
}

/** Every database on the server, excluding templates. */
export async function listDatabases(url: string): Promise<string[]> {
  return withAdminClient(adminUrl(url), async (client) => {
    const result = await client.query<{ datname: string }>(
      'select datname from pg_database where datistemplate = false order by datname',
    )
    return result.rows.map((row) => row.datname)
  })
}

/**
 * Create this run's database and return its connection URL.
 *
 * The name is validated against the anchored pattern before use, so a name
 * produced any other way cannot be created here.
 */
export async function createEphemeralDatabase(
  url: string,
  name: string,
): Promise<{ name: string; url: string }> {
  const baseName = databaseNameFromUrl(url)

  if (!testDatabasePattern(baseName).test(name)) {
    throw new Error(`Refusing to create '${name}': it does not match the test database pattern.`)
  }

  await withAdminClient(adminUrl(url), async (client) => {
    // Identifiers cannot be parameterised. `name` is validated above and is
    // generated by this module, never taken from user input.
    await runOutsideTransaction(client, `create database "${name}"`, 'CREATE DATABASE')
  })

  return { name, url: withDatabase(url, name) }
}

/**
 * Drop a test database.
 *
 * THE SAFETY INTERLOCK. Refuses any name that does not match the anchored
 * pattern, which the development database cannot match.
 *
 * Plain DROP DATABASE, deliberately not `WITH (FORCE)`. If something is still
 * connected the drop fails, and that failure is information. Force would
 * terminate those connections and suppress the signal.
 *
 * @returns true if dropped, false if it was skipped or the drop failed.
 */
export async function dropTestDatabase(url: string, name: string): Promise<boolean> {
  const baseName = databaseNameFromUrl(url)

  if (!testDatabasePattern(baseName).test(name)) {
    throw new Error(
      `Refusing to drop '${name}': it does not match the test database pattern. Only databases created by this module may be dropped.`,
    )
  }

  try {
    await withAdminClient(adminUrl(url), async (client) => {
      await runOutsideTransaction(client, `drop database "${name}"`, 'DROP DATABASE')
    })
    return true
  } catch (error) {
    // Never fails the run. A database that could not be dropped is a leak, and
    // the sweep collects it once it is older than 24 hours.
    process.stderr.write(
      `[test-support] could not drop ${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return false
  }
}

/**
 * Drop abandoned databases from crashed runs.
 *
 * Only databases matching the anchored pattern AND older than 24 hours are
 * considered. Anything else - including anything unparseable, future-dated, or
 * younger - is left alone.
 *
 * @returns the names actually dropped.
 */
export async function sweepStaleDatabases(
  url: string,
  now: Date,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const baseName = databaseNameFromUrl(url)
  const excluded = new Set(exclude)

  const candidates = (await listDatabases(url)).filter(
    (name) => !excluded.has(name) && isStale(baseName, name, now),
  )

  const dropped: string[] = []
  for (const name of candidates) {
    if (await dropTestDatabase(url, name)) dropped.push(name)
  }
  return dropped
}
