import { execFileSync } from 'node:child_process'

import { fail } from './lib/local-db.mjs'

/**
 * `pnpm rollback:check <commit>` - answer the two questions that decide whether
 * reverting is safe, BEFORE anyone reverts anything.
 *
 * WHY A SCRIPT AND NOT A PARAGRAPH IN DEPLOYMENT.md. Both questions are asked
 * by someone in a hurry whose last change broke something, which is the worst
 * possible moment to rely on remembering a document. A procedure that CHECKS
 * beats a procedure that TELLS.
 *
 * QUESTION 1 - IS THE WORKING TREE DIRTY? A recovery is rarely started from a
 * clean tree: the person running it is usually mid-edit. `git revert` refuses
 * outright on a dirty tree, and the reflex response to that refusal is a
 * hurried `git commit -am` or `git checkout .` - which is how T0.9 destroyed
 * two uncommitted edits. This REFUSES and names the safe options rather than
 * leaving someone to improvise one.
 *
 * QUESTION 2 - DOES THE COMMIT CONTAIN A MIGRATION? If it does, reverting the
 * code leaves the new schema live and the old code meeting a shape it does not
 * expect. Worse here than elsewhere: `/api/ready` reports 503 whenever the
 * database is AHEAD of the code (packages/db/src/status.ts), so a reverted
 * deployment is marked unhealthy regardless of how compatible the migration
 * was. The recovery path for those is restore-from-backup, not revert.
 */

const MIGRATIONS = 'packages/db/migrations/'
const target = process.argv[2] ?? 'HEAD'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

try {
  const sha = git('rev-parse', '--short', target)
  const subject = git('log', '-1', '--format=%s', target)

  // --- Question 1 ----------------------------------------------------------
  const dirty = git('status', '--porcelain')
  if (dirty !== '') {
    throw new Error(
      `WORKING TREE IS DIRTY - refusing to advise a revert.\n\n` +
        dirty
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n') +
        `\n\n` +
        `\`git revert\` will refuse anyway, and the reflex answer to that refusal\n` +
        `is a hurried \`git commit -am\` or \`git checkout .\` - which is how two\n` +
        `uncommitted edits were destroyed in T0.9.\n\n` +
        `Choose deliberately:\n` +
        `  git stash push -u -m "before rollback"    keep the work, set it aside\n` +
        `  git commit -m "wip"                       keep the work, on the record\n\n` +
        `Then run this again.`,
    )
  }

  // --- Question 2 ----------------------------------------------------------
  const files = git('show', '--name-only', '--format=', target).split('\n').filter(Boolean)
  const migrations = files.filter((f) => f.startsWith(MIGRATIONS) && f.endsWith('.sql'))

  process.stdout.write(`Commit ${sha}  ${subject}\n  ${files.length} file(s) changed\n\n`)

  if (migrations.length > 0) {
    process.stdout.write(
      `DO NOT REVERT THIS COMMIT. It contains ${migrations.length} migration(s):\n\n` +
        migrations.map((m) => `  ${m}`).join('\n') +
        `\n\n` +
        `Reverting the code leaves the NEW SCHEMA LIVE and the old code meeting a\n` +
        `shape it does not expect. ADR-003 also makes an applied migration\n` +
        `immutable, so the migration cannot be edited or undone.\n\n` +
        `THE RECOVERY PATH IS:\n` +
        `  1. pnpm db:restore <backup taken BEFORE this migration>\n` +
        `  2. check what that loses - docs/DEPLOYMENT.md, "WHAT A RESTORE CANNOT RECOVER"\n` +
        `  3. write a NEW forward migration correcting the mistake\n`,
    )
    process.exit(2)
  }

  process.stdout.write(
    `No migrations in this commit, working tree clean.\n\n` +
      `SAFE TO REVERT:\n` +
      `  git revert --no-edit ${sha}\n\n` +
      `Then RESTART whatever is running - a reverted file does not change a\n` +
      `process that is already serving the old build - and verify the specific\n` +
      `behaviour that broke, not just that the suite is green.\n`,
  )
} catch (error) {
  fail(error)
}
