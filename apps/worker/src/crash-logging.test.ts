import { DatabaseError } from '@karatx/core'
import { createLogger } from '@karatx/providers'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import { installCrashLogging } from './crash-logging'

/**
 * Crash logging: one structured line, then Node's own behaviour, unchanged.
 *
 * The handlers are reached through `process.listeners` rather than by actually
 * crashing the test runner. Calling the registered listener directly is what
 * makes the rethrow assertable - and the rethrow is the whole safety property,
 * because a handler that returns normally SUPPRESSES the exit and leaves the
 * process running in an unknown state.
 */

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk.toString())
      callback()
    },
  })

  return {
    stream,
    lines: (): Record<string, unknown>[] =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

let uninstall: (() => void) | undefined

afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

function install(stream: Writable): {
  uncaught: (error: unknown) => unknown
  unhandled: (reason: unknown) => unknown
} {
  const before = {
    uncaught: new Set(process.listeners('uncaughtException')),
    unhandled: new Set(process.listeners('unhandledRejection')),
  }

  const logger = createLogger({ level: 'trace', name: 'worker', destination: stream })
  uninstall = installCrashLogging(logger)

  const uncaught = process.listeners('uncaughtException').find((fn) => !before.uncaught.has(fn))
  const unhandled = process.listeners('unhandledRejection').find((fn) => !before.unhandled.has(fn))

  if (uncaught === undefined || unhandled === undefined) {
    throw new Error('installCrashLogging did not register both handlers')
  }

  return {
    uncaught: uncaught as (error: unknown) => unknown,
    unhandled: unhandled as (reason: unknown) => unknown,
  }
}

describe('an uncaught exception', () => {
  it('RETHROWS, so Node still terminates the process', () => {
    // Installing a handler is what disables Node's default. Returning normally
    // from here would leave a crashed worker alive and serving nothing - the
    // T0.7 failure mode, reintroduced by the code meant to make crashes
    // visible.
    const { stream } = capture()
    const { uncaught } = install(stream)
    const error = new Error('boom')

    expect(() => uncaught(error)).toThrow(error)
  })

  it('emits one fatal JSON line carrying the taxonomy', () => {
    // The reason these handlers exist at all: Node's default prints a stack
    // trace to stderr, which reaches an aggregator as unparseable plain text.
    const { stream, lines } = capture()
    const { uncaught } = install(stream)

    expect(() => uncaught(new DatabaseError('connection lost'))).toThrow()

    const [line] = lines()
    expect(line).toMatchObject({
      level: 60,
      name: 'worker',
      msg: 'uncaught exception',
      policy: 'alert',
    })
    expect(line?.['err']).toMatchObject({
      type: 'DatabaseError',
      category: 'database',
      message: 'connection lost',
    })
  })

  it('classifies an unclassified throw rather than dropping it', () => {
    const { stream, lines } = capture()
    const { uncaught } = install(stream)

    expect(() => uncaught('a bare string')).toThrow()

    expect(lines()[0]).toMatchObject({ policy: 'alert' })
    expect(lines()[0]?.['err']).toMatchObject({ type: 'UnexpectedError' })
  })
})

describe('an unhandled rejection', () => {
  it('RETHROWS, so Node still terminates the process', () => {
    const { stream } = capture()
    const { unhandled } = install(stream)
    const reason = new Error('rejected')

    expect(() => unhandled(reason)).toThrow(reason)
  })

  it('emits one fatal JSON line', () => {
    const { stream, lines } = capture()
    const { unhandled } = install(stream)

    expect(() => unhandled(new Error('rejected'))).toThrow()

    expect(lines()[0]).toMatchObject({ level: 60, msg: 'unhandled rejection' })
  })
})

describe('uninstalling', () => {
  it('removes both handlers, so tests do not leak listeners into each other', () => {
    const { stream } = capture()
    const beforeUncaught = process.listeners('uncaughtException').length
    const beforeUnhandled = process.listeners('unhandledRejection').length

    install(stream)
    expect(process.listeners('uncaughtException')).toHaveLength(beforeUncaught + 1)

    uninstall?.()
    uninstall = undefined

    expect(process.listeners('uncaughtException')).toHaveLength(beforeUncaught)
    expect(process.listeners('unhandledRejection')).toHaveLength(beforeUnhandled)
  })
})
