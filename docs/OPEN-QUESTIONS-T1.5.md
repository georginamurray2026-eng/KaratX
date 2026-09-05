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

## OQ-13b. CORRECTION to OQ-13a, before the run — the reasoning was wrong and one half of it was circular

**OQ-13a above is left exactly as written.** This section corrects it. Editing a
prediction in place would destroy the only thing that makes the file worth
keeping.

### The Sunday-evening term is FALSIFIED, and it was the dominant one

OQ-13a claimed **1,705 missing Sunday-evening bars**, on the reasoning that the
"weekday-only before 2025" feed cannot have bars at Sunday 18:00 NY, which falls
on a UTC Sunday.

**Measured instead of assumed, and it is wrong.** Sunday-evening bars, by year,
where the calendar expects 24 per Sunday (18:00 to midnight NY):

| year | Sundays with evening bars | bars | per Sunday |
|---|---|---|---|
| 2020 | 49 | 1,176 | **24.0** |
| 2021 | 51 | 1,214 | 23.8 |
| 2022 | 51 | 1,224 | **24.0** |
| 2023 | 49 | 1,168 | 23.8 |
| 2024 | 52 | 1,185 | 22.8 |
| 2025 | 52 | 1,248 | **24.0** |
| 2026 | 35 | 840 | **24.0** |

**The feed delivers Sunday evenings in every year, essentially complete.**
"Weekday-only before 2025" does NOT mean "no bars on a UTC Sunday" — it means no
Saturday and no Sunday DAYTIME. The feed was already following the session
calendar closely. **The Sunday-evening contribution to `missing_bar` is near
zero, not 1,705.**

### And the "independent cross-check" was CIRCULAR

OQ-13a presents two derivations that "agree" at 3,225. **They cannot have
disagreed.** The top-down figure was computed first from measured totals. The
bottom-up figure was 1,705 Sunday bars **plus a residual DEFINED AS
3,225 − 1,705 = 1,520**, then described as "2.5 sessions/year of holiday and
outage" as if that were a finding.

**A cross-check whose free parameter is fitted to the thing it checks is not a
cross-check.** It is the first number written twice. The agreement carried no
information and I presented it as confirmation.

### What survives, and what the prediction now is

**The point estimate is UNCHANGED at 3,225**, because the top-down derivation
never depended on the Sunday reasoning:

```
expected OPEN slots   158,756   (460/week x 345.1 weeks)
stored bars in OPEN   155,531   (166,344 - 10,813)
missing_bar             3,225
```

**What is gone is any account of its COMPOSITION.** The Sunday term is ~0, the
1,520 residual was never measured, and the true breakdown is unknown until the
detector runs. Holidays are the obvious candidate — `market_holidays` is empty —
but that is now a hypothesis rather than a quantity.

**The falsifier is replaced.** "~1,700 means holidays are covered after all" is
meaningless now that the Sunday term is known to be ~0. The new falsifier:

- **near 3,225** — confirms the arithmetic, and the composition becomes the
  interesting question rather than the total.
- **materially below ~2,000** — the 10,813 closed-window figure is wrong, since
  the two are computed from the same total and an error moves both.
- **above ~5,000** — the expected grid is wrong. **This is still the DST
  falsifier**, and see OQ-16 for why DST is now believed NOT to be the cause.

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

---

## OQ-15. Detector 3's cost — EXPLAINed at real volume before acceptance

**I refused to predict this one**, on the grounds that the 16.9 ms gap-scan
figure came from an INDEX-ONLY scan of `open_time` and detector 3 needs OHLC,
which forces heap access. That refusal was correct — the plan is different — but
the direction was not the one implied.

**Measured, 2026-09-06, one month = 2,876 rows at 166,344 total:**

| Plan | Execution Time | Sort? |
|---|---|---|
| Planner's choice: Bitmap Heap Scan + Sort, **cold** | **70.0 ms** | yes, 275 kB quicksort |
| Planner's choice, **warm** | **6.4 – 6.8 ms** | yes |
| Forced Index Scan (`enable_bitmapscan=off`), warm | **3.25 ms** | **no** |
| Full series, no date bound, 166,344 rows | **3,007 ms** | no — Index Scan |

**A SORT APPEARED, and the recorded claim needs qualifying.** The cost lesson
states "no Seq Scan and no Sort anywhere", and that ADR-013's column order lets
a B-tree range-scan `open_time`. **That holds for INDEX-ONLY scans. It does not
hold once heap columns are needed** — the planner switches to a bitmap scan,
which returns rows in physical order, and then has to sort them.

