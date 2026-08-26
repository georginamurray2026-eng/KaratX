import {
  createEphemeralDatabase,
  databaseNameFromUrl,
  dropTestDatabase,
  findRepoRoot,
  KEEP_ENV_VAR,
  loadRepoEnv,
  makeTestDatabaseName,
} from '@karatx/test-support'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { TestProject } from 'vitest/node'

const run = promisify(execFile)

/**
 * TWO ephemeral databases, because the worker's boot has two states worth
 * proving and they cannot be the same database.
 *
 *   migrated   the happy path: schema present, startup row written
 *   empty      created and left alone, to prove the refusal message
 *
 * The empty one is the point of this file. T0.7's misdiagnosis - a reachable
 * but unmigrated database reported as a connection failure - was found only by
 * running against a genuinely empty database. A mocked `checkDatabase` would
 * have returned whatever the test author already believed and agreed with the
 * code. So this creates a real one and never migrates it.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  loadRepoEnv()

  const url = process.env['DATABASE_URL']
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. Run `cp .env.example .env` and start the database with `pnpm db:up`.',
    )
  }

  const base = databaseNameFromUrl(url)
  const now = new Date()
  // Default random suffixes, not memorable ones: the stale-database sweep
  // matches ..._test_<timestamp>_[0-9a-f]{6} exactly, and a name outside that
  // pattern is skipped forever - so a crashed run would orphan it for good.
  const migratedName = makeTestDatabaseName(base, now)
  const emptyName = makeTestDatabaseName(base, now)

  const { url: migratedUrl } = await createEphemeralDatabase(url, migratedName)
  const { url: emptyUrl } = await createEphemeralDatabase(url, emptyName)

  // The real release step (OPS-2 / ADR-003), invoked exactly as an operator
  // would - not a reimplementation of it, so this exercises the command the
  // deploy will run. Passing DATABASE_URL here targets the throwaway database
  // rather than the developer's own because an explicitly-set variable wins
  // over `.env`; @karatx/config has a test pinning that.
  await run(process.execPath, ['--import', 'tsx', path.join('src', 'bin', 'migrate.ts')], {
    cwd: path.join(findRepoRoot(), 'packages', 'db'),
    env: { ...process.env, DATABASE_URL: migratedUrl },
  })

  project.provide('migratedUrl', migratedUrl)
  project.provide('emptyUrl', emptyUrl)

  return async function teardown(): Promise<void> {
    if (process.env[KEEP_ENV_VAR] === '1') {
      process.stdout.write(
        `[test-db] ${KEEP_ENV_VAR}=1, keeping ${migratedName} and ${emptyName}\n`,
      )
      return
    }
    await dropTestDatabase(url, migratedName)
    await dropTestDatabase(url, emptyName)
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    migratedUrl: string
    emptyUrl: string
  }
}
