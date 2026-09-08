# OPEN QUESTIONS — T1.6, timeframe aggregation

Companion to [OPEN-QUESTIONS-T1.4.md](./OPEN-QUESTIONS-T1.4.md) and
[OPEN-QUESTIONS-T1.5.md](./OPEN-QUESTIONS-T1.5.md), same rule: **every
prediction here was committed before the code that tests it existed, and none is
edited afterwards.** The wrong ones are the useful half.

**Nothing in this file has been run.** No aggregation code exists at the time of
writing. These are predictions about a job that has not been built, made from
figures already on record.

Input: **166,344 stored 15min bars**, 2020-01-24 13:00Z to 2026-09-05 09:30Z,
under provider `twelve_data`. Output goes to provider `karatx_derived`
(ADR-014). The 1,911 stored `1h` and 1,449 stored `1D` bars are the VENDOR
series and are not inputs, not outputs, and not comparators for these counts —
the vendor `1D` is a UTC-day bar and the derived `1D` is a session-day bar
(obligation 49).

**4H IS OUT OF SCOPE — obligation 59.** The session day is 23 hours before 2025
and 24 hours after, so no single division into four-hour periods is correct
across both eras, and no 4H golden fixture exists to validate a choice against.
No 4H prediction is made here because no 4H rule has been decided.

---

## OQ-19. Row counts — how many aggregates should exist

| Output | Prediction | Kind of claim |
|---|---|---|
| `1h` | **at most 41,586**, and expect materially fewer | a hard ceiling plus a soft expectation |
| `1D` | **1,700–1,900** | a range meant to catch an order-of-magnitude error |
| `4h` | **not run** | obligation 59 |

### The 1H ceiling is arithmetic, not an estimate

166,344 ÷ 4 = **41,586**. Four 15-minute bars make one hour, so this is the
count if every hour is complete. **It cannot be exceeded**, and an actual above
it does not mean "more data than expected" — it means constituents are being
counted into more than one period, or the boundary rule is wrong.

**Expect fewer, and the reason is the acceptance criterion itself.** BUILD-PLAN
T1.6 requires that an aggregate is final only when **every** constituent 15M bar
is final and present, and that a missing constituent yields **no aggregate,
never a partial one**. T1.5 counted 3,237 `missing_bar` events, so some hours
are missing at least one constituent and must produce nothing. The shortfall
should be of that order, not of a different one.

### The 1D range, and its method stated in full

```
weekday session days, 2020-01-24 to the mid-2025 era change   ~1,353
calendar days in the 24/7 era                                   ~449
                                                              ------
                                                               ~1,802
```

Predicted range **1,700–1,900**, bracketing 1,802.

**Cross-checked against the bar count, which is an independent quantity:**

```
1,353 sessions x 23h  =  31,119 h
  449 days     x 24h  =  10,776 h
                        --------
                          41,895 h   expected open hours
166,344 bars x 15min  =  41,586 h   hours actually present
                        --------
                     difference 309 h, or 0.74%
```

The two agree to **~0.7%**, which is what makes the day count worth stating at
all — it is not one guess, it is two quantities derived differently that do not
contradict each other.

### THE TERMS ARE ROUGH AND THE RANGE IS NOT PRECISE

**Stated plainly rather than buried.** The holiday term and the era-boundary
term are both approximations:

- **`market_holidays` IS EMPTY.** Christmas, New Year and every other closure
  read as ordinary sessions in the calendar, so the session-day count above does
  not subtract them. T1.5 already recorded that this inflates `missing_bar`; it
  inflates this count the same way.
- **"mid-2025" is not a date.** ADR-008 records Saturday bars appearing
  2025-04-26 and continuous weekend coverage from 2026-01-04 — that is an eight
  month transition, not a boundary, and 1,353/449 splits it at a point chosen
  for arithmetic rather than measured.

**This range exists to catch an order-of-magnitude error, not to be accurate.**
A result of 1,750 and a result of 1,850 tell us the same thing. A result of 500
or 5,000 tells us the boundary rule is wrong. **Do not treat a landing inside
1,700–1,900 as confirmation of the day count** — it is only confirmation that
nothing is grossly wrong, which is all a range this soft can buy.

### What falsifies OQ-19

- **1H above 41,586** — the ceiling is arithmetic, so exceeding it is a defect,
  not a surprise. Look for double-counted constituents first.
