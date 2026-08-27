/**
 * The error taxonomy.
 *
 * Pure: no I/O, no clock, no `process`. This file stays inside the
 * `packages/core` boundary enforced by T0.2's ESLint rules and T0.3's
 * type-level opt-out from Node's ambient types.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE OF THE POLICY MAPPING
 *
 * `BUILD-PLAN.md` T0.5 asks each class to declare a handling policy "per §23"
 * of the Master Engineering Prompt. That prompt is NOT in this repository -
 * only the documents derived from it were committed - so §23's own mapping of
 * category to policy could not be read.
 *
 * The five policy names below are taken verbatim from BUILD-PLAN.md. The
 * assignment of a policy to each category is DERIVED from the rest of the
 * project specifications, and is cited per class. It is a considered proposal,
 * not a transcription of §23. If §23 later becomes available and disagrees,
 * this file is what should change.
 * ---------------------------------------------------------------------------
 */

export const ERROR_CATEGORIES = [
  'validation',
  'provider',
  'network',
  'database',
  'strategy',
  'ai',
  'config',
  'unexpected',
] as const

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

/**
 * What the system should do when an error of this kind occurs.
 *
 * - `retry`      transient. Retry with bounded backoff, never a tight loop.
 * - `degrade`    continue with reduced capability rather than failing.
 * - `alert`      a human should look at this; keep running.
 * - `stop`       do not continue. The system's assumptions are broken.
 * - `quarantine` set the offending data aside unrepaired and carry on.
 */
export const HANDLING_POLICIES = ['retry', 'degrade', 'alert', 'stop', 'quarantine'] as const

export type HandlingPolicy = (typeof HANDLING_POLICIES)[number]

export interface KaratxErrorOptions {
  /** Override the class default when a specific instance warrants it. */
  readonly policy?: HandlingPolicy
  /** Structured detail for logs. MUST NOT contain secrets. */
  readonly context?: Readonly<Record<string, unknown>>
  /** The error this one wraps. Preserves classification across a rethrow. */
  readonly cause?: unknown
}

/**
 * Base class for every error this system raises deliberately.
 *
 * `category` and `defaultPolicy` are constructor arguments rather than
 * subclass fields on purpose: subclass field initialisers run *after*
 * `super()` returns, so a base constructor reading `this.defaultPolicy` would
 * always see `undefined`.
 */
export abstract class KaratxError extends Error {
  readonly category: ErrorCategory
  readonly policy: HandlingPolicy
  readonly context: Readonly<Record<string, unknown>>

  protected constructor(
    category: ErrorCategory,
    defaultPolicy: HandlingPolicy,
    message: string,
    options?: KaratxErrorOptions,
  ) {
    super(message, { cause: options?.cause })
    this.category = category
    this.policy = options?.policy ?? defaultPolicy
    this.context = options?.context ?? {}
    // Reports the concrete subclass, so `ProviderError` rather than
    // `KaratxError`, without every subclass restating its own name.
    this.name = new.target.name
  }
}

/**
 * Input failed validation at a boundary.
 *
 * Derived policy `quarantine`: ARCHITECTURE-AND-STACK.md F.2 requires
 * malformed input to be quarantined and never repaired, and T1.5 makes the
 * same requirement of market data explicitly.
 */
export class ValidationError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'ValidationError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('validation', 'quarantine', message, options)
  }
}

/**
 * An external provider rejected a request or behaved unexpectedly.
 *
 * Derived policy `retry`: rate limits and transient upstream failures are the
 * common case, and T1.4/T1.7 already require bounded backoff against the
 * market-data provider.
 */
export class ProviderError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'ProviderError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('provider', 'retry', message, options)
  }
}

/**
 * A connection failed, dropped or timed out.
 *
 * Derived policy `retry`: T1.7 requires reconnection with exponential backoff
 * and jitter, bounded, never an infinite tight loop.
 */
export class NetworkError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'NetworkError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('network', 'retry', message, options)
  }
}

/**
 * A database operation failed.
 *
 * Derived policy `alert` rather than `retry`: the class covers both transient
 * connection loss and constraint violations, and a constraint violation is a
 * defect that retrying would merely repeat. Callers that know an error is
 * transient should pass `{ policy: 'retry' }` explicitly.
 *
 * Carries the SQLSTATE in `context.code` where available - T1.3's idempotency
 * work depends on distinguishing a unique violation from a connection failure.
 */
