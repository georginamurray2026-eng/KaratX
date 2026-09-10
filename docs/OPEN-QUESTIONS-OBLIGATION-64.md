# OPEN QUESTIONS — obligation 64, the holiday candidate set

Companion to [OPEN-QUESTIONS-T1.4.md](./OPEN-QUESTIONS-T1.4.md),
[OPEN-QUESTIONS-T1.5.md](./OPEN-QUESTIONS-T1.5.md) and
[OPEN-QUESTIONS-T1.6.md](./OPEN-QUESTIONS-T1.6.md).

**THIS FILE BREAKS THOSE FILES' RULE, AND SAYS SO RATHER THAN PRETENDING
OTHERWISE.** They carry predictions committed before the run that tests them.
This one carries a MEASURED SET and the rule that produced it. Every figure
below was re-derived from the database on 2026-09-10 rather than copied from the
session that first produced it, and the one disagreement that surfaced is
recorded in §2. Where a prediction was made before a measurement in this work,
it lives in the scratchpad predictions of 2026-09-09/10 and is not restated here.

**NOTHING HAS BEEN WRITTEN TO `market_holidays`.** It holds **0 rows**. This file
is the set and its provenance; the migration does not exist and is blocked —
see §8.

---

## 1. THE GOVERNING RULE

> **EXTERNAL EVIDENCE PROPOSES A CANDIDATE DATE. THE TWELVE DATA SERIES
> CLASSIFIES WHAT THE FEED DID ON THAT DATE. FEED SHAPE AND BAR COUNT NEVER
> NOMINATE A DATE.**

Everything else in this file depends on that ordering, so it is stated first.

**The measurement that proves it is necessary.** The shape classifier used in §4
was run over every Mon–Thu date in 2020-01-24 .. 2025-04-26. On the April 2025
feed outage it returned:

| date | bars | classifier verdict |
|---|---|---|
| 2025-04-14 | 41 | **`anchored_holiday`** |
| 2025-04-15 | 0 | **`full_closure`** |
| 2025-04-16 | 0 | **`full_closure`** |
| 2025-04-17 | 69 | `other` |

**Those are outage dates. The classifier called two of them full closures and
one an anchored holiday, and it was not malfunctioning** — that IS what the feed
did on those dates, and the shapes are genuinely indistinguishable from a
holiday's. They are excluded from the set for exactly one reason: **nothing
proposed them.** A rule that selected on shape, on bar count, or on any
threshold over either, would have admitted the April 2025 outage as three
holidays.

**This is why the ordering is not a stylistic preference.** The feed cannot tell
a closed market from a broken pipe, because both produce absent bars. Only an
external, dated source can distinguish them, and its role is exhausted the
moment it has named a date.

---

## 2. THE PINNED SET — 41 dates

**Derivation:** 43 NYSE-dated Mon–Thu proposals (39 holiday + 4 early-close),
minus **2023-07-03** and **2024-07-03**, which returned a full **92 bars** and
therefore show no shortfall to classify. 43 − 2 = **41**.

`bars` is the count on the **UTC date**, which is the unit the classifier used.
`bars (NY)` is the count on the **New York local date**, which is the unit
`calendar.ts` matches on and the unit §7 and §8 use. `evening` is the
18:00–23:45 NY block on that local date, out of 24.

**§8's argument runs on `bars (NY)`, not on `bars`.** The six `full_closure` rows
read **4** under `bars` and **24** under `bars (NY)`, and both are correct: the
UTC date ends at 18:45 NY, so it captures only four of that local date's
twenty-four evening bars. Where §8 says a `full` row would suppress 24 real
bars, those are the `bars (NY)` twenty-four.