- **1H at or very near 41,586** — that means almost nothing was rejected, which
  contradicts 3,237 known missing bars. Suspect the missing-constituent rule is
  not firing.
- **1D outside 1,700–1,900** — report the number and the boundary rule that
  produced it before adjusting either.

---

## OQ-20. The decomposition, and the way it can be made meaningless

The job reports three counters and asserts a relation between them:

```
periods_expected  ==  rows_written  +  periods_rejected_for_missing_constituents
```

**THIS ASSERTION IS ONLY MEANINGFUL IF `periods_expected` IS COMPUTED
INDEPENDENTLY, FROM THE CALENDAR.** It must be the answer to "how many session
hours/days does the calendar say exist in this range", derived without reference
to what the aggregation did.

**If `periods_expected` is instead computed as written + rejected, the assertion
becomes an identity.** It is then true by construction, cannot fail for any
input, will pass on the first run and every run after, and will be read by a
future session as evidence that the decomposition balanced. **That is a
decomposition presented as a confirmation, and it is worse than no assertion at
all** — an absent check invites scrutiny, a check that cannot fail deflects it.

This is the same shape as several already recorded in this project: the calendar
that could be non-empty and cover nothing (obligation 55), the guarantee weaker
than it reads (obligation 44), and the immutability checker that verifies
everything except the thing it was assumed to verify (obligation 60).

### What falsifies OQ-20

**A test, not an observation, and it must be written:** remove one constituent
15M bar from a period, then assert that `periods_rejected_for_missing_constituents`
increases by one, `rows_written` decreases by one, **and `periods_expected` does
not change at all**. If `periods_expected` moves, it is derived from the outputs
and the assertion is an identity.

**A green assertion on the first run is not evidence here.** It is exactly what
both the correct and the meaningless implementation produce.

---

## OQ-21. `expectsBarAt` call count — obligation 57

**Prediction: fewer than 4,000 calls for a full aggregation over the stored
range.**

**Reasoning: a session boundary is a property of a DAY, not of a bar.** Deciding
which hour or session-day a bar belongs to requires knowing where the day's
boundaries fall, and a day has one set of boundaries — resolved once, then
reused for every bar inside it. At ~1,802 session days, one or two calendar
resolutions per day is ~1,800–3,600 calls.

Obligation 57 measured `expectsBarAt` at **28.97 µs/call**, so 4,000 calls is
~0.12 s and irrelevant. That is the point of predicting the count rather than
the cost: **the cost only matters if the count is wrong.**

### What falsifies OQ-21 — and this is the failure signal to watch

**An actual anywhere near 166,344 means it is being called PER BAR.** At 28.97
µs that is ~4.8 seconds inside the aggregation, and more importantly it means
the implementation is asking the calendar the same question about the same day
up to 96 times.

Obligation 57 records the fix and explicitly says it does not require making the
function impure: resolve the local rendering once per day, or memoise per
(zone, UTC day). **If the count lands near 166,344, that is the moment obligation
57 becomes owned by T1.6 rather than deferred** — and if it lands under 4,000,
57 closes with a note saying this path is not latency-sensitive.

---

## OQ-22. The `assertRawDatetimePresent` provider lookup

**Every derived write takes the lookup branch.** The guard short-circuits only
when `rawDatetime` is a non-empty string, and every derived bar passes NULL by
construction (ADR-014). So the lookup count is not "some derived writes" — it is
**exactly the derived row count**.

**Prediction: ~43,000 lookups** — approximately 41,586 (`1h`) + 1,802 (`1D`),
less whatever is rejected for missing constituents.

### THIS CORRECTS A FIGURE I GAVE IN STEP 7, AND THE CORRECTION IS THE POINT

When the guard landed, the cost was described as "a few thousand extra round
trips". **That was wrong by an order of magnitude** — it reasoned from the 1D
count and silently ignored 1H, which is twenty-three times larger. The design
decision (lookup on the exceptional path, not memoised) may still be right, but
it was defended with a number that was too small, and the number is recorded
here before the run rather than after it.

**Predicted added cost: 6–15 seconds** over the full aggregation. Basis: a point
lookup on `providers_key_key`, a unique index over a three-row table that will
be entirely in shared buffers after the first call, so the server-side cost is
negligible and **essentially all of it is client round-trip latency** — on the
order of 0.15–0.35 ms each against a local container.

### What would make caching worth doing, stated before the measurement

**A threshold, fixed now so it is not chosen against the number later:**