export class DatabaseError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'DatabaseError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('database', 'alert', message, options)
  }
}

/**
 * The strategy engine reached a state it does not define.
 *
 * Derived policy `stop`: F.4 requires an invalid state-machine transition to
 * throw rather than log, and §13's invariants are meant to hold absolutely.
 * Continuing past a broken strategy assumption is how a system starts
 * confidently emitting wrong trades.
 */
export class StrategyError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'StrategyError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('strategy', 'stop', message, options)
  }
}

/**
 * The reasoning layer failed, or returned something unusable.
 *
 * Derived policy `degrade`: FR-7.6 requires that LLM failure must not
 * interrupt market monitoring, detection or alerting, and F.3 invariant 2
 * states that an LLM outage degrades the product's prose, not its function.
 */
export class AiError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'AiError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('ai', 'degrade', message, options)
  }
}

/**
 * Configuration is missing, malformed, or internally inconsistent.
 *
 * Derived policy `stop`: SEC-2 requires the system to fail fast and loudly on
 * bad configuration rather than starting in an unknown state.
 *
 * `ConfigValidationError` in `packages/config` extends this class.
 */
export class ConfigError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'ConfigError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('config', 'stop', message, options)
  }
}

/**
 * Something we did not anticipate.
 *
 * Derived policy `alert`: unknown by definition, so a human should look, but
 * stopping the whole system for an unclassified error would make the product
 * less reliable rather than more.
 */
export class UnexpectedError extends KaratxError {
  // A string literal, not new.target.name: a production bundle minifies class
  // names, so new.target.name yields 'r' and every log line and boot message
  // loses its classification. Measured in a Next.js build during T0.7.
  override readonly name: string = 'UnexpectedError'

  constructor(message: string, options?: KaratxErrorOptions) {
    super('unexpected', 'alert', message, options)
  }
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

export function deliberatelyBrokenForCiProof(): number {
  // CI PROOF ONLY - violates F.3 invariant 1. Never merged.
  return Date.now()
}

export function isKaratxError(error: unknown): error is KaratxError {
  return error instanceof KaratxError
}

/**
 * Every error in the `cause` chain, outermost first.
 *
 * Bounded: a malformed or cyclic chain must not hang the process, so traversal
 * stops at a fixed depth and on any repeat.
 */
export function causeChain(error: unknown, maxDepth = 16): unknown[] {
  const chain: unknown[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && chain.length < maxDepth) {
    if (seen.has(current)) break
    seen.add(current)
    chain.push(current)
    current = current instanceof Error ? current.cause : undefined
  }

  return chain
}

/**
 * The category of the outermost classified error in the chain.
 *
 * Walking the chain is what preserves classification through a rethrow: code
 * that wraps a `ProviderError` in context of its own still reports a
 * classified error rather than collapsing to `unexpected`.
 */
export function categoryOf(error: unknown): ErrorCategory {
  for (const link of causeChain(error)) {
    if (isKaratxError(link)) return link.category
  }
  return 'unexpected'
}

/** The handling policy of the outermost classified error in the chain. */
export function policyOf(error: unknown): HandlingPolicy {
  for (const link of causeChain(error)) {
    if (isKaratxError(link)) return link.policy
  }
  return 'alert'
}

/**
 * The category of the *deepest* classified error - the original cause.
 *
 * Distinct from `categoryOf`: after wrapping a `DatabaseError` in a
 * `ProviderError`, the outermost category drives handling while this answers
 * "what actually went wrong first".
 */
export function rootCategoryOf(error: unknown): ErrorCategory {
  const classified = causeChain(error).filter(isKaratxError)
  const deepest = classified.at(-1)
  return deepest?.category ?? 'unexpected'
}

/**
 * Normalise anything thrown into a classified error.
 *
 * `throw` accepts any value, so a catch block receives `unknown`. Passing an
 * already-classified error through unchanged is what keeps classification
 * intact when this is used at a rethrow point.
 */
export function toKaratxError(error: unknown, message = 'Unexpected error'): KaratxError {
  if (isKaratxError(error)) return error
  return new UnexpectedError(message, { cause: error })
}
