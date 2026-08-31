import { integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { instruments } from './instruments'

/**
 * Market-data providers, and how each one spells our instruments.
 *
 * ADR-008: Twelve Data is the reference feed, Massive is the reconciliation
 * source and calendar oracle. Both write candles, so `provider_id` is part of
 * candle identity - "the price at time T" is always a question with a provider
 * argument.
 */
export const providers = pgTable(
  'providers',
  {
    // HARD TO REVERSE - integer key, for the same reason as instruments: this
    // becomes a foreign key in the candle table.
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    /** Stable machine key, e.g. `twelve_data`. Never a display string. */
    key: text('key').notNull(),

    displayName: text('display_name').notNull(),
  },
  (table) => [uniqueIndex('providers_key_key').on(table.key)],
)

/**
 * The provider-specific symbol for one of our instruments.
 *
 * A separate table rather than a column on `instruments`, because the mapping
 * is many-to-many over time: the same instrument has a different symbol at
 * every provider, and a provider may rename a symbol without our canonical
 * name changing.
 */
export const providerInstruments = pgTable(
  'provider_instruments',
  {
    providerId: integer('provider_id')
      .notNull()
      .references(() => providers.id),
    instrumentId: integer('instrument_id')
      .notNull()
      .references(() => instruments.id),

    /** What THIS provider calls it: `XAU/USD`, `C:XAUUSD`. */
    providerSymbol: text('provider_symbol').notNull(),
  },
  (table) => [
    // HARD TO REVERSE - composite PRIMARY KEY, not a surrogate id plus a unique
    // index. (provider_id, instrument_id) IS the identity of a row here: there
    // is exactly one mapping per pair, and a surrogate key would allow two rows
    // to disagree about the same pair while both looking valid. Caught by the
    // primary-key assertion in migrate.integration.test.ts, which noticed this
    // table had no primary key at all.
    primaryKey({ columns: [table.providerId, table.instrumentId] }),
    uniqueIndex('provider_instruments_symbol_key').on(table.providerId, table.providerSymbol),
  ],
)

export type Provider = typeof providers.$inferSelect
export type NewProvider = typeof providers.$inferInsert
export type ProviderInstrument = typeof providerInstruments.$inferSelect
export type NewProviderInstrument = typeof providerInstruments.$inferInsert
