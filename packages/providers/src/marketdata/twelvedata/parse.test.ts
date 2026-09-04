import { ProviderError, ValidationError } from '@karatx/core'
import { readJsonFixture } from '@karatx/test-support'
import { describe, expect, it } from 'vitest'

import { assertAscending, parseTimeSeries, parseUtcDatetime } from './parse'

const RECORDED = 'providers/twelvedata-xauusd-15min.json'
const ASCENDING = 'providers/twelvedata-xauusd-15min-ascending.json'
const SHUFFLED = 'providers/twelvedata-xauusd-15min-shuffled.json'
const DECIMAL_GUARD = 'providers/twelvedata-decimal-guard.json'
const ERROR_429 = 'providers/twelvedata-error-429.json'

interface RawBody {
  readonly values: readonly Record<string, string>[]
}

describe('ADR-008 requirement 3 - decimal text preserved as received', () => {
  it('carries every price through byte-for-byte, on the RECORDED response', () => {
    const raw = readJsonFixture<RawBody>(RECORDED)
    const parsed = parseTimeSeries(raw)

    expect(parsed.bars).toHaveLength(raw.values.length)

    // Recorded order is descending, so match by raw datetime rather than index.
    for (const source of raw.values) {
      const bar = parsed.bars.find((b) => b.rawDatetime === source['datetime'])
      expect(bar, `no bar parsed for ${String(source['datetime'])}`).toBeDefined()

      expect(bar?.open).toBe(source['open'])
      expect(bar?.high).toBe(source['high'])
      expect(bar?.low).toBe(source['low'])
      expect(bar?.close).toBe(source['close'])
    }
  })

  it('THE RECORDED FIXTURE CANNOT DETECT A LOST-PRECISION BUG - measured, not assumed', () => {
    // This test asserts a property of the FIXTURE, not of the parser, and it
    // exists so the next person does not build a preservation test on the
    // recorded response alone and believe it proves something.
    //
    // Every one of its 20 price values is unchanged by a Number() round-trip,
    // so a parser that called Number() would pass the test above. This is the
    // same shape as the two failures recorded in LESSONS: the case chosen to
    // demonstrate the rule was the one case that could not demonstrate it.
    const raw = readJsonFixture<RawBody>(RECORDED)

    const survivors = raw.values.flatMap((v) =>
      (['open', 'high', 'low', 'close'] as const)
        .map((f) => v[f])
        .filter((text): text is string => text !== undefined)
        .filter((text) => String(Number(text)) === text),
    )
    const total = raw.values.length * 4

    expect(survivors).toHaveLength(total)
  })

  it('preserves values that Number() WOULD change - the guard fixture', () => {
    // The only assertion in this file that can actually fail if the parser
    // starts coercing.
    const raw = readJsonFixture<RawBody>(DECIMAL_GUARD)
    const parsed = parseTimeSeries(raw)

    for (const [i, source] of raw.values.entries()) {
      const bar = parsed.bars[i]
      expect(bar?.open).toBe(source['open'])
      expect(bar?.high).toBe(source['high'])
      expect(bar?.low).toBe(source['low'])
      expect(bar?.close).toBe(source['close'])
      if (source['volume'] !== undefined) expect(bar?.volume).toBe(source['volume'])
    }

    // Named explicitly: these are the exact renderings a coercing parser
    // destroys, and stating them makes the intent survive a fixture edit.
    expect(parsed.bars[0]?.open).toBe('4600.10')
    expect(parsed.bars[0]?.low).toBe('4600.00')
    expect(parsed.bars[0]?.close).toBe('4600.2500')
    expect(parsed.bars[1]?.open).toBe('4600.123456789012345')
  })

  it('POSITIVE CONTROL - the guard fixture really would break under Number()', () => {
    // If someone "tidies" the guard fixture into ordinary-looking prices, the
    // test above silently stops guarding anything. This fails when that happens.
    const raw = readJsonFixture<RawBody>(DECIMAL_GUARD)

    for (const value of raw.values) {
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        const text = value[field]
        expect(text).toBeDefined()
        expect(
          String(Number(text)),
          `${field}=${String(text)} survives Number() - it guards nothing`,
        ).not.toBe(text)
      }
    }
  })

  it('keeps prices as strings, never numbers', () => {
    const parsed = parseTimeSeries(readJsonFixture(DECIMAL_GUARD))

    for (const bar of parsed.bars) {
      expect(typeof bar.open).toBe('string')
      expect(typeof bar.high).toBe('string')
      expect(typeof bar.low).toBe('string')
      expect(typeof bar.close).toBe('string')
    }
  })
})

