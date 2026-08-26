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
    expect(body.database.migrations.latestApplied).toBe('0000_init_system_events_and_config')
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
