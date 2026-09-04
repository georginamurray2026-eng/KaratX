/**
 * `@karatx/providers` - adapters for market data, calendar, news, LLM and
 * notifications, plus the application logger.
 *
 * Every external response is validated at this boundary before it enters the
 * domain (SEC-3). Malformed input is quarantined, never repaired (F.2).
 *
 * The market-data adapter lands in T1.4/T1.7 against Twelve Data (ADR-008,
 * which superseded ADR-005's OANDA choice on regional availability).
 */

export { getCorrelationId, withCorrelationId } from './correlation'
export {
  createFileCaptureSink,
  NULL_CAPTURE_SINK,
  pageFileName,
  type CapturePage,
  type CaptureSink,
  type CaptureWindow,
} from './marketdata/capture'
export {
  TwelveDataClient,
  type FetchLike,
  type HttpResponse,
  type TwelveDataClientOptions,
} from './marketdata/twelvedata/client'
export {
  ALL_TWELVEDATA_ENDPOINTS,
  TWELVEDATA_BASE_URL,
  TWELVEDATA_ENDPOINTS,
  type TwelveDataEndpoint,
} from './marketdata/twelvedata/endpoints'
export {
  assertAscending,
  parseTimeSeries,
  parseUtcDatetime,
  type ParsedTimeSeries,
  type ProviderBar,
} from './marketdata/twelvedata/parse'
export {
  AUTH_HEADER,
  AUTH_SCHEME,
  buildHeaders,
  buildUrl,
  redactUrl,
  REQUIRED_TIMEZONE,
  type EarliestTimestampQuery,
  type TimeSeriesQuery,
  type TwelveDataQuery,
} from './marketdata/twelvedata/request'
export {
  createLogger,
  LOG_LEVELS,
  type CreateLoggerOptions,
  type DestinationStream,
  type LogLevel,
  type Logger,
} from './logger'
export {
  createSecretScrubber,
  MIN_SECRET_LENGTH,
  REDACTED,
  REDACTED_FIELD_PATHS,
  type SecretScrubber,
} from './redact'

export const PROVIDERS_PACKAGE_NAME = '@karatx/providers' as const
