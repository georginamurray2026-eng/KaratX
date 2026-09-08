import { describe, expect, it } from 'vitest'

import {
  assertDecomposition,
  summariseAggregation,
  type AggregateRunReport,
  type TimeframeReport,
} from './aggregate'

/**
 * The job's PURE halves: the partition check and the report rendering.
 *
 * The orchestration is covered by `aggregate.integration.test.ts` against a real
 * database. These two are separated out because they are the parts a reader
 * will trust without running anything, and a report that misdescribes what it
 * checked is worse than no report.
 */

const timeframeReport = (over: Partial<TimeframeReport> = {}): TimeframeReport => ({
  timeframe: '1h',
  periodsExpected: 100,
  rowsProduced: 90,
  rowsWritten: 90,
  periodsRejectedForMissingConstituents: 10,
  unknownInstants: 0,
  unexpectedBarsExcluded: 0,
  expectsBarAtCalls: 1_000,
  aggregateMs: 5,
  writeMs: 7,
  chunks: 1,
  outcomes: { inserted: 90 },
  ...over,
})

const runReport = (over: Partial<AggregateRunReport> = {}): AggregateRunReport => ({
  dryRun: true,
  sourceProviderId: 1,
  derivedProviderId: 3,
  barsRead: 400,
  readMs: 12,
  readChunks: 2,
  perTimeframe: [timeframeReport()],
  totalExpectsBarAtCalls: 1_000,
  guardLookups: 0,
  wallClockMs: 30,
  peakRssBytes: 100 * 1024 * 1024,
  writeChunkSize: 500,
  ...over,
})

describe('assertDecomposition', () => {
  it('passes when every period is classified exactly once', () => {
    expect(() => {
      assertDecomposition(timeframeReport())
    }).not.toThrow()
  })

  it('THROWS when a period is classified twice - the double-count case', () => {
    // 90 produced + 11 rejected against 100 expected: one period counted in
    // both branches. This is one of only two failures this check can detect.
    expect(() => {
      assertDecomposition(timeframeReport({ periodsRejectedForMissingConstituents: 11 }))
    }).toThrow(/PERIOD PARTITION DOES NOT BALANCE/)
  })

  it('THROWS when a period is classified not at all - the dropped case', () => {
    expect(() => {
      assertDecomposition(timeframeReport({ periodsRejectedForMissingConstituents: 9 }))
    }).toThrow(/PERIOD PARTITION DOES NOT BALANCE/)
  })

  it('the message says the check proves NOTHING about whether the counts are right', () => {
    // The wording is asserted because it is the whole point of the correction.
    // A future session reading "BALANCES" must not take it for a correctness
    // result, and the failure message is where that is stated.
    expect(() => {
      assertDecomposition(timeframeReport({ rowsProduced: 89 }))
    }).toThrow(/says NOTHING about whether the\s+counts are right/)
  })

  it('partitions over rowsProduced, NOT rowsWritten - a re-run must not throw', () => {
    // THE BUG THIS PINS DOWN. On a second run over unchanged data every upsert
    // returns `noop`, so `wrote` is false and rowsWritten is 0 - which is
    // ADR-013 working correctly. Asserting over rowsWritten made the job throw
    // on its own idempotency.
    expect(() => {
      assertDecomposition(timeframeReport({ rowsWritten: 0, outcomes: { noop: 90 } }))
    }).not.toThrow()
  })
})

describe('summariseAggregation', () => {
  it('reports both rowsProduced and rowsWritten, because they differ on a re-run', () => {
    const text = summariseAggregation(
      runReport({ perTimeframe: [timeframeReport({ rowsWritten: 0, outcomes: { noop: 90 } })] }),
    )
    expect(text).toMatch(/rowsProduced\s+90/)
    expect(text).toMatch(/rowsWritten \(db reported wrote\)\s+0/)
  })

  it('LABELS the balance as a partition identity, not as a correctness check', () => {
    // Proven by mutation in review: with the caveat lines deleted, the summary
    // reads "PERIOD PARTITION 100 == 90 + 10 BALANCES" and nothing else, which
    // is exactly the reading the correction exists to prevent.
    const text = summariseAggregation(runReport())
    expect(text).toMatch(/PERIOD PARTITION\s+100 == 90 \+ 10 = 100\s+BALANCES/)
    expect(text).toMatch(/PARTITION IDENTITY over one map, NOT a correctness check/)
    expect(text).toMatch(/It catches a period classified twice or/)
    expect(text).toMatch(/drop a constituent, and periodsExpected must NOT move/)
  })

  it('names the resolved provider ids rather than assuming them', () => {
    const text = summariseAggregation(runReport({ derivedProviderId: 7 }))
    expect(text).toMatch(/karatx_derived -> id 7/)
    expect(text).toMatch(/twelve_data -> id 1/)
  })

  it('reports the figures the predictions are scored against', () => {
    const text = summariseAggregation(
      runReport({
        totalExpectsBarAtCalls: 464_062,
        guardLookups: 40_359,
        perTimeframe: [timeframeReport({ unexpectedBarsExcluded: 10_813, unknownInstants: 72 })],
      }),
    )
    expect(text).toMatch(/expectsBarAt calls, BOTH timeframes\s+464,062/)
    expect(text).toMatch(/raw_datetime guard lookups\s+40,359/)
    expect(text).toMatch(/unexpectedBarsExcluded\s+10,813/)
    expect(text).toMatch(/unknownInstants\s+72/)
    expect(text).toMatch(/peak RSS\s+100\.0 MB/)
    expect(text).toMatch(/write chunk size\s+500/)
  })

  it('says DOES NOT BALANCE when it does not, rather than only when it does', () => {
    // The positive control for the balance line: a renderer hard-coding
    // "BALANCES" would pass every test above.
    const text = summariseAggregation(
      runReport({ perTimeframe: [timeframeReport({ rowsProduced: 89 })] }),
    )
    expect(text).toMatch(/DOES NOT BALANCE/)
  })
})
