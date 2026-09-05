import { sql } from 'drizzle-orm'
import { check, date, index, integer, pgTable, text, time } from 'drizzle-orm/pg-core'

import { instruments } from './instruments'

/**
 * The trading calendar. OURS, and authoritative (ADR-008).
 *
 * PER INSTRUMENT, NOT PER PROVIDER. The task text said "for the chosen
 * provider"; that contradicts ADR-008, which makes the calendar ours precisely
 * so a provider's representation can be checked AGAINST it. A provider-scoped
 * calendar could never detect a provider changing its representation - which
 * is exactly what Twelve Data did in 2025 when weekend bars appeared.
 *
 * WHY THIS TABLE MUST NOT BE EMPTY. T1.5 asks it "how many bars should exist
 * on this date?" and compares the answer to what arrived. An empty table
 * answers "nothing expected" to every question: weekend detection finds
 * nothing and reports success, every assertion passes, and there is no error,
 * no alert and no symptom. That is why `expectsBarAt` returns three values
 * rather than a boolean - with no rules covering a date the answer is UNKNOWN,
 * never CLOSED, and UNKNOWN never suppresses the staleness alarm. The empty
 * table becomes loud instead of silent.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE BUILDING OR READING A DETECTOR (2026-09-05, migration 0004)
 * ---------------------------------------------------------------------------
 *
 * THESE RULES ARE STRICTER THAN THE FEED HAS EVER BEEN. They are absolutes, and
 * the feed they police only ever followed them as a strong tendency.
 *
 * Measured over 166,344 stored bars: against roughly 208 daily-break
 * opportunities a year, CLEAN breaks number 167-200 across 2020-2024. **816
 * bars sit inside the 17:00-18:00 New York break window BEFORE 2026-04-05** -
 * during the era the provider honoured the break at all. So the break was
 * absent on something like a FIFTH OF WEEKDAYS in its good years.
 *
 * A flagged bar therefore does NOT mean the feed broke. It means our feed
 * disagrees with a calendar built from a DIFFERENT feed (Massive supplied the
 * original boundaries; ADR-008 records the two venues differing by an hour), in
 * a period when our feed was itself inconsistent by a fifth.
 *
 * SEVERITY, DECIDED BEFORE THE DETECTORS EXIST rather than after, because
 * deciding afterwards means deciding against a number already on the screen and
 * the pull is toward whatever makes it acceptable:
 *
 *   `unexpected_bar` against this calendar is INFORMATIONAL. Counted,
 *   queryable, NOT alerting.
 *
 * These bars are not errors. Ranking them beside `high_below_low` - a
 * structural impossibility - would equate a known venue difference with a
 * corrupt row, and a false-positive rate is exactly how someone learns to
 * ignore an alert channel. BUILD-PLAN names that risk for T1.5 directly.
 *
 * WHAT IS ALERTING IS A CHANGE IN THE RATE, and that is a different detector
 * which cannot be built yet. Roughly 10,800 of 166,344 bars - 9,645 in the
 * weekly-closure window and 1,168 in the daily break - is the expected baseline
 * for calendar-versus-feed disagreement. 6.5% is Tuesday; a sudden move to 40%
 * is a finding. THE FIRST DETECTOR RUN IS WHAT MEASURES THAT BASELINE, so
 * record the number it produces - the rate detector has nothing to compare
 * against until it exists.
 */
