import { Writable } from 'node:stream'

import { DatabaseError, NetworkError, ProviderError } from '@karatx/core'
import { describe, expect, it } from 'vitest'

import { withCorrelationId } from './correlation'
import { createLogger, type Logger } from './logger'
import { MIN_SECRET_LENGTH } from './redact'

/**
 * Every assertion below parses real Pino output captured from a stream. T0.5's
 * risk note is explicit: "logging secrets is the classic mistake - test the
 * redaction, don't assume it". A mocked logger would prove nothing about what
 * Pino actually writes.
 */

// Password-shaped test values. Not real credentials; they exist so the
// assertions can prove they never reach the output.
const PASSWORD = 'p4ssw0rd-should-never-be-printed'
const DATABASE_URL = `postgres://karatx:${PASSWORD}@db.internal:5432/karatx`

interface Captured {
  logger: Logger
  lines: () => Record<string, unknown>[]
  raw: () => string
}

function capture(secrets: readonly string[] = [DATABASE_URL, PASSWORD]): Captured {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString())
      callback()
    },
  })

  const logger = createLogger({ level: 'trace', name: 'test', secrets, destination })

  return {
    logger,
    raw: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('structured JSON output (NFR-6)', () => {
  it('writes one parseable JSON object per line', () => {
    const { logger, lines } = capture()
    logger.info('first')
    logger.warn('second')

    const parsed = lines()
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.['msg']).toBe('first')
    expect(parsed[1]?.['msg']).toBe('second')
  })

  it('includes level, time and the process name', () => {
    const { logger, lines } = capture()
    logger.info('hello')

    const line = lines()[0]
    expect(line?.['level']).toBe(30)
    expect(typeof line?.['time']).toBe('number')
    expect(line?.['name']).toBe('test')
  })

  it('respects the configured level', () => {
    const chunks: string[] = []
    const destination = new Writable({
      write(chunk: Buffer, _e, cb): void {
        chunks.push(chunk.toString())
        cb()
      },
    })
    const logger = createLogger({ level: 'warn', destination })

    logger.debug('should not appear')
    logger.info('should not appear')
    logger.warn('should appear')

    const lines = chunks.join('').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect((JSON.parse(lines[0] ?? '{}') as Record<string, unknown>)['msg']).toBe('should appear')
  })
})

// ---------------------------------------------------------------------------
// Layer 2: redaction by field name.
// ---------------------------------------------------------------------------
describe('redaction layer 2 - fields named like secrets', () => {
  it('redacts a top-level password field', () => {
    const { logger, lines, raw } = capture()
    logger.info({ password: PASSWORD }, 'connecting')

    expect(lines()[0]?.['password']).toBe('[REDACTED]')
    expect(raw()).not.toContain(PASSWORD)
  })

  it.each([
    ['token', 'token'],
    ['apiKey', 'apiKey'],
    ['authorization', 'authorization'],
    ['connectionString', 'connectionString'],
    ['databaseUrl', 'databaseUrl'],
    ['DATABASE_URL', 'DATABASE_URL'],
  ])('redacts the %s field', (_label, field) => {
    const { logger, lines, raw } = capture()
    logger.info({ [field]: PASSWORD }, 'msg')

    expect(lines()[0]?.[field]).toBe('[REDACTED]')
    expect(raw()).not.toContain(PASSWORD)
  })

  it('redacts one level of nesting', () => {
    const { logger, raw } = capture()
    logger.info({ db: { password: PASSWORD } }, 'msg')
    expect(raw()).not.toContain(PASSWORD)
    expect(raw()).toContain('[REDACTED]')
  })

  it('does not mangle ordinary text that merely mentions a secret-ish word', () => {
    // The negative control. A rule that redacts everything is enforcing
    // nothing useful - it just makes logs unreadable.
    const { logger, lines } = capture([])
    logger.info({ note: 'the user forgot their password' }, 'password reset requested')

    expect(lines()[0]?.['note']).toBe('the user forgot their password')
    expect(lines()[0]?.['msg']).toBe('password reset requested')
  })
})

// ---------------------------------------------------------------------------
// Layer 3: known secret values embedded inside strings.
// This is the leak path layers 1 and 2 cannot see.
// ---------------------------------------------------------------------------
describe('redaction layer 3 - secrets embedded in free text', () => {
  it('scrubs a connection string from the log message', () => {
    const { logger, lines, raw } = capture()
    logger.info(`connecting to ${DATABASE_URL}`)

    expect(raw()).not.toContain(PASSWORD)
    expect(lines()[0]?.['msg']).toBe('connecting to [REDACTED]')
  })

  it('scrubs a secret from an error message', () => {
    // The realistic case: pg embeds the connection string in its error.
    const { logger, raw } = capture()
    logger.error({ err: new Error(`connect ECONNREFUSED for ${DATABASE_URL}`) }, 'db down')

    expect(raw()).not.toContain(PASSWORD)
    expect(raw()).toContain('[REDACTED]')
  })

  it('scrubs a secret from an error stack', () => {
    const { logger, raw } = capture()
    const error = new Error('boom')
    error.stack = `Error: boom\n    at connect (${DATABASE_URL})\n    at run (file.ts:1:1)`

    logger.error({ err: error }, 'failed')

    expect(raw()).not.toContain(PASSWORD)
    expect(raw()).toContain('[REDACTED]')
  })

  it('scrubs a secret nested in a wrapped cause', () => {
    const { logger, raw } = capture()
    const root = new Error(`auth failed for ${DATABASE_URL}`)
    const wrapped = new DatabaseError('could not store candle', { cause: root })

    logger.error({ err: wrapped }, 'ingest failed')

    expect(raw()).not.toContain(PASSWORD)
  })

  it('leaves text alone when no secret is registered', () => {
    const { logger, lines } = capture([])
    logger.info('connecting to postgres://user@host/db')
    expect(lines()[0]?.['msg']).toBe('connecting to postgres://user@host/db')
  })

  it('refuses to register a secret short enough to corrupt ordinary logs', () => {
    // An empty or very short "secret" would match everywhere, silently
    // destroying every log line. Failing loudly is the only safe behaviour.
    expect(() => createLogger({ level: 'info', secrets: ['abc'] })).toThrow(
      new RegExp(`shorter than ${String(MIN_SECRET_LENGTH)}`),
    )
  })

  it('does not leak the offending value in that refusal', () => {
    try {
      createLogger({ level: 'info', secrets: ['tiny'] })
      throw new Error('expected createLogger to throw')
    } catch (error) {
      expect((error as Error).message).not.toContain('tiny')
    }
  })
})

