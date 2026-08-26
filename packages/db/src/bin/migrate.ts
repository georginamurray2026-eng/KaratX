import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '@karatx/config'

import { runMigrations } from '../migrate'

/**
 * `pnpm db:migrate` - the deliberate release step required by OPS-2.
 *
 * Nothing invokes this automatically. It is run by a human, or by an explicit
 * pre-deploy command, never by an application starting up. See ADR-003.
 */

// Local development keeps the connection string in a git-ignored `.env`.
// Deployed environments have no such file and inject the environment directly,
// so this loads it only if present rather than requiring it.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const envPath = path.join(repoRoot, '.env')
if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
}

async function main(): Promise<void> {
  const config = loadConfig()

  // `.reveal()` is the single greppable point at which the connection string
  // leaves its Secret wrapper. It goes straight into the connection pool and is
  // never logged - which is why the success message names nothing at all.
  await runMigrations(config.databaseUrl.reveal())

  process.stdout.write('Migrations applied.\n')
}

main().catch((error: unknown) => {
  // Reports the error only, never the connection string: this runs in deploy
  // logs and DATABASE_URL carries a password.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(`Migration failed. ${message}\n`)
  process.exitCode = 1
})
