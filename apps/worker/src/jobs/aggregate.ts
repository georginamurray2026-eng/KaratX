import { aggregate, type AggregateTimeframe, type ConstituentBar } from '@karatx/core'
import {
  loadCalendar,
  providerIdByKey,
  rawDatetimeGuardLookups,
  resetRawDatetimeGuardLookups,
  spineBars,
  upsertCandle,
  type CandleUpsertResult,
} from '@karatx/db'
import type { Pool } from 'pg'

/**
 * T1.6 - derive 1H and 1D bars from the stored 15M spine.
 *
 * Run: pnpm aggregate            (writes)
 *      pnpm aggregate --dry-run  (aggregates, writes nothing)
 *
 * ---------------------------------------------------------------------------
 * THIS JOB DECIDES NOTHING ABOUT AGGREGATION. `packages/core` does.
 * ---------------------------------------------------------------------------
 *
 * Everything here is I/O and reporting: read the spine, hand it to the pure
 * function, write what comes back. No boundary rule, no completeness rule and
 * no constituent count is computed in this file - if one ever appears here, it
 * is a second implementation of something `aggregate.ts` already decides, and
 * the backtest stops running the same code as the live path.
 *
 * ---------------------------------------------------------------------------
 * `periodsExpected` IS CARRIED THROUGH, NEVER RECOMPUTED
 * ---------------------------------------------------------------------------
 *
 * OQ-20: `periodsExpected` must be derived INDEPENDENTLY, from the calendar. It
 * arrives on the `AggregateResult` and is passed to the report unchanged.
 * Recomputing it here from the outputs would destroy the only property that
 * makes it worth reporting.
 *
 * **BUT THE BALANCE CHECK ITSELF IS A PARTITION IDENTITY AND MUST NOT BE READ
 * AS EVIDENCE THE COUNTS ARE RIGHT.** `periodsExpected` is the size of the map
 * the producing loop iterates, so produced + rejected == expected for any input
 * and almost any bug. It catches a period classified twice or not at all, and
 * nothing else. See `assertDecomposition` below, and the OQ-20 test in
 * `packages/core` which is what actually discriminates.
 *
 * ---------------------------------------------------------------------------
 * NO LITERAL PROVIDER ID
 * ---------------------------------------------------------------------------
 *
 * Both providers are resolved by key through `providerIdByKey` (ADR-014).
 * `karatx_derived` came out as 3 on the machine migration 0006 was written on
 * and that is an accident of insertion order.
 */

export const SOURCE_PROVIDER_KEY = 'twelve_data'
export const DERIVED_PROVIDER_KEY = 'karatx_derived'
export const SOURCE_TIMEFRAME = '15min'

/** 1H and 1D. No 4H - obligation 59. */
export const TARGET_TIMEFRAMES: readonly AggregateTimeframe[] = ['1h', '1D']

/**
 * Bars per write transaction.
 *
 * Follows T1.4's chunked-write pattern rather than inventing one: a chunk is
 * one transaction, so a failure rolls back a bounded amount and the run can be
 * re-entered without a half-written period. 500 is T1.4's order of magnitude,
 * recorded here so the figure in the report is traceable to a decision.
 */
export const WRITE_CHUNK = 500

export interface TimeframeReport {
  readonly timeframe: AggregateTimeframe
  readonly periodsExpected: number
  /** Bars the aggregation PRODUCED. The partition below is over this. */
  readonly rowsProduced: number
  /** Rows the database reported as actually written. Zero on a re-run. */
  readonly rowsWritten: number
  readonly periodsRejectedForMissingConstituents: number
  readonly unknownInstants: number
  readonly unexpectedBarsExcluded: number
  readonly expectsBarAtCalls: number
  readonly aggregateMs: number
  readonly writeMs: number
  readonly chunks: number
  readonly outcomes: Readonly<Record<string, number>>
}

