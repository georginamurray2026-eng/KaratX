import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertLocalDatabaseReady, fail } from './lib/local-db.mjs'
import { readCounts, sql } from './lib/manifest.mjs'

/**
 * `pnpm db:drill` - the backup and restore drill (T0.10 L3), as a SCRIPT.
 *
 * WHY A SCRIPT AND NOT A CHECKLIST. This drill found a real defect the first
 * time it ran, and the case that found it was a deliberate failure, not the
 * happy path. A drill nobody can re-run is a drill that silently stops matching
 * the procedure it documents - so it is re-runnable, and it is expected to be
 * re-run whenever the backup or restore scripts change. Same reasoning as the
 * deliberate-red exercise in T0.9.
 *
 * THE POSITIVE CONTROL IS THE TEST. Step 6 asserts the sentinel is ABSENT after
 * the volume is destroyed. Without it, a row that survived and a row that was
 * restored are indistinguishable, and the drill would join the checks in
 * STATUS.md that passed while verifying nothing.
 *
 * IT DESTROYS THE LOCAL DATABASE. The interlock below refuses to run against
 * one that looks like it holds real data.
 */

const SENTINEL = 'backup_drill_sentinel'
const SAFETY_MAX_ROWS = 1000
const force = process.argv.includes('--force')

let step = 0
const say = (text) => process.stdout.write(`${text}\n`)
const heading = (text) => say(`\n[${++step}] ${text}`)
const ok = (text) => say(`    PASS  ${text}`)

function sh(command) {
  return execFileSync(command, { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
function node(script, ...args) {
  return execFileSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
/** Runs a command that MUST fail, and returns its combined output. */
function mustFail(fn, what) {
  try {
    fn()
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  throw new Error(`${what} SUCCEEDED. It was required to fail.`)
}

try {
  assertLocalDatabaseReady()

  heading('Interlock - refuse to destroy a database holding real data')
  const initial = readCounts()
  const big = Object.entries(initial.tables).filter(([, n]) => n > SAFETY_MAX_ROWS)
  if (big.length > 0 && !force) {
    throw new Error(
      `This drill DESTROYS the local database, and it is not empty:\n\n` +
        big.map(([t, n]) => `  ${t}: ${n.toLocaleString()} rows`).join('\n') +
        `\n\nBack it up and pass --force if you really mean to.`,
    )
  }
  ok(
    `safe to proceed (${Object.entries(initial.tables)
      .map(([t, n]) => `${t}=${n}`)
      .join(', ')})`,
  )

  // A previous FAILED run leaves its sentinel behind, which makes the next
  // run's verification ambiguous. A drill must be re-runnable AFTER it fails.
  const stale = Number(sql(`select count(*) from system_events where event_type='${SENTINEL}'`))
  if (stale > 0) {
    sql(`delete from system_events where event_type='${SENTINEL}'`)
    say(`    swept ${stale} sentinel row(s) left by an earlier run`)
  }

  heading('Insert the sentinel')
  const id = sql(
    `insert into system_events (source, event_type, severity, message)
     values ('t0.10-l3', '${SENTINEL}', 'info', 'restore drill sentinel') returning id`,
  )
    .split(String.fromCharCode(10))[0]
    .trim()
  ok(`sentinel ${id}`)

  heading('Back up')
  const backup = node('scripts/db-backup.mjs')
  const dumpPath = backup.match(/backups.+[.]dump/)?.[0]
  if (!dumpPath) throw new Error(`Could not find the dump path in:\n${backup}`)
  ok(dumpPath)

  heading('NEGATIVE - truncated dumps must be rejected, and change nothing')
  const scratch = mkdtempSync(join(tmpdir(), 'karatx-drill-'))
  const full = readFileSync(dumpPath)
  const third = full.subarray(0, Math.floor(full.length / 3))
  const before = readCounts()

  // (a) truncated WITH its manifest - layer 1 must reject it before any change.
  const withManifest = join(scratch, 'a.dump')
  writeFileSync(withManifest, third)
  writeFileSync(`${withManifest}.manifest.json`, readFileSync(`${dumpPath}.manifest.json`))
  let out = mustFail(() => node('scripts/db-restore.mjs', withManifest), 'Truncated+manifest')
  if (!/INTEGRITY CHECK FAILED/.test(out)) {
    throw new Error(`Expected an integrity failure, got:
${out}`)
  }
  ok('with manifest: rejected on sha256, before touching the database')

  // (b) truncated WITHOUT a manifest - refused outright rather than attempted.
  const noManifest = join(scratch, 'b.dump')
  writeFileSync(noManifest, third)
  out = mustFail(() => node('scripts/db-restore.mjs', noManifest), 'Truncated, no manifest')
  if (!/NO MANIFEST/.test(out)) {
    throw new Error(`Expected a missing-manifest refusal, got:
${out}`)
  }
  ok('without manifest: refused outright')

  // (c) forced past the refusal - pg_restore itself must still fail.
  out = mustFail(
    () => node('scripts/db-restore.mjs', noManifest, '--unverified'),
    'Truncated, --unverified',
  )
  if (!/could not read from input file/.test(out)) {
    throw new Error(`Expected pg_restore to fail, got:
${out}`)
  }
  ok('with --unverified: pg_restore rejects it')

  if (JSON.stringify(before) !== JSON.stringify(readCounts())) {
    throw new Error('The database CHANGED during the truncation checks.')
  }
  ok('database unchanged by all three')

  heading('NEGATIVE - empty and missing files')
  mustFail(() => node('scripts/db-restore.mjs', join(scratch, 'nope.dump')), 'Missing-file restore')
  writeFileSync(join(scratch, 'empty.dump'), '')
  mustFail(() => node('scripts/db-restore.mjs', join(scratch, 'empty.dump')), 'Empty-file restore')
  ok('both rejected')

  heading('DESTROY the volume')
  sh('docker compose down -v')
  sh('docker compose up -d --wait postgres')
  sh('pnpm --filter @karatx/db db:migrate')
  ok('volume destroyed, recreated, migrated')

  heading('POSITIVE CONTROL - the sentinel must be ABSENT')
  const absent = Number(sql(`select count(*) from system_events where event_type='${SENTINEL}'`))
  if (absent !== 0) {
    throw new Error(
      `CONTROL FAILED: ${absent} sentinel row(s) survived the destroy.\n` +
        `The volume was not really destroyed, so this drill proves NOTHING.`,
    )
  }
  ok('sentinel absent - the volume really was destroyed')

  heading('Restore')
  say(`    ${node('scripts/db-restore.mjs', dumpPath).trim().split('\n').join('\n    ')}`)

  heading('Verify the sentinel came back, with its original identity')
  const rows = sql(`select id from system_events where event_type='${SENTINEL}' order by 1`)
    .split(String.fromCharCode(10))
    .map((r) => r.trim())
    .filter(Boolean)
  if (rows.length !== 1) {
    throw new Error(
      `Expected EXACTLY ONE sentinel row after the restore, found ${rows.length}. A
      previous failed run may have left one behind.`,
    )
  }
  if (rows[0] !== id) {
    throw new Error(`Sentinel id changed: expected ${id}, found ${rows[0]}`)
  }
  ok(`sentinel ${rows[0]} restored, identity intact`)

  heading('Clean up')
  sql(`delete from system_events where event_type='${SENTINEL}'`)
  ok('sentinel removed')

  say('\nDRILL PASSED - restore proven, and all three failure cases rejected.\n')
} catch (error) {
  fail(error)
}
