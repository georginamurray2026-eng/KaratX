/**
 * `@karatx/contracts` - Zod schemas shared across every boundary.
 *
 * Defined once here and imported everywhere: nothing downstream declares its
 * own shape for a Candle, a Price or an instant.
 */

export { Candle, Instrument, Price, Provider, TIMEFRAMES, Timeframe, Timestamp } from './market'
export {
  CANDLE_UPSERT_OUTCOMES,
  CANDLE_UPSERT_REFUSED,
  CANDLE_UPSERT_WROTE,
  CandleUpsertOutcome,
  candleUpsertRefused,
  candleUpsertWrote,
} from './ingestion'

export const CONTRACTS_PACKAGE_NAME = '@karatx/contracts' as const
