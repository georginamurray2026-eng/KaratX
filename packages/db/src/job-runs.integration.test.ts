import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'

import { runMigrations } from './migrate'

/**
 * `job_runs` constraints, against a real database.
 *
 * EVERY ASSERTION HERE IS PAIRED WITH ITS OPPOSITE, because a constraint test
 * that only shows a rejection cannot distinguish "this constraint works" from
 * "this table rejects everything". The accepting case is the control.
 *
 * ONE CASE IN THIS FILE EXISTS BECAUSE THE FIRST VERSION OF IT WAS A FALSE
 * PASS, and the shape is worth recording. Checking `job_runs_status_check` by
 * inserting `status='wedged'` with no `finished_at` DOES fail - but it fails on
 * `job_runs_finished_at_check`, because a non-running status with a NULL finish
 * time violates that one first. The status constraint was never exercised, and
 * a run with `job_runs_status_check` deleted would have looked identical. The
 * test now sets `finished_at` so the status check is the only thing left that
 * can reject the row. Same shape as the SQL CASE ordering incident in
 * LESSONS.md: the case chosen to demonstrate a rule was the one case that
 * could not demonstrate it.
 */

describe('job_runs - the database enforces the invariants', () => {
  let pool: Pool

  beforeAll(async () => {
    const url = inject('databaseUrl')
    await runMigrations(url)
    pool = new Pool({ connectionString: url })
  })
  afterAll(async () => {
    await pool.end()
  })
  afterEach(async () => {
    await pool.query('DELETE FROM job_runs')
  })

  describe('at most one RUNNING row per job (§9)', () => {
    it('accepts the first running row', async () => {
      await expect(
        pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')"),
      ).resolves.toBeDefined()
    })

    it('REFUSES a second running row for the same job', async () => {
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")

      await expect(
        pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')"),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'job_runs_one_running_idx',
      })
    })

    it('CONTROL: a DIFFERENT job may run at the same time', async () => {
      // Without this, the index could be over no columns at all - forbidding
      // any second running row anywhere - and the test above would not notice.
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")

      await expect(
        pool.query("INSERT INTO job_runs (job_name) VALUES ('aggregate')"),
      ).resolves.toBeDefined()
    })

    it('CONTROL: the same job may run again once the previous run is terminal', async () => {
      // The index must be PARTIAL. Without the WHERE clause it would forbid a
      // job from ever running twice, which looks identical in a listing of
      // index names - see the note in migrate.integration.test.ts.
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")
      await pool.query("UPDATE job_runs SET status='succeeded', finished_at=now()")

      await expect(
        pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')"),
      ).resolves.toBeDefined()
    })

    it('the index carries the predicate, not just the name', async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'job_runs_one_running_idx'`,
      )
      expect(rows[0]?.indexdef).toMatch(/WHERE \(status = 'running'::text\)/)
    })
  })

  describe('a terminal run has a finish time', () => {
    it('REFUSES a terminal status with a NULL finished_at', async () => {
      // Otherwise "how long did it take" silently returns NULL for rows that
      // look complete.
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")

      await expect(pool.query("UPDATE job_runs SET status='succeeded'")).rejects.toMatchObject({
        constraint: 'job_runs_finished_at_check',
      })
    })

    it('REFUSES a running status that HAS a finished_at', async () => {
      await expect(
        pool.query(
          "INSERT INTO job_runs (job_name, status, finished_at) VALUES ('x','running',now())",
        ),
      ).rejects.toMatchObject({ constraint: 'job_runs_finished_at_check' })
    })

    it('CONTROL: accepts a terminal status with a finished_at', async () => {
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")

      await expect(
        pool.query("UPDATE job_runs SET status='succeeded', finished_at=now()"),
      ).resolves.toBeDefined()
    })
  })

  describe('status vocabulary', () => {
    it('REFUSES an unknown status - isolated so THIS constraint is what rejects it', async () => {
      // `finished_at` is set deliberately. Without it the row violates
      // job_runs_finished_at_check first and this constraint is never reached,
      // which is how the first version of this test passed while proving
      // nothing. See the file header.
      await expect(
        pool.query(
          "INSERT INTO job_runs (job_name, status, finished_at) VALUES ('x','wedged',now())",
        ),
      ).rejects.toMatchObject({ constraint: 'job_runs_status_check' })
    })

    it('CONTROL: the same shape with a VALID status is accepted', async () => {
      await expect(
        pool.query(
          "INSERT INTO job_runs (job_name, status, finished_at) VALUES ('x','succeeded',now())",
        ),
      ).resolves.toBeDefined()
    })

    it('accepts every status in the documented vocabulary', async () => {
      // Enumerated, so a constraint that happens to allow only the two used by
      // the happy path is caught.
      for (const status of ['succeeded', 'failed', 'interrupted']) {
        await expect(
          pool.query('INSERT INTO job_runs (job_name, status, finished_at) VALUES ($1,$2,now())', [
            `job-${status}`,
            status,
          ]),
        ).resolves.toBeDefined()
      }
      await expect(
        pool.query("INSERT INTO job_runs (job_name) VALUES ('job-running')"),
      ).resolves.toBeDefined()
    })
  })

  describe('counters', () => {
    it('REFUSES a negative count', async () => {
      await expect(
        pool.query("INSERT INTO job_runs (job_name, bars_noop) VALUES ('x', -1)"),
      ).rejects.toMatchObject({ constraint: 'job_runs_counts_check' })
    })

    it('CONTROL: accepts zero and positive counts', async () => {
      await expect(
        pool.query("INSERT INTO job_runs (job_name, bars_noop, bars_conflict) VALUES ('x', 0, 5)"),
      ).resolves.toBeDefined()
    })

    it('has one column per upsert outcome, and they all default to zero', async () => {
      // The columns must stay in step with CANDLE_UPSERT_OUTCOMES. A missing
      // one means a run silently cannot report an outcome it produced.
      await pool.query("INSERT INTO job_runs (job_name) VALUES ('backfill')")
      const { rows } = await pool.query<Record<string, number>>(
        `SELECT bars_inserted, bars_applied, bars_noop, bars_enriched, bars_conflict, bars_rejected
         FROM job_runs`,
      )

      expect(rows[0]).toEqual({
        bars_inserted: 0,
        bars_applied: 0,
        bars_noop: 0,
        bars_enriched: 0,
        bars_conflict: 0,
        bars_rejected: 0,
      })
    })
  })
})
