import { ConfigError, DatabaseError, StrategyError } from '@karatx/core'
import { ConfigValidationError } from '@karatx/config'
import type { MigrationStatus } from '@karatx/db'
import { describe, expect, it } from 'vitest'

import { describeMigrationState, formatPreLoggerFailure, isPreLoggerFailure } from './boot'

/**
 * The pure half of boot: what the worker SAYS when it refuses to start.
 *
 * The message is the deliverable, not the boolean. T0.7 produced a check that
 * reported the right failure with the wrong cause, and someone would have
 * debugged connectivity for an hour when the answer was one command. These
 * tests assert the wording, not just the refusal.
 */

function status(overrides: Partial<MigrationStatus> = {}): MigrationStatus {
  return {
    appliedCount: 2,
    expectedCount: 2,
    latestApplied: '0001_initial',
    pending: [],
    unknown: [],
    inSync: true,
    ...overrides,
  }
}

describe('an empty database', () => {
  it('says the schema is missing and names the command that fixes it', () => {
    const result = describeMigrationState(
      status({
        appliedCount: 0,
        latestApplied: undefined,
        pending: ['0001_initial'],
        inSync: false,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('schema is missing')
    expect(result.message).toContain('pnpm db:migrate')
  })

  it('does not describe a reachable empty database as a connection problem', () => {
    // The T0.7 misdiagnosis, in its worker form. An empty database is a normal
    // first-deploy state, not a broken one.
    const result = describeMigrationState(
      status({
        appliedCount: 0,
        latestApplied: undefined,
        pending: ['0001_initial'],
        inSync: false,
      }),
    )

    expect(result.message).not.toMatch(/unreachable|connect|network|timeout/i)
  })
})

describe('a database behind this build', () => {
  it('names the pending migrations and the command', () => {
    const result = describeMigrationState(
      status({
        appliedCount: 1,
        expectedCount: 3,
        pending: ['0002_setups', '0003_alerts'],
        inSync: false,
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('0002_setups')
    expect(result.message).toContain('0003_alerts')
    expect(result.message).toContain('pnpm db:migrate')
  })

  it('reports "behind", not "missing", when some migrations have been applied', () => {
    const result = describeMigrationState(
      status({ appliedCount: 1, expectedCount: 2, pending: ['0002_setups'], inSync: false }),
    )

    expect(result.message).toContain('behind this build')
    expect(result.message).not.toContain('schema is missing')
  })
})

describe('a database ahead of this build', () => {
  it('refuses, and does NOT suggest db:migrate', () => {
    // Running migrations would apply nothing and leave the operator believing
    // they had fixed it. This is a rollback to an older image, not a missed
    // release step.
    const result = describeMigrationState(status({ unknown: [1_700_000_000_000], inSync: false }))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('ahead of this code')
    expect(result.message).not.toContain('db:migrate')
  })

  it('reports both problems when the database is simultaneously behind and ahead', () => {
    const result = describeMigrationState(
      status({
        appliedCount: 1,
        expectedCount: 2,
        pending: ['0002_setups'],
        unknown: [1_700_000_000_000],
        inSync: false,
      }),
    )

    expect(result.message).toContain('behind this build')
    expect(result.message).toContain('ahead of this code')
  })
})

describe('a database in sync', () => {
  it('is accepted', () => {
    const result = describeMigrationState(status())

    expect(result.ok).toBe(true)
    expect(result.message).toContain('2 migration(s) applied')
  })
})

describe('classifying a boot failure', () => {
  it('treats a configuration failure as pre-logger', () => {
    // The logger's level and secret list come from the configuration that just
    // failed to parse, so this failure genuinely cannot be logged as JSON.
    const error = new ConfigValidationError([
      { variable: 'DATABASE_URL', kind: 'missing', expected: 'a PostgreSQL connection string' },
    ])

    expect(error).toBeInstanceOf(ConfigError)
    expect(isPreLoggerFailure(error)).toBe(true)
  })

  it('does NOT treat a database failure as pre-logger', () => {
    // A logger exists by then, so this failure must reach the log as JSON
    // rather than only as stderr prose.
    expect(isPreLoggerFailure(new DatabaseError('unreachable'))).toBe(false)
  })

  it('does not treat an unrelated error as pre-logger', () => {
    expect(isPreLoggerFailure(new StrategyError('bad transition'))).toBe(false)
    expect(isPreLoggerFailure('a string')).toBe(false)
  })
})

describe('the stderr message', () => {
  it('names the error type, which survives minification', () => {
    // T0.7: a production bundle minifies class names, so `new.target.name`
    // yielded 'r'. Each class now carries a string literal instead.
    const message = formatPreLoggerFailure(new DatabaseError('database is unreachable'))

    expect(message).toContain('DatabaseError')
    expect(message).toContain('database is unreachable')
  })

  it('handles something thrown that is not an Error at all', () => {
    expect(formatPreLoggerFailure('plain string')).toContain('plain string')
    expect(formatPreLoggerFailure(undefined)).toContain('undefined')
  })
})
