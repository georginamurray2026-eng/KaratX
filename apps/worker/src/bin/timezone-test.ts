/**
 * T1.4 — OQ-11. ONE request, to settle the fixture/live discrepancy.
 *
 * Run: pnpm timezone-test
 *
 * The committed fixture and the live API disagree by ~38 points about the bar
 * stamped `2026-08-27 03:00:00`. Either the fixture was recorded WITHOUT
 * `timezone=UTC` - making its `03:00` Australia/Sydney, i.e. `2026-08-26 17:00`
 * UTC, a different bar - or Twelve Data restated finalised history.
 *
 * THE TEST IS BINARY AND NO INFERENCE IS AVAILABLE. Ask for the window the
 * UTC+10 hypothesis predicts, and compare every price of every bar
 * byte-for-byte against the fixture:
 *
 *   ALL MATCH   -> the fixture is UTC+10. The provider is fine.
 *   ANY DIFFERS -> that hypothesis is dead, and nothing else follows from
 *                  this call alone.
 *
 * The prediction is committed in docs/OPEN-QUESTIONS-T1.4.md at 8739f4e,
 * BEFORE this ran. It is not to be edited afterwards.
 *
 * Never prints the key.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { createFileCaptureSink, TwelveDataClient, type ProviderBar } from '@karatx/providers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = findRepoRoot()

/** The UTC+10 offset the hypothesis rests on. Australia/Sydney has no DST in August. */
const HYPOTHESISED_OFFSET_HOURS = 10

interface FixtureBar {
  readonly datetime: string
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
}

function fixtureBars(): FixtureBar[] {
  const path = join(REPO_ROOT, 'test/fixtures/providers/twelvedata-xauusd-15min.json')
  const body = JSON.parse(readFileSync(path, 'utf8')) as { values: FixtureBar[] }
  // Recorded DESCENDING; compare in ascending order.
  return [...body.values].sort((a, b) => a.datetime.localeCompare(b.datetime))
}

function shiftBack(datetime: string, hours: number): string {
  const ms = Date.parse(`${datetime.replace(' ', 'T')}Z`) - hours * 3_600_000
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(26)} ${value}\n`)
}

async function main(): Promise<void> {
  loadEnvFileIfPresent()
  const apiKey = loadConfig().twelveDataApiKey
  if (apiKey === undefined) {
    process.stderr.write('TWELVEDATA_API_KEY is not set.\n')
    process.exit(1)
  }

  const fixture = fixtureBars()
  const first = fixture[0]
  const last = fixture.at(-1)
  if (first === undefined || last === undefined) throw new Error('fixture has no bars')

  const startDate = shiftBack(first.datetime, HYPOTHESISED_OFFSET_HOURS)
  const endDate = shiftBack(last.datetime, HYPOTHESISED_OFFSET_HOURS)

  const runId = `oq11-timezone-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const captureRoot = join(REPO_ROOT, 'var/captures')

  process.stdout.write('\nOQ-11 - THE TIMEZONE TEST. One request.\n\n')
  line('hypothesis', `fixture timestamps are UTC+${String(HYPOTHESISED_OFFSET_HOURS)}`)
  line('fixture window', `${first.datetime} .. ${last.datetime}`)
  line('requested window (UTC)', `${startDate} .. ${endDate}`)
  line('bars to compare', String(fixture.length))
  process.stdout.write('\n')

  const client = new TwelveDataClient({
    fetch: globalThis.fetch,
    apiKey,
    capture: createFileCaptureSink(captureRoot),
    runId,
  })

  let bars: readonly ProviderBar[]
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
    process.stdout.write(
      `REQUEST FAILED: ${String(error instanceof Error ? error.message : error)}\n`,
    )
    process.stdout.write(`Capture: ${join(captureRoot, runId)}\n`)
    process.exit(1)
  }

  process.stdout.write(`RETURNED ${String(bars.length)} bars\n\n`)

  // Byte-for-byte on every price of every bar. A "close enough" comparison
  // would be a way of not answering the question.
  let allMatch = bars.length === fixture.length
  const rows: string[] = []

  for (const [i, expected] of fixture.entries()) {
    const actual = bars[i]
    const same =
      actual !== undefined &&
      actual.open === expected.open &&
      actual.high === expected.high &&
      actual.low === expected.low &&
      actual.close === expected.close
    if (!same) allMatch = false

    rows.push(
      `  ${expected.datetime}  ->  ${actual?.rawDatetime ?? '(missing)'}   ${same ? 'MATCH' : 'DIFFER'}`,
    )
    rows.push(
      `      fixture  o=${expected.open} h=${expected.high} l=${expected.low} c=${expected.close}`,
    )
    rows.push(
      `      live     o=${actual?.open ?? '-'} h=${actual?.high ?? '-'} l=${actual?.low ?? '-'} c=${actual?.close ?? '-'}`,
    )
  }
  process.stdout.write(rows.join('\n') + '\n\n')

  process.stdout.write('RESULT\n')
  line('predicted', 'MATCH (fixture is UTC+10)')
  line('bars compared', `${String(fixture.length)} expected, ${String(bars.length)} returned`)
  line('OBSERVED', allMatch ? 'ALL MATCH' : 'DIFFER')
  line('prediction', allMatch ? 'HELD' : 'DID NOT HOLD')

  process.stdout.write(
    allMatch
      ? '\n  HYPOTHESIS 1 CONFIRMED. The fixture was recorded without timezone=UTC;\n' +
          '  its timestamps are Australia/Sydney. The provider did not restate history.\n'
      : '\n  HYPOTHESIS 1 IS DEAD. Nothing else follows from this call alone.\n' +
          '  Do not reach for a third explanation here - record the refutation and stop.\n',
  )

  process.stdout.write(`\nCapture: ${join(captureRoot, runId)}\n\n`)
}

await main()
