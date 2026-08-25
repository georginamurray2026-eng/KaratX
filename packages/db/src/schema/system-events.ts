import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Operational events emitted by the running system.
 *
 * This is the audit trail for what the *system* did - process started, feed
 * connected, feed dropped, migration applied. It is deliberately not the
 * market-data or strategy record: nothing here is a derived market fact, so
 * this table carries a single timestamp rather than the `occurred_at` /
 * `confirmed_at` pair that F.3 invariant 3 requires of derived structures.
 *
 * Written by T0.8 (worker startup row) and T1.7 (connect / disconnect /
 * reconnect), and read by the operational alerting in OPS-8.
 *
 * `source`, `event_type` and `severity` are plain text rather than Postgres
 * enums. An enum needs a migration to add a value, and the vocabulary here
 * will grow steadily through Phases 1-8; the constraint belongs in the Zod
 * contract at the write boundary (SEC-3), not in a type that is expensive to
 * change.
 */
export const systemEvents = pgTable(
  'system_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** When the event happened. Stored UTC (NFR-4). */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Which process emitted it, e.g. 'worker' or 'web'. */
    source: text('source').notNull(),

    /** What happened, e.g. 'process.started'. */
    eventType: text('event_type').notNull(),

    /** Operational severity, e.g. 'info' | 'warn' | 'error'. */
    severity: text('severity').notNull().default('info'),

    /** Human-readable detail. Never a secret - see packages/config Secret<T>. */
    message: text('message'),

    /** Structured detail. Never a secret. */
    context: jsonb('context'),
  },
  (table) => [
    // The dominant query is "most recent events first".
    index('system_events_occurred_at_idx').on(table.occurredAt.desc()),
  ],
)

export type SystemEvent = typeof systemEvents.$inferSelect
export type NewSystemEvent = typeof systemEvents.$inferInsert
