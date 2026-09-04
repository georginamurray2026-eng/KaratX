import { ProviderError, ValidationError } from '@karatx/core'
import { z } from 'zod'

/**
 * Turning a Twelve Data response into bars, without losing anything on the way.
 *
 * ADR-008's THIRD adapter requirement lives here: PRESERVE THE DECIMAL TEXT AS
 * RECEIVED. Every price stays a `string` from the response body to the database
 * boundary, and no value in this file is ever passed through `Number()`,
 * `parseFloat`, `+x` or arithmetic.
 *
 * WHERE THAT GUARANTEE ENDS, stated so nobody "completes" it later: it binds AT
 * THIS BOUNDARY ONLY. `candles.open` is `NUMERIC(12,5)`, which pads to scale, so
 * '4635.06' is stored and returned as '4635.06000'. ADR-013 accepted that
 * deliberately and rejected adding raw price columns. This file's job is to
 * make sure the value reaching the database is the value the provider sent -
 * not to preserve its rendering at rest.
 */

/**
 * The response body shape, validated at the boundary (SEC-3).
 *
 * PRICES ARE `z.string()`, NOT `z.coerce.number()`. That is the requirement,
 * expressed as a type: a schema that coerced would destroy the text before any
 * test could observe it, and the destruction would look like normalisation.
 */
const barSchema = z.object({
  datetime: z.string().min(1),
  open: z.string().min(1),
  high: z.string().min(1),
  low: z.string().min(1),
  close: z.string().min(1),
  volume: z.string().min(1).optional(),
})

const okResponseSchema = z.object({
  meta: z
    .object({
      symbol: z.string().optional(),
      interval: z.string().optional(),
      currency_base: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
  values: z.array(barSchema),
  status: z.literal('ok'),
})

/**
 * The error body shape.
 *
 * UNVERIFIED - SYNTHETIC UNTIL FIRST CONTACT. No Twelve Data error response has
 * ever been observed by this project: T1.1 recorded only successful calls. This
 * schema is written from the vendor's documented shape, which this project's own
 * lesson says is a starting point and not evidence, and the fixtures exercising
 * it are labelled synthetic. Both are replaced with recorded reality at step 7
 * of T1.4. Open question OQ-3 in docs/OPEN-QUESTIONS-T1.4.md tracks it.
 */
const errorResponseSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  status: z.literal('error'),
})

/** One bar exactly as the provider sent it, with the instant computed. */
export interface ProviderBar {
  /**
   * The parsed bar OPEN instant, always UTC.
   *
   * Derived from `rawDatetime` by explicit field arithmetic, never by handing
   * the string to `new Date()` - see `parseUtcDatetime`.
   */
  readonly openTime: Date
  /** The provider's datetime text, byte-for-byte. Stored in `raw_datetime`. */
  readonly rawDatetime: string
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  /** `null` when the provider sent none. Spot gold has no volume on this feed. */
  readonly volume: string | null
}

export interface ParsedTimeSeries {
  readonly bars: readonly ProviderBar[]
  readonly symbol: string | undefined
  readonly interval: string | undefined
}

/**
 * `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DD`, and NOTHING else.
 *
 * DELIBERATELY STRICTER THAN "PARSEABLE". A `T` separator, a trailing `Z` and
 * an explicit `+07:00` offset are all rejected, even though the first two are
 * unambiguous and would be safe to accept.
 *
 * The reason is that this project treats a change in the provider's datetime
 * rendering as THE CANARY for the timezone bug `raw_datetime` exists to make
 * recoverable. A lenient pattern absorbs that signal: the day Twelve Data
 * starts sending `2026-08-27T03:30:00Z`, a permissive parser keeps working and
 * nobody learns anything, while a strict one stops the run and says exactly
 * what changed. An offset-bearing form is worse still - a pattern that matched
 * it while ignoring the offset is the quietest possible way to be wrong.
 *
 * The cost of strictness is a loud, well-labelled failure. The cost of
 * leniency is silence about the one thing we most want to be told.
 *
 * THE DATE-ONLY FORM IS ANTICIPATED, NOT OBSERVED. Every recorded response is
 * intraday; no `1day` time_series response has ever been captured, so whether
 * daily bars arrive as `2025-07-06` or `2025-07-06 00:00:00` is unknown. Both
 * are accepted for that reason. Tracked as OQ-5.
 */
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/

