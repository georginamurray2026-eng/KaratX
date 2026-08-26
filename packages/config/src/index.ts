/**
 * `@karatx/config` - environment parsing and validation.
 *
 * Every environment variable is validated through a Zod schema before the
 * application does anything else, and a bad environment fails loudly and by
 * name rather than surfacing later as a confusing runtime error (SEC-2).
 *
 * Two entry points, deliberately separated:
 *
 *   parseConfig(env)  pure. Environment passed in. Use this in tests.
 *   loadConfig()      reads process.env once and caches. Use this at boot.
 *
 * Note that `packages/core` may not import this package at all - config reads
 * process state, which is both I/O and non-deterministic (F.3 invariant 1).
 * The ESLint boundary added in T0.2 enforces that.
 */

export { ConfigValidationError, formatProblems, type ConfigProblem } from './errors'
export { loadConfig, resetConfigCache } from './load'
export { parseConfig, type Config, type EnvSource } from './parse'
export {
  EXPECTED,
  LOG_LEVELS,
  NODE_ENVS,
  REQUIRED_VARS,
  SECRET_VARS,
  envSchema,
  type LogLevel,
  type NodeEnv,
  type RawEnv,
} from './schema'
export { isSecret, Secret } from './secret'

export const CONFIG_PACKAGE_NAME = '@karatx/config' as const
