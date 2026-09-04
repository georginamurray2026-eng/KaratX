import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * One execution of a background job. Written by T1.4's backfill.
 *
 * WHAT THIS TABLE IS NOT: it is not the resume checkpoint. The backfill resumes
 * from `max(candles.open_time)` for the series, so the write and the checkpoint
 * are THE SAME FACT and cannot drift apart. A separate stored checkpoint would
 * open a window between committing a bar and recording that we had - and no
 * ordering closes it, only making them one fact does.
 *
 * The counters here are OBSERVABILITY, and they are approximate by design. If
 * the process dies between the candle commit and the counter update, the counts
 * are wrong and the DATA IS RIGHT. Resumption never reads them.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    /**
     * SURROGATE, unlike `candles` - and for the opposite reason.
     *
     * A job run has no natural identity: two runs of the same job started in
     * the same instant are genuinely distinct facts, so a natural key would
     * have to invent a discriminator. `candles` refused a surrogate because a
     * bar's identity IS its tuple and a surrogate would let two rows claim to
     * be the same bar. Neither decision generalises to the other table.
     */
    id: uuid('id').primaryKey().defaultRandom(),

    /** e.g. `backfill`. Text plus a CHECK, per the convention in `candles`. */
    jobName: text('job_name').notNull(),

    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

    /** NULL while running. Set once, on any terminal status. */
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),

    /**
     * `running` | `succeeded` | `failed` | `interrupted`.
     *
     * `interrupted` is distinct from `failed` on purpose: it means a previous
     * run's row was adopted by an operator using --resume, so the row was never
     * closed by the process that opened it. Folding the two together would hide
     * how often runs die without reporting.
     */
    status: text('status').notNull().default('running'),

    /** Provider requests issued. The number the T1.4 cost estimate predicted. */
    requestsMade: integer('requests_made').notNull().default(0),

    /**
     * ONE COLUMN PER UPSERT OUTCOME, matching CANDLE_UPSERT_OUTCOMES exactly.
     *
     * Columns rather than a jsonb blob because the vocabulary is FIXED and
     * TYPED in `@karatx/contracts` - a `conflict` count is a thing to query and
     * alert on, not a bag of keys. (The `config.value` jsonb hazard, where
     * numbers return as float64, is not the reason: counts are integers far
     * inside float64's exact range. The reason is typing and queryability.)
     *
     * A new outcome in the contract means a migration here, which is the
     * correct amount of friction for changing what the ingest can report.
     */
    barsInserted: integer('bars_inserted').notNull().default(0),
    barsApplied: integer('bars_applied').notNull().default(0),
    barsNoop: integer('bars_noop').notNull().default(0),
    barsEnriched: integer('bars_enriched').notNull().default(0),
    barsConflict: integer('bars_conflict').notNull().default(0),
    barsRejected: integer('bars_rejected').notNull().default(0),

    /** Where this run's raw payloads went. Git-ignored; may have been cleaned. */
    captureDir: text('capture_dir'),

    /** Why it failed. Never a secret - see packages/config Secret<T>. */
    error: text('error'),

    /** Structured detail: window, timeframe, symbol. Never a secret. */
    context: jsonb('context'),
  },
  (table) => [
    /**
     * AT MOST ONE RUNNING INSTANCE PER JOB, ENFORCED BY THE DATABASE (§9).
     *
     * Deliberately the same shape as `candles_one_forming_idx`, and it carries
     * the same ACCEPTED CONSEQUENCE, stated here rather than discovered later:
     * A CRASHED RUN LEAVES A `running` ROW THAT BLOCKS THE NEXT RUN. That is
     * chosen behaviour. Two concurrent backfills against one series would
     * interleave their frontier reads and each would resume from the other's
     * writes.
     *
     * The escape is an operator flag that ADOPTS the stale row (marking it
     * `interrupted`) rather than a heartbeat with a staleness window. A
     * heartbeat trades a hard guarantee for a timeout guess, and a guess that
     * is too short starts a second writer during a slow run - which is the
     * exact failure the index exists to prevent.
     */
    uniqueIndex('job_runs_one_running_idx')
      .on(table.jobName)
      .where(sql`${table.status} = 'running'`),

    /**
     * "The last run of this job" - the only query anything performs today.
     *
     * HONESTLY: at Phase 1 scale this index is nearly free AND NEARLY
     * POINTLESS. This table gains a handful of rows a day, so a sequential scan
     * would serve every query for years. It is here for the query shape, not
     * for a measured need - the opposite of `candles`, where the index
     * reasoning was load-bearing. Recorded so nobody cites this as precedent
     * for speculative indexing on a large table.
     */
    index('job_runs_job_name_started_at_idx').on(table.jobName, table.startedAt.desc()),

    check(
      'job_runs_status_check',
      sql`${table.status} IN ('running','succeeded','failed','interrupted')`,
    ),

    /**
     * A terminal run has a finish time; a running one does not. Without this,
     * "how long did it take" silently returns NULL for rows that look complete.
     */
    check(
      'job_runs_finished_at_check',
      sql`(${table.status} = 'running' AND ${table.finishedAt} IS NULL) OR (${table.status} <> 'running' AND ${table.finishedAt} IS NOT NULL)`,
    ),

    check(
      'job_runs_counts_check',
      sql`${table.requestsMade} >= 0 AND ${table.barsInserted} >= 0 AND ${table.barsApplied} >= 0 AND ${table.barsNoop} >= 0 AND ${table.barsEnriched} >= 0 AND ${table.barsConflict} >= 0 AND ${table.barsRejected} >= 0`,
    ),
  ],
)

export type JobRun = typeof jobRuns.$inferSelect
export type NewJobRun = typeof jobRuns.$inferInsert