/**
 * Parse a Twelve Data datetime as UTC.
 *
 * THIS FUNCTION EXISTS SO `new Date(text)` IS NEVER CALLED ON A PROVIDER
 * STRING, and that is not stylistic. `new Date('2026-08-27 03:30:00')` parses in
 * the RUNNING PROCESS'S LOCAL ZONE. The user operates in Asia/Bangkok (UTC+7),
 * so on their own machine every bar would land seven hours out of position -
 * with correct-looking prices, a plausible-looking chart, and no error anywhere.
 * On a UTC CI runner the same code is correct, so CI would never catch it.
 *
 * `Date.UTC` takes the fields explicitly and cannot consult a local zone.
 *
 * The request always carries `timezone=UTC` (see request.ts), so the text the
 * provider sends IS UTC. These two facts are one requirement in two places, and
 * both halves are tested.
 */
export function parseUtcDatetime(text: string): Date {
  const match = DATETIME_PATTERN.exec(text)
  if (match === null) {
    throw new ValidationError(
      `Unrecognised provider datetime format: ${JSON.stringify(text)}. ` +
        `Expected 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD'. ` +
        `A provider changing its datetime rendering is the canary for a timezone ` +
        `bug, so this refuses rather than guessing.`,
    )
  }

  const [, year, month, day, hour, minute, second] = match

  // `Number()` on CALENDAR FIELDS is not the prohibited conversion: the ban is
  // on prices, whose text carries information float64 would destroy. A
  // four-digit year does not.
  const instant = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? '0'),
    Number(minute ?? '0'),
    Number(second ?? '0'),
  )

  const date = new Date(instant)

  // Round-trip check. Catches an impossible date that the pattern accepts -
  // '2026-02-30' matches the shape and Date.UTC silently rolls it to March 2.
  const expected =
    hour === undefined
      ? `${year}-${month}-${day}`
      : `${year}-${month}-${day} ${hour}:${minute}:${second}`
  const actual =
    hour === undefined
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 19).replace('T', ' ')

  if (actual !== expected) {
    throw new ValidationError(
      `Provider datetime ${JSON.stringify(text)} is not a real instant ` +
        `(it normalises to ${JSON.stringify(actual)}).`,
    )
  }

  return date
}

/**
 * Parse a `/time_series` response body.
 *
 * @throws {ProviderError} when the provider reports an error status.
 * @throws {ValidationError} when the body does not match the expected shape.
 */
export function parseTimeSeries(body: unknown): ParsedTimeSeries {
  const asError = errorResponseSchema.safeParse(body)
  if (asError.success) {
    throw new ProviderError(
      `Twelve Data returned an error status` +
        (asError.data.code === undefined ? '' : ` (code ${String(asError.data.code)})`) +
        (asError.data.message === undefined ? '' : `: ${asError.data.message}`),
      { context: { code: asError.data.code } },
    )
  }

  const parsed = okResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError(
      `Twelve Data response did not match the expected shape. ` +
        `Fields: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    )
  }

  const bars = parsed.data.values.map((value): ProviderBar => ({
    openTime: parseUtcDatetime(value.datetime),
    // The four price fields are carried through UNTOUCHED. No normalisation,
    // no trimming, no re-formatting.
    rawDatetime: value.datetime,
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
    volume: value.volume ?? null,
  }))

  return {
    bars,
    symbol: parsed.data.meta?.symbol,
    interval: parsed.data.meta?.interval,
  }
}

/**
 * Refuse a page whose bars are not strictly ascending by open time.
 *
 * WHY ASSERT RATHER THAN SORT. Sorting would work and would be wrong: the
 * backfill resumes from `max(open_time)` in the database, so ordering is a
 * correctness input, and a provider that silently stopped honouring `order=ASC`
 * is a fact worth failing on rather than papering over. §7 - never silently
 * repair.
 *
 * STRICTLY ascending, so a duplicated timestamp inside one page is also caught.
 * That is a real provider defect shape and the upsert would absorb it as a
 * `noop`, hiding it.
 *
 * @throws {ProviderError} naming the first offending pair.
 */
export function assertAscending(bars: readonly ProviderBar[]): void {
  for (let i = 1; i < bars.length; i += 1) {
    const previous = bars[i - 1]
    const current = bars[i]
    if (previous === undefined || current === undefined) continue

    if (current.openTime.getTime() <= previous.openTime.getTime()) {
      const relation =
        current.openTime.getTime() === previous.openTime.getTime() ? 'repeats' : 'goes backwards'
      throw new ProviderError(
        `Provider page is not strictly ascending by open time: bar ${String(i)} ${relation}. ` +
          `${previous.rawDatetime} then ${current.rawDatetime}.\n\n` +
          `The backfill resumes from max(open_time), so an out-of-order page would ` +
          `advance the frontier past bars that were never stored. Requested order=ASC ` +
          `and got this - the provider's ordering behaviour has changed, or the ` +
          `parameter is being ignored.`,
        { context: { index: i, previous: previous.rawDatetime, current: current.rawDatetime } },
      )
    }
  }
}
