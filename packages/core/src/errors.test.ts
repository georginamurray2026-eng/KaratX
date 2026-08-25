import { describe, expect, it } from 'vitest'

import {
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
} from './errors.js'

/** Every class in the taxonomy, with the category and policy it must declare. */
const TAXONOMY = [
  { Class: ValidationError, category: 'validation', policy: 'quarantine' },
  { Class: ProviderError, category: 'provider', policy: 'retry' },
  { Class: NetworkError, category: 'network', policy: 'retry' },
  { Class: DatabaseError, category: 'database', policy: 'alert' },
  { Class: StrategyError, category: 'strategy', policy: 'stop' },
  { Class: AiError, category: 'ai', policy: 'degrade' },
  { Class: ConfigError, category: 'config', policy: 'stop' },
  { Class: UnexpectedError, category: 'unexpected', policy: 'alert' },
] as const satisfies readonly {
  Class: new (message: string) => KaratxError
  category: ErrorCategory
  policy: HandlingPolicy
}[]

describe('taxonomy coverage', () => {
  it('covers exactly the eight categories T0.5 requires', () => {
    expect([...ERROR_CATEGORIES]).toEqual([
      'validation',
      'provider',
      'network',
      'database',
      'strategy',
      'ai',
      'config',
      'unexpected',
    ])
  })

  it('declares exactly the five handling policies', () => {
    expect([...HANDLING_POLICIES]).toEqual(['retry', 'degrade', 'alert', 'stop', 'quarantine'])
  })

  it('provides one class per category, with no category unclaimed', () => {
    const claimed = TAXONOMY.map((t) => t.category).sort()
    expect(claimed).toEqual([...ERROR_CATEGORIES].sort())
  })
})

describe.each(TAXONOMY)('$category', ({ Class, category, policy }) => {
  it('declares its category and default handling policy', () => {
    const error = new Class('something went wrong')
    expect(error.category).toBe(category)
    expect(error.policy).toBe(policy)
  })

  it('is a real Error with the concrete class name', () => {
    const error = new Class('something went wrong')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(KaratxError)
    expect(error.name).toBe(Class.name)
    expect(error.message).toBe('something went wrong')
    // A stack is what makes an error diagnosable at 3am.
    expect(error.stack).toContain(Class.name)
  })

  it('is recognised by isKaratxError and classified by category', () => {
    const error = new Class('boom')
    expect(isKaratxError(error)).toBe(true)
    expect(categoryOf(error)).toBe(category)
    expect(policyOf(error)).toBe(policy)
  })
})

describe('per-instance policy override', () => {
  it('lets a caller override the class default', () => {
    // The motivating case: a transient connection failure is retryable, while
    // the class defaults to `alert` because a constraint violation is not.
    const transient = new DatabaseError('connection terminated', { policy: 'retry' })
    expect(transient.category).toBe('database')
    expect(transient.policy).toBe('retry')
    expect(policyOf(transient)).toBe('retry')
  })

  it('leaves the class default in place when not overridden', () => {
    expect(new DatabaseError('duplicate key').policy).toBe('alert')
  })
})