| date | dow | bars | bars (NY) | evening | last daytime bar (NY) | shape |
|---|---|---|---|---|---|---|
| 2020-02-17 | Mon | 81 | 81 | 24 | 14:30 | truncated |
| 2020-05-25 | Mon | 76 | 76 | 24 | 12:45 | truncated |
| 2020-09-07 | Mon | 76 | 76 | 24 | 12:45 | truncated |
| 2020-11-26 | Thu | 75 | 75 | 24 | 12:30 | truncated |
| 2020-12-24 | Thu | 75 | 55 | **0** | 13:30 | **anchored_holiday** |
| 2021-01-18 | Mon | 75 | 75 | 24 | 12:30 | truncated |
| 2021-02-15 | Mon | 76 | 76 | 24 | 12:45 | truncated |
| 2021-05-31 | Mon | 77 | 77 | 24 | 13:00 | truncated |
| 2021-07-05 | Mon | 77 | 77 | 24 | 13:00 | truncated |
| 2021-09-06 | Mon | 76 | 76 | 24 | 12:45 | truncated |
| 2021-11-25 | Thu | 76 | 76 | 24 | 12:45 | truncated |
| 2022-01-17 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2022-02-21 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2022-05-30 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2022-06-20 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2022-07-04 | Mon | 83 | 83 | 24 | 14:30 | truncated |
| 2022-09-05 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2022-11-24 | Thu | 82 | 82 | 24 | 14:15 | truncated |
| 2022-12-26 | Mon | 4 | 24 | 24 | — | **full_closure** |
| 2023-01-02 | Mon | 4 | 24 | 24 | — | **full_closure** |
| 2023-01-16 | Mon | 83 | 83 | 24 | 14:30 | truncated |
| 2023-02-20 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2023-05-29 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2023-06-19 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2023-07-04 | Tue | 82 | 82 | 24 | 14:15 | truncated |
| 2023-09-04 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2023-11-23 | Thu | 82 | 82 | 24 | 14:15 | truncated |
| 2023-12-25 | Mon | 4 | 24 | 24 | — | **full_closure** |
| 2024-01-01 | Mon | 4 | 24 | 24 | — | **full_closure** |
| 2024-01-15 | Mon | 83 | 83 | 24 | 14:30 | truncated |
| 2024-02-19 | Mon | **75** | **82** | 24 | 14:15 | truncated |
| 2024-05-27 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2024-06-19 | Wed | 82 | 82 | 24 | 14:15 | truncated |
| 2024-07-04 | Thu | 82 | 82 | 24 | 14:15 | truncated |
| 2024-09-02 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2024-11-28 | Thu | 82 | 82 | 24 | 14:15 | truncated |
| 2024-12-24 | Tue | 75 | 55 | **0** | 13:30 | **anchored_holiday** |
| 2024-12-25 | Wed | 4 | 24 | 24 | — | **full_closure** |
| 2025-01-01 | Wed | 4 | 24 | 24 | — | **full_closure** |
| 2025-01-20 | Mon | 82 | 82 | 24 | 14:15 | truncated |
| 2025-02-17 | Mon | 82 | 82 | 24 | 14:15 | truncated |

**33 truncated · 6 full_closure · 2 anchored_holiday.** No Friday and no weekend
date appears; see §5 for why.

### ONE FIGURE DISAGREED ON RE-DERIVATION, AND IT IS INSTRUCTIVE

**2024-02-19 is 75 bars on the UTC date and 82 on the New York local date.** No
other date in the set differs between the two units. It is the only proposed
date whose absence run **crosses a UTC date boundary**, so the UTC-date slice
attributes part of a neighbouring date's damage to it. In local-date terms it is
an ordinary member of the 33: truncated at 14:15, evening 24/24 present.

The earlier pass, which worked in UTC dates, classified it separately on that
basis. **The disagreement is between two units, not between two measurements** —
and it is the fourth time this session that a UTC-date reading produced a wrong
answer that looked right. The local-date figure is the one to use.

---

## 3. THE TWO SOURCE LIMITATIONS

Neither is buried, because either one could invalidate the set.

### 3.1 NYSE IS A DIFFERENT VENUE

The proposal comes from **NYSE Group dated holiday and early-closing releases
(December 2019, December 2021, November 2024)**, covering 2020–2027. That is an
**equities** calendar, and this instrument is **XAU/USD spot metals**.

