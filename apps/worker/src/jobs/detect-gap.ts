import { classifyGap, expectsBarAt, scanGaps, type GapBar, type GapScan } from '@karatx/core'
import { loadCalendar, storedBarsWithPrices, writeEvents, type EventToWrite } from '@karatx/db'
import type { Pool } from 'pg'

/**
 * Detector 3 - `implausible_gap`.
 *
 * ---------------------------------------------------------------------------
 * THE THRESHOLD IS INDEPENDENT OF THE CALENDAR. THE POPULATION IS NOT.
 * ---------------------------------------------------------------------------
 *
 * Both halves matter and the second is easy to lose.
 *
 * **THRESHOLD - independent.** A move is judged against the volatility of the
 * bars before it. No boundary, no rule id and no calendar-derived quantity
 * enters the comparison, so **a calendar error cannot make a gap look
 * implausible, nor make a real one look ordinary.**
 *
 * **POPULATION - NOT independent.** The calendar decides which bars are in
 * scope at all. So a calendar error changes WHICH GAPS ARE EXAMINED.
 *
 * **THE CONSEQUENCE, AND IT IS THE HARDER FAILURE TO NOTICE: if the calendar
 * is wrong about a window being closed, this detector is SILENT there rather
 * than WRONG there.** A wrong answer is a row someone can look at and dispute.
 * Silence produces nothing to inspect, appears in no count, and is
 * indistinguishable from a clean scan of that window. Nothing in the output
 * says "there were bars here I did not examine" beyond the scope note in the
 * payload and the `bars IN SCOPE` line in the summary, which is why both exist.
 *
 * That is why the events carry `scope` rather than nothing at all. The ABSENCE
 * of `basis` and `self_consistent` still distinguishes these findings from
 * detectors 1 and 2 - whose numbers are self-consistency by construction - but
 * on its own it overstated the claim.
 *
 * READS MONTH BY MONTH BUT SCANS THE WHOLE SERIES. The bounded query keeps the
 * plan cheap; the ATR runs are built afterwards, because chunking the SCAN by
 * month would restart the fourteen-bar warmup 81 times and invent about 1,100
 * unscannable bars that are nothing to do with the calendar.
 */

const STEP_MS: Readonly<Record<string, number>> = { '15min': 900_000, '1h': 3_600_000 }

export interface GapResult extends GapScan {
  readonly timeframe: string
  readonly fromMs: number
  readonly toMs: number
  readonly barsLoaded: number
  readonly barsInScope: number
  readonly runs: number
  readonly unexplainedGaps: number
  readonly inserted: number
  readonly incremented: number
  readonly readMs: number
  readonly scanMs: number
  readonly writeMs: number
  readonly chunks: number
}

const nextMonth = (ms: number): number => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

