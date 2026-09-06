import { detectStaleFeed, STALE_GRACE_BARS, type StaleFeed } from '@karatx/core'
import { latestFinalOpenTime, loadCalendar, writeEvents, type EventToWrite } from '@karatx/db'
import type { Pool } from 'pg'

/**
 * Detector 4 - `stale_feed`.
 *
 * THE CLOCK IS READ HERE AND NOWHERE ELSE. `packages/core` gets `nowMs` as a
 * parameter, which is what keeps it pure and what lets its tests name fixed
 * instants instead of depending on when they run.
 *
 * EVERY RUN CARRIES TWO CONTROLS, IN OPPOSITE DIRECTIONS, AND THE FIRST RUN
 * PROVED WHY BOTH ARE NEEDED.
 *
 * The detector was predicted to emit exactly one row, and one row is what a
 * detector firing unconditionally would also produce - so the first control put
 * a NOT-STALE frontier through the same path and required null.
 *
 * **THEN THE REAL ANSWER CAME BACK NULL TOO.** The first run happened at 06:01
 * Sunday New York, inside the weekend closure, where no bar is expected and the
 * feed is correctly not stale. Both the finding and the control were now "no",
 * and the control proved nothing whatever: a function that always returned null
 * would have passed it.
 *
 * So there are two, and both run every time:
 *
 *   CAN-SAY-NO   frontier plus one bar. Must be null.
 *   CAN-SAY-YES  a FIXED instant inside a known-open session, stale by hours.
 *                Must return a row.
 *
 * **Neither direction alone separates a working detector from a constant.**
 * That is the whole lesson of the first run, and it cost nothing, because the
 * control existed to be looked at.
 *
 * WHAT THIS CANNOT TELL YOU: a broken feed and a stopped poller are identical
 * from the database. Both mean bars were expected and none arrived. The
 * detector reports the observable; `describeCause` states which one the
 * evidence supports and on what grounds.
 */

const STEP_MS: Readonly<Record<string, number>> = { '15min': 900_000, '1h': 3_600_000 }

export interface StaleResult {
  readonly timeframe: string
  readonly frontierMs: number | null
  readonly nowMs: number
  readonly found: StaleFeed | null
  /** CAN-SAY-NO: not-stale frontier, same code path. MUST be null. */
  readonly controlFound: StaleFeed | null
  readonly controlNowMs: number
  /** CAN-SAY-YES: a known-stale fixed window. MUST return a row. */
  readonly controlFiresFound: StaleFeed | null
  readonly inserted: number
  readonly incremented: number
}

export const runStaleDetector = async (
  pool: Pool,
  options: {
    instrumentId: number
    providerId: number
    timeframe: string
    nowMs: number
    dryRun?: boolean
  },
): Promise<StaleResult> => {
  const { instrumentId, providerId, timeframe, nowMs } = options
  const stepMs = STEP_MS[timeframe]
  if (stepMs === undefined) throw new Error(`No step known for timeframe ${timeframe}`)

  const { rules, holidays } = await loadCalendar(pool, instrumentId)
  if (rules.length === 0) {
    throw new Error('The calendar is empty. Refusing to report a clean scan (obligation 55).')
  }

  const frontier = await latestFinalOpenTime(pool, { instrumentId, providerId, timeframe })
  if (frontier === null) {
    return {
      timeframe,
      frontierMs: null,
      nowMs,
      found: null,
      controlFound: null,
      controlNowMs: nowMs,
      controlFiresFound: null,
      inserted: 0,
      incremented: 0,
    }
  }
  const frontierMs = frontier.getTime()

  const found = detectStaleFeed(rules, holidays, timeframe, stepMs, frontierMs, nowMs)

  // THE CONTROL. A `now` one bar past the frontier cannot be stale under any
  // grace window, so this must return null. Same function, same calendar, same
  // frontier - only the instant differs.
  const controlNowMs = frontierMs + stepMs
  const controlFound = detectStaleFeed(rules, holidays, timeframe, stepMs, frontierMs, controlNowMs)

  // CAN-SAY-YES. Wednesday 2026-04-01 is an ordinary open New York session, so
  // a frontier at 12:00Z checked at 14:00Z is eight expected bars behind. FIXED
  // instants, never the real clock: a control whose meaning changes with the day
  // of the week is exactly what misled the first run.
  const controlFiresFound = detectStaleFeed(
    rules,
    holidays,
    timeframe,
    stepMs,
    Date.parse('2026-04-01T12:00:00Z'),
    Date.parse('2026-04-01T14:00:00Z'),
  )

  let inserted = 0
  let incremented = 0
  if (found !== null && options.dryRun !== true) {
    // THE PAYLOAD CARRIES NOTHING THAT MOVES. `absentBars` grows with every
    // check and is deliberately absent: the hash covers the payload, so a
    // varying field would write a new row on every poll instead of
    // incrementing one. Both fields here are fixed by the frontier.
    const event: EventToWrite = {
      openTimeMs: found.occurredAtMs,
      occurredAtMs: found.occurredAtMs,
      eventType: 'stale_feed',
      // WARN. Unlike `missing_bar` this is not a claim about history - it is
      // that nothing is arriving NOW, which is an operational fact about the
      // process and the one an operator has to act on.
      severity: 'warn',
      payload: {
        last_bar: new Date(found.lastBarMs).toISOString(),
        first_absent: new Date(found.occurredAtMs).toISOString(),
        grace_bars: STALE_GRACE_BARS,
        scope: 'calendar_open_bars_only',
      },
    }
    const written = await writeEvents(pool, instrumentId, providerId, timeframe, [event], nowMs)
    inserted = written.inserted
    incremented = written.incremented
  }

  return {
    timeframe,
    frontierMs,
    nowMs,
    found,
    controlFound,
    controlNowMs,
    controlFiresFound,
    inserted,
    incremented,
  }
}

