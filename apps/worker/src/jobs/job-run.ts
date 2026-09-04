import { KaratxError } from '@karatx/core'
import type { Pool } from 'pg'

import type { OutcomeCounts } from './backfill'

/**
 * Opening, adopting and closing a `job_runs` row.
 *
 * `job_runs_one_running_idx` permits at most one `running` row per job, in the
 * database (§9). This file is the operator-facing half of that guarantee: what
 * happens when a previous run died without closing its row.
 */

export class StaleRunError extends KaratxError {
  override readonly name: string = 'StaleRunError'

  constructor(message: string, context: Readonly<Record<string, unknown>>) {
    super('config', 'stop', message, { context })
  }
}

export interface OpenRunOptions {
  readonly pool: Pool
  readonly jobName: string
  /** Set by the operator's --resume flag. Adopts a stale row. */
  readonly adoptStale?: boolean
  readonly captureDir?: string
  readonly context?: Readonly<Record<string, unknown>>
}

export interface OpenRun {
  readonly id: string
  /** True when this run adopted a previous run's abandoned row. */
  readonly adopted: boolean
}

interface StaleRow {
  readonly id: string
  readonly started_at: Date
}

/**
 * Open a run, refusing if one is already marked running.
 *
 * THE REFUSAL MESSAGE SAYS WHAT TO CHECK, NOT WHAT TO TYPE. At 3am, "pass
 * --resume" reads as an instruction to pass --resume, and an operator who does
 * that while the previous worker is still alive starts a SECOND WRITER against
 * the same series - which is the exact failure `job_runs_one_running_idx`
 * exists to prevent, defeated by the message meant to help. So the message
 * leads with the check and mentions the flag only after it.
 *
 * @throws {StaleRunError} when a running row exists and `adoptStale` is false.
 */
export async function openRun(options: OpenRunOptions): Promise<OpenRun> {
  const { pool, jobName } = options

  const { rows } = await pool.query<StaleRow>(
    `SELECT id, started_at FROM job_runs WHERE job_name = $1 AND status = 'running'`,
    [jobName],
  )
  const stale = rows[0]

  if (stale !== undefined) {
    if (options.adoptStale !== true) {
      const ageMinutes = Math.round((Date.now() - stale.started_at.getTime()) / 60_000)

      throw new StaleRunError(
        `A '${jobName}' run is already marked RUNNING (started ${stale.started_at.toISOString()}, ` +
          `${String(ageMinutes)} minutes ago).\n\n` +
          `BEFORE DOING ANYTHING ELSE, CONFIRM NO OTHER WORKER IS RUNNING:\n` +
          `  - is another 'pnpm backfill' or worker process alive on this machine?\n` +
          `  - is a second instance deployed anywhere pointed at this database?\n` +
          `  - could a scheduled job have started one?\n\n` +
          `If a worker IS still running, LET IT FINISH. Two backfills against one series\n` +
          `interleave their frontier reads and each resumes from the other's writes.\n` +
          `That is the corruption this refusal exists to prevent.\n\n` +
          `ONLY IF YOU HAVE CONFIRMED NOTHING ELSE IS RUNNING - the previous run died\n` +
          `without closing its row. Re-run with --resume, which marks that row\n` +
          `'interrupted' and starts a new one. Nothing is lost either way: the backfill\n` +
          `resumes from max(open_time) in the database, not from that row.`,
        { jobName, staleRunId: stale.id, startedAt: stale.started_at.toISOString() },
      )
    }

    // Adopted rather than deleted: how often runs die without reporting is
    // worth being able to count, and `interrupted` is a distinct status so it
    // does not inflate the failure count either.
    await pool.query(
      `UPDATE job_runs
          SET status = 'interrupted', finished_at = now(),
              error = coalesce(error, 'Adopted by a later run started with --resume. This run never closed its own row.')
        WHERE id = $1`,
      [stale.id],
    )
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO job_runs (job_name, capture_dir, context) VALUES ($1, $2, $3) RETURNING id`,
    [jobName, options.captureDir ?? null, options.context === undefined ? null : options.context],
  )

  const id = inserted.rows[0]?.id
  if (id === undefined) throw new Error('INSERT INTO job_runs returned no id')

  return { id, adopted: stale !== undefined }
}

export interface CloseRunOptions {
  readonly pool: Pool
  readonly id: string
  readonly status: 'succeeded' | 'failed'
  readonly counts: OutcomeCounts
  readonly requestsMade: number
  readonly error?: string
}

/** Close a run. `finished_at` is required by a CHECK, so it is set here. */
export async function closeRun(options: CloseRunOptions): Promise<void> {
  await options.pool.query(
    `UPDATE job_runs
        SET status = $2, finished_at = now(), requests_made = $3,
            bars_inserted = $4, bars_applied = $5, bars_noop = $6,
            bars_enriched = $7, bars_conflict = $8, bars_rejected = $9,
            error = $10
      WHERE id = $1`,
    [
      options.id,
      options.status,
      options.requestsMade,
      options.counts.inserted,
      options.counts.applied,
      options.counts.noop,
      options.counts.enriched,
      options.counts.conflict,
      options.counts.rejected,
      options.error ?? null,
    ],
  )
}