**It is used as dated corroboration of DATES ONLY. It is never evidence of
XAU/USD trading hours**, and nothing in §2 takes a time from it. The measured
close times make the point concretely. NYSE's early close is **13:00** New York.
**Two of the 41 dates do close at 13:00 — 2021-05-31 and 2021-07-05 — and that
is the entire extent of the agreement.** The other eight 2020–2021 truncated
dates close at 12:30 or 12:45, and **all 23 of the 2022-onward truncated dates
close at 14:15 or 14:30, which is nowhere near 13:00** — see §4. **So NYSE's
early-close TIME does not predict the observed close times**, and two
coincidences out of 41 are not a rule. That is the whole reason the source is
confined to proposing dates.

`market-hours.ts` already warned about exactly this substitution, before any of
it was measured: *"WHICH US HOLIDAYS ACTUALLY AFFECT SPOT GOLD IS UNMEASURED.
XAU/USD is OTC, not COMEX… Do not seed this from a futures calendar without
checking it against Massive first."*

**WHERE THE RELEASES' CONTENTS BELONG, AND THE FACT THAT THEY ARE NOT RECORDED
ANYWHERE — obligation 70.** Everything above names the source and bounds what it
may be used for. **It enumerates no date, and nothing else in this repository
does either.** The home for the contents is
**`docs/EXTERNAL-HOLIDAY-SOURCES.md`** — issuer, publication date, source URL,
retrieval date, and the dates transcribed from the re-fetched artefact, per
release. **UNTIL OBLIGATION 70 IS DISCHARGED THAT DOCUMENT DOES NOT EXIST AND
THE CONTENTS ARE UNRECORDED**, so the set in §2 can be read but not
independently checked. **No dates are duplicated into this section**; §2 is the
set and `EXTERNAL-HOLIDAY-SOURCES.md` will be the evidence for it, and a third
copy would be a third thing to drift.

### 3.2 AUTHORITATIVE HISTORICAL CME COMEX METALS MATERIAL COULD NOT BE OBTAINED

For **2020–2025**, no authoritative CME COMEX metals holiday-and-hours record was
obtained. **One CME clearing advisory confirms 2025-01-01 as a holiday and gives
no trading times and no metals specificity.** That is one date out of 41, with no
hours attached.

**Nothing was substituted for it and nothing was extrapolated from it.** The gap
is not a formality: CME is the venue whose calendar would actually predict the
close times in §4, and it is the one source that could turn the observed
14:15/12:45 closes from a measurement into an explanation. Until it is obtained,
**the set knows WHICH dates and WHAT the feed did, and does not know WHY.**

---

## 4. THE SIX MEASURED SESSION SIGNATURES

Measured across the whole 2020-01-24 .. 2025-04-26 window, not only on proposed
dates. Each is named with a dated example.

| signature | example | what it looks like |
|---|---|---|
| **full closure** | 2022-12-26 | Daytime entirely dark; evening 18:00–23:45 NY fully present. 24 bars on the local date. |
| **anchored holiday** | 2020-12-24 | Daytime truncates before the 17:00 close, evening ABSENT, and the FOLLOWING session entirely dark (0 of 92). |
| **truncated** | 2025-02-17 | Daytime stops before the close, evening 18:00 NY PRESENT, next session a normal 92. |
| **partial session** | 2020-04-01 | Interior damage only. Opens normally, resumes, tail completes, evening intact. |
| **mid-session suspension** | 2022-07-04 | Interior block that resumes AT the daily break. |
| **unanchored outage** | 2021-09-27 → 09-28 | One run aligned to nothing at either end, resuming mid-evening. |

### The truncated close time STEPS ONCE, and the step is sharp

- **2020–2021: last bar 12:30–13:00 New York** (shortfall 15–17 slots)
- **2022 onward: last bar 14:15–14:30 New York** (shortfall 9–10 slots)

Recounted from §2's table: there are **10** truncated dates in 2020–2021 and
**23** from 2022 onward, which is the 33. **Nine of the ten sit in the earlier
band, all 23 sit in the later band, and no truncated date closes between 13:00
and 14:15.** The five distinct close times across all 33 are 12:30, 12:45, 13:00,
14:15 and 14:30.

