import { describe, expect, it } from 'vitest'

import { classifyRevision, type RevisionSide } from './revision'

function bar(o: Partial<RevisionSide> = {}): RevisionSide {
  return {
    open: '4600.00000',
    high: '4610.00000',
    low: '4590.00000',
    close: '4605.00000',
    volume: null,
    ...o,
  }
}

/**
 * THE FOUR REVISIONS ACTUALLY OBSERVED, from the step 9 capture comparison.
 *
 * Verbatim, so the definition is checked against the observations rather than
 * the observations against the definition. If one of these ever stops
 * classifying as `narrowed`, THE DEFINITION CHANGED and that is the finding.
 */
const OBSERVED = [
  {
    at: '2026-08-15 21:15 (weekend)',
    stored: bar({ open: '4375.5959', high: '4379.85286', low: '4375.53231', close: '4375.67666' }),
    incoming: bar({
      open: '4375.5959',
      high: '4375.79166',
      low: '4375.53231',
      close: '4375.67666',
    }),
    field: 'high',
  },
  {
    at: '2026-08-26 13:00 (weekday)',
    stored: bar({ open: '4617.16302', high: '4621.92642', low: '4605.22464', close: '4610.48705' }),
    incoming: bar({
      open: '4617.16302',
      high: '4621.92642',
      low: '4608.92659',
      close: '4610.48705',
    }),
    field: 'low',
  },
  {
    at: '2026-09-01 06:30 (weekday)',
    stored: bar({ open: '4433.68868', high: '4438.39980', low: '4429.61794', close: '4434.60556' }),
    incoming: bar({
      open: '4433.68868',
      high: '4437.27763',
      low: '4429.61794',
      close: '4434.60556',
    }),
    field: 'high',
  },
  {
    at: '2026-09-01 06:45 (weekday)',
    stored: bar({ open: '4434.36196', high: '4438.80563', low: '4428.50184', close: '4430.44634' }),
    incoming: bar({
      open: '4434.36196',
      high: '4435.41653',
      low: '4428.50184',
      close: '4430.44634',
    }),
    field: 'high',
  },
]

describe('classifyRevision - against the four revisions actually observed', () => {
  it.each(OBSERVED)('$at classifies as narrowed', ({ stored, incoming, field }) => {
    const result = classifyRevision(stored, incoming)
    expect(result.kind).toBe('narrowed')
    expect(result.changed).toEqual([field])
  })

  it('all four changed exactly ONE extreme and left open and close alone', () => {
    // The property that made the definition strict rather than permissive. If a
    // future observation changes close as well, that is a NEW case to classify,
    // not a reason to widen this one.
    for (const { stored, incoming } of OBSERVED) {
      expect(stored.open).toBe(incoming.open)
      expect(stored.close).toBe(incoming.close)
      expect(classifyRevision(stored, incoming).changed).toHaveLength(1)
    }
  })
})

describe('classifyRevision - what is NOT narrowing', () => {
  it('a WIDENING high is a restatement', () => {
    // Ticks added, not removed. A bar growing is not a bar being tidied.
    expect(classifyRevision(bar(), bar({ high: '4620.00000' })).kind).toBe('restated')
  })

  it('a FALLING low is a restatement', () => {
    expect(classifyRevision(bar(), bar({ low: '4580.00000' })).kind).toBe('restated')
  })

  it('a changed CLOSE is a restatement, even inside the narrowed range', () => {
    // The question asked explicitly. Close is not an extreme - it is one
    // specific tick, the last - so a changed close is a different claim about
    // where the bar ended. Narrowing high AND moving close is still restated.
    expect(classifyRevision(bar(), bar({ high: '4608.00000', close: '4604.00000' })).kind).toBe(
      'restated',
    )
  })

  it('a changed OPEN is a restatement', () => {
    expect(classifyRevision(bar(), bar({ high: '4608.00000', open: '4601.00000' })).kind).toBe(
      'restated',
    )
  })

  it('a changed VOLUME is a restatement — the clause that is vacuous today', () => {
    // XAU/USD carries no volume on this feed, so this never fires in practice.
    // It is here because volume is the field that would SHOW ticks being
    // dropped, and its silence must not read as agreement.
    expect(
      classifyRevision(bar({ volume: '100' }), bar({ volume: '90', high: '4608.00000' })).kind,
    ).toBe('restated')
  })

  it('a narrowing that would make the bar INVALID is a restatement', () => {
    // high pushed below close. candles_high_check would refuse it anyway;
    // calling it benign first would be a lie the database then contradicts.
    expect(classifyRevision(bar(), bar({ high: '4600.00000' })).kind).toBe('restated')
  })

  it('identical bars are `identical`, not narrowed', () => {
    expect(classifyRevision(bar(), bar()).kind).toBe('identical')
  })

  it('CONTROL: a clean narrowing of BOTH extremes at once is narrowed', () => {
    // Never observed - all four moved exactly one extreme - but it satisfies
    // every clause, so the definition must accept it. Recorded as a case the
    // rule permits rather than one the data showed.
    expect(classifyRevision(bar(), bar({ high: '4608.00000', low: '4592.00000' })).kind).toBe(
      'narrowed',
    )
  })
})

describe('classifyRevision - NUMERIC padding must not look like a change', () => {
  it('treats 4375.5959 and 4375.59590 as the same value', () => {
    // The stored side comes back from NUMERIC(12,5), which pads to scale. A
    // byte comparison would report EVERY bar as changed and classify the whole
    // backfill as restated. Measured on the real row: stored 4375.59590 against
    // provider 4375.5959.
    const stored = bar({
      open: '4375.59590',
      high: '4379.85286',
      low: '4375.53231',
      close: '4375.67666',
    })
    const provider = bar({
      open: '4375.5959',
      high: '4379.85286',
      low: '4375.53231',
      close: '4375.67666',
    })

    expect(classifyRevision(stored, provider).kind).toBe('identical')
    expect(classifyRevision(stored, provider).changed).toEqual([])
  })

  it('the real revision is still narrowed once padding is accounted for', () => {
    // Same bar, but with the high genuinely revised. Padding on the untouched
    // fields must not turn a one-field narrowing into a four-field restatement.
    const stored = bar({
      open: '4375.59590',
      high: '4379.85286',
      low: '4375.53231',
      close: '4375.67666',
    })
    const provider = bar({
      open: '4375.5959',
      high: '4375.79166',
      low: '4375.53231',
      close: '4375.67666',
    })

    const result = classifyRevision(stored, provider)
    expect(result.kind).toBe('narrowed')
    expect(result.changed).toEqual(['high'])
  })
})
