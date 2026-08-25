import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Persisted runtime settings.
 *
 * ---------------------------------------------------------------------------
 * NOT THE SAME THING AS `packages/config`. Two different concepts share the
 * word "config", so the distinction is written down here rather than left to
 * be rediscovered (audit finding L3 is precisely this class of vocabulary
 * drift):
 *
 *   packages/config      environment configuration. Read from process.env at
 *                        boot, validated by Zod, immutable for the life of the
 *                        process, and MAY CONTAIN SECRETS (DATABASE_URL holds
 *                        a password, wrapped in Secret<T>).
 *
 *   this `config` table  operational settings. Read from the database at
 *                        runtime, changeable while the system is running,
 *                        auditable via updated_at, and MUST NEVER CONTAIN A
 *                        SECRET - rows here are queryable by anything holding
 *                        a database connection and appear in backups.
 *
 * Rule of thumb: if changing it requires a redeploy, it belongs in the
 * environment. If an operator should be able to change it on a live system -
 * an alert threshold, quiet hours (FR-6.8), a feature toggle - it belongs
 * here. Credentials belong in neither: they belong only in the environment.
 * ---------------------------------------------------------------------------
 */
export const config = pgTable('config', {
  /** Stable identifier, e.g. 'alerts.quiet_hours'. */
  key: text('key').primaryKey(),

  /** The setting itself. JSONB so a value can be scalar or structured. */
  value: jsonb('value').notNull(),

  /** Why this setting exists, for whoever finds it in six months. */
  description: text('description'),

  /** When it last changed. Stored UTC (NFR-4). */
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export type ConfigRow = typeof config.$inferSelect
export type NewConfigRow = typeof config.$inferInsert
