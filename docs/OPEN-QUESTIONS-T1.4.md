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
| **OQ-5** | At `1day`, is `datetime` **`2025-07-06`** or **`2025-07-06 00:00:00`**? | Date-only | Medium. No `1day` time_series response has ever been captured. The parser accepts both, deliberately | **OPEN** |
| **OQ-6** | Does a page **always fill to `outputsize`** when more bars exist? | Yes | Medium. The backfill deliberately does NOT rely on this — it terminates on "the frontier did not advance", at a cost of one extra request per run | **OPEN** |
| **OQ-7** | Are **`start_date` / `end_date` inclusive**? | Inclusive both ends | Medium. If `start_date` turns out to be exclusive the overlap bar disappears, the run still works, and the resume path silently stops re-proving idempotency — a quiet degradation worth checking for directly | **ANSWERED 2026-09-04 — held** |
| **OQ-8** | Is **`order=ASC` honoured**? | Yes | Medium. The recorded 2026-08-27 response is DESCENDING, but it was fetched without the parameter. `assertAscending` fails loudly if not — this is the one question whose wrong answer cannot pass silently | **ANSWERED 2026-09-04 — held** |
| **OQ-9** | Is **`outputsize` capped at 5000 at every interval**? | Yes | Medium. Measured at `15min` only ([STATUS.md:1654](./STATUS.md#L1654)). If `1day` caps lower, the parity fetch needs more than one request | **OPEN** |
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
