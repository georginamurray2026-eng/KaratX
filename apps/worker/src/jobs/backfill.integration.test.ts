import { Secret } from '@karatx/config'
import { createPacer, TwelveDataClient, type FetchLike, type HttpResponse } from '@karatx/providers'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import {
  BackfillConflictError,
  emptyCounts,
  runBackfill,
  toProviderDatetime,
  type BackfillSeries,
} from './backfill'
import { closeRun, openRun, StaleRunError } from './job-run'

/**
 * The three runs BUILD-PLAN's T1.4 requires - full, interrupted-and-resumed,
 * duplicate - against a real database and a fake provider.
 *
 * THE FAKE SERVES JSON THROUGH THE REAL CLIENT. It is a `fetch` stub, not a
 * stubbed client, so every one of these runs exercises the actual URL builder,
 * the actual Zod parsing, the actual UTC datetime handling and the actual
 * ordering assertion. A stubbed client would test the loop while silently
 * skipping the three ADR-008 requirements the adapter exists to enforce.
 */

const API_KEY = new Secret('td-test-key-0123456789')

/** Bars in Twelve Data's shape, generated so a run can span several pages. */
function makeBars(count: number, startMs: number): { datetime: string; [k: string]: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(startMs + i * 15 * 60_000)
    const base = 4600 + i
    return {
      datetime: toProviderDatetime(at),
      open: `${String(base)}.10000`,
      high: `${String(base + 5)}.00000`,
      low: `${String(base - 5)}.00000`,
      close: `${String(base + 1)}.00000`,
    }
  })
}

const SERIES_START = Date.parse('2026-01-01T00:00:00Z')

/**
 * A provider that honours `start_date`, `end_date` and `outputsize` over a
 * fixed universe of bars, and reports how many requests it served.
 */
function fakeProvider(options: { bars: ReturnType<typeof makeBars>; pageSize: number }): {
  fetch: FetchLike
  requests: number
} {
  const state = { requests: 0 }

  const fetch: FetchLike = async (url) => {
    state.requests += 1
    const params = new URL(url).searchParams
    const start = params.get('start_date')
    const end = params.get('end_date')
    const size = Number(params.get('outputsize') ?? options.pageSize)

    let selected = options.bars
    if (start !== null) selected = selected.filter((b) => b.datetime >= start)
    if (end !== null) selected = selected.filter((b) => b.datetime <= end)
    selected = selected.slice(0, Math.min(size, options.pageSize))

    const body = JSON.stringify({
      meta: { symbol: 'XAU/USD', interval: '15min' },
      values: selected,
      status: 'ok',
    })

    const response: HttpResponse = {
      status: 200,
      headers: { get: () => null },
      text: async () => body,
    }
    return response
  }

  return {
    fetch,
    get requests() {
      return state.requests
    },
  }
}

