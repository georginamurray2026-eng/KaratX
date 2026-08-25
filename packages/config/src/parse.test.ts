import { describe, expect, it } from 'vitest'

import { ConfigValidationError } from './errors.js'
import { parseConfig, type EnvSource } from './parse.js'
import { Secret } from './secret.js'

// Password-shaped test values. None of these are real credentials; they exist
// so the assertions can prove they never reach the error output.
const PASSWORD = 'p4ssw0rd-should-never-be-printed'
const VALID_DATABASE_URL = `postgres://karatx:${PASSWORD}@localhost:5432/karatx`
const MALFORMED_DATABASE_URL = `definitely-not-a-url-${PASSWORD}`
const WRONG_PROTOCOL_DATABASE_URL = `mysql://karatx:${PASSWORD}@localhost:3306/karatx`

const validEnv: EnvSource = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: VALID_DATABASE_URL,
}

/** Captures the thrown error so its contents can be asserted. */
function captureError(env: EnvSource): ConfigValidationError {
  try {
    parseConfig(env)
  } catch (error) {
    if (error instanceof ConfigValidationError) return error
    throw error
  }
  throw new Error('expected parseConfig to throw, but it returned successfully')
}

describe('parseConfig - valid config', () => {
  it('parses a complete environment', () => {
    const config = parseConfig(validEnv)
    expect(config.nodeEnv).toBe('test')
    expect(config.logLevel).toBe('warn')
    expect(config.databaseUrl.reveal()).toBe(VALID_DATABASE_URL)
  })

  it('wraps DATABASE_URL in a Secret rather than returning a bare string', () => {
    const config = parseConfig(validEnv)
    expect(config.databaseUrl).toBeInstanceOf(Secret)
    expect(String(config.databaseUrl)).toBe('[REDACTED]')
  })

  it('applies defaults for optional variables', () => {
    const config = parseConfig({ DATABASE_URL: VALID_DATABASE_URL })
    expect(config.nodeEnv).toBe('development')
    expect(config.logLevel).toBe('info')
  })

  it('ignores unknown variables rather than rejecting them', () => {
    // process.env carries hundreds of unrelated keys. A strict schema would
    // fail every real process, so this behaviour is load-bearing.
    const config = parseConfig({
      ...validEnv,
      PATH: '/usr/bin',
      HOME: '/home/someone',
      CI: 'true',
      SOME_VENDOR_INJECTED_VAR: 'whatever',
    })
    expect(config.nodeEnv).toBe('test')
  })

  it('accepts the postgresql:// protocol as well as postgres://', () => {
    const config = parseConfig({
      ...validEnv,
      DATABASE_URL: 'postgresql://karatx@localhost:5432/karatx',
    })
    expect(config.databaseUrl.reveal()).toContain('postgresql://')
  })
})

describe('parseConfig - missing variables', () => {
  it('throws a named error when a required variable is missing', () => {
    const error = captureError({ NODE_ENV: 'test' })
    expect(error).toBeInstanceOf(ConfigValidationError)
    expect(error.name).toBe('ConfigValidationError')
  })

  it('names the missing variable and classifies it as missing', () => {
    const error = captureError({ NODE_ENV: 'test' })
    expect(error.problems).toEqual([
      {
        variable: 'DATABASE_URL',
        kind: 'missing',
        expected: 'a postgres:// or postgresql:// connection URL',
      },
    ])
    expect(error.message).toContain('DATABASE_URL')
    expect(error.message).toContain('missing')
  })

  it('reports every problem at once, not just the first', () => {
    // One failed boot should produce one complete list of things to fix.
    const error = captureError({ NODE_ENV: 'banana', LOG_LEVEL: 'shouty' })
    const names = error.problems.map((p) => p.variable).sort()
    expect(names).toEqual(['DATABASE_URL', 'LOG_LEVEL', 'NODE_ENV'])
    expect(error.message).toContain('3 problems')
  })

  it('treats an entirely empty environment as missing, not as a crash', () => {
    const error = captureError({})
    expect(error).toBeInstanceOf(ConfigValidationError)
    expect(error.problems).toHaveLength(1)
    expect(error.problems[0]?.kind).toBe('missing')
  })
})

