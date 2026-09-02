import { readFileSync } from 'node:fs'

import { resetConfigCache } from '@karatx/config'
import { loadRepoEnv } from '@karatx/test-support'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { GET } from './route'

/**
 * `/api/ready` end to end, including the status code a monitor actually reads.
 *
 * Runs against the DEVELOPMENT database, read-only. `checkDatabase` only ever
 * issues SELECTs, and the endpoint's whole job is to observe. Using the
 * development database is what makes the "ready" case real: it is migrated, so
 * a 200 here means the full path works rather than a fixture agreeing with
 * itself.
 *
 * The database-state permutations - unmigrated, unreachable, drift - are
 * covered exhaustively in packages/db/src/status.integration.test.ts against
 * an ephemeral database. This file covers only what that cannot: the route's
 * own translation of a status into an HTTP response.
 */

let developmentUrl: string

beforeAll(() => {
  loadRepoEnv()
  const url = process.env['DATABASE_URL']
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Run `cp .env.example .env` and `pnpm db:up`.')
  }
  developmentUrl = url
})

afterEach(() => {
  process.env['DATABASE_URL'] = developmentUrl
  // Configuration is cached for the life of a process, which is correct in
  // production and must be undone between cases here.
  resetConfigCache()
})

describe('when the database is reachable and migrated', () => {
  it('returns 200', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
  })

  it('reports ready, with the migration named by tag', async () => {
    const body = (await (await GET()).json()) as {
      status: string
      database: { connected: boolean; migrations: { inSync: boolean; latestApplied: string } }
    }

    expect(body.status).toBe('ready')
    expect(body.database.connected).toBe(true)
    expect(body.database.migrations.inSync).toBe(true)
    // READ FROM THE JOURNAL, NOT HARD-CODED. This assertion's point is that
    // latestApplied is a TAG and not a hash; pinning the literal tag made it
    // fail on every new migration for a reason unrelated to what it checks.
    //
    // IT DID EXACTLY THAT ON MIGRATION 0002, and was missed because the same
    // defect in packages/db was fixed without checking whether it appeared
    // anywhere else - it did, here. The shape assertions are what keep this
    // honest once the literal is gone.
    const journal = JSON.parse(
      readFileSync(
        new URL('../../../../../packages/db/migrations/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: { tag: string }[] }
    const latestTag = journal.entries.at(-1)?.tag

    expect(latestTag).toMatch(/^\d{4}_[a-z0-9_]+$/)
    expect(body.database.migrations.latestApplied).toBe(latestTag)
    expect(body.database.migrations.latestApplied).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('is never cached', async () => {
    // Belt and braces alongside force-dynamic: an intermediary caching this
    // response would reintroduce the same failure at a different layer.
    expect((await GET()).headers.get('cache-control')).toBe('no-store')
  })
})

describe('when the database is unreachable', () => {
  const unreachable = (url: string): string => url.replace(/:\d+\//, ':1/')

  it('returns 503, not 200 with a sad payload', async () => {
    // The status code is the part a load balancer or uptime monitor reads. A
    // 200 carrying {"status":"not_ready"} is invisible to both.
    process.env['DATABASE_URL'] = unreachable(developmentUrl)
    resetConfigCache()

    expect((await GET()).status).toBe(503)
  })

  it('says why, without leaking the connection string', async () => {
    process.env['DATABASE_URL'] = unreachable(developmentUrl)
    resetConfigCache()

    const response = await GET()
    const text = await response.text()

    expect(text).toContain('not_ready')
    expect(text).toContain('"connected":false')

    const password = new URL(developmentUrl).password
    expect(text).not.toContain(password)
    expect(text).not.toContain(developmentUrl)
  })
})
