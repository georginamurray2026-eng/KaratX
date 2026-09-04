import type { Secret } from '@karatx/config'

import { TWELVEDATA_BASE_URL, type TwelveDataEndpoint } from './endpoints'

/**
 * THE SINGLE PLACE A TWELVE DATA URL IS BUILT, and the single place the key is
 * attached. Two of ADR-008's three adapter requirements are enforced here by
 * construction rather than by discipline.
 *
 * REQUIREMENT 1 - THE KEY IS A HEADER, NEVER A QUERY PARAMETER. A key in a URL
 * reaches proxy logs, referrer headers and echoed error bodies. The structural
 * enforcement is that `buildUrl` NEVER RECEIVES THE KEY: it takes only the
 * query type below, which has no field capable of carrying a credential, and
 * the key is attached separately in `buildHeaders`. Putting the key in a URL
 * would mean adding a parameter to a function that has nowhere to put it.
 *
 * REQUIREMENT 2 - `timezone=UTC` ON EVERY REQUEST. Set unconditionally below.
 * The caller-facing query types have NO `timezone` field at all, so it cannot
 * be overridden or forgotten - only deleted from this file, which is what the
 * tests watch for. A Twelve Data response carries no timezone and the account
 * default is Australia/Sydney (UTC+10), so an adapter that omitted this would
 * be wrong by ten hours on every candle, silently and forever.
 */

/**
 * `/time_series` parameters.
 *
 * NOTE WHAT IS ABSENT AND WHY: no `apikey`, and no `timezone`. Neither is an
 * oversight and neither should be added. The key travels as a header; the
 * timezone is fixed at UTC by `buildUrl`.
 */
export interface TimeSeriesQuery {
  /** The provider's own symbol, e.g. `XAU/USD` - from `provider_instruments`. */
  readonly symbol: string
  /** The provider's interval string, e.g. `15min`. Not our `Timeframe`. */
  readonly interval: string
  /** Inclusive lower bound, `YYYY-MM-DD HH:MM:SS`, interpreted UTC. */
  readonly startDate?: string
  /** Inclusive upper bound, same format. */
  readonly endDate?: string
  /** Bars requested. Measured maximum is 5,000 at 15min (T1.1). */
  readonly outputsize?: number
  /**
   * Requested ordering.
   *
   * ASKED FOR, NEVER TRUSTED. The response ordering is asserted on arrival -
   * see `assertAscending`. A provider that silently ignores this parameter
   * would otherwise hand the backfill a frontier that moves backwards.
   */
  readonly order?: 'ASC' | 'DESC'
}

/** `/earliest_timestamp` parameters. Same absences, for the same reasons. */
export interface EarliestTimestampQuery {
  readonly symbol: string
  readonly interval: string
}

export type TwelveDataQuery = TimeSeriesQuery | EarliestTimestampQuery

/**
 * The timezone sent on every request, without exception.
 *
 * Exported so the tests assert against this constant rather than a literal
 * copied into the test file - a copy would keep passing if this changed.
 */
export const REQUIRED_TIMEZONE = 'UTC' as const

/** Header name and scheme, exported for the same reason. */
export const AUTH_HEADER = 'Authorization' as const
export const AUTH_SCHEME = 'apikey' as const

function isTimeSeriesQuery(query: TwelveDataQuery): query is TimeSeriesQuery {
  return 'interval' in query && ('startDate' in query || 'outputsize' in query || 'order' in query)
}

/**
 * Build the request URL. Cannot include a credential, because it is never given
 * one.
 */
export function buildUrl(endpoint: TwelveDataEndpoint, query: TwelveDataQuery): string {
  const url = new URL(endpoint, TWELVEDATA_BASE_URL)

  url.searchParams.set('symbol', query.symbol)
  url.searchParams.set('interval', query.interval)

  // UNCONDITIONAL, AND NOT DERIVED FROM THE QUERY. See the file header.
  url.searchParams.set('timezone', REQUIRED_TIMEZONE)

  // `format=JSON` is the documented default. Set explicitly for the same
  // reason as the timezone: a default that changes is a silent breakage, and
  // the CSV form would parse as garbage rather than fail.
  url.searchParams.set('format', 'JSON')

  if (isTimeSeriesQuery(query)) {
    if (query.startDate !== undefined) url.searchParams.set('start_date', query.startDate)
    if (query.endDate !== undefined) url.searchParams.set('end_date', query.endDate)
    if (query.outputsize !== undefined) url.searchParams.set('outputsize', String(query.outputsize))
    if (query.order !== undefined) url.searchParams.set('order', query.order)
  }

  return url.toString()
}

/**
 * Build the request headers, including the credential.
 *
 * Takes `Secret<string>` rather than a bare string so the value cannot be
 * logged on the way in. `.reveal()` here is the single greppable point at which
 * the key becomes plaintext, and it goes straight into a header value.
 */
export function buildHeaders(apiKey: Secret<string>): Record<string, string> {
  return {
    [AUTH_HEADER]: `${AUTH_SCHEME} ${apiKey.reveal()}`,
    Accept: 'application/json',
  }
}

/**
 * The URL with any credential-shaped parameter blanked, for logs and captures.
 *
 * DEFENCE IN DEPTH, NOT THE PRIMARY GUARANTEE. `buildUrl` cannot produce a URL
 * containing the key. This exists because captured payloads and log lines
 * outlive the code that wrote them: if a later change ever does put a key in a
 * URL, this stops it being written to disk in every capture file as well.
 */
export function redactUrl(url: string): string {
  const parsed = new URL(url)
  for (const name of ['apikey', 'api_key', 'key', 'token', 'access_token']) {
    if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '[REDACTED]')
  }
  return parsed.toString()
}
