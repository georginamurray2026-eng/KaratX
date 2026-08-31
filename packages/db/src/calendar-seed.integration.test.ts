import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { runMigrations } from './migrate'

/**
 * The trading calendar must not be empty.
 *
 * DO NOT DELETE THIS FILE AS REDUNDANT. It looks like it asserts something the
 * migration obviously already did, and that is exactly why it is here.
 *
 * market_hours is the authority T1.5 asks "how many bars should exist on this
 * date?" before comparing the answer to what arrived. An EMPTY table answers
 * "nothing expected" to every question. Weekend detection then finds nothing
 * and reports success; every calendar assertion passes; there is no error, no
 * alert and no symptom. A system that has stopped checking is indistinguishable
 * from a system with nothing to report.
 *
 * The CHECK constraints on market_hours prevent a malformed ROW. Nothing in
 * Postgres prevents an empty TABLE - no column constraint can express it. The
 * migration seeds the rules so the table is non-empty by construction, and this
 * test is what notices if that ever stops being true: a dropped seed, a
 * truncating fixture, a migration that recreates the table.
 *
 * OBSERVED RED before being trusted green: market_hours was truncated, this
 * file was run, and it failed with the message below. A test never seen to fail
 * is a test whose assertions have never been shown to be connected to anything.
 */

const WHY_THIS_MATTERS =
  'market_hours is EMPTY. This is not a missing-fixture problem.\n' +
  'An empty calendar answers "nothing expected" to every question, so T1.5\n' +
  'weekend detection would find nothing and report success, and every calendar\n' +
  'assertion would pass while checking nothing. The seed in migration 0001 is\n' +
  'what makes this table non-empty; if it has been dropped or truncated, the\n' +
  'calendar authority is silently inert. See STATUS.md, "AN EMPTY AUTHORITY\n' +
  'TABLE DOES NOT FAIL".'

describe('trading calendar seed', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = inject('databaseUrl')
    // The ephemeral database is created EMPTY - global setup deliberately does
    // not migrate it, so that the migration test can prove migration from
    // nothing. Migrating here rather than relying on another file having run
    // first: this suite shares one database with fileParallelism disabled, and
    // an assertion whose outcome depends on file ORDER is not an assertion.
    await runMigrations(url)
    pool = new Pool({ connectionString: url })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('market_hours is NOT EMPTY', async () => {
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM market_hours')
    const count = Number(rows[0]?.n ?? 0)

    expect(count, WHY_THIS_MATTERS).toBeGreaterThan(0)
  })

  it('carries a weekly open, a weekly close and the daily breaks', async () => {
    // Not merely "some rows". A calendar missing its weekly_close would place
    // no boundary at Friday 17:00 and would silently expect weekend bars.
    const { rows } = await pool.query<{ rule_type: string; n: string }>(
      'SELECT rule_type, count(*) AS n FROM market_hours GROUP BY rule_type ORDER BY rule_type',
    )
    const byType = new Map(rows.map((r) => [r.rule_type, Number(r.n)]))

    expect(byType.get('weekly_open'), 'no weekly open: the session never starts').toBe(1)
    expect(byType.get('weekly_close'), 'no weekly close: the week never ends').toBe(1)
    expect(byType.get('daily_break'), 'expected one break for each of Mon-Thu').toBe(4)
  })

  it('encodes the boundary as a LOCAL time plus an IANA zone, never an offset', async () => {
    // 17:00 New York is 22:00 UTC under EST and 21:00 under EDT. A stored
    // offset would be silently wrong for half of every year, and wrong in a way
    // that shifts the daily candle boundary.
    const { rows } = await pool.query<{ timezone: string; local_start: string }>(
      'SELECT DISTINCT timezone, local_start FROM market_hours',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.timezone).toBe('America/New_York')
    expect(rows[0]?.local_start).toBe('17:00:00')
  })

  it('the daily break is 45 minutes, as MEASURED - not the 60 of futures convention', async () => {
    const { rows } = await pool.query<{ minutes: string }>(
      `SELECT DISTINCT EXTRACT(EPOCH FROM (local_end - local_start)) / 60 AS minutes
       FROM market_hours WHERE rule_type = 'daily_break'`,
    )

    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.minutes)).toBe(45)
  })

  it('seeds the instrument and both providers, with their own symbols', async () => {
    const { rows } = await pool.query<{ key: string; provider_symbol: string }>(
      `SELECT p.key, pi.provider_symbol
       FROM provider_instruments pi
       JOIN providers p ON p.id = pi.provider_id
       JOIN instruments i ON i.id = pi.instrument_id
       WHERE i.symbol = 'XAU/USD'
       ORDER BY p.key`,
    )

    expect(rows).toEqual([
      { key: 'massive', provider_symbol: 'C:XAUUSD' },
      { key: 'twelve_data', provider_symbol: 'XAU/USD' },
    ])
  })
})
