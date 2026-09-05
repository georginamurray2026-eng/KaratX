# OPEN QUESTIONS — T1.5, the detectors

Companion to [OPEN-QUESTIONS-T1.4.md](./OPEN-QUESTIONS-T1.4.md), same rule:
**every prediction here was committed before the run that tests it, and none is
edited afterwards.** The wrong ones are the useful half.

Detectors run against **166,344 stored 15min bars**, 2020-01-24 13:00Z to
2026-09-05 09:30Z. `1h` (1,911 bars, from 2026-06-15) and `1D` (1,449 bars,
UTC-day not session-day) are OUT OF SCOPE for the baseline.

---

## DECISIONS TAKEN BEFORE THE FIRST NUMBER EXISTS

Taken early on purpose. A severity or a threshold decided after the count is on
the screen is decided against that count, and the pull is toward whatever makes
it acceptable.

### D1. `missing_bar` is INFO throughout, not keyed on position

Not "info at baseline, warn at the frontier". **Severity keyed on
frontier-proximity would make the same fact change severity as time passes** — a
bar missing at 09:30 would be warn at 09:31 and info a week later, with nothing
about the bar having changed. That is a property of when you look, not of what
happened.

### D2. `stale_feed` is WARN, and the asymmetry is deliberate

**"The run is warn but its elements are info" looks wrong until it is
explained, so here is the explanation.** They are not the same claim at
different scales. They are different claims:

- **`missing_bar`** — the calendar and the feed disagree about ONE INSTANT.
  A statement about history, and about a calendar partly derived from that
  history. Self-consistent, therefore info.
- **`stale_feed`** — NOTHING IS ARRIVING NOW. An operational fact about the
  system, not a fact about the past, and not a calendar claim at all.

**The run is a different object from its elements.** A hundred bars missing in
2021 is a property of the archive. Nothing arriving in the last hour is a
property of the process, and it is the one an operator has to act on.

### D3. `implausible_gap` is ATR-RELATIVE, and it is not close

Gold trades near 4,635. **A percentage threshold is a dollar threshold in other
clothing** — fixed against a quantity that varies. A 0.5% move in a quiet 2020
session and 0.5% during a 2026 spike are different events, and only one of them
is implausible.

ATR-relative also survives the 2025 era change. **A percentage tuned on either
side of that boundary is wrong on the other**, and this repo has already made
that error four times in another form.

Fixed BEFORE the distribution is seen:

| Parameter | Value | Note |
|---|---|---|
| ATR period | **14 bars** | trailing, on the same timeframe as the scan |
| Multiplier | **8 x ATR** on the close-to-close move | deliberately loud; tightening later is a decision with evidence, loosening is a decision against a number |
| Where computed | `packages/core`, pure, from bars passed in | never SQL — one implementation, one answer |
| Closed boundaries | **excluded** | the ~345 weekly opens are calendar artifacts, not gaps |

**Bars with insufficient trailing history get an EXPLICIT answer, not a silent
skip.** The first 14 bars of the series — and the first 14 after any gap the
calendar says was a closure — have no ATR. They are **NOT scanned and NOT
reported as clean**. The run records the count of unscannable bars as its own
line in the report. A silent skip is how "we found nothing there" becomes
indistinguishable from "we never looked".

### D4. The structural three emit NOTHING — not a zero

`negative_price`, `high_below_low` and `close_outside_range` **cannot be
observed by a scan.** Rows violating them are rejected at INSERT by
`candles_positive_check`, `candles_high_check` and `candles_low_check`.

The report must say this in those words, because a reader who sees the
vocabulary but not the type has to find the reason without asking:

> **not run — rejected at insert by `candles_positive_check`,
> `candles_high_check`, `candles_low_check`; a scan cannot observe them.**

Emitting `0` would report that the CHECK constraints exist. They belong to the
INGESTION path, where a provider payload is validated before the upsert.

### D5. Revisions are OUT of the baseline, and the reason is a BIASED denominator

`candles` stores current values only. `updated_at > ingested_at` marks **50
rows**, but the prior values are gone and the predicate conflates *finalised*
with *prices revised*.

The only second observations anywhere are in T1.4's captures: `sum(barCount)`
across 51 pages is **166,443** against **166,344** stored — **99 duplicate
reads**, one per page boundary. **Four disagreed.**

