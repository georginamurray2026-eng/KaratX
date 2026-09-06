/**
 * T1.5 detector 4 — `stale_feed`. The last of the four.
 *
 * Run: pnpm detect:stale            (writes)
 *      pnpm detect:stale --dry-run  (checks, writes nothing)
 *
 * THE CLOCK IS READ HERE, ONCE, and passed down. `packages/core` never reads
 * it — which is what lets its tests name fixed instants rather than depending
 * on when they happen to run.
 *
 * EVERY RUN CARRIES ITS OWN POSITIVE CONTROL. A detector predicted to emit
 * exactly one row cannot be validated by emitting one row.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { Pool } from 'pg'

import { runStaleDetector, summariseStale } from '../jobs/detect-stale'

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run')
  loadEnvFileIfPresent(findRepoRoot())
  const config = loadConfig()
  const pool = new Pool({ connectionString: config.databaseUrl.reveal() })
  try {
    // The one clock read in the whole detector.
    const nowMs = Date.now()
    const result = await runStaleDetector(pool, {
      instrumentId: 1,
      providerId: 1,
      timeframe: '15min',
      nowMs,
      dryRun,
    })
    process.stdout.write(`${summariseStale(result)}\n`)
    if (dryRun) process.stdout.write('\n  DRY RUN — nothing was written.\n')

    // EITHER control failing makes the result worthless, and in OPPOSITE ways,
    // so either one fails the run. The first live run is why there are two: the
    // real answer came back null on a Sunday morning, at which point a
    // can-say-no control was passed equally by a function that always returns
    // null.
    if (result.controlFound !== null) {
      process.exitCode = 1
      process.stderr.write('\nCAN-SAY-NO CONTROL FAILED — it fires regardless of input.\n')
    }
    if (result.controlFiresFound === null) {
      process.exitCode = 1
      process.stderr.write(
        '\nCAN-SAY-YES CONTROL FAILED — it never fires, so a zero above means nothing.\n',
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
