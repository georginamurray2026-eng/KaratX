import { loadConfig, loadEnvFileIfPresent, type Config } from '@karatx/config'
import { ConfigError, DatabaseError, policyOf } from '@karatx/core'
import { checkDatabase, systemEvents, type MigrationStatus } from '@karatx/db'
import { createLogger, type DestinationStream, type Logger } from '@karatx/providers'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { Lifecycle } from './lifecycle'

/**
 * The worker's boot sequence.
 *
 * ORDER IS THE POINT OF THIS FILE. T0.3 recorded "config fails before any
 * other work" as unproven because nothing had a boot sequence to order. This
 * is that sequence for the worker:
 *
 *   1. load `.env` if present        so local and deployed look the same
 *   2. validate configuration        SEC-2: fail fast, fail by name
 *   3. build the logger              needs the validated level and secrets
 *   4. check the database            refuse to run against the wrong schema
 *   5. open the pool                 and register its release immediately
 *   6. record `process.started`      the first row that proves any of this ran
 *
 * Each step depends on the one before it. The logger cannot exist before
 * configuration, because its level and its secret list come from
 * configuration - which is also why a configuration failure is the one failure
 * this system cannot report as JSON, and must write to stderr instead.
 */

export interface BootOptions {
  /** Shutdown hooks are registered here as resources are acquired. */
  readonly lifecycle: Lifecycle
  /** Where the logger writes. Tests pass a capturing stream. */
  readonly destination?: DestinationStream
}

export interface BootResult {
  readonly config: Config
  readonly logger: Logger
  readonly pool: Pool
}

/** Identifies this process in `system_events.source`. */
export const WORKER_SOURCE = 'worker'

/**
 * Whether the database schema matches what this build expects, and what a
 * human should do about it if not.
 *
 * Pure, so every drift case is testable with no database - the same reason
 * `compareMigrations` is pure. The MESSAGE is the deliverable here, not the
 * boolean: T0.7 established that a check reporting the wrong cause sends
 * someone to debug connectivity for an hour when the answer was one command.
 */
export function describeMigrationState(status: MigrationStatus): {
  readonly ok: boolean
  readonly message: string
} {
  const problems: string[] = []

  if (status.appliedCount === 0) {
    // The most common first-deploy state, and the one most easily misread as
    // "the database is broken". It is not: it is reachable, empty, and one
    // command away from correct.
    problems.push(
      'database schema is missing - no migrations have been applied. Run `pnpm db:migrate`.',
    )
  } else if (status.pending.length > 0) {
    problems.push(
      `database is behind this build: ${String(status.pending.length)} migration(s) not applied ` +
        `(${status.pending.join(', ')}). Run \`pnpm db:migrate\`.`,
    )
  }

  if (status.unknown.length > 0) {
    // Deliberately does NOT suggest db:migrate, which would apply nothing and
    // leave the operator believing they had fixed it. The database is ahead of
    // the code, which is what a rollback to an older image looks like.
    problems.push(
      `database has ${String(status.unknown.length)} migration(s) this build does not ship - ` +
        'it is running ahead of this code. Deploy the matching build, or roll the database back.',
    )
  }

  if (problems.length === 0) {
    return {
      ok: true,
      message: `schema in sync: ${String(status.appliedCount)} migration(s) applied`,
    }
  }

  return { ok: false, message: problems.join(' ') }
}

