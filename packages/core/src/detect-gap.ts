/**
 * Detector 3 - `implausible_gap`. THE FIRST FINDING INDEPENDENT OF THE CALENDAR.
 *
 * Detectors 1 and 2 compare the feed to a calendar partly derived from that
 * feed, so their agreement is self-consistency. This one compares the feed to
 * ITSELF: a price move against the volatility of the bars just before it.
 * Nothing here is downstream of a boundary that was measured against Twelve
 * Data, so these events carry no `basis` and no `self_consistent` field.
 *
 * ---------------------------------------------------------------------------
 * THE THRESHOLD IS 8 x ATR(14) AND IT WAS FIXED BEFORE ANY DISTRIBUTION EXISTED
 * ---------------------------------------------------------------------------
 *
 * Recorded in OPEN-QUESTIONS-T1.5.md D3, along with the reasoning: gold trades
 * near 4,635, so a PERCENTAGE threshold is a dollar threshold in other
 * clothing - fixed against a quantity that varies. A 0.5% move in a quiet 2020
 * session and 0.5% during a 2026 spike are different events and only one is
 * implausible. ATR-relative also survives the 2025 era change, where a
 * percentage tuned on either side is wrong on the other.
 *
 * **IF THE COUNT IS SURPRISING, THE ANSWER IS NOT A NEW MULTIPLIER.** OQ-17(d)
 * pre-commits what each outcome means: a very low count indicts the DETECTOR, a
 * high one indicts the ATR WINDOW, and where the flagged bars sit is the
 * discriminator rather than how many there are.
 *
 * ---------------------------------------------------------------------------
 * THE ATR WINDOW RESETS AT WEEKLY CLOSURES, NOT AT DAILY BREAKS
 * ---------------------------------------------------------------------------
 *
 * A 49-hour weekend means the preceding fourteen bars describe a different
 * session. A one-hour break does not, and resetting there would discard
 * volatility information for nothing.
 *
 * Two consequences, and they are DIFFERENT NUMBERS that must not be merged:
 *
 *   `unscannable` - bars with fewer than 14 prior bars in the same run. About
 *     4,830 of them: 345 weekly opens x 14. **Reported, never silently
 *     skipped.** It is roughly fifty times the expected finding count, and a
 *     detector that declines to examine 4,830 bars while reporting sixty
 *     findings is claiming a clean scan it never performed.
 *
 *   `boundaryCrossings` - comparisons where the two bars straddle a closure, so
 *     the "gap" IS the closure and means nothing about price. About 1,725.
 *
 * Pure. Bars are passed in; no clock, no I/O (F.3 invariant 1).
 */

/** One bar, prices as TEXT exactly as stored. Never parsed to float here. */
export interface GapBar {
  readonly openTimeMs: number
  readonly high: string
  readonly low: string
  readonly close: string
}

export const ATR_PERIOD = 14
export const ATR_MULTIPLIER = 8

export interface GapFinding {
  readonly openTimeMs: number
  /** The move that fired, as text. */
  readonly move: string
  readonly atr: string
  readonly ratio: string
  readonly prevCloseMs: number
}

export interface GapScan {
  readonly findings: readonly GapFinding[]
  /** Bars with fewer than ATR_PERIOD prior bars in the same run. */
  readonly unscannable: number
  /** Comparisons skipped because the two bars straddle a calendar closure. */
  readonly boundaryCrossings: number
  /** Bars actually examined. The denominator for any rate derived from this. */
  readonly examined: number
}

/**
 * Prices are text and must not become floats - ADR-008 keeps precision that
 * float64 destroys. But ATR is a RATIO used against a threshold, not a stored
 * value, so it is computed in a scaled integer domain: gold is quoted to five
 * decimals, so everything is multiplied by 100,000 and kept as an integer.
 *
 * `4600.123456789012345` would exceed that scale. It cannot occur here -
 * `NUMERIC(12,5)` truncates to five decimals on write, so every value that
 * comes back from the database already fits. The parse below REFUSES anything
 * that does not, rather than rounding it away.
 */
const SCALE = 100_000n

const toScaled = (text: string): bigint => {
  const match = /^(-?)(\d+)(?:\.(\d{1,5}))?$/.exec(text)
  if (match === null) {
    throw new Error(`Not a price this detector can scale without losing precision: ${text}`)
  }
  const sign = match[1] === '-' ? -1n : 1n
  const whole = BigInt(match[2]!)
  const frac = BigInt((match[3] ?? '').padEnd(5, '0'))
  return sign * (whole * SCALE + frac)
}

const fromScaled = (value: bigint): string => {
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = abs / SCALE
  const frac = (abs % SCALE).toString().padStart(5, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`
}

/**
 * True range of bar `i` given the previous close: the widest of the bar's own
 * range and its two gaps to the prior close. The standard definition, and the
 * reason it is not simply `high - low` is that a bar which gaps and then
 * barely moves has a small range and a large true range.
 */
const trueRange = (bar: GapBar, prevClose: bigint | null): bigint => {
  const high = toScaled(bar.high)
  const low = toScaled(bar.low)
  const range = high - low
  if (prevClose === null) return range
  const upGap = high - prevClose
  const downGap = prevClose - low
  const absUp = upGap < 0n ? -upGap : upGap
  const absDown = downGap < 0n ? -downGap : downGap
  return range > absUp ? (range > absDown ? range : absDown) : absUp > absDown ? absUp : absDown
}

/**
 * Scan one continuous run of bars for moves exceeding the threshold.
 *
 * `runs` are the caller's job: each must be a set of consecutive stored bars
 * with no WEEKLY closure inside it. Daily breaks may appear, and the
 * comparison across one is skipped by `isBoundary` while the ATR window
 * continues.
 */
export const scanGaps = (
  runs: readonly (readonly GapBar[])[],
  isBoundary: (previousMs: number, currentMs: number) => boolean,
): GapScan => {
  const findings: GapFinding[] = []
  let unscannable = 0
  let boundaryCrossings = 0
  let examined = 0

  for (const run of runs) {
    const trs: bigint[] = []
    let prevClose: bigint | null = null
    let prevMs: number | null = null

    for (const bar of run) {
      const tr = trueRange(bar, prevClose)
      const close = toScaled(bar.close)

      if (prevClose === null || prevMs === null) {
        unscannable += 1
      } else if (trs.length < ATR_PERIOD) {
        // Fewer than 14 trailing bars in THIS run: no ATR yet. Counted, not
        // skipped - see the header.
        unscannable += 1
      } else if (isBoundary(prevMs, bar.openTimeMs)) {
        boundaryCrossings += 1
      } else {
        examined += 1
        const window = trs.slice(-ATR_PERIOD)
        const atr = window.reduce((a, b) => a + b, 0n) / BigInt(ATR_PERIOD)
        const move = close - prevClose
        const absMove = move < 0n ? -move : move
        // `atr === 0` means fourteen bars with no range at all. Comparing
        // against it would flag every subsequent tick, so it is treated as
        // unscannable rather than as an infinitely sensitive threshold.
        if (atr === 0n) {
          unscannable += 1
          examined -= 1
        } else if (absMove > atr * BigInt(ATR_MULTIPLIER)) {
          findings.push({
            openTimeMs: bar.openTimeMs,
            move: fromScaled(absMove),
            atr: fromScaled(atr),
            ratio: (Number(absMove) / Number(atr)).toFixed(2),
            prevCloseMs: prevMs,
          })
        }
      }

      trs.push(tr)
      prevClose = close
      prevMs = bar.openTimeMs
    }
  }

  return { findings, unscannable, boundaryCrossings, examined }
}
