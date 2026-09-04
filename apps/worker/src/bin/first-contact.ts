/**
 * T1.4 step 7 — ONE request against the live Twelve Data API.
 *
 * Run: pnpm first-contact
 *
 * Lives under apps/worker/src/bin for the same reason packages/db keeps its
 * migrate binary there: it is a DELIBERATE, operator-run step, never part of
 * any boot path. Nothing imports it.
 *
 * ONE REQUEST. Not a loop, not a backfill, not a retry sequence. It exists to
 * answer the questions in docs/OPEN-QUESTIONS-T1.4.md that a single call can
 * answer, and to leave the raw response on disk so the ones it cannot answer
 * are at least evidenced rather than guessed.
 *
 * OQ-7 IS THE REASON FOR THE PARTICULAR WINDOW, and it is the whole design of
 * this call. `start_date` is set to EXACTLY a bar open time we already know
 * exists, taken from the response recorded on 2026-08-27 and committed at
 * test/fixtures/providers/twelvedata-xauusd-15min.json. Then:
 *
 *   the bar comes back      -> start_date is INCLUSIVE
 *   the bar does not        -> start_date is EXCLUSIVE
 *
 * There is no third reading, and no inference from an adjacent observation.
 *
 * WHY IT MATTERS ENOUGH TO SHAPE THE CALL: the backfill resumes AT the frontier
 * rather than after it, so an inclusive `start_date` re-offers the frontier bar
 * and the upsert returns `noop`. That overlap is what re-proves idempotency on
 * real data at every page boundary. If `start_date` is exclusive the overlap
 * silently disappears, the run still completes, the counts still look right,
 * and the re-proof is gone with no symptom at all.
 *
 * Prints a report. Never prints the key.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { createFileCaptureSink, TwelveDataClient, type ProviderBar } from '@karatx/providers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A bar we KNOW exists, because we recorded the response containing it.
 *
 * Read from the fixture rather than typed here, so this cannot drift from the
 * evidence it claims to rest on.
 */
function knownBarOpenTime(): string {
  const path = join(REPO_ROOT, 'test/fixtures/providers/twelvedata-xauusd-15min.json')
  const body = JSON.parse(readFileSync(path, 'utf8')) as { values: { datetime: string }[] }

  // The fixture is DESCENDING as recorded, so the middle of the range is a
  // safely-bracketed bar rather than an endpoint.
  const middle = body.values[Math.floor(body.values.length / 2)]
  if (middle === undefined) throw new Error('fixture has no bars')
  return middle.datetime
}

const REPO_ROOT = findRepoRoot()

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(28)} ${value}\n`)
}

async function main(): Promise<void> {
  // The repo root is resolved, not assumed to be cwd: this runs through the
  // worker package so pnpm can resolve @karatx/*, which puts cwd in apps/worker.
  loadEnvFileIfPresent()
  const config = loadConfig()
  const apiKey = config.twelveDataApiKey

  if (apiKey === undefined) {
    process.stderr.write(
      'TWELVEDATA_API_KEY is not set. Add it to .env - see .env.example.\n' +
        'It is optional in config on purpose (CI has no key); this script needs it.\n',
    )
    process.exit(1)
  }

  const startDate = knownBarOpenTime()
  // Two intervals later, so an inclusive window holds exactly three bars and an
  // exclusive one holds two. Small enough that this cannot become a backfill.
  const endDate = new Date(Date.parse(`${startDate.replace(' ', 'T')}Z`) + 30 * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')

  const runId = `first-contact-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const captureRoot = join(REPO_ROOT, 'var/captures')

  process.stdout.write('\nT1.4 STEP 7 - FIRST CONTACT. One request.\n\n')
  line('symbol', 'XAU/USD')
  line('interval', '15min')
  line('start_date (known bar)', startDate)
  line('end_date', endDate)
  line('capture', join(captureRoot, runId))
  process.stdout.write('\n')

  const client = new TwelveDataClient({
    // The ONLY place this repository calls the global fetch. The guard in
    // wiring-assertions.test.ts scopes to packages/providers/src/marketdata,
    // where injection is what makes replay possible; here the injected value
    // is the real thing, once.
    fetch: globalThis.fetch,
    apiKey,
    capture: createFileCaptureSink(captureRoot),
    runId,
  })

  let bars: readonly ProviderBar[] = []
  let failed: unknown

  try {
    const parsed = await client.timeSeries({
      symbol: 'XAU/USD',
      interval: '15min',
      startDate,
      endDate,
      outputsize: 10,
      order: 'ASC',
    })
    bars = parsed.bars
  } catch (error) {
    failed = error
  }

  if (failed !== undefined) {
    process.stdout.write(
      'REQUEST FAILED. The raw response is captured; read it before concluding.\n\n',
    )
    process.stdout.write(`${String(failed instanceof Error ? failed.message : failed)}\n\n`)
    process.stdout.write(`Capture: ${join(captureRoot, runId)}\n`)
    process.exit(1)
  }

  process.stdout.write(`RESPONSE: ${String(bars.length)} bars\n\n`)
  for (const bar of bars) {
    line(
      bar.rawDatetime,
      `o=${bar.open} h=${bar.high} l=${bar.low} c=${bar.close} v=${String(bar.volume)}`,
    )
  }

  // ---- OQ-7, the question this call was shaped around ---------------------
  const first = bars[0]
  const startIsInclusive = first?.rawDatetime === startDate

  process.stdout.write('\nOQ-7  start_date inclusivity\n')
  line('predicted', 'INCLUSIVE both ends')
  line('requested start_date', startDate)
  line('first bar returned', first?.rawDatetime ?? '(none)')
  line('OBSERVED', startIsInclusive ? 'INCLUSIVE' : 'EXCLUSIVE')
  line('prediction', startIsInclusive ? 'HELD' : 'DID NOT HOLD')

  if (!startIsInclusive) {
    process.stdout.write(
      '\n  CONSEQUENCE: the resume overlap does not exist. The backfill resumes AT\n' +
        '  the frontier expecting that bar back as a `noop`; it will not come back,\n' +
        '  so idempotency stops being re-proved on every page boundary. Either the\n' +
        '  frontier query steps back one interval, or the re-proof moves to the\n' +
        '  re-verification pass. DECIDE THAT NOW THAT THE ANSWER IS KNOWN.\n',
    )
  }

  const last = bars.at(-1)
  process.stdout.write('\nOQ-7b end_date inclusivity (same call, separate observation)\n')
  line('requested end_date', endDate)
  line('last bar returned', last?.rawDatetime ?? '(none)')
  line('OBSERVED', last?.rawDatetime === endDate ? 'INCLUSIVE' : 'EXCLUSIVE or window empty')

  // ---- OQ-8, ordering -----------------------------------------------------
  process.stdout.write('\nOQ-8  order=ASC honoured\n')
  line('predicted', 'YES')
  // The client asserts ascending and throws if not, so reaching this line at
  // all is the observation. Stated explicitly rather than left implicit.
  line(
    'OBSERVED',
    bars.length > 1 ? 'ASCENDING (assertAscending passed)' : 'only one bar - NOT SETTLED',
  )
  line('prediction', bars.length > 1 ? 'HELD' : 'UNTESTED by this call')

  process.stdout.write(`\nRaw response, headers and status: ${join(captureRoot, runId)}\n`)
  process.stdout.write('Read the capture for OQ-2 and OQ-4 - headers are recorded there.\n\n')
}

await main()
