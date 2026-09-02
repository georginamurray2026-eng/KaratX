import { describe, expect, it } from 'vitest'

import { fixturePath, readCsvFixture, readFixture, readJsonFixture } from './fixtures'

describe('readFixture', () => {
  it('reads a committed fixture as text', () => {
    expect(readFixture('sample/meta.json')).toContain('XAU_USD')
  })

  it('throws naming the fixture and the resolved path when it is missing', () => {
    // A test that silently gets an empty string because a file moved is far
    // worse than one that fails immediately and says where it looked.
    expect(() => readFixture('sample/does-not-exist.csv')).toThrow(
      /Fixture not found: sample\/does-not-exist\.csv \(looked in .+\)/,
    )
  })

  it('resolves paths under the repository fixtures directory', () => {
    expect(fixturePath('sample/meta.json').replace(/\\/g, '/')).toMatch(
      /\/test\/fixtures\/sample\/meta\.json$/,
    )
  })
})

describe('readJsonFixture', () => {
  it('parses JSON', () => {
    const meta = readJsonFixture<{ symbol: string; granularity: string }>('sample/meta.json')
    expect(meta.symbol).toBe('XAU_USD')
    expect(meta.granularity).toBe('H1')
  })

  it('reports which fixture is malformed rather than surfacing a bare syntax error', () => {
    expect(() => readJsonFixture('sample/candles.csv')).toThrow(
      /Fixture is not valid JSON: sample\/candles\.csv/,
    )
  })
})

describe('readCsvFixture', () => {
  it('parses the header', () => {
    expect(readCsvFixture('sample/candles.csv').header).toEqual([
      'time',
      'open',
      'high',
      'low',
      'close',
    ])
  })

  it('parses rows keyed by column name', () => {
    const { rows } = readCsvFixture('sample/candles.csv')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      time: '2026-08-25T09:00:00Z',
      open: '4636.455',
      high: '4637.290',
      low: '4633.175',
      close: '4635.065',
    })
  })

  it('returns values as unconverted strings', () => {
    // Deliberate: the golden exports carry prices whose exact decimal text
    // matters for byte-for-byte reproducibility (NFR-12). Parsing to numbers
    // here would discard trailing zeros before the caller can decide.
    const { rows } = readCsvFixture('sample/candles.csv')
    expect(rows[0]?.['high']).toBe('4637.290')
    expect(typeof rows[0]?.['high']).toBe('string')
  })

  it('ignores a trailing newline rather than emitting a blank row', () => {
    expect(readCsvFixture('sample/candles.csv').rows).toHaveLength(3)
  })

  it('rejects a row whose column count does not match the header', () => {
    // Silently padding or truncating a malformed row is how a fixture ends up
    // quietly wrong and a parity test passes against the wrong numbers.
    //
    // Uses a fixture built for this, rather than a file that happens to have
    // mismatched commas - an incidental fixture can stop testing anything the
    // moment someone edits it, without the test failing to say so.
    expect(() => readCsvFixture('sample/malformed.csv')).toThrow(
      /line 2 has 3 values but the header declares 5 columns/,
    )
  })

  // --- obligation 10: quoted fields are refused, not mis-parsed -------------

  it('REFUSES a quoted field rather than mis-parsing it (obligation 10)', () => {
    expect(() => readCsvFixture('sample/quoted-comma.csv')).toThrow(
      /line 2 contains a double quote, which this loader deliberately refuses to parse/,
    )
  })

  it('POSITIVE CONTROL: the refused fixture is one the column check CANNOT catch', () => {
    // Without this, the test above proves only that some fixture throws - it
    // would pass just as happily against a quoted comma that produced the wrong
    // column count, which the existing check already catches loudly.
    //
    // This reproduces what the OLD loader did with that exact line: split on
    // "," and key by header. The counts MATCH, so nothing would have thrown,
    // and `close` silently receives `low`'s number. That is the silent failure
    // obligation 10 describes, demonstrated rather than asserted.
    const line = readFixture('sample/quoted-comma.csv').split(/\r?\n/)[1] ?? ''
    const header = ['time', 'open', 'high', 'low', 'close']
    const values = line.split(',')

    expect(values).toHaveLength(header.length) // the count check would NOT fire

    const asOldLoaderParsedIt = Object.fromEntries(header.map((c, i) => [c, values[i]]))
    expect(asOldLoaderParsedIt['high']).toBe('637.29"') // shifted, and not a price
    expect(asOldLoaderParsedIt['close']).toBe('4633.175') // silently `low`'s value
  })

  it('still parses an unquoted fixture - the guard is not a blanket refusal', () => {
    // The refusal must not be so broad that it rejects the ordinary case; a
    // guard that fails everything proves nothing about what it selects for.
    expect(readCsvFixture('sample/candles.csv').rows).toHaveLength(3)
  })
})
