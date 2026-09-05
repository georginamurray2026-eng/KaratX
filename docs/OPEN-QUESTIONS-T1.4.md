# Open questions — T1.4 first contact with Twelve Data

**Written 2026-09-04, BEFORE the first real API call.** That is the whole point
of the file.

Ten things about Twelve Data are currently unmeasured. The first live request
will answer several of them at once, and once it has, nobody can tell which
answers were **predicted** and which were **discovered** — the code will simply
look correct either way. So each question is recorded here with a prediction and
a confidence, in advance.

**This is the same discipline that produced ADR-008's most useful findings.**
Every important number in T1.1 contradicted or refined its documentation:
"since 1980" turned out to apply to daily bars only, Massive served intraday its
pricing page denied, and EODHD served less than implied. This project's recorded
lesson is that **vendor documentation is a starting point, not evidence** — and
it has been wrong in the deciding direction twice.

**How to close one:** replace its *Status* with `ANSWERED <date>`, record what
was actually observed, and say plainly whether the prediction held. **Do not
edit the prediction.** A prediction rewritten after the fact is worth nothing,
and the wrong ones are the valuable half.

---

## The questions

| # | Question | Prediction | Confidence | Status |
|---|---|---|---|---|
| **OQ-1** | Is the free tier really **8 credits/minute and 800/day**? | Yes, both hold | Medium — pure vendor documentation ([DATA_SOURCES.md:50](./DATA_SOURCES.md#L50)), never tested. This project has already caught two entitlements that differed from their pricing pages | **PARTIAL 2026-09-04** |
| **OQ-2** | Does a 429 carry a **`Retry-After` header**? | No | Low — genuinely a guess. Many JSON APIs omit it | **OPEN** |
| **OQ-3** | What does an **error body** actually look like? | `{"code":429,"message":"...","status":"error"}` | Low — written from documentation. The synthetic fixture is labelled as such in `test/fixtures/providers/manifest.json` | **OPEN** |
| **OQ-4** | Are there **credit-accounting headers** (`api-credits-used`, `x-ratelimit-remaining`)? | Probably not | Low. The client captures them if present, which is how this gets answered | **ANSWERED 2026-09-04 — PREDICTION WRONG** |
| **OQ-5** | At `1day`, is `datetime` **`2025-07-06`** or **`2025-07-06 00:00:00`**? | Date-only | Medium. No `1day` time_series response has ever been captured. The parser accepts both, deliberately | **ANSWERED 2026-09-05 — held (date-only)** |
| **OQ-6** | Does a page **always fill to `outputsize`** when more bars exist? | Yes | Medium. The backfill deliberately does NOT rely on this — it terminates on "the frontier did not advance", at a cost of one extra request per run | **ANSWERED 2026-09-05 — held (a page returned exactly 5,000)** |
| **OQ-7** | Are **`start_date` / `end_date` inclusive**? | Inclusive both ends | Medium. If `start_date` turns out to be exclusive the overlap bar disappears, the run still works, and the resume path silently stops re-proving idempotency — a quiet degradation worth checking for directly | **ANSWERED 2026-09-04 — held** |
| **OQ-8** | Is **`order=ASC` honoured**? | Yes | Medium. The recorded 2026-08-27 response is DESCENDING, but it was fetched without the parameter. `assertAscending` fails loudly if not — this is the one question whose wrong answer cannot pass silently | **ANSWERED 2026-09-04 — held** |
| **OQ-9** | Is **`outputsize` capped at 5000 at every interval**? | Yes | Medium. Measured at `15min` only ([STATUS.md:1654](./STATUS.md#L1654)). If `1day` caps lower, the parity fetch needs more than one request | **STILL OPEN 2026-09-05 — the 1D window returned 1,449 bars, far below the cap, so nothing tested it** |
| **OQ-10** | Does a **5,000-bar page cost 1 credit**, or does cost scale with size? | 1 credit per request regardless of size | Medium. If it scales, the full backfill is ~175–235 credits instead of 35–47 — still inside 800/day, so no decision changes either way | **PARTIAL 2026-09-04** |

---

## FIRST CONTACT — 2026-09-04, one request

`pnpm first-contact` → `apps/worker/src/bin/first-contact.ts`. One `GET
/time_series`, HTTP 200, 3 bars, 496 bytes. Captured in full at
`var/captures/first-contact-2026-09-04T16-50-27-689Z/`.

```
symbol=XAU/USD  interval=15min  timezone=UTC  format=JSON
start_date=2026-08-27 03:00:00  end_date=2026-08-27 03:30:00
outputsize=10  order=ASC
```

**Predictions above are unedited.** Only the *Status* column moved.

| # | Predicted | Observed | Held? |
|---|---|---|---|
| **OQ-1** | 8/min and 800/day both hold | `api-credits-used: 1`, `api-credits-left: 7` — the provider reports its **own** per-minute budget as 8. **The 800/day half was not observed at all**: no header reports a daily figure | **per-minute half held. Daily half UNTESTED** |
| **OQ-2** | No `Retry-After` on a 429 | **No 429 occurred.** Nothing observed | **UNANSWERED — stays OPEN** |
| **OQ-3** | `{"code":429,...,"status":"error"}` | **No error occurred.** Nothing observed | **UNANSWERED — stays OPEN** |
| **OQ-4** | Probably no credit headers | **`api-credits-used` and `api-credits-left` are both present.** No `x-ratelimit-*`, no `retry-after` | **WRONG.** The headers exist |
| **OQ-5** | `1day` datetime is date-only | Not requested | **UNANSWERED — stays OPEN** |
| **OQ-6** | A page fills to `outputsize` | Asked for 10, window contained 3, got 3. **This settles nothing** — the window was the limit, not the page | **UNANSWERED — stays OPEN** |
| **OQ-7** | `start_date` and `end_date` inclusive | `start_date` was set to a bar open time known to exist. **That bar came back as the first of three.** The last bar equals `end_date` | **HELD, both ends** |
| **OQ-8** | `order=ASC` honoured | Three bars ascending; `assertAscending` passed | **HELD** |
| **OQ-9** | `outputsize` caps at 5000 everywhere | Not tested at `1day` | **UNANSWERED — stays OPEN** |
| **OQ-10** | A 5,000-bar page costs 1 credit | A **3-bar** request cost exactly 1 credit. **This does not establish the 5,000-bar case**, which is the case the question asks about | **PARTIAL — the size question stays OPEN** |

### OQ-4 is the wrong prediction, and it is the useful one

The credit headers exist, which means **credit consumption is directly
observable on every response** rather than inferable from a request count. The
client already captures both. Two consequences:

- **OQ-1's per-minute half is now evidenced from the provider's own accounting**
  — 1 used + 7 left = 8 — rather than from the pricing page. That is a better
  class of evidence than this project had for any rate figure before today.
- **The full backfill can count its own credits as it goes**, so the cost
  estimate becomes measurable during the run instead of afterwards.

### A DISCREPANCY THIS CALL FOUND AND DID NOT RESOLVE

**The live response and the committed fixture disagree about the same bar.**

| `2026-08-27 03:00:00` | open | high | low | close |
|---|---|---|---|---|
| Fixture, recorded 2026-08-27 | 4590.92663 | 4596.43317 | 4589.80772 | 4593.90226 |
| Live, 2026-09-04, `timezone=UTC` | 4629.33225 | 4634.77938 | 4628.98671 | 4634.04513 |

Roughly **38 points apart, about 0.8%**, on a bar carrying the same timestamp
string. **This is not resolved and must not be resolved by reasoning.** Two
hypotheses fit what is on the table, and they have opposite consequences:

1. **The fixture was recorded WITHOUT `timezone=UTC`.** Its `03:00:00` would
   then be Australia/Sydney (UTC+10) — the account default — and therefore the
   instant `2026-08-26 17:00 UTC`. A different bar entirely, so different prices
   are expected and nothing is wrong with the provider. This would make the
   fixture's timestamps unusable as UTC and would be a vivid demonstration of
   exactly why `timezone=UTC` is sent unconditionally.
2. **Twelve Data restated this history.** That is ADR-008's first reversal
   condition, and it would matter a great deal.

**Nothing recorded with the fixture can distinguish them, and that is its own
finding:** `manifest.json` records the endpoint and the capture date but **not
the request parameters**, so a recorded response cannot be interpreted after the
fact. Raised as **obligation 45**.

**What would settle it, in one request:** ask for
`start_date=2026-08-26 17:00:00`, `end_date=2026-08-26 17:30:00`, `timezone=UTC`.
If those bars carry the fixture's prices, hypothesis 1 is confirmed and the
provider is fine. If they do not, hypothesis 2 stands and the reversal condition
is live. **Not run — this is step 7 and step 7 was one request.**

---

## OQ-11 — the fixture/live discrepancy. PREDICTION WRITTEN BEFORE THE CALL.

**Written 2026-09-04, before the request. Do not edit after.**

**The question.** The committed fixture and the live API disagree by ~38 points
(~0.8%) about the bar stamped `2026-08-27 03:00:00`. Either the fixture was
recorded without `timezone=UTC` — making its `03:00` Australia/Sydney and
therefore `2026-08-26 17:00 UTC`, a different bar — or Twelve Data restated
finalised history.

**The test, shaped so no inference is available.** Request
`start_date=2026-08-26 17:00:00`, `end_date=2026-08-26 17:30:00`,
`timezone=UTC`. If the fixture is UTC+10, its three bars at 03:00 / 03:15 /
03:30 are these three bars, and all four prices on all three must match
byte-for-byte.

- **Prices MATCH** → hypothesis 1. The fixture was captured without
  `timezone=UTC`; its timestamps are Australia/Sydney; the provider is fine.
- **Prices DIFFER** → hypothesis 1 is dead.

**PREDICTION: they will MATCH. Hypothesis 1.**

**Confidence: medium-high.** The reasoning, so it can be judged rather than
taken:

1. **The UTC+10 default was a T1.1 DISCOVERY, not a starting assumption.**
   ADR-008's process lessons say so directly: *"`symbol_search` returns
   `exchange_timezone: "Australia/Sydney"` … Both T1.1 anomalies were explained
   by that one call. The UTC+10 default was never undocumented; we had not
   looked it up."* A parameter nobody knew to send is a parameter that was not
   sent, and the fixture was recorded the same day.
2. **"Pass `timezone=UTC` explicitly on every request" is recorded as an ADAPTER
   REQUIREMENT PRODUCED BY T1.1, for T1.4 to implement** — not as a description
   of what the exploration already did. A requirement written for the future
   implies the past did not meet it.
3. **A 0.8% move in ten hours of gold is unremarkable; a 0.8% restatement of
   finalised history by a data vendor is not.** This is the weakest of the three
   and is deliberately listed last: it is a prior about which world we are in,
   not evidence about this bar. Price plausibility alone cannot discriminate,
   because both candidate values sit inside the range gold traded that week.

**What I am NOT predicting.** If the prices differ, hypothesis 1 is dead and
that is all that follows. There is no third explanation prepared here, and
reaching for one in the same breath as the result is how a refuted hypothesis
gets quietly replaced instead of recorded.

**If hypothesis 1 confirms, the consequence is not "mystery solved."** The
fixture is committed and used in tests, and its timestamps would be
Australia/Sydney while every consumer reads them as UTC. What that has actually
affected is a separate question, answered below rather than assumed either way.

| Status | **ANSWERED 2026-09-04 — see the result below** |
|---|---|

### OQ-11 RESULT — 2026-09-04. The prediction did not hold, and MY TEST WAS BADLY DESIGNED.

Requested `2026-08-26 16:30:00 .. 17:30:00`, `timezone=UTC`. Five bars returned.
Capture: `var/captures/oq11-timezone-2026-09-04T17-00-39-441Z/`.

| Fixture bar | Mapped to | Result |
|---|---|---|
| 02:30:00 | 2026-08-26 16:30:00 | **MATCH** — all four prices byte-for-byte |
| 02:45:00 | 2026-08-26 16:45:00 | **MATCH** |
| 03:00:00 | 2026-08-26 17:00:00 | **MATCH** — the bar the whole discrepancy was about |
| 03:15:00 | 2026-08-26 17:15:00 | **MATCH** |
| 03:30:00 | 2026-08-26 17:30:00 | **DIFFERS**, in `low` and `close` only |

**Predicted: all match. Observed: 4 of 5. THE PREDICTION DID NOT HOLD as stated.**

**And the reason it did not hold is a flaw in the test, not a surprise in the
data.** I wrote the check as "every bar matches or the hypothesis is dead",
which silently welded together two different claims:

1. the fixture's timestamps are UTC+10, and
2. every bar in that window is unchanged since capture.

Those are separable, and the LAST bar of a captured window is precisely the bar
least likely to satisfy (2). A binary that cannot fail for only one reason is
not the binary it claims to be — the same shape as the SQL `CASE` incident in
LESSONS, where the case chosen to demonstrate a rule was the one case that could
not.

### What IS settled

**The timezone mapping is confirmed, and this is not inference.** Sixteen
independent price strings — four bars × four fields, float32 rendered to nine
significant figures — match **byte-for-byte** at a ten-hour offset. That is not
a coincidence available to any competing explanation.

**So the fixture's timestamps are Australia/Sydney, not UTC**, and the ~38-point
gap that started this is fully accounted for: `2026-08-27 03:00:00` in the
fixture and `2026-08-27 03:00:00` from the live API are different instants, ten
hours apart.

**And history is NOT being restated across those four bars.** They are unchanged
over nine days.

### What is NOT settled — OQ-12, raised, NOT explained

**Bar 5 differs, and I am not calling it.** Field by field:

| | fixture | live | |
|---|---|---|---|
| open | 4596.85627 | 4596.85627 | identical |
| high | 4602.35641 | 4602.35641 | identical |
| low | 4596.85575 | 4596.01066 | **−0.84509** |
| close | 4597.73864 | 4596.31582 | **−1.42282** |

It is the NEWEST bar in the fixture, `open` and `high` are untouched, and the
`low` moved DOWN — the only direction a running minimum can move. Every field is
consistent with the fixture having captured that bar while it was still forming.

**That is a hypothesis with a testable signature, and it is not a finding.** It
is written here as OQ-12 rather than asserted, because "consistent with" is what
this project's own lessons warn about: the retracted "weekday series changed
venue" claim was also consistent with its evidence and was also wrong.

**ADR-008's first reversal condition is therefore NOT cleared.** It is narrowed
to a single bar with a specific shape, and narrowing is not clearing.

**OQ-12, and the test that would settle it:** does `/time_series` return the
currently-forming bar? Fetch a window ending at the present moment, wait past a
bar boundary, fetch again. If only the newest bar's `low`/`close` move while
older bars stay byte-identical, forming bars are returned and bar 5 is explained.
If nothing moves, they are not, and a changed final bar is a restatement — which
is the reversal condition, live.

**Two requests, not one, so it has not been run.**

### What this means for the committed fixture

It is used by `parse.test.ts` and `client.test.ts`. Both read it for **price
text and relative ordering** — byte-for-byte preservation, descending order,
null volume. **Neither depends on the absolute instant being UTC**, so no test is
wrong today and nothing needs re-recording.

**What IS wrong is the label.** `manifest.json` calls it a recorded response and
says nothing about its timezone, so the next person to read a timestamp out of
it as UTC will be ten hours out with no warning. That is obligation 45 exactly —
a recorded response without its request parameters — now with a demonstrated
cost rather than a hypothetical one. The fixture needs **relabelling, not
re-recording**.

| Status | **PARTIAL 2026-09-04 — timezone CONFIRMED; bar 5 unresolved, see OQ-12** |
|---|---|

---

## OQ-12 — does `/time_series` return the FORMING bar? PREDICTION BEFORE THE CALLS.

**Written 2026-09-04 17:10 UTC, before either request. Do not edit after.**

**The question.** Obligation 46: the fixture's newest bar changed between
2026-08-27 and 2026-09-04, in `low` and `close` only. Either `/time_series`
returns the in-progress bar (so the fixture caught it mid-formation and nothing
is wrong), or Twelve Data restated a finalised bar (ADR-008's first reversal
condition, live).

**The test.** Request a window ending now; wait past a 15-minute boundary;
request the SAME window again.

**TWO ASSERTIONS, KEPT APART — this is what OQ-11 got wrong.** That test welded
"the timezone maps" onto "every bar is unchanged" and could not fail for one
reason alone. These are separate claims with separate meanings:

- **A — older bars** (everything except request 1's newest): must be
  byte-identical across both calls.
- **B — the newest bar of request 1**: does it change, and in the FORMING
  SHAPE — `open` unchanged, `high` non-decreasing, `low` non-increasing, `close`
  free?

**A LIVENESS CONTROL, because the ambiguity is available again.** If the market
is closed, the newest bar is a completed Friday bar that will not change, and
that looks *identical* to "forming bars are not returned" while proving nothing.
So request 1's newest bar must be **recent** — within roughly one bar of now. If
it is not, **the result is INCONCLUSIVE and must be reported as inconclusive**,
not as "unchanged". At the time of writing it is Friday 13:09 New York and gold
trades until 17:00 NY, so the control is expected to pass; it is asserted rather
than assumed.

**PREDICTION: forming bars ARE returned. A holds, B changes in the forming shape.**

**Confidence: medium-high.** Reasoning, so it can be judged:

1. **Bar 5's signature is already forming-shaped**, and specifically the `low`
   moved in the *only* direction a running minimum can move. That is the
   observation that raised the question, so it is evidence for the hypothesis
   but not independent of it.
2. **Twelve Data's response carries NO finality flag at all.** ADR-005 mapped
   OANDA's `complete` flag onto our `is_final`; ADR-008 replaced the provider and
   nothing replaced the flag. A feed that returns only closed bars has no need of
   one; a feed that returns the partial bar does — and this one has none either
   way, which is a hazard regardless of the answer.
3. Returning the in-progress bar is the common default for intraday market-data
   APIs.

**THE CONSEQUENCE, PREDICTED NOW SO IT IS NOT RETROFITTED.** If this holds it is
**not a clean win**. It explains bar 5 *and* exposes a live defect in T1.4 as
written: `toCandleInput` sets `isFinal: true` for **every** bar, so a backfill
running to the present stores the forming bar as final. Its own comment says
this — *"ALWAYS FINAL … if `applied` or `rejected` appear in a backfill's counts,
this line is wrong"* — and that would be exactly the case.

**A sub-prediction, as a check on my own design:** the defect should be
SELF-DETECTING rather than silent. The stored forming bar becomes the frontier;
the next run re-requests it, receives the completed values, and the upsert
returns `conflict` — and `CONFLICT_THRESHOLD = 1` stops the run loudly. If that
is right, the threshold-of-one decision earns itself here. **If instead this
would corrupt history quietly, my design is worse than I thought and I should
say so.**

**What I am NOT predicting.** If assertion A fails — older bars differ — then
neither hypothesis is supported and I will stop and report that, without
assembling a third explanation in the same breath.

| Status | **ANSWERED 2026-09-04 — see the result below** |
|---|---|

### OQ-12 RESULT — 2026-09-04. Prediction HELD. And it is not a clean win.

Two requests, 17:12:04Z and ~17:15:44Z, same window. Capture:
`var/captures/oq12-forming-2026-09-04T17-12-04-048Z/`.

**LIVENESS CONTROL PASSED** — newest bar 12 minutes old against a 30-minute
tolerance, Friday 13:12 New York. The result therefore means something; with the
market closed it would not have.

**ASSERTION A — older bars byte-identical: HOLDS.** Five bars, twenty price
strings, unchanged across both calls.

**ASSERTION B — the newest bar changed, in the forming shape:**

| `2026-09-04 17:00:00` | request 1 | request 2 | |
|---|---|---|---|
| open | 4436.88876 | 4436.88876 | unchanged ✓ |
| high | 4436.88876 | 4436.88876 | non-decreasing ✓ |
| low | 4430.07132 | 4430.07132 | non-increasing ✓ |
| close | 4432.29625 | **4433.57989** | free ✓ |

**`/time_series` RETURNS THE FORMING BAR.** The fixture's bar 5 is explained:
it was captured mid-formation. **Obligation 46 discharges, and ADR-008's first
reversal condition is CLEARED** — not narrowed, cleared. Twelve Data did not
restate anything.

### THIS IS NOT A CLEAN WIN — obligation 47

The same fact that explains bar 5 exposes a **live defect in T1.4 as written**,
and it was predicted before the call rather than discovered afterwards:

`toCandleInput` sets `isFinal: true` for **every** bar. A backfill running to
the present therefore stores the **forming** bar as **final** — partial values
recorded as settled history. The function's own comment already states the
condition it violates: *"ALWAYS FINAL … this is why `applied` and `rejected`
must never appear in a backfill's counts — if they do, this line is wrong."*

**My sub-prediction was that the defect is self-detecting rather than silent,
and that is right but understated.** Reasoning from the code — **not yet
demonstrated by a test, which is the honest status**:

1. The forming bar is stored final and becomes the frontier.
2. The next run resumes at that bar, re-requests it, and receives the completed
   values.
3. The upsert sees a stored **final** bar re-delivered with different values →
   `conflict`.
4. `CONFLICT_THRESHOLD = 1` stops the run loudly.

**So the threshold-of-one decision earns itself here** — with a tolerant
threshold the corrupt bar would be absorbed and the wrong values would stay in
`candles` permanently and silently.

**But "self-detecting" undersells the consequence: it is a self-inflicted
deadlock.** The conflict is on the frontier bar, which is the first bar of every
subsequent run's first page. Every future backfill hits the same conflict and
refuses. The backfill would be permanently blocked until someone deleted the
row — and the fastest reading of that at 3am is "the provider is restating
history", which is exactly the wrong conclusion.

**THE FIX IS NOT APPLIED HERE.** It is recorded as obligation 47 and must land
before step 8.

### One observation, recorded and NOT interpreted

Request 2 ran at ~17:15:44Z and returned **no `17:15` bar** — the newest was
still `17:00`. So a new bar was not yet available more than 45 seconds after its
boundary. That is an observation about publication lag, it was not a question
this test was shaped to answer, and it is written down rather than concluded
from. It matters for T1.7's live feed, not for T1.4.

| Status | **ANSWERED 2026-09-04 — prediction HELD; obligation 46 discharged, obligation 47 raised** |
|---|---|

---

## STEP 8 — the parity fetches, 2026-09-05. SIX requests, not three.

Expectations were printed before each request and checked after.

| | expected | observed | |
|---|---|---|---|
| 15m bars | ~1,980 | **1,982** | ✓ |
| 15m window | 2026-08-13 → 2026-09-02 15:15 | exactly that | ✓ |
| 15m warm-up before first golden | ≥1,000 | **1,479** | ✓ |
| 1H bars | ~1,910 | **1,911** | ✓ |
| 1H warm-up | ≥1,000 | **1,455** | ✓ |
| 1D bars | ~1,430 | **1,449** | ✓ |
| 1D warm-up | ≥1,000 | **1,043** | ✓ |
| `applied` | 0 on every leg | **0 on every leg** | ✓ |
| requests | 1 per leg | **2 per leg** | ✗ |

**Weekend bars stored, counted and NOT filtered** — the calendar is T1.5 and does
not exist yet, so these are expected: **15m 576, 1H 528, 1D 151.** A number for
T1.5 to work against.

### Why it took six requests, and it is my error not the job's

`runBackfill` sends `end_date` whenever `to` is set. The step-8 script's own
comment asserted it does not — **I asserted a behaviour of code I wrote without
reading it.** With `end_date` sent, the response stops exactly at `to`, so
nothing in it proves the last bar closed, so that bar is stored FORMING and the
frontier never reaches `to` — costing a second request.

The job behaved correctly and conservatively throughout. The prediction was
wrong.

### Consequence, and it matters for parity — obligation 48

**The last golden bar of the 15m and 1H legs is stored FORMING:**
`15min 2026-09-02 15:15:00` and `1h 2026-09-02 14:00:00`. Both are the LAST BAR
OF THE FIXTURE RANGE, both closed days ago, and both sit in the database marked
unsettled. Parity must not compare against a bar the system considers still
moving.

### OQ-5 — HELD

Predicted **DATE-ONLY**. Observed `"2021-09-02"`, `"2021-09-03"`, `"2021-09-06"`.
Date-only.

### OQ-9 — NOT ANSWERED, stays OPEN

The 1D window returned 1,449 bars, far below 5,000, so nothing tested the cap.
Not closed on inference from the 15m calls.

### OQ-10 — stronger, still not closed

A **1,982-bar page cost exactly 1 credit** (`api-credits-used` 0→1), as did a
1,450-bar page. That is far better evidence than the 3-bar request, and it is
still not the 5,000-bar page the question asks about. **Partial.**

**Credits: 6 used for 6 requests, one per request regardless of page size.** The
step-8 estimate was 3 credits; the shortfall is entirely the extra request per
leg described above.

### THE FINDING THAT CHANGES A DECISION — obligation 49

**The fetched 1D series shares NO TIMESTAMP with the golden fixture. Not one.**

| | |
|---|---|
| Fetched 1D bars at `21:00Z` (the fixture's alignment) | **0** |
| Fetched 1D bars at `00:00Z` | **1,449** |
| Fixture 1D bars | all at `21:00Z` |

Twelve Data's `1day` `datetime` is date-only, so its daily bars are **UTC-day
bars**. The fixture's daily bars open **21:00Z = 17:00 America/New_York**, the
trading-day boundary confirmed three independent times (C2). These are not the
same object, and no filtering reconciles them — a UTC day and a 17:00-NY day
cover different sixteen-hour overlaps of different sessions.

**So "1D fetched, not derived" does not achieve what it was chosen for.** The
cost arithmetic behind that decision was right — 1 request against 27–36 — but
the cheap thing turns out not to be the thing needed. **A 1D series comparable
to the fixture can only be built by aggregating 15M bars on a 17:00-NY boundary,
which is T1.6 on top of T1.5's calendar.**

**And that restores the cost.** Obligation 41 needs 1,000 daily bars of warm-up
before 2025-07-06, so aggregation needs 15M history from ~2021 — the ~135,000
bars and 27–36 requests the fetch was chosen to avoid.

**What the fetched 1D series IS still good for:** exactly what ADR-008 already
provides for — a regression comparator for T1.6's aggregation, on the days where
a UTC day and a trading day happen to align. It is kept, not discarded, and it
is not obligation 41's 1D leg.

---

## STEP 9 — the full 6.6-year 15M backfill. PREDICTIONS BEFORE THE RUN.

**Written 2026-09-05, before the run starts. Do not edit after.**

**Mode.** `from = 2020-01-24 13:00` (the measured earliest 15min bar),
`resumeFrom: 'from'`, no `to` — so the run walks from 2020 to the present. The
frontier is currently 2026-09-02 15:15 (the parity window), which is AHEAD of
where the history starts, so an ordinary resumed run would fetch nothing
historical. This is the one case where starting at `from` is the ordinary thing
rather than a re-verification.

### The numbers

| | prediction | reasoning |
|---|---|---|
| **Requests** | **36** (range 34–40) | ~174,200 bars ÷ 5,000 = 35 data pages, + 1 terminating page that advances nothing |
| **Wall clock** | **~10 min** (range 6–20) | The pacer is 7/min = 8.57 s between requests, but ~5,000 upserts per page at the ~3 ms/bar seen in step 8 is ~15 s of database work per page. **I expect the DATABASE to be the binding constraint, not the rate limit** — which would mean the pacer never waits |
| **Credits** | **36**, one per request | 8 already used today, so ~44 of 800 |
| **`applied`** | **~35** — one per page boundary | Each page's last bar is stored forming and finalised by the next page. **It should track the request count.** Far above that means bars are being re-formed |
| **`noop`** | **~2,020** | The 1,982 existing parity bars re-offered, plus ~35 page-boundary overlaps |
| **`inserted`** | **~172,200** | |
| **Total stored, 15min** | **~174,200** | 5.39 yr × 24,342 (weekday-only era) + 1.23 yr × 35,071 (24/7 era) |
| **Weekend bars** | **~12,000** (range 10,000–13,000) | 0 before the mid-2025 synthesis boundary; ~448 days after × 2/7 × 96 |
| **`conflict`** | **0** | |

### What I expect at the overlap — watch item 2

The 15min table already holds **1,982 final bars from 2026-08-13 to 2026-09-02
15:15**, fetched yesterday. When the run reaches that range it re-offers them.

**Every one should be `noop`** — identical values, nothing written. A `conflict`
there would mean Twelve Data restated a finalised bar between yesterday and
today, which is ADR-008's first reversal condition, and `CONFLICT_THRESHOLD = 1`
stops the run at the first one. **On a fresh range a conflict is unreachable;
here it is reachable, and that is exactly why the overlap is worth watching.**

Beyond 2026-09-02 15:15 the run continues to the present: ~2.7 days × 96 ≈ **260
new bars**, inserted.

### OQ-6 — does a page fill to `outputsize`?

**PREDICTION: YES.** With ~174,000 bars available and `outputsize=5000`, an
early page should return exactly 5,000. This is the first request that can
answer it: every previous window held fewer bars than the cap, so the window was
always the limit rather than the page.

### OQ-9 — is `outputsize` capped at 5,000 at every interval?

**PREDICTION: this run RE-CONFIRMS 15min AND DOES NOT ANSWER THE OPEN HALF.**

Stating it now so the result is not over-read afterwards. OQ-9 asks about *every
interval*, and its live doubt is `1day` — 5,000 was already measured at `15min`
in T1.1. **This is a 15min run.** A 5,000-bar page here is a re-confirmation at
scale of something already known, not the answer to the question.

**OQ-9 stays OPEN unless a `1day` request returns 5,000 bars, and this run makes
none.** Recorded in advance precisely because "we saw a 5,000-bar page" will
look like the answer once it happens.

### OQ-1 — watch item 3

The pacer runs at 7/min against a documented 8, and the daily 800 has never been
tested. **A 429 would mean the per-minute figure is wrong or the daily half is
lower than documented.** If one arrives the headers get reported, not retried
through silently — `api-credits-used` / `api-credits-left` are on every response
and the capture keeps them.

**And I expect no 429 at all**, because the database is slower than the pace.

| Status | **ANSWERED 2026-09-05 — see the result below** |
|---|---|

### STEP 9 RESULT — 2026-09-05. THE RUN ABORTED AT ONE REQUEST. Two findings.

`pnpm backfill`. Failed after 24 seconds and one request, on a conflict.
**Most predictions cannot be evaluated because the run never got past page 1** —
recorded as unevaluable rather than as misses.

| | predicted | actual | |
|---|---|---|---|
| Requests | 36 | **1** | run aborted |
| Wall clock | ~10 min | **24 s** | run aborted |
| Credits | 36 | **1** | run aborted |
| `applied` | ~35 | — | unevaluable |
| `noop` | ~2,020 | — | unevaluable |
| Total 15min bars | ~174,200 | **4,740** | run aborted |
| Weekend bars | ~12,000 | — | unevaluable |
| **`conflict`** | **0** | **1** | **PREDICTION WRONG** |

**OQ-6 — ANSWERED, prediction HELD.** Page 1 returned **exactly 5,000 bars**, so
a page does fill to `outputsize`. Every previous window held fewer bars than the
cap, so this is the first request that could answer it.

**OQ-9 — as predicted, NOT answered.** The 15min cap is re-confirmed at scale;
the live doubt is `1day` and this run made no `1day` request. **Stays OPEN.**

**OQ-1 — NOT tested.** One request cannot exercise a per-minute limit. No 429.

---

### FINDING 1 — `outputsize` anchors to the NEWEST bars, not to `start_date`

```
sent:     start_date=2020-01-24 13:00:00   outputsize=5000   order=ASC
returned: 5000 bars, first 2026-07-15 06:30, last 2026-09-05 08:15
```

**The response is the most recent 5,000 bars in the range, not the oldest
5,000.** 5,000 × 15 min back from now lands exactly on 2026-07-15.

**FORWARD PAGING FROM AN OLD `start_date` IS THEREFORE IMPOSSIBLE AS DESIGNED.**
`runBackfill` advances by moving `start_date` forward and expecting the next
slice; with this anchoring it gets the same recent window every time. The
frontier would jump straight to the present on page 1 and the run would report
`complete` having fetched none of the history.

**This did not silently succeed only because the conflict stopped it first.**
That is luck, not design: had the overlap been clean, the run would have
terminated normally and reported success while storing 5,000 recent bars
instead of 174,000 historical ones. **A run that reports success while doing
almost nothing is the worst failure shape this project has.**

**Never observed before because every prior window held fewer bars than the
cap** — the window was always the limit, so the anchoring never showed.

---

### FINDING 2 — Twelve Data RESTATES FINALISED BARS, and it is not confined to weekends

The conflict was at `2026-08-15 21:15:00`, a Saturday. **The obvious reading is
that synthetic weekend bars are unstable — and the measurement refutes it.**

Comparing yesterday's parity capture against today's backfill capture,
**provider text against provider text**, with our storage not involved:

| | |
|---|---|
| Overlapping bars compared | **1,983** |
| Byte-identical | **1,979** (99.8%) |
| **Differing** | **4** |
| — of which weekend | **1** |
| — of which **WEEKDAY** | **3** |

```
2026-08-15 21:15 [WEEKEND]  high  4379.85286 -> 4375.79166
2026-08-26 13:00 [weekday]  low   4605.22464 -> 4608.92659
2026-09-01 06:30 [weekday]  high  4438.39980 -> 4437.27763
2026-09-01 06:45 [weekday]  high  4438.80563 -> 4435.41653
```

**Every change NARROWS the bar**: `high` fell three times, `low` rose once.
Both are running extremes that cannot move that way while a bar is forming, so
this is not a forming-bar effect — these are settled bars being revised, within
about thirty minutes.

**I AM NOT CALLING THIS ADR-008's FIRST REVERSAL CONDITION.** That condition
names the weekday series *changing the way weekends changed in 2025* — a venue
shift, detected by sustained normalised divergence well outside 9–11% of bar
range. This is 0.2% of bars revised by a few dollars, consistent with a vendor
trimming outlier ticks. Different in kind and in scale. Calling it the reversal
condition would be reaching for the largest available explanation.

**But it defeats `CONFLICT_THRESHOLD = 1` completely.** Any run that re-offers
previously-fetched bars will meet one of these and stop. At 0.2%, a 174,000-bar
backfill crossing its own overlap has effectively no chance of completing.

**The threshold-of-one reasoning was: "on a first backfill a conflict is
unreachable, so on a re-run it means the provider restated history — not a bar
to skip."** The premise was right and the implied conclusion was wrong:
restatement is real, routine, and small. The number was set from a guess and
now there is evidence to set it from instead — **which is exactly the condition
the original note gave for raising it.**

---

### A defect in my own run script

`job_runs` recorded `requests_made 0, bars_inserted 0` for a run that made one
request and stored 2,758 bars. The failure path in `backfill-run.ts` passes
zeroed counts to `closeRun`. **A failed run's observability is exactly when the
counters matter**, and mine discards them.

| Status | **ANSWERED 2026-09-05 — run aborted; OQ-6 held, OQ-9 still open, two obligations raised** |
|---|---|

---

### STEP 9 RE-RUN — 2026-09-05. COMPLETE. 51 requests, 26.5 min, 166,344 bars.

Predictions committed at `5273ee9` before the first attempt, unedited.

| | predicted | actual | |
|---|---|---|---|
| Requests | 36 (34–40) | **51** | miss — see below, NOT an estimating error |
| Wall clock | ~10 min (6–20) | **26.5 min** | same cause |
| Credits | 36 | **51**, one per request | tracked requests |
| `applied` | ~35, tracking the request count | **48** | **HELD** — 48 against 51 pages |
| `noop` | ~2,020 | **4,789** | miss — investigated, cause below |
| `inserted` | ~172,200 | **161,604** | |
| Total 15m bars | ~174,200 | **166,344** | 4.5% under |
| Weekend bars | ~12,000 (10–13k) | **11,058** | **HELD** |
| `conflict` | 0 | **0** | **HELD** |
| **the DATABASE binds, not the rate limit** | predicted | **pacer idle 3 s of 1,588** | **HELD decisively** |

166,344 bars, **2020-01-24 13:00Z → 2026-09-05 09:30Z**, exactly one forming
(the newest — correct), parity window intact at 1,982.

**Arithmetic reconciles exactly**, which is how the counts below can be trusted:
`bars seen 166,443 = 166,344 distinct + 99 re-offered`, and
`inserted 161,604 + applied 48 + noop 4,789 + narrowed 2 = 166,443`.

---

### 1. THE HEADLINE: revisions REVERT, which kills the only explanation we had

Step 9's aborted run found four finalised bars revised within thirty minutes,
all NARROWING. That looked like a signature. **Two of the four have since undone
themselves.**

| `2026-09-01 06:30` high | |
|---|---|
| 07:53 stored | 4438.39980 |
| 08:22 | 4437.27763 — narrowed |
| 09:30 | **4438.39980 — back to the original** |

Identically for `06:45`. The other two narrowed again and were counted.

**THIS KILLS THE TICK-DROPPING EXPLANATION.** Dropped ticks do not come back. A
provider that had recomputed an extreme from a cleaned tick set would not
recompute the dirty value an hour later.

**AND NOTHING REPLACES IT. No mechanism is established.** Four observations
looked like a signature; two undid themselves; what remains is that this feed
serves different values for the same finalised bar at different moments, and we
do not know why. "Narrowing" is still a DESCRIPTION OF WHAT WAS SEEN and is now
demonstrably not a description of a process. It stays a classifier for deciding
whether to stop a run — nothing more.

**§7 IS NOW DEMONSTRATED RATHER THAN ARGUED, and this is a measurement.** Had
the 08:22 narrowing been accepted as a correction and written over the stored
bars, **we would today disagree with the provider on two bars while believing we
agreed with it.** The stored values — refused, kept, never repaired — are the
ones the provider now serves. First concrete evidence that never-repair was
right, after being carried as a principle since the engineering prompt.

---

### 2. The request and wall-clock misses are not estimating errors

The prediction assumed BAR-COUNT paging (~174,000 ÷ 5,000). **Obligation 50
replaced that with fixed-width TIME windows after the prediction was
committed**, because `outputsize` anchors on the newest bars and bar-count
paging cannot walk history at all.

A 50-day window holds ~4,800 bars in the 24/7 era and only ~3,100 in the
weekday-only era — visible in the log as pages 29–44 returning 2,957–3,956 and
pages 45–49 filling to 4,801. Same history, more pages.

**Categorised deliberately:** the SYSTEM changed between prediction and
measurement. A later reader who files "predicted 36, got 51" as "estimates run
40% low" will distrust good estimates and miss the design change that caused it.

---

### 3. The `noop` miss — hypothesis tested and REFUTED

The proposed cause was window-boundary overlap at ~53 bars per page.
**Measured across all 51 capture pages: overlap is 2 bars per page, 99 total.**
Distribution: 49 pages overlap by 2, one by 1, one by 0. The hypothesis is
wrong and is recorded as wrong.

**The real cause is my baseline, and it is arithmetic rather than behaviour.**
The prediction used the parity window (1,982 bars) as what was already stored.
The table actually held **4,740** — the aborted step-9 run had left **2,758**
more, spanning 2026-07-15 to 2026-08-13. Every one was re-offered and returned
`noop`.

```
noop = 4,740 pre-existing − 2 narrowed + 51 boundary re-offers = 4,789   EXACT
```

**So `noop` does NOT scale with page count** — the boundary component is ~1 bar
per page and negligible. It scales with how much of the range was already
stored, which is the resume overlap working as designed.

---

### 4. OQ-1 REMAINS UNTESTED, and may stay that way

**51 requests, zero 429s, zero retries, pacer idle 3 seconds of 1,588.**

Database writes run ~30 s per page against an 8.57 s pacing interval, so **the
rate limit cannot bind on this path at all**. The pacer is not protecting the
run from the provider; the database is.

**Obligation 5's bounded backoff has still never executed in anger.** It has
been exercised only by unit tests with an injected clock.

**This run tells us nothing about the rate limit except that this workload
cannot reach it.** A real test would have to be BUILT — deliberately issuing
requests faster than the documented limit and observing the response — rather
than waited for. Waiting for a natural 429 on the backfill path will wait
forever, and recording "no 429 occurred" as reassurance would be reading silence
as evidence.

---

### 5. A near-miss worth recording

2,166 bars on isoDOW 6–7 before mid-2025 looked like it contradicted ADR-008's
"0 weekend bars in 2020–2024". **It does not.** A UTC weekend filter sweeps up
the legitimate Sunday-evening open (17:00 New York = 21:00–22:00 UTC Sunday).
**Saturday-only, which is ADR-008's actual measure: ZERO before 2025**, 1,917 in
2025, 3,351 in 2026. The ADR is confirmed.

**Refinement worth keeping:** Saturday synthesis begins in **early 2025**, not
mid-June. ADR-008 sampled once a year and could only bound the onset to a year;
166,000 bars locate it to a month.

---

### OQ-10 — ANSWERED, prediction HELD

A **5,000-bar page cost exactly 1 credit** (step 9's first attempt), as did this
run's 4,801-bar pages. Cost does not scale with page size.

### Obligation 31's dump now exists

`karatx-20260905-093443.dump`, **4,637,483 bytes**, candles=169,704 — 16× the
previous dump, and the first large enough that a restore failure could land
mid-stream. **The evidence half of obligation 31 is now RUNNABLE and has not
been run.**

---

## What answers these, and in what order

**Step 7 of T1.4: one request.** A narrow window at `15min`, which is enough for
OQ-2, OQ-3 (if it errors), OQ-4, OQ-6, OQ-7, OQ-8 and OQ-10. The client captures
the full response — status, headers and body — before parsing, so a single call
leaves the evidence for all of them on disk under `var/captures/`.

**OQ-5 and OQ-9 need a `1day` request**, which is step 8, alongside the parity
fetches obligation 41 requires.

**OQ-1 is the one a single call cannot settle.** Confirming 8/minute means
deliberately exceeding it, which costs a 429 and tells us only where the wall is
on that day. The pacer runs at 7/minute precisely so this stays untested and
unimportant: if the real limit is lower we will meet it as a 429 and the retry
policy handles it. Recorded as accepted rather than scheduled.

---

## What is NOT in question

Stated so the list above is not read as "everything about this provider is
uncertain". These were measured against the live API on 2026-08-27 and are cited
throughout ADR-008:

- Thailand access works; the key authenticates.
- `XAU/USD` is spot gold — `currency_base: "Gold Spot"`, `type: "Precious Metal"`.
- 15min history begins **2020-01-24 13:00**, verified by fetching that day.
- A full page returns **5,000 bars** at `15min`.
- Bar density is **35,071/year** in the 24/7 era, **24,342/year** weekday-only.
- The account default timezone is **Australia/Sydney (UTC+10)**, absent from the
  response body — which is why `timezone=UTC` is sent unconditionally.
- Prices are **float32 printed at ~9 significant figures**, as text.
- Weekend bars: **0 in 2020–2024, 49 on 2025-06-14, 96 from 2026.**