- **Cache if the measured lookup cost exceeds 10% of total job wall clock**, or
  exceeds 5 seconds absolute, whichever is the smaller bar to clear.
- **Cache immediately if this path ever acquires a latency budget** — T1.7 writes
  live, and a per-write round trip to resolve a constant is indefensible there
  regardless of what a batch job measures.

**And the constraint on any cache, recorded now:** ADR-014 rejects memoisation
because a cached id would need per-database invalidation and the integration
suite runs against a fresh ephemeral database every run. Any cache must be keyed
so that a different database cannot return a stale id. **A module-level `let`
holding a bare number is the wrong answer and would pass every test** — the
tests each get a fresh process, so the failure would appear only in a long-lived
worker that reconnected to a restored database.

### What falsifies OQ-22

- **A lookup count materially below the derived row count** means the guard is
  being skipped for some derived writes — which means something is passing a
  non-null `rawDatetime` for a derived bar, i.e. inventing one.
- **A lookup count above it** means the guard runs more than once per write.
- **A measured cost far below 6 s** would mean round-trip latency is much lower
  than assumed, and the caching threshold above should be re-derived rather than
  quietly dropped.

---

## OQ-23. Query plans — stated before the query is written

**Prediction: an Index Scan (or Index Only Scan) on `candles_pk` for the spine
read**, with no Sort node.

**Basis, from ADR-013:** the primary key is
`(instrument_id, provider_id, timeframe, open_time)` — three equality-filtered
columns followed by the single ranged column, ordered that way deliberately so
that a read of "bars for one instrument+provider+timeframe over a time range"
is a range scan on the trailing column. The aggregation spine read is exactly
that query shape.

### The three things every candle query must state, per T1.6's carried rule

| Dimension | Value to be recorded |
|---|---|
| **Boundary** | **client-observed**, and separately **server-side** from `EXPLAIN ANALYZE`. Wall clock for the job as a whole |
| **Cache state** | **cold and warm, both**. Cold-to-warm is worth up to 10x and a warm-only number describes a rerun, not a run |
| **Row count** | **166,344** — the real volume, not a sample |

`EXPLAIN ANALYZE` measures the server and never measures what the job
experiences; the client-observed number includes transfer and decode. Both are
recorded because they answer different questions, and quoting one as the other
is how a cost estimate becomes wrong about which component dominates —
obligation 57 is this project's example of exactly that.

### What falsifies OQ-23 — and what must NOT be done about it

**A Seq Scan falsifies ADR-013's no-new-index decision.**

ADR-013 states, as a decision rather than an oversight, that the primary key's
index is the only one needed for read performance, and names the reconciliation
index it deliberately did not create so that a later session would add one
**against a measured query plan**. A Seq Scan on the spine read would be that
measurement arriving.

**IT MUST BE REPORTED, NOT WORKED AROUND.** Not by adding an index quietly, not
by rewriting the query until the planner cooperates, and not by lowering
`seq_page_cost` until the shape changes. The finding is that a documented
decision was wrong at real volume, and that finding is worth more than the
performance it costs — ADR-013 asked to be told, and this is the query that can
tell it.

A plan that is neither Index Scan nor Seq Scan — a Bitmap Heap Scan, say — is
also a falsification of the prediction as written, and should be reported with
the plan rather than filed as close enough.

---

## OQ-21 RESULT — FALSIFIED. Recorded 2026-09-09, from the implementation, before any run.

**The prediction above is left exactly as written.** It was wrong, and a
prediction edited after the fact is not a prediction.

| | |
|---|---|
| **Predicted** | fewer than 4,000 `expectsBarAt` calls for a full aggregation |
| **Actual** | one call per 15-minute slot in the padded range, **~464,000 for a full run** |
| **Wrong by** | a factor of about 116 |

### The derivation, rather than the number

The number is not asserted. It follows from what `expectedGrid` does, which is
to step every 15-minute instant in a range and ask `expectsBarAt` about each
one — **whether or not a bar exists there**. So the count is a property of the
SPAN, not of the data:

```
stored range   2020-01-24 13:00Z .. 2026-09-05 09:45Z
span                                        6.614 years
span / 15 min                            231,923 slots

padded, 1H  (1 hour either side)          231,931 calls
padded, 1D  (26 hours either side)        232,131 calls
                                         --------------
one full run, BOTH timeframes             464,062 calls
at 28.97 us/call (obligation 57)             13.4 s
```