// ---------------------------------------------------------------------------
// Error serialisation carries the taxonomy.
// ---------------------------------------------------------------------------
describe('error serialisation', () => {
  it('records category and policy alongside the message', () => {
    const { logger, lines } = capture()
    logger.error({ err: new ProviderError('rate limited') }, 'provider call failed')

    const err = lines()[0]?.['err'] as Record<string, unknown>
    expect(err['type']).toBe('ProviderError')
    expect(err['message']).toBe('rate limited')
    expect(err['category']).toBe('provider')
    expect(err['policy']).toBe('retry')
  })

  it('reports the outermost classification for a wrapped error', () => {
    const { logger, lines } = capture()
    const wrapped = new ProviderError('fetch failed', { cause: new NetworkError('ECONNRESET') })

    logger.error({ err: wrapped }, 'failed')

    const err = lines()[0]?.['err'] as Record<string, unknown>
    expect(err['category']).toBe('provider')
    const cause = err['cause'] as Record<string, unknown>
    expect(cause['type']).toBe('NetworkError')
    expect(cause['category']).toBe('network')
  })

  it('includes structured context when present', () => {
    const { logger, lines } = capture()
    logger.error({ err: new DatabaseError('duplicate key', { context: { code: '23505' } }) }, 'x')

    const err = lines()[0]?.['err'] as Record<string, unknown>
    expect(err['context']).toEqual({ code: '23505' })
  })

  it('classifies a plain Error as unexpected rather than omitting the field', () => {
    const { logger, lines } = capture()
    logger.error({ err: new Error('something') }, 'x')

    const err = lines()[0]?.['err'] as Record<string, unknown>
    expect(err['category']).toBe('unexpected')
    expect(err['policy']).toBe('alert')
  })

  it('handles a thrown non-Error, which JavaScript permits', () => {
    const { logger, lines } = capture()
    logger.error({ err: 'just a string' }, 'x')

    const err = lines()[0]?.['err'] as Record<string, unknown>
    expect(err['message']).toBe('just a string')
  })
})

// ---------------------------------------------------------------------------
// Correlation IDs.
// ---------------------------------------------------------------------------
describe('correlation IDs', () => {
  it('attaches the ambient correlation ID without the call site passing it', () => {
    const { logger, lines } = capture()

    withCorrelationId('req-123', () => {
      logger.info('inside')
    })

    expect(lines()[0]?.['correlationId']).toBe('req-123')
  })

  it('omits the field entirely outside any correlated scope', () => {
    const { logger, lines } = capture()
    logger.info('outside')
    expect(lines()[0]).not.toHaveProperty('correlationId')
  })

  it('survives await boundaries', async () => {
    // The reason for AsyncLocalStorage rather than a plain variable: the
    // worker's chains are asynchronous throughout.
    const { logger, lines } = capture()

    await withCorrelationId('async-1', async () => {
      await Promise.resolve()
      logger.info('after one await')
      await new Promise((resolve) => setTimeout(resolve, 1))
      logger.info('after a timer')
    })

    const parsed = lines()
    expect(parsed[0]?.['correlationId']).toBe('async-1')
    expect(parsed[1]?.['correlationId']).toBe('async-1')
  })

  it('keeps concurrent scopes separate', async () => {
    // Two overlapping operations must not borrow each other's ID.
    const { logger, lines } = capture()

    await Promise.all([
      withCorrelationId('a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        logger.info('from a')
      }),
      withCorrelationId('b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        logger.info('from b')
      }),
    ])

    const byMessage = new Map(lines().map((l) => [l['msg'], l['correlationId']]))
    expect(byMessage.get('from a')).toBe('a')
    expect(byMessage.get('from b')).toBe('b')
  })

  it('restores the outer ID after a nested scope ends', () => {
    const { logger, lines } = capture()

    withCorrelationId('outer', () => {
      logger.info('before')
      withCorrelationId('inner', () => {
        logger.info('nested')
      })
      logger.info('after')
    })

    const ids = lines().map((l) => l['correlationId'])
    expect(ids).toEqual(['outer', 'inner', 'outer'])
  })
})
