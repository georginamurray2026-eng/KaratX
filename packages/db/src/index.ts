/**
 * `@karatx/db` - Drizzle schema, migrations and query helpers.
 *
 * Migrations are applied only by the explicit `pnpm db:migrate` step, never at
 * boot (OPS-2 / ADR-003). The migration runner is intentionally NOT exported
 * from this entry point, so no application code can reach it by importing the
 * package - it is reached only via its own module path.
 */

export * from './schema/index'

export const DB_PACKAGE_NAME = '@karatx/db' as const
