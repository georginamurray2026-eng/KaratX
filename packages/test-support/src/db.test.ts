import { describe, expect, it } from 'vitest'

import {
  MAX_IDENTIFIER_BYTES,
  STALE_AFTER_MS,
  adminUrl,
  databaseNameFromUrl,
  formatTimestamp,
  isStale,
  makeTestDatabaseName,
  parseTestDatabaseTimestamp,
  testDatabasePattern,
  withDatabase,
} from './db.js'

/**
 * The safety rules, tested without a database.
 *
 * Everything here decides whether a DROP DATABASE happens. These are pure
 * functions precisely so the rules can be exhaustively tested with no server
 * involved and nothing at risk.
 */

const BASE = 'karatx'
const NOW = new Date('2026-08-26T17:08:00.000Z')
const VALID = 'karatx_test_20260826T170800Z_a3f9c1'

describe('name construction', () => {
  it('builds the agreed shape', () => {
    expect(makeTestDatabaseName(BASE, NOW, 'a3f9c1')).toBe(VALID)
  })

  it('generates a random suffix when none is supplied', () => {
    const a = makeTestDatabaseName(BASE, NOW)
    const b = makeTestDatabaseName(BASE, NOW)
    // Two runs can start in the same second; the timestamp alone is not unique.
    expect(a).not.toBe(b)
    expect(testDatabasePattern(BASE).test(a)).toBe(true)
  })

  it('formats the timestamp in UTC', () => {
    expect(formatTimestamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z')
  })

  it('throws rather than letting Postgres truncate an over-long name', () => {
    // A truncated identifier could collide with another run's database.
    const longBase = 'x'.repeat(MAX_IDENTIFIER_BYTES)
    expect(() => makeTestDatabaseName(longBase, NOW, 'a3f9c1')).toThrow(/identifier limit/)
  })
})

describe('the anchored pattern', () => {
  it('accepts a name this scheme generated', () => {
    expect(testDatabasePattern(BASE).test(VALID)).toBe(true)
  })

  it.each([
    ['the development database', 'karatx'],
    ['the maintenance database', 'postgres'],
    ['a template', 'template1'],
    ['T0.4-style suffix only', 'karatx_test'],
    // The reason the pattern replaced `endsWith('_test')`: that check would
    // have accepted this.
    ['a production database ending in _test', 'production_test'],
    ['right shape, wrong base', 'other_test_20260826T170800Z_a3f9c1'],
    ['uppercase hex', 'karatx_test_20260826T170800Z_A3F9C1'],
    ['too few hex characters', 'karatx_test_20260826T170800Z_a3f9c'],
    ['missing the Z', 'karatx_test_20260826T170800_a3f9c1'],
    ['a prefix match with a trailing segment', 'karatx_test_20260826T170800Z_a3f9c1_extra'],
    ['a prefix of a valid name', 'karatx_test_20260826T170800Z'],
  ])('rejects %s', (_label, name) => {
    expect(testDatabasePattern(BASE).test(name)).toBe(false)
  })
})

describe('timestamp recovery', () => {
  it('recovers the creation time', () => {
    expect(parseTestDatabaseTimestamp(BASE, VALID)?.toISOString()).toBe('2026-08-26T17:08:00.000Z')
  })

  it('returns undefined for a name that is not ours', () => {
    expect(parseTestDatabaseTimestamp(BASE, 'karatx')).toBeUndefined()
  })

  it('rejects an impossible date rather than rolling it forward', () => {
    // Date.UTC would turn 31 February into 3 March. The round-trip check
    // catches it, so an unparseable name stays unrecognised.
    expect(parseTestDatabaseTimestamp(BASE, 'karatx_test_20260231T000000Z_a3f9c1')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The rule that decides whether anything is destroyed.
// ---------------------------------------------------------------------------
describe('isStale - the sweep decision', () => {
  const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs)
  const nameAt = (date: Date): string => makeTestDatabaseName(BASE, date, 'a3f9c1')

  it('is true for a database older than 24 hours', () => {
    const old = nameAt(at(-STALE_AFTER_MS - 60_000))
    expect(isStale(BASE, old, NOW)).toBe(true)
  })

  it('is false at exactly 24 hours', () => {
    // Strictly older than, so the boundary is not stale.
    expect(isStale(BASE, nameAt(at(-STALE_AFTER_MS)), NOW)).toBe(false)
  })

  it('is false for a database created moments ago', () => {
    // The condition that stops one run destroying another run's database
    // while it is still in use.
    expect(isStale(BASE, nameAt(at(-5_000)), NOW)).toBe(false)
  })

  it('is false for a FUTURE-dated database', () => {
    // The name carries a timestamp written by another machine's clock - CI
    // versus local. A future date means the clocks disagree, and a wrong clock
    // is a reason to leave a database alone, not to delete it.
    const future = nameAt(at(48 * 60 * 60 * 1000))
    expect(isStale(BASE, future, NOW)).toBe(false)
  })

  it('is false for a future-dated database that is also very old by wall clock', () => {
    // Guards against an implementation using Math.abs on the age.
    expect(isStale(BASE, nameAt(at(STALE_AFTER_MS * 10)), NOW)).toBe(false)
  })

  it.each([
    ['the development database', 'karatx'],
    ['the maintenance database', 'postgres'],
    ['a template', 'template0'],
    ['production_test', 'production_test'],
    ['an unparseable timestamp', 'karatx_test_notadate_a3f9c1'],
    ['an impossible date', 'karatx_test_20260231T000000Z_a3f9c1'],
    ['an unrelated database', 'someone_elses_data'],
  ])('is false for %s - unrecognised means untouched', (_label, name) => {
    expect(isStale(BASE, name, NOW)).toBe(false)
  })
})

describe('URL helpers', () => {
  const URL_BASE = 'postgres://karatx:pw@127.0.0.1:5432/karatx'

  it('reads the database name', () => {
    expect(databaseNameFromUrl(URL_BASE)).toBe('karatx')
  })

  it('points the same connection at another database', () => {
    expect(withDatabase(URL_BASE, VALID)).toContain(`/${VALID}`)
  })

  it('builds a maintenance URL against postgres', () => {
    // CREATE/DROP DATABASE cannot run from inside the database concerned.
    expect(databaseNameFromUrl(adminUrl(URL_BASE))).toBe('postgres')
  })

  it('preserves credentials and host when switching database', () => {
    const switched = new URL(withDatabase(URL_BASE, VALID))
    expect(switched.hostname).toBe('127.0.0.1')
    expect(switched.port).toBe('5432')
    expect(switched.username).toBe('karatx')
  })
})
