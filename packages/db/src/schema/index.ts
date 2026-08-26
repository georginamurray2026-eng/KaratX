/**
 * Every table in the database, re-exported for drizzle-kit and for query code.
 *
 * Phase 0 creates two tables. Phase 1 adds roughly six more; the full build is
 * around 28 (ARCHITECTURE-AND-STACK.md F.5).
 */
export { config, type ConfigRow, type NewConfigRow } from './config'
export { systemEvents, type NewSystemEvent, type SystemEvent } from './system-events'