export interface AggregateRunReport {
  readonly dryRun: boolean
  readonly sourceProviderId: number
  readonly derivedProviderId: number
  readonly barsRead: number
  readonly readMs: number
  readonly readChunks: number
  readonly perTimeframe: readonly TimeframeReport[]
  readonly totalExpectsBarAtCalls: number
  readonly guardLookups: number
  readonly wallClockMs: number
  readonly peakRssBytes: number
  readonly writeChunkSize: number
}

/** Month boundaries, matching detect-gap's proven read chunking. */
const nextMonth = (ms: number): number => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/**
 * THE PERIOD PARTITION CHECK - AN IDENTITY, NOT A CORRECTNESS TEST.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TREATING A PASS AS EVIDENCE OF ANYTHING
 * ---------------------------------------------------------------------------
 *
 * `periodsExpected` is `requiredByPeriod.size`, and the loop that produces bars
 * and rejections iterates THAT SAME MAP, taking exactly one branch per entry.
 * So produced + rejected == expected HOLDS FOR ANY INPUT AND FOR ALMOST ANY
 * BUG. Wrong OHLC folding, a wrong constituent count, a wrong session boundary,
 * a wrong completeness rule - every one of them still balances.
 *
 * WHAT IT ACTUALLY CATCHES is narrow and worth stating exactly: A PERIOD
 * CLASSIFIED TWICE, OR CLASSIFIED NOT AT ALL. An early `continue` that forgets
 * to increment, or a branch that both pushes and rejects. That is a real
 * failure mode and it is the ONLY one this catches. Keep it for that.
 *
 * WHAT DISCRIMINATES INSTEAD is the OQ-20 test in
 * `packages/core/src/timeframes/aggregate.test.ts`: drop one constituent bar,
 * and assert REJECTED rises, PRODUCED falls, and EXPECTED DOES NOT MOVE. That
 * is what shows `periodsExpected` is derived from the calendar rather than from
 * the outputs. **A future session must not read "BALANCES" as evidence that the
 * counts are correct** - it is evidence that they were counted once each.
 *
 * NOTE THE OPERAND: the partition is over `rowsProduced`, what aggregation
 * emitted - NOT `rowsWritten`, what the database reported writing. Those differ
 * legitimately: a second run over unchanged data writes nothing and every
 * outcome is `noop`, which is ADR-013 working correctly. Asserting over
 * `rowsWritten` would make this job throw on its own idempotency.
 */
export const assertDecomposition = (report: TimeframeReport): void => {
  const sum = report.rowsProduced + report.periodsRejectedForMissingConstituents
  if (report.periodsExpected !== sum) {
    throw new Error(
      `PERIOD PARTITION DOES NOT BALANCE for ${report.timeframe}: ` +
        `periodsExpected=${String(report.periodsExpected)} but produced+rejected=${String(sum)} ` +
        `(produced=${String(report.rowsProduced)}, ` +
        `rejected=${String(report.periodsRejectedForMissingConstituents)}).\n\n` +
        `This is a PARTITION over one map: every period is either produced or ` +
        `rejected, exactly once. A mismatch therefore means a period was ` +
        `classified TWICE or NOT AT ALL - a control-flow defect in the loop, ` +
        `not a disagreement about the data. It says NOTHING about whether the ` +
        `counts are right; the OQ-20 test in packages/core is what checks that.`,
    )
  }
}