describe('T1.4 backfill - against a real database and a fake provider', () => {
  let pool: Pool
  let series: BackfillSeries

  beforeAll(async () => {
    // migratedUrl, NOT a database this file migrates itself. ADR-003 makes
    // migrations a deliberate step and nothing under apps/ may import the
    // runner - the obligation 33 guard in wiring-assertions.test.ts enforces
    // that, and it caught the first version of this file doing exactly that.
    // The harness spawns the migrate binary instead.
    pool = new Pool({ connectionString: inject('migratedUrl') })

    // Read the seeded ids rather than assuming 1 and 1. Migration 0001 seeds
    // them; an assumed id would silently write against the wrong provider.
    const { rows } = await pool.query<{
      instrument_id: number
      provider_id: number
      symbol: string
    }>(
      `SELECT pi.instrument_id, pi.provider_id, pi.provider_symbol AS symbol
         FROM provider_instruments pi
         JOIN providers p ON p.id = pi.provider_id
         JOIN instruments i ON i.id = pi.instrument_id
        WHERE p.key = 'twelve_data' AND i.symbol = 'XAU/USD'`,
    )
    const seeded = rows[0]
    expect(seeded, 'migration 0001 must seed twelve_data + XAU/USD').toBeDefined()

    series = {
      instrumentId: seeded?.instrument_id ?? 0,
      providerId: seeded?.provider_id ?? 0,
      timeframe: '15min',
      providerSymbol: seeded?.symbol ?? 'XAU/USD',
      providerInterval: '15min',
    }
  })

  afterAll(async () => {
    await pool.end()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM candles')
    await pool.query('DELETE FROM job_runs')
  })

  /** No waiting, no randomness - the retry and pace policies are tested elsewhere. */
  const immediate = <T>(fn: () => Promise<T>): Promise<T> => fn()
  const nopPacer = createPacer({ now: () => 0, sleep: async () => undefined })

  function run(fetch: FetchLike, overrides: Partial<Parameters<typeof runBackfill>[0]> = {}) {
    return runBackfill({
      pool,
      client: new TwelveDataClient({ fetch, apiKey: API_KEY }),
      pacer: nopPacer,
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
      ...overrides,
    })
  }

  it('FULL RUN - imports every bar, across several pages', async () => {
    const provider = fakeProvider({ bars: makeBars(250, SERIES_START), pageSize: 100 })

    const result = await run(provider.fetch)

    // 250 inserted AND 3 noop. Each page resumes AT the frontier rather than
    // after it, so pages 2 and 3 re-offer their first bar, and a final request
    // returns only the overlap bar and ends the run. The overlap is deliberate:
    // it costs one bar per page and exercises the idempotent upsert on real
    // data every time a page boundary is crossed.
    expect(result.counts).toEqual({ ...emptyCounts(), inserted: 250, noop: 3 })
    expect(result.stoppedBecause).toBe('complete')
    expect(result.through?.toISOString()).toBe(
      new Date(SERIES_START + 249 * 15 * 60_000).toISOString(),
    )

    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM candles')
    expect(rows[0]?.count).toBe('250')
  })

  it('DUPLICATE RUN - imports nothing the second time, and every bar is a noop', async () => {
    const provider = fakeProvider({ bars: makeBars(250, SERIES_START), pageSize: 100 })

    await run(provider.fetch)
    const second = await run(provider.fetch)

    // THE PRODUCTION SHAPE OF "imports nothing the second time": the run resumes
    // from the frontier, asks once, gets back only the overlap bar, and stops.
    // It does NOT re-offer all 250 - that is the re-verification pass below.
    expect(second.counts).toEqual({ ...emptyCounts(), noop: 1 })
    expect(second.requestsMade).toBe(1)

    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM candles')
    expect(rows[0]?.count).toBe('250')
  })

  it('RE-VERIFICATION PASS - every stored bar is re-offered and every one is a noop', async () => {
    // resumeFrom 'from' re-offers the whole range. THIS is the run that proves
    // the idempotency claim across all 250 bars rather than across the one
    // overlap bar an ordinary resume happens to touch.
    const provider = fakeProvider({ bars: makeBars(250, SERIES_START), pageSize: 100 })
    await run(provider.fetch)

    const verify = await run(provider.fetch, { resumeFrom: 'from' })

    // The WHOLE histogram, not merely 'nothing was written' - a run that
    // fetched nothing also writes nothing and would satisfy the weaker claim.
    expect(verify.counts).toEqual({ ...emptyCounts(), noop: 253 })
    expect(verify.barsSeen).toBe(253)

    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM candles')
    expect(rows[0]?.count).toBe('250')
  })

  it('AN ORDINARY RESUMED RUN CANNOT SEE A CONFLICT BEHIND ITS FRONTIER', async () => {
    // A real limitation, tested so it is not mistaken for a guarantee. The
    // resumed run never asks for bar 10 again, so a provider restating it goes
    // unnoticed here. Catching that is T1.9's reconciliation job - ADR-008's
    // first reversal condition names it. 'The backfill would notice' is an easy
    // and wrong assumption to carry into Phase 9.
    const original = makeBars(250, SERIES_START)
    await run(fakeProvider({ bars: original, pageSize: 100 }).fetch)

    const restated = original.map((b, i) => (i === 10 ? { ...b, close: '4612.00000' } : b))
    const resumed = await run(fakeProvider({ bars: restated, pageSize: 100 }).fetch)

    expect(resumed.counts.conflict).toBe(0)

    // And the re-verification pass DOES see it - the control that shows the
    // miss above is about the frontier, not about a broken detector.
    await expect(
      run(fakeProvider({ bars: restated, pageSize: 100 }).fetch, { resumeFrom: 'from' }),
    ).rejects.toBeInstanceOf(BackfillConflictError)
  })

  it('DUPLICATE RUN - the second run really did fetch, so the noops are real', async () => {
    // Pairs with the test above. Without this, a backfill that silently
    // skipped every request would produce the same all-noop histogram.
    const provider = fakeProvider({ bars: makeBars(250, SERIES_START), pageSize: 100 })

    await run(provider.fetch)
    const afterFirst = provider.requests
    const second = await run(provider.fetch)

    expect(provider.requests).toBeGreaterThan(afterFirst)
    expect(second.requestsMade).toBeGreaterThan(0)
  })

  it('INTERRUPTED AND RESUMED - continues from the stored frontier, with no gap', async () => {
    const bars = makeBars(250, SERIES_START)
    const provider = fakeProvider({ bars, pageSize: 100 })

    // Interrupted after one page, exactly as a crash would leave it.
    const first = await run(provider.fetch, { maxPages: 1 })
    expect(first.stoppedBecause).toBe('maxPages')
    expect(first.counts.inserted).toBe(100)

    const resumed = await run(provider.fetch)

    // The overlap bar is re-offered and returns `noop` - which is the
    // idempotency claim being proved on the resume path rather than asserted.
    // 3 noops: the overlap bar at each of the two page boundaries, plus the
    // final request that returns only the overlap and ends the run.
    expect(resumed.counts.noop).toBe(3)
    expect(resumed.counts.inserted).toBe(150)
    expect(resumed.stoppedBecause).toBe('complete')

    const { rows } = await pool.query<{ count: string; min: Date; max: Date }>(
      'SELECT count(*)::text AS count, min(open_time) AS min, max(open_time) AS max FROM candles',
    )
    expect(rows[0]?.count).toBe('250')
    expect(rows[0]?.min.toISOString()).toBe(new Date(SERIES_START).toISOString())
    expect(rows[0]?.max.toISOString()).toBe(
      new Date(SERIES_START + 249 * 15 * 60_000).toISOString(),
    )
  })

  it('INTERRUPTED AND RESUMED - the stored bars are contiguous, not merely the right count', async () => {
    // A count plus endpoints would pass with a hole in the middle and a
    // duplicate elsewhere. This checks every step.
    const provider = fakeProvider({ bars: makeBars(250, SERIES_START), pageSize: 100 })
    await run(provider.fetch, { maxPages: 1 })
    await run(provider.fetch)

    const { rows } = await pool.query<{ gaps: string }>(
      `SELECT count(*)::text AS gaps FROM (
         SELECT open_time - lag(open_time) OVER (ORDER BY open_time) AS delta FROM candles
       ) d WHERE delta IS NOT NULL AND delta <> interval '15 minutes'`,
    )
    expect(rows[0]?.gaps).toBe('0')
  })

  it('a run against an empty series starts from `from`', async () => {
    const provider = fakeProvider({ bars: makeBars(10, SERIES_START), pageSize: 100 })

    const result = await run(provider.fetch, { from: new Date(SERIES_START) })

    expect(result.counts.inserted).toBe(10)
  })
})

