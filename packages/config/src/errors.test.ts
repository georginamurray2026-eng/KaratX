import { ConfigError, KaratxError, categoryOf, policyOf } from '@karatx/core'
import { describe, expect, it } from 'vitest'

import { ConfigValidationError } from './errors.js'
import { parseConfig } from './parse.js'

/**
 * T0.5: ConfigValidationError is re-homed under the core taxonomy.
 *
 * T0.3's own tests are deliberately left untouched - they are the
 * compatibility contract, and they still pass. These assertions cover only
 * what re-homing adds.
 */

const PASSWORD = 'p4ssw0rd-should-never-be-printed'

function captureError(): ConfigValidationError {
  try {
    parseConfig({ NODE_ENV: 'banana' })
  } catch (error) {
    if (error instanceof ConfigValidationError) return error
    throw error
  }
  throw new Error('expected parseConfig to throw')
}

describe('ConfigValidationError in the taxonomy', () => {
  it('is a ConfigError and therefore a KaratxError', () => {
    const error = captureError()
    expect(error).toBeInstanceOf(ConfigValidationError)
    expect(error).toBeInstanceOf(ConfigError)
    expect(error).toBeInstanceOf(KaratxError)
    expect(error).toBeInstanceOf(Error)
  })

  it('declares category config and policy stop', () => {
    const error = captureError()
    expect(error.category).toBe('config')
    // SEC-2: a bad environment must stop the process, not degrade it.
    expect(error.policy).toBe('stop')
  })

  it('is classifiable without knowing this package exists', () => {
    // The point of re-homing: a generic catch block can route on category
    // alone, with no import from @karatx/config.
    const error: unknown = captureError()
    expect(categoryOf(error)).toBe('config')
    expect(policyOf(error)).toBe('stop')
  })

  it('keeps the name T0.3 established', () => {
    expect(captureError().name).toBe('ConfigValidationError')
  })

  it('carries variable names in context, and never their values', () => {
    let error!: ConfigValidationError
    try {
      parseConfig({ DATABASE_URL: `garbage-${PASSWORD}`, NODE_ENV: 'banana' })
    } catch (caught) {
      error = caught as ConfigValidationError
    }

    expect(error.context).toEqual({ variables: expect.arrayContaining(['DATABASE_URL']) })

    // The whole point: names are safe to log, values are not.
    expect(JSON.stringify(error.context)).not.toContain(PASSWORD)
  })

  it('survives a rethrow that wraps it', () => {
    const original = captureError()
    const wrapped = new Error('worker failed to start', { cause: original })
    expect(categoryOf(wrapped)).toBe('config')
    expect(policyOf(wrapped)).toBe('stop')
  })
})
