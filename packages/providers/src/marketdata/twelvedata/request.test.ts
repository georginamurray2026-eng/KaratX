import { Secret } from '@karatx/config'
import { describe, expect, it } from 'vitest'

import { ALL_TWELVEDATA_ENDPOINTS, TWELVEDATA_ENDPOINTS } from './endpoints'
import {
  AUTH_HEADER,
  AUTH_SCHEME,
  buildHeaders,
  buildUrl,
  redactUrl,
  REQUIRED_TIMEZONE,
  type TwelveDataQuery,
} from './request'

/**
 * ADR-008 records three adapter requirements that are each a silent-corruption
 * bug if missed. These tests are the enforcement: each must FAIL if the
 * corresponding line is deleted from request.ts.
 */

// Long enough to be unmistakable in a URL, and shaped like a real key.
// LOW-ENTROPY ON PURPOSE. gitleaks scans full history and flagged the
// previous high-entropy placeholder as a generic-api-key, failing CI #52. A
// test fixture that LOOKS like a credential trains the scanner to be ignored,
// which is the habit that lets a real one through.
const API_KEY = 'xxxxxxxx-not-a-real-key-xxxxxxxx'
const apiKey = new Secret(API_KEY)

/** A query for every endpoint, so the loops below cover all of them. */
const QUERIES: Record<string, TwelveDataQuery> = {
  [TWELVEDATA_ENDPOINTS.timeSeries]: {
    symbol: 'XAU/USD',
    interval: '15min',
    startDate: '2020-01-24 13:00:00',
    endDate: '2020-01-25 13:00:00',
    outputsize: 5000,
    order: 'ASC',
  },
  [TWELVEDATA_ENDPOINTS.earliestTimestamp]: { symbol: 'XAU/USD', interval: '15min' },
}

describe('ADR-008 requirement 1 - the key is a header, never a query parameter', () => {
  it.each(ALL_TWELVEDATA_ENDPOINTS)(
    'does not put the key anywhere in the URL for %s',
    (endpoint) => {
      const query = QUERIES[endpoint]
      expect(query, `no query defined for ${endpoint} - add one`).toBeDefined()

      const url = buildUrl(endpoint, query as TwelveDataQuery)

      // The strong form: the plaintext key appears NOWHERE in the URL. Asserting
      // only "no parameter named apikey" would pass if it were smuggled into the
      // path, a differently-named parameter, or the fragment.
      expect(url).not.toContain(API_KEY)
    },
  )

  it.each(ALL_TWELVEDATA_ENDPOINTS)('carries no credential-shaped parameter for %s', (endpoint) => {
    const url = new URL(buildUrl(endpoint, QUERIES[endpoint] as TwelveDataQuery))

    for (const name of ['apikey', 'api_key', 'key', 'token', 'access_token', 'password']) {
      expect(url.searchParams.has(name), `${endpoint} carries a ${name} parameter`).toBe(false)
    }
  })

  it('sends the key as the Authorization header in the documented scheme', () => {
    const headers = buildHeaders(apiKey)
    expect(headers[AUTH_HEADER]).toBe(`${AUTH_SCHEME} ${API_KEY}`)
  })

  it('POSITIVE CONTROL - the URL scan detects a key that IS in a URL', () => {
    // Without this, `expect(url).not.toContain(API_KEY)` is a check that has
    // never been shown to fail. An absence result needs a positive control:
    // this project has eight recorded instances of checks that passed while
    // testing nothing.
    const planted = `https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&apikey=${API_KEY}`

    expect(planted).toContain(API_KEY)
    expect(new URL(planted).searchParams.has('apikey')).toBe(true)
  })

  it('redactUrl blanks a credential parameter if one ever reaches a capture file', () => {
    const planted = `https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&apikey=${API_KEY}`
    const redacted = redactUrl(planted)

    expect(redacted).not.toContain(API_KEY)
    expect(redacted).toContain('apikey=%5BREDACTED%5D')
  })

  it('buildUrl cannot receive the key - it is not in the query type', () => {
    // A type-level guarantee, asserted at runtime as documentation: even when
    // a caller forces a credential-shaped field through, buildUrl ignores it
    // because it only reads the fields it knows.
    const sneaky = {
      symbol: 'XAU/USD',
      interval: '15min',
      apikey: API_KEY,
    } as unknown as TwelveDataQuery

    expect(buildUrl(TWELVEDATA_ENDPOINTS.timeSeries, sneaky)).not.toContain(API_KEY)
  })
})

describe('ADR-008 requirement 2 - timezone=UTC on every request', () => {
  it.each(ALL_TWELVEDATA_ENDPOINTS)('sets timezone=UTC for %s', (endpoint) => {
    const url = new URL(buildUrl(endpoint, QUERIES[endpoint] as TwelveDataQuery))

    // Compared against the exported constant, not a literal 'UTC' copied here.
    // A copy would keep passing if the constant changed.
    expect(url.searchParams.get('timezone')).toBe(REQUIRED_TIMEZONE)
  })

  it('covers every endpoint in the table, and the table is not empty', () => {
    // The loops above are only as good as what they iterate. An empty list
    // answers "nothing found" to every question.
    expect(ALL_TWELVEDATA_ENDPOINTS.length).toBeGreaterThan(1)
    for (const endpoint of ALL_TWELVEDATA_ENDPOINTS) {
      expect(QUERIES[endpoint], `endpoint ${endpoint} has no test query`).toBeDefined()
    }
  })

  it('a caller cannot override the timezone', () => {
    const sneaky = {
      symbol: 'XAU/USD',
      interval: '15min',
      timezone: 'Australia/Sydney',
    } as unknown as TwelveDataQuery

    // The account default is UTC+10. If an override were possible, this is the
    // exact value that would silently shift every bar by ten hours.
    expect(
      new URL(buildUrl(TWELVEDATA_ENDPOINTS.timeSeries, sneaky)).searchParams.get('timezone'),
    ).toBe('UTC')
  })
})

describe('buildUrl - the rest of the query', () => {
  it('sets the documented parameters and omits absent optionals', () => {
    const url = new URL(
      buildUrl(TWELVEDATA_ENDPOINTS.timeSeries, { symbol: 'XAU/USD', interval: '15min' }),
    )

    expect(url.searchParams.get('symbol')).toBe('XAU/USD')
    expect(url.searchParams.get('interval')).toBe('15min')
    expect(url.searchParams.get('format')).toBe('JSON')
    expect(url.searchParams.has('start_date')).toBe(false)
    expect(url.searchParams.has('outputsize')).toBe(false)
  })

  it('passes the paging window through', () => {
    const url = new URL(
      buildUrl(
        TWELVEDATA_ENDPOINTS.timeSeries,
        QUERIES[TWELVEDATA_ENDPOINTS.timeSeries] as TwelveDataQuery,
      ),
    )

    expect(url.searchParams.get('start_date')).toBe('2020-01-24 13:00:00')
    expect(url.searchParams.get('end_date')).toBe('2020-01-25 13:00:00')
    expect(url.searchParams.get('outputsize')).toBe('5000')
    expect(url.searchParams.get('order')).toBe('ASC')
  })
})
