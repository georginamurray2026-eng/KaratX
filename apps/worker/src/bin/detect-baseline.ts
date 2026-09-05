/**
 * T1.5 — the baseline run for detectors 1 and 2.
 *
 * Run: pnpm detect:baseline           (writes)
 *      pnpm detect:baseline --dry-run (scans, writes nothing)
 *
 * THE NUMBER THIS PRODUCES IS THE BASELINE every future rate comparison is
 * measured against, so it prints its own denominator: bars scanned, range,
 * timeframe, and the calendar rule ids with their migration.
 *
 * Predictions are committed in docs/OPEN-QUESTIONS-T1.5.md BEFORE this ran,
 * and two of them are known compromised — the cost figure was built on a cold
 * measurement, and `missing_bar`'s composition was falsified by OQ-13b. Both
 * are reported as such rather than quietly scored.
 *
 * Reads no secret and makes no network call. It only touches the database.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { Pool } from 'pg'

import { runCalendarBaseline, summarise } from '../jobs/detect-calendar'

const INSTRUMENT_ID = 1
const PROVIDER_ID = 1
const TIMEFRAME = '15min'

/**
 * THE RANGE STARTS 2020-01-01, NOT 2020-01-24 WHERE THE CALENDAR BEGINS.
 *
 * That produces 2,228 instants the calendar cannot answer for, reported as
 * `unknown (expected)` and counted as NEITHER missing nor unexpected.
 *
 * Narrowing the range to 2020-01-24 would make that number vanish, and it was
 * considered AFTER the first run had produced it - which is exactly why it was
 * not done. **Trimming a range after seeing the result is fitting the
 * measurement to the answer.**
 *
 * The 2,228 is also the calendar’s honest reply for a period it does not
 * cover, and a baseline that hides its own coverage gap is worse than one that
 * states it. Aligned to a month so chunking starts cleanly.
 */
const FROM = Date.UTC(2020, 0, 1)
const TO = Date.UTC(2026, 8, 6)

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run')
  loadEnvFileIfPresent(findRepoRoot())
  const config = loadConfig()
  const pool = new Pool({ connectionString: config.databaseUrl.reveal() })

  try {
    const startedAt = Date.now()
    const result = await runCalendarBaseline(pool, {
      instrumentId: INSTRUMENT_ID,
      providerId: PROVIDER_ID,
      timeframe: TIMEFRAME,
      fromMs: FROM,
      toMs: TO,
      nowMs: startedAt,
      dryRun,
    })
    process.stdout.write(`${summarise(result)}\n`)
    if (dryRun) {
      process.stdout.write('\n  DRY RUN — nothing was written.\n')
    }
    process.stdout.write(`\n  wall clock ${Date.now() - startedAt} ms\n`)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
})