describe('T1.4 backfill - a conflict stops the run at the first one', () => {
  let pool: Pool
  let series: BackfillSeries

  beforeAll(async () => {
    // migratedUrl, NOT a database this file migrates itself. ADR-003 makes
    // migrations a deliberate step and nothing under apps/ may import the
    // runner - the obligation 33 guard in wiring-assertions.test.ts enforces
    // that, and it caught the first version of this file doing exactly that.
    // The harness spawns the migrate binary instead.
    pool = new Pool({ connectionString: inject('migratedUrl') })
    const { rows } = await pool.query<{ instrument_id: number; provider_id: number }>(
      `SELECT pi.instrument_id, pi.provider_id FROM provider_instruments pi
         JOIN providers p ON p.id = pi.provider_id WHERE p.key = 'twelve_data'`,
    )
    series = {
      instrumentId: rows[0]?.instrument_id ?? 0,
      providerId: rows[0]?.provider_id ?? 0,
      timeframe: '15min',
      providerSymbol: 'XAU/USD',
      providerInterval: '15min',
    }
  })
  afterAll(async () => {
    await pool.end()
  })
  afterEach(async () => {
    await pool.query('DELETE FROM candles')
    await pool.query('DELETE FROM job_runs')
  })

  const immediate = <T>(fn: () => Promise<T>): Promise<T> => fn()

  it('THRESHOLD ONE - restated history stops the run immediately', async () => {
    const original = makeBars(50, SERIES_START)
    const first = fakeProvider({ bars: original, pageSize: 100 })

    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: first.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
    })

    // The provider restates bar 10's close. This is ADR-008's first reversal
    // condition, in miniature.
    // The restated close must stay inside [low, high]: 9999 violates
    // candles_high_check and the row is refused at the boundary before the
    // conflict classifier sees it, which tests the CHECK rather than the
    // conflict. Bar 10 is low 4605 / high 4615, so 4612 is a real restatement.
    const restated = original.map((bar, i) => (i === 10 ? { ...bar, close: '4612.00000' } : bar))
    const second = fakeProvider({ bars: restated, pageSize: 100 })

    await expect(
      runBackfill({
        pool,
        client: new TwelveDataClient({ fetch: second.fetch, apiKey: API_KEY }),
        pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
        series,
        from: new Date(SERIES_START),
        pageSize: 100,
        withRetry: immediate,
        resumeFrom: 'from',
      }),
    ).rejects.toBeInstanceOf(BackfillConflictError)
  })

  it('the stored bar is NOT overwritten - §7, never silently repair', async () => {
    const original = makeBars(50, SERIES_START)
    const first = fakeProvider({ bars: original, pageSize: 100 })
    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: first.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
    })

    // The restated close must stay inside [low, high]: 9999 violates
    // candles_high_check and the row is refused at the boundary before the
    // conflict classifier sees it, which tests the CHECK rather than the
    // conflict. Bar 10 is low 4605 / high 4615, so 4612 is a real restatement.
    const restated = original.map((bar, i) => (i === 10 ? { ...bar, close: '4612.00000' } : bar))
    const second = fakeProvider({ bars: restated, pageSize: 100 })
    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: second.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
      resumeFrom: 'from',
    }).catch(() => undefined)

    const { rows } = await pool.query<{ close: string }>(
      `SELECT close FROM candles WHERE open_time = $1`,
      [new Date(SERIES_START + 10 * 15 * 60_000)],
    )
    expect(rows[0]?.close).toBe('4611.00000')
  })

  it('CONTROL: an unchanged re-run does NOT stop - the detector is not stuck on conflict', async () => {
    // Without this, a runBackfill that threw on every second run would pass the
    // test above.
    const original = makeBars(50, SERIES_START)
    const provider = fakeProvider({ bars: original, pageSize: 100 })
    const args = {
      pool,
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
    }

    await runBackfill({
      ...args,
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
    })

    // Re-offers the WHOLE range, exactly as the conflict tests above do. A
    // control that resumed from the frontier would pass by never looking at
    // the bars in question, which proves nothing about the detector.
    const again = await runBackfill({
      ...args,
      resumeFrom: 'from',
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
    })

    expect(again.counts.conflict).toBe(0)
    expect(again.counts.noop).toBe(51)
  })
})

