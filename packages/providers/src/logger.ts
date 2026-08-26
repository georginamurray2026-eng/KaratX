import { categoryOf, isKaratxError, policyOf } from '@karatx/core'
import { pino, type DestinationStream, type Logger } from 'pino'

import { getCorrelationId } from './correlation'
import { REDACTED, REDACTED_FIELD_PATHS, createSecretScrubber } from './redact'

export type { DestinationStream, Logger } from 'pino'

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export interface CreateLoggerOptions {
  readonly level: LogLevel
  /** Identifies the emitting process, e.g. 'worker' or 'web'. */
  readonly name?: string
  /**
   * Actual secret values to scrub from messages and error text (layer 3).
   *
   * Passed in explicitly rather than read from configuration, so this package
   * has no dependency on `packages/config` and the logger is testable without
   * an environment. The caller performs the single `.reveal()`.
   */
  readonly secrets?: readonly string[]
  /** Where to write. Defaults to stdout; tests pass a capturing stream. */
  readonly destination?: DestinationStream
}

/**
 * Build the application logger.
 *
 * JSON on stdout, always - in development as well as production. Identical
 * output everywhere means a log line that reproduces a problem locally is
 * byte-comparable with the one from the deployed service, and it avoids a
 * pretty-printing transport that exists only on one of them.
 *
 * Deliberately writes nowhere but its destination stream. In particular it
 * does NOT write to `system_events`, even though T0.4 created that table: a
 * logger that depends on the database would fail exactly when the database is
 * the thing that broke, and logging a database error would attempt a database
 * write. Operational events are recorded explicitly by T0.8 and T1.7 at the
 * points where one genuinely occurred.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const scrubber = createSecretScrubber(options.secrets ?? [])

  const base = options.name === undefined ? {} : { name: options.name }

  const pinoOptions = {
    level: options.level,
    base,

    // Layer 2: redact by field name, whatever the value.
    redact: { paths: [...REDACTED_FIELD_PATHS], censor: REDACTED },

    // Attaches the ambient correlation ID to every line without any call site
    // having to pass it.
    mixin(): Record<string, unknown> {
      const correlationId = getCorrelationId()
      return correlationId === undefined ? {} : { correlationId }
    },

    serializers: {
      err: (error: unknown): Record<string, unknown> => serializeError(error, scrubber.scrub),
    },

    hooks: {
      // Layer 3 for the message itself. Pino passes the log arguments through
      // here before formatting, which is the only point at which the message
      // string can be rewritten.
      logMethod(
        this: Logger,
        args: unknown[],
        method: (this: Logger, ...a: unknown[]) => void,
      ): void {
        const scrubbed = args.map((arg) => (typeof arg === 'string' ? scrubber.scrub(arg) : arg))
        method.apply(this, scrubbed)
      },
    },
  }

  return options.destination === undefined
    ? pino(pinoOptions)
    : pino(pinoOptions, options.destination)
}

/**
 * Render an error for logging.
 *
 * Adds the taxonomy fields so a log line says how the error should be handled,
 * not merely that one occurred, and scrubs known secrets from `message` and
 * `stack` - the two places a connection string realistically ends up.
 */
function serializeError(error: unknown, scrub: (value: string) => string): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: scrub(String(error)) }
  }

  const serialized: Record<string, unknown> = {
    type: error.name,
    message: scrub(error.message),
    category: categoryOf(error),
    policy: policyOf(error),
  }

  if (error.stack !== undefined) {
    serialized['stack'] = scrub(error.stack)
  }

  if (isKaratxError(error) && Object.keys(error.context).length > 0) {
    serialized['context'] = error.context
  }

  if (error.cause !== undefined) {
    serialized['cause'] = serializeError(error.cause, scrub)
  }

  return serialized
}
