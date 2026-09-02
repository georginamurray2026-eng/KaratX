import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

import { CONTAINER, DB_NAME, DB_USER, assertLocalDatabaseReady, fail } from './lib/local-db.mjs'
import {
  diffCounts,
  manifestPathFor,
  quarantineSchema,
  readCounts,
  sha256,
} from './lib/manifest.mjs'

/**
 * `pnpm db:restore <file>` - restore the local database from a dump.
 *
 * THREE LAYERS, AND THE ORDER IS THE POINT.
 *
 * 1. INTEGRITY, BEFORE TOUCHING THE DATABASE. If a manifest exists, the dump's
 *    sha256 must match it. A truncated or corrupted file is rejected while the
 *    database is still whole, so the bad path never begins.
 *
 * 2. `--exit-on-error` DURING. By default pg_restore continues past errors and
 *    reports a count at the end, which leaves a half-populated database behind
 *    a command that looked like it worked.
 *
 * 3. CONTENT VERIFICATION AFTER. Layer 2 guarantees the restore STOPS at the
 *    first error; it does not guarantee it UNDOES what already ran. On a large
 *    archive a late failure can leave rows behind, and a non-zero exit that
 *    someone retries or ignores still ends in a database that looks populated
 *    and has silent gaps - the state T1.5 exists to detect, arriving from the
 *    one direction T1.5 cannot see.
 *
 * ON FAILURE THE DATABASE IS MADE OBVIOUSLY BROKEN, not plausibly working: the
 * `public` schema is renamed aside and an empty one left in its place.
 */

const file = process.argv[2]

try {
  if (!file) {
    throw new Error('Usage: pnpm db:restore <path-to-dump>\n\nDumps live in backups/.')
  }

  let size
  try {
    size = statSync(file).size
  } catch {
    throw new Error(`No such dump file: ${file}`)
  }
  if (size === 0) throw new Error(`Dump file is EMPTY: ${file}`)

  const volume = assertLocalDatabaseReady()
  const dump = readFileSync(file)

  // --- Layer 1: integrity, before any change ------------------------------
  const manifestPath = manifestPathFor(file)
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null

  if (manifest) {
    const actual = sha256(dump)
    if (actual !== manifest.dumpSha256) {
      throw new Error(
        `DUMP INTEGRITY CHECK FAILED - refusing to restore.\n\n` +
          `  expected sha256: ${manifest.dumpSha256}\n` +
          `  actual sha256:   ${actual}\n` +
          `  expected bytes:  ${manifest.dumpBytes.toLocaleString()}\n` +
          `  actual bytes:    ${dump.length.toLocaleString()}\n\n` +
          `The file is truncated or corrupted. The database has NOT been touched.`,
      )
    }
  } else if (!process.argv.includes('--unverified')) {
    throw new Error(
      `NO MANIFEST beside this dump - refusing to restore.` +
        `

` +
        `  expected: ${manifestPath}

` +
        `Without it, integrity cannot be checked before the restore and content
` +
        `cannot be checked after, so a truncated file would be caught only by
` +
        `pg_restore - which stops at the first error but does not undo what
` +
        `already ran.

` +
        `Copy the .manifest.json next to the dump, or pass --unverified to
` +
        `restore anyway and check the result by hand.`,
    )
  } else {
    process.stderr.write(
      `WARNING: --unverified. Integrity and content are NOT checked. Verify by hand.

`,
    )
  }

  // --- Layer 2: the restore ------------------------------------------------
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'pg_restore',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '--clean',
      '--if-exists',
      '--exit-on-error',
      // Obligation 31, FLAG HALF ONLY - this is NOT proven and NOT discharged.
      //
      // `--exit-on-error` makes a restore STOP at the first error; it does not
      // make it UNDO what already ran. On a small dump that distinction never
      // shows: pg_restore reads the archive table of contents before applying
      // anything, so a 5 KB dump fails before the first DROP and the database
      // is left intact by accident of size, not by guarantee. On a
      // multi-gigabyte Phase 1 dump, corruption late in the data stream can
      // fail AFTER earlier statements have committed.
      //
      // `--single-transaction` closes that: everything applies or nothing
      // does. It implies `--exit-on-error`, and is compatible with
      // `--clean --if-exists` here because no `--jobs` is used (they conflict).
      //
      // WHAT IS STILL UNPROVEN, and why this is not ticked off: the five
      // deliberate failures on 2026-08-30 all passed under the OLD flags too,
      // because the dump was too small to fail mid-restore. Re-running them now
      // would demonstrate nothing - the old behaviour and the new are
      // indistinguishable at this size. The evidence needs a dump large enough
      // that the failure lands MID-restore, and that volume does not exist
      // until T1.4's backfill. See obligation 31 in docs/OBLIGATIONS.md.
      '--single-transaction',
    ],
    { input: dump, maxBuffer: 1024 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'] },
  )

  // --- Layer 3: content ----------------------------------------------------
  if (manifest) {
    const problems = diffCounts(manifest, readCounts())
    if (problems.length > 0) {
      const quarantined = quarantineSchema()
      throw new Error(
        `RESTORE VERIFICATION FAILED - the database does not match the manifest.\n\n` +
          problems.map((p) => `  - ${p}`).join('\n') +
          `\n\nThe restore reported success and produced the WRONG CONTENT, which is\n` +
          `the failure this check exists for.\n\n` +
          `The damaged schema has been renamed to "${quarantined}" and an empty\n` +
          `"public" left in its place, so nothing can run against partial data by\n` +
          `accident. The evidence is preserved for diagnosis.\n\n` +
          `------------------------------------------------------------------\n` +
          `YOUR DATA IS NOT LOST, AND "public" IS NOW EMPTY BY DESIGN.\n\n` +
          `  RUN THE SAME COMMAND AGAIN:\n\n` +
          `      pnpm db:restore ${file}\n\n` +
          `The second run restores into the empty schema and normally SUCCEEDS.\n\n` +
          `WHY THIS HAPPENS, so you can tell it apart from real corruption:\n` +
          `this check compares table counts against the manifest. Restoring a\n` +
          `backup taken BEFORE a migration into a database that is AFTER it means\n` +
          `the dump legitimately has fewer tables than the live schema, so the\n` +
          `comparison fails on the FIRST run every time - the dump is fine.\n` +
          `THE DOCUMENTED ROLLBACK PATH IN DEPLOYMENT.md TRIPS THIS BY\n` +
          `DEFINITION, because a pre-migration backup always has fewer tables.\n\n` +
          `If the SECOND run fails too, that is a different problem: the dump\n` +
          `itself does not match its manifest. Do not run it a third time -\n` +
          `the quarantined schema "${quarantined}" holds the evidence.\n` +
          `------------------------------------------------------------------`,
      )
    }
  }

  const summary = manifest
    ? Object.entries(manifest.tables)
        .map(([t, n]) => `${t}=${n}`)
        .join(', ')
    : '(unverified)'

  process.stdout.write(
    `Restored ${DB_NAME} into volume ${volume}\n` +
      `  from ${file} (${size.toLocaleString()} bytes)\n` +
      `  VERIFIED: ${summary}\n`,
  )
} catch (error) {
  fail(error)
}
