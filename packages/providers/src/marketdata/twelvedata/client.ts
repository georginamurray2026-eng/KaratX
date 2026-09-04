import type { Secret } from '@karatx/config'
import { NetworkError, ProviderError } from '@karatx/core'

import { NULL_CAPTURE_SINK, type CaptureSink, type CaptureWindow } from '../capture'
import { TWELVEDATA_ENDPOINTS } from './endpoints'
import { assertAscending, parseTimeSeries, type ParsedTimeSeries } from './parse'
import { buildHeaders, buildUrl, redactUrl, type TimeSeriesQuery } from './request'

/**
 * The Twelve Data client. ONE request, no paging, no retry, no pacing.
 *
 * Those three are deliberately elsewhere. Paging belongs to the backfill job,
 * which owns the resume frontier; retry and pacing wrap this client rather than
 * living inside it, so each is testable on its own and this stays a plain
 * request-response translation.
 *
 * NETWORK ACCESS IS INJECTED, NEVER REACHED FOR. `fetch` is a parameter. That
 * is what lets every test in this package replay recorded responses with no
 * network and no mocking of globals, and ADR-008 made "can this provider's
 * responses be recorded and replayed?" a scored selection criterion. A guard
 * test asserts no file under this directory reaches for a global `fetch`.
 */

/** The minimal response shape this client needs. `Response` satisfies it. */
export interface HttpResponse {
  readonly status: number
  readonly headers: { get: (name: string) => string | null }
  text: () => Promise<string>
}

/** The minimal fetch shape this client needs. Global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<HttpResponse>

export interface TwelveDataClientOptions {
  readonly fetch: FetchLike
  readonly apiKey: Secret<string>
  /** Defaults to a sink that records nothing. */
  readonly capture?: CaptureSink
  /** Identifies the run in capture files. */
  readonly runId?: string
}

/** Headers worth keeping. Everything else is noise, and some of it is a key. */
const CAPTURED_HEADERS = [
  'content-type',
  'date',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'api-credits-used',
  'api-credits-left',
] as const

/**
 * `Retry-After` as milliseconds, when it is present and is a delay in seconds.
 *
 * The HTTP-date form is deliberately NOT handled: interpreting it needs the
 * local clock to agree with the server's, and a clock skew would turn a
 * three-second wait into an hour or into no wait at all. When the header is a
 * date, this returns nothing and the ordinary backoff applies - a slightly
 * wrong wait beats a confidently wrong one.
 */
function parseRetryAfter(header: string | null): { retryAfterMs?: number } {
  if (header === null) return {}
  const seconds = Number(header.trim())
  if (!Number.isFinite(seconds) || seconds < 0) return {}
  return { retryAfterMs: Math.round(seconds * 1000) }
}

function collectHeaders(response: HttpResponse): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of CAPTURED_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) out[name] = value
  }
  return out
}

export class TwelveDataClient {
  readonly #fetch: FetchLike
  readonly #apiKey: Secret<string>
  readonly #capture: CaptureSink
  readonly #runId: string
  #page = 0

  constructor(options: TwelveDataClientOptions) {
    this.#fetch = options.fetch
    this.#apiKey = options.apiKey
    this.#capture = options.capture ?? NULL_CAPTURE_SINK
    this.#runId = options.runId ?? 'adhoc'
  }

  /** Pages captured so far. Recorded on the `job_runs` row. */
  get pagesFetched(): number {
    return this.#page
  }

  /**
   * Fetch one page of bars, ascending.
   *
   * @throws {NetworkError} if the request itself failed - policy `retry`.
   * @throws {ProviderError} on a non-2xx status or a provider error body.
   * @throws {ValidationError} if the body does not match the expected shape.
   */
  async timeSeries(query: TimeSeriesQuery): Promise<ParsedTimeSeries> {
    const endpoint = TWELVEDATA_ENDPOINTS.timeSeries
    const url = buildUrl(endpoint, query)
    const page = (this.#page += 1)

    let response: HttpResponse
    try {
      response = await this.#fetch(url, { method: 'GET', headers: buildHeaders(this.#apiKey) })
    } catch (error) {
      // Classified `network`, whose policy is `retry`. The retry wrapper reads
      // that classification rather than inspecting the error itself.
      throw new NetworkError(`Twelve Data request failed: ${endpoint}`, {
        cause: error,
        context: { endpoint, page },
      })
    }

    const body = await response.text()

    // CAPTURED BEFORE ANYTHING IS PARSED. Everything below this line can reject
    // the data; none of it can lose it. See capture.ts.
    await this.#capture.writePage({
      runId: this.#runId,
      page,
      endpoint,
      urlRedacted: redactUrl(url),
      status: response.status,
      headers: collectHeaders(response),
      body,
      requestedStart: query.startDate,
      requestedEnd: query.endDate,
      capturedAt: new Date().toISOString(),
    })

    const window: CaptureWindow = {
      requestedStart: query.startDate,
      requestedEnd: query.endDate,
      firstBarTime: undefined,
      lastBarTime: undefined,
      barCount: undefined,
    }

    try {
      if (response.status < 200 || response.status >= 300) {
        // The body is included because Twelve Data's error detail lives there,
        // and truncated because an HTML error page from an intermediary would
        // otherwise fill the log. The full body is already on disk.
        throw new ProviderError(
          `Twelve Data returned HTTP ${String(response.status)} for ${endpoint}: ${body.slice(0, 400)}`,
          {
            context: {
              status: response.status,
              endpoint,
              page,
              // Surfaced so `withRetry` can honour it without knowing anything
              // about HTTP. Absent unless the provider actually sent it, which
              // is UNVERIFIED for Twelve Data - OQ-2.
              ...parseRetryAfter(response.headers.get('retry-after')),
            },
          },
        )
      }

      let parsed: ParsedTimeSeries
      try {
        parsed = parseTimeSeries(JSON.parse(body))
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new ProviderError(
            `Twelve Data returned a body that is not JSON for ${endpoint}: ${body.slice(0, 200)}`,
            { cause: error, context: { status: response.status, endpoint, page } },
          )
        }
        throw error
      }

      // Ordering is asserted, never repaired - see assertAscending.
      assertAscending(parsed.bars)

      const first = parsed.bars.at(0)
      const last = parsed.bars.at(-1)
      await this.#capture.indexPage(this.#runId, page, {
        ...window,
        firstBarTime: first?.openTime.toISOString(),
        lastBarTime: last?.openTime.toISOString(),
        barCount: parsed.bars.length,
      })

      return parsed
    } catch (error) {
      // The index records the failure too, so a run's index.jsonl accounts for
      // every page rather than silently skipping the ones that went wrong.
      await this.#capture.indexPage(
        this.#runId,
        page,
        window,
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      )
      throw error
    }
  }
}
