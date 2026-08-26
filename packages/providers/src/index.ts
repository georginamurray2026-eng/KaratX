/**
 * `@karatx/providers` - adapters for market data, calendar, news, LLM and
 * notifications, plus the application logger.
 *
 * Every external response is validated at this boundary before it enters the
 * domain (SEC-3). Malformed input is quarantined, never repaired (F.2).
 *
 * The market-data adapter lands in T1.4/T1.7 against OANDA v20 (ADR-005).
 */

export { getCorrelationId, withCorrelationId } from './correlation'
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
