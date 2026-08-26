import { describe, expect, it } from 'vitest'

import { compareMigrations, shippedMigrations, type JournalEntry } from './status'

/**
 * Drift comparison, tested as pure logic with no database.
 *
 * These are the cases `/api/ready` reports on, and each corresponds to a real
 * deployment situation rather than an abstract permutation.
 */

const entry = (idx: number, when: number, tag: string): JournalEntry => ({ idx, when, tag })

const FIRST = entry(0, 1787673409928, '0000_init_system_events_and_config')
const SECOND = entry(1, 1787673500000, '0001_add_candles')

describe('compareMigrations', () => {
  it('reports in sync when the database has exactly what this build ships', () => {
    const status = compareMigrations([FIRST], [FIRST.when])

    expect(status.inSync).toBe(true)
    expect(status.appliedCount).toBe(1)
    expect(status.expectedCount).toBe(1)
    expect(status.pending).toEqual([])
    expect(status.unknown).toEqual([])
  })

  it('recovers the human-readable tag rather than reporting a hash', () => {
    // The database stores no migration name. The tag is recoverable because
    // Drizzle writes the journal entry's `when` into created_at.
    expect(compareMigrations([FIRST], [FIRST.when]).latestApplied).toBe(
      '0000_init_system_events_and_config',
    )
  })

  it('names the newest applied migration when several are applied', () => {
    const status = compareMigrations([FIRST, SECOND], [FIRST.when, SECOND.when])
    expect(status.latestApplied).toBe('0001_add_candles')
  })

  it('reports a pending migration - the deploy ran but db:migrate did not', () => {
    // The realistic failure: new code is live, its migration was never applied.
    const status = compareMigrations([FIRST, SECOND], [FIRST.when])

    expect(status.inSync).toBe(false)
    expect(status.pending).toEqual(['0001_add_candles'])
    expect(status.latestApplied).toBe('0000_init_system_events_and_config')
  })

  it('reports every pending migration, not just the first', () => {
    const third = entry(2, 1787673600000, '0002_add_zones')
    const status = compareMigrations([FIRST, SECOND, third], [FIRST.when])

    expect(status.pending).toEqual(['0001_add_candles', '0002_add_zones'])
  })

  it('reports an unknown migration - the database is AHEAD of this build', () => {
    // Happens on a rollback to an older image: the schema moved forward and
    // the code did not. Silence here would be the dangerous answer.
    const status = compareMigrations([FIRST], [FIRST.when, SECOND.when])

    expect(status.inSync).toBe(false)
    expect(status.unknown).toEqual([SECOND.when])
    expect(status.pending).toEqual([])
  })

  it('reports an entirely unmigrated database', () => {
    const status = compareMigrations([FIRST], [])

    expect(status.inSync).toBe(false)
    expect(status.appliedCount).toBe(0)
    expect(status.pending).toEqual(['0000_init_system_events_and_config'])
    expect(status.latestApplied).toBeUndefined()
  })

  it('is in sync when a build ships no migrations and none are applied', () => {
    expect(compareMigrations([], []).inSync).toBe(true)
  })

  it('does not depend on ordering of the applied timestamps', () => {
    const status = compareMigrations([FIRST, SECOND], [SECOND.when, FIRST.when])
    expect(status.inSync).toBe(true)
    expect(status.latestApplied).toBe('0001_add_candles')
  })
})

describe('shippedMigrations', () => {
  it('reads the committed journal', () => {
    const shipped = shippedMigrations()

    expect(shipped.length).toBeGreaterThan(0)
    expect(shipped[0]?.tag).toBe('0000_init_system_events_and_config')
  })

  it('gives every entry a tag and a timestamp', () => {
    // A journal entry missing either would make drift comparison meaningless
    // rather than merely wrong.
    for (const entryUnderTest of shippedMigrations()) {
      expect(typeof entryUnderTest.tag).toBe('string')
      expect(typeof entryUnderTest.when).toBe('number')
    }
  })
})
