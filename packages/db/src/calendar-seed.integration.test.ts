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

    // TWO distinct local_start values since migration 0004, not one: the daily
    // break and the weekly CLOSE still start at 17:00, while the weekly OPEN
    // moved to 18:00. What this test is actually about is the ZONE - that a
    // wall-clock time is stored against an IANA name rather than an offset - so
    // it asserts that for every row rather than assuming a single start time.
    expect(rows.map((r) => r.timezone)).toEqual(['America/New_York', 'America/New_York'])
    expect(rows.map((r) => r.local_start).sort()).toEqual(['17:00:00', '18:00:00'])
  })

  it('the daily break is 60 minutes, as MEASURED AGAINST THE FEED WE INGEST', async () => {
    const { rows } = await pool.query<{ minutes: string }>(
      `SELECT DISTINCT EXTRACT(EPOCH FROM (local_end - local_start)) / 60 AS minutes
       FROM market_hours WHERE rule_type = 'daily_break'`,
    )

    // 45 until migration 0004, and the change is not a correction of a mistake.
    // T1.2 measured 45 correctly against MASSIVE; ADR-008 then made Twelve Data
    // the ingestion feed, and this calendar exists to say how many bars should
    // have arrived FROM THAT FEED. Measured across 166,344 stored bars: 1,026
    // clean gaps of 1h15m after a bar opening 16:45 New York, so the break runs
    // 17:00-18:00. See the migration comment.
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.minutes)).toBe(60)
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

  /**
   * OBLIGATION 69, THE DATABASE HALF.
   *
   * The application guard landed at c87f7ce: `expectsBarAt` throws on a
   * `daily_break` that does not end after it starts. **That proves the CODE
   * refuses. It proves nothing about the DATABASE**, which accepts such a row
   * today - `market_hours_span_check` tests null-ness only, so an interval that
   * closes nothing satisfies every constraint the table currently carries.
   *
   * ADR-014's accepted consequence 4 is why the code guard alone is not enough:
   * "the guarantee is now procedural, and procedural guarantees erode", because
   * nothing stops a raw INSERT in a migration, a script or a test helper
   * reaching this table without passing through `expectsBarAt`. **This test is
   * the specification the CHECK has to satisfy.**
   *
   * EVERY INSERT RUNS IN ITS OWN TRANSACTION AND IS ROLLED BACK, on the failing
   * path and the succeeding one alike. Assertions above count rows and assert
   * DISTINCT values - the per-type counts, the two `local_start` values, the
   * single 60-minute break duration - and a row left behind would break them
   * somewhere other than where it was written. The last assertion proves
   * nothing leaked.
   */
  it('the DATABASE refuses a daily_break that does not end after it starts', async () => {
    // ONE TRANSACTION PER INSERT. A failed statement aborts its transaction, so
    // a shared one would make every later assertion fail with "current
    // transaction is aborted" rather than with its own reason.
    const insertBreak = async (localStart: string, localEnd: string): Promise<void> => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO market_hours
             (instrument_id, rule_type, day_of_week, local_start, local_end, timezone, effective_from)
           VALUES ((SELECT id FROM instruments WHERE symbol = 'XAU/USD'),
                   'daily_break', 3, $1, $2, 'America/New_York', DATE '2020-01-24')`,
          [localStart, localEnd],
        )
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    }

    // POSITIVE CONTROL. Without it, a rejection below could be about the INSERT
    // being malformed - a missing column, a bad foreign key - rather than about
    // the interval, and the test would be red for the wrong reason before the
    // fix and green for the wrong reason after it.
    await expect(insertBreak('17:00:00', '18:00:00')).resolves.toBeUndefined()

    // MATCHED ON THE CONSTRAINT NAME, which Postgres reports. A bare "it threw"
    // would also pass if the row were refused by the foreign key, by a NOT NULL,
    // or by `market_hours_span_check` - and a test that cannot say which
    // assertion fired is not evidence.
    await expect(insertBreak('18:00:00', '17:00:00')).rejects.toThrow(
      /market_hours_break_order_check/,
    )

    // Zero length is the same silent no-op reached a different way. The
    // constraint is `>` rather than `>=` precisely so that it is refused too.
    await expect(insertBreak('17:00:00', '17:00:00')).rejects.toThrow(
      /market_hours_break_order_check/,
    )

    // NOTHING LEAKED. Four seeded breaks, Mon-Thu. A leftover row would break
    // the per-type count above and the break-duration assertion with it.
    const remaining = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM market_hours WHERE rule_type = 'daily_break'`,
    )
    expect(Number(remaining.rows[0]?.n)).toBe(4)
  })
})
