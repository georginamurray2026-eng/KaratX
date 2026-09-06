/**
 * T1.5 detector 3 — `implausible_gap` at 8 x ATR(14).
 *
 * Run: pnpm detect:gaps            (writes)
 *      pnpm detect:gaps --dry-run  (scans, writes nothing)
 *
 * THE THRESHOLD IS FIXED AND DOES NOT MOVE. It was chosen in
 * docs/OPEN-QUESTIONS-T1.5.md D3 before any distribution existed, and OQ-17(d)
 * pre-commits what each possible count would MEAN. A surprising number is a
 * diagnosis, not a new multiplier.
 *
 * Same range as the baseline, for the same reason: see detect-baseline.ts.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { Pool } from 'pg'

import { runGapDetector, summariseGaps } from '../jobs/detect-gap'

const INSTRUMENT_ID = 1
const PROVIDER_ID = 1
const TIMEFRAME = '15min'
const FROM = Date.UTC(2020, 0, 1)
const TO = Date.UTC(2026, 8, 6)

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run')
  loadEnvFileIfPresent(findRepoRoot())
  const config = loadConfig()
  const pool = new Pool({ connectionString: config.databaseUrl.reveal() })
  try {
    const startedAt = Date.now()
    const result = await runGapDetector(pool, {
      instrumentId: INSTRUMENT_ID,
      providerId: PROVIDER_ID,
      timeframe: TIMEFRAME,
      fromMs: FROM,
      toMs: TO,
      nowMs: startedAt,
      dryRun,
    })
    process.stdout.write(`${summariseGaps(result)}\n`)
    if (dryRun) process.stdout.write('\n  DRY RUN — nothing was written.\n')
    process.stdout.write(`\n  wall clock ${Date.now() - startedAt} ms\n`)

    // WHERE THE FINDINGS SIT, which OQ-17(d) makes the discriminator rather
    // than the count. Clustering at one weekday-hour means the boundary
    // exclusion failed; spread across dates means the threshold is working.
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    const buckets = new Map()
    for (const f of result.findings) {
      const parts = Object.fromEntries(
        fmt.formatToParts(new Date(f.openTimeMs)).map((x) => [x.type, x.value]),
      )
      const key = `${parts.weekday} ${parts.hour}:00 NY`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const ranked = [...buckets.entries()].sort((a2, b2) => b2[1] - a2[1])
    process.stdout.write(`
  WHERE THEY SIT (NY local weekday and hour), top 8 of ${ranked.length} buckets:
`)
    for (const [key, n] of ranked.slice(0, 8)) {
      process.stdout.write(`    ${String(n).padStart(4)}  ${key}
`)
    }

    // The ten loudest, so "where do they sit" is answerable from the run
    // itself — OQ-17(d) makes that the discriminator, not the count.
    const loudest = [...result.findings]
      .sort((a, b) => Number(b.ratio) - Number(a.ratio))
      .slice(0, 10)
    if (loudest.length > 0) {
      process.stdout.write('\n  LOUDEST TEN (ratio, move, atr, when):\n')
      for (const f of loudest) {
        process.stdout.write(
          `    ${f.ratio.padStart(8)}x  move ${f.move.padStart(9)}  atr ${f.atr.padStart(8)}  ${new Date(f.openTimeMs).toISOString()}\n`,
        )
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
})