**THE PAD IS PART OF THE ANSWER, NOT AN OVERHEAD.** It exists because a grid
derived from the input span lets a period's required set be truncated by the
input itself — one bar at 00:00 produced a one-constituent "hourly" bar that
satisfied every completeness check. That defect was found by the first test run
and fixed in the code; the pad is what fixes it.

### **STEP 10 SHOULD PREDICT ~464,000, NOT ~232,000**

Stated plainly because the halving error is the easy one to make: **there are
TWO invocations, one per timeframe**, and each walks the whole span
independently. A prediction of ~232,000 would be right about one call and wrong
about the run, and would then "confirm" at half the true figure.

### Why the prediction was wrong — and it was not an arithmetic slip

The reasoning was: **a session boundary is a property of a day, not of a bar.**
That is TRUE, and it is still true. Resolving where a day begins and ends does
not require asking about each bar inside it.

**What the prediction missed is that the boundary is not what aggregation needs.
It needs the REQUIRED CONSTITUENT COUNT, and that is a property of every slot.**
"How many 15-minute bars must this hour contain?" is answerable only by asking
the calendar about each candidate slot — a holiday early close, a daily break
edge, or an era change all move the answer within a single day.

Getting under 4,000 was reachable, and the way to reach it was to derive counts
from session-boundary arithmetic: resolve the day's open and close, subtract the
break, divide by fifteen minutes. **That is a SECOND IMPLEMENTATION OF THE
SESSION RULES**, free to drift from `expectsBarAt` — and the calendar-count
invariant exists precisely to prevent it. `aggregate.ts` states the failure it
prevents: a shortened session satisfied by a full count, or a full session
satisfied by fewer, is a wrong bar that looks entirely right.

**So the invariant wins and the prediction loses.** The cost was not accepted
casually; it was accepted in preference to a second source of truth about when
the market is open.

### Obligation 57 is now OWNED BY T1.6, not deferred

57 said it was owned by "whichever of T1.6 or T1.7 first calls it per-bar in a
latency-sensitive path", and that if neither did, it would close unactioned with
a note. **T1.6 calls it per slot, which is worse than per bar**, so the
condition is met and the row is updated to say so.

**It does not follow that it must be optimised now, and it has not been.**
13.4 seconds inside a batch job is irrelevant, exactly as 57 predicted for this
case. What has changed is ownership: the fix is no longer hypothetical, and 57
already names it — resolve the local rendering once per day, or memoise per
(zone, UTC day), both of which keep the function pure. **The optimisation
belongs with a measurement of the real run, not with this estimate.**

### What would falsify THIS result

- **A measured full run materially below 464,000 calls** means the padded span
  is smaller than derived here, or one timeframe is not being walked.
- **Materially above it** means something calls `aggregate` more than once per
  timeframe, or the pad is wider than intended.
- **A wall-clock contribution far from 13.4 s** would falsify obligation 57's
  28.97 us/call at this call site rather than falsifying the count — and that is
  a different finding, about the measurement rather than about the design.

---

## DRY-RUN RESULTS — 2026-09-09. Nothing was written.

**The predictions above are left exactly as written.** Scored below.

### OQ-19 — 1H CONFIRMED, 1D FALSIFIED AS WRITTEN

| | Predicted | Actual |
|---|---|---|
| 1H | ceiling 41,586, expect materially fewer | `periodsExpected` **39,684**, produced **38,805** |
| 1D | **1,700–1,900** | `periodsExpected` **1,726**, produced **1,554** |

**1H holds.** Under the ceiling, and materially so.

**THE 1D PREDICTION IS FALSIFIED, AND THE ACCOUNT MATTERS MORE THAN THE MISS.**
1,554 is outside 1,700–1,900. The range itself was not badly derived — the
method produced ~1,802 and `periodsExpected` came out at 1,726, comfortably
inside it. **What was wrong is WHICH QUANTITY the prediction named.**

The method counted SESSION DAYS THAT EXIST. The prediction stated it as a ROW
count, and rows are days that AGGREGATE COMPLETELY — 172 fewer, because a day
missing any constituent yields nothing at all. Those are different quantities
and OQ-19 used one to predict the other.

**The distinction was known and was applied unevenly.** The 1H entry hedged it
explicitly — "expect materially fewer", with the missing-constituent reason
spelled out. The 1D entry gave a single range with no such hedge. The same
paragraph that got it right for one timeframe dropped it for the other.

