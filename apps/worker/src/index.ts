/**
 * `@karatx/worker` - long-lived Node process: feed consumer, scheduler,
 * technical engine, event detector, state machine, planner, dispatcher.
 *
 * Kept out of Next.js deliberately (audit H6): a dashboard deploy must not
 * drop the market feed, and the engine must be testable without booting a
 * framework (NFR-9).
 *
 * The real lifecycle - config validation, database connection, the
 * `system_events` startup row and graceful SIGTERM shutdown - lands in T0.8.
 * This module exists only so T0.1 can verify that cross-package imports
 * resolve from inside this app.
 */

import { CONFIG_PACKAGE_NAME } from '@karatx/config'
import { CONTRACTS_PACKAGE_NAME } from '@karatx/contracts'
import { CORE_PACKAGE_NAME } from '@karatx/core'

export const WORKER_APP_LINKED_PACKAGES = [
  CORE_PACKAGE_NAME,
  CONTRACTS_PACKAGE_NAME,
  CONFIG_PACKAGE_NAME,
] as const
