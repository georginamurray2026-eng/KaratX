import { basisOf, CALENDAR_PROVENANCE, scanCalendar } from '@karatx/core'
import { loadCalendar, storedOpenTimes, writeEvents, type EventToWrite } from '@karatx/db'
import type { Pool } from 'pg'

/**
 * T1.5 detectors 1 and 2 against stored history - THE BASELINE RUN.
 *
 * The number this produces is what every future rate comparison is measured
 * against, so the report states the denominator explicitly: how many bars, over
 * what range, at what timeframe, on which calendar version.
 *
 * THE STRUCTURAL THREE ARE NOT RUN AND ARE NOT ZEROED. `negative_price`,
 * `high_below_low` and `close_outside_range` cannot be observed by a scan -
 * rows violating them are rejected at INSERT by `candles_positive_check`,
 * `candles_high_check` and `candles_low_check`. Reporting `0` would report that
 * those constraints exist. The reason is printed with the results so a reader
 * who sees the vocabulary but not the type finds it without asking.
 *
 * Orchestration only. Every decision is in `packages/core`; every row movement
 * is in `packages/db`; the clock is read HERE and passed down.
 */

/** Detectors that a scan of stored candles cannot run, and why. */
export const NOT_RUN_BY_SCAN = {
  detectors: ['negative_price', 'high_below_low', 'close_outside_range'],
  reason:
    'not run - rejected at insert by candles_positive_check, candles_high_check, ' +
    'candles_low_check; a scan cannot observe them',
} as const

export interface BaselineResult {
  readonly timeframe: string
  readonly fromMs: number
  readonly toMs: number
  readonly barsScanned: number
  readonly expectedOpen: number
  readonly unexpectedWeeklyClosure: number
  readonly unexpectedDailyBreak: number
  readonly missing: number
  readonly unknownStored: number
  readonly unknownExpected: number
  readonly ruleIds: readonly number[]
  readonly inserted: number
  readonly incremented: number
  readonly readMs: number
  readonly writeMs: number
  readonly chunks: number
}

/** One month per chunk. Bounded so the scan never becomes the 3 s full-series one. */
const nextMonth = (ms: number): number => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0)
}

export const runCalendarBaseline = async (
  pool: Pool,
  options: {
    instrumentId: number
    providerId: number
    timeframe: string
    fromMs: number
    toMs: number
    nowMs: number
    dryRun?: boolean
  },
): Promise<BaselineResult> => {
  const { instrumentId, providerId, timeframe, fromMs, toMs, nowMs } = options
  const { rules, holidays } = await loadCalendar(pool, instrumentId)
  if (rules.length === 0) {
    throw new Error('The calendar is empty. Refusing to report a clean scan (obligation 55).')
  }
  const basis = basisOf(rules)

  let barsScanned = 0
  let expectedOpen = 0
  let unexpectedWeeklyClosure = 0
  let unexpectedDailyBreak = 0
  let missing = 0
  let unknownStored = 0
  let unknownExpected = 0
  let inserted = 0
  let incremented = 0
  let readMs = 0
  let writeMs = 0
  let chunks = 0

  for (let chunkFrom = fromMs; chunkFrom < toMs; chunkFrom = nextMonth(chunkFrom)) {
    const chunkTo = Math.min(nextMonth(chunkFrom), toMs)
    chunks += 1

    const readStart = Date.now()
    const stored = await storedOpenTimes(
      pool,
      instrumentId,
      providerId,
      timeframe,
      chunkFrom,
      chunkTo,
    )
    readMs += Date.now() - readStart

    const scan = scanCalendar(rules, holidays, timeframe, chunkFrom, chunkTo, stored)
    barsScanned += scan.scanned
    expectedOpen += scan.expectedOpen
    missing += scan.missing.length
    unknownStored += scan.unknownStored.length
    unknownExpected += scan.unknownExpected.length

    const events: EventToWrite[] = []

    for (const hit of scan.unexpected) {
      if (hit.window === 'weekly_closure') unexpectedWeeklyClosure += 1
      else unexpectedDailyBreak += 1
      events.push({
        openTimeMs: hit.openTimeMs,
        // `occurred_at` is the earliest instant the condition held. For a bar
        // that should not exist, that is the bar's own open time.
        occurredAtMs: hit.openTimeMs,
        eventType: 'unexpected_bar',
        // INFORMATIONAL, decided before any detector existed - see the block
        // in packages/db/src/schema/market-hours.ts. What alerts is a CHANGE
        // IN THE RATE, and this run is what establishes the rate.
        severity: 'info',
        payload: { window: hit.window, self_consistent: true, basis },
      })
    }

    for (const openTimeMs of scan.missing) {
      events.push({
        openTimeMs,
        // For an ABSENCE the earliest instant the condition held is the open
        // time of the bar that should have arrived - not the last one that did.
        occurredAtMs: openTimeMs,
        eventType: 'missing_bar',
        // INFO THROUGHOUT, never keyed on frontier-proximity: severity that
        // depended on how recently you looked would make the same fact change
        // severity as time passes.
        severity: 'info',
        payload: { self_consistent: true, basis },
      })
    }

    if (events.length > 0 && options.dryRun !== true) {
      const writeStart = Date.now()
      const written = await writeEvents(pool, instrumentId, providerId, timeframe, events, nowMs)
      writeMs += Date.now() - writeStart
      inserted += written.inserted
      incremented += written.incremented
    }
  }

  return {
    timeframe,
    fromMs,
    toMs,
    barsScanned,
    expectedOpen,
    unexpectedWeeklyClosure,
    unexpectedDailyBreak,
    missing,
    unknownStored,
    unknownExpected,
    ruleIds: basis.rule_ids,
    inserted,
    incremented,
    readMs,
    writeMs,
    chunks,
  }
}

/** The summary line. Carries the caveat so it survives into logs. */
export const summarise = (result: BaselineResult): string =>
  [
    `BASELINE  ${result.timeframe}  ${new Date(result.fromMs).toISOString()} .. ${new Date(result.toMs).toISOString()}`,
    `  bars scanned            ${result.barsScanned.toLocaleString()}`,
    `  calendar instants open  ${result.expectedOpen.toLocaleString()}`,
    `  calendar rules          ${result.ruleIds.join(', ')} (migration 0004)`,
    '',
    `  unexpected_bar          ${(result.unexpectedWeeklyClosure + result.unexpectedDailyBreak).toLocaleString()}` +
      `  (weekly_closure ${result.unexpectedWeeklyClosure.toLocaleString()}, daily_break ${result.unexpectedDailyBreak.toLocaleString()})`,
    `  missing_bar             ${result.missing.toLocaleString()}`,
    `  unknown (stored)        ${result.unknownStored.toLocaleString()}`,
    `  unknown (expected)      ${result.unknownExpected.toLocaleString()}`,
    '',
    `  ${NOT_RUN_BY_SCAN.detectors.join(', ')}:`,
    `    ${NOT_RUN_BY_SCAN.reason}`,
    '',
    `  rows inserted           ${result.inserted.toLocaleString()}`,
    `  rows incremented        ${result.incremented.toLocaleString()}`,
    `  read ${result.readMs} ms over ${result.chunks} chunks, write ${result.writeMs} ms`,
    '',
    `  ${CALENDAR_PROVENANCE}`,
  ].join('\n')