**THE PLANNER'S CHOICE IS 2x SLOWER THAN THE ONE IT REJECTS**, and it is being
accepted anyway. 6.4 ms against 3.25 ms is a real difference and a trivial one:
80 chunks is **~510 ms warm** either way at this scale. `enable_bitmapscan=off`
is a session-global hammer that would affect every other query in the
connection, and buying 250 ms with it is not a trade worth making. **Recorded so
that whoever hits this at 500,000 rows knows the alternative was measured and
declined, rather than never considered.**

**Full-series is 3,007 ms — 4.4x the gap scan's 686 ms.** Chunking is not an
optimisation here, it is the design.

### The prediction this invalidates, stated before the run

Detectors 1+2 were predicted at **1.4–2.0 s of summed database execution time**
across 80 chunks, derived from the recorded 16.9 ms. Warm, the same query runs
in **5.6–8.3 ms**, so the real figure should land near **450–660 ms**.

**That prediction will be roughly 3x pessimistic, and it is wrong for the
familiar reason: it was built on a cold measurement without knowing it was
cold.** Recorded here before the run rather than explained afterwards.

---

## OQ-16. DST and the expected grid — measured on 13 real transitions

The grid generator goes the direction `expectsBarAt` refuses to: **local ->
instant, which is not a function.** A local time maps to ZERO instants on
spring-forward and TWO on autumn-back. Three questions were asked of it, and the
answer to all three turns out to have the same root.

### THE STRUCTURAL FINDING: no session week ever contains a DST transition

**US transitions occur at 02:00 local on a Sunday. The market is closed from
Friday 17:00 to Sunday 18:00. 02:00 is inside that window — always, in both
directions, for every transition in the stored range.**

So the nonexistent hour and the doubled hour both fall in a period where no bar
is expected. The ambiguity never reaches the grid.

**Confirmed against real bars rather than asserted.** Session weeks
(Sun 18:00 -> Fri 17:00 NY), transition weeks against the week before:

| kind | transition Sunday | DST week | week before |
|---|---|---|---|
| spring | 2021-03-14 | **460** | 460 |
| spring | 2022-03-13 | **460** | 460 |
| spring | 2023-03-12 | 456 | 452 |
| spring | 2024-03-10 | **460** | 460 |
| spring | 2025-03-09 | **460** | 460 |
| autumn | 2021-11-07 | **460** | 460 |
| autumn | 2022-11-06 | 452 | 456 |
| autumn | 2023-11-05 | 452 | 456 |
| autumn | 2024-11-03 | **460** | 460 |
| autumn | 2025-11-02 | 476 | 476 |

**460 = 5 x 23h x 4, the calendar's exact expectation, on transition weeks and
ordinary weeks alike.** A spring week losing an hour would show 456 and an
autumn week gaining one would show 464. Neither pattern appears. The residual
variation (452, 456, 476) tracks the era change and holidays, not DST — spring
and autumn deviate in both directions, which a DST effect could not do.

### The three questions, answered

1. **Spring forward, a rule whose local time falls in the gap.** No instant
   renders as 02:30 local that day, so a rule at 02:30 matches nothing and the
   grid emits no bar. Correct, and it is why the generator is built to STEP
   THROUGH UTC INSTANTS and ask `expectsBarAt` about each, rather than
   constructing local times and converting them.
2. **Autumn back, 01:30 twice.** Two distinct instants both render 01:30 local.
   **The grid emits BOTH**, because both are real fifteen-minute periods and the
   market genuinely is open for 25 hours that day. A generator working in local
   time would emit one and under-count by four bars.
3. **Both DST Sundays contain the weekly open AND a transition.** They do, and
   it does not matter: the transition is at 02:00 and the open is at 18:00, so
   the transition is already finished when the week begins. The offset differs
   between the two Sundays — spring-forward 18:00 is EDT (22:00Z), autumn-back
   18:00 is EST (23:00Z) — and `expectsBarAt` resolves that going instant ->
   local, which is total.

### THE DESIGN, AND WHY IT DOES NOT RELY ON THE ABOVE

**The generator NEVER converts local -> instant.** It steps UTC instants at the
timeframe interval and keeps those `expectsBarAt` calls `open`. That is correct
whether or not transitions fall in closed windows.

**This matters because the structural finding is a fact about WHERE THE RULES
SIT, not a property of the calendar.** Move the weekly open to 01:00, or add an
instrument in a zone that transitions at midnight, and the ambiguity lands
squarely inside a session. A generator built on local arithmetic would then be
wrong twice a year and correct in testing today.

### FAILURE MODE, and the prediction already watching for it

**If grid generation is wrong on DST weeks it produces a burst of `missing_bar`
or `unexpected_bar` twice a year** — four bars per transition, 13 transitions,
so roughly 52 events clustered on dates a fortnight apart in March and November.

**OQ-13a's falsifier already names this**: *"above ~5,000 means the expected
grid is wrong, most likely on DST weeks."* It is the same failure seen from the
other end, and the connection is recorded in the generator's own source so it
survives someone reading only the code.

