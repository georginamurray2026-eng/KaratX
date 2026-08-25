import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runMigrations } from './migrate.js'

/**
 * Migration proof against a real Postgres - not a mock.
 *
 * The test runs against a database derived from DATABASE_URL by appending
 * `_test` to the database name, so it never touches the development database
 * even if DATABASE_URL is pointed somewhere unexpected. The guard below
 * enforces that before anything destructive happens.
 */

const TEST_DB_SUFFIX = '_test'

function deriveTestDatabaseUrl(baseUrl: string): { url: string; name: string; adminUrl: string } {
  const parsed = new URL(baseUrl)
  const baseName = parsed.pathname.replace(/^\//, '')
  const name = `${baseName}${TEST_DB_SUFFIX}`

  const testUrl = new URL(baseUrl)
  testUrl.pathname = `/${name}`

  // Creating a database cannot be done from inside it, so DDL runs against the
  // always-present `postgres` maintenance database.
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'

  return { url: testUrl.toString(), name, adminUrl: adminUrl.toString() }
}

const baseUrl = process.env['DATABASE_URL']
if (baseUrl === undefined || baseUrl === '') {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and start the local database with `pnpm db:up`.',
  )
}

const { url: testDatabaseUrl, name: testDatabaseName, adminUrl } = deriveTestDatabaseUrl(baseUrl)

// The safety interlock. Everything below drops and recreates schemas, so refuse
// to run at all unless the target is unmistakably a throwaway test database.
if (!testDatabaseName.endsWith(TEST_DB_SUFFIX)) {
  throw new Error(`refusing to run destructive tests against '${testDatabaseName}'`)
}

async function withPool<T>(url: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url })
  try {
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

/** Names of every table in the public schema, sorted. */
async function listTables(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  )
  return result.rows.map((r) => r.table_name)
}

beforeAll(async () => {
  await withPool(adminUrl, async (pool) => {
    const exists = await pool.query(`select 1 from pg_database where datname = $1`, [
      testDatabaseName,
    ])
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterised; the name is derived from our own
      // config and validated by the suffix guard above, not user input.
      await pool.query(`create database "${testDatabaseName}"`)
    }
  })

  // Reset to genuinely empty, so each run proves migration from nothing.
  //
  // Both schemas must go. Drizzle records applied migrations in its own
  // `drizzle` schema, not in `public`; dropping only `public` leaves that
  // bookkeeping behind, so the migrator correctly concludes there is nothing
  // to do and the tables are never recreated. The suite then passes on a fresh
  // database and fails on every subsequent run.
  await withPool(testDatabaseUrl, async (pool) => {
    await pool.query('drop schema if exists drizzle cascade')
    await pool.query('drop schema public cascade')
    await pool.query('create schema public')
  })
})

afterAll(async () => {
  // Left migrated rather than dropped: inspecting the result after a failure is
  // useful, and the next run resets it anyway.
})

