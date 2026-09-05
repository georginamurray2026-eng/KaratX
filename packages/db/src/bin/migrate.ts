import { loadConfig, loadEnvFileIfPresent } from '@karatx/config'

import { runMigrations } from '../migrate'

/**
 * `pnpm db:migrate` - the deliberate release step required by OPS-2.
 *
 * Nothing invokes this automatically. It is run by a human, or by an explicit
 * pre-deploy command, never by an application starting up. See ADR-003.
 */

// Loads the repository-root `.env` if there is one. Locally that is where the
// connection string comes from; a deployed environment has no such file and
// injects variables directly.
//
// An explicitly-set DATABASE_URL wins over the file - Node's own `loadEnvFile`
// precedence, pinned by a test in @karatx/config because this command depends
// on it. `DATABASE_URL=... pnpm db:migrate` must migrate the database named on
// the command line, not whatever `.env` happens to point at.
//
// This used to compute the repository root by counting `..` segments, which
// resolves to the wrong directory silently if the file ever moves.
loadEnvFileIfPresent()

async function main(): Promise<void> {
  const config = loadConfig()

  // `.reveal()` is the single greppable point at which the connection string
  // leaves its Secret wrapper. It goes straight into the connection pool and is
  // never logged - which is why the success message names nothing at all.
  const applied = await runMigrations(config.databaseUrl.reveal())

  // OBLIGATION 39: THE TWO CASES MUST NOT LOOK ALIKE.
  //
  // This printed `Migrations applied.` whether it applied three migrations or
  // none. A no-op run and a real one were byte-identical, so verifying that
  // 0002 and 0003 had landed meant querying `drizzle.__drizzle_migrations`
  // separately — the message and the exit code were both satisfied by a run
  // that could have done nothing at all.
  if (applied.length === 0) {
    process.stdout.write('No migrations to apply — the database is already up to date.\n')
    return
  }

  process.stdout.write(
    `Applied ${String(applied.length)} migration${applied.length === 1 ? '' : 's'}:\n` +
      applied.map((m) => `  ${m.tag}\n`).join(''),
  )
}

main().catch((error: unknown) => {
  // Reports the error only, never the connection string: this runs in deploy
  // logs and DATABASE_URL carries a password.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(`Migration failed. ${message}\n`)
  process.exitCode = 1
})
