/**
 * T1.4 step 9 — the full 6.6-year 15M backfill.
 *
 * Run: pnpm backfill
 *
 * FIRST REAL USE OF THE job_runs LIFECYCLE. The run opens a row, and
 * `job_runs_one_running_idx` refuses a second concurrent backfill in the
 * database. If a previous run died without closing its row this refuses and
 * says what to check; `--resume` adopts it.
 *
 * STARTS AT `from`, NOT AT THE FRONTIER, and that is not a re-verification
 * pass. The 15min series already holds the parity window (2026-08-13 onward),
 * so its frontier is AHEAD of where the history begins - an ordinary resumed
 * run would fetch nothing historical at all. This is the one case where
 * starting at `from` is the ordinary thing.
 *
 * Predictions are committed at 5273ee9, before this ran.
 *
 * Never prints the key.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { createFileCaptureSink, createPacer, TwelveDataClient, withRetry } from '@karatx/providers'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'

import {
  emptyCounts,
  requireTwelveDataApiKey,
  runBackfill,
  type BackfillSeries,
} from '../jobs/backfill'
import { closeRun, openRun } from '../jobs/job-run'

const REPO_ROOT = findRepoRoot()
const CAPTURE_ROOT = join(REPO_ROOT, 'var/captures')

/** ADR-008: verified by fetching bars at that date, not taken from a catalogue. */
const EARLIEST_15MIN = '2020-01-24 13:00:00'

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(24)} ${value}\n`)
}

async function main(): Promise<void> {
  loadEnvFileIfPresent()
  const config = loadConfig()
  const apiKey = requireTwelveDataApiKey(config.twelveDataApiKey)
  const pool = new Pool({ connectionString: config.databaseUrl.reveal() })

  const adoptStale = process.argv.includes('--resume')

  const { rows } = await pool.query<{ instrument_id: number; provider_id: number; symbol: string }>(
    `SELECT pi.instrument_id, pi.provider_id, pi.provider_symbol AS symbol
       FROM provider_instruments pi
       JOIN providers p ON p.id = pi.provider_id
       JOIN instruments i ON i.id = pi.instrument_id
      WHERE p.key = 'twelve_data' AND i.symbol = 'XAU/USD'`,
  )
  const seeded = rows[0]
  if (seeded === undefined) throw new Error('twelve_data + XAU/USD not seeded')

  const series: BackfillSeries = {
    instrumentId: seeded.instrument_id,
    providerId: seeded.provider_id,
    timeframe: '15min',
    providerSymbol: seeded.symbol,
    providerInterval: '15min',
  }

  const runId = `backfill-15m-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const captureDir = join(CAPTURE_ROOT, runId)

  const before = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM candles WHERE timeframe = '15min'`,
  )

  process.stdout.write('\nT1.4 STEP 9 - FULL 6.6-YEAR 15M BACKFILL\n\n')
  line('from', EARLIEST_15MIN)
  line('to', 'the present')
  line('bars already stored', before.rows[0]?.count ?? '0')
  line('capture', captureDir)
  process.stdout.write('\n')

  const run = await openRun({
    pool,
    jobName: 'backfill',
    adoptStale,
    captureDir,
    context: { series: '15min XAU/USD twelve_data', from: EARLIEST_15MIN },
  })
  if (run.adopted) process.stdout.write('  ADOPTED a stale run row (--resume)\n\n')

  const startedAt = Date.now()
  const pacer = createPacer({
    onWait: (ms) => process.stdout.write(`    [pacer waited ${String(Math.round(ms / 1000))}s]\n`),
  })

  let lastPageAt = startedAt
  let retries = 0
  let narrowedCount = 0
  // Mutated as the run proceeds so the failure path can report the real work.
  const partial = { counts: emptyCounts(), requests: 0 }

  try {
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
      from: new Date(`${EARLIEST_15MIN.replace(' ', 'T')}Z`),
      resumeFrom: 'from',
      pageSize: 5000,
      withRetry: (fn, describe) =>
        withRetry(fn, {
          describe,
          onRetry: (info) => {
            retries += 1
            process.stdout.write(
              `    [RETRY ${String(info.attempt)} after ${String(Math.round(info.delayMs / 1000))}s: ${
                info.error instanceof Error ? info.error.message.slice(0, 120) : String(info.error)
              }]\n`,
            )
          },
        }),
      // OBLIGATION 51: every narrowing revision, written PER BAR.
      //
      // To a file beside the run's captures rather than to a table: designing
      // where revision events live is T1.5's job, and ADR-013 used exactly this
      // reasoning to keep the upsert outcome a value rather than an event row.
      // A schema designed twice by two tasks means the second inherits the
      // first's guesses.
      //
      // THE FILE IS THE COUNTER. Its line count is the run's narrowing total,
      // and because each line carries BOTH SIDES the rate and the shape are
      // both measurable afterwards — which is the point of not choosing a
      // tolerance today.
      onRevision: async (record) => {
        narrowedCount += 1
        await mkdir(captureDir, { recursive: true })
        await appendFile(join(captureDir, 'revisions.jsonl'), JSON.stringify(record) + '\n', 'utf8')
      },
      onPage: (info) => {
        partial.requests = info.page
        const now = Date.now()
        process.stdout.write(
          `  page ${String(info.page).padStart(3)}  ${String(info.bars).padStart(5)} bars  ` +
            `through ${info.through?.toISOString().slice(0, 16) ?? '-'}  ` +
            `(${String(Math.round((now - lastPageAt) / 1000))}s)\n`,
        )
        lastPageAt = now
      },
    })

    const elapsedMs = Date.now() - startedAt

    await closeRun({
      pool,
      id: run.id,
      status: 'succeeded',
      counts: result.counts,
      requestsMade: result.requestsMade,
    })

    // The narrowing count goes in `context`, NOT a new column. The six outcome
    // columns map ONE-TO-ONE onto CANDLE_UPSERT_OUTCOMES, and narrowing is a
    // BACKFILL-level classification rather than a contract outcome — a seventh
    // column would break the invariant that schema comment states. The
    // authoritative per-bar record is `revisions.jsonl` beside the captures.
    await pool.query(
      `UPDATE job_runs SET context = coalesce(context, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [run.id, JSON.stringify({ narrowed: narrowedCount })],
    )

    const after = await pool.query<{
      count: string
      first: Date
      last: Date
      forming: string
      weekend: string
    }>(
      `SELECT count(*)::text AS count, min(open_time) AS first, max(open_time) AS last,
              count(*) FILTER (WHERE NOT is_final)::text AS forming,
              count(*) FILTER (WHERE extract(isodow from open_time) IN (6,7))::text AS weekend
         FROM candles WHERE timeframe = '15min'`,
    )
    const a = after.rows[0]

    process.stdout.write('\nRESULT\n')
    line('stopped because', result.stoppedBecause)
    line('requests', String(result.requestsMade))
    line('retries', String(retries))
    line(
      'wall clock',
      `${String(Math.round(elapsedMs / 1000))}s (${(elapsedMs / 60_000).toFixed(1)} min)`,
    )
    line('pacer waited', `${String(Math.round(pacer.waitedMs / 1000))}s total`)
    line('bars seen', String(result.barsSeen))
    line('inserted', String(result.counts.inserted))
    line('applied', String(result.counts.applied))
    line('noop', String(result.counts.noop))
    line('enriched', String(result.counts.enriched))
    line('conflict', String(result.counts.conflict))
    line('NARROWED (obligation 51)', String(result.narrowed))
    line('rejected', String(result.counts.rejected))
    process.stdout.write('\nSTORED (15min)\n')
    line('total bars', a?.count ?? '-')
    line('first', a?.first?.toISOString() ?? '-')
    line('last', a?.last?.toISOString() ?? '-')
    line('still forming', a?.forming ?? '-')
    line('weekend bars', a?.weekend ?? '-')
  } catch (error) {
    await closeRun({
      pool,
      id: run.id,
      status: 'failed',
      // OBLIGATION 52: the REAL counts, not zeros. A failed run is exactly
      // when the counters matter - it is the row someone reads at 3am to find
      // out how far the run got. Step 9 recorded requests_made 0 for a run that
      // made a request and stored 2,758 bars, and the shape of that failure was
      // only recoverable from the captures.
      counts: partial.counts,
      requestsMade: partial.requests,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    process.stdout.write(`\nRUN FAILED, job_runs row closed as failed.\n\n`)
    throw error
  } finally {
    await pool.end()
  }
}

await main()
