import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONTAINER, DB_NAME, DB_USER, assertLocalDatabaseReady, fail } from './lib/local-db.mjs'
import { manifestPathFor, readCounts, sha256 } from './lib/manifest.mjs'

/**
 * `pnpm db:backup` - dump the local database to backups/, with a manifest.
 *
 * WHY `docker exec` AND NOT A HOST `pg_dump`. There is no Postgres client to
 * install, and the client version always matches the server exactly. A host
 * client older than the server refuses the dump outright, which is a confusing
 * first failure to meet during an incident.
 *
 * WHY `-Fc` AND NOT PLAIN SQL. The custom format is compressed, `pg_restore`
 * validates its table of contents before applying anything, and it can be
 * restored selectively. A plain-SQL dump fed to `psql` would need
 * ON_ERROR_STOP=1 to fail at all - the classic trap this format avoids.
 *
 * WHY THE DUMP IS CAPTURED AS A BUFFER AND WRITTEN BY NODE, rather than
 * redirected by the shell: this is binary data on Windows, and shell
 * redirection through some terminals applies line-ending translation, which
 * corrupts it silently. Silently is the operative word.
 */

const BACKUP_DIR = 'backups'

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

try {
  const volume = assertLocalDatabaseReady()

  // Counts are read either side of the dump and must agree. pg_dump takes a
  // consistent snapshot, so a difference means something wrote DURING the
  // backup - in which case the manifest would describe a database that never
  // existed, and a later verification would fail for the wrong reason.
  const before = readCounts()

  const dump = execFileSync(
    'docker',
    ['exec', CONTAINER, 'pg_dump', '-U', DB_USER, '-d', DB_NAME, '-Fc'],
    { maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  if (dump.length === 0) {
    throw new Error('pg_dump produced an EMPTY dump and reported success. Refusing to write it.')
  }

  const after = readCounts()
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      'The database CHANGED while the backup ran, so the manifest cannot describe it. ' +
        'Stop whatever is writing to it and run the backup again.',
    )
  }

  mkdirSync(BACKUP_DIR, { recursive: true })
  const path = join(BACKUP_DIR, `karatx-${timestamp()}.dump`)
  writeFileSync(path, dump)

  const manifest = {
    createdAt: new Date().toISOString(),
    database: DB_NAME,
    volume,
    dumpBytes: dump.length,
    dumpSha256: sha256(dump),
    ...after,
  }
  writeFileSync(manifestPathFor(path), `${JSON.stringify(manifest, null, 2)}\n`)

  const summary = Object.entries(after.tables)
    .map(([t, n]) => `${t}=${n}`)
    .join(', ')

  // Reports what it saw, not merely that it finished - a passing gate should
  // say what it observed, or a zero-byte success reads the same as a real one.
  process.stdout.write(
    `Backed up ${DB_NAME} from volume ${volume}\n` +
      `  ${path}\n` +
      `  ${dump.length.toLocaleString()} bytes, sha256 ${manifest.dumpSha256.slice(0, 12)}...\n` +
      `  ${summary}, indexes=${after.indexes}, migrations=${after.migrations}\n`,
  )
} catch (error) {
  fail(error)
}
