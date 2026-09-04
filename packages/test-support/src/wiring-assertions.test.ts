import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from './env'

/**
 * ============================================================================
 * IF THIS TEST IS FAILING, PLEASE READ THIS BEFORE CHANGING ANYTHING.
 * ============================================================================
 *
 * THESE TESTS CHECK TEXT. THEY DO NOT CHECK BEHAVIOUR.
 *
 * That sentence is the whole point of the file, and it is repeated in every
 * failure message below, because the danger is not that these tests fail - it
 * is that someone reads a green run as proof of something stronger than what
 * was actually checked.
 *
 * Each assertion here covers a fact about the SOURCE that matters and that
 * nothing else verifies. In both cases a real behavioural test either exists
 * and does not cover the wiring (obligation 23) or would cost far more than
 * the risk justifies (obligation 33).
 *
 *   Obligation 23 - `apps/worker/src/index.ts` must CALL installCrashLogging.
 *     `crash-logging.test.ts` and `crash-logging.integration.test.ts` prove
 *     the MODULE works, the latter in a real spawned process that genuinely
 *     crashes. None of them prove the worker entry point ever calls it.
 *     Deleting the call from `main()` leaves all four of those tests passing.
 *     Recorded preference, 2026-08-28: take the cheap text assertion over an
 *     expensive and potentially flaky boot-and-kill test, ON CONDITION that
 *     its failure message says it tests text. It does, below.
 *
 *   Obligation 33 - nothing under `apps/` may import `runMigrations`.
 *     ADR-003 forbids migrations at boot; they are a deliberate, separate
 *     step. Today that holds by convention only: a commit adding a boot-time
 *     migration would leave lint, typecheck, unit tests, integration tests
 *     and the build all green. The policy was protected by a comment and an
 *     ADR, which are documentation, not guards.
 *
 * EACH ASSERTION HAS A POSITIVE CONTROL, and they are not decoration.
 * Obligation 33 is an ABSENCE check, and this repository has recorded eight
 * instances of an absence result that proved nothing because the check could
 * not have found anything anyway. A scanner pointed at the wrong directory,
 * or one whose matcher never matches, reports "no violations" exactly as
 * loudly as a clean repository does. So the same detector is run against
 * synthetic source that DOES violate the rule, and must find it.
 *
 * The file count is asserted too. An empty file list answers "nothing found"
 * to every question ever asked of it.
 * ============================================================================
 */

const TESTS_TEXT_NOT_BEHAVIOUR =
  'NOTE: this assertion checks the TEXT OF THE SOURCE FILE, not runtime behaviour. A green result means the code says the right thing, not that it does the right thing.'

const repoRoot = findRepoRoot()

/** Every `.ts` file under a directory, ignoring build and dependency output. */
function collectTypeScriptFiles(dir: string): string[] {
  const skip = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo'])
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collectTypeScriptFiles(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(full)
  }
  return found
}

/**
 * Does this source import `runMigrations`?
 *
 * Deliberately matches the IMPORT rather than the call. An import is the
 * commitment; a call without one cannot compile. It also means a file that
 * merely mentions the word in a comment - as `migrate.ts` does, and as this
 * very file does throughout - is not a false positive.
 */
function importsRunMigrations(source: string): boolean {
  const importStatements = source.match(/import\s[^;]*?from\s*['"][^'"]+['"]/gs) ?? []
  return importStatements.some((statement) => /\brunMigrations\b/.test(statement))
}

