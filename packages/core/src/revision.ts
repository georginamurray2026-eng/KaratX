/**
 * Classifying a re-delivered FINAL bar whose values differ from the stored one.
 *
 * MEASURED 2026-09-05, step 9: comparing two captures thirty minutes apart,
 * 1,983 overlapping bars, 1,979 byte-identical, FOUR revised. Three of the four
 * were WEEKDAY bars, so this is not confined to synthetic weekend data. Every
 * one moved `high` down or `low` up, and left `open` and `close` untouched.
 *
 * WHAT NARROWING DOES NOT TELL US, and this matters more than the definition.
 * It is CONSISTENT WITH a provider dropping outlier ticks and recomputing the
 * extremes. It is also consistent with a late-arriving correction from an
 * upstream venue, with a different tick filter being applied on re-read, and
 * with things nobody here has thought of. **The signature is a DESCRIPTION OF
 * WHAT WAS SEEN, NOT AN EXPLANATION**, and it must not harden into one. Four
 * observations is a shape noticed, not a mechanism established.
 *
 * That is why a narrowing revision is COUNTED AND RECORDED PER BAR rather than
 * tolerated by a threshold: the rate across a full backfill is the measurement
 * that would let someone judge whether 0.2% is stable or was a bad half-hour,
 * and no tolerance has to be chosen today to collect it.
 *
 * Pure - it compares two values and reads no clock, so `packages/core` is where
 * it belongs (F.3 invariant 1).
 */

/** The price fields of a bar, as text, exactly as the provider sent them. */
export interface RevisionSide {
  readonly open: string
  readonly high: string
  readonly low: string
  readonly close: string
  /** `null` when the provider sends none, which is every XAU/USD bar today. */
  readonly volume: string | null
}

export type RevisionKind =
  /** Nothing differs. Should not reach the classifier, but is answerable. */
  | 'identical'
  /**
   * The bar's RANGE contracted and nothing else moved: `high` non-increasing,
   * `low` non-decreasing, `open` `close` and `volume` unchanged, at least one
   * extreme actually moved, and the result is still structurally valid.
   */
  | 'narrowed'
  /** Anything else. A different claim about the bar, and not a tidied extreme. */
  | 'restated'

export interface RevisionClassification {
  readonly kind: RevisionKind
  /** Which fields differ, for the per-bar record. */
  readonly changed: readonly ('open' | 'high' | 'low' | 'close' | 'volume')[]
}

const FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const

/**
 * Are two price texts the SAME VALUE?
 *
 * COMPARED BY VALUE, NOT BY TEXT, and that is load-bearing rather than tidy.
 * The stored side comes back from `NUMERIC(12,5)`, which PADS TO SCALE: the
 * provider sends `4375.5959` and Postgres returns `4375.59590`. Those are the
 * same number and different strings, so a byte comparison would report every
 * single bar as changed and classify the whole backfill as restated.
 *
 * ADR-013 already says a formatting-only difference must not raise a conflict,
 * and meets that requirement INSIDE the database. This function is on the other
 * side of that boundary - provider text against stored text - so it has to meet
 * it again here.
 *
 * `Number()` is safe on this comparison in a way it is NOT safe on the values
 * themselves: nothing here is stored or forwarded, only compared, so float64
 * cannot corrupt anything downstream. The preserved text still goes to the
 * database untouched.
 */
function sameValue(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Number(a) === Number(b)
}

/**
 * Classify a revision.
 *
 * THE DEFINITION, and each clause is there for a reason rather than to fit the
 * four observations:
 *
 * - `high` NON-INCREASING and `low` NON-DECREASING. These are running extremes:
 *   over a fixed set of ticks the max can only fall and the min only rise when
 *   ticks are REMOVED. Movement the other way means ticks were ADDED, which is
 *   a bar growing, not being tidied.
 *
 * - `open` and `close` UNCHANGED. Neither is an extreme; each is one specific
 *   tick, the first and the last. A changed close is a different claim about
 *   where the bar ended, not a tidied outlier, and folding it in would
 *   pre-authorise a case never observed. **None of the four changed either.**
 *
 * - `volume` UNCHANGED. If ticks really were dropped, volume is the field that
 *   would show it - which makes it the most informative field here and the one
 *   we cannot see: **XAU/USD carries no volume on this feed, so this clause is
 *   STATED BUT VACUOUS.** Recorded so nobody reads its silence as agreement.
 *
 * - AT LEAST ONE EXTREME ACTUALLY MOVED, so `identical` is not reported as
 *   narrowing.
 *
 * - THE RESULT IS STILL STRUCTURALLY VALID. A narrowing that pushed `high`
 *   below `close` would be refused by `candles_high_check` anyway; classifying
 *   it as benign first would be a lie the database then contradicts.
 */
export function classifyRevision(
  stored: RevisionSide,
  incoming: RevisionSide,
): RevisionClassification {
  const changed = FIELDS.filter((f) => !sameValue(stored[f], incoming[f]))
  if (changed.length === 0) return { kind: 'identical', changed }

  const n = (v: string): number => Number(v)

  const extremesTightened = n(incoming.high) <= n(stored.high) && n(incoming.low) >= n(stored.low)
  const anchorsHeld =
    sameValue(stored.open, incoming.open) &&
    sameValue(stored.close, incoming.close) &&
    sameValue(stored.volume, incoming.volume)
  const somethingMoved =
    !sameValue(stored.high, incoming.high) || !sameValue(stored.low, incoming.low)
  const stillValid =
    n(incoming.high) >= n(incoming.low) &&
    n(incoming.high) >= n(incoming.open) &&
    n(incoming.high) >= n(incoming.close) &&
    n(incoming.low) <= n(incoming.open) &&
    n(incoming.low) <= n(incoming.close)

  return {
    kind:
      extremesTightened && anchorsHeld && somethingMoved && stillValid ? 'narrowed' : 'restated',
    changed,
  }
}
