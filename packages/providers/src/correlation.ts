import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Correlation-ID propagation.
 *
 * `AsyncLocalStorage` rather than passing an ID through every function
 * signature: the worker's call chains run candle ingestion through validation,
 * aggregation, the engine and the dispatcher, and threading an ID by hand
 * through all of that would be both invasive and easy to drop silently.
 *
 * The storage survives `await` boundaries, so everything logged while handling
 * one 15M close carries the same ID without any call site knowing about it.
 */

interface CorrelationContext {
  readonly correlationId: string
}

const storage = new AsyncLocalStorage<CorrelationContext>()

/**
 * Run `fn` with a correlation ID attached to everything it logs, including
 * across awaits and nested calls.
 */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn)
}

/** The current correlation ID, or undefined outside any correlated scope. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId
}