describe('migrations against an empty database', () => {
  it('starts from a genuinely empty schema', async () => {
    // Asserted, not assumed. Without this, a migration that silently did
    // nothing against an already-migrated database would still pass.
    const tables = await withPool(testDatabaseUrl, listTables)
    expect(tables).toEqual([])

    // And no leftover migration bookkeeping, which is the subtler half: if the
    // `drizzle` schema survives a reset, the migrator has nothing to apply and
    // every downstream assertion fails for a reason that looks unrelated.
    const bookkeeping = await withPool(testDatabaseUrl, (pool) =>
      pool.query<{ exists: boolean }>(
        `select exists (select 1 from information_schema.schemata where schema_name = 'drizzle') as exists`,
      ),
    )
    expect(bookkeeping.rows[0]?.exists).toBe(false)
  })

  it('applies cleanly', async () => {
    await expect(runMigrations(testDatabaseUrl)).resolves.toBeUndefined()
  })

  it('creates system_events and config, and nothing else', async () => {
    const tables = await withPool(testDatabaseUrl, listTables)

    expect(tables).toContain('system_events')
    expect(tables).toContain('config')

    // "creates system_events and config ONLY" - the acceptance criterion is
    // about what is absent as much as what is present. Drizzle's own
    // bookkeeping table lives in a separate schema, so public should hold
    // exactly these two.
    expect(tables).toEqual(['config', 'system_events'])
  })

  it('records the migration in Drizzle bookkeeping', async () => {
    const applied = await withPool(testDatabaseUrl, (pool) =>
      pool.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations order by id'),
    )
    expect(applied.rowCount).toBe(1)
    expect(applied.rows[0]?.hash).toBeTruthy()
  })

  it('creates system_events with the expected columns and types', async () => {
    const columns = await withPool(testDatabaseUrl, (pool) =>
      pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `select column_name, data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = 'system_events'
         order by column_name`,
      ),
    )

    const byName = new Map(columns.rows.map((c) => [c.column_name, c]))

    expect([...byName.keys()]).toEqual([
      'context',
      'event_type',
      'id',
      'message',
      'occurred_at',
      'severity',
      'source',
    ])

    // A table with the right name and the wrong shape must fail, so types and
    // nullability are asserted rather than just column names.
    expect(byName.get('id')?.data_type).toBe('uuid')
    expect(byName.get('occurred_at')?.data_type).toBe('timestamp with time zone')
    expect(byName.get('context')?.data_type).toBe('jsonb')
    expect(byName.get('source')?.is_nullable).toBe('NO')
    expect(byName.get('event_type')?.is_nullable).toBe('NO')
    expect(byName.get('message')?.is_nullable).toBe('YES')
  })

  it('stores timestamps as timestamptz so everything is UTC (NFR-4)', async () => {
    const naive = await withPool(testDatabaseUrl, (pool) =>
      pool.query(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and data_type = 'timestamp without time zone'`,
      ),
    )
    expect(naive.rows).toEqual([])
  })

  it('creates the primary keys and the occurred_at index', async () => {
    const constraints = await withPool(testDatabaseUrl, (pool) =>
      pool.query<{ table_name: string; constraint_type: string }>(
        `select table_name, constraint_type from information_schema.table_constraints
         where table_schema = 'public' and constraint_type = 'PRIMARY KEY'
         order by table_name`,
      ),
    )
    expect(constraints.rows.map((r) => r.table_name)).toEqual(['config', 'system_events'])

    const indexes = await withPool(testDatabaseUrl, (pool) =>
      pool.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = 'public' order by indexname`,
      ),
    )
    expect(indexes.rows.map((r) => r.indexname)).toContain('system_events_occurred_at_idx')
  })

  it('is a no-op when run a second time', async () => {
    // The property that makes `pnpm db:migrate` safe as a repeatable release
    // step: re-running must neither error nor apply anything again.
    await expect(runMigrations(testDatabaseUrl)).resolves.toBeUndefined()

    const applied = await withPool(testDatabaseUrl, (pool) =>
      pool.query('select id from drizzle.__drizzle_migrations'),
    )
    expect(applied.rowCount).toBe(1)

    const tables = await withPool(testDatabaseUrl, listTables)
    expect(tables).toEqual(['config', 'system_events'])
  })

  it('accepts a write to each table, proving the shape is usable', async () => {
    await withPool(testDatabaseUrl, async (pool) => {
      await pool.query(
        `insert into system_events (source, event_type, severity, message, context)
         values ($1, $2, $3, $4, $5)`,
        [
          'test',
          'migration.verified',
          'info',
          'written by the T0.4 integration test',
          { t04: true },
        ],
      )
      await pool.query(`insert into config (key, value, description) values ($1, $2, $3)`, [
        'test.key',
        JSON.stringify({ enabled: true }),
        'written by the T0.4 integration test',
      ])

      const events = await pool.query('select id, occurred_at, severity from system_events')
      expect(events.rowCount).toBe(1)
      // Defaults must actually apply.
      expect(events.rows[0]?.id).toBeTruthy()
      expect(events.rows[0]?.occurred_at).toBeInstanceOf(Date)
      expect(events.rows[0]?.severity).toBe('info')
    })
  })
})