**THE TENTH IS 2020-02-17, AND IT IS AN OUTLIER IN THE LATER BAND RATHER THAN
BETWEEN THE BANDS.** It closes at 14:30, two years before that band otherwise
begins. It is also the only 2020–2021 truncated date whose shortfall is **three
runs rather than one** — measured: a single absent slot at 13:30, a single one at
14:00, then nine slots 14:45–16:45. An ordinary earlier-band date looks nothing
like that: 2021-09-06 is **one clean run of 16 slots, 13:00–16:45**. **THAT MAY
EXPLAIN THE ANOMALOUS FIGURE — a last surviving bar at 14:30 amid scattered
damage is not the same fact as a session ending at 14:30 — AND IT IS NOT
ASSERTED.** Nothing has been measured that distinguishes the two, and the date
is left in the band its last bar puts it in rather than moved on a guess.

**The two `anchored_holiday` dates close at 13:30, which DOES sit between the
bands.** They are outside the count above because they are a different
signature, not because the figure was inconvenient.

What caused the step is unknown, and §3.2 is why: the venue record that would
date an hours change was not obtained. It is recorded as a measured
discontinuity, not explained.

---

## 5. THE EXCLUDED NEAR-MISSES — shapes preserved as evidence

Seven dates carry the **`anchored_holiday`** shape and are NOT in the set.
**Every one is excluded for the same single reason: no external proposal.**

| date | dow | shape | note |
|---|---|---|---|
| 2020-12-31 | Thu | anchored_holiday | next session (2021-01-01) entirely dark |
| 2024-12-31 | Tue | anchored_holiday | next session (2025-01-01) entirely dark |
| 2020-04-09 | Thu | anchored_holiday | Thursday before Good Friday |
| 2021-04-01 | Thu | anchored_holiday | Thursday before Good Friday |
| 2022-04-14 | Thu | anchored_holiday | Thursday before Good Friday |
| 2023-04-06 | Thu | anchored_holiday | Thursday before Good Friday |
| 2024-03-28 | Thu | anchored_holiday | Thursday before Good Friday |

**FRIDAYS ARE EXCLUDED BY DESIGN**, and that is what creates this family. The
feed runs two distinct Friday regimes — **56-bar and 80-bar** — so a Friday
cannot be separated into "holiday" and "ordinary" by shape at all. Fridays
belong to `market_hours` and its weekly-close rule, not to `market_holidays`.

**The consequence is structural rather than accidental:** because Good Friday is
a Friday, it is never proposed; because it is never proposed, the Thursday
before it is never proposed either — even though that Thursday shows the
anchored shape as clearly as 2020-12-24 does.

**DERIVING THURSDAYS FROM FRIDAY HOLIDAYS WAS DELIBERATELY NOT ADOPTED.** It
would work, and it is rejected anyway: it introduces **a second inference rule
at exactly the point where the set is being made reproducible**, and a second
rule is a second thing to be wrong about. The governing rule in §1 has one step —
an external source names a date — and adding "…or is the weekday before a date
an external source names" doubles the surface without doubling the evidence.
**These seven are recorded here so the decision is visible and reversible, not
so it can be quietly reversed.**

---

## 6. THE FEED-BEHAVIOUR FINDINGS — excluded and recorded

Three dates with shortfalls that are **findings about the feed**, not candidate
holidays. Recorded because a later session will otherwise rediscover them and
reach for the holiday explanation.

- **2021-09-28** — one run of **19 slots**, `2021-09-27 22:30Z → 2021-09-28
  03:00Z`, **unanchored at both ends**. The session opened at 18:00 NY, produced
  two bars, went dark at 18:30 NY and returned at 23:15 NY. Neither boundary is
  a session boundary.
- **2020-03-26** — **compound**: a 5-slot tail truncation (`19:45–20:45Z`), plus
  a 43-slot run starting `22:00Z` — **exactly at the next session's 18:00 NY
  open** — and ending mid-morning Friday at nothing. **That run explains
  2020-03-27's 49 bars in full**; the two dates are one event.
- **2020-04-01** — **two interior runs**, one slot at `05:00Z` and thirteen at
  `06:45–09:45Z`, separated by six present slots. Opens normally, **tail
  completes**, evening intact.