**Not adjusted, not re-derived.** The prediction was wrong.

### OQ-21 — CONFIRMED at 464,062

Predicted (in the falsification record) 231,931 + 232,131 = 464,062. Actual
**464,062**, to the call. The derivation was exact.

**One divergence, in the COST rather than the count.** 13.4 s was projected at
obligation 57's 28.97 us/call. Actual aggregation time was **9.89 s** — 1H
4.10 s plus 1D 5.79 s — **26% under**, and that 9.89 s also contains bucketing,
completeness checks and OHLC folding. So the all-in cost at this call site is
≤21.3 us/call. This does NOT falsify 57's 28.97 us, which was measured in
isolation under different conditions; it means the projection was high, and the
projection was mine.

### 1D COSTS 5.79 s AGAINST 1H's 4.10 s ON THE SAME CALL COUNT — a new finding

Both timeframes make ~232,000 `expectsBarAt` calls, so the 1.69 s difference is
not `expectsBarAt`. It is **`periodKeyOf` calling `localMomentOf` once per
expected slot** to assign a session day — a SECOND per-slot `Intl` cost that
only 1D pays, on top of the one inside `expectsBarAt`.

**OBLIGATION 57's FIX MUST THEREFORE COVER BOTH `Intl` PATHS, NOT
`expectsBarAt` ALONE.** Memoising only the calendar answer would leave roughly
40% of the 1D overhead untouched, and the row would be closed against a
measurement that improved the smaller half. Both resolve a local rendering for
the same instant, so one memoisation keyed on (zone, UTC day) serves both — but
it has to be applied in both places deliberately.

### OQ-23 — CONFIRMED. Index Scan, no Sort.

```
Index Scan using candles_pk on candles  (cost=0.42..23254.90 rows=166265)
                                        (actual rows=166344 loops=1)
  Index Cond: instrument_id = 1 AND provider_id = 1 AND timeframe = '15min'
              AND open_time >= ... AND open_time < ...
```

**No Seq Scan. ADR-013's no-new-index decision holds at 166,344 rows** — the
primary key's column ordering serves the spine read exactly as designed, and
`ORDER BY open_time` costs nothing.

| Boundary | Cold | Warm |
|---|---|---|
| **server-side** (`EXPLAIN ANALYZE`) | **460.0 ms** | **227.0 ms** |
| buffers | hit 2,881 / **read 1,468** | hit 4,349 / read 0 |

Row count 166,344; the planner estimated 166,265.

**THE COLD/WARM RATIO IS 2.0x, NOT THE "UP TO 10x" THE RULE WARNS ABOUT, AND
THAT IS A LIMITATION OF THE MEASUREMENT RATHER THAN A FINDING ABOUT THE QUERY.**
"Cold" was produced by restarting the container, which empties `shared_buffers`
but **leaves the operating system's page cache intact**. Only 1,468 of 4,349
buffers actually needed reading; the rest were served from a cache the restart
did not clear. A genuinely cold read — cold OS cache too — has not been
measured, and this number must not be quoted as one.

**AND THE BOUNDARY DISTINCTION EARNED ITS KEEP.** Server-side warm execution is
227 ms. The job's **client-observed** read of the same data was **1,655 ms
across 81 month chunks — 7.3x the server figure.** `EXPLAIN ANALYZE` never
measures what the job experiences, which is why the rule requires both.

### The 10,813 agreement — A SHARED-BASIS CHECK, NOT AN INDEPENDENT ONE

`unexpectedBarsExcluded` came out at **10,813** for both timeframes, matching
T1.5's `unexpected_bar` count exactly.

**THIS IS NOT TWO INDEPENDENT IMPLEMENTATIONS AGREEING, AND MUST NOT BE
RECORDED AS ONE.** Both sides ask `expectsBarAt` in `packages/core` which
instant the calendar covers. They share the calendar, the function and the
rules. **A calendar error is therefore INVISIBLE to this check** — both sides
would move together and still agree to the unit.

What it does prove is narrower and still worth having: the aggregation's notion
of "outside the expected grid" is the same notion T1.5 counted, so the two
figures can be quoted side by side without a caveat about scope. That is a
CONSISTENCY check between consumers of one source, not corroboration of the
source.

### 39,684 against T1.5's 39,689 — a FIVE-PERIOD GAP, not "0.01%"

