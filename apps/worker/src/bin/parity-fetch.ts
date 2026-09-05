/**
 * T1.4 step 8 — the parity fetches obligation 41 requires. THREE requests.
 *
 * Run: pnpm parity-fetch
 *
 * 15m, 1H and 1D, each covering the golden fixture's range PLUS the 1000-bar
 * warm-up an EMA200 needs before it is trustworthy. 1H and 1D are FETCHED, not
 * derived - obligation 41 records why: it specifies BAR COUNTS, and 1,299 daily
 * bars is five years, which is ~135,000 bars of 15M to aggregate against one
 * request to fetch.
 *
 * THIS DOES NOT REVERSE ADR-008. The 15M spine and T1.6 aggregation stand; the
 * ADR already provides for fetching the provider's own aggregate as a
 * regression assertion rather than as a source, and this is that provision used
 * for a second purpose.
 *
 * EACH EXPECTATION IS PRINTED BEFORE ITS REQUEST and checked after, so a number
 * that comes back wrong is visible as wrong rather than absorbed.
 *
 * THIS COMMENT WAS WRONG WHEN THIS RAN, and the correction is left here rather
 * than quietly fixed. It claimed one request each because `end_date` is not
 * sent. It IS sent: `runBackfill` sends it whenever `to` is set. So the response
 * stops exactly at the boundary, nothing in it proves the last bar closed, that
 * bar is stored FORMING, the frontier never reaches `to`, and each leg costs a
 * SECOND request. Six requests, not three.
 *
 * I asserted a behaviour of code I had written without reading it. The job was
 * correct throughout; the prediction was not. Obligation 48 carries the fix.
 *
 * Never prints the key.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { createPacer, createFileCaptureSink, TwelveDataClient, withRetry } from '@karatx/providers'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

import { requireTwelveDataApiKey, runBackfill, type BackfillSeries } from '../jobs/backfill'

const REPO_ROOT = findRepoRoot()
const CAPTURE_ROOT = join(REPO_ROOT, 'var/captures')

interface Leg {
  readonly label: string
  /** Our timeframe, as stored. */
  readonly timeframe: string
  /** The provider's interval string. */
  readonly interval: string
  readonly from: string
  readonly to: string
  /** The golden fixture's own range, which the window must cover. */
  readonly fixtureFirst: string
  readonly fixtureLast: string
  readonly expectation: string
  readonly expectMinBars: number
}

/**
 * Windows from obligation 41: 1000 bars of warm-up before the first golden bar,
 * through the last golden bar.
 */
const LEGS: readonly Leg[] = [
  {
    label: '15m',
    timeframe: '15min',
    interval: '15min',
    from: '2026-08-13 00:00:00',
    to: '2026-09-02 15:15:00',
    fixtureFirst: '2026-08-28 09:45:00',
    fixtureLast: '2026-09-02 15:15:00',
    expectation:
      '~1,980 bars. 2026 is the 24/7 era for this provider (ADR-008 measured 96 weekend\n' +
      '    bars per weekend DAY at 15min from 2026), so 20.6 calendar days x 96. Must be at\n' +
      '    least 1,299 - obligation 41 needs 1000 warm-up + 299 fixture bars.\n' +
      '    applied: 0. A bounded single-page fetch stores everything final.',
    expectMinBars: 1299,
  },
  {
    label: '1H',
    timeframe: '1h',
    interval: '1h',
    from: '2026-06-15 00:00:00',
    to: '2026-09-02 14:00:00',
    fixtureFirst: '2026-08-14 15:00:00',
    fixtureLast: '2026-09-02 14:00:00',
    expectation:
      '~1,910 bars. 79.6 calendar days x 24, same 24/7 era. Must be at least 1,299.\n' +
      '    applied: 0.',
    expectMinBars: 1299,
  },
  {
    label: '1D',
    timeframe: '1D',
    interval: '1day',
    from: '2021-09-01 00:00:00',
    to: '2026-08-31 21:00:00',
    fixtureFirst: '2025-07-06 21:00:00',
    fixtureLast: '2026-08-31 21:00:00',
    expectation:
      '~1,430 bars. Weekday-only before the mid-2025 weekend-synthesis boundary\n' +
      '    (1,382 days x 5/7 = 987) and 7 days a week after (444). Must be at least 1,299.\n' +
      '    OQ-5: `datetime` predicted DATE-ONLY.\n' +
      '    OQ-9: NOT ANSWERABLE by this request - the window returns far fewer than 5,000\n' +
      '    bars, so nothing tests the cap. It stays OPEN.\n' +
      '    WEEKEND BARS WILL BE STORED AND THAT IS EXPECTED, not a defect: the calendar\n' +
      '    is T1.5 and does not exist yet. Counted, not filtered.\n' +
      '    AND WATCH THE ALIGNMENT: the fixture stamps daily bars 21:00Z (17:00 New York).\n' +
      '    A date-only `datetime` parses to 00:00Z, which is a DIFFERENT daily boundary -\n' +
      '    UTC days rather than trading days.',
    expectMinBars: 1299,
  },
]

