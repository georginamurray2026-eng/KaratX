/**
 * `@karatx/core` - pure domain logic.
 *
 * INVARIANT (ARCHITECTURE-AND-STACK.md F.3.1): this package performs no I/O.
 * No fetch, no database, no filesystem, and no clock reads - time is passed
 * in. That is what lets the backtest run the identical code path as live,
 * and it is the strongest defence against a backtest that lies.
 *
 * Enforced twice: T0.2's ESLint rules reject the imports, globals and clock
 * reads; T0.3's `"types": []` means this package cannot even name `process`
 * or a Node builtin at the type level.
 *
 * Phase 0 deliberately contains zero market logic (F.6).
 */

export {
  AiError,
  ConfigError,
  DatabaseError,
  ERROR_CATEGORIES,
  HANDLING_POLICIES,
  KaratxError,
  NetworkError,
  ProviderError,
  StrategyError,
  UnexpectedError,
  ValidationError,
  categoryOf,
  causeChain,
  isKaratxError,
  policyOf,
  rootCategoryOf,
  toKaratxError,
  type ErrorCategory,
  type HandlingPolicy,
  type KaratxErrorOptions,
} from './errors'

export const CORE_PACKAGE_NAME = '@karatx/core' as const
