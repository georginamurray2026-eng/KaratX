import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import { runMigrations } from '../migrate'
import { type CandleInput, finaliseAndOpen, upsertCandle } from './candles'

/**
 * The six-case conflict rule, against a real database. ADR-013 settles it.
 *
 * THE QUIET CASES ARE TESTED AS DELIBERATELY AS THE LOUD ONES, and each is
 * PAIRED with a loud sibling using the SAME detector. A detector stuck on one
 * answer fails one half of every pair; a test suite that only asserted the loud
 * cases would pass with a classifier that always returned `conflict`, and one
 * that only asserted the quiet cases would pass with a classifier that always
 * returned `noop`. Neither half proves anything alone.
 */

const INSTRUMENT = 1
const PROVIDER = 1
const TF = '15min'
const T0 = '2026-09-01T00:00:00Z'
const T1 = '2026-09-01T00:15:00Z'

function bar(overrides: Partial<CandleInput> = {}): CandleInput {
  return {
    instrumentId: INSTRUMENT,
    providerId: PROVIDER,
    timeframe: TF,
    openTime: T0,
    open: '4600.00000',
    high: '4610.00000',
    low: '4590.00000',
    close: '4605.00000',
    volume: null,
    bid: null,
    ask: null,
    rawDatetime: '2026-09-01 00:00:00',
    isFinal: true,
    ...overrides,
  }
}