**4-in-99 is not a 4% revision rate, and the reason is not sample size.** Those
99 bars are the ones re-read MINUTES APART AT PAGE BOUNDARIES — the most
recently-formed bars in each page, and therefore **the bars most likely to still
be settling**. They are the opposite of a random sample. **A biased denominator,
not merely a small one**, and extrapolating from it to 166,344 would be the
denominator pattern for a sixth time.

The capture comparison is deferred, not cancelled.

---

## PREDICTIONS — recorded before the baseline run

### OQ-13. Count per event type

| Event type | Prediction | Basis |
|---|---|---|
| `unexpected_bar` | **10,813**, tolerance 10,400–11,200 | the only figure on record: 9,645 weekly-closure + 1,168 daily-break |
| `missing_bar` | **3,225**, tolerance 2,750–3,700 | derived twice, below |
| `implausible_gap` | **50–250** at 8 x ATR(14) | genuine news events over 6.6 years, weekly opens excluded |
| `stale_feed` | **1** | frontier is 2026-09-05 09:30Z and nothing has polled since |
| revision types | **not run** | D5 |
| structural three | **not run** | D4 |

### OQ-13a. `missing_bar` — why 3,225 and not "900 to 3,000"

**The earlier plan said 900–3,000. That was a 3x range, and a range that wide
contains almost any result — a prediction that cannot be wrong is not a
measurement.** Sharpened before the run, by two independent derivations:

**Top-down, from figures already on record:**

```
expected OPEN slots   158,756   (460 bars/week x 345.1 weeks)
                                (460 = 5 spans of 23h, breaks removed)
stored bars in OPEN    155,531   (166,344 - 10,813 known closed-window bars)
missing_bar              3,225
```

**Bottom-up, from the era structure:**

```
Sunday-evening bars the weekday-only feed cannot have:
  Sun 18:00 NY = 23:00 UTC (EST, 4 bars) / 22:00 UTC (EDT, 8 bars)
  DST-weighted 6.6/week x 258 weekday-only weeks      1,705
residual                                              1,520
  = 2.5 full sessions/year of holiday + outage
                                                     ------
                                                      3,225
```

**The two agree, and the residual is structurally plausible** — `market_holidays`
is EMPTY, so Christmas and New Year read as ordinary sessions and their absent
bars are counted as missing. That is expected behaviour, not a fault.

**I expect the TOP of the old range because the old range was reasoned from the
Sunday-evening term alone and ignored the holiday residual**, which is nearly as
large.

**What would falsify it:** a result near 1,700 means holidays are being covered
by the feed after all. A result above 5,000 means the expected grid is wrong —
most likely DST, where the 23-hour span assumption breaks on the two transition
weeks a year.

---

## WHAT THE NUMBERS DO NOT MEAN

**The calendar's weekly-open boundary was corrected against THIS FEED in
migration 0004.** The detectors therefore run against the history the calendar
was derived from, and **agreement is self-consistency, not correctness.**

This travels **inside the event row**, not only here, so the number cannot be
quoted without it:

- `payload.basis` — the `market_hours` rule ids used, their `effective_from`,
  and the provenance sentence: boundaries from **Massive**, corrected against
  **Twelve Data** in migration 0004.
- `payload.self_consistent: true` on `unexpected_bar` and `missing_bar`.
  **Absent on `implausible_gap` and `stale_feed`**, which are not calendar
  claims — those two are the only baseline findings that carry independent
  information, and the report says so positively.
- The same sentence on the `job_runs` row, so it survives into logs.

**`payload` must contain nothing non-deterministic.** No timestamps, no run id.
The hash is the uniqueness key, so a run-varying payload turns every re-run into
12,000 new rows instead of 12,000 increments.

---

## OQ-14. Idempotency — the proof for the whole table

Recorded as a claim before it is tested. Second run, no new data:

| Quantity | After run 1 | After run 2 |
|---|---|---|
| `count(*)` | N | **N — identical** |
| `sum(occurrences)` | N | **2N** |
| `min(confirmed_at)` | t1 | **t1 — unchanged** |
| `max(last_seen_at)` | t1 | **t2 > t1** |

All four asserted, not just the count. **A stable count while `confirmed_at`
drifts would mean rows are being rewritten rather than incremented**, which
looks identical if only the count is checked.
