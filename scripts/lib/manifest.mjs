import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { CONTAINER, DB_NAME, DB_USER } from './local-db.mjs'

/**
 * A dump is a claim about content. The manifest is what makes it checkable.
 *
 * WHY THIS EXISTS. `pg_restore --exit-on-error` guarantees the restore STOPS at
 * the first error. It does not guarantee it UNDOES what already ran, so on a
 * large archive a late failure can leave rows behind. A non-zero exit plus a
 * half-populated database is better than silent success, but anyone who retries
 * or shrugs at the error still ends up running against incomplete data - tables
 * present, rows missing, nothing saying so. That is the silent-gap state T1.5
 * exists to detect, arriving from the one place T1.5 cannot see.
 *
 * So the procedure verifies CONTENT, not just the exit code.
 */

export function sql(query) {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc', query],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

/** Row counts for every table in `public`, plus the migration ledger. */
export function readCounts() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by 1")
    .split('\n')
    .filter(Boolean)

  const counts = {}
  for (const t of tables) counts[t] = Number(sql(`select count(*) from "${t}"`))

  return {
    tables: counts,
    indexes: Number(sql("select count(*) from pg_indexes where schemaname='public'")),
    migrations: Number(sql('select count(*) from drizzle.__drizzle_migrations')),
  }
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function manifestPathFor(dumpPath) {
  return `${dumpPath}.manifest.json`
}

/** Compares two count snapshots and returns a list of human-readable differences. */
export function diffCounts(expected, actual) {
  const problems = []
  const names = new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)])

  for (const name of [...names].sort()) {
    const e = expected.tables[name]
    const a = actual.tables[name]
    if (e === undefined) problems.push(`table "${name}" exists but is not in the manifest`)
    else if (a === undefined)
      problems.push(`table "${name}" is MISSING (manifest expected ${e} rows)`)
    else if (e !== a) problems.push(`table "${name}": expected ${e} rows, found ${a}`)
  }

  if (expected.indexes !== actual.indexes) {
    problems.push(`indexes: expected ${expected.indexes}, found ${actual.indexes}`)
  }
  if (expected.migrations !== actual.migrations) {
    problems.push(
      `migration ledger: expected ${expected.migrations} rows, found ${actual.migrations}`,
    )
  }
  return problems
}

/**
 * Makes a failed restore OBVIOUSLY broken rather than plausibly working.
 *
 * Renames `public` out of the way and leaves an empty one. Nothing can run
 * against it by accident, and the damaged data is preserved under a dated name
 * so the failure can still be diagnosed. Deleting it would destroy the evidence;
 * leaving it in place would let someone carry on against partial data.
 */
export function quarantineSchema() {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)
  const name = `failed_restore_${stamp}`
  sql(`alter schema public rename to ${name}`)
  sql('create schema public')
  return name
}
