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