function line(label: string, value: string): void {
  process.stdout.write(`    ${label.padEnd(26)} ${value}\n`)
}

/** Credits consumed, read from the captured response headers. */
function creditsFrom(runId: string): { used: string; left: string; pages: number } {
  const dir = join(CAPTURE_ROOT, runId)
  const pages = readdirSync(dir).filter((f) => f.startsWith('page-'))
  let used = '(absent)'
  let left = '(absent)'
  for (const f of pages.sort()) {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      headers: Record<string, string>
    }
    used = rec.headers['api-credits-used'] ?? used
    left = rec.headers['api-credits-left'] ?? left
  }
  return { used, left, pages: pages.length }
}

async function main(): Promise<void> {
  loadEnvFileIfPresent()
  const apiKey = requireTwelveDataApiKey(loadConfig().twelveDataApiKey)
  const pool = new Pool({ connectionString: loadConfig().databaseUrl.reveal() })

  const { rows } = await pool.query<{ instrument_id: number; provider_id: number; symbol: string }>(
    `SELECT pi.instrument_id, pi.provider_id, pi.provider_symbol AS symbol
       FROM provider_instruments pi
       JOIN providers p ON p.id = pi.provider_id
       JOIN instruments i ON i.id = pi.instrument_id
      WHERE p.key = 'twelve_data' AND i.symbol = 'XAU/USD'`,
  )
  const seeded = rows[0]
  if (seeded === undefined) throw new Error('twelve_data + XAU/USD not seeded')

  // Shared pacer, so the three requests respect the per-minute limit together.
  const pacer = createPacer()
  let totalRequests = 0

  // Optional leg filter: `pnpm parity-fetch 15m,1H`. A re-run should cost only
  // the legs that need re-running, not all three.
  const only = process.argv
    .slice(2)
    .flatMap((a) => a.split(','))
    .filter(Boolean)
  const legs = only.length === 0 ? LEGS : LEGS.filter((l) => only.includes(l.label))
  if (legs.length === 0) throw new Error(`no legs match: ${only.join(', ')}`)

  process.stdout.write(`\nT1.4 PARITY FETCHES: ${legs.map((l) => l.label).join(', ')}\n`)

  for (const leg of legs) {
    process.stdout.write(`\n${'='.repeat(70)}\n${leg.label}\n${'='.repeat(70)}\n`)
    process.stdout.write(`\n  EXPECTED, before the request:\n    ${leg.expectation}\n\n`)
    line('window', `${leg.from} .. ${leg.to}`)
    line('fixture range', `${leg.fixtureFirst} .. ${leg.fixtureLast}`)
    line('minimum bars required', String(leg.expectMinBars))

    const runId = `parity-${leg.label}-${new Date().toISOString().replace(/[:.]/g, '-')}`
    const series: BackfillSeries = {
      instrumentId: seeded.instrument_id,
      providerId: seeded.provider_id,
      timeframe: leg.timeframe,
      providerSymbol: seeded.symbol,
      providerInterval: leg.interval,
    }

    const result = await runBackfill({
      pool,
      client: new TwelveDataClient({
        fetch: globalThis.fetch,
        apiKey,
        capture: createFileCaptureSink(CAPTURE_ROOT),
        runId,
      }),
      pacer,
      series,
      from: new Date(`${leg.from.replace(' ', 'T')}Z`),
      to: new Date(`${leg.to.replace(' ', 'T')}Z`),
      pageSize: 5000,
      withRetry: (fn, describe) => withRetry(fn, { describe }),
    })

    totalRequests += result.requestsMade

    const stored = await pool.query<{
      count: string
      first: Date
      last: Date
      forming: string
      weekend: string
    }>(
      `SELECT count(*)::text AS count,
              min(open_time) AS first,
              max(open_time) AS last,
              count(*) FILTER (WHERE NOT is_final)::text AS forming,
              count(*) FILTER (WHERE extract(isodow from open_time) IN (6,7))::text AS weekend
         FROM candles
        WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3`,
      [series.instrumentId, series.providerId, series.timeframe],
    )
    const s = stored.rows[0]
    const credits = creditsFrom(runId)
    const count = Number(s?.count ?? 0)

    process.stdout.write('\n  OBSERVED:\n')
    line('bars stored', String(count))
    line('first open_time', s?.first?.toISOString() ?? '-')
    line('last open_time', s?.last?.toISOString() ?? '-')
    line('still forming', s?.forming ?? '-')
    line('weekend bars (Sat/Sun UTC)', s?.weekend ?? '-')
    line('requests', String(result.requestsMade))
    line('credits used / left', `${credits.used} / ${credits.left}`)
    line('inserted', String(result.counts.inserted))
    line('applied', String(result.counts.applied))
    line('noop', String(result.counts.noop))
    line('conflict', String(result.counts.conflict))

    process.stdout.write('\n  CHECKS:\n')
    const enough = count >= leg.expectMinBars
    line(
      '>= minimum bars',
      enough ? `YES (${String(count)} >= ${String(leg.expectMinBars)})` : 'NO',
    )

    const first = s?.first
    const last = s?.last
    const fFirst = new Date(`${leg.fixtureFirst.replace(' ', 'T')}Z`)
    const fLast = new Date(`${leg.fixtureLast.replace(' ', 'T')}Z`)
    const coversFixture =
      first !== undefined && last !== undefined && first <= fFirst && last >= fLast
    line('covers fixture range', coversFixture ? 'YES' : 'NO')

    const warmup = first === undefined ? 0 : await countBefore(pool, series, fFirst)
    line('warm-up bars before first golden', `${String(warmup)} (obligation 41 needs 1000)`)
    line('warm-up sufficient', warmup >= 1000 ? 'YES' : 'NO')

    line(
      'applied as predicted (0)',
      result.counts.applied === 0 ? 'YES' : `NO - ${String(result.counts.applied)}`,
    )
    line(
      'one request as predicted',
      result.requestsMade === 1 ? 'YES' : `NO - ${String(result.requestsMade)}`,
    )

    if (leg.label === '1D') {
      const raw = await pool.query<{ raw_datetime: string }>(
        `SELECT raw_datetime FROM candles
          WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3
          ORDER BY open_time LIMIT 3`,
        [series.instrumentId, series.providerId, series.timeframe],
      )
      process.stdout.write('\n  OQ-5 - the 1day datetime format:\n')
      line('predicted', 'DATE-ONLY')
      for (const r of raw.rows) line('raw_datetime', JSON.stringify(r.raw_datetime))
      const dateOnly = raw.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.raw_datetime))
      line('OBSERVED', dateOnly ? 'DATE-ONLY' : 'DATETIME')
      line('prediction', dateOnly ? 'HELD' : 'DID NOT HOLD')

      process.stdout.write('\n  OQ-9 - outputsize cap at 1day:\n')
      line('OBSERVED', `NOT ANSWERED - ${String(count)} bars is far below 5,000`)
      line('status', 'STAYS OPEN, not closed on inference')
    }
  }

  process.stdout.write(`\n${'='.repeat(70)}\nTOTAL: ${String(totalRequests)} requests\n`)
  process.stdout.write('Estimate for step 8 was 3 requests, 3 credits.\n\n')

  await pool.end()
}

async function countBefore(pool: Pool, series: BackfillSeries, before: Date): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM candles
      WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3 AND open_time < $4`,
    [series.instrumentId, series.providerId, series.timeframe, before],
  )
  return Number(rows[0]?.n ?? 0)
}

await main()
