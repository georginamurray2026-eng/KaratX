import { z } from 'zod'

/**
 * Canonical market contracts. Defined ONCE here and imported everywhere (T1.2).
 *
 * Two representation decisions drive this file, and both are expensive to
 * reverse because they propagate into every downstream table, signature and
 * fixture. See ADR-008.
 */

// ---------------------------------------------------------------------------
// Timeframe
// ---------------------------------------------------------------------------

/**
 * `15min` is the native base candle (ADR-008); `1h`, `4h` and `1D` are
 * aggregated in T1.6.
 *
 * `1min` IS INCLUDED BUT NOT INGESTED. Audit finding M2: when a 15M candle
 * range contains both TP and SL you cannot tell which came first, and 1-minute
 * data is the only deterministic resolution. That lands in Phase 6 outcome
 * resolution. Admitting the value now costs nothing; adding it later means
 * migrating the candle table and every enum that mirrors it.
 */
export const TIMEFRAMES = ['1min', '15min', '1h', '4h', '1D'] as const
export const Timeframe = z.enum(TIMEFRAMES)
export type Timeframe = z.infer<typeof Timeframe>

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * A price is a DECIMAL STRING, never a number.
 *
 * Twelve Data emits float32 artefacts - `4643.35156` is exactly float32
 * `4643.3515625`. ADR-008 requires preserving the decimal text as received and
 * never round-tripping through `Number()`, and NFR-12 requires backtests to
 * reproduce byte-for-byte. `z.number()` would silently destroy both.
 *
 * DO NOT RECONSTRUCT THE FULL-PRECISION VALUE. Twelve Data supplies MID prices,
 * not bid/ask, so 4643.3515625 is not a truer number - it is a float32
 * rendering of an aggregate that was never precise. Reconstructing buys
 * precision on a number that never had it. Store the string, record the
 * artefact, do not reconstruct.
 *
 * Branded, so a Price is not interchangeable with any other string: without the
 * brand, "never call Number() on this" is a convention rather than a type.
 *
 * Shape matches NUMERIC(12,5): at most 7 integer digits and 5 decimal places.
 */
const PRICE_PATTERN = /^(0|[1-9]\d{0,6})(\.\d{1,5})?$/

export const Price = z
  .string()
  .regex(PRICE_PATTERN, 'must be a decimal string with <=7 integer and <=5 fractional digits')
  // Zero and negative are rejected rather than merely unusual: a traded
  // instrument has no zero price, and NUMERIC would happily store one.
  .refine((v) => Number(v) > 0, 'must be greater than zero')
  .brand<'Price'>()
export type Price = z.infer<typeof Price>

// ---------------------------------------------------------------------------
// Timestamp
// ---------------------------------------------------------------------------

/**
 * An instant, as ISO-8601 with an EXPLICIT offset.
 *
 * A NAIVE STRING IS REJECTED, and that is the point of the type. Twelve Data
 * returns `2026-08-27 13:00:00` with no offset, and the account default is
 * Australia/Sydney (UTC+10) - absent from the response body. An adapter that
 * assumed UTC would be wrong by ten hours on every candle, silently. The
 * adapter is the single place that attaches the zone; anything reaching this
 * type without one is a bug, not an input to be guessed at.
 *
 * A timezone-aware type that silently accepts a naive string is worse than no
 * type at all.
 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

/**
 * `Date.parse` is NOT sufficient to reject an impossible date.
 *
 * `2026-02-30T00:00:00Z` parses happily and becomes `2026-03-02` - a silent
 * two-day shift, no error. Caught by the test suite on its first run.
 *
 * The calendar fields are therefore checked independently of the offset. They
 * cannot be compared against the parsed instant's UTC fields, because a legal
 * offset can legitimately move the UTC date across midnight.
 */
function isRealCalendarDate(value: string): boolean {
  const parts = value.slice(0, 10).split('-')
  if (parts.length !== 3) return false

  const [year, month, day] = parts.map(Number)
  if (year === undefined || month === undefined || day === undefined) return false
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false

  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day
  )
}