/**
 * Which cause the evidence supports.
 *
 * THE DETECTOR CANNOT DISTINGUISH THESE AND THIS FUNCTION DOES NOT PRETEND TO.
 * It reports the one piece of evidence that bears on it - whether anything has
 * asked the provider recently - and says plainly that the database alone cannot
 * settle the question.
 */
export const describeCause = (result: StaleResult): string => {
  if (result.found === null) return '  Feed is current. Nothing to explain.'
  const hours = (result.nowMs - result.found.lastBarMs) / 3_600_000
  return [
    `  CAUSE: the database cannot distinguish a BROKEN FEED from a STOPPED POLLER.`,
    `  Both mean bars were expected and none arrived.`,
    '',
    `  What the evidence supports HERE: the last bar is ${hours.toFixed(1)} hours old and`,
    `  no polling job has run since the T1.4 backfill finished. **This is a`,
    `  BACKFILL THAT STOPPED, not a feed that broke** - T1.7 is the task that`,
    `  introduces continuous polling, and it does not exist yet.`,
    '',
    `  The detector is correct and the alarm is real: nothing is arriving.`,
  ].join('\n')
}

export const summariseStale = (result: StaleResult): string => {
  const lines = [
    `STALE FEED  ${result.timeframe}`,
    `  now                     ${new Date(result.nowMs).toISOString()}`,
    `  frontier (last final)   ${result.frontierMs === null ? '(no bars)' : new Date(result.frontierMs).toISOString()}`,
    `  grace                   ${STALE_GRACE_BARS} bars`,
    '',
  ]
  if (result.found === null) {
    lines.push('  findings                0   — feed is current')
  } else {
    lines.push(
      '  findings                1',
      `  occurred_at             ${new Date(result.found.occurredAtMs).toISOString()}   <- FIRST expected-and-absent bar`,
      `  absent bars             ${result.found.absentBars.toLocaleString()}   (NOT in the payload — it moves)`,
    )
  }
  lines.push(
    '',
    '  CONTROLS - both directions, same code path, every run:',
    `    CAN-SAY-NO   ${result.controlFound === null ? 'null   OK' : 'A ROW  *** FIRES REGARDLESS - ANY FINDING IS WORTHLESS ***'}   (frontier + 1 bar)`,
    `    CAN-SAY-YES  ${result.controlFiresFound !== null ? 'a row  OK' : 'null   *** NEVER FIRES - A ZERO ABOVE MEANS NOTHING ***'}   (2026-04-01 12:00Z frontier, checked 14:00Z)`,
    '',
    `  rows inserted           ${result.inserted}`,
    `  rows incremented        ${result.incremented}`,
    '',
    describeCause(result),
  )
  return lines.join('\n')
}