export const marketHours = pgTable(
  'market_hours',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),

    /**
     * HARD TO REVERSE - the rule vocabulary.
     *
     * `text` with a CHECK rather than a Postgres enum: the CHECK is structural
     * so it cannot be forgotten, but unlike an enum it can be widened in a
     * plain migration. Follows the precedent set by `system_events`.
     */
    ruleType: text('rule_type').notNull(),

    /**
     * ISO day of week: 1 = Monday .. 7 = Sunday, matching Postgres `isodow`.
     *
     * HARD TO REVERSE - the 0-vs-1 basing. Chosen to match `isodow` so that
     * queries can compare directly without arithmetic; JavaScript's `getDay()`
     * is 0 = Sunday and MUST be converted at the boundary, never compared raw.
     */
    dayOfWeek: integer('day_of_week').notNull(),

    /**
     * Local wall-clock times, in `timezone` below.
     *
     * HARD TO REVERSE - LOCAL TIME PLUS AN IANA ZONE, NEVER A UTC OFFSET.
     * 17:00 New York is 22:00 UTC under EST and 21:00 UTC under EDT, so a
     * stored offset would be silently wrong for half of every year - and wrong
     * in a way that shifts the daily candle boundary, which is what
     * INDICATOR-SPEC C2 depends on. Postgres resolves IANA names against its
     * own tzdata, including historical rule changes, which matters for backfill
     * to 2020.
     */
    localStart: time('local_start').notNull(),

    /** Null for instant rules (`weekly_open`, `weekly_close`). */
    localEnd: time('local_end'),

    /** IANA name, e.g. `America/New_York`. Never an abbreviation or offset. */
    timezone: text('timezone').notNull(),

    /**
     * HARD TO REVERSE - rule versioning.
     *
     * Rules change: the 2025 appearance of weekend bars proves representations
     * shift. Without this, the calendar can only answer "what do we believe
     * now?", and Phase 9 needs "what did we believe when this 2021 bar was
     * ingested?". Retrofitting version columns onto a calendar that assertions
     * already depend on means re-deriving every historical answer.
     */
    effectiveFrom: date('effective_from').notNull(),

    /** Null means still in force. */
    effectiveTo: date('effective_to'),
  },
  (table) => [
    index('market_hours_lookup_idx').on(table.instrumentId, table.effectiveFrom),
    check(
      'market_hours_rule_type_check',
      sql`${table.ruleType} IN ('weekly_open', 'weekly_close', 'daily_break')`,
    ),
    check('market_hours_day_of_week_check', sql`${table.dayOfWeek} BETWEEN 1 AND 7`),
    // An instant rule has no end; a span rule must have one. Without this a
    // daily_break with a null end would silently mean "closed forever after".
    check(
      'market_hours_span_check',
      sql`(${table.ruleType} = 'daily_break') = (${table.localEnd} IS NOT NULL)`,
    ),
    check(
      'market_hours_effective_range_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
)

/**
 * Dates on which the recurring rules do not apply.
 *
 * CREATED IN T1.2, POPULATED IN T1.5. Until it is populated, a holiday reads as
 * an ordinary session and T1.5 emits a data-quality event that looks exactly
 * like a feed fault. That is expected behaviour, recorded in STATUS.md as a
 * known first occurrence - see the note on partial days, which are the case
 * most likely to be misdiagnosed.
 *
 * WHICH US HOLIDAYS ACTUALLY AFFECT SPOT GOLD IS UNMEASURED. XAU/USD is OTC,
 * not COMEX: London and Asia stay open through US holidays, so spot typically
 * thins rather than closing. Do not seed this from a futures calendar without
 * checking it against Massive first.
 */
export const marketHolidays = pgTable(
  'market_holidays',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),

    /** The calendar date in the instrument's own session timezone. */
    holidayDate: date('holiday_date').notNull(),

    /**
     * `full` - no session at all.
     * `early_close` - session ends at `localClose` instead of the usual rule.
     *
     * The second is the dangerous one to diagnose: a partial day produces a
     * PARTIAL gap, where some bars arrive and some do not, which resembles a
     * flaky provider far more than a clean absence does.
     */
    closureType: text('closure_type').notNull(),

    /** Local wall-clock close for `early_close`; null for `full`. */
    localClose: time('local_close'),

    /** Where this came from: `massive`, `cme_published`, `manual`. */
    source: text('source').notNull(),

    description: text('description'),
  },
  (table) => [
    index('market_holidays_lookup_idx').on(table.instrumentId, table.holidayDate),
    check(
      'market_holidays_closure_type_check',
      sql`${table.closureType} IN ('full', 'early_close')`,
    ),
    check(
      'market_holidays_close_check',
      sql`(${table.closureType} = 'early_close') = (${table.localClose} IS NOT NULL)`,
    ),
  ],
)

export type MarketHoursRule = typeof marketHours.$inferSelect
export type NewMarketHoursRule = typeof marketHours.$inferInsert
export type MarketHoliday = typeof marketHolidays.$inferSelect
export type NewMarketHoliday = typeof marketHolidays.$inferInsert
