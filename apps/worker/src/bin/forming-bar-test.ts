/**
 * T1.4 — OQ-12 / obligation 46. TWO requests. Does /time_series return the
 * currently-FORMING bar?
 *
 * Run: pnpm forming-bar-test
 *
 * Request 1: a window ending now. Wait past a 15-minute boundary. Request 2:
 * the SAME window.
 *
 * TWO ASSERTIONS, DELIBERATELY KEPT APART. OQ-11's test welded two claims into
 * one binary and could not fail for a single reason, which is how a badly
 * designed check produced an ambiguous answer. These are separate:
 *
 *   A - OLDER BARS (everything except request 1's newest) must be byte-identical
 *       across both calls. If they are not, forming bars explain nothing and
 *       something larger is wrong. STOP THERE.
 *
 *   B - THE NEWEST BAR of request 1: does it change, and in the FORMING SHAPE?
 *       open unchanged, high non-decreasing, low non-increasing, close free.
 *
 * AND A LIVENESS CONTROL, because the same ambiguity is available again: with
 * the market closed, the newest bar is a completed bar that will not change, and
 * that is INDISTINGUISHABLE from "forming bars are not returned" while proving
 * nothing. If request 1's newest bar is not recent, this reports INCONCLUSIVE
 * and refuses to answer.
 *
 * The prediction is committed at e13aec7, before this ran. Not to be edited.
 *
 * Never prints the key.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { createFileCaptureSink, TwelveDataClient, type ProviderBar } from '@karatx/providers'
import { join } from 'node:path'

const REPO_ROOT = findRepoRoot()
const INTERVAL_MS = 15 * 60_000

/** How stale request 1's newest bar may be before the test is inconclusive. */
const LIVENESS_TOLERANCE_MS = 2 * INTERVAL_MS

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(30)} ${value}\n`)
}

function key(bar: ProviderBar): string {
  return bar.rawDatetime
}

function priceLine(bar: ProviderBar): string {
  return `o=${bar.open} h=${bar.high} l=${bar.low} c=${bar.close}`
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

async function main(): Promise<void> {
  loadEnvFileIfPresent()
  const apiKey = loadConfig().twelveDataApiKey
  if (apiKey === undefined) {
    process.stderr.write('TWELVEDATA_API_KEY is not set.\n')
    process.exit(1)
  }

  const runId = `oq12-forming-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const captureRoot = join(REPO_ROOT, 'var/captures')
  const client = new TwelveDataClient({
    fetch: globalThis.fetch,
    apiKey,
    capture: createFileCaptureSink(captureRoot),
    runId,
  })

  // A window a few bars wide, ending now. No end_date: we want whatever the
  // provider considers current, which is the whole question.
  const startedAt = new Date()
  const windowStart = new Date(startedAt.getTime() - 6 * INTERVAL_MS)
  const startDate = windowStart.toISOString().slice(0, 19).replace('T', ' ')

  process.stdout.write('\nOQ-12 / obligation 46 - DOES /time_series RETURN THE FORMING BAR?\n\n')
  line('request 1 at (UTC)', startedAt.toISOString())
  line('window start', startDate)
  line('window end', 'none - whatever the provider considers current')
  process.stdout.write('\n')

  const query = {
    symbol: 'XAU/USD',
    interval: '15min',
    startDate,
    outputsize: 20,
    order: 'ASC',
  } as const

  const first = await client.timeSeries(query)
  process.stdout.write(`REQUEST 1: ${String(first.bars.length)} bars\n`)
  for (const bar of first.bars) line(bar.rawDatetime, priceLine(bar))

  const newest = first.bars.at(-1)
  if (newest === undefined) {
    process.stdout.write('\nNo bars returned. INCONCLUSIVE.\n')
    process.exit(1)
  }

  // ---- LIVENESS CONTROL ---------------------------------------------------
  const staleMs = startedAt.getTime() - newest.openTime.getTime()
  const live = staleMs <= LIVENESS_TOLERANCE_MS

  process.stdout.write('\nLIVENESS CONTROL\n')
  line('newest bar', newest.rawDatetime)
  line('age at request 1', `${String(Math.round(staleMs / 60_000))} minutes`)
  line('tolerance', `${String(LIVENESS_TOLERANCE_MS / 60_000)} minutes`)
  line('market plausibly open', live ? 'YES' : 'NO')

  if (!live) {
    process.stdout.write(
      '\n  INCONCLUSIVE. The newest bar is too old for this test to mean anything:\n' +
        '  a closed market produces an unchanging newest bar, which is\n' +
        '  INDISTINGUISHABLE from "forming bars are not returned". Re-run while\n' +
        '  the market is open. THIS IS NOT A RESULT.\n',
    )
    process.exit(2)
  }

  // ---- wait past the next boundary ----------------------------------------
  const nextBoundary = new Date(newest.openTime.getTime() + INTERVAL_MS + 45_000)
  const waitMs = Math.max(30_000, nextBoundary.getTime() - Date.now())

  process.stdout.write(
    `\nWaiting ${String(Math.round(waitMs / 1000))}s, past the boundary at ` +
      `${new Date(newest.openTime.getTime() + INTERVAL_MS).toISOString()}\n`,
  )
  await sleep(waitMs)

  const second = await client.timeSeries(query)
  process.stdout.write(`\nREQUEST 2: ${String(second.bars.length)} bars\n`)
  for (const bar of second.bars) line(bar.rawDatetime, priceLine(bar))

  const after = new Map(second.bars.map((b) => [key(b), b]))

  // ---- ASSERTION A: older bars are byte-identical -------------------------
  const older = first.bars.slice(0, -1)
  const changedOlder: string[] = []
  for (const bar of older) {
    const now2 = after.get(key(bar))
    if (now2 === undefined) {
      changedOlder.push(`${bar.rawDatetime} MISSING from request 2`)
      continue
    }
    if (
      now2.open !== bar.open ||
      now2.high !== bar.high ||
      now2.low !== bar.low ||
      now2.close !== bar.close
    ) {
      changedOlder.push(
        `${bar.rawDatetime}\n      was ${priceLine(bar)}\n      now ${priceLine(now2)}`,
      )
    }
  }

  process.stdout.write('\nASSERTION A - older bars byte-identical across both calls\n')
  line('older bars compared', String(older.length))
  line('changed', String(changedOlder.length))
  line('RESULT', changedOlder.length === 0 ? 'HOLDS' : 'FAILS')
  for (const c of changedOlder) process.stdout.write(`    ${c}\n`)

  if (changedOlder.length > 0) {
    process.stdout.write(
      '\n  STOP. Older bars changed, so forming bars explain nothing here and\n' +
        '  something larger is wrong. Do not construct a third explanation.\n' +
        `\n  Capture: ${join(captureRoot, runId)}\n\n`,
    )
    process.exit(1)
  }

  // ---- ASSERTION B: the newest bar, and its shape -------------------------
  const newestAfter = after.get(key(newest))
  process.stdout.write('\nASSERTION B - the newest bar of request 1\n')
  line('bar', newest.rawDatetime)
  line('request 1', priceLine(newest))
  line('request 2', newestAfter === undefined ? '(missing)' : priceLine(newestAfter))

  if (newestAfter === undefined) {
    process.stdout.write('\n  The newest bar vanished from request 2. Not a predicted outcome.\n')
    process.exit(1)
  }

  const changed =
    newestAfter.open !== newest.open ||
    newestAfter.high !== newest.high ||
    newestAfter.low !== newest.low ||
    newestAfter.close !== newest.close

  const openSame = newestAfter.open === newest.open
  const highNonDecreasing = Number(newestAfter.high) >= Number(newest.high)
  const lowNonIncreasing = Number(newestAfter.low) <= Number(newest.low)
  const formingShape = openSame && highNonDecreasing && lowNonIncreasing

  line('changed at all', changed ? 'YES' : 'NO')
  line('open unchanged', openSame ? 'yes' : 'NO')
  line('high non-decreasing', highNonDecreasing ? 'yes' : 'NO')
  line('low non-increasing', lowNonIncreasing ? 'yes' : 'NO')
  line('forming shape', formingShape ? 'YES' : 'NO')

  process.stdout.write('\nCONCLUSION\n')
  line('predicted', 'A holds, B changes in the forming shape')

  if (changed && formingShape) {
    line('OBSERVED', 'A holds, B changed in the forming shape')
    line('prediction', 'HELD')
    process.stdout.write(
      '\n  /time_series RETURNS FORMING BARS. The fixture bar 5 is explained and\n' +
        '  obligation 46 discharges.\n\n' +
        '  THIS IS NOT A CLEAN WIN. It exposes a LIVE DEFECT in T1.4: toCandleInput\n' +
        '  sets isFinal: true for EVERY bar, so a backfill running to the present\n' +
        '  stores the forming bar as final. That must be fixed before step 8.\n',
    )
  } else if (!changed) {
    line('OBSERVED', 'A holds, B did NOT change')
    line('prediction', 'DID NOT HOLD')
    process.stdout.write(
      '\n  FORMING BARS ARE NOT RETURNED. The fixture bar 5 change is therefore a\n' +
        "  RESTATEMENT of a final bar. ADR-008's FIRST REVERSAL CONDITION IS LIVE.\n" +
        '  STOP. Do not proceed to step 8.\n',
    )
  } else {
    line('OBSERVED', 'A holds, B changed but NOT in the forming shape')
    line('prediction', 'DID NOT HOLD')
    process.stdout.write(
      '\n  The newest bar changed in a way a forming bar cannot. Not a predicted\n' +
        '  outcome. Report it; do not explain it here.\n',
    )
  }

  process.stdout.write(`\n  Capture: ${join(captureRoot, runId)}\n\n`)
}

await main()