/**
 * Start the worker's dependencies, in order, and refuse to continue on any
 * failure.
 *
 * @throws {ConfigError} configuration is missing or malformed.
 * @throws {DatabaseError} the database is unreachable, or its schema does not
 *   match this build.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
  loadEnvFileIfPresent()

  // 2. Configuration. Nothing above this line touches the database, opens a
  //    socket, or logs. `loadConfig` throws ConfigValidationError, which
  //    extends ConfigError and therefore already carries policy `stop`.
  const config = loadConfig()

  // 3. The logger. `.reveal()` is the single greppable point at which the
  //    connection string leaves its Secret wrapper here, and it is handed to
  //    the logger only so the logger can SCRUB it (redaction layer 3) - never
  //    so it can print it.
  const databaseUrl = config.databaseUrl.reveal()
  const logger = createLogger({
    level: config.logLevel,
    name: WORKER_SOURCE,
    secrets: [databaseUrl],
    ...(options.destination === undefined ? {} : { destination: options.destination }),
  })

  logger.info({ nodeEnv: config.nodeEnv, logLevel: config.logLevel }, 'configuration validated')

  try {
    const pool = await bootDatabase(options.lifecycle, logger, config, databaseUrl)
    logger.info('worker started')
    return { config, logger, pool }
  } catch (error) {
    // Everything from here on has a logger, so it gets a structured line -
    // with the taxonomy's handling policy attached - before the caller's
    // plain-text stderr message. Without this, a database boot failure would
    // reach an aggregator as prose only, which is the exact gap the crash
    // handlers exist to close.
    logger.fatal({ err: error, policy: policyOf(error) }, 'boot failed')
    throw error
  }
}

/**
 * Steps 4 to 6: verify the database, open the pool, record the startup row.
 *
 * Split out so the caller can wrap exactly the part that has a logger.
 */
async function bootDatabase(
  lifecycle: Lifecycle,
  logger: Logger,
  config: Config,
  databaseUrl: string,
): Promise<Pool> {
  // 4. The database, BEFORE any pool is opened and before any work starts.
  const status = await checkDatabase(databaseUrl)

  if (!status.connected) {
    // Fail fast rather than starting and retrying. A worker that boots without
    // a database has nowhere to put what it observes, so it would consume the
    // market feed and discard it - alive, and producing nothing.
    throw new DatabaseError(
      `database is unreachable: ${status.error?.message ?? 'unknown error'}`,
      {
        // Overrides the class default of `alert`. At boot there is no "keep
        // running" to fall back to; see the T0.8 report on the taxonomy.
        policy: 'stop',
        context: {
          stage: 'boot',
          ...(status.error?.code === undefined ? {} : { code: status.error.code }),
        },
      },
    )
  }

  const migrations = status.migrations
  if (migrations === undefined) {
    throw new DatabaseError('database reported connected but returned no migration state', {
      policy: 'stop',
      context: { stage: 'boot' },
    })
  }

  const schema = describeMigrationState(migrations)
  if (!schema.ok) {
    // ADR-003 / OPS-2: the worker never applies migrations itself. It refuses
    // to run against a schema it does not expect, and names the command that
    // fixes it.
    throw new DatabaseError(schema.message, {
      policy: 'stop',
      context: {
        stage: 'boot',
        applied: migrations.appliedCount,
        expected: migrations.expectedCount,
        pending: migrations.pending,
        unknown: migrations.unknown,
      },
    })
  }

  logger.info(
    { applied: migrations.appliedCount, latest: migrations.latestApplied },
    'database schema verified',
  )

  // 5. The pool, with its release registered IMMEDIATELY - before the insert
  //    below, so a failure there still returns the connections. Registration
  //    order is teardown order reversed, so anything registered after this
  //    closes before the pool it depends on.
  const pool = new Pool({ connectionString: databaseUrl })
  lifecycle.onShutdown('database-pool', async () => {
    await pool.end()
  })

  // 6. The startup row. This is the operational audit trail (OPS-8), kept
  //    separate from the log stream on purpose: logs are retained for days,
  //    and "when did this process last restart" gets asked weeks later.
  const db = drizzle(pool)
  await db.insert(systemEvents).values({
    source: WORKER_SOURCE,
    eventType: 'process.started',
    severity: 'info',
    message: 'worker started',
    context: { nodeEnv: config.nodeEnv, migrations: migrations.appliedCount },
  })

  return pool
}

/**
 * True when a failure happened before a logger could exist.
 *
 * Only configuration failures qualify: everything after step 3 has a logger,
 * and should use it.
 */
export function isPreLoggerFailure(error: unknown): boolean {
  return error instanceof ConfigError
}

/**
 * Render a boot failure for stderr, for the one case that has no logger.
 *
 * `ConfigValidationError` lists every problem at once and never echoes a
 * received value, so this is safe to print even though DATABASE_URL carries a
 * password.
 */
export function formatPreLoggerFailure(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return `\nFATAL: worker failed to start. ${message}\n\n`
}
