import { Secret } from '@karatx/config'
import { NetworkError, ProviderError, ValidationError } from '@karatx/core'
import { fixturePath, readFixture } from '@karatx/test-support'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import type { CapturePage, CaptureSink, CaptureWindow } from '../capture'
import { TwelveDataClient, type FetchLike, type HttpResponse } from './client'

// LOW-ENTROPY ON PURPOSE. gitleaks scans full history and flagged the
// previous high-entropy placeholder as a generic-api-key, failing CI #52. A
// test fixture that LOOKS like a credential trains the scanner to be ignored,
// which is the habit that lets a real one through.
const API_KEY = 'xxxxxxxx-not-a-real-key-xxxxxxxx'
const apiKey = new Secret(API_KEY)

const ASCENDING = 'providers/twelvedata-xauusd-15min-ascending.json'
const RECORDED = 'providers/twelvedata-xauusd-15min.json'
const ERROR_429 = 'providers/twelvedata-error-429.json'

interface Call {
  readonly url: string
  readonly headers: Record<string, string>
}

/** Serves a recorded body. Records what was asked for, so it can be asserted. */
function stubFetch(
  body: string,
  options: { status?: number; headers?: Record<string, string>; throws?: unknown } = {},
): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const headers = options.headers ?? { 'content-type': 'application/json' }

  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers })
    if (options.throws !== undefined) throw options.throws

    const response: HttpResponse = {
      status: options.status ?? 200,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => body,
    }
    return response
  }

  return { fetch, calls }
}

/** Captures in memory, so capture behaviour is assertable without a filesystem. */
function recordingSink(): {
  sink: CaptureSink
  pages: CapturePage[]
  index: { page: number; window: CaptureWindow; error?: string }[]
} {
  const pages: CapturePage[] = []
  const index: { page: number; window: CaptureWindow; error?: string }[] = []

  return {
    pages,
    index,
    sink: {
      writePage: async (page) => {
        pages.push(page)
      },
      indexPage: async (_runId, page, window, error) => {
        index.push(error === undefined ? { page, window } : { page, window, error })
      },
    },
  }
}

const QUERY = { symbol: 'XAU/USD', interval: '15min', order: 'ASC' } as const

describe('TwelveDataClient - the request it actually sends', () => {
  it('sends the key as a header and never in the URL', () => {
    const { fetch, calls } = stubFetch(readFixture(ASCENDING))

    return new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY).then(() => {
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).not.toContain(API_KEY)
      expect(calls[0]?.headers['Authorization']).toBe(`apikey ${API_KEY}`)
      expect(new URL(calls[0]?.url ?? '').searchParams.get('timezone')).toBe('UTC')
    })
  })
})

describe('TwelveDataClient - parsing and ordering', () => {
  it('returns ascending bars from a recorded-shaped response', async () => {
    const { fetch } = stubFetch(readFixture(ASCENDING))
    const parsed = await new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)

    expect(parsed.bars).toHaveLength(5)
    expect(parsed.bars[0]?.rawDatetime).toBe('2026-08-27 02:30:00')
    expect(parsed.bars[4]?.rawDatetime).toBe('2026-08-27 03:30:00')
  })

  it('refuses a descending page rather than sorting it', async () => {
    // The recorded response, in the order the provider genuinely sent it.
    const { fetch } = stubFetch(readFixture(RECORDED))

    await expect(new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)).rejects.toThrow(
      /not strictly ascending/,
    )
  })
})

