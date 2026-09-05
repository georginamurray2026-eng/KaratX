import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import { runMigrations } from './migrate'

/**
 * `data_quality_events_condition_idx` - the six columns, against a real database.
 *
 * WHY THIS FILE EXISTS, AND WHAT WAS WRONG BEFORE IT (obligation 56). When 0005
 * was applied the six controls below were run BY HAND against the catalog and
 * reported as passing. They did pass. But a control run once is a
 * DEMONSTRATION, not protection: nothing then stopped a later migration from
 * rebuilding the index with a column missing.
 *
 * The assertion that remained in `migrate.integration.test.ts` was
 * `toContain('data_quality_events_condition_idx')`, and A BLANKET UNIQUE INDEX
 * OVER FEWER COLUMNS SATISFIES IT EXACTLY - same name, same listing, different
 * guarantee. That is the whole reason for this file. It is the same shape as
 * `candles_one_forming_idx`, whose predicate is asserted separately for the
 * same reason: the name is not the constraint.
 *
 * EVERY CONTROL NAMES ITS MUTATION - the change to the migration that would
 * make that control fail. A control whose mutation cannot be named is not
 * testing anything in particular, and the four column-participation cases exist
 * precisely because the first two pass under a constraint that ignores columns.
 */

const T0 = '2026-04-01 09:00:00+00'
const T1 = '2026-04-01 09:15:00+00'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describe('data_quality_events - one condition about one bar is one row', () => {
  let pool: Pool
  let instrumentId: number
  let twelveDataId: number
  let massiveId: number

  beforeAll(async () => {
    const url = inject('databaseUrl')
    await runMigrations(url)
    pool = new Pool({ connectionString: url })

    // Looked up rather than hardcoded. Control 5 is specifically about TWO REAL
    // PROVIDERS - it is the T1.9 reconciliation case - so it should break if
    // the seed ever stops providing both, rather than quietly testing two
    // integers that happen to differ.
    const instrument = await pool.query<{ id: number }>(
      "SELECT id FROM instruments WHERE symbol = 'XAU/USD'",
    )
    const providers = await pool.query<{ id: number; key: string }>(
      "SELECT id, key FROM providers WHERE key IN ('twelve_data', 'massive')",
    )
    expect(instrument.rows).toHaveLength(1)
    expect(providers.rows).toHaveLength(2)

    instrumentId = instrument.rows[0]!.id
    twelveDataId = providers.rows.find((p) => p.key === 'twelve_data')!.id
    massiveId = providers.rows.find((p) => p.key === 'massive')!.id
    expect(twelveDataId).not.toBe(massiveId)
  })

  afterAll(async () => {
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM data_quality_events')
  })

  /** One row of the natural key, with whichever part a control varies. */
  const insert = (over: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      instrument_id: instrumentId,
      provider_id: twelveDataId,
      timeframe: '15min',
      open_time: T0,
      occurred_at: T0,
      payload_hash: HASH_A,
      payload: '{"stored":"1","incoming":"2"}',
      event_type: 'revision_narrowed',
      severity: 'warn',
      ...over,
    }
    return pool.query(
      `INSERT INTO data_quality_events
         (instrument_id, provider_id, timeframe, open_time, occurred_at,
          payload_hash, payload, event_type, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.instrument_id,
        row.provider_id,
        row.timeframe,
        row.open_time,
        row.occurred_at,
        row.payload_hash,
        row.payload,
        row.event_type,
        row.severity,
      ],
    )
  }

  const rowCount = async () => {
    const r = await pool.query<{ n: string }>('SELECT count(*) AS n FROM data_quality_events')
    return Number(r.rows[0]!.n)
  }

  describe('the constraint bites', () => {
    /**
     * CONTROL 1. MUTATION: drop `data_quality_events_condition_idx` from the
     * migration, or create it without UNIQUE. Either turns a re-detection into
     * a new row, and the table grows without bound while reporting nothing new.
     *
     * ASSERTED BY CONSTRAINT NAME, not merely by "it threw". A row can be
     * rejected by the wrong constraint and look identical from outside - which
     * is exactly how the `job_runs` status test produced a false pass.
     */
    it('rejects an identical condition re-detected', async () => {
      await insert()
      await expect(insert()).rejects.toMatchObject({
        code: '23505',
        constraint: 'data_quality_events_condition_idx',
      })
      expect(await rowCount()).toBe(1)
    })

    /**
     * CONTROL 2. MUTATION: remove `payload_hash` from the index, keying on the
     * bar and the event type alone. A CHANGED finding about the same bar would
     * then be swallowed as a duplicate - which is precisely the reverting
     * revision obligation 54 measured, made invisible.
     */
    it('accepts a DIFFERENT finding about the same bar', async () => {
      await insert({ payload_hash: HASH_A })
      await expect(insert({ payload_hash: HASH_B })).resolves.toBeDefined()
      expect(await rowCount()).toBe(2)
    })
  })

  /**
   * THE POSITIVE HALF.
   *
   * The two cases above pass UNCHANGED against a constraint that ignores
   * `open_time`, `event_type`, `provider_id` or `timeframe` - every one of them
   * uses a single value for all four. These four are what make each of those
   * columns load-bearing, and without them the pair above proves only that SOME
   * unique index exists.
   */
  describe('the positive half - every column of the key participates', () => {
    /**
     * CONTROL 3. MUTATION: remove `open_time` from the index. The same finding
     * about two different bars would collapse into one row, so a gap spanning
     * many bars would report as a single event.
     */
    it('accepts the same finding about a DIFFERENT bar (open_time participates)', async () => {
      await insert({ open_time: T0, occurred_at: T0 })
      await expect(insert({ open_time: T1, occurred_at: T1 })).resolves.toBeDefined()
      expect(await rowCount()).toBe(2)
    })

    /**
     * CONTROL 4. MUTATION: remove `event_type` from the index. Two unrelated
     * findings about one bar - a missing bar and a stale feed - would collide,
     * and whichever detector ran second would report nothing.
     */
    it('accepts a DIFFERENT event type about the same bar (event_type participates)', async () => {
      await insert({ event_type: 'missing_bar', severity: 'warn' })
      await expect(insert({ event_type: 'stale_feed', severity: 'warn' })).resolves.toBeDefined()
      expect(await rowCount()).toBe(2)
    })

    /**
     * CONTROL 5. MUTATION: remove `provider_id` from the index - the blanket
     * unique that motivated this whole file.
     *
     * THIS IS THE CONTROL THAT MATTERS MOST AND THE ONE MOST EASILY OMITTED.
     * Every other control here uses one provider, so all five of them pass
     * against a provider-blind constraint. Under that constraint Twelve Data's
     * and Massive's findings about the SAME bar collapse into one row - and
     * comparing exactly those two is what T1.9 reconciliation is for. The
     * constraint would destroy the disagreement it exists to record.
     */
    it('accepts the same finding from a DIFFERENT provider (provider_id participates)', async () => {
      await insert({ provider_id: twelveDataId })
      await expect(insert({ provider_id: massiveId })).resolves.toBeDefined()
      expect(await rowCount()).toBe(2)
    })

    /**
     * CONTROL 6. MUTATION: remove `timeframe` from the index. The 15min and 1h
     * series both hold a bar opening at 09:00 - at every hour boundary, not as
     * an edge case - and a timeframe-blind constraint treats them as one bar.
     */
    it('accepts the same finding on a DIFFERENT timeframe (timeframe participates)', async () => {
      await insert({ timeframe: '15min' })
      await expect(insert({ timeframe: '1h' })).resolves.toBeDefined()
      expect(await rowCount()).toBe(2)
    })
  })

  /**
   * THE ORDERING CHECK CAUGHT A REAL DEFECT ON THE FIRST BASELINE RUN, and it
   * is recorded here beside the six controls because it is the same kind of
   * evidence: proof that a constraint on this table is doing work rather than
   * decorating it.
   *
   * WHAT HAPPENED. `confirmed_at` defaulted to `now()` - the DATABASE clock,
   * evaluated per statement - while `last_seen_at` carried the worker's
   * run-start time. The baseline spends about ten seconds scanning before its
   * first write, so every row arrived with `last_seen_at` ten seconds BEHIND
   * `confirmed_at` and the whole batch was rejected. Zero rows landed.
   *
   * THE SKEW WAS NOT THE CAUSE. The two hosts were measured 92 ms apart. Ten
   * seconds of elapsed run time was the cause, and no amount of clock
   * synchronisation would have prevented it.
   *
   * THE GENERAL FORM: two timestamps that must be ordered cannot come from two
   * clocks, however close those clocks are. They must come from ONE value.
   *
   * And the natural implementation is the one that produced it - a column
   * default for one timestamp and a passed-in value for the other is what
   * anyone would write first.
   */
  describe('the ordering check, and the two-clock defect it caught', () => {
    it('rejects a row whose last_seen_at precedes its confirmed_at', async () => {
      await expect(
        pool.query(
          `INSERT INTO data_quality_events
             (instrument_id, provider_id, timeframe, open_time, occurred_at,
              payload_hash, payload, event_type, severity, confirmed_at, last_seen_at)
           VALUES ($1, $2, '15min', $3, $3, $4, '{}', 'missing_bar', 'info',
                   '2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z')`,
          [instrumentId, twelveDataId, T0, HASH_A],
        ),
      ).rejects.toMatchObject({ constraint: 'data_quality_events_seen_order_check' })
    })

    /** The positive control: one value for both is accepted. */
    it('accepts a row whose two timestamps come from ONE value', async () => {
      await expect(
        pool.query(
          `INSERT INTO data_quality_events
             (instrument_id, provider_id, timeframe, open_time, occurred_at,
              payload_hash, payload, event_type, severity, confirmed_at, last_seen_at)
           VALUES ($1, $2, '15min', $3, $3, $4, '{}', 'missing_bar', 'info', $5, $5)`,
          [instrumentId, twelveDataId, T0, HASH_A, '2026-01-01T00:00:00Z'],
        ),
      ).resolves.toBeDefined()
    })
  })

  /**
   * THE IDEMPOTENCY PROOF, made permanent.
   *
   * Run live against 14,050 rows on 2026-09-06 and asserted here so it cannot
   * silently stop being true. ALL FOUR QUANTITIES, not just the count: a count
   * that held while `confirmed_at` drifted would mean rows are being REWRITTEN
   * rather than incremented, and that is invisible to a count alone.
   */
  describe('a second detection increments and never rewrites', () => {
    const upsert = (seenIso: string) =>
      pool.query(
        `INSERT INTO data_quality_events
           (instrument_id, provider_id, timeframe, open_time, occurred_at,
            payload_hash, payload, event_type, severity, confirmed_at, last_seen_at)
         VALUES ($1, $2, '15min', $3, $3, $4, '{"k":1}', 'unexpected_bar', 'info', $5, $5)
         ON CONFLICT (instrument_id, provider_id, timeframe, open_time, event_type, payload_hash)
         DO UPDATE SET last_seen_at = excluded.last_seen_at,
                       occurrences  = data_quality_events.occurrences + 1`,
        [instrumentId, twelveDataId, T0, HASH_A, seenIso],
      )

    it('holds count, doubles occurrences, keeps confirmed_at, advances last_seen_at', async () => {
      await upsert('2026-01-01T00:00:00Z')
      const first = await pool.query<{
        n: string
        occ: string
        confirmed: Date
        seen: Date
      }>(
        `SELECT count(*)::text AS n, sum(occurrences)::text AS occ,
                min(confirmed_at) AS confirmed, max(last_seen_at) AS seen
           FROM data_quality_events`,
      )

      await upsert('2026-01-02T00:00:00Z')
      const second = await pool.query<{
        n: string
        occ: string
        confirmed: Date
        seen: Date
      }>(
        `SELECT count(*)::text AS n, sum(occurrences)::text AS occ,
                min(confirmed_at) AS confirmed, max(last_seen_at) AS seen
           FROM data_quality_events`,
      )

      expect(second.rows[0]!.n).toBe(first.rows[0]!.n)
      expect(Number(second.rows[0]!.occ)).toBe(Number(first.rows[0]!.occ) * 2)
      expect(second.rows[0]!.confirmed.getTime()).toBe(first.rows[0]!.confirmed.getTime())
      expect(second.rows[0]!.seen.getTime()).toBeGreaterThan(first.rows[0]!.seen.getTime())
    })
  })
})
