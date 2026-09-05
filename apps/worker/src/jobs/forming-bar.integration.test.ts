import { Secret } from '@karatx/config'
import { createPacer, TwelveDataClient, type FetchLike, type HttpResponse } from '@karatx/providers'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import {
  BackfillConflictError,
  runBackfill,
  toProviderDatetime,
  type BackfillSeries,
} from './backfill'

/**
 * OBLIGATION 47 — the forming bar must not be stored as final.
 *
 * OQ-12 measured that `/time_series` returns the currently-forming bar: older
 * bars were byte-identical across two calls while the newest changed in the
 * forming shape (open unchanged, high non-decreasing, low non-increasing, close
 * free). A backfill that marks every bar `is_final: true` therefore records
 * PARTIAL values as SETTLED HISTORY.
 *
 * THE DEADLOCK THIS REPRODUCES, which was reasoning until this file existed:
 *
 *   run 1  stores the forming bar as FINAL
 *   run 2  resumes AT that bar, receives its COMPLETED values, and the upsert
 *          reports `conflict` against a stored FINAL bar
 *   CONFLICT_THRESHOLD = 1 stops the run
 *   run 3  does exactly the same, for ever
 *
 * The conflict sits on the FRONTIER bar, which is the first bar of every
 * subsequent run's first page, so the backfill is permanently blocked until
 * someone deletes the row - and the fastest reading of that at 3am is "the
 * provider is restating history", which is the wrong conclusion.
 *
 * These tests assert the CORRECT end state, so they fail while the defect
 * exists and pass once it is fixed. The deadlock is asserted SPECIFICALLY -
 * that it repeats and makes no progress - rather than merely that something
 * threw.
 */

const API_KEY = new Secret('td-test-key-0123456789')
const SERIES_START = Date.parse('2026-01-01T00:00:00Z')
const INTERVAL_MS = 15 * 60_000

interface Bar {
  datetime: string
  open: string
  high: string
  low: string
  close: string
}

function bar(i: number, overrides: Partial<Bar> = {}): Bar {
  const base = 4600 + i
  return {
    datetime: toProviderDatetime(new Date(SERIES_START + i * INTERVAL_MS)),
    open: `${String(base)}.10000`,
    high: `${String(base + 5)}.00000`,
    low: `${String(base - 5)}.00000`,
    close: `${String(base + 1)}.00000`,
    ...overrides,
  }
}

/**
 * A provider whose bar set can be swapped between runs, so the SAME bar can be
 * served partial and then completed - which is what a forming bar does.
 */
function mutableProvider(initial: Bar[]): { fetch: FetchLike; setBars: (b: Bar[]) => void } {
  let bars = initial

  const fetch: FetchLike = async (url) => {
    const params = new URL(url).searchParams
    const start = params.get('start_date')
    // `end_date` IS HONOURED, AND ITS ABSENCE HERE HID A REAL DEFECT.
    //
    // This double ignored `end_date` until 2026-09-05. `runBackfill` sends it
    // whenever `to` is set, so a bounded run's response really does stop at the
    // boundary - but the double handed back bars past it, which the real
    // provider never would. The bounded test therefore passed while step 8
    // failed against the live API, and obligation 48 is the result.
    //
    // A TEST DOUBLE THAT IGNORES A PARAMETER THE CODE SENDS CANNOT TEST THE
    // BEHAVIOUR THAT PARAMETER CAUSES. It does not merely fail to cover it - it
    // actively reports the opposite.
    const end = params.get('end_date')
    const size = Number(params.get('outputsize') ?? 5000)

    let selected = bars
    if (start !== null) selected = selected.filter((b) => b.datetime >= start)
    if (end !== null) selected = selected.filter((b) => b.datetime <= end)
    // ANCHORED ON THE NEWEST BARS, LIKE THE REAL API - measured at step 9.
    //
    // `start_date=2020-01-24` with `outputsize=5000` returns the most recent
    // 5,000 bars in the range, NOT the oldest. This double sliced from the
    // START of the filtered range until 2026-09-05, which is the behaviour the
    // real API does not have, so no test could detect a bug in WHICH END the
    // provider anchors on. Obligation 50.
    selected = selected.slice(-size)

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
    setBars: (b) => {
      bars = b
    },
  }
}

