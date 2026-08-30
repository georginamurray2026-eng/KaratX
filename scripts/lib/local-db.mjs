import { execFileSync } from 'node:child_process'

/**
 * Shared preconditions for the local backup and restore scripts.
 *
 * These live in ONE module deliberately. The volume check is the reason: a
 * backup drill that targets a volume the compose file no longer uses proves
 * nothing, and two copies of that check would drift independently.
 */

export const CONTAINER = 'karatx-postgres'
export const DB_USER = 'karatx'
export const DB_NAME = 'karatx'
const DATA_DIR = '/var/lib/postgresql/data'

class PreconditionError extends Error {}

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

/** Fails unless the local Postgres container is running. */
export function assertContainerRunning() {
  let status
  try {
    status = run('docker', ['inspect', '-f', '{{.State.Status}}', CONTAINER]).trim()
  } catch {
    throw new PreconditionError(
      `Container "${CONTAINER}" does not exist. Start it with:\n\n    pnpm db:up\n`,
    )
  }
  if (status !== 'running') {
    throw new PreconditionError(
      `Container "${CONTAINER}" is ${status}, not running. Start it with:\n\n    pnpm db:up\n`,
    )
  }
}

/**
 * Fails unless the volume the database is ACTUALLY using is the one the compose
 * file declares.
 *
 * This is not paranoia about a value that never changes. `pnpm db:reset` and the
 * restore drill both destroy whatever `docker compose down -v` decides to
 * destroy, which is the DECLARED volume. If the running container were mounting
 * something else - a leftover from a renamed volume, a hand-started container -
 * the drill would destroy an unused volume, leave the real data untouched, and
 * report a clean pass. The restore would then "succeed" against a database that
 * was never emptied.
 *
 * That is the same shape as every check in this repository that passed while
 * verifying nothing, so it is asserted rather than assumed.
 */
export function assertVolumeMatchesCompose() {
  const live = run('docker', [
    'inspect',
    '-f',
    `{{range .Mounts}}{{if eq .Destination "${DATA_DIR}"}}{{.Name}}{{end}}{{end}}`,
    CONTAINER,
  ]).trim()

  if (live === '') {
    throw new PreconditionError(
      `Container "${CONTAINER}" has no named volume mounted at ${DATA_DIR}.\n` +
        `Its data is not on a volume this project manages, so a restore drill\n` +
        `would not be testing what it claims to test.`,
    )
  }

  const config = JSON.parse(run('docker', ['compose', 'config', '--format', 'json']))
  const declared = Object.values(config.volumes ?? {}).map((v) => v?.name)

  if (!declared.includes(live)) {
    throw new PreconditionError(
      `VOLUME MISMATCH - refusing to continue.\n\n` +
        `  container is using:   ${live}\n` +
        `  compose declares:     ${declared.join(', ') || '(none)'}\n\n` +
        `\`docker compose down -v\` would destroy the declared volume, not the one\n` +
        `holding the data. A restore drill run in this state would pass while\n` +
        `proving nothing.`,
    )
  }

  return live
}

/** Runs both checks and returns the verified volume name. */
export function assertLocalDatabaseReady() {
  assertContainerRunning()
  return assertVolumeMatchesCompose()
}

/** Reports a precondition failure without a stack trace, and exits 1. */
export function fail(error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\n${message}\n\n`)
  process.exit(1)
}