export const runAggregation = async (
  pool: Pool,
  options: {
    instrumentId: number
    fromMs: number
    toMs: number
    dryRun?: boolean
  },
): Promise<AggregateRunReport> => {
  const { instrumentId, fromMs, toMs } = options
  const dryRun = options.dryRun ?? false
  const startedAt = Date.now()

  let peakRss = process.memoryUsage().rss
  const sampleRss = (): void => {
    const rss = process.memoryUsage().rss
    if (rss > peakRss) peakRss = rss
  }

  resetRawDatetimeGuardLookups()

  const sourceProviderId = await providerIdByKey(pool, SOURCE_PROVIDER_KEY)
  const derivedProviderId = await providerIdByKey(pool, DERIVED_PROVIDER_KEY)

  const { rules, holidays } = await loadCalendar(pool, instrumentId)
  if (rules.length === 0) {
    throw new Error(
      'The calendar is empty. An empty calendar expects nothing, so every period would be ' +
        'rejected and this run would report a clean zero (obligation 55).',
    )
  }
  const weeklyOpen = rules.find((rule) => rule.ruleType === 'weekly_open')
  if (weeklyOpen === undefined) {
    throw new Error('No weekly_open rule: there is nothing to align session days or weeks to.')
  }

  // READ CHUNKED BY MONTH, AGGREGATE ONCE. The bounded query keeps each plan a
  // cheap index range scan; the aggregation still sees the whole series,
  // because a period straddling a chunk boundary would otherwise be judged
  // against a required set truncated by the chunk - the same defect the pad in
  // `aggregate.ts` exists to prevent, arriving from the other direction.
  const bars: ConstituentBar[] = []
  let readMs = 0
  let readChunks = 0
  for (let chunkFrom = fromMs; chunkFrom < toMs; chunkFrom = nextMonth(chunkFrom)) {
    const chunkTo = Math.min(nextMonth(chunkFrom), toMs)
    readChunks += 1
    const at = Date.now()
    const rows = await spineBars(
      pool,
      { instrumentId, providerId: sourceProviderId, timeframe: SOURCE_TIMEFRAME },
      chunkFrom,
      chunkTo,
    )
    readMs += Date.now() - at
    for (const row of rows) {
      bars.push({
        openTime: row.openTimeMs,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        isFinal: row.isFinal,
      })
    }
    sampleRss()
  }

  const perTimeframe: TimeframeReport[] = []

  for (const timeframe of TARGET_TIMEFRAMES) {
    const aggregateAt = Date.now()
    const result = aggregate(bars, timeframe, {
      rules,
      holidays,
      dailyBoundaryLocal: weeklyOpen.localStart,
    })
    const aggregateMs = Date.now() - aggregateAt
    sampleRss()

    const outcomes: Record<string, number> = {}
    let rowsWritten = 0
    let chunks = 0
    let writeMs = 0

    if (!dryRun) {
      const writeAt = Date.now()
      for (let i = 0; i < result.bars.length; i += WRITE_CHUNK) {
        const chunk = result.bars.slice(i, i + WRITE_CHUNK)
        chunks += 1
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          for (const derived of chunk) {
            // upsertCandle, deliberately: ADR-013's six-case conflict rule and
            // ADR-014's raw_datetime guard both live behind it, and a direct
            // INSERT here would bypass both.
            const outcome: CandleUpsertResult = await upsertCandle(client, {
              instrumentId,
              providerId: derivedProviderId,
              timeframe: derived.timeframe,
              openTime: new Date(derived.openTime),
              open: derived.open,
              high: derived.high,
              low: derived.low,
              close: derived.close,
              volume: derived.volume,
              bid: null,
              ask: null,
              rawDatetime: derived.rawDatetime,
              isFinal: derived.isFinal,
            })
            outcomes[outcome.outcome] = (outcomes[outcome.outcome] ?? 0) + 1
            if (outcome.wrote) rowsWritten += 1
          }
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
        sampleRss()
      }
      writeMs = Date.now() - writeAt
    } else {
      // A DRY RUN REPORTS WHAT IT WOULD WRITE, NOT ZERO. Reporting zero here
      // would make a dry run indistinguishable from an aggregation that
      // produced nothing.
      rowsWritten = result.bars.length
    }

    const report: TimeframeReport = {
      timeframe,
      // Carried through from the calendar-derived result. NOT recomputed.
      periodsExpected: result.periodsExpected,
      rowsProduced: result.bars.length,
      rowsWritten,
      periodsRejectedForMissingConstituents: result.periodsRejectedForMissingConstituents,
      unknownInstants: result.unknownInstants.length,
      unexpectedBarsExcluded: result.unexpectedBarsExcluded,
      expectsBarAtCalls: result.expectsBarAtCalls,
      aggregateMs,
      writeMs,
      chunks,
      outcomes,
    }
    assertDecomposition(report)
    perTimeframe.push(report)
  }

  return {
    dryRun,
    sourceProviderId,
    derivedProviderId,
    barsRead: bars.length,
    readMs,
    readChunks,
    perTimeframe,
    totalExpectsBarAtCalls: perTimeframe.reduce((n, t) => n + t.expectsBarAtCalls, 0),
    guardLookups: rawDatetimeGuardLookups(),
    wallClockMs: Date.now() - startedAt,
    peakRssBytes: peakRss,
    writeChunkSize: WRITE_CHUNK,
  }
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export const summariseAggregation = (report: AggregateRunReport): string => {
  const lines: string[] = []
  lines.push(`  provider ${SOURCE_PROVIDER_KEY} -> id ${String(report.sourceProviderId)}`)
  lines.push(`  provider ${DERIVED_PROVIDER_KEY} -> id ${String(report.derivedProviderId)}`)
  lines.push(
    `  spine ${report.barsRead.toLocaleString()} bars read in ` +
      `${String(report.readChunks)} chunks, ${String(report.readMs)} ms`,
  )
  lines.push('')

  for (const t of report.perTimeframe) {
    const sum = t.rowsProduced + t.periodsRejectedForMissingConstituents
    lines.push(`  ${t.timeframe}`)
    lines.push(`    periodsExpected                        ${t.periodsExpected.toLocaleString()}`)
    lines.push(`    rowsProduced                           ${t.rowsProduced.toLocaleString()}`)
    lines.push(`    rowsWritten (db reported wrote)        ${t.rowsWritten.toLocaleString()}`)
    lines.push(
      `    periodsRejectedForMissingConstituents  ${t.periodsRejectedForMissingConstituents.toLocaleString()}`,
    )
    lines.push(
      `    PERIOD PARTITION  ${t.periodsExpected.toLocaleString()} == ` +
        `${t.rowsProduced.toLocaleString()} + ` +
        `${t.periodsRejectedForMissingConstituents.toLocaleString()} = ${sum.toLocaleString()}` +
        `  ${t.periodsExpected === sum ? 'BALANCES' : 'DOES NOT BALANCE'}`,
    )
    lines.push(`    unknownInstants                        ${t.unknownInstants.toLocaleString()}`)
    lines.push(
      `    unexpectedBarsExcluded                 ${t.unexpectedBarsExcluded.toLocaleString()}`,
    )
    lines.push(`    expectsBarAtCalls                      ${t.expectsBarAtCalls.toLocaleString()}`)
    lines.push(
      `    aggregate ${String(t.aggregateMs)} ms, write ${String(t.writeMs)} ms in ` +
        `${String(t.chunks)} chunks`,
    )
    lines.push('      ^ A PARTITION IDENTITY over one map, NOT a correctness check. It holds for')
    lines.push('        any input and almost any bug. It catches a period classified twice or')
    lines.push('        not at all, and nothing else. What discriminates is the OQ-20 test in')
    lines.push('        packages/core: drop a constituent, and periodsExpected must NOT move.')
    const outcomes = Object.entries(t.outcomes)
      .map(([k, n]) => `${k}=${String(n)}`)
      .join(', ')
    if (outcomes !== '') lines.push(`    outcomes  ${outcomes}`)
    lines.push('')
  }

  lines.push(
    `  expectsBarAt calls, BOTH timeframes     ${report.totalExpectsBarAtCalls.toLocaleString()}`,
  )
  lines.push(`  raw_datetime guard lookups              ${report.guardLookups.toLocaleString()}`)
  lines.push(`  wall clock                              ${String(report.wallClockMs)} ms`)
  lines.push(`  peak RSS                                ${mb(report.peakRssBytes)}`)
  lines.push(`  write chunk size                        ${String(report.writeChunkSize)}`)
  return lines.join('\n')
}