describe('TwelveDataClient - failure classification', () => {
  it('wraps a transport failure as NetworkError, whose policy is retry', async () => {
    const { fetch } = stubFetch('', { throws: new Error('ECONNRESET') })
    const client = new TwelveDataClient({ fetch, apiKey })

    await expect(client.timeSeries(QUERY)).rejects.toBeInstanceOf(NetworkError)
  })

  it('raises ProviderError on a non-2xx status', async () => {
    const { fetch } = stubFetch(readFixture(ERROR_429), { status: 429 })

    await expect(new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it('raises ProviderError on a provider error body served with HTTP 200', async () => {
    // Whether Twelve Data reports 429 as an HTTP status, as a body with
    // status:"error", or both, is UNVERIFIED - see OQ-3. Both paths are handled
    // because guessing wrong in either direction fails the run confusingly.
    const { fetch } = stubFetch(readFixture(ERROR_429), { status: 200 })

    await expect(new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)).rejects.toThrow(/429/)
  })

  it('raises ProviderError, not a SyntaxError, when the body is not JSON', async () => {
    // An intermediary returning an HTML error page is the realistic case. A
    // bare SyntaxError from JSON.parse would classify as `unexpected` and
    // never be retried.
    const { fetch } = stubFetch('<html><body>502 Bad Gateway</body></html>')

    await expect(new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)).rejects.toBeInstanceOf(
      ProviderError,
    )
  })

  it('raises ValidationError when the body is JSON of the wrong shape', async () => {
    const { fetch } = stubFetch(
      JSON.stringify({ status: 'ok', values: [{ datetime: '2026-01-01' }] }),
    )

    await expect(new TwelveDataClient({ fetch, apiKey }).timeSeries(QUERY)).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('TwelveDataClient - capture (the candles.ts obligation)', () => {
  it('writes the raw body BEFORE parsing, so a rejected page is still recoverable', async () => {
    // The ordering guarantee, tested on the path where parsing fails: the body
    // must be on disk even though nothing downstream accepted it.
    const body = JSON.stringify({ status: 'ok', values: [{ datetime: 'not-a-date' }] })
    const { fetch } = stubFetch(body)
    const { sink, pages, index } = recordingSink()

    await expect(
      new TwelveDataClient({ fetch, apiKey, capture: sink, runId: 'run-1' }).timeSeries(QUERY),
    ).rejects.toThrow()

    expect(pages).toHaveLength(1)
    expect(pages[0]?.body).toBe(body)
    expect(index[0]?.error).toMatch(/ValidationError/)
  })

  it('captures the body byte-for-byte, not a re-serialised copy', async () => {
    // A JSON.parse/stringify round-trip would normalise exactly the decimal
    // renderings ADR-008 requires preserving, so the capture would disagree
    // with what arrived.
    const body = readFixture('providers/twelvedata-decimal-guard.json')
    const { fetch } = stubFetch(body)
    const { sink, pages } = recordingSink()

    await new TwelveDataClient({ fetch, apiKey, capture: sink, runId: 'run-1' }).timeSeries(QUERY)

    expect(pages[0]?.body).toBe(body)
    expect(pages[0]?.body).toContain('4600.123456789012345')
    expect(pages[0]?.body).toContain('4600.00')
  })

  it('never writes the key into a capture record', async () => {
    const { fetch } = stubFetch(readFixture(ASCENDING))
    const { sink, pages } = recordingSink()

    await new TwelveDataClient({ fetch, apiKey, capture: sink, runId: 'run-1' }).timeSeries(QUERY)

    expect(JSON.stringify(pages[0])).not.toContain(API_KEY)
  })

  it('indexes the page window so T1.5 can find a bar without opening every file', async () => {
    const { fetch } = stubFetch(readFixture(ASCENDING))
    const { sink, index } = recordingSink()

    await new TwelveDataClient({ fetch, apiKey, capture: sink, runId: 'run-1' }).timeSeries({
      ...QUERY,
      startDate: '2026-08-27 02:30:00',
      endDate: '2026-08-27 03:30:00',
    })

    expect(index).toHaveLength(1)
    expect(index[0]?.window.firstBarTime).toBe('2026-08-27T02:30:00.000Z')
    expect(index[0]?.window.lastBarTime).toBe('2026-08-27T03:30:00.000Z')
    expect(index[0]?.window.barCount).toBe(5)
    expect(index[0]?.window.requestedStart).toBe('2026-08-27 02:30:00')
  })

  it('captures rate-limit headers, which is where the unmeasured answers live', async () => {
    const { fetch } = stubFetch(readFixture(ERROR_429), {
      status: 429,
      headers: { 'retry-after': '17', 'api-credits-left': '0' },
    })
    const { sink, pages } = recordingSink()

    await expect(
      new TwelveDataClient({ fetch, apiKey, capture: sink, runId: 'run-1' }).timeSeries(QUERY),
    ).rejects.toThrow()

    // Whether Twelve Data sends these at all is OQ-2 and OQ-4. Capturing them
    // is how first contact answers those questions rather than guessing them.
    expect(pages[0]?.headers['retry-after']).toBe('17')
    expect(pages[0]?.headers['api-credits-left']).toBe('0')
  })
})

describe('the fixtures this package replays are the ones on disk', () => {
  it('reads the recorded fixture from test/fixtures/providers', async () => {
    // Guards against a test that quietly starts asserting against an inline
    // literal while claiming to replay a recorded response.
    const onDisk = await readFile(fixturePath(RECORDED), 'utf8')
    expect(onDisk).toContain('"status": "ok"')
    expect(JSON.parse(onDisk).values).toHaveLength(5)
  })
})
