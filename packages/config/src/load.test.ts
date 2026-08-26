import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConfigValidationError } from './errors'
import { loadConfig, resetConfigCache } from './load'

const PASSWORD = 'p4ssw0rd-should-never-be-printed'
const VALID_DATABASE_URL = `postgres://karatx:${PASSWORD}@localhost:5432/karatx`

// `loadConfig` is the one function here that reads process state, so these are
// the only tests that touch process.env. The original is restored afterwards so
// nothing leaks into other test files.
let original: NodeJS.ProcessEnv

beforeEach(() => {
  original = { ...process.env }
  resetConfigCache()
})

afterEach(() => {
  process.env = original
  resetConfigCache()
})

describe('loadConfig', () => {
  it('reads and validates process.env', () => {
    process.env['NODE_ENV'] = 'test'
    process.env['LOG_LEVEL'] = 'error'
    process.env['DATABASE_URL'] = VALID_DATABASE_URL

    const config = loadConfig()
    expect(config.nodeEnv).toBe('test')
    expect(config.logLevel).toBe('error')
    expect(config.databaseUrl.reveal()).toBe(VALID_DATABASE_URL)
  })

  it('caches, so configuration is stable for the life of the process', () => {
    process.env['DATABASE_URL'] = VALID_DATABASE_URL
    const first = loadConfig()
    const second = loadConfig()
    expect(second).toBe(first)
  })

  it('throws the same named error as parseConfig when the environment is bad', () => {
    delete process.env['DATABASE_URL']
    expect(() => loadConfig()).toThrow(ConfigValidationError)
  })

  it('does not leak the secret when process.env is malformed', () => {
    process.env['DATABASE_URL'] = `garbage-${PASSWORD}`
    try {
      loadConfig()
      throw new Error('expected loadConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError)
      expect((error as Error).message).not.toContain(PASSWORD)
    }
  })
})
