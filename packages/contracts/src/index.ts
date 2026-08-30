/**
 * `@karatx/contracts` - Zod schemas shared across every boundary.
 *
 * Defined once here and imported everywhere: nothing downstream declares its
 * own shape for a Candle, a Price or an instant.
 */

export { Candle, Instrument, Price, Provider, TIMEFRAMES, Timeframe, Timestamp } from './market'

export const CONTRACTS_PACKAGE_NAME = '@karatx/contracts' as const
