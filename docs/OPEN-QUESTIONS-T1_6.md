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