describe('obligation 47 - a bar that was forming when first fetched', () => {
  let pool: Pool
  let series: BackfillSeries

  beforeAll(async () => {
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
  })

  const immediate = <T>(fn: () => Promise<T>): Promise<T> => fn()

  function run(fetch: FetchLike) {
    return runBackfill({
      pool,
      client: new TwelveDataClient({ fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
    })
  }

  /** The partial bar, then the same bar completed - the OQ-12 shape exactly. */
  const PARTIAL = bar(9, { low: '4604.00000', close: '4605.00000' })
  const COMPLETED = bar(9, { low: '4601.00000', close: '4606.50000' })

  it('is stored as FORMING, not final, so it is not settled history', async () => {
    const provider = mutableProvider([...Array.from({ length: 9 }, (_, i) => bar(i)), PARTIAL])

    await run(provider.fetch)

    const { rows } = await pool.query<{ open_time: Date; is_final: boolean }>(
      'SELECT open_time, is_final FROM candles ORDER BY open_time',
    )

    expect(rows).toHaveLength(10)
    // Every bar EXCEPT the newest is final: a later bar existing in the same
    // response proves the earlier one closed. No clock is consulted.
    expect(rows.slice(0, 9).every((r) => r.is_final)).toBe(true)
    expect(rows[9]?.is_final, 'the newest bar of the page must not be final').toBe(false)
  })

  it('DOES NOT DEADLOCK - the next run finalises it with the completed values', async () => {
    // The test that fails while obligation 47 stands.
    const provider = mutableProvider([...Array.from({ length: 9 }, (_, i) => bar(i)), PARTIAL])
    await run(provider.fetch)

    // The bar closes, and a new one opens behind it.
    provider.setBars([...Array.from({ length: 9 }, (_, i) => bar(i)), COMPLETED, bar(10)])

    const second = await run(provider.fetch)

    expect(second.counts.conflict, 'a forming bar completing is NOT a conflict').toBe(0)
    // `applied` is the ADR-013 outcome for a forming bar rewritten and
    // finalised. It is EXPECTED here, and the backfill comment that said it
    // must never appear was written before OQ-12.
    expect(second.counts.applied).toBeGreaterThan(0)

    const { rows } = await pool.query<{ close: string; is_final: boolean }>(
      'SELECT close, is_final FROM candles WHERE open_time = $1',
      [new Date(SERIES_START + 9 * INTERVAL_MS)],
    )
    expect(rows[0]?.close, 'the completed values must replace the partial ones').toBe('4606.50000')
    expect(rows[0]?.is_final, 'and it is now settled').toBe(true)
  })

  it('a third run still makes progress - the deadlock does not merely move', async () => {
    // Asserting the DEADLOCK specifically rather than "an error was thrown":
    // the failure mode is that every subsequent run refuses at the same bar
    // and stores nothing. A run that succeeds twice cannot be deadlocked.
    const provider = mutableProvider([...Array.from({ length: 9 }, (_, i) => bar(i)), PARTIAL])
    await run(provider.fetch)

    provider.setBars([...Array.from({ length: 9 }, (_, i) => bar(i)), COMPLETED, bar(10)])
    await run(provider.fetch)

    provider.setBars([...Array.from({ length: 9 }, (_, i) => bar(i)), COMPLETED, bar(10), bar(11)])
    const third = await run(provider.fetch)

    expect(third.counts.conflict).toBe(0)

    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM candles',
    )
    expect(rows[0]?.count, 'the run kept importing rather than refusing').toBe('12')
  })

  it('THE FRONTIER IS THE LAST CLOSED BAR, not the forming one', async () => {
    // latestFinalOpenTime filters on is_final, so a forming bar cannot be the
    // resume point. CONFIRMED here rather than assumed, because it changes the
    // overlap: a resumed run now re-fetches the last closed bar AND the forming
    // one, so the overlap is two bars rather than one.
    const provider = mutableProvider([...Array.from({ length: 9 }, (_, i) => bar(i)), PARTIAL])
    const first = await run(provider.fetch)

    // Bar 8 is the last CLOSED bar; bar 9 is forming.
    expect(first.through?.toISOString()).toBe(
      new Date(SERIES_START + 8 * INTERVAL_MS).toISOString(),
    )

    provider.setBars([...Array.from({ length: 9 }, (_, i) => bar(i)), COMPLETED, bar(10)])
    const second = await run(provider.fetch)

    // Bar 8 re-offered (noop) and bar 9 re-offered (applied): the two-bar overlap.
    expect(second.counts.noop).toBeGreaterThanOrEqual(1)
    expect(second.counts.applied).toBe(1)
  })

  it('never reports `rejected` - that would mean our finality logic is wrong', async () => {
    // `rejected` is a final bar re-delivered as forming. It can only happen if
    // we downgrade a bar we previously settled, which is a defect in this file
    // rather than anything the provider did.
    const provider = mutableProvider([...Array.from({ length: 9 }, (_, i) => bar(i)), PARTIAL])
    await run(provider.fetch)
    provider.setBars([...Array.from({ length: 9 }, (_, i) => bar(i)), COMPLETED, bar(10)])
    const second = await run(provider.fetch)
    const third = await run(provider.fetch)

    expect(second.counts.rejected).toBe(0)
    expect(third.counts.rejected).toBe(0)
  })
})

describe('obligation 47 - a bar trimmed by `to` still proves its predecessor closed', () => {
  let pool: Pool
  let series: BackfillSeries

  beforeAll(async () => {
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
  })

  const immediate = <T>(fn: () => Promise<T>): Promise<T> => fn()

  it('stores every bar FINAL when the response ran past `to`', async () => {
    // The provider sent 20 bars; `to` keeps 10. Bar 9 has a successor in the
    // RESPONSE even though we declined to store it, so bar 9 is closed and
    // storing it forming would discard evidence we were handed.
    const provider = mutableProvider(Array.from({ length: 20 }, (_, i) => bar(i)))

    const result = await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      to: new Date(SERIES_START + 9 * INTERVAL_MS),
      pageSize: 100,
      withRetry: immediate,
    })

    const { rows } = await pool.query<{ is_final: boolean }>(
      'SELECT is_final FROM candles ORDER BY open_time',
    )
    expect(rows).toHaveLength(10)
    expect(
      rows.every((r) => r.is_final),
      'every bar within `to` is closed',
    ).toBe(true)

    // And it therefore costs ONE request, not two: the frontier reached `to`,
    // so there is no extra overlap page. That is what makes a bounded parity
    // fetch a single request.
    expect(result.requestsMade).toBe(1)
    expect(result.through?.toISOString()).toBe(
      new Date(SERIES_START + 9 * INTERVAL_MS).toISOString(),
    )
  })

  it('DISCARDS the bar past `to` rather than storing it', async () => {
    // The extra bar is fetched to PROVE CLOSURE and then thrown away. Storing
    // it would quietly widen every bounded run by one bar, which is the sort of
    // off-by-one that shows up months later as a window nobody can reconcile.
    const provider = mutableProvider(Array.from({ length: 20 }, (_, i) => bar(i)))

    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      to: new Date(SERIES_START + 9 * INTERVAL_MS),
      pageSize: 100,
      withRetry: immediate,
    })

    const { rows } = await pool.query<{ count: string; last: Date }>(
      'SELECT count(*)::text AS count, max(open_time) AS last FROM candles',
    )

    // EXACTLY the window: 10 bars, not 11.
    expect(rows[0]?.count, 'the bar past `to` must not be stored').toBe('10')
    expect(rows[0]?.last.toISOString()).toBe(new Date(SERIES_START + 9 * INTERVAL_MS).toISOString())
  })

  it('when `to` reaches the PRESENT there is no bar past it, so the last bar stays FORMING', async () => {
    // The distinction the code has to make, and it makes it from the RESPONSE:
    //   a bar came back past `to` and was trimmed  -> a successor exists -> FINAL
    //   nothing came back past `to`                -> no successor       -> FORMING
    // Here the provider has nothing after bar 19, so asking past it returns
    // nothing and bar 19 is genuinely still forming.
    const provider = mutableProvider(Array.from({ length: 20 }, (_, i) => bar(i)))

    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      to: new Date(SERIES_START + 19 * INTERVAL_MS),
      pageSize: 100,
      withRetry: immediate,
    })

    const { rows } = await pool.query<{ is_final: boolean }>(
      'SELECT is_final FROM candles ORDER BY open_time',
    )
    expect(rows).toHaveLength(20)
    expect(rows.slice(0, 19).every((r) => r.is_final)).toBe(true)
    expect(rows[19]?.is_final, 'nothing proves bar 19 closed, so it stays forming').toBe(false)
  })
  it('CONTROL: without `to`, the last bar is still forming', async () => {
    // Pairs with the test above. Without it, "everything is final" could be
    // true because the forming rule stopped working rather than because the
    // trim proved closure.
    const provider = mutableProvider(Array.from({ length: 20 }, (_, i) => bar(i)))

    await runBackfill({
      pool,
      client: new TwelveDataClient({ fetch: provider.fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      pageSize: 100,
      withRetry: immediate,
    })

    const { rows } = await pool.query<{ is_final: boolean }>(
      'SELECT is_final FROM candles ORDER BY open_time',
    )
    expect(rows).toHaveLength(20)
    expect(rows[19]?.is_final).toBe(false)
  })
})

