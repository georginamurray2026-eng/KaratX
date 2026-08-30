import { describe, expect, it } from 'vitest'

import { Candle, Instrument, Price, Provider, TIMEFRAMES, Timeframe, Timestamp } from './market'

/**
 * T1.2 requires tests covering malformed, negative, zero and absurd values.
 *
 * Each block below asserts what is REJECTED as deliberately as what is
 * accepted. A schema tested only on good input is a schema whose constraints
 * have never run.
 */

const validCandle = {
  instrumentId: 1,
  providerId: 1,
  timeframe: '15min' as const,
  openTime: '2026-08-27T13:00:00Z',
  open: '4643.35156',
  high: '4650.00000',
  low: '4640.10000',
  close: '4648.20000',
  volume: '0',
  bid: null,
  ask: null,
  rawDatetime: '2026-08-27 13:00:00',
  isFinal: true,
}

describe('Price', () => {
  it('accepts the float32 artefact exactly as delivered, unchanged', () => {
    const parsed = Price.parse('4643.35156')
    // The point of the string representation: what goes in comes out, byte for
    // byte. Number() would give 4643.35156 -> 4643.35156 here but the guarantee
    // is what matters, not this one value.
    expect(parsed).toBe('4643.35156')
  })

  it.each([
    ['negative', '-4643.35'],
    ['zero', '0'],
    ['zero with decimals', '0.00000'],
    ['absurdly large', '99999999.00000'],
    ['too many decimals', '4643.351567'],
    ['not a number', 'abcd'],
    ['empty', ''],
    ['scientific notation', '4.64335156e3'],
    ['leading plus', '+4643.35'],
    ['leading zero', '04643.35'],
    ['whitespace padded', ' 4643.35 '],
    ['comma decimal', '4643,35'],
  ])('rejects %s', (_label, value) => {
    expect(Price.safeParse(value).success).toBe(false)
  })

  it('rejects a number, not merely a bad string', () => {
    // The failure this type exists to prevent: a float32 artefact arriving as a
    // JS number has already lost the original text.
    expect(Price.safeParse(4643.35156).success).toBe(false)
  })
})

describe('Timestamp', () => {
  it.each([
    ['UTC Z', '2026-08-27T13:00:00Z'],
    ['positive offset', '2026-08-27T23:00:00+10:00'],
    ['negative offset', '2026-08-27T09:00:00-04:00'],
    ['fractional seconds', '2026-08-27T13:00:00.123Z'],
  ])('accepts %s', (_label, value) => {
    expect(Timestamp.safeParse(value).success).toBe(true)
  })

  it('REJECTS the naive string Twelve Data actually returns', () => {
    // The whole reason this type exists. The account default is UTC+10 and the
    // response body carries no marker, so a naive string parsed as UTC is
    // wrong by ten hours on every candle, silently.
    expect(Timestamp.safeParse('2026-08-27 13:00:00').success).toBe(false)
  })

  it.each([
    ['naive ISO with T but no offset', '2026-08-27T13:00:00'],
    ['date only', '2026-08-27'],
    ['epoch millis as string', '1756298400000'],
    ['empty', ''],
    ['nonsense', 'yesterday'],
    ['impossible month', '2026-13-01T00:00:00Z'],
    ['impossible day', '2026-02-30T00:00:00Z'],
  ])('rejects %s', (_label, value) => {
    expect(Timestamp.safeParse(value).success).toBe(false)
  })

  // Date.parse alone accepts 2026-02-30 and silently yields 2026-03-02. These
  // cases exist because the first run of this suite caught exactly that, and
  // they are paired so the check is shown to DISCRIMINATE rather than simply
  // reject everything February.
  it.each([
    ['2024-02-29 (real leap day)', '2024-02-29T00:00:00Z', true],
    ['2026-02-29 (not a leap year)', '2026-02-29T00:00:00Z', false],
    ['2026-02-28 (real)', '2026-02-28T00:00:00Z', true],
    ['2026-02-30 (never exists)', '2026-02-30T00:00:00Z', false],
    ['2026-04-31 (April has 30)', '2026-04-31T00:00:00Z', false],
    ['2026-04-30 (real)', '2026-04-30T00:00:00Z', true],
  ])('calendar reality: %s -> accepted=%s', (_label, value, expected) => {
    expect(Timestamp.safeParse(value).success).toBe(expected)
  })
})

