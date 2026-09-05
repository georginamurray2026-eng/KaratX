import { createHash } from 'node:crypto'

import { canonicalisePayload, type Holiday, type SessionRule } from '@karatx/core'
import type { Pool } from 'pg'

/**
 * Reads and writes for T1.5's detectors. NO DETECTION LOGIC LIVES HERE.
 *
 * The decisions are in `packages/core`, which cannot query. This layer moves
 * rows and computes the SHA-256 - which needs a Node builtin, so it cannot be
 * in core. **The canonicalisation IS in core**, because that is the part with
 * a domain rule in it; this is the primitive wrapped around it.
 */

/**
 * The uniqueness key. See the comment on `data_quality_events.payload_hash` -
 * editing the canonicalisation edits that constraint retroactively.
 */
export const payloadHash = (payload: unknown): string =>
  createHash('sha256').update(canonicalisePayload(payload), 'utf8').digest('hex')

/** The calendar, as the domain sees it. */
export const loadCalendar = async (
  pool: Pool,
  instrumentId: number,
): Promise<{ rules: SessionRule[]; holidays: Holiday[] }> => {
  const rules = await pool.query<{
    id: number
    rule_type: SessionRule['ruleType']
    day_of_week: number
    local_start: string
    local_end: string | null
    timezone: string
    effective_from: string
    effective_to: string | null
  }>(
    `SELECT id, rule_type, day_of_week, local_start, local_end, timezone,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to,   'YYYY-MM-DD') AS effective_to
       FROM market_hours WHERE instrument_id = $1 ORDER BY id`,
    [instrumentId],
  )
  const holidays = await pool.query<{
    holiday_date: string
    closure_type: Holiday['closureType']
    local_close: string | null
  }>(
    `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date, closure_type, local_close
       FROM market_holidays WHERE instrument_id = $1 ORDER BY holiday_date`,
    [instrumentId],
  )
  return {
    rules: rules.rows.map((row) => ({
      id: row.id,
      ruleType: row.rule_type,
      dayOfWeek: row.day_of_week,
      localStart: row.local_start,
      localEnd: row.local_end,
      timezone: row.timezone,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    })),
    holidays: holidays.rows.map((row) => ({
      holidayDate: row.holiday_date,
      closureType: row.closure_type,
      localClose: row.local_close,
    })),
  }
}

/**
 * Stored bar instants in `[fromMs, toMs)`, ascending.
 *
 * EXPECTED COST, stated before the query was written and measured after:
 * an Index Only Scan on `candles_pk`, **under 10 ms WARM at 166,344 rows** for
 * a one-month chunk of roughly 2,900 rows. Cache state is part of the
 * prediction because it is worth up to 10x - see LESSONS.md.
 *
 * Only `open_time` is selected, deliberately. Adding any price column forces
 * heap access and the planner switches to a bitmap scan plus a Sort.
 */
export const storedOpenTimes = async (
  pool: Pool,
  instrumentId: number,
  providerId: number,
  timeframe: string,
  fromMs: number,
  toMs: number,
): Promise<number[]> => {
  const result = await pool.query<{ ms: string }>(
    `SELECT (extract(epoch FROM open_time) * 1000)::bigint::text AS ms
       FROM candles
      WHERE instrument_id = $1 AND provider_id = $2 AND timeframe = $3
        AND open_time >= to_timestamp($4::double precision / 1000)
        AND open_time <  to_timestamp($5::double precision / 1000)
      ORDER BY open_time`,
    [instrumentId, providerId, timeframe, fromMs, toMs],
  )
  return result.rows.map((row) => Number(row.ms))
}

export interface EventToWrite {
  readonly openTimeMs: number
  readonly eventType: string
  readonly severity: string
  readonly occurredAtMs: number
  readonly payload: Record<string, unknown>
}

/** How many rows go in one statement. See the write-cost note in OQ-15. */
export const WRITE_BATCH = 500

/**
 * Upsert events. **A re-detection INCREMENTS; it never rewrites.**
 *
 * `confirmed_at` is absent from the SET list on purpose - it means "when we
 * first knew" and a run that touched it would destroy that meaning while the
 * row count stayed identical. That is precisely the failure the idempotency
 * proof checks for, and it is invisible to a count.
 *
 * **BOTH TIMESTAMPS COME FROM ONE CLOCK, and the CHECK caught the version that
 * did not.** `confirmed_at` defaults to `now()` - the DATABASE clock, evaluated
 * per statement - while `last_seen_at` carried the worker's run-start time. The
 * baseline run spends ten seconds scanning before its first write, so every
 * insert had `last_seen_at` ten seconds BEHIND `confirmed_at` and
 * `data_quality_events_seen_order_check` rejected the batch. Not clock skew -
 * measured at 92 ms between the two hosts - but two different clocks read at
 * two different moments.
 *
 * So `confirmed_at` is now written EXPLICITLY from the same value as
 * `last_seen_at`. On insert they are equal; on conflict `confirmed_at` is
 * untouched because it is absent from the SET list, and only `last_seen_at`
 * moves. That is the semantics the column comments describe, and it was not
 * what the code did until the constraint said so (§9).
 *
 * Returns rows INSERTED versus rows INCREMENTED, distinguished by `xmax = 0`,
 * which Postgres sets to zero for a tuple this statement created. Without it
 * `rowCount` reports both cases identically and a second run would be
 * indistinguishable from a first.
 */
export const writeEvents = async (
  pool: Pool,
  instrumentId: number,
  providerId: number,
  timeframe: string,
  events: readonly EventToWrite[],
  nowMs: number,
): Promise<{ inserted: number; incremented: number }> => {
  let inserted = 0
  let incremented = 0
  const seen = new Date(nowMs)

  for (let start = 0; start < events.length; start += WRITE_BATCH) {
    const batch = events.slice(start, start + WRITE_BATCH)
    const values: unknown[] = []
    const tuples: string[] = []

    for (const event of batch) {
      const n = values.length
      values.push(
        instrumentId,
        providerId,
        timeframe,
        new Date(event.openTimeMs),
        new Date(event.occurredAtMs),
        event.eventType,
        event.severity,
        JSON.stringify(event.payload),
        payloadHash(event.payload),
        seen,
      )
      tuples.push(
        `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, ` +
          `$${n + 6}, $${n + 7}, $${n + 8}::jsonb, $${n + 9}, $${n + 10}, $${n + 10})`,
      )
    }

    const result = await pool.query<{ ins: boolean }>(
      `INSERT INTO data_quality_events
         (instrument_id, provider_id, timeframe, open_time, occurred_at,
          event_type, severity, payload, payload_hash, last_seen_at, confirmed_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (instrument_id, provider_id, timeframe, open_time, event_type, payload_hash)
       DO UPDATE SET last_seen_at = excluded.last_seen_at,
                     occurrences  = data_quality_events.occurrences + 1
       RETURNING (xmax = 0) AS ins`,
      values,
    )
    for (const row of result.rows) {
      if (row.ins) inserted += 1
      else incremented += 1
    }
  }

  return { inserted, incremented }
}
