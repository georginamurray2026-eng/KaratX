import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import {
  adminUrl,
  createEphemeralDatabase,
  databaseNameFromUrl,
  dropTestDatabase,
  listDatabases,
  makeTestDatabaseName,
  sweepStaleDatabases,
  STALE_AFTER_MS,
} from './db.js'
import { loadRepoEnv } from './env.js'

/**
 * The destructive machinery, exercised against a real PostgreSQL server.
 *
 * db.test.ts covers the naming and staleness rules as pure functions, with
 * nothing at risk. This file proves the operations themselves behave, and -
 * more importantly - that the safety interlock refuses what it must.
 */

loadRepoEnv()

const rawUrl = process.env['DATABASE_URL']
if (rawUrl === undefined || rawUrl === '') {
  throw new Error('DATABASE_URL is not set. Run `cp .env.example .env` and `pnpm db:up`.')
}
// Re-bound so the narrowing survives into the closures below.
const url: string = rawUrl

const baseName = databaseNameFromUrl(url)
const created: string[] = []

afterAll(async () => {
  for (const name of created) {
    if ((await listDatabases(url)).includes(name)) await dropTestDatabase(url, name)
  }
})

async function makeOne(at: Date = new Date()): Promise<string> {
  const name = makeTestDatabaseName(baseName, at)
  await createEphemeralDatabase(url, name)
  created.push(name)
  return name
}

describe('create and drop', () => {
  it('creates a real database and drops it again', async () => {
    const name = await makeOne()
    expect(await listDatabases(url)).toContain(name)

    expect(await dropTestDatabase(url, name)).toBe(true)
    expect(await listDatabases(url)).not.toContain(name)
  })

  it('gives each call a distinct name', async () => {
    const [a, b] = [await makeOne(), await makeOne()]
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// The interlock. These are the tests that matter.
// ---------------------------------------------------------------------------
describe('safety interlock', () => {
  it('REFUSES to drop the development database', async () => {
    await expect(dropTestDatabase(url, baseName)).rejects.toThrow(
      /does not match the test database pattern/,
    )
    // And it is still there afterwards.
    expect(await listDatabases(url)).toContain(baseName)
  })

  it.each([['postgres'], ['template1'], ['production_test'], ['karatx_test']])(
    'REFUSES to drop %s',
    async (name) => {
      await expect(dropTestDatabase(url, name)).rejects.toThrow(/Refusing to drop/)
    },
  )

  it('refuses to CREATE a name that does not match the pattern', async () => {
    await expect(createEphemeralDatabase(url, 'karatx_scratch')).rejects.toThrow(
      /does not match the test database pattern/,
    )
  })
})

// ---------------------------------------------------------------------------
// The sweep. Verifies it removes what it should and, more importantly, leaves
// alone what it must.
// ---------------------------------------------------------------------------
describe('stale sweep', () => {
  it('leaves a freshly created database alone', async () => {
    const fresh = await makeOne()

    const dropped = await sweepStaleDatabases(url, new Date())

    expect(dropped).not.toContain(fresh)
    expect(await listDatabases(url)).toContain(fresh)
  })

  it('leaves the development database alone', async () => {
    await sweepStaleDatabases(url, new Date())
    expect(await listDatabases(url)).toContain(baseName)
  })

  it('drops a database older than 24 hours', async () => {
    // Created with a backdated name, which is what the sweep reads.
    const old = await makeOne(new Date(Date.now() - STALE_AFTER_MS - 60_000))

    const dropped = await sweepStaleDatabases(url, new Date())

    expect(dropped).toContain(old)
    expect(await listDatabases(url)).not.toContain(old)
  })

  it('leaves a FUTURE-dated database alone even though it looks old', async () => {
    // Clock skew between CI and a local machine. A wrong clock is a reason to
    // leave a database alone, not to delete it.
    const future = await makeOne(new Date(Date.now() + 48 * 60 * 60 * 1000))

    const dropped = await sweepStaleDatabases(url, new Date())

    expect(dropped).not.toContain(future)
    expect(await listDatabases(url)).toContain(future)
  })

  it('honours the exclusion list', async () => {
    const old = await makeOne(new Date(Date.now() - STALE_AFTER_MS - 60_000))

    const dropped = await sweepStaleDatabases(url, new Date(), [old])

    expect(dropped).not.toContain(old)
    expect(await listDatabases(url)).toContain(old)
  })
})

// ---------------------------------------------------------------------------
// The transaction-block question, answered from both directions.
// ---------------------------------------------------------------------------
describe('DROP DATABASE and transaction blocks', () => {
  it('Postgres rejects DROP DATABASE inside a transaction (SQLSTATE 25001)', async () => {
    // Establishes that the hazard is real, so the test below means something.
    const name = await makeOne()
    const client = new Client({ connectionString: adminUrl(url) })
    await client.connect()

    try {
      await client.query('begin')
      await expect(client.query(`drop database "${name}"`)).rejects.toMatchObject({
        code: '25001',
      })
      await client.query('rollback')
    } finally {
      await client.end()
    }

    expect(await listDatabases(url)).toContain(name)
  })

  it('our drop path is NOT in a transaction block, so it succeeds', async () => {
    // The actual guarantee: a dedicated Client, no BEGIN anywhere in the
    // module. If this module ever started pooling or wrapping, this fails.
    const name = await makeOne()
    expect(await dropTestDatabase(url, name)).toBe(true)
    expect(await listDatabases(url)).not.toContain(name)
  })
})