describe('candle upsert - the six cases', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = inject('databaseUrl')
    await runMigrations(url)
    pool = new Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })
  afterEach(async () => {
    await pool.query('DELETE FROM candles')
  })

  const timestamps = async () => {
    const { rows } = await pool.query<{ ingested_at: Date; updated_at: Date }>(
      'SELECT ingested_at, updated_at FROM candles',
    )
    return rows[0]
  }
  const stored = async () => {
    const { rows } = await pool.query('SELECT * FROM candles')
    return rows[0] as Record<string, unknown>
  }

  // --- 1 -------------------------------------------------------------------
  it('1. inserts into an empty table', async () => {
    const r = await upsertCandle(pool, bar())
    expect(r).toEqual({ outcome: 'inserted', wrote: true })
  })

  // --- 2 QUIET, paired with 4 ---------------------------------------------
  it('2. QUIET: identical FINAL re-delivery is a no-op, updated_at untouched', async () => {
    await upsertCandle(pool, bar())
    const before = await timestamps()

    const r = await upsertCandle(pool, bar())

    expect(r).toEqual({ outcome: 'noop', wrote: false })
    const after = await timestamps()
    expect(after?.updated_at).toEqual(before?.updated_at)
    expect(after?.ingested_at).toEqual(before?.ingested_at)
  })

  // --- 3 QUIET, paired with 4. ALSO the CTE-snapshot canary ---------------
  it('3. QUIET: forming rewrite is `applied`, not a conflict and not a noop', async () => {
    // IF THE `prior` CTE EVER READ POST-WRITE STATE, this is the test that
    // fails: the row would be compared against itself, every difference would
    // vanish, and this would come back `noop`.
    await upsertCandle(pool, bar({ isFinal: false }))
    const r = await upsertCandle(pool, bar({ isFinal: false, close: '4607.00000' }))

    expect(r).toEqual({ outcome: 'applied', wrote: true })
    expect((await stored())['close']).toBe('4607.00000')
  })

  // --- 4 LOUD, the sibling for 2, 3 and 3b --------------------------------
  it('4. LOUD: a FINAL bar with a different value is a conflict; nothing overwritten', async () => {
    await upsertCandle(pool, bar())
    // 4606, not 9999: a close above `high` violates candles_high_check and the
    // insert would fail before the conflict rule ever ran - the test would pass
    // for the wrong reason. The CHECK caught exactly that on first run.
    const r = await upsertCandle(pool, bar({ close: '4606.00000' }))

    expect(r).toEqual({ outcome: 'conflict', wrote: false })
    expect((await stored())['close']).toBe('4605.00000')
  })

  // --- 5 LOUD, and the CASE-ORDERING canary -------------------------------
  it('5. LOUD: final + incoming NON-final with IDENTICAL values is `rejected`, not `noop`', async () => {
    // THE IDENTICAL-VALUES CASE IS THE ONE THAT MATTERS. With differing values
    // this would be caught by the conflict branch anyway. Identical values can
    // only reach `rejected` if the is_final check precedes every value
    // comparison - so this asserts the ORDER of the CASE, not just its content.
    await upsertCandle(pool, bar())
    const r = await upsertCandle(pool, bar({ isFinal: false }))

    expect(r).toEqual({ outcome: 'rejected', wrote: false })
    expect((await stored())['is_final']).toBe(true)
  })

  // --- 5b LOUD, the ACTUAL case-ordering canary ---------------------------
  it('5b. LOUD: final + incoming NON-final with DIFFERENT values is `rejected`, not `conflict`', async () => {
    // THIS is the test that pins the CASE ORDER, and 5 is not.
    //
    // With identical values, moving the is_final branch below the conflict
    // branch changes nothing: the conflict branch does not fire for identical
    // values, so `rejected` is still reached before the ELSE. Test 5 therefore
    // passes under BOTH orderings - proven by mutation, which killed no test.
    //
    // With DIFFERING values the conflict branch DOES fire, so it matters which
    // comes first. ADR-013 says stored-final + incoming-non-final is
    // `rejected` REGARDLESS of the values: what is wrong is the direction of
    // travel, not the numbers. That distinction only survives if the is_final
    // check precedes the value comparison.
    await upsertCandle(pool, bar())
    const r = await upsertCandle(pool, bar({ isFinal: false, close: '4606.00000' }))

    expect(r).toEqual({ outcome: 'rejected', wrote: false })
    expect((await stored())['is_final']).toBe(true)
    expect((await stored())['close']).toBe('4605.00000')
  })

  // --- 6 QUIET, paired with 5 ---------------------------------------------
  it('6. QUIET: forming -> final is `applied` and finalises', async () => {
    await upsertCandle(pool, bar({ isFinal: false }))
    const r = await upsertCandle(pool, bar({ isFinal: true }))

    expect(r).toEqual({ outcome: 'applied', wrote: true })
    expect((await stored())['is_final']).toBe(true)
  })

  // --- 7 LOUD, paired with 8 and 9 ----------------------------------------
  it('7. LOUD: null -> value on volume is `enriched`, and updated_at advances', async () => {
    await upsertCandle(pool, bar())
    const before = await timestamps()

    const r = await upsertCandle(pool, bar({ volume: '1234' }))

    expect(r).toEqual({ outcome: 'enriched', wrote: true })
    expect((await stored())['volume']).toBe('1234')
    const after = await timestamps()
    expect(after!.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime())
  })

  // --- 8 QUIET, the operator pair for 7 -----------------------------------
  it('8. QUIET: null volume on both sides is a no-op', async () => {
    // WHAT ACTUALLY KILLS `=`, MEASURED: replacing `IS NOT DISTINCT FROM` with
    // `=` (mutation M3) fails tests 7, 9 and 15 - NOT this one. Under `=`,
    // null=null is UNKNOWN, `enrichOnly` becomes UNKNOWN rather than false, and
    // this case falls through to `noop` with no write. The outcome and the write
    // still agree, so nothing here notices.
    //
    // AN EARLIER VERSION OF THIS COMMENT CLAIMED 7-AND-8 TOGETHER PROVED THE
    // OPERATOR. The mutation refuted that: 8 survives M3 alone.
    //
    // IT STILL EARNS ITS PLACE. It is the quiet sibling of 7 and 9: a classifier
    // hard-wired to `enriched` or `conflict` fails here while passing both loud
    // tests, and the null/null path is the ORDINARY case for spot gold - the one
    // that runs on every bar. A rule untested on its common input is untested.
    await upsertCandle(pool, bar())
    const r = await upsertCandle(pool, bar())
    expect(r).toEqual({ outcome: 'noop', wrote: false })
  })

  // --- 9 LOUD, the asymmetry ----------------------------------------------
  it('9. LOUD: value -> null on volume is a CONFLICT, not enrichment', async () => {
    await upsertCandle(pool, bar({ volume: '1234' }))
    const r = await upsertCandle(pool, bar({ volume: null }))

    expect(r).toEqual({ outcome: 'conflict', wrote: false })
    expect((await stored())['volume']).toBe('1234')
  })

  // --- 10 LOUD, paired with 11 --------------------------------------------
  it('10. LOUD: a second FORMING bar is rejected, and the error explains the stall', async () => {
    await upsertCandle(pool, bar({ isFinal: false }))
    await expect(upsertCandle(pool, bar({ openTime: T1, isFinal: false }))).rejects.toThrow(
      /duplicate key value violates unique constraint "candles_one_forming_idx"/,
    )
  })

  // --- 11 QUIET, the positive control for 10 ------------------------------
  it('11. QUIET: two FINAL bars at different open_times both insert', async () => {
    // Without this, test 10 passes just as happily against a BLANKET unique
    // index on (instrument, provider, timeframe) - which would be a completely
    // different constraint and would break every series after its first bar.
    expect(await upsertCandle(pool, bar())).toEqual({ outcome: 'inserted', wrote: true })
    expect(await upsertCandle(pool, bar({ openTime: T1 }))).toEqual({
      outcome: 'inserted',
      wrote: true,
    })
    const { rows } = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM candles')
    expect(rows[0]?.n).toBe('2')
  })

  // --- 12 atomicity --------------------------------------------------------
  it('12. finaliseAndOpen is ATOMIC: if the second write fails, N stays forming', async () => {
    await upsertCandle(pool, bar({ isFinal: false }))

    // instrument 999 does not exist, so the second write violates the FK.
    await expect(
      finaliseAndOpen(pool, {
        finalise: bar(),
        open: bar({ openTime: T1, instrumentId: 999 }),
      }),
    ).rejects.toThrow()

    // If the transaction were missing, bar N would be final and N+1 lost.
    expect((await stored())['is_final']).toBe(false)
  })

  it('12b. finaliseAndOpen succeeds and leaves exactly one forming bar', async () => {
    await upsertCandle(pool, bar({ isFinal: false }))
    const r = await finaliseAndOpen(pool, { finalise: bar(), open: bar({ openTime: T1 }) })

    expect(r.finalised.outcome).toBe('applied')
    expect(r.opened.outcome).toBe('inserted')
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM candles WHERE NOT is_final',
    )
    expect(rows[0]?.n).toBe('1')
  })

  // --- 13 ordering ---------------------------------------------------------
  it('13. returns the last N final candles newest-first', async () => {
    for (let i = 0; i < 5; i++) {
      const t = new Date(Date.parse(T0) + i * 900_000).toISOString()
      await upsertCandle(pool, bar({ openTime: t, close: `460${String(i)}.00000` }))
    }
    const { rows } = await pool.query<{ open_time: Date }>(
      `SELECT open_time FROM candles
        WHERE instrument_id=$1 AND provider_id=$2 AND timeframe=$3 AND is_final
        ORDER BY open_time DESC LIMIT 3`,
      [INSTRUMENT, PROVIDER, TF],
    )
    expect(rows).toHaveLength(3)
    const times = rows.map((r) => r.open_time.getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  // --- 14 the plan, against a table big enough for the planner to care ----
  it('14. the dominant query uses candles_pk with no sort step', async () => {
    // AN EXPLAIN AGAINST AN EMPTY TABLE PROVES NOTHING. Postgres will happily
    // choose a sequential scan on a handful of rows regardless of index quality,
    // so this test would pass or fail for reasons unrelated to the PK ordering.
    //
    // THE ROW COUNT IS MEASURED, NOT REASONED. An earlier version of this
    // comment justified 2,000 by argument, which is the same defect as EXPLAIN
    // against an empty table one level up: a reasoned-sounding number that
    // nothing had observed.
    //
    // Measured 2026-09-02 on Postgres 17, running this exact EXPLAIN after
    // ANALYZE at increasing sizes:
    //
    //     10, 15, 20, 25, 30, 40 rows -> Seq Scan + Sort   (this test FAILS)
    //     50, 100, 200, 500, 1000, 2000, 5000 -> Index Scan Backward using
    //                                            candles_pk, no Sort  (PASSES)
    //
    // THE CROSSOVER IS BETWEEN 40 AND 50 ROWS. So the test does discriminate -
    // it genuinely fails below the crossover - and 2,000 is kept for margin
    // rather than because 2,000 itself was necessary. Re-measure if the row
    // width, the index set or the Postgres version changes; the crossover is a
    // property of this schema on this planner, not a constant.
    const values: string[] = []
    const params: unknown[] = []
    for (let i = 0; i < 2000; i++) {
      const b = params.length
      params.push(
        INSTRUMENT,
        PROVIDER,
        TF,
        new Date(Date.parse(T0) + i * 900_000).toISOString(),
        '4600.00000',
        '4610.00000',
        '4590.00000',
        '4605.00000',
        `raw-${String(i)}`,
        true,
      )
      values.push(
        `($${String(b + 1)},$${String(b + 2)},$${String(b + 3)},$${String(b + 4)},` +
          `$${String(b + 5)},$${String(b + 6)},$${String(b + 7)},$${String(b + 8)},` +
          `$${String(b + 9)},$${String(b + 10)})`,
      )
    }
    await pool.query(
      `INSERT INTO candles (instrument_id,provider_id,timeframe,open_time,
         open,high,low,close,raw_datetime,is_final) VALUES ${values.join(',')}`,
      params,
    )
    await pool.query('ANALYZE candles')

    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT * FROM candles
        WHERE instrument_id=$1 AND provider_id=$2 AND timeframe=$3 AND is_final
        ORDER BY open_time DESC LIMIT 3`,
      [INSTRUMENT, PROVIDER, TF],
    )
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n')

    expect(plan).toMatch(/candles_pk/)
    expect(plan).not.toMatch(/\bSort\b/)
    expect(plan).not.toMatch(/Seq Scan/)
  })

  // --- 15 ingested_at survives every update path --------------------------
  it('15. ingested_at survives repeated rewrites AND an enrichment', async () => {
    await upsertCandle(pool, bar({ isFinal: false }))
    const first = await timestamps()

    let previous = first!.updated_at.getTime()
    for (const close of ['4606.00000', '4607.00000', '4608.00000']) {
      const r = await upsertCandle(pool, bar({ isFinal: false, close }))
      expect(r.outcome).toBe('applied')
      const t = await timestamps()
      expect(t!.ingested_at).toEqual(first!.ingested_at)
      expect(t!.updated_at.getTime()).toBeGreaterThanOrEqual(previous)
      previous = t!.updated_at.getTime()
    }

    // Finalise, then enrich. `updated_at` advances on an enrichment because it
    // WRITES; `ingested_at` must survive that too, which is the path adding
    // `ingested_at = now()` to the SET clause would break.
    await upsertCandle(pool, bar({ isFinal: true, close: '4608.00000' }))
    const r = await upsertCandle(pool, bar({ isFinal: true, close: '4608.00000', bid: '4607.5' }))
    expect(r.outcome).toBe('enriched')
    expect((await timestamps())!.ingested_at).toEqual(first!.ingested_at)
  })

  // --- 16 the amended forming rule ----------------------------------------
  it('16. QUIET: an IDENTICAL forming re-poll is a no-op, updated_at untouched', async () => {
    // ADR-013 was amended for this case. A forming bar re-polled with identical
    // values happens many times in a quiet 15-minute bar; writing each one would
    // bump `updated_at` while nothing changed, degrading it from "when this row
    // last changed" into "when we last saw it".
    await upsertCandle(pool, bar({ isFinal: false }))
    const before = await timestamps()

    const r = await upsertCandle(pool, bar({ isFinal: false }))

    expect(r).toEqual({ outcome: 'noop', wrote: false })
    expect((await timestamps())!.updated_at).toEqual(before!.updated_at)
  })
})