describe('parseUtcDatetime - the provider text is UTC, and the local zone is irrelevant', () => {
  it('parses a datetime as UTC', () => {
    expect(parseUtcDatetime('2026-08-27 03:30:00').toISOString()).toBe('2026-08-27T03:30:00.000Z')
  })

  it('parses a date-only value as midnight UTC', () => {
    expect(parseUtcDatetime('2025-07-06').toISOString()).toBe('2025-07-06T00:00:00.000Z')
  })

  it('DOES NOT AGREE WITH new Date() - which is the whole point', () => {
    // The bug this function exists to prevent, demonstrated rather than
    // described. `new Date('2026-08-27 03:30:00')` parses in the process's
    // LOCAL zone. Under TZ=Asia/Bangkok (the user's own zone, UTC+7) it yields
    // an instant seven hours from the correct one - with correct prices, a
    // plausible chart, and no error anywhere.
    //
    // The test asserts the DIFFERENCE is zero only when the process is already
    // in UTC, so it is meaningful on the user's machine and inert on a UTC CI
    // runner rather than wrong on either.
    const text = '2026-08-27 03:30:00'
    const ours = parseUtcDatetime(text)
    const naive = new Date(text)
    const offsetMinutes = naive.getTimezoneOffset()

    expect(ours.toISOString()).toBe('2026-08-27T03:30:00.000Z')
    expect(naive.getTime() - ours.getTime()).toBe(offsetMinutes * 60 * 1000)
  })

  it('refuses a format it does not recognise rather than guessing', () => {
    // A provider changing its datetime rendering is the canary for exactly the
    // timezone bug raw_datetime exists to make recoverable. These are rejected
    // ON PURPOSE, including the two that would be safe to accept: absorbing a
    // rendering change silently is the failure this strictness exists to
    // prevent. See the note on DATETIME_PATTERN.
    expect(() => parseUtcDatetime('27/08/2026 03:30')).toThrow(ValidationError)
    expect(() => parseUtcDatetime('2026-08-27T03:30:00')).toThrow(ValidationError)
    expect(() => parseUtcDatetime('2026-08-27T03:30:00Z')).toThrow(ValidationError)
    expect(() => parseUtcDatetime('2026-08-27T03:30:00+07:00')).toThrow(ValidationError)
    expect(() => parseUtcDatetime('2026-08-27 03:30')).toThrow(ValidationError)
    expect(() => parseUtcDatetime('')).toThrow(ValidationError)
  })

  it('refuses an impossible date the pattern would otherwise accept', () => {
    // Date.UTC silently rolls 2026-02-30 forward to March 2.
    expect(() => parseUtcDatetime('2026-02-30 00:00:00')).toThrow(ValidationError)
  })
})

describe('parseTimeSeries - shape validation at the boundary', () => {
  it('maps meta through', () => {
    const parsed = parseTimeSeries(readJsonFixture(RECORDED))
    expect(parsed.symbol).toBe('XAU/USD')
    expect(parsed.interval).toBe('15min')
  })

  it('reports a null volume when the provider sends none', () => {
    // Spot gold on this feed has no volume. null and 0 are different facts.
    const parsed = parseTimeSeries(readJsonFixture(RECORDED))
    expect(parsed.bars.every((b) => b.volume === null)).toBe(true)
  })

  it('raises a ProviderError on an error status', () => {
    // The fixture is SYNTHETIC and its shape is unverified - see the manifest
    // and OQ-3. This proves the branch works, not that the API behaves so.
    expect(() => parseTimeSeries(readJsonFixture(ERROR_429))).toThrow(ProviderError)
    expect(() => parseTimeSeries(readJsonFixture(ERROR_429))).toThrow(/429/)
  })

  it('raises a ValidationError on an unrecognised body', () => {
    expect(() => parseTimeSeries({ unexpected: true })).toThrow(ValidationError)
    expect(() => parseTimeSeries({ status: 'ok', values: [{ datetime: '2026-01-01' }] })).toThrow(
      ValidationError,
    )
  })

  it('refuses a numeric price rather than accepting it', () => {
    // If the provider ever starts sending JSON numbers, that is a change worth
    // failing on: by the time a number reaches us the text is already gone.
    expect(() =>
      parseTimeSeries({
        status: 'ok',
        values: [
          {
            datetime: '2026-08-27 03:30:00',
            open: 4600.1,
            high: 4600.5,
            low: 4600,
            close: 4600.25,
          },
        ],
      }),
    ).toThrow(ValidationError)
  })
})

describe('assertAscending - ordering is asserted, never repaired', () => {
  it('accepts an ascending page', () => {
    const parsed = parseTimeSeries(readJsonFixture(ASCENDING))
    expect(() => assertAscending(parsed.bars)).not.toThrow()
  })

  it('POSITIVE CONTROL - rejects a deliberately shuffled page', () => {
    // An ordering assertion over a page that happens to be sorted passes
    // whether the check works or not. This is the case that proves it works.
    const parsed = parseTimeSeries(readJsonFixture(SHUFFLED))
    expect(() => assertAscending(parsed.bars)).toThrow(ProviderError)
    expect(() => assertAscending(parsed.bars)).toThrow(/not strictly ascending/)
  })

  it('POSITIVE CONTROL - rejects the RECORDED page, which is genuinely descending', () => {
    // Real provider data, in the order the provider actually sent it. A second
    // control drawn from reality rather than construction.
    const parsed = parseTimeSeries(readJsonFixture(RECORDED))
    expect(() => assertAscending(parsed.bars)).toThrow(/goes backwards/)
  })

  it('rejects a repeated timestamp inside one page', () => {
    // The upsert would absorb a duplicate as a `noop` and hide it.
    const parsed = parseTimeSeries({
      status: 'ok',
      values: [
        { datetime: '2026-08-27 03:00:00', open: '1', high: '1', low: '1', close: '1' },
        { datetime: '2026-08-27 03:00:00', open: '1', high: '1', low: '1', close: '1' },
      ],
    })
    expect(() => assertAscending(parsed.bars)).toThrow(/repeats/)
  })

  it('accepts an empty or single-bar page', () => {
    expect(() => assertAscending([])).not.toThrow()
    const parsed = parseTimeSeries({
      status: 'ok',
      values: [{ datetime: '2026-08-27 03:00:00', open: '1', high: '1', low: '1', close: '1' }],
    })
    expect(() => assertAscending(parsed.bars)).not.toThrow()
  })
})