describe('parseConfig - wrong types', () => {
  it('rejects an invalid NODE_ENV and states what was expected', () => {
    const error = captureError({ ...validEnv, NODE_ENV: 'banana' })
    const problem = error.problems.find((p) => p.variable === 'NODE_ENV')
    expect(problem?.kind).toBe('invalid')
    expect(problem?.expected).toBe("one of 'development' | 'test' | 'production'")
  })

  it('rejects an invalid LOG_LEVEL', () => {
    const error = captureError({ ...validEnv, LOG_LEVEL: 'shouty' })
    expect(error.problems.find((p) => p.variable === 'LOG_LEVEL')?.kind).toBe('invalid')
  })

  it('rejects a DATABASE_URL that is not a URL', () => {
    const error = captureError({ ...validEnv, DATABASE_URL: MALFORMED_DATABASE_URL })
    expect(error.problems.find((p) => p.variable === 'DATABASE_URL')?.kind).toBe('invalid')
  })

  it('rejects a DATABASE_URL with a non-postgres protocol', () => {
    const error = captureError({ ...validEnv, DATABASE_URL: WRONG_PROTOCOL_DATABASE_URL })
    expect(error.problems.find((p) => p.variable === 'DATABASE_URL')?.kind).toBe('invalid')
  })

  it('distinguishes an empty string from a missing variable', () => {
    const error = captureError({ ...validEnv, DATABASE_URL: '' })
    expect(error.problems[0]?.kind).toBe('invalid')
  })
})

// ---------------------------------------------------------------------------
// The security-critical block. Config validation is the first thing that runs
// at boot and its output goes straight to a deploy log, before any logger or
// redaction exists. A malformed DATABASE_URL still contains a password.
// ---------------------------------------------------------------------------
describe('parseConfig - secret values never reach the error output', () => {
  const malformedCases: readonly (readonly [string, string])[] = [
    ['not a URL at all', MALFORMED_DATABASE_URL],
    ['wrong protocol', WRONG_PROTOCOL_DATABASE_URL],
    ['empty string', ''],
    ['URL-shaped but unparseable', `postgres://[${PASSWORD}`],
  ]

  for (const [label, value] of malformedCases) {
    it(`does not echo the received value: ${label}`, () => {
      const error = captureError({ ...validEnv, DATABASE_URL: value })

      expect(error.message).not.toContain(PASSWORD)
      // An empty string is a substring of every string, so asserting that the
      // message does not contain it could never pass. The cases that actually
      // carry the password are asserted directly above and below.
      if (value !== '') expect(error.message).not.toContain(value)

      // The whole error object, not just the message - stack, problems, and
      // any property a crash reporter might serialise.
      const serialised = JSON.stringify({
        message: error.message,
        problems: error.problems,
        stack: error.stack,
      })
      expect(serialised).not.toContain(PASSWORD)
    })
  }

  it('does not echo a valid secret when a different variable fails', () => {
    const error = captureError({ ...validEnv, NODE_ENV: 'banana' })
    expect(error.message).not.toContain(PASSWORD)
    expect(JSON.stringify(error.problems)).not.toContain(PASSWORD)
  })

  it('reports the variable name and expectation, and nothing else', () => {
    const error = captureError({ ...validEnv, DATABASE_URL: MALFORMED_DATABASE_URL })
    expect(error.problems).toEqual([
      {
        variable: 'DATABASE_URL',
        kind: 'invalid',
        expected: 'a postgres:// or postgresql:// connection URL',
      },
    ])
  })
})

describe('parseConfig - the message a developer actually reads', () => {
  it('is legible at 3am', () => {
    const error = captureError({ NODE_ENV: 'banana' })

    // Asserted in full rather than by fragments: "clear" is a property of the
    // whole message, and a regression that makes it unreadable should fail.
    expect(error.message).toBe(
      [
        'Invalid environment configuration (2 problems)',
        '',
        '  NODE_ENV      invalid',
        '                expected: one of ' + "'development' | 'test' | 'production'",
        '  DATABASE_URL  missing',
        '                expected: a postgres:// or postgresql:// connection URL',
        '',
        'See .env.example for the full list of variables and their meaning.',
      ].join('\n'),
    )
  })
})