None has external support and none is proposed. The first two are the reason §1
is written the way it is.

---

## 7. THE EVENING MEASUREMENT — and it settles the model question

**39 of the 41 pinned dates carry a full 24-slot 18:00–23:45 New York block.**
(The two `anchored_holiday` dates carry none, and were excluded from this
analysis because there is nothing there to measure.)

Measured over that block only:

| group | n | min bp | median bp | max bp | distinct closes /24 | zero-range bars |
|---|---|---|---|---|---|---|
| **holiday evenings** | 39 | **17.45** | 45.99 | 112.11 | **22–24** | **0** |
| ±7d controls (usable) | 71 | 14.09 | 39.05 | 132.20 | 17–24 | 0 |
| all non-pinned 24-bar evenings, pre-2025-04-26 | 1,287 | **11.20** | 43.16 | 434.75 | 17–24 | 1 |

Paired against their own ±7d controls: **median ratio 1.06**, and **22 of 39
holiday evenings are WIDER than their controls.** Seven control slots were
discarded before this was computed — six because the control date is itself
pinned (the Christmas/New Year cluster), one because 2022-11-17 is a known
damaged date returning 8 bars. No date lost both controls.

### CONCLUSION: THE 18:00 NY RE-OPEN IS REAL TRADING, NOT A FEED ARTEFACT

Three things had to be true for it to be synthetic, and none is:

1. **Near-zero range — absent.** The thinnest holiday evening is **17.45 bp**,
   which is ABOVE the population minimum of **11.20 bp** across 1,287 ordinary
   evening blocks.
2. **Repeated prices — absent.** 22–24 distinct closes of 24, at the tighter end
   of the ordinary range of 17–24.
3. **Zero-range bars — absent.** Across **1,326 evening blocks** in the
   pre-synthesis era there is **exactly one** zero-range bar, and it is **not on
   a pinned date**.

**The synthesis-era phantom sessions are the comparison, and only by SHAPE.**
2025-12-24, 2025-12-31 and 2026-04-02 came in at 2.04–4.77 bp against a 190.51 bp
whole-day median. **Those are whole days and these are six-hour evenings; the bp
figures are NOT comparable and are not compared here.** What transfers is the
signature — near-zero range, repeated prices, zero-range bars — and all three are
absent from every one of the 39.

---

## 8. THE MODEL GAP — obligation 68, and it BLOCKS obligation 64

**`market_holidays` cannot express 39 of the 41 pinned dates.** Stated here
because §7 is what establishes it; tracked as **obligation 68**.

[`calendar.ts:274-281`](../packages/core/src/calendar.ts#L274-L281) matches a
holiday on the **New York local date** and then compares `localClose` against
`moment.minuteOfDay` with a **bare, unbounded `>=`**. There is no upper bound and
no re-open concept anywhere in the function.

- **The 33 truncated dates.** An `early_close` at 14:30 closes every instant on
  that local date from 14:30 to 23:59 — **including 18:00–23:45, which holds 24
  present bars that §7 establishes are real trading.**
- **The 6 full_closure dates are the same shape with the cut at 00:00.** In
  local-date terms they are **daytime dark, evening fully present**; a `full` row
  suppresses **24 real bars**.
- **The 2 anchored dates** need a companion row on the NEXT local date, and both
  break. **2020-12-25 is a Friday**, excluded by design. **2024-12-25 has 24
  present evening bars**, so the `full` row required to complete 2024-12-24
  falsifies 2024-12-25.

**The fix requires BOTH a schema change and a `calendar.ts` change**, because
neither alone can express "closed for the daytime, open again from 18:00 on the
same local date".

**AND THE BLAST RADIUS IS THE WHOLE CALENDAR.** Populating `market_holidays`
changes **aggregation, gap detection, calendar detection and stale detection
simultaneously** — every one reads the same `expectsBarAt` through
`expectedGrid`. There is no way to land it for one consumer and observe the
result before the others see it.

**So the migration obligation 64 needs cannot be written until 68 is decided.**
The set in §2 is the input to that migration and is complete; the model it would
be written into is not.
