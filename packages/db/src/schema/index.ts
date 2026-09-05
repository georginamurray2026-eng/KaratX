/**
 * Every table in the database, re-exported for drizzle-kit and for query code.
 *
 * Phase 0 creates two tables. Phase 1 adds roughly six more; the full build is
 * around 28 (ARCHITECTURE.md F.5).
 */
export { config, type ConfigRow, type NewConfigRow } from './config'
export { systemEvents, type NewSystemEvent, type SystemEvent } from './system-events'
export { instruments, type Instrument, type NewInstrument } from './instruments'
export {
  providerInstruments,
  providers,
  type NewProvider,
  type NewProviderInstrument,
  type Provider,
  type ProviderInstrument,
} from './providers'
export { candles, type CandleRow, type NewCandleRow } from './candles'
export {
  marketHolidays,
  marketHours,
  type MarketHoliday,
  type MarketHoursRule,
  type NewMarketHoliday,
  type NewMarketHoursRule,
} from './market-hours'
export { jobRuns, type JobRun, type NewJobRun } from './job-runs'
export {
  dataQualityEvents,
  type DataQualityEvent,
  type NewDataQualityEvent,
} from './data-quality-events'