/** Does this source call `installCrashLogging(...)`? */
function callsInstallCrashLogging(source: string): boolean {
  const withoutLineComments = source.replace(/^[^\S\n]*\/\/.*$/gm, '')
  const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')
  return /\binstallCrashLogging\s*\(/.test(withoutComments)
}

describe('obligation 33 - ADR-003 is enforced by a check, not only by convention', () => {
  const appFiles = collectTypeScriptFiles(join(repoRoot, 'apps'))

  it('scans a non-empty set of files under apps/', () => {
    // Without this, every assertion below passes vacuously the moment the
    // walk breaks or the directory moves. An empty list has no opinions.
    expect(
      appFiles.length,
      `The scan found NO TypeScript files under apps/, so the absence result below proves nothing. Fix the walk before trusting any result from this file. ${TESTS_TEXT_NOT_BEHAVIOUR}`,
    ).toBeGreaterThan(0)

    // Anchored to a file that must exist, so a walk that silently returns
    // the wrong directory's contents is caught rather than counted.
    const relatives = appFiles.map((file) => relative(repoRoot, file).split(sep).join('/'))
    expect(relatives).toContain('apps/worker/src/index.ts')
  })

  it('no file under apps/ imports runMigrations', () => {
    const offenders = appFiles
      .filter((file) => importsRunMigrations(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file).split(sep).join('/'))

    expect(
      offenders,
      `ADR-003: migrations are a DELIBERATE STEP, never run at boot. These files under apps/ import runMigrations: ${offenders.join(', ')}. There is no down-migration path - a bad migration applied automatically at boot means RESTORE FROM BACKUP, and it would run on every deploy of every instance. Move the call to \`pnpm db:migrate\`. ${TESTS_TEXT_NOT_BEHAVIOUR} It checks imports; it does not observe whether anything migrates.`,
    ).toEqual([])
  })

  it('POSITIVE CONTROL: the detector finds an import when one exists', () => {
    // Same function, synthetic input. If this fails, the test above is not
    // capable of finding a violation and its empty result means nothing.
    expect(importsRunMigrations(`import { runMigrations } from '@karatx/db'\n`)).toBe(true)
    expect(
      importsRunMigrations(`import { pool, runMigrations, sql } from '../../packages/db/src'\n`),
    ).toBe(true)
    expect(
      importsRunMigrations(`import {\n  runMigrations,\n} from '@karatx/db'\n`),
      'a multi-line import must still be detected - formatters produce these routinely',
    ).toBe(true)
  })

  it('POSITIVE CONTROL: the detector does not fire on a mere mention', () => {
    // The rule is about imports. A comment explaining the rule must not trip
    // it, or the guard becomes noise and someone deletes it.
    expect(importsRunMigrations(`// never import runMigrations here\n`)).toBe(false)
    expect(importsRunMigrations(`const label = 'runMigrations'\n`)).toBe(false)
  })
})

describe('obligation 23 - the worker entry point wires in crash logging', () => {
  const entryPointPath = join(repoRoot, 'apps', 'worker', 'src', 'index.ts')
  const entryPoint = readFileSync(entryPointPath, 'utf8')

  it('apps/worker/src/index.ts calls installCrashLogging', () => {
    expect(
      callsInstallCrashLogging(entryPoint),
      `apps/worker/src/index.ts does not call installCrashLogging. Its own tests will NOT catch this: crash-logging.test.ts and crash-logging.integration.test.ts both prove the MODULE works - the integration one in a real crashing process - and all of them pass with the call deleted from main(). Without the call, an uncaught exception in production exits with a bare stack trace and no structured fatal log, which is the one moment the logs matter most. ${TESTS_TEXT_NOT_BEHAVIOUR} It checks that index.ts SAYS installCrashLogging(...); it does not observe a crash being logged.`,
    ).toBe(true)
  })

  it('POSITIVE CONTROL: the detector fails when the call is removed', () => {
    // The real entry point with the call stripped out. Same detector, so a
    // matcher that can never return false is caught here.
    const withoutTheCall = entryPoint.replace(/installCrashLogging\s*\(/g, 'notTheCall(')
    expect(
      callsInstallCrashLogging(withoutTheCall),
      'the detector reported the call present in a source that no longer contains it, so the assertion above cannot fail and proves nothing',
    ).toBe(false)
  })

  it('POSITIVE CONTROL: a commented-out call does not count as wiring', () => {
    expect(callsInstallCrashLogging(`// installCrashLogging(logger)\n`)).toBe(false)
    expect(callsInstallCrashLogging(`/* installCrashLogging(logger) */\n`)).toBe(false)
    expect(callsInstallCrashLogging(`installCrashLogging(logger)\n`)).toBe(true)
  })
})

/**
 * Does this source reach for a GLOBAL fetch, rather than using an injected one?
 *
 * Comments and string literals are stripped first, so the prose in this very
 * file - which necessarily writes the forbidden forms out - is not a violation
 * of the rule it describes.
 *
 * The negative lookbehind is what distinguishes `fetch(...)` from the legitimate
 * `this.#fetch(...)` and `options.fetch(...)`. Those are the injected
 * dependency being called, which is the whole point of the rule.
 */
function reachesForGlobalFetch(source: string): boolean {
  const withoutLineComments = source.replace(/^[^\S\n]*\/\/.*$/gm, '')
  const withoutComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutStrings = withoutComments
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')

  const bareCall = /(?<![.\w#$])fetch\s*\(/.test(withoutStrings)
  const globalAccess = /\b(?:globalThis|global|window|self)\s*\.\s*fetch\b/.test(withoutStrings)

  return bareCall || globalAccess
}

describe('T1.4 - the market-data adapter takes fetch as a parameter, never a global', () => {
  const marketdataDir = join(repoRoot, 'packages', 'providers', 'src', 'marketdata')
  const marketdataFiles = collectTypeScriptFiles(marketdataDir)

  it('scans a non-empty set of files under packages/providers/src/marketdata', () => {
    expect(
      marketdataFiles.length,
      `The scan found NO TypeScript files under packages/providers/src/marketdata, so the absence result below proves nothing. ${TESTS_TEXT_NOT_BEHAVIOUR}`,
    ).toBeGreaterThan(0)

    // Anchored to files that must exist, so a walk pointed at the wrong
    // directory is caught rather than reported as clean.
    const relatives = marketdataFiles.map((file) => relative(repoRoot, file).split(sep).join('/'))
    expect(relatives).toContain('packages/providers/src/marketdata/twelvedata/client.ts')
    expect(relatives).toContain('packages/providers/src/marketdata/capture.ts')
  })

  it('no file under marketdata/ reaches for a global fetch', () => {
    const offenders = marketdataFiles
      .filter((file) => reachesForGlobalFetch(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file).split(sep).join('/'))

    expect(
      offenders,
      `These files reach for a global fetch: ${offenders.join(', ')}. ADR-008 made "can this provider's responses be recorded and replayed?" a scored selection criterion, and injection is what makes replay possible - every test in this package serves a recorded response with no network and no global mocking. A module that calls the global directly cannot be replayed, so the fixture strategy quietly stops covering it while the tests stay green. Take fetch as a parameter (see FetchLike in client.ts). ${TESTS_TEXT_NOT_BEHAVIOUR} It checks source text; it does not observe a network call.`,
    ).toEqual([])
  })

  it('POSITIVE CONTROL: the detector finds a global fetch when one exists', () => {
    expect(reachesForGlobalFetch(`const r = await fetch(url)\n`)).toBe(true)
    expect(reachesForGlobalFetch(`const r = await globalThis.fetch(url)\n`)).toBe(true)
    expect(reachesForGlobalFetch(`const r = await global.fetch(url)\n`)).toBe(true)
    expect(reachesForGlobalFetch(`await  fetch  (url)\n`)).toBe(true)
  })

  it('POSITIVE CONTROL: the detector does not fire on the injected form', () => {
    // If these were flagged, the rule would forbid the pattern it exists to
    // require, and the guard would be deleted rather than fixed.
    expect(reachesForGlobalFetch(`const r = await this.#fetch(url, init)\n`)).toBe(false)
    expect(reachesForGlobalFetch(`const r = await options.fetch(url, init)\n`)).toBe(false)
    expect(reachesForGlobalFetch(`const { fetch } = stubFetch(body)\n`)).toBe(false)
    expect(
      reachesForGlobalFetch(`export type FetchLike = (url: string) => Promise<Response>\n`),
    ).toBe(false)
  })

  it('POSITIVE CONTROL: prose and strings are not violations', () => {
    // This file, and the doc comments in client.ts, both write the forbidden
    // form out in full while explaining it.
    expect(reachesForGlobalFetch(`// never call fetch(url) directly\n`)).toBe(false)
    expect(reachesForGlobalFetch(`/* a module that calls fetch(url) cannot be replayed */\n`)).toBe(
      false,
    )
    expect(reachesForGlobalFetch(`const message = 'do not use fetch(url)'\n`)).toBe(false)
  })
})
