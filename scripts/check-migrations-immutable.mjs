#!/usr/bin/env node
/**
 * Fail when a migration that already exists on `main` has been modified.
 *
 * Discharges STATUS.md obligation 2. ADR-003 makes applied migrations
 * immutable, and T0.4 established EXPERIMENTALLY that Drizzle does not enforce
 * it: an altered applied migration was re-run, reported success, applied
 * nothing, and left the recorded hash unchanged. So the rule has to be enforced
 * somewhere, and CI comparing against `main` is the only mechanism that can.
 *
 * THE RULE IS DELIBERATELY NOT "nothing under migrations/ may change":
 *
 *   *.sql, meta/*_snapshot.json   IMMUTABLE. Byte-identical, or fail.
 *                                 New files are fine.
 *   meta/_journal.json            APPEND-ONLY. Existing entries must be
 *                                 unchanged; the array may grow.
 *
 * A blunt "no file may change" rule would reject every legitimate new
 * migration, because the journal always changes when one is added. A rule that
 * blocks correct work gets disabled within a week, and then protects nothing.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const MIGRATIONS_DIR = 'packages/db/migrations'
const JOURNAL = `${MIGRATIONS_DIR}/meta/_journal.json`

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** Files under the migrations directory at a given ref. */
function filesAt(ref) {
  const out = git('ls-tree', '-r', '--name-only', ref, '--', MIGRATIONS_DIR)
  return out === '' ? [] : out.split('\n')
}

/** Blob contents at a ref, or undefined when the path does not exist there. */
function contentAt(ref, path) {
  try {
    // stderr is piped, not inherited: a missing path is an EXPECTED outcome
    // here (the file was deleted), and letting git print "fatal: path does not
    // exist" would make a correctly-detected deletion look like a crash.
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return undefined
  }
}

function resolveBase() {
  const explicit = process.argv[2]
  if (explicit) return explicit

  // On a pull request, compare against the merge base with main: that is the
  // state the branch started from, so a rebase does not produce false
  // positives.
  try {
    return git('merge-base', 'origin/main', 'HEAD')
  } catch {
    return undefined
  }
}

const base = resolveBase()

if (base === undefined) {
  // The very first push, before `origin/main` exists. There is nothing to have
  // modified. Reported explicitly rather than passing silently - a check that
  // says nothing is indistinguishable from one that did not run.
  console.log('SKIPPED: no origin/main to compare against (first push).')
  console.log('This check is inert until main exists, and will run on every push after that.')
  process.exit(0)
}

console.log(`Comparing migrations against ${base.slice(0, 12)}\n`)

const problems = []
const baseFiles = filesAt(base)

if (baseFiles.length === 0) {
  console.log('No migrations exist at the base ref. Nothing to protect yet.')
}

for (const path of baseFiles) {
  if (path === JOURNAL) continue

  const before = contentAt(base, path)
  const after = contentAt('HEAD', path)

  if (after === undefined) {
    problems.push(`DELETED: ${path}`)
    continue
  }
  if (before !== after) {
    problems.push(`MODIFIED: ${path}`)
  }
}

// The journal may grow, but its existing entries must be untouched. Reordering
// or rewriting an entry changes which migration a recorded timestamp refers to.
const journalBefore = contentAt(base, JOURNAL)
const journalAfter = contentAt('HEAD', JOURNAL)

if (journalBefore !== undefined) {
  if (journalAfter === undefined) {
    problems.push(`DELETED: ${JOURNAL}`)
  } else {
    const entriesBefore = JSON.parse(journalBefore).entries ?? []
    const entriesAfter = JSON.parse(journalAfter).entries ?? []

    if (entriesAfter.length < entriesBefore.length) {
      problems.push(
        `${JOURNAL}: entries were REMOVED (${entriesBefore.length} -> ${entriesAfter.length})`,
      )
    } else {
      for (const [index, entry] of entriesBefore.entries()) {
        if (JSON.stringify(entry) !== JSON.stringify(entriesAfter[index])) {
          problems.push(`${JOURNAL}: entry ${index} (tag ${entry.tag}) was MODIFIED`)
        }
      }
    }
    const added = entriesAfter.length - entriesBefore.length
    if (added > 0) console.log(`${JOURNAL}: ${added} new entry/entries appended - allowed.\n`)
  }
}

const checked = baseFiles.length
console.log(`Checked ${checked} migration file(s) present at the base ref.`)

if (problems.length > 0) {
  console.error('\nFAILED: migrations already on main were changed.\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nApplied migrations are immutable (ADR-003). Drizzle does NOT detect tampering -' +
      '\nit reports success, applies nothing, and leaves the recorded hash unchanged.' +
      '\nAdd a NEW migration instead of editing an existing one.',
  )
  process.exit(1)
}

console.log('PASSED: no migration already on main was modified.')
