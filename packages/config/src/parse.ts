import { ConfigValidationError, type ConfigProblem } from './errors'
import { EXPECTED, envSchema, type LogLevel, type NodeEnv, type RawEnv } from './schema'
import { Secret } from './secret'

/** The validated application configuration. */
export interface Config {
  readonly nodeEnv: NodeEnv
  readonly logLevel: LogLevel
  /** Contains a password. Wrapped so it cannot be printed by accident. */
  readonly databaseUrl: Secret<string>
}

/** What a process's environment looks like before validation. */
export type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * Validate an environment and build the typed configuration.
 *
 * Pure: the environment is passed in, never read from `process.env`. That
 * keeps it trivially testable, lets tests cover many environments without
 * mutating global state (and without ordering dependencies between tests), and
 * means importing this package has no side effects - so a unit test elsewhere
 * cannot be brought down by an unrelated missing variable.
 *
 * @throws {ConfigValidationError} listing every problem found, never one at a time.
 */
export function parseConfig(env: EnvSource): Config {
  const result = envSchema.safeParse(env)

  if (!result.success) {
    throw new ConfigValidationError(toProblems(result.error.issues, env))
  }

  return toConfig(result.data)
}

/**
 * Translate Zod issues into our own problem records.
 *
 * Zod's issue objects are deliberately not surfaced. Several of its default
 * messages include the received value, which for `DATABASE_URL` would print a
 * password into the boot log. Only the variable name, a missing/invalid
 * classification, and our own expectation text ever escape this function.
 */
function toProblems(issues: readonly { path: PropertyKey[] }[], env: EnvSource): ConfigProblem[] {
  const problems = new Map<string, ConfigProblem>()

  for (const issue of issues) {
    const variable = String(issue.path[0] ?? '(unknown)')
    if (problems.has(variable)) continue

    // Distinguished from the raw environment rather than from the issue code:
    // absent means missing, present but rejected means invalid.
    const kind = env[variable] === undefined ? 'missing' : 'invalid'
    const expected = EXPECTED[variable as keyof RawEnv] ?? 'a valid value'

    problems.set(variable, { variable, kind, expected })
  }

  return [...problems.values()]
}

function toConfig(raw: RawEnv): Config {
  return {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    databaseUrl: new Secret(raw.DATABASE_URL),
  }
}
