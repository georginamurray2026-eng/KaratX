/**
 * T1.6 — derive 1H and 1D from the stored 15M spine.
 *
 * Run: pnpm aggregate            (writes)
 *      pnpm aggregate --dry-run  (aggregates, writes nothing)
 *
 * PREDICTIONS THIS RUN TESTS are in docs/OPEN-QUESTIONS-T1.6.md, OQ-19 to
 * OQ-23, committed before any of this code existed. Every divergence gets an
 * account rather than an adjusted estimate.
 *
 * Same range as the T1.5 baseline, for the same reason: a run measured against
 * a different window is not comparable with the baseline it is meant to extend.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { providerIdByKey, SPINE_SQL } from '@karatx/db'
import { Pool } from 'pg'

import { runAggregation, summariseAggregation } from '../jobs/aggregate'

const INSTRUMENT_ID = 1
const FROM = Date.UTC(2020, 0, 1)
const TO = Date.UTC(2026, 8, 6)

/**
 * EXPLAIN the spine read, at real volume, cold and warm.
 *
 * OQ-23 fixed the three things that must be named: BOUNDARY (server-side here,
 * from EXPLAIN ANALYZE — it never measures what the job experiences), CACHE
 * STATE, and ROW COUNT. Both cache states are run because cold-to-warm is worth
 * up to 10x and a warm-only number describes a rerun rather than a run.
 */
const explainSpine = async (pool: Pool, providerId: number): Promise<string> => {
  const lines: string[] = []
  const run = async (label: string): Promise<void> => {
    const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${SPINE_SQL}`,
      [INSTRUMENT_ID, providerId, '15min', FROM, TO],
    )
    lines.push(`  --- ${label} ---`)
    for (const row of rows) lines.push(`  ${row['QUERY PLAN']}`)
    lines.push('')
  }
  await run('cold: shared_buffers emptied by a container restart; OS page cache UNKNOWN')
  await run('warm: immediately after the cold run, same session')
  return lines.join('\n')
}

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run')
  loadEnvFileIfPresent(findRepoRoot())
  const config = loadConfig()
  const pool = new Pool({ connectionString: config.databaseUrl.reveal() })
  try {
    const sourceProviderId = await providerIdByKey(pool, 'twelve_data')

    process.stdout.write('\nEXPLAIN — the spine read (OQ-23)\n\n')
    process.stdout.write(`${await explainSpine(pool, sourceProviderId)}\n`)

    const report = await runAggregation(pool, {
      instrumentId: INSTRUMENT_ID,
      fromMs: FROM,
      toMs: TO,
      dryRun,
    })

    process.stdout.write('AGGREGATION\n\n')
    process.stdout.write(`${summariseAggregation(report)}\n`)

    if (dryRun) {
      process.stdout.write(
        '\n  DRY RUN — nothing was written. rowsWritten is what WOULD have been written,\n' +
          '  and the guard-lookup count is 0 because the guard runs inside the write path.\n',
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
})
