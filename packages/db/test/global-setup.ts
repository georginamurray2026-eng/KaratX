import {
  createEphemeralDatabase,
  databaseNameFromUrl,
  dropTestDatabase,
  KEEP_ENV_VAR,
  loadRepoEnv,
  makeTestDatabaseName,
  sweepStaleDatabases,
} from '@karatx/test-support'
import type { TestProject } from 'vitest/node'

/**
 * Creates one ephemeral database for this run, and drops it afterwards.
 *
 * Runs once per run, outside the worker processes, which is what makes
 * "isolated per run" literal rather than approximate. Two runs - CI and local,
 * or two CI jobs - can now proceed simultaneously without corrupting each
 * other.
 *
 * The database is deliberately left EMPTY. The migration test's whole purpose
 * is to prove migration from nothing, so migrating here would remove the thing
 * it verifies.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadRepoEnv()

  const url = process.env['DATABASE_URL']
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. Run `cp .env.example .env` and start the database with `pnpm db:up`.',
    )
  }

  const name = makeTestDatabaseName(databaseNameFromUrl(url), new Date())

  // Collect databases abandoned by crashed runs. Only names matching the
  // anchored pattern AND older than 24 hours are considered; see db.ts.
  const swept = await sweepStaleDatabases(url, new Date(), [name])
  if (swept.length > 0) {
    process.stdout.write(`[test-db] swept ${String(swept.length)} stale database(s)\n`)
  }

  const { url: databaseUrl } = await createEphemeralDatabase(url, name)
  project.provide('databaseUrl', databaseUrl)
  project.provide('databaseName', name)

  return async function teardown(): Promise<void> {
    if (process.env[KEEP_ENV_VAR] === '1') {
      process.stdout.write(`[test-db] ${KEEP_ENV_VAR}=1, keeping ${name}\n`)
      return
    }
    await dropTestDatabase(url, name)
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string
    databaseName: string
  }
}