describe('T1.4 - job_runs lifecycle and the stale-row refusal', () => {
  let pool: Pool

  beforeAll(async () => {
    // migratedUrl, NOT a database this file migrates itself. ADR-003 makes
    // migrations a deliberate step and nothing under apps/ may import the
    // runner - the obligation 33 guard in wiring-assertions.test.ts enforces
    // that, and it caught the first version of this file doing exactly that.
    // The harness spawns the migrate binary instead.
    pool = new Pool({ connectionString: inject('migratedUrl') })
  })
  afterAll(async () => {
    await pool.end()
  })
  afterEach(async () => {
    await pool.query('DELETE FROM job_runs')
  })

  it('opens a run', async () => {
    const run = await openRun({ pool, jobName: 'backfill' })
    expect(run.adopted).toBe(false)

    const { rows } = await pool.query<{ status: string }>('SELECT status FROM job_runs')
    expect(rows[0]?.status).toBe('running')
  })

  it('REFUSES to open a second run while one is marked running', async () => {
    await openRun({ pool, jobName: 'backfill' })

    await expect(openRun({ pool, jobName: 'backfill' })).rejects.toBeInstanceOf(StaleRunError)
  })

  it('the refusal says what to CHECK before it says what to type', async () => {
    // At 3am "pass --resume" reads as an instruction to pass --resume. An
    // operator who does that while the previous worker is alive starts a
    // second writer - the exact failure the unique index prevents, defeated by
    // the message meant to help.
    await openRun({ pool, jobName: 'backfill' })
    const error = await openRun({ pool, jobName: 'backfill' }).catch((e: unknown) => e)
    const message = (error as StaleRunError).message

    expect(message).toContain('CONFIRM NO OTHER WORKER IS RUNNING')
    expect(message).toContain('LET IT FINISH')

    // The check must come BEFORE the flag, or the reader acts on the flag.
    expect(message.indexOf('CONFIRM NO OTHER WORKER IS RUNNING')).toBeLessThan(
      message.indexOf('--resume'),
    )
    expect(message).toContain('Nothing is lost')
  })

  it('--resume adopts the stale row as `interrupted`, not `failed`', async () => {
    // A distinct status so abandoned runs can be counted without inflating the
    // failure count.
    const first = await openRun({ pool, jobName: 'backfill' })
    const second = await openRun({ pool, jobName: 'backfill', adoptStale: true })

    expect(second.adopted).toBe(true)

    const { rows } = await pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM job_runs ORDER BY started_at',
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === first.id)?.status).toBe('interrupted')
    expect(rows.find((r) => r.id === second.id)?.status).toBe('running')
  })

  it('a different job is unaffected by a running one', async () => {
    await openRun({ pool, jobName: 'backfill' })
    await expect(openRun({ pool, jobName: 'aggregate' })).resolves.toBeDefined()
  })

  it('closes a run with its counts', async () => {
    const run = await openRun({ pool, jobName: 'backfill' })
    await closeRun({
      pool,
      id: run.id,
      status: 'succeeded',
      counts: { ...emptyCounts(), inserted: 250, noop: 3 },
      requestsMade: 4,
    })

    const { rows } = await pool.query<{
      status: string
      bars_inserted: number
      bars_noop: number
      requests_made: number
      finished_at: Date | null
    }>('SELECT status, bars_inserted, bars_noop, requests_made, finished_at FROM job_runs')

    expect(rows[0]?.status).toBe('succeeded')
    expect(rows[0]?.bars_inserted).toBe(250)
    expect(rows[0]?.bars_noop).toBe(3)
    expect(rows[0]?.requests_made).toBe(4)
    expect(rows[0]?.finished_at).not.toBeNull()
  })

  it('a closed run frees the job for the next one', async () => {
    const run = await openRun({ pool, jobName: 'backfill' })
    await closeRun({
      pool,
      id: run.id,
      status: 'succeeded',
      counts: emptyCounts(),
      requestsMade: 0,
    })

    await expect(openRun({ pool, jobName: 'backfill' })).resolves.toBeDefined()
  })
})