describe('Timeframe', () => {
  it('includes 1min, which is not ingested but must be expressible (M2)', () => {
    expect(TIMEFRAMES).toContain('1min')
    expect(Timeframe.safeParse('1min').success).toBe(true)
  })

  it.each([['5min'], ['1D '], ['1d'], ['daily'], ['']])('rejects %s', (value) => {
    expect(Timeframe.safeParse(value).success).toBe(false)
  })
})

describe('Candle', () => {
  it('accepts a well-formed bar', () => {
    expect(Candle.safeParse(validCandle).success).toBe(true)
  })

  it('ACCEPTS a Saturday bar - structural validity is not calendar validity', () => {
    // 2026-08-15 is a Saturday. Rejecting it here would turn a data-quality
    // signal into a parse failure, and T1.5 would never see it.
    const saturday = { ...validCandle, openTime: '2026-08-15T13:00:00Z' }
    expect(Candle.safeParse(saturday).success).toBe(true)
  })

  it('accepts a forming bar as the same type, flagged', () => {
    expect(Candle.safeParse({ ...validCandle, isFinal: false }).success).toBe(true)
  })

  it('accepts null bid/ask, which is what the chosen provider supplies', () => {
    expect(Candle.safeParse({ ...validCandle, bid: null, ask: null }).success).toBe(true)
  })

  it.each([
    ['high below low', { high: '4600.00000', low: '4640.10000' }],
    ['high below open', { high: '4642.00000' }],
    ['high below close', { high: '4645.00000', close: '4648.20000' }],
    ['low above open', { low: '4644.00000' }],
    ['low above close', { low: '4649.00000' }],
  ])('rejects incoherent OHLC: %s', (_label, patch) => {
    expect(Candle.safeParse({ ...validCandle, ...patch }).success).toBe(false)
  })

  it.each([
    ['missing rawDatetime', { rawDatetime: undefined }],
    ['empty rawDatetime', { rawDatetime: '' }],
    ['naive openTime', { openTime: '2026-08-27 13:00:00' }],
    ['negative price', { open: '-1.00000' }],
    ['zero price', { low: '0' }],
    ['numeric price', { close: 4648.2 }],
    ['negative volume', { volume: '-5' }],
    ['fractional volume', { volume: '1.5' }],
    ['zero instrumentId', { instrumentId: 0 }],
    ['negative providerId', { providerId: -1 }],
    ['unknown timeframe', { timeframe: '5min' }],
  ])('rejects %s', (_label, patch) => {
    expect(Candle.safeParse({ ...validCandle, ...patch }).success).toBe(false)
  })

  it('preserves price text through a parse, byte for byte', () => {
    const parsed = Candle.parse(validCandle)
    expect(parsed.open).toBe('4643.35156')
    expect(parsed.rawDatetime).toBe('2026-08-27 13:00:00')
  })
})

describe('Instrument and Provider', () => {
  it('accepts the canonical gold instrument', () => {
    const result = Instrument.safeParse({
      id: 1,
      symbol: 'XAU/USD',
      displayName: 'Gold Spot / US Dollar',
      tickSize: '0.00001',
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['empty symbol', { symbol: '' }],
    ['zero id', { id: 0 }],
    ['negative tickSize', { tickSize: '-0.01' }],
  ])('rejects instrument with %s', (_label, patch) => {
    const base = { id: 1, symbol: 'XAU/USD', displayName: 'Gold', tickSize: '0.00001' }
    expect(Instrument.safeParse({ ...base, ...patch }).success).toBe(false)
  })

  it.each([
    ['twelve_data', true],
    ['massive', true],
    ['Twelve Data', false],
    ['12data', false],
    ['', false],
  ])('provider key %s -> %s', (key, expected) => {
    const result = Provider.safeParse({ id: 1, key, displayName: 'x' })
    expect(result.success).toBe(expected)
  })
})