T1.5 recorded 158,756 expected open slots; ÷4 = 39,689. Aggregation reports
39,684 hour-periods. **The difference is 5 periods, and expressing it as 0.01%
hides that it is a small integer with a specific cause waiting to be found.**

Likely candidates, none verified: the two figures cover ranges that differ at
the edges; 158,756 was itself derived (460 bars/week x 345.1 weeks) rather than
counted; and hour-periods are not slots/4 wherever a session boundary falls
mid-hour. **Not investigated, and recorded as open** — five is small enough to
enumerate exactly, and a number that can be enumerated should not be rounded
away.

---

## OQ-24. The write cost — recorded before any write has happened

**No row has ever been written by this job.** The dry run exercised the read and
aggregate paths only.

### The shape of the cost: TWO round trips per row

Every derived row costs two statements, not one:

1. **`upsertCandle`** — the ADR-013 conflict statement.
2. **The `assertRawDatetimePresent` provider lookup** — taken on EVERY derived
   write, because every derived bar carries a NULL `raw_datetime` and the guard
   short-circuits only on a non-empty string (ADR-014).

```
rows to write     38,805 (1H)  +  1,554 (1D)  =  40,359
round trips       40,359 x 2                  =  80,718
```

### The latency, MEASURED rather than assumed

A probe against this database, 3,000 iterations each on one warmed pooled
connection:

```
SELECT 1                    1.1723 ms / round trip
SELECT id FROM providers
  WHERE key = $1            1.3040 ms / round trip
```

**1.17 ms for `SELECT 1` is SLOW for a local server, and that is the
environment rather than the query.** Postgres is in a Docker container reached
over localhost TCP on Windows; the same code against a unix socket or a
co-located server would be substantially faster. **This prediction is specific
to this machine and does not transfer.**

### The prediction

```
guard lookups   40,359 x 1.30 ms                    ~ 52 s
upserts         40,359 x ~1.8 ms  (heavier statement, ~1.4x the
                                   trivial round trip: a large CTE,
                                   an index probe and a write)      ~ 73 s
                                                                   -------
write phase                                                        ~ 125 s
read + aggregate (measured in the dry run)                          ~ 12 s
                                                                   -------
TOTAL WALL CLOCK                                                   ~ 137 s
```

**Predicted range: 100–185 s.** The width is honest: the 1.8 ms upsert figure is
an assumption, not a measurement — the write path has never been run, and
measuring it would have meant running it.

**THE SPINE READ IS NOT A BASIS FOR THIS.** It moved 166,344 rows in 1,655 ms,
which is ~0.01 ms per row — and that is a BULK regime, one statement streaming
many rows. The write path is the opposite: many statements, one row each,
paying full round-trip latency every time. Extrapolating from the first to the
second would predict ~0.4 s and be wrong by two orders of magnitude.

### **THE OQ-22 CACHING THRESHOLD IS PREDICTED TO BE CROSSED**

OQ-22 fixed the threshold in advance: cache the derived provider id if the
lookup cost exceeds **10% of total job wall clock, or 5 seconds absolute,
whichever is the smaller bar to clear**.

**Predicted lookup cost is ~52 s — about 38% of the predicted wall clock, and
more than 10x the absolute bar.** If the run lands anywhere near this, **the
threshold is crossed and caching becomes owed**, on a rule fixed before the
number existed rather than chosen against it.

The constraint recorded with that threshold still binds: a cached id must be
keyed so a different database cannot return a stale one. A module-level `let`
holding a bare number would pass every test — each test process is fresh — and
fail only in a long-lived worker reconnected to a restored database.

### OQ-22's own projection, and why the original was high

| | |
|---|---|
| OQ-22 predicted | ~43,000 guard lookups |
| Projected from the dry run | **40,359** |
| Gap | 2,629 low, ~6% |

**Why the original was high:** it summed the 1H CEILING (41,586, which assumes
every hour complete) and the RAW DAY ESTIMATE (1,802, days that exist) — the
same conflation OQ-19's 1D prediction made. The actual count is COMPLETED
periods: 38,805 + 1,554. **The error is the same one, in a second place, which
is worth more than either instance on its own.**

### What falsifies OQ-24

- **Wall clock outside 100–185 s.** Below means round-trip latency in the write
  path is better than the probe suggests; above means the upsert is heavier than
  1.4x a trivial round trip, or chunk transactions cost more than assumed.
- **Guard lookups ≠ rows produced.** The counter must equal 40,359 exactly; any
  other number means the guard is being taken more or less than once per write.
