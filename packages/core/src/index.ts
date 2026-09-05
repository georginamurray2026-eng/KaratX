/**
 * `@karatx/core` - pure domain logic.
 *
 * INVARIANT (ARCHITECTURE.md F.3.1): this package performs no I/O.
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

export {
  DEFAULT_RETRY_POLICY,
  describeStopReason,
  nextRetry,
  type RetryDecision,
  type RetryInput,
  type RetryPolicy,
  type RetryStopReason,
} from './retry'

export {
  initialBucket,
  takeToken,
  TWELVEDATA_FREE_TIER_PACE,
  type TokenBucketPolicy,
  type TokenBucketState,
  type TokenTakeResult,
} from './rate-limit'

export {
  classifyRevision,
  type RevisionClassification,
  type RevisionKind,
  type RevisionSide,
} from './revision'

export { expectsBarAt, type BarExpectation, type Holiday, type SessionRule } from './calendar'

export const CORE_PACKAGE_NAME = '@karatx/core' as const
