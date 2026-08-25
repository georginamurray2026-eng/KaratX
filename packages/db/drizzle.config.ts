import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit configuration - used ONLY to generate SQL migrations from the
 * schema (`pnpm db:generate`).
 *
 * Note the absence of database credentials. Generating a migration is a pure
 * schema-to-SQL transformation and needs no connection, so this step cannot
 * touch a database by accident and needs no secret to run.
 *
 * Applying migrations is a separate, explicit operation (`pnpm db:migrate`,
 * see src/migrate.ts). drizzle-kit's own `push` and `migrate` commands are
 * deliberately not wired up: OPS-2 requires migrations to be a reviewed
 * release step, and `push` mutates a database directly from the schema with no
 * reviewable artefact at all. See ADR-003.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
})