- **A lookup cost under 5 s** would leave the OQ-22 threshold uncrossed, and
  caching would then NOT be owed — the threshold must be honoured in both
  directions.

---

## THE REAL RUN — 2026-09-08, two runs. Predictions above untouched.

40,359 derived bars written: **38,805 `1h` and 1,554 `1D`**, under `karatx_derived`.
Run 1 inserted every one; run 2 wrote nothing. Backed up first to
`karatx-20260908-175307.dump` (5,138,380 bytes, `migrations: 7`, `providers: 3`).

### OQ-24 — FALSIFIED. 218.4 s against ~137 s predicted, range 100–185 s.

**Outside the range by 18%.** Not adjusted.

```
                     predicted        actual
lookups   40,359 x   1.30 ms  MEASURED
upserts   40,359 x   1.80 ms  GUESSED     ~3.83 ms
                  ----------            ----------
per row              3.10 ms               5.13 ms
write phase          125.1 s               207.2 s
wall clock           ~137 s                218.4 s
```

**TWO OF THE THREE TERMS LANDED EXACTLY.** The lookup latency was measured on
this machine — 1.3040 ms over 3,000 iterations — and the lookup count was
predicted at 40,359 and came back **40,359, to the row**. The upsert term was
the only one never measured, and it carried **82.1 s of the 81.4 s total
error**. Everything that was measured was right; the one thing that was guessed
was wrong by 2.1x.

**THE LESSON IS ABOUT RANGE CONSTRUCTION, NOT ABOUT UPSERTS.** The range
100–185 s was drawn around a total as though its three terms were equally
solid. They were not: two were measurements and one was an assumption, and the
prediction even SAID SO in the sentence beneath it — "the 1.8 ms upsert figure
is an assumption, not a measurement". Having identified the weak term, the range
was still drawn symmetrically around the whole.

**A range should be widened by its weakest term alone.** The upsert term is
~58% of the predicted per-row cost; a factor-of-2 uncertainty on that term
alone spans roughly 90–240 s, which contains the actual. The arithmetic to get
this right was available before the run and was not done. **This is the correct
generalisation, and "upserts are slower than you think" is not** — that reading
would fix one constant and leave the method that produced it intact.

The upsert cost 3.83 ms, **3.27x a trivial round trip**, against the ~1.54x
assumed. It is a large CTE doing an index probe, a multi-column conflict
evaluation, a heap write, maintenance on two indexes, and a WAL flush at each
chunk commit. It was costed as a round trip plus a little.

### THE NO-OP FINDING — larger than the falsification

**Run 2 wrote nothing and cost 194.3 s.**

```
run 1   207.2 s / 40,359 rows = 5.134 ms per row   (all inserted)
run 2   194.3 s / 40,359 rows = 4.815 ms per row   (all noop)
                                -----
difference                       0.319 ms per row
```

**THE WRITE ITSELF IS 6.2% OF THE COST. ROUND TRIP PLUS STATEMENT EVALUATION IS
93.8%.** A no-op upsert — which reads the stored row, evaluates the six-case
conflict predicates, decides to change nothing, and returns — costs 94% of what
a full insert costs.

**THIS REFRAMES WHAT AN OPTIMISATION SHOULD TARGET.** The instinct on seeing
207 s of "write time" is to write less: skip rows already present, diff before
upserting, short-circuit unchanged periods. **Every one of those attacks the 6%.**
A re-run that perfectly skipped all 40,359 writes would still pay ~194 s,
because it would still make 40,359 round trips to discover there was nothing to
do.

**What would actually move it is fewer STATEMENTS, not fewer writes** —
multi-row upserts, so one round trip carries many rows. Nothing here is
implemented and nothing is decided; it is recorded so that the next session
optimises against this measurement rather than against the intuition.

### OQ-22's THRESHOLD IS CROSSED — the derived-provider-id cache is owed

OQ-22 fixed the rule before any number existed: cache if the lookup cost exceeds
**10% of wall clock, or 5 s absolute, whichever is the smaller bar**.

```
40,359 lookups x 1.3040 ms = 52.6 s = 24.1% of 218.4 s
```

**Crossed on both limbs. Caching is owed**, on a rule fixed in advance rather
than chosen against the result.