export const runGapDetector = async (
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
): Promise<GapResult> => {
  const { instrumentId, providerId, timeframe, fromMs, toMs, nowMs } = options
  const stepMs = STEP_MS[timeframe]
  if (stepMs === undefined) throw new Error(`No step known for timeframe ${timeframe}`)

  const { rules, holidays } = await loadCalendar(pool, instrumentId)
  if (rules.length === 0) {
    throw new Error('The calendar is empty. Refusing to report a clean scan (obligation 55).')
  }

  const bars: GapBar[] = []
  let readMs = 0
  let chunks = 0
  for (let chunkFrom = fromMs; chunkFrom < toMs; chunkFrom = nextMonth(chunkFrom)) {
    const chunkTo = Math.min(nextMonth(chunkFrom), toMs)
    chunks += 1
    const started = Date.now()
    const page = await storedBarsWithPrices(
      pool,
      instrumentId,
      providerId,
      timeframe,
      chunkFrom,
      chunkTo,
    )
    readMs += Date.now() - started
    bars.push(...page)
  }

  const scanStarted = Date.now()

  // ONLY BARS THE CALENDAR SAYS ARE OPEN, and this was a DEFECT FOUND BY
  // RUNNING IT (OQ-17d). The first version keyed run boundaries on a GAP IN
  // STORED BARS. That works only while the feed honours the weekend: 2020-2024
  // hold ~1,200 weekend bars a year, so a gap appears and the ATR run breaks.
  // **2026 holds 6,639.** In the 24/7 era the bars are contiguous across the
  // weekly closure, the run never breaks, and ATR is computed over dead
  // weekend bars - measured at 0.37 against a weekday ATR of several dollars.
  // The genuine Sunday-evening open then clears 8x a denominator that
  // collapsed, and 33 of 95 findings landed on Sun 18:00 NY.
  //
  // OQ-17(d) pre-committed what that means: flags clustered at session opens
  // indict the EXCLUSION, not the multiplier. THE THRESHOLD IS UNCHANGED at
  // 8 x ATR(14). What changed is scope - these weekend bars are already
  // recorded as `unexpected_bar` by detector 1, and feeding data the calendar
  // says should not exist into a volatility estimate is the bug.
  //
  // THIS LINE IS WHY THE POPULATION IS NOT CALENDAR-INDEPENDENT. See the
  // header: the threshold stays calendar-free, but a calendar error here makes
  // the detector SILENT over the affected window rather than wrong in it, and
  // silence is what nobody notices. `bars IN SCOPE` in the summary and `scope`
  // in the payload are the only two places that gap is visible.
  const openBars = bars.filter((bar) => expectsBarAt(rules, holidays, bar.openTimeMs) === 'open')

  // Split into ATR runs. A WEEKLY closure ends a run; a daily break does not.
  const kinds = new Map<number, string>()
  const runs: GapBar[][] = []
  let current: GapBar[] = []
  for (let i = 0; i < openBars.length; i += 1) {
    const bar = openBars[i]!
    if (i === 0) {
      current.push(bar)
      continue
    }
    const previous = openBars[i - 1]!
    const kind = classifyGap(rules, holidays, stepMs, previous.openTimeMs, bar.openTimeMs)
    kinds.set(bar.openTimeMs, kind)
    if (kind === 'weekly_closure') {
      runs.push(current)
      current = [bar]
    } else {
      current.push(bar)
    }
  }
  if (current.length > 0) runs.push(current)

  // Anything that is not contiguous is skipped as a boundary crossing - a
  // daily break, or an UNEXPLAINED hole where the calendar says open and no
  // bar arrived. The second is skipped for its own reason: comparing across a
  // hole of unknown size attributes an hour of drift to fifteen minutes.
  const scan = scanGaps(runs, (previousMs, currentMs) => {
    const kind = kinds.get(currentMs)
    return kind !== undefined && kind !== 'contiguous' && previousMs < currentMs
  })

  const scanMs = Date.now() - scanStarted
  let unexplainedGaps = 0
  for (const kind of kinds.values()) if (kind === 'unexplained') unexplainedGaps += 1

  const events: EventToWrite[] = scan.findings.map((finding) => ({
    openTimeMs: finding.openTimeMs,
    // The earliest instant the condition held is the bar whose close completed
    // the move.
    occurredAtMs: finding.openTimeMs,
    eventType: 'implausible_gap',
    // WARN, not info. This is not a calendar disagreement - the calendar
    // cannot make it self-consistent - so it carries information the other two
    // detectors cannot.
    severity: 'warn',
    // NO `basis` AND NO `self_consistent` - those mark a finding DERIVED from
    // the calendar, and this one is not. But not bare either: `scope` records
    // that the calendar chose the POPULATION even though it did not enter the
    // THRESHOLD. Without it the absent `basis` claims more independence than
    // there is.
    payload: {
      move: finding.move,
      atr: finding.atr,
      ratio: finding.ratio,
      atr_period: 14,
      atr_multiplier: 8,
      scope: 'calendar_open_bars_only',
      threshold_basis: 'calendar_free',
    },
  }))

  let inserted = 0
  let incremented = 0
  let writeMs = 0
  if (events.length > 0 && options.dryRun !== true) {
    const started = Date.now()
    const written = await writeEvents(pool, instrumentId, providerId, timeframe, events, nowMs)
    writeMs = Date.now() - started
    inserted = written.inserted
    incremented = written.incremented
  }

  return {
    ...scan,
    timeframe,
    fromMs,
    toMs,
    barsLoaded: bars.length,
    barsInScope: openBars.length,
    runs: runs.length,
    unexplainedGaps,
    inserted,
    incremented,
    readMs,
    scanMs,
    writeMs,
    chunks,
  }
}

export const summariseGaps = (result: GapResult): string =>
  [
    `IMPLAUSIBLE GAP  ${result.timeframe}  8 x ATR(14)`,
    `  bars loaded             ${result.barsLoaded.toLocaleString()}`,
    `  bars IN SCOPE           ${result.barsInScope.toLocaleString()}   (calendar-open only)`,
    `  ATR runs                ${result.runs.toLocaleString()}`,
    '',
    `  findings                ${result.findings.length.toLocaleString()}`,
    '',
    `  examined                ${result.examined.toLocaleString()}`,
    `  UNSCANNABLE (no ATR)    ${result.unscannable.toLocaleString()}   <- not a clean scan of these`,
    `  boundary crossings      ${result.boundaryCrossings.toLocaleString()}`,
    `    of which unexplained  ${result.unexplainedGaps.toLocaleString()}`,
    '',
    `  rows inserted           ${result.inserted.toLocaleString()}`,
    `  rows incremented        ${result.incremented.toLocaleString()}`,
    `  read ${result.readMs} ms over ${result.chunks} chunks (client-observed), scan ${result.scanMs} ms, write ${result.writeMs} ms`,
    '',
    '  INDEPENDENT OF THE CALENDAR. No basis, no self_consistent field: this',
    '  detector compares the feed to its own recent volatility, not to boundaries',
    '  that were themselves measured against this feed.',
  ].join('\n')
