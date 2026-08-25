/**
 * Layer 3 of secret redaction: scrubbing known secret values out of free text.
 *
 * Three layers protect logs, because each catches what the others cannot:
 *
 *   1. Secret<T>            (packages/config) - structural. A wrapped value
 *                           cannot be stringified by accident at all.
 *   2. Pino `redact` paths  - fields *named* like secrets, e.g. `password`.
 *   3. this module          - a secret embedded INSIDE a string.
 *
 * Layer 3 exists because layers 1 and 2 share a blind spot, and it is the one
 * that actually leaks in practice:
 *
 *     DATABASE_URL=postgres://karatx:REALPASSWORD@host/db
 *       -> pg throws; error.message or error.stack contains the whole URL
 *       -> logger.error({ err })
 *       -> path redaction finds no field named "password". Secret is logged.
 *
 * Applied only to the log message and to error `message`/`stack`, not to every
 * field of every line: that is where embedded secrets realistically appear,
 * and it keeps the cost bounded to a few string replacements.
 */

export const REDACTED = '[REDACTED]'

/**
 * Below this length, a "secret" would match so much ordinary text that
 * scrubbing would corrupt logs rather than protect anything - and an empty
 * string would match everywhere. Registering one is a programming error, so it
 * throws rather than being quietly ignored.
 */
export const MIN_SECRET_LENGTH = 8

export interface SecretScrubber {
  /** Replace every known secret occurrence in a string. */
  scrub: (value: string) => string
  /** Number of registered secrets. Exposed for assertions, not for logs. */
  readonly size: number
}

/**
 * Build a scrubber for a fixed set of secret values.
 *
 * Values are passed in explicitly rather than read from configuration, so this
 * module has no dependency on `packages/config` and stays trivially testable.
 * The caller performs the single `.reveal()` that unwraps a Secret.
 */
export function createSecretScrubber(secrets: readonly string[]): SecretScrubber {
  const unique = [...new Set(secrets.filter((secret) => secret.length > 0))]

  for (const secret of unique) {
    if (secret.length < MIN_SECRET_LENGTH) {
      // Deliberately does not include the offending value in the message.
      throw new Error(
        `Refusing to register a secret shorter than ${String(MIN_SECRET_LENGTH)} characters: it would match ordinary text and corrupt every log line.`,
      )
    }
  }

  // Longest first, so that a secret containing another is replaced whole
  // rather than being left half-scrubbed.
  const ordered = [...unique].sort((a, b) => b.length - a.length)

  return {
    get size() {
      return ordered.length
    },
    scrub(value: string): string {
      if (ordered.length === 0) return value
      let result = value
      for (const secret of ordered) {
        if (result.includes(secret)) {
          result = result.split(secret).join(REDACTED)
        }
      }
      return result
    },
  }
}

/**
 * Field names whose values are redacted by Pino regardless of content.
 *
 * Layer 2. Covers both the camelCase shape used in code and the SCREAMING_CASE
 * shape used by environment variables, since either can end up in a log
 * object. The wildcard entries catch one level of nesting, which is as far as
 * Pino's path syntax reaches.
 */
export const REDACTED_FIELD_PATHS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'auth',
  'credentials',
  'connectionString',
  'databaseUrl',
  'DATABASE_URL',
  'PGPASSWORD',
  '*.password',
  '*.passwd',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.authorization',
  '*.auth',
  '*.credentials',
  '*.connectionString',
  '*.databaseUrl',
  '*.DATABASE_URL',
  '*.PGPASSWORD',
]