**STATED HONESTLY: 52.6 s IS THE PROBE FIGURE TIMES THE EXACT COUNT, NOT A
MEASURED IN-SITU SPLIT.** Nothing timed the guard lookup separately from the
upsert inside the run. The count is exact (40,359, from the counter) and the
per-call latency is measured but out of context. **It clears the 5 s absolute
bar by an order of magnitude, so no plausible error in that estimate changes the
verdict** — the lookup would have to be 10x cheaper in situ than on the probe to
fall under it.

**AND IT IS THE SMALLER OF THE TWO AVAILABLE WINS.** Given the no-op finding,
caching the provider id removes one of two round trips per row: at best ~52 s of
218 s. Reducing the number of statements addresses the other ~155 s. Doing the
cache first is defensible because the rule already commits us to it and it is
small and self-contained — but **it must not be recorded as having solved the
cost**, and closing obligation 57 on the strength of it would close the row
against the smaller half.

### OQ-23 — the PLAN is confirmed and stable; the TIMINGS are not

Identical plan on both occasions: `Index Scan using candles_pk`, no Sort node,
no Seq Scan. **ADR-013's no-new-index decision holds at 166,344 rows.**

| Same query, same data | dry run | real run |
|---|---|---|
| cold (server-side) | 460.0 ms | **1,153.7 ms** |
| warm (server-side) | 227.0 ms | **406.6 ms** |

**2.5x and 1.8x apart, for the same statement over the same rows.** "Cold" here
controls `shared_buffers` only — a container restart empties it and leaves the
operating system's page cache, whose state differed between the two occasions
(a full `pg_dump` had just read the entire database before the second).

**NO SINGLE FIGURE SHOULD BE QUOTED AS THE COST OF THIS QUERY.** The stable,
predicted, load-bearing result is the PLAN SHAPE. The timings are an
environment measurement that happens to vary by more than 2x, and quoting one
of them as "the" cost would be quoting noise. A genuinely cold read — cold OS
cache too — still has not been measured.

### THE VERIFICATIONS

On a fresh connection, after run 1:

```
provider_id | timeframe | count
          1 | 15min     | 166344   UNCHANGED
          1 | 1D        |   1449   UNCHANGED
          1 | 1h        |   1911   UNCHANGED
          3 | 1D        |   1554
          3 | 1h        |  38805
```

- `raw_datetime IS NULL` = **40,359**, exactly the derived row count
- vendor rows holding a NULL `raw_datetime` = **0** — the ADR-014 guard held
- derived rows with `NOT is_final` = **0**
- `provider_instruments` = **2**
- `data_quality_events` = **14,097**, unchanged: zero conflicts, zero rejections

#### Idempotency, four assertions — and one stronger than asked for

Run 2 returned `noop` for all 40,359 rows and **did not throw**, which is the
10b partition-operand fix working outside a test.

| | before run 2 | after run 2 |
|---|---|---|
| rows | 40,359 | **40,359** |
| min/max `ingested_at` | 17:53:50.147620 / 17:57:22.804213 | **identical** |
| min/max `updated_at` | 17:53:50.147620 / 17:57:22.804213 | **identical** |
| `data_quality_events` | 14,097 | **14,097** |

**AND AN md5 OVER EVERY DERIVED ROW'S `(timeframe, open_time, ingested_at,
updated_at)`, IDENTICAL ACROSS BOTH RUNS** — `b869a063d63452b1afaea9649930b460`.

**That is strictly stronger than min/max, and the difference is the point.**
Extremes can hold while rows move: rewrite half the rows and set their
`updated_at` to a value already inside the range, and min and max are unchanged
while the table has been rewritten. The md5 covers every row individually, so it
cannot hold under that. A prices md5 was also identical, and
`updated_at > ingested_at` returns **0 rows** — no derived row has ever been
rewritten.

#### The derived 1D boundary, OBSERVED rather than reasoned

```
derived 1D (provider 3)     vendor 1D (provider 1)
  22:00Z   1,053              00:00Z   1,449
  23:00Z     501
  00:00Z       0
```

22:00Z and 23:00Z are 18:00 New York under EDT and EST. **Zero derived daily
bars sit at 00:00Z, where all 1,449 vendor daily bars sit.**

Obligation 49 argued from the primary key that these are different objects that
no filtering reconciles. **This is that argument confirmed by observation**: the
two series coexist in one table, share a `timeframe` value, and overlap at no
instant at all. It also makes obligation 12's warning concrete — an unscoped
`WHERE timeframe = '1D'` now returns 3,003 rows from two incompatible
definitions, and will look entirely reasonable.