describe('context', () => {
  it('carries structured detail for logging', () => {
    const error = new DatabaseError('duplicate key', { context: { code: '23505' } })
    expect(error.context).toEqual({ code: '23505' })
  })

  it('defaults to an empty object rather than undefined', () => {
    expect(new NetworkError('timeout').context).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// The requirement T0.5 names explicitly: classification survives a rethrow.
// ---------------------------------------------------------------------------
describe('classification is preserved through a rethrow', () => {
  it('survives catching and rethrowing the same error', () => {
    const thrown = (): never => {
      throw new ProviderError('rate limited')
    }

    // The realistic shape of a rethrow: a layer inspects the error to decide
    // how to react, then passes it on unchanged. (A catch that only rethrows
    // is rejected by `no-useless-catch`, and rightly so - it is a no-op.)
    const observed: string[] = []
    const rethrow = (): never => {
      try {
        return thrown()
      } catch (error) {
        observed.push(categoryOf(error))
        throw error
      }
    }

    expect(rethrow).toThrow(ProviderError)
    expect(observed).toEqual(['provider'])

    try {
      rethrow()
    } catch (error) {
      expect(categoryOf(error)).toBe('provider')
      expect(policyOf(error)).toBe('retry')
    }
  })

  it('survives being wrapped in another classified error', () => {
    const original = new DatabaseError('duplicate key', { context: { code: '23505' } })
    const wrapped = new ProviderError('failed to store candle', { cause: original })

    // The outermost classification drives handling...
    expect(categoryOf(wrapped)).toBe('provider')
    expect(policyOf(wrapped)).toBe('retry')

    // ...while the original cause remains discoverable.
    expect(rootCategoryOf(wrapped)).toBe('database')
    expect(wrapped.cause).toBe(original)
  })

  it('survives being wrapped in an unclassified Error', () => {
    // The realistic case: a third-party library catches our error and rethrows
    // its own. Classification must still be recoverable from the chain rather
    // than collapsing to `unexpected`.
    const original = new AiError('model returned invalid JSON')
    const foreign = new Error('request failed', { cause: original })

    expect(isKaratxError(foreign)).toBe(false)
    expect(categoryOf(foreign)).toBe('ai')
    expect(policyOf(foreign)).toBe('degrade')
  })

  it('survives several layers of wrapping', () => {
    const root = new NetworkError('ECONNRESET')
    const mid = new Error('pool error', { cause: root })
    const outer = new ProviderError('candle fetch failed', { cause: mid })

    expect(categoryOf(outer)).toBe('provider')
    expect(rootCategoryOf(outer)).toBe('network')
    expect(causeChain(outer)).toEqual([outer, mid, root])
  })
})

describe('categoryOf / policyOf on unclassified input', () => {
  it.each([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('falls back to unexpected/alert for %s', (_label, value) => {
    expect(categoryOf(value)).toBe('unexpected')
    expect(policyOf(value)).toBe('alert')
  })
})

describe('causeChain', () => {
  it('returns the outermost error first', () => {
    const root = new NetworkError('root')
    const outer = new ProviderError('outer', { cause: root })
    expect(causeChain(outer)).toEqual([outer, root])
  })

  it('terminates on a cyclic chain rather than hanging', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    // Deliberately cyclic: a malformed chain must not lock up the process.
    Object.defineProperty(a, 'cause', { value: b, configurable: true })

    const chain = causeChain(b)
    expect(chain.length).toBeLessThanOrEqual(16)
    expect(chain).toContain(a)
    expect(chain).toContain(b)
  })

  it('is bounded by maxDepth', () => {
    let error = new Error('depth 0')
    for (let i = 1; i < 50; i += 1) {
      error = new Error(`depth ${String(i)}`, { cause: error })
    }
    expect(causeChain(error).length).toBe(16)
    expect(causeChain(error, 4).length).toBe(4)
  })
})

describe('toKaratxError', () => {
  it('passes an already-classified error through unchanged', () => {
    const original = new StrategyError('invalid transition')
    expect(toKaratxError(original)).toBe(original)
  })

  it('wraps an unclassified error, preserving it as the cause', () => {
    const foreign = new Error('something from a library')
    const normalised = toKaratxError(foreign)

    expect(normalised).toBeInstanceOf(UnexpectedError)
    expect(normalised.category).toBe('unexpected')
    expect(normalised.policy).toBe('alert')
    expect(normalised.cause).toBe(foreign)
  })

  it('wraps non-Error values, which JavaScript permits anyone to throw', () => {
    const normalised = toKaratxError('just a string')
    expect(normalised).toBeInstanceOf(UnexpectedError)
    expect(normalised.cause).toBe('just a string')
  })
})
