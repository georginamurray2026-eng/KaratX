import { describe, expect, it } from 'vitest'

import {
  CANDLE_UPSERT_OUTCOMES,
  CANDLE_UPSERT_REFUSED,
  CANDLE_UPSERT_WROTE,
  CandleUpsertOutcome,
  candleUpsertRefused,
  candleUpsertWrote,
} from './ingestion'

describe('CandleUpsertOutcome', () => {
  it('accepts every declared outcome and rejects anything else', () => {
    for (const outcome of CANDLE_UPSERT_OUTCOMES) {
      expect(CandleUpsertOutcome.parse(outcome)).toBe(outcome)
    }
    expect(() => CandleUpsertOutcome.parse('updated')).toThrow()
    expect(() => CandleUpsertOutcome.parse('')).toThrow()
  })

  it('declares exactly the six cases ADR-013 settles', () => {
    // Pinned as a set, not a count. A future session adding a seventh outcome
    // must come here and think about which of the six it overlaps, rather than
    // discovering later that the SQL and this list disagree.
    expect([...CANDLE_UPSERT_OUTCOMES].sort()).toEqual([
      'applied',
      'conflict',
      'enriched',
      'inserted',
      'noop',
      'rejected',
    ])
  })

  it('partitions wrote/refused without overlap, and leaves noop in neither', () => {
    for (const outcome of CANDLE_UPSERT_WROTE) {
      expect(candleUpsertWrote(outcome)).toBe(true)
      expect(candleUpsertRefused(outcome)).toBe(false)
    }
    for (const outcome of CANDLE_UPSERT_REFUSED) {
      expect(candleUpsertRefused(outcome)).toBe(true)
      expect(candleUpsertWrote(outcome)).toBe(false)
    }
  })

  it('POSITIVE CONTROL: `noop` is in neither set, deliberately', () => {
    // Without this the partition test passes while `noop` sits in either set.
    // `noop` is the healthy result of ordinary duplicate delivery: counting it
    // as a write makes `updated_at` look touched, and counting it as a refusal
    // makes every re-delivery look like a feed problem.
    expect(candleUpsertWrote('noop')).toBe(false)
    expect(candleUpsertRefused('noop')).toBe(false)
  })

  it('every outcome is classified or deliberately unclassified', () => {
    // An outcome that is in neither set and is not `noop` is almost certainly
    // one someone added without deciding what it means.
    const unclassified = CANDLE_UPSERT_OUTCOMES.filter(
      (o) => !candleUpsertWrote(o) && !candleUpsertRefused(o),
    )
    expect(unclassified).toEqual(['noop'])
  })
})