**A clustered residual on those 13 dates is the signature to look for**, and it
is distinguishable from holidays, which cluster in late December.

### NOT OBSERVABLE IN THE STORED RANGE

**There is no autumn transition inside the 24/7 era.** The feed went 24/7 in
2026 and the data ends 2026-09-05; the next autumn-back is 2026-11-01. So the
doubled hour has never been observed on a day when the feed was delivering
around the clock, and case 2 above is reasoned rather than measured.

**Recorded as unmeasured rather than quietly assumed.** The first live run after
2026-11-01 is when it becomes checkable.

### An environmental note worth writing down

**Development happens in Bangkok, UTC+7, which has no DST.** Nothing about this
class of bug will ever appear locally, in any manual check, at any time of year.
It is only ever visible in the data or in a test that names the dates.

---

## OQ-13c / OQ-14 / OQ-15 — RESULTS, run 2026-09-06

**THE BASELINE.** Every future rate comparison is measured against this, so the
denominator is stated with it:

| | |
|---|---|
| Bars scanned | **166,344** |
| Range | 2020-01-01T00:00Z .. 2026-09-06T00:00Z |
| Timeframe | `15min` |
| Calendar | rules 1-6, migration `0004_calendar_measured_against_twelve_data` |
| Calendar instants open | 158,768 |
| Instants the calendar could not answer | 2,228 (before 2020-01-24) |

**The range deliberately starts before the calendar does.** Trimming it to
2020-01-24 would make the 2,228 vanish, and that option was considered only
after the run produced them. Fitting the range to the answer is the trap the
early-decision discipline exists to avoid.

### Counts, actual against predicted

| Event type | Predicted | Actual | |
|---|---|---|---|
| `unexpected_bar` | 10,813 | **10,813** | exact |
| - weekly_closure | 9,645 | **9,645** | exact |
| - daily_break | 1,168 | **1,168** | exact |
| `missing_bar` | 3,225 | **3,237** | see below |
| `unknown` (stored) | - | 0 | |
| structural three | not run | **not run**, reason emitted | D4 |

**The split is exact on both components**, which is the stronger result - a
matching total with a wrong classification would have looked like a pass.

**`missing_bar` is reported as A NUMBER WITHOUT AN ACCOUNT, not as a prediction
that held.** OQ-13b falsified its composition before the run. The +12 is fully
explained by the 345.1-week rounding in the top-down derivation - predicted
expected-open 158,756 against an actual 158,768, the same 12 - but what the
3,237 is MADE OF remains unknown.

### Cost, and the correction that was worse than the original

| | Predicted | Actual |
|---|---|---|
| Read, 81 chunks | 1.4-2.0 s (original, cold server-side) | **846 ms run 1, 733 ms run 2** |
| Read, "corrected" | 450-660 ms (warm server-side) | - |
| Write, 14,050 rows | single-digit seconds | **4.3 s / 5.2 s** |
| Wall clock | unpredicted | **14.2 s** |

**THE ORIGINAL PREDICTION WAS CLOSER THAN THE CORRECTION**, and the reason is a
BOUNDARY confusion: `EXPLAIN ANALYZE` reports server-side execution, while the
job measures client-observed time including round-trip and driver row parsing.
Recorded as a rule in LESSONS.md rather than a seventh anecdote.

**AND THE COST WAS NOT WHERE ANYONE LOOKED.** Of 14.2 s, reads are 0.8 s and
writes 4.3 s; **~9 s is `expectsBarAt`**, ~411,000 calls at a measured 28.97 us.
The first estimate in this project to be wrong about WHICH COMPONENT dominates
rather than by how much. Obligation 57.

### OQ-14 — idempotency, all four asserted

| Quantity | After run 1 | After run 2 | |
|---|---|---|---|
| `count(*)` | 14,050 | **14,050** | identical |
| `sum(occurrences)` | 14,050 | **28,100** | doubled |
| `min(confirmed_at)` | 18:32:30.126 | **18:32:30.126** | unchanged |
| `max(last_seen_at)` | 18:32:30.126 | **18:33:06.686** | advanced |

Run 2 reported **0 inserted, 14,050 incremented**, distinguished by `xmax = 0` -
`rowCount` reports both cases identically. Also checked: every row at
`occurrences = 2`, one distinct `confirmed_at`, and **3 distinct payload hashes
across 14,050 rows**, which is the canonicalisation behaving.

### The defect the first run found

`data_quality_events_seen_order_check` rejected the first batch. **Zero rows
landed.** Not clock skew - the hosts measured 92 ms apart - but two clocks:
`confirmed_at` defaulting to the database's `now()` at write time against
`last_seen_at` carrying the worker's run-start value from ten seconds earlier.
Fixed by writing both from one value. Recorded in LESSONS.md and as a permanent
control beside the six mutation controls.
