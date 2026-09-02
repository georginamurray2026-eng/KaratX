import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { instruments } from './instruments'
import { providers } from './providers'

/**
 * One bar, AS DELIVERED BY ONE PROVIDER. The largest table in the system.
 *
 * Every decision here is settled in ADR-013. The reasoning is repeated at the
 * point it applies, because a later session reads this file and not the ADR.
 *
 * HARD TO REVERSE, ALL OF IT. This table will hold roughly 161,000 rows per
 * provider per year. Changing the primary key later means rewriting it.
 */
export const candles = pgTable(
  'candles',
  {
    /**
     * PRIMARY KEY PART 1 of 4. Integer, not uuid - see `instruments`: a 4-byte
     * key rather than 16 is a direct saving in this table and in every index
     * over it.
     */
    instrumentId: integer('instrument_id').notNull(),

    /**
     * PRIMARY KEY PART 2 of 4.
     *
     * CANDLES ARE PER-PROVIDER, NOT CANONICAL. T1.9 reconciles Twelve Data
     * against Massive, so both providers' bars for one instrument and timeframe
     * must coexist as distinct rows. "The price at time T" is always a question
     * with a provider argument.
     *
     * This also means a PROVIDER CHANGE CREATES NEW ROWS RATHER THAN CONFLICTS,
     * which is why the `enriched` case in ADR-013 can only arise from a tier
     * change within one provider.
     */
    providerId: integer('provider_id').notNull(),

    /**
     * PRIMARY KEY PART 3 of 4. Text plus a CHECK rather than a pgEnum: an enum
     * needs a migration to add a value, and the constraint is cheap to move.
     * Same reasoning as `market_hours.rule_type`.
     */
    timeframe: text('timeframe').notNull(),

    /**
     * PRIMARY KEY PART 4 of 4, and the only RANGED column - which is why it is
     * LAST. A B-tree range-scans only on its trailing column, so this ordering
     * turns "last N final bars for instrument+provider+timeframe, newest first"
     * into a backwards index scan with no sort step.
     *
     * THIS IS THE BAR OPEN, NOT ITS CLOSE. Getting it wrong is a silent
     * 15-minute shift through every indicator, zone and setup, and it looks
     * completely normal.
     */
    openTime: timestamp('open_time', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * NUMERIC(12,5) IS THE PRICE SHAPE FOR THIS ENTIRE SYSTEM, matching
     * `instruments.tick_size` and the `Price` contract. A differing precision
     * anywhere silently changes a value as it moves between tables.
     *
     * NUMERIC PADS TO SCALE: '8.1' stores and returns as '8.10000'. The VALUE
     * is exact; only the rendering differs. Two consequences, both deliberate:
     *
     * 1. '4635.06' and '4635.060' are the same stored value AND the same
     *    returned text, so a formatting-only difference cannot raise a
     *    conflict. That requirement is met by the storage layer, not by
     *    comparison logic.
     * 2. ADR-008's "preserve the decimal text as received" is NOT fully
     *    honoured here, and ADR-013 accepts that with reasons. DO NOT "FIX"
     *    IT by adding raw price columns - four extra text columns on 161,000
     *    rows a year, to preserve a rendering that carries no information, was
     *    considered and rejected.
     */
    open: numeric('open', { precision: 12, scale: 5 }).notNull(),
    high: numeric('high', { precision: 12, scale: 5 }).notNull(),
    low: numeric('low', { precision: 12, scale: 5 }).notNull(),
    close: numeric('close', { precision: 12, scale: 5 }).notNull(),

    /**
     * NULLABLE, and 0 AND NULL ARE DIFFERENT FACTS - null means the provider
     * sent none, 0 means it sent zero. Spot metals on Twelve Data have no
     * volume, so NULL IS THE ORDINARY CASE for XAU/USD.
     *
     * That is why every conflict comparison uses `IS DISTINCT FROM` and never
     * `=`: under SQL both `null = null` and `null <> 123` are UNKNOWN, so an
     * `=` rule would be silent in BOTH directions - a real volume arriving
     * where there was none would be invisible. See ADR-013.
     *
     * NUMERIC(20,0) rather than bigint so it returns as a string through the
     * same node-postgres path `numeric-precision.integration.test.ts` pins.
     */
    volume: numeric('volume', { precision: 20, scale: 0 }),

    /**
     * NULL for Twelve Data today - ADR-008's provider supplies MID ONLY.
     * Present now because adding them later means migrating the largest table
     * in the system.
     *
     * These are the only columns the `enriched` case can fill: null -> value is
     * enrichment, value -> null is a provider LOSING data and is a conflict.
     */
    bid: numeric('bid', { precision: 12, scale: 5 }),
    ask: numeric('ask', { precision: 12, scale: 5 }),

    /**
     * The provider datetime text, EXACTLY as received.
     *
     * If only the parsed instant were stored, a timezone bug would be
     * unrecoverable AND undetectable - every affected row corrupted with no way
     * to find out. That asymmetry is why this column exists and equivalent raw
     * price columns do not: a mis-parsed instant is unrecoverable, a padded
     * decimal is not.
     *
     * DELIBERATELY EXCLUDED from the conflict comparison of a FINAL bar, so a
     * formatting change is not treated as a changed bar.
     *
     * AND THERE IS NO MECHANISM BEHIND THAT YET - stated plainly, because an
     * earlier version of this comment said such a change was "recorded
     * separately" and nothing recorded it. A stored final bar re-delivered with
     * identical prices and a DIFFERENT raw_datetime returns `noop`: nothing is
     * written, the stored text is kept, and the incoming variant is DISCARDED
     * WITHOUT BEING RECORDED. Keeping the stored text is right - it is the one
     * `open_time` was parsed from - but the arrival of a variant is information
     * we currently lose.
     *
     * A raw_datetime-only change is therefore CURRENTLY UNDETECTED. Detection
     * lands at T1.5, against the raw payloads T1.4's adapter captures. It
     * deserves detection because a provider changing its datetime rendering is
     * the canary for exactly the timezone bug this column exists to make
     * recoverable.
     *
     * On a FORMING bar the incoming text is stored, and a change to it alone
     * counts as a difference - so the forming path does not lose it.
     */
    rawDatetime: text('raw_datetime').notNull(),

    /** False for the forming bar. Same type, flagged - not a second shape. */
    isFinal: boolean('is_final').notNull(),

    /**
     * FIRST ARRIVAL. Set once and NEVER rewritten, including when a forming bar
     * is updated many times. Nothing in the upsert's SET clause may touch it;
     * an integration test asserts that across repeated rewrites.
     */
    ingestedAt: timestamp('ingested_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /**
     * LAST ACTUAL CHANGE - advanced only when a column value really changed.
     *
     * A redelivered identical bar must NOT bump it. The upsert's DO UPDATE
     * carries a WHERE guard so a no-op writes nothing at all; if that guard is
     * ever dropped, this column silently degrades from "when this row last
     * changed" into "when we last saw it" and nothing fails. The no-op test is
     * what protects it.
     *
     * Set explicitly in SQL. NO TRIGGER - the project has none, and `config`
     * follows the same convention.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE PRIMARY KEY IS THE UNIQUE CONSTRAINT. There is deliberately no second
     * unique index over the same columns - it would pay a write cost on every
     * row of a 161,000-row backfill for nothing.
     *
     * This tuple IS the bar's identity. A surrogate `id` would let two rows
     * claim to be the same bar with different prices, both valid - the exact
     * corruption the idempotent upsert exists to prevent - and would move the
     * guarantee out of the database, which §9 forbids.
     */
    primaryKey({
      name: 'candles_pk',
      columns: [table.instrumentId, table.providerId, table.timeframe, table.openTime],
    }),

    foreignKey({
      name: 'candles_instrument_id_instruments_id_fk',
      columns: [table.instrumentId],
      foreignColumns: [instruments.id],
    }),
    foreignKey({
      name: 'candles_provider_id_providers_id_fk',
      columns: [table.providerId],
      foreignColumns: [providers.id],
    }),

    /**
     * AT MOST ONE FORMING BAR PER SERIES. §9 requires the database to enforce
     * invariants, and this is one.
     *
     * Partial, so it indexes only non-final rows - about ten in total - making
     * its size and write cost negligible. An earlier draft proposed this index
     * for LOOKUP; that was wrong, because every access supplies the full
     * three-column equality prefix and the primary key already answers it. This
     * exists for CORRECTNESS.
     *
     * ACCEPTED CONSEQUENCE - IT CAN STALL THE FEED. Bar N+1 cannot be inserted
     * while bar N is still forming, so ingestion must finalise N and insert N+1
     * in ONE TRANSACTION. If finalising N fails, N+1 cannot be inserted AT ALL
     * and every subsequent bar for that series is blocked until the stuck
     * forming bar is resolved. That is chosen behaviour for a system whose
     * purpose is to refuse corrupt history - but it is chosen, not free, and
     * T1.7 must ALERT on it rather than retry silently.
     */
    uniqueIndex('candles_one_forming_idx')
      .on(table.instrumentId, table.providerId, table.timeframe)
      .where(sql`NOT ${table.isFinal}`),

    check('candles_timeframe_check', sql`${table.timeframe} IN ('1min','15min','1h','4h','1D')`),

    /**
     * STRUCTURAL VALIDITY IS ENFORCED HERE. THIS IS NOT THE WHOLE OF T1.5, and
     * conflating the two is how a later session concludes these CHECKs must go.
     *
     * T1.5's detections split into two classes, and only one is structural:
     *
     *   STRUCTURAL, per-bar - high < low, close outside [low, high],
     *   zero or negative values. The `Candle` contract already refines these,
     *   so a bar failing them never reaches the database. "Quarantine" here
     *   means REJECTED AT THE BOUNDARY AND RECORDED - not stored and flagged.
     *   These CHECKs are the database's half of that, and can only fire on a
     *   path that bypassed the contract, which is exactly the bug worth failing
     *   loudly on.
     *
     *   SEQUENCE - missing bars, duplicates, out-of-order arrival, implausible
     *   gaps against ATR, stale feed. Detectable only against stored history,
     *   and a bar violating them is structurally VALID. Those bars ARE stored
     *   and flagged. That mechanism does not exist yet; it is T1.5's to build.
     *
     * CONSEQUENCE, AND IT NEEDS AN OWNER: a bar rejected by one of these CHECKs
     * is GONE unless something captured the payload first. That is the T1.1
     * lesson - the raw response is the only recoverable artefact. Whatever
     * rejects a bar must record WHAT ARRIVED, not merely that something was
     * rejected. THAT BELONGS TO T1.4's PROVIDER ADAPTER, which is the first
     * code to hold a raw provider response; T1.5 then classifies what the
     * adapter captured. Neither exists yet, so today a rejected bar IS lost -
     * stated plainly rather than left implied.
     */
    check(
      'candles_positive_check',
      sql`${table.open} > 0 AND ${table.high} > 0 AND ${table.low} > 0 AND ${table.close} > 0`,
    ),
    check(
      'candles_high_check',
      sql`${table.high} >= ${table.low} AND ${table.high} >= ${table.open} AND ${table.high} >= ${table.close}`,
    ),
    check(
      'candles_low_check',
      sql`${table.low} <= ${table.open} AND ${table.low} <= ${table.close}`,
    ),
    check(
      'candles_spread_check',
      sql`${table.bid} IS NULL OR ${table.ask} IS NULL OR ${table.ask} >= ${table.bid}`,
    ),
  ],
)

export type CandleRow = typeof candles.$inferSelect
export type NewCandleRow = typeof candles.$inferInsert
