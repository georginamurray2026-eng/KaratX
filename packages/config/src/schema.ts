import { z } from 'zod'

export const NODE_ENVS = ['development', 'test', 'production'] as const
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

export type NodeEnv = (typeof NODE_ENVS)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * Accepts only a parseable connection URL using a Postgres protocol.
 *
 * Deliberately does NOT check that the database is reachable - that is I/O and
 * belongs to T0.4. This validates shape, nothing more.
 */
function isPostgresConnectionUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    // Not a parseable URL at all. Reported as invalid by the caller; the value
    // itself is never included in the message (it holds a password).
    return false
  }
  return url.protocol === 'postgres:' || url.protocol === 'postgresql:'
}

/**
 * The environment contract.
 *
 * Note this is NOT strict: `process.env` carries hundreds of unrelated
 * variables (PATH, HOME, CI injections) and rejecting unknown keys would fail
 * every real process. Known keys are validated; the rest are ignored.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.string().refine(isPostgresConnectionUrl),
})

export type RawEnv = z.infer<typeof envSchema>

/** Variables whose value must never be printed. Drives redaction in errors. */
export const SECRET_VARS = new Set<string>(['DATABASE_URL'])

/**
 * Human-readable expectations, used to build validation messages.
 *
 * These exist so error output never depends on Zod's default text, which for
 * some issue types echoes the received value - unacceptable when the received
 * value is a connection string containing a password.
 */
export const EXPECTED: Record<keyof RawEnv, string> = {
  NODE_ENV: `one of ${NODE_ENVS.map((v) => `'${v}'`).join(' | ')}`,
  LOG_LEVEL: `one of ${LOG_LEVELS.map((v) => `'${v}'`).join(' | ')}`,
  DATABASE_URL: 'a postgres:// or postgresql:// connection URL',
}

/** Variables that must be present. Everything else has a default. */
export const REQUIRED_VARS: readonly (keyof RawEnv)[] = ['DATABASE_URL']
