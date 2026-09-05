import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { instruments } from './instruments'
import { providers } from './providers'

/**
 * What T1.5 found wrong with the data, recorded and never repaired (§7).
 *
 * ADR-013 kept the candle upsert's OUTCOME a value rather than an event row,
 * deliberately, so that this table could be designed by the task that knows
 * what it needs. This is that table.
 *
 * EVERY EVENT IS ANCHORED TO A BAR, and that is a finding rather than a
 * simplification. The vocabulary was worked through looking for a case that
 * could not name one - `stale_feed` was the candidate, because a stale feed has
 * no bar. It does: staleness only fires when a bar was EXPECTED, so there is
 * always an expected-and-absent bar to name. See `occurredAt`.
 *
 * So `open_time` is NOT NULL and there is ONE unique index. An earlier draft had
 * a nullable `open_time` with a partial-unique pair for series-scoped events;
 * that was designing for a case not in T1.5's list.
 *
 * THE KNOWN NON-BAR CASE ALREADY EXISTS IN SHIPPED CODE, and is NOT
 * hypothetical: a capture PAGE that fails to parse. T1.4 writes those - see
 * `capture.ts` and the `error` field in `index.jsonl` - and a page that never
 * became bars has no bar to anchor an event to. It is OUT OF SCOPE for T1.5,
 * whose detectors all run against stored candles, and it needs a nullable
 * `open_time` plus a second partial unique WHEN IT LANDS.
 *
 * That is stated as a reachable case rather than as "if one arrives", because
 * the second phrasing invites a later reader to treat this constraint as
 * settled. It is settled for T1.5's vocabulary and for nothing wider.
 */
