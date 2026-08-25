/**
 * `@karatx/core` - pure domain logic.
 *
 * INVARIANT (ARCHITECTURE-AND-STACK.md F.3.1): this package performs no I/O.
 * No fetch, no database, no filesystem, and no clock reads - time is passed
 * in. That is what lets the backtest run the identical code path as live,
 * and it is the strongest defence against a backtest that lies.
 *
 * Consequently this package must never depend on `@karatx/db` or
 * `@karatx/providers`. T0.1 enforces that structurally (they are absent from
 * this package's dependencies); T0.2 adds the ESLint rule that fails the
 * build if anyone adds them back.
 *
 * Phase 0 deliberately contains zero market logic (F.6).
 */

export const CORE_PACKAGE_NAME = '@karatx/core' as const
