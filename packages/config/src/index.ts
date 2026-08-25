/**
 * `@karatx/config` - environment parsing and validation.
 *
 * Populated in T0.3: every environment variable parsed through a Zod schema
 * at process start, failing loudly and by name before any other work (SEC-2).
 */

export const CONFIG_PACKAGE_NAME = '@karatx/config' as const
