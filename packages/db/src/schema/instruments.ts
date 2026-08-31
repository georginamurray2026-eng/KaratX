import { integer, numeric, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * The instruments this system knows about. Reference data, small and stable.
 *
 * HARD TO REVERSE - INTEGER PRIMARY KEY, NOT UUID. `system_events` uses uuid,
 * and this deliberately differs. `instrument_id` becomes a foreign key in the
 * candle table, which will hold hundreds of thousands of rows per year per
 * provider; a 4-byte integer key rather than a 16-byte uuid is a direct saving
 * in the largest table and in every index over it. Changing this later means
 * rewriting that table.
 */
export const instruments = pgTable(
  'instruments',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    /**
     * OUR canonical symbol, not a provider's. Twelve Data calls it `XAU/USD`
     * and Massive calls it `C:XAUUSD`; provider-specific spellings live in
     * `provider_instruments` so neither vendor's naming leaks into the rest of
     * the system.
     */
    symbol: text('symbol').notNull(),

    displayName: text('display_name').notNull(),

    /**
     * Smallest price increment.
     *
     * HARD TO REVERSE - NUMERIC(12,5) is the price shape for this entire
     * system, chosen to match the contract in `@karatx/contracts`. 7 integer
     * digits covers gold to $9,999,999; 5 decimal places holds the float32
     * artefacts Twelve Data emits (`4643.35156`) without rounding them. Every
     * price column downstream must use the same precision and scale, or a
     * value will silently change as it moves between tables.
     */
    tickSize: numeric('tick_size', { precision: 12, scale: 5 }).notNull(),
  },
  (table) => [uniqueIndex('instruments_symbol_key').on(table.symbol)],
)

export type Instrument = typeof instruments.$inferSelect
export type NewInstrument = typeof instruments.$inferInsert
