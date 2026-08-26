import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findRepoRoot, loadEnvFileIfPresent } from './env-file'

/**
 * Repository-root discovery and `.env` precedence.
 *
 * THE PRECEDENCE TESTS PIN NODE'S BEHAVIOUR, NOT OURS. `loadEnvFile` gives an
 * already-set environment variable precedence over the file by itself. This
 * code adds nothing to that - an earlier version re-applied the rule by hand,
 * on the assumption that Node overwrote, and a mutation test showed deleting
 * that loop broke nothing because Node was already doing it.
 *
 * The tests stay, for a different reason than they were written: the release
 * step depends on this precedence (`DATABASE_URL=... pnpm db:migrate` must
 * target the database named on the command line, not the one `.env` names),
 * and the integration harness depends on it too. Pinning a third-party
 * behaviour we rely on means a change in Node arrives as a test failure rather
 * than as a silently migrated wrong database.
 */

let sandbox: string
const OWNED_VARS = ['KARATX_TEST_FROM_FILE', 'KARATX_TEST_EXPLICIT']

function makeRepo(envContents?: string): string {
  const root = path.join(sandbox, 'repo')
  mkdirSync(path.join(root, 'packages', 'deep', 'src'), { recursive: true })
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  if (envContents !== undefined) writeFileSync(path.join(root, '.env'), envContents)
  return root
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'karatx-envfile-'))
  for (const name of OWNED_VARS) delete process.env[name]
})

afterEach(() => {
  for (const name of OWNED_VARS) delete process.env[name]
  rmSync(sandbox, { recursive: true, force: true })
})

describe('findRepoRoot', () => {
  it('walks upwards to the workspace marker', () => {
    const root = makeRepo()

    expect(findRepoRoot(path.join(root, 'packages', 'deep', 'src'))).toBe(root)
  })

  it('throws rather than returning something arbitrary when there is no marker', () => {
    // Walking off the top of the filesystem must fail loudly. Counting `..`
    // segments instead would return a wrong directory silently.
    expect(() => findRepoRoot(path.parse(sandbox).root)).toThrow(
      /Could not find the repository root/,
    )
  })
})

describe('loadEnvFileIfPresent', () => {
  it('loads values from the file', () => {
    const root = makeRepo('KARATX_TEST_FROM_FILE=from-file\n')

    const loaded = loadEnvFileIfPresent(root)

    expect(loaded).toBe(path.join(root, '.env'))
    expect(process.env['KARATX_TEST_FROM_FILE']).toBe('from-file')
  })

  it('does NOT overwrite a variable that was already set explicitly', () => {
    // Node's own documented behaviour for --env-file, measured on v24.19.0.
    // Asserted here because the db:migrate release step relies on it.
    const root = makeRepo('KARATX_TEST_EXPLICIT=from-file\n')
    process.env['KARATX_TEST_EXPLICIT'] = 'from-command-line'

    loadEnvFileIfPresent(root)

    expect(process.env['KARATX_TEST_EXPLICIT']).toBe('from-command-line')
  })

  it('still applies file values for variables that were not set explicitly', () => {
    // Precedence must be per-variable, not all-or-nothing: overriding one
    // variable on the command line must not discard the rest of the file.
    const root = makeRepo('KARATX_TEST_EXPLICIT=from-file\nKARATX_TEST_FROM_FILE=from-file\n')
    process.env['KARATX_TEST_EXPLICIT'] = 'from-command-line'

    loadEnvFileIfPresent(root)

    expect(process.env['KARATX_TEST_EXPLICIT']).toBe('from-command-line')
    expect(process.env['KARATX_TEST_FROM_FILE']).toBe('from-file')
  })

  it('does nothing, and reports nothing, when there is no .env at all', () => {
    // A deployed environment has no file and injects variables directly.
    // Requiring the file would work locally and fail on deploy.
    const root = makeRepo()

    expect(loadEnvFileIfPresent(root)).toBeUndefined()
  })
})