export const dataQualityEvents = pgTable(
  'data_quality_events',
  {
    /**
     * SURROGATE, and NOT because the event lacks a natural identity.
     *
     * It has one: `(instrument, provider, timeframe, open_time, event_type,
     * payload_hash)`. That tuple is enforced below as a unique index and is the
     * real key. The surrogate exists because the natural key is SIX COLUMNS
     * WIDE INCLUDING A 64-CHARACTER HASH, and every foreign key or index over
     * it would carry that width. `candles` reached the opposite conclusion for
     * the opposite reason - four narrow columns, and a surrogate there would
     * have let two rows claim to be the same bar.
     */
    id: uuid('id').primaryKey().defaultRandom(),

    instrumentId: integer('instrument_id').notNull(),
    providerId: integer('provider_id').notNull(),
    timeframe: text('timeframe').notNull(),

    /**
     * The bar this event is about. NOT NULL - see the table comment.
     *
     * For an ABSENCE this is the bar that should have existed. That is what
     * makes `missing_bar` and `stale_feed` expressible without a nullable
     * column, and it is the same instant `occurredAt` carries.
     */
    openTime: timestamp('open_time', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * WHEN THE FACT BECAME TRUE, in market time. F.3 invariant 3.
     *
     * THE RULE IS NOT "the bar's open_time", THOUGH IT USUALLY EQUALS IT. It is
     * THE EARLIEST INSTANT AT WHICH THE CONDITION HELD, and for an absence that
     * is the open_time of the bar that should have arrived - not the last bar
     * that did, because the feed was healthy at that moment and nothing had yet
     * gone wrong.
     *
     * `stale_feed` is the case that would otherwise break the rule, and it is
     * why the rule is stated this way round. Its `occurred_at` is the first
     * expected-and-absent bar, which is stable across repeated detections and
     * therefore keeps the row idempotent.
     *
     * Queries filter on `confirmed_at`, never on this (F.3 invariant 3).
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * FIRST detection. Set once and NEVER rewritten, exactly as
     * `candles.ingested_at` is - a re-detection advances `last_seen_at`
     * instead, so this keeps meaning "when we first knew".
     */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Most recent detection of the SAME condition. Mirrors `candles.updated_at`. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /**
     * How many times this exact condition has been detected.
     *
     * IT CANNOT ANSWER WHETHER A CONDITION OSCILLATED - obligation 54, and the
     * limit is structural rather than a missing column. This table records only
     * DISAGREEMENTS: when a revised bar reverts, its values match the stored row
     * and NO EVENT IS WRITTEN, so the revert is an absence. "Seen twice between
     * t1 and t3" cannot separate a disagreement held throughout from one that
     * went B, A, B. A timestamp array would not help either; the missing
     * observations are the AGREEMENTS. That question needs a sampling record of
     * every observation, which is T1.9's shape and is recorded there.
     */
    occurrences: integer('occurrences').notNull().default(1),

    /**
     * THE UNIQUENESS KEY, so its stability is a SCHEMA concern and not an
     * implementation detail. Whoever edits the function that produces it is
     * editing this constraint.
     *
     * sha256 over a canonical rendering of `payload`, where every numeric string
     * is canonicalised by STRIPPING TRAILING FRACTIONAL ZEROS (and then a bare
     * trailing point), with object keys sorted.
     *
     * WHY THAT CANONICALISATION EXISTS: prices cross this boundary as TEXT, and
     * the two sides render the same value differently. `NUMERIC(12,5)` pads to
     * scale, so a bar stored from the provider's `4375.5959` comes back as
     * `4375.59590`. Those are the same number and different strings. Hashing the
     * raw text would make every re-detection a NEW event and the table would
     * grow without bound while reporting nothing new.
     *
     * IT IS PURE STRING WORK - NEVER `Number()`. Passing these through float64
     * to normalise them would destroy exactly the precision ADR-008 preserves;
     * `4600.123456789012345` survives stripping and does not survive parsing.
     *
     * CHANGING THE CANONICALISATION CHANGES, RETROACTIVELY, WHAT COUNTS AS A
     * DISTINCT EVENT. Existing rows keep hashes computed under the old rule, so
     * old and new never collide and a condition already recorded is recorded
     * again under its new hash. That is a migration, not a refactor.
     */
    payloadHash: text('payload_hash').notNull(),

    /** The values the hash covers. Never a secret. */
    payload: jsonb('payload').notNull(),

    /**
     * Text plus a CHECK rather than a pgEnum, following `candles.timeframe` and
     * `system_events.source`: the vocabulary will grow through T1.5 and beyond,
     * and widening a CHECK is a plain migration where widening an enum is not.
     */
    eventType: text('event_type').notNull(),

    /**
     * `info` | `warn` | `error`.
     *
     * DECIDED BEFORE THE DETECTORS EXIST, deliberately - see the block in
     * `market-hours.ts`. `unexpected_bar` against our calendar is INFO: those
     * bars are our feed disagreeing with boundaries measured from a DIFFERENT
     * feed, in an era when our feed was itself inconsistent by a fifth. Ranking
     * them beside a structural impossibility is how a false-positive rate
     * teaches someone to ignore the channel, which BUILD-PLAN names as T1.5's
     * central risk.
     */
    severity: text('severity').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'data_quality_events_instrument_id_instruments_id_fk',
      columns: [table.instrumentId],
      foreignColumns: [instruments.id],
    }),
    foreignKey({
      name: 'data_quality_events_provider_id_providers_id_fk',
      columns: [table.providerId],
      foreignColumns: [providers.id],
    }),

    /**
     * ONE CONDITION ABOUT ONE BAR IS ONE ROW, however often it is detected.
     *
     * THE PAYLOAD IS IN THE KEY, and that is the whole design. Keying on the
     * bar alone would make a CHANGED finding invisible - which is exactly the
     * reverting revision obligation 54 measured. Keying on a detector run would
     * make an UNCHANGED finding a new fact every batch. The identity of a
     * revision event is the PAIR OF VALUES, not the bar and not the run: an
     * identical condition re-detected is idempotent from any run, and a
     * different condition about the same bar is a new row.
     *
     * PROVEN BY MUTATION, AND EVERY COLUMN OF THE KEY IS SHOWN TO PARTICIPATE.
     * The first two cases alone would pass against a blanket unique index that
     * silently ignored a column, so each of the remaining four exists to make
     * one column load-bearing:
     *
     *   same bar, same type, same hash          -> 23505 on this index
     *   same bar, same type, DIFFERENT hash     -> both insert (the 54 case)
     *   DIFFERENT open_time, else same          -> both insert (open_time counts)
     *   DIFFERENT event_type, else same         -> both insert (event_type counts)
     *   DIFFERENT provider_id, else same        -> both insert (provider counts)
     *   DIFFERENT timeframe, else same          -> both insert (timeframe counts)
     *
     * THE LAST TWO ARE NOT PADDING. A provider-blind constraint passes every
     * other case here, because every other case uses one provider - and it
     * would collapse Twelve Data's and Massive's findings about the same bar
     * into one row, which is precisely what T1.9's reconciliation compares. A
     * timeframe-blind one collapses the 15min and 1h bars that share an
     * `open_time` at every hour boundary; both series hold a bar at 09:00 and
     * they are different bars.
     */
    uniqueIndex('data_quality_events_condition_idx').on(
      table.instrumentId,
      table.providerId,
      table.timeframe,
      table.openTime,
      table.eventType,
      table.payloadHash,
    ),

    /**
     * "What has been found recently" - the only query anything performs today.
     *
     * DELIBERATELY THE ONLY EXTRA INDEX. A per-bar lookup needs no index of its
     * own: the unique above LEADS with (instrument, provider, timeframe,
     * open_time), so it already answers "what is known about this bar". And
     * there is no severity index because nothing alerts yet - `job_runs`
     * carries the same note about not indexing speculatively.
     */
    index('data_quality_events_confirmed_at_idx').on(table.confirmedAt.desc()),

    /**
     * THE LINE BREAKS BELOW DO NOT SURVIVE INTO THE DATABASE, and the claim
     * that they would was made and then corrected on 2026-09-05.
     *
     * Before applying 0005 the formatting was justified on the grounds that
     * THE CATALOG IS WHERE THE NEXT PERSON CHECKS THE VOCABULARY. Checked
     * after applying: Postgres normalises `IN (...)` to `= ANY (ARRAY[...])`
     * and collapses the whitespace, so `pg_get_constraintdef` returns ONE LONG
     * LINE however this is written. THE VOCABULARY SURVIVED EXACTLY - nine
     * terms, diffed against this file - BUT THE FORMATTING DID NOT, so that
     * reason does not hold and is not the reason to keep it.
     *
     * It is kept because it is readable HERE. That is a weaker claim, and it
     * is the true one.
     */
    check(
      'data_quality_events_event_type_check',
      sql`${table.eventType} IN (
        'missing_bar', 'unexpected_bar', 'stale_feed', 'implausible_gap',
        'revision_narrowed', 'revision_restated',
        'negative_price', 'high_below_low', 'close_outside_range'
      )`,
    ),
    check(
      'data_quality_events_severity_check',
      sql`${table.severity} IN ('info', 'warn', 'error')`,
    ),
    check('data_quality_events_occurrences_check', sql`${table.occurrences} >= 1`),

    // A re-detection advances `last_seen_at`; it can never precede the first.
    check('data_quality_events_seen_order_check', sql`${table.lastSeenAt} >= ${table.confirmedAt}`),
  ],
)

export type DataQualityEvent = typeof dataQualityEvents.$inferSelect
export type NewDataQualityEvent = typeof dataQualityEvents.$inferInsert
