import { readFileSync } from 'node:fs'

import { Client } from 'pg'
import { beforeAll, describe, expect, inject, it } from 'vitest'

import { runMigrations } from './migrate'
import { checkDatabase } from './status'

/**
 * `checkDatabase` against real PostgreSQL - the three states `/api/ready`
 * reports, each corresponding to a real deployment situation.
 *
 * The run's ephemeral database arrives empty, so the unmigrated case is tested
 * before migrations are applied and the connected case after. That ordering is
 * deliberate: it means the drift path is exercised against a genuinely
 * unmigrated database rather than a simulated one.
 */

const databaseUrl = inject('databaseUrl')

// A port nothing listens on. Deliberately loopback so the attempt fails fast
// and locally rather than leaving the network.
const UNREACHABLE = databaseUrl.replace(/:\d+\//, ':1/')

/**
 * Reset to a genuinely unmigrated schema.
 *
 * Files within a run share one ephemeral database (fileParallelism: false), so
 * this file must NOT assume it runs first. It does not: `migrate.integration`
 * sorts earlier and leaves the database migrated. A test that assumes initial
 * state it is not entitled to passes or fails on filename ordering, which is
 * how a suite becomes mysteriously order-dependent.
 *
 * Both schemas go, because Drizzle records applied migrations in its own
 * `drizzle` schema rather than in `public`.
 */
async function resetToUnmigrated(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('drop schema if exists drizzle cascade')
    await client.query('drop schema public cascade')
    await client.query('create schema public')
  } finally {
    await client.end()
  }
}

describe('unmigrated database - the deploy ran but db:migrate did not', () => {
  beforeAll(resetToUnmigrated)

  it('connects but reports the schema out of sync', async () => {
    const status = await checkDatabase(databaseUrl)

    expect(status.connected).toBe(true)
    expect(status.migrations?.inSync).toBe(false)
    expect(status.migrations?.appliedCount).toBe(0)
    expect(status.migrations?.pending).toContain('0000_init_system_events_and_config')
  })

  it('is reachable but NOT ready - the distinction /api/ready depends on', async () => {
    // Connectivity alone is not readiness. A process that can reach a database
    // with the wrong schema will fail on its first real query.
    const status = await checkDatabase(databaseUrl)
    expect(status.connected && status.migrations?.inSync === true).toBe(false)
  })
})

describe('migrated database', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl)
  })

  it('reports connected and in sync', async () => {
    const status = await checkDatabase(databaseUrl)

    expect(status.connected).toBe(true)
    expect(status.migrations?.inSync).toBe(true)
    expect(status.error).toBeUndefined()
  })

  it('names the applied migration by tag rather than by hash', async () => {
    const status = await checkDatabase(databaseUrl)
    // Read from the journal rather than hard-coded. The POINT of this test is
    // that latestApplied is a TAG and not a hash; pinning the literal tag made
    // it fail on every new migration for a reason unrelated to what it checks.
    // The shape assertion is what keeps it honest.
    const journal = JSON.parse(
      readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: { tag: string }[] }
    const latestTag = journal.entries.at(-1)?.tag

    expect(latestTag).toMatch(/^\d{4}_[a-z0-9_]+$/)
    expect(status.migrations?.latestApplied).toBe(latestTag)
    expect(status.migrations?.latestApplied).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports nothing pending and nothing unknown', async () => {
    const status = await checkDatabase(databaseUrl)
    expect(status.migrations?.pending).toEqual([])
    expect(status.migrations?.unknown).toEqual([])
  })
})

describe('unreachable database', () => {
  it('returns connected: false rather than throwing', async () => {
    // A readiness check that throws cannot report unreadiness - the caller
    // gets an exception instead of an answer.
    await expect(checkDatabase(UNREACHABLE, 1_000)).resolves.toMatchObject({ connected: false })
  })

  it('reports an error message', async () => {
    const status = await checkDatabase(UNREACHABLE, 1_000)
    expect(status.error?.message).toBeTruthy()
  })

  it('NEVER leaks the connection string or its password', async () => {
    // A readiness endpoint is exactly the kind of thing that ends up in a
    // screenshot or a public status page.
    const password = new URL(databaseUrl).password
    const status = await checkDatabase(UNREACHABLE, 1_000)

    const serialised = JSON.stringify(status)
    expect(serialised).not.toContain(password)
    expect(serialised).not.toContain(UNREACHABLE)
    expect(serialised).not.toContain(databaseUrl)
  })

  it('omits migration status when it could not connect', async () => {
    // Reporting a stale or invented migration state would be worse than
    // reporting none.
    const status = await checkDatabase(UNREACHABLE, 1_000)
    expect(status.migrations).toBeUndefined()
  })
})

describe('malformed connection string', () => {
  it('fails safely without leaking the string it was given', async () => {
    const secretish = 'p4ssw0rd-should-never-be-printed'
    const status = await checkDatabase(`not-a-url-${secretish}`, 1_000)

    expect(status.connected).toBe(false)
    expect(JSON.stringify(status)).not.toContain(secretish)
  })
})
