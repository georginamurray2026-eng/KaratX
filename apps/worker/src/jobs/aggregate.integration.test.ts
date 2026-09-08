import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import { runAggregation } from './aggregate'

/**
 * The aggregation job's ORCHESTRATION, against a real database.
 *
 * The aggregation RULES are proven in `packages/core` against synthetic bars and
 * the real calendar. What is tested here is everything the pure function cannot
 * see: that the spine read is scoped to the source provider, that writes land
 * under `karatx_derived` and nowhere else, that `--dry-run` writes nothing, that
 * a second run is a no-op, and that both providers are resolved BY KEY.
 *
 * BARS ARE INSERTED DIRECTLY, NOT THROUGH THE BACKFILL. This suite is about the
 * aggregation path; routing fixtures through a fake provider would couple it to
 * T1.4's client and make a failure here ambiguous between the two.
 */

const INSTRUMENT_ID = 1
const FIFTEEN_MIN = 900_000

/** Monday 2026-06-15 20:00 UTC = 16:00 New York, mid-session, well inside the week. */
const FIRST_BAR = Date.parse('2026-06-15T20:00:00Z')

describe('aggregation job - orchestration against a real database', () => {
  let pool: Pool
  let sourceProviderId: number
  let derivedProviderId: number

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject('migratedUrl') })

    // RESOLVED BY KEY HERE TOO. A literal in the test would pass against a
    // literal in the code, and the pair would be wrong together.
    const { rows } = await pool.query<{ key: string; id: number }>(
      `SELECT key, id FROM providers WHERE key IN ('twelve_data', 'karatx_derived')`,
    )
    const byKey = new Map(rows.map((r) => [r.key, r.id]))
    const source = byKey.get('twelve_data')
    const derived = byKey.get('karatx_derived')
    expect(source, 'migration 0001 must seed twelve_data').toBeDefined()
    expect(derived, 'migration 0006 must seed karatx_derived').toBeDefined()
    sourceProviderId = source ?? 0
    derivedProviderId = derived ?? 0
  })

  afterAll(async () => {
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM candles')
  })

  /** `count` consecutive final 15M bars under the SOURCE provider. */
  const seedSpine = async (count: number, from = FIRST_BAR): Promise<void> => {
    const values: string[] = []
    const params: unknown[] = []
    for (let i = 0; i < count; i += 1) {
      const at = new Date(from + i * FIFTEEN_MIN).toISOString()
      const base = params.length
      params.push(
        INSTRUMENT_ID,
        sourceProviderId,
        '15min',
        at,
        '4000.00000',
        `${String(4010 + i)}.00000`,
        `${String(3990 - i)}.00000`,
        '4005.00000',
        at.slice(0, 19).replace('T', ' '),
        true,
      )
      const n = (k: number): string => `$${String(base + k)}`
      values.push(
        `(${n(1)}, ${n(2)}, ${n(3)}, ${n(4)}, ${n(5)}, ${n(6)}, ${n(7)}, ${n(8)}, ${n(9)}, ${n(10)})`,
      )
    }
    await pool.query(
      `INSERT INTO candles (instrument_id, provider_id, timeframe, open_time,
                            open, high, low, close, raw_datetime, is_final)
       VALUES ${values.join(',')}`,
      params,
    )
  }

  const run = (dryRun: boolean) =>
    runAggregation(pool, {
      instrumentId: INSTRUMENT_ID,
      fromMs: FIRST_BAR - 86_400_000,
      toMs: FIRST_BAR + 86_400_000,
      dryRun,
    })

  const derivedRows = async () => {
    const { rows } = await pool.query<{ timeframe: string; n: string; raw: string | null }>(
      `SELECT timeframe, count(*)::text AS n, max(raw_datetime) AS raw
         FROM candles WHERE provider_id = $1 GROUP BY timeframe ORDER BY timeframe`,
      [derivedProviderId],
    )
    return rows
  }

  it('resolves BOTH providers by key, and reports the ids it resolved', async () => {
    await seedSpine(4)
    const report = await run(true)

    expect(report.sourceProviderId).toBe(sourceProviderId)
    expect(report.derivedProviderId).toBe(derivedProviderId)
    // The derived id is NOT assumed to be 3 - it is whatever the identity
    // sequence assigned in this ephemeral database (ADR-014).
    expect(report.derivedProviderId).not.toBe(report.sourceProviderId)
  })

  it('DRY RUN writes nothing, and says what it would have written', async () => {
    await seedSpine(4)
    const report = await run(true)

    expect(await derivedRows()).toEqual([])
    // Reporting zero here would make a dry run indistinguishable from an
    // aggregation that produced nothing - the positive control for the pair.
    const hour = report.perTimeframe.find((t) => t.timeframe === '1h')
    expect(hour?.rowsProduced).toBe(1)
    expect(hour?.rowsWritten).toBe(1)
    expect(hour?.chunks).toBe(0)
  })

  it('WRITES land under karatx_derived, with a NULL raw_datetime', async () => {
    await seedSpine(4)
    await run(false)

    const rows = await derivedRows()
    const hour = rows.find((r) => r.timeframe === '1h')
    expect(hour?.n).toBe('1')
    // ADR-014: no vendor sent this bar, so the honest value is NULL. The guard
    // in upsertCandle permits it only for this provider.
    expect(hour?.raw).toBeNull()
  })

  it('the SOURCE series is untouched - aggregation reads it and does not rewrite it', async () => {
    await seedSpine(4)
    await run(false)

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM candles WHERE provider_id = $1 AND timeframe = '15min'`,
      [sourceProviderId],
    )
    expect(rows[0]?.n).toBe('4')
  })

  it('A SECOND RUN IS A NO-OP: nothing written, and the job does not throw', async () => {
    await seedSpine(4)
    const first = await run(false)
    const second = await run(false)

    const firstHour = first.perTimeframe.find((t) => t.timeframe === '1h')
    const secondHour = second.perTimeframe.find((t) => t.timeframe === '1h')

    expect(firstHour?.rowsWritten).toBe(1)
    expect(firstHour?.outcomes['inserted']).toBe(1)

    // ADR-013: an identical re-delivery is a `noop` and writes nothing. The
    // partition check must survive that - it asserts over rowsProduced, and
    // asserting over rowsWritten made this run throw on its own idempotency.
    expect(secondHour?.rowsWritten).toBe(0)
    expect(secondHour?.outcomes['noop']).toBe(1)
    expect(secondHour?.rowsProduced).toBe(1)

    const rows = await derivedRows()
    expect(rows.find((r) => r.timeframe === '1h')?.n).toBe('1')
  })

  it('an INCOMPLETE hour produces nothing, and a complete one beside it survives', async () => {
    // Eight bars, minus one from the second hour: the partial-final case,
    // against the database rather than in memory.
    await seedSpine(8)
    await pool.query(
      `DELETE FROM candles WHERE provider_id = $1 AND open_time = to_timestamp($2::double precision / 1000)`,
      [sourceProviderId, FIRST_BAR + 5 * FIFTEEN_MIN],
    )
    await run(false)

    const rows = await derivedRows()
    expect(rows.find((r) => r.timeframe === '1h')?.n).toBe('1')
  })

  it('a NON-FINAL constituent produces nothing - forming and missing are one answer', async () => {
    await seedSpine(4)
    await pool.query(
      `UPDATE candles SET is_final = false
        WHERE provider_id = $1 AND open_time = to_timestamp($2::double precision / 1000)`,
      [sourceProviderId, FIRST_BAR + 3 * FIFTEEN_MIN],
    )
    await run(false)

    expect(await derivedRows()).toEqual([])
  })

  it('counts the guard lookups the write path performed - one per derived write', async () => {
    // OQ-22 predicted ~43,000 of these for a full run. The counter is what
    // turns that into a comparison rather than an assertion.
    await seedSpine(4)
    const dry = await run(true)
    expect(dry.guardLookups).toBe(0)

    const wet = await run(false)
    const produced = wet.perTimeframe.reduce((n, t) => n + t.rowsProduced, 0)
    expect(wet.guardLookups).toBe(produced)
  })

  it('writes 1H and 1D only - never 4h, and never under the source provider', async () => {
    await seedSpine(96)
    await run(false)

    const rows = await derivedRows()
    const timeframes = rows.map((r) => r.timeframe).sort()
    expect(timeframes).not.toContain('4h')
    expect(timeframes.every((t) => t === '1h' || t === '1D')).toBe(true)

    const { rows: strays } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM candles
        WHERE provider_id <> $1 AND timeframe <> '15min'`,
      [derivedProviderId],
    )
    expect(strays[0]?.n).toBe('0')
  })

  it('writes NO provider_instruments row for the derived provider', async () => {
    await seedSpine(4)
    await run(false)

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM provider_instruments WHERE provider_id = $1`,
      [derivedProviderId],
    )
    expect(rows[0]?.n).toBe('0')
  })
})
