import { parseConfig, type Config } from './parse'

let cached: Config | undefined

/**
 * Read and validate `process.env`, once.
 *
 * This is the only function in the package that touches process state, and it
 * is the intended first call of any entry point - before a database
 * connection, before a feed, before a server starts listening.
 *
 * NOT PROVEN AT T0.3. The acceptance criterion says configuration must fail
 * "before any other work", which is a property of a boot sequence. No boot
 * sequence exists yet: the worker lifecycle is T0.8 and the web app is T0.7.
 * What T0.3 delivers is the mechanism and its failure message; those tasks must
 * verify the ordering by actually calling this first. Recorded in the T0.3
 * report rather than ticked off.
 */
export function loadConfig(): Config {
  cached ??= parseConfig(process.env)
  return cached
}

/**
 * Discard the cached configuration.
 *
 * Exists for tests that need `loadConfig` to observe a changed environment.
 * Production code has no reason to call it - configuration is immutable for
 * the lifetime of a process.
 */
export function resetConfigCache(): void {
  cached = undefined
}