export const Timestamp = z
  .string()
  .regex(TIMESTAMP_PATTERN, 'must be ISO-8601 with an explicit offset (Z or +HH:MM)')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a real instant')
  .refine(isRealCalendarDate, 'must be a date that exists (2026-02-30 silently rolls over)')
  .brand<'Timestamp'>()
export type Timestamp = z.infer<typeof Timestamp>

// ---------------------------------------------------------------------------
// Instrument, Provider
// ---------------------------------------------------------------------------

export const Instrument = z.object({
  id: z.number().int().positive(),
  /** Canonical symbol, ours. Provider-specific symbols map separately. */
  symbol: z.string().min(1),
  displayName: z.string().min(1),
  /** Smallest price increment, decimal string for the same reason as Price. */
  tickSize: z.string().regex(PRICE_PATTERN),
})
export type Instrument = z.infer<typeof Instrument>

export const Provider = z.object({
  id: z.number().int().positive(),
  /** Stable key, e.g. twelve_data, massive. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  displayName: z.string().min(1),
})
export type Provider = z.infer<typeof Provider>

// ---------------------------------------------------------------------------
// Candle
// ---------------------------------------------------------------------------

/**
 * One bar, AS DELIVERED BY ONE PROVIDER.
 *
 * Candles are per-provider, not canonical: T1.9 reconciles Twelve Data against
 * Massive, so bars from both providers for the same instrument and timeframe
 * must coexist. "The price at time T" is always a question with a provider
 * argument.
 *
 * openTime IS THE BAR OPEN, not its close. Getting this wrong is a silent
 * 15-minute shift through every indicator, zone and setup, and it looks
 * completely normal.
 *
 * STRUCTURAL VALIDITY IS NOT CALENDAR VALIDITY. A Saturday bar with sane OHLCV
 * is a structurally valid Candle. Whether it SHOULD exist is a calendar
 * question, answered in T1.5, and answered loudly - if this schema rejected it,
 * the bar would fail as malformed and we would lose the data-quality event that
 * tells us the series changed character in 2025.
 */
export const Candle = z
  .object({
    instrumentId: z.number().int().positive(),
    providerId: z.number().int().positive(),
    timeframe: Timeframe,
    openTime: Timestamp,

    open: Price,
    high: Price,
    low: Price,
    close: Price,

    /** Absent for spot metals on some providers; 0 and null are different facts. */
    volume: z.string().regex(/^\d+$/).nullable(),

    /**
     * Audit finding M3 requires spread or bid/ask, and the provider chosen in
     * ADR-008 supplies MID ONLY - so these are null for Twelve Data today.
     * Present now because adding them later means migrating the largest table
     * in the system.
     */
    bid: Price.nullable(),
    ask: Price.nullable(),

    /**
     * The provider datetime text, exactly as received.
     *
     * If only the parsed instant were stored, a timezone bug would be
     * unrecoverable - every affected row corrupted, with no way to detect or
     * repair it. Keeping the raw text makes a mis-parse detectable after the
     * fact. Cheap now, impossible to add retroactively.
     */
    rawDatetime: z.string().min(1),

    /** False for the forming bar. Same type, flagged - not a second shape. */
    isFinal: z.boolean(),
  })
  // OHLC coherence. Compared numerically because this validates rather than
  // stores; the stored values remain the original strings.
  .refine((c) => Number(c.high) >= Number(c.low), {
    message: 'high must be >= low',
    path: ['high'],
  })
  .refine((c) => Number(c.high) >= Number(c.open) && Number(c.high) >= Number(c.close), {
    message: 'high must be >= open and close',
    path: ['high'],
  })
  .refine((c) => Number(c.low) <= Number(c.open) && Number(c.low) <= Number(c.close), {
    message: 'low must be <= open and close',
    path: ['low'],
  })
export type Candle = z.infer<typeof Candle>