describe('obligation 51 - a NARROWING revision is counted, not fatal', () => {
  let pool: Pool
  let series: BackfillSeries

  beforeAll(async () => {
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
  })

  const immediate = <T>(fn: () => Promise<T>): Promise<T> => fn()

  function run(fetch: FetchLike, onRevision?: (r: unknown) => void) {
    return runBackfill({
      pool,
      client: new TwelveDataClient({ fetch, apiKey: API_KEY }),
      pacer: createPacer({ now: () => 0, sleep: async () => undefined }),
      series,
      from: new Date(SERIES_START),
      resumeFrom: 'from',
      pageSize: 100,
      withRetry: immediate,
      ...(onRevision === undefined ? {} : { onRevision }),
    })
  }

  it('does NOT stop the run, and is recorded per bar', async () => {
    // The behaviour obligation 51 changes. At the measured 0.2% revision rate a
    // stop-at-one backfill can never cross its own overlap.
    const original = Array.from({ length: 30 }, (_, i) => bar(i))
    const provider = mutableProvider(original)
    await run(provider.fetch)

    // Bar 5's high moves DOWN — the shape all four observed revisions had.
    // 4608, not 4603: bar 5 closes at 4606, and a high below the close is
    // refused by candles_high_check before the classifier runs. Same trap as
    // the step 6 conflict fixture - the constraints keep catching invalid
    // synthetic revisions, which is them working.
    const narrowedBars = original.map((b, i) => (i === 5 ? { ...b, high: '4608.00000' } : b))
    provider.setBars(narrowedBars)

    const seen: unknown[] = []
    const second = await run(provider.fetch, (r) => seen.push(r))

    expect(second.counts.conflict, 'a narrowing is not counted as a conflict').toBe(0)
    expect(second.narrowed).toBe(1)
    expect(second.stoppedBecause).toBe('complete')

    // PER BAR, with both sides, so the rate and the shape are measurable later.
    expect(seen).toHaveLength(1)
    const record = seen[0] as {
      changed: string[]
      stored: { high: string }
      incoming: { high: string }
    }
    expect(record.changed).toEqual(['high'])
    expect(record.stored.high).toBe('4610.00000')
    expect(record.incoming.high).toBe('4608.00000')
  })

  it('the stored bar is NOT overwritten by a narrowing - §7 still holds', async () => {
    // Counted and recorded is not the same as accepted. ADR-013 keeps finalised
    // history; the narrowing is evidence, not an instruction.
    const original = Array.from({ length: 30 }, (_, i) => bar(i))
    const provider = mutableProvider(original)
    await run(provider.fetch)

    provider.setBars(original.map((b, i) => (i === 5 ? { ...b, high: '4608.00000' } : b)))
    await run(provider.fetch)

    const { rows } = await pool.query<{ high: string }>(
      'SELECT high FROM candles WHERE open_time = $1',
      [new Date(SERIES_START + 5 * INTERVAL_MS)],
    )
    expect(rows[0]?.high).toBe('4610.00000')
  })

  it('CONTROL: a WIDENING revision still stops the run at one', async () => {
    // The case stop-at-one was built for. Without this, "the run completed"
    // could mean the classifier waved everything through.
    const original = Array.from({ length: 30 }, (_, i) => bar(i))
    const provider = mutableProvider(original)
    await run(provider.fetch)

    // high moves UP: ticks added, not removed. Not a narrowing.
    provider.setBars(original.map((b, i) => (i === 5 ? { ...b, high: '4620.00000' } : b)))

    await expect(run(provider.fetch)).rejects.toBeInstanceOf(BackfillConflictError)
  })

  it('CONTROL: a changed CLOSE still stops the run at one', async () => {
    const original = Array.from({ length: 30 }, (_, i) => bar(i))
    const provider = mutableProvider(original)
    await run(provider.fetch)

    provider.setBars(
      original.map((b, i) => (i === 5 ? { ...b, high: '4608.00000', close: '4607.00000' } : b)),
    )

    await expect(run(provider.fetch)).rejects.toBeInstanceOf(BackfillConflictError)
  })
})
