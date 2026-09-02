# XAU/USD Command Centre — Stack Review, Unknowns and Architecture

**Date:** 2026-08-25
**Covers:** first-task sections D (stack review), E (unknowns), F (architecture).

---

## D. Technology stack review

### Confirmed without reservation

| Choice | Verdict | Note |
|---|---|---|
| TypeScript, strict mode | **Confirm** | Also enable `noUncheckedIndexedAccess`. Candle arrays are indexed constantly; this catches a whole class of off-by-one bug that would otherwise produce silently wrong indicator values. |
| PostgreSQL | **Confirm** | Volume is small — five years of 15M candles is roughly 130k rows. Postgres handles this without any special tooling. Explicitly reject time-series databases as premature. |
| Drizzle ORM + Drizzle migrations | **Confirm** | Thin, SQL-shaped, good TypeScript inference, migrations are plain SQL you can read. Right fit. |
| Zod | **Confirm** | Load-bearing here: it's the boundary guard for both market data and LLM output. |
| Vitest | **Confirm** | |
| Playwright | **Confirm, but defer use** | Set up in Phase 0 with one smoke test. Writing E2E before there is a dashboard is wasted effort. |
| ESLint + Prettier | **Confirm** | |
| pnpm | **Confirm** | Workspaces are needed for the monorepo shape below. |
| GitHub + Actions | **Confirm** | |
| VS Code + Claude Code | **Confirm** | |

### Challenged

**Next.js App Router — confirmed for the dashboard, rejected as the home of the engine.**

See audit H6. Next.js is a request-oriented framework; the monitoring core is a long-lived singleton process holding a price stream and a scheduler. Putting them in one service means a dashboard deploy drops your feed, and it makes the engine hard to test in isolation (which NFR-9 forbids).

> **Corrected 2026-08-26 (T0.8).** This paragraph said "holding a websocket". The F.2 amendment below records that for the provider in ADR-005 the price stream is chunked HTTP, not a websocket, and that candles are POLLED rather than streamed. The architectural point is unchanged - the process is long-lived and singleton, which is why it cannot live inside Next.js - but the mechanism named here was wrong, and the amendment had flagged it as still uncorrected.

**Proposal:** one repo, pnpm workspaces, two deployable processes.

```
apps/
  web/           Next.js App Router — dashboard, trade log, admin
  worker/        plain Node — feed consumer, scheduler, engine, dispatcher
packages/
  core/          pure domain: indicators, structure, zones, liquidity,
                 state machine, planning, grading. No I/O. No DB. No fetch.
  contracts/     Zod schemas shared across every boundary
  db/            Drizzle schema, migrations, query helpers
  providers/     adapters: market data, calendar, news, LLM, notifications
  config/        env parsing and validation
```

`packages/core` having zero I/O is the important part. It makes the strategy testable at millisecond speed with plain fixtures, and it means backtesting reuses *exactly* the live code path rather than a parallel reimplementation — which is how most backtests end up lying.

**Railway — confirmed, with caveats.** Two services plus managed Postgres. Confirm before committing `[VERIFY]`: that a service can run persistently without idling, that scheduled/background execution is supported the way we need, and what the managed Postgres backup story is. If any of those is wrong, that's an ADR to revisit, not a surprise in Phase 6.

### New dependencies I propose adding

Per §2 of the engineering prompt, each with justification.

| Dependency | Problem it solves | Alternatives | Downside |
|---|---|---|---|
| `luxon` (or `date-fns-tz`) | IANA timezone arithmetic for sessions, daily boundaries, DST, event times. Required by NFR-5. | Hand-rolled offsets (wrong — §8 forbids it); `Temporal` (still maturing; revisit later) | Luxon is a moderate bundle; it only needs to be in the worker and server code, not the client. |
| `pino` | Structured JSON logging with redaction. Required by NFR-6. | `console.log` (unstructured, no redaction), Winston (heavier) | Minimal. |
| A cron scheduler in-process (e.g. `node-cron`) | Weekly map, daily reconciliation, calendar polling | A queue service (rejected — §5), Railway-native cron `[VERIFY]` | In-process cron requires the worker to be a singleton. Acceptable and simple. If Railway offers reliable native scheduling, prefer it and drop this. |

**Explicitly not adding:** Redis, Kafka, BullMQ, a vector DB, an ML library, a second ORM, a state-machine library (the transition table is ~30 lines and hand-writing it keeps it readable and testable), a charting library beyond what the dashboard needs, or a technical-analysis package (see below).

**A note on TA libraries:** it is tempting to `pnpm add` a technical-analysis package for EMA and Stoch RSI. **Don't.** Audit C3 requires exact TradingView parity, and off-the-shelf packages generally do not document their seeding or smoothing order well enough to guarantee it. These are twenty lines of arithmetic each. Write them, test them against golden values, own them.

### On price arithmetic

Gold prices at four significant figures with two decimals are safely representable in float64, so `decimal.js` is not needed. But **comparisons** are where floats bite: `close > zoneTop` at the exact boundary. Mitigation: store prices as `NUMERIC` in Postgres, define a single `tickSize` constant, and route every price comparison through a small `priceCompare(a, b, tick)` helper with an epsilon. One module, fully tested, no dependency.

### On the LLM provider question ("OpenAI or Claude for reasoning?")

I should be transparent that I'm Claude and therefore not a neutral party on this. So here is the engineering answer rather than an opinion:

**It is a smaller decision than it feels, and you should not make it now.** The engineering prompt already requires a provider abstraction (§7 / FR-7.1), and the reasoning layer is Phase 7 — a long way out. What matters far more than the vendor is the *shape* of the integration: structured input, schema-validated output, evidence-ID grounding, and the hard rule that the model cannot move state (FR-7.5). Get that right and swapping providers is a day's work.

When Phase 7 arrives, decide it with a measurement, not a preference:

1. Capture ~50 real market snapshots from your own database, spanning clear setups, ambiguous chop, and contradictory-evidence cases.
2. Run the identical prompt and schema through each candidate.
3. Score on: **schema-conformance rate** (how often does it return valid structured output first try), **hallucination rate** (invented prices, unknown evidence IDs, claims not traceable to input), **latency at your call volume**, **cost per 1,000 calls at your token sizes**, and **disagreement with your own read** on the ambiguous cases.
4. Write the ADR with the numbers in it.

Both major providers support structured/JSON-schema output and both are capable of this task. `[VERIFY]` current pricing and rate limits at decision time — this moves.

One thing that *is* decidable now: **gate LLM calls tightly.** Do not call on every 15M close by default. Call when a setup is in an active state or a significant event fires. This keeps cost near-trivial and keeps the model's attention on situations that matter.

---

## E. Major unknowns

Ranked by how much they can hurt you.

### U-1 — Market data provider (BLOCKING Phase 1)

I have no web access in this session, so I will not name providers or quote prices — inventing an endpoint or a price tier is exactly the failure mode §18 and §47 forbid. Instead, here is the evaluation matrix to fill in during a Claude Code session with web access.

**Non-negotiable requirements:**
- XAU/USD, 15M candles, live + historical
- Historical depth ≥ your agreed backtest window (decision 4)
- Reliable, documented candle **close** semantics and timestamp timezone
- Documented **daily boundary** convention (audit C2)
- Redistribution terms compatible with single-user personal use, including displaying the data in your own dashboard

**Evaluate each candidate on:**

| Criterion | Why it matters here |
|---|---|
| XAU/USD availability and whether it's spot or a proxy | A CFD/futures proxy will not match your chart |
| Historical intraday depth and granularity | H7 — backtest must use the live feed |
| Realtime method: streaming vs polling | **Resolved for OANDA by ADR-005 / the F.2 amendment - candles are POLLED.** The original entry read "websocket is better for sweep detection", which is exactly backwards for this provider: its stream cannot produce faithful OHLC, so using it for sweep detection would corrupt the most wick-sensitive logic in the spec. Kept as a criterion because it still applies to evaluating any REPLACEMENT provider |
| Whether the feed supplies wick extremes faithfully | Sweep logic is wick-sensitive (C1) |
| Bid/ask or spread availability | M3 |
| DXY availability | Avoids a second integration |
| Treasury yield availability | Often a separate source — plan for it |
| Documented timestamp timezone and DST behaviour | C2 |
| Candle revision policy | Do they ever restate a closed bar? |
| Rate limits and burst behaviour | Backfill will hit these |
| Pricing at your volume, and whether backfill is billed separately | Backfill can cost more than a month of live data |
| Redistribution / display licence | Legal, and affects the V2 embedded chart |
| Documented uptime, status page, historical incidents | You will be trading on this |
| Documentation quality | Proxy for how much time you'll lose |
| Whether a second source exists for reconciliation (FR-1.9) | You need a cheap comparator |

**Deliverable:** a filled matrix, a recommendation, and `ADR-005: Market data provider` with alternatives and reasoning recorded. Do not write ingestion code before this exists.

### U-2 — Which feed matches your TradingView chart (BLOCKING, and it's a question for you)

Open TradingView, look at the XAUUSD chart you trade, and find the exchange/broker label on it. That single string determines how close you can get to C1 parity. Tell me what it says.

### U-3 — Daily boundary convention (BLOCKING, and you can answer it in 30 seconds)

On that same chart, switch to the 1D timeframe and hover a candle. The open time tells you whether your feed rolls at 00:00 UTC or 17:00 New York. Everything in FR-1.2, FR-2.x on 1D, and PDH/PDL depends on this.

### U-4 — Economic calendar source

Same evaluation discipline. Key criteria: reliable scheduled timestamps with timezone, actual/forecast/previous values, revision handling, and licence. `[VERIFY]`. Not blocking until Phase 8, but the *timestamp quality* question should be asked early because M6 is a real correctness risk.

### U-5 — Grading methodology (BLOCKING Phase 5)

Not an external unknown — a design gap (C4). Needs a dedicated design session producing `docs/STRATEGY_RULES.md` before Phase 4 code.

### U-6 — The 24 undefined trading rules (TR-1 … TR-24)

The largest single block of work between here and a functioning engine. Best handled as batched design sessions per phase rather than one enormous document up front: define TR-1…TR-15 before Phase 2, TR-16…TR-22 before Phase 4, TR-23…TR-24 before Phase 6.

### U-7 — Railway operational specifics

`[VERIFY]` persistent process behaviour, scheduled jobs, Postgres backup/restore, and how migrations are best run as a release step.

### U-8 — Cost envelope

Not knowable until U-1 and U-4 resolve. Should be tracked from Phase 1 against your stated ceiling (decision 3).

---

## F. Proposed architecture

### F.1 Process topology

```
┌────────────────────────┐        ┌────────────────────────┐
│  apps/web  (Next.js)   │        │  apps/worker  (Node)   │
│                        │        │                        │
│  dashboard             │        │  feed consumer         │
│  manual trade log      │        │  scheduler (cron)      │
│  alert history         │        │  technical engine      │
│  map viewer            │        │  event detector        │
│  health UI             │        │  setup state machine   │
│                        │        │  planner + grader      │
│  read-mostly           │        │  reasoning client      │
│                        │        │  alert dispatcher      │
└───────────┬────────────┘        └───────────┬────────────┘
            │                                 │
            └──────────────┬──────────────────┘
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │
                  │   (Railway)     │
                  └─────────────────┘

Both import packages/core, packages/db, packages/contracts.
The web app never computes strategy. It reads what the worker wrote.
```

That last line is a rule worth enforcing in review: if the dashboard ever calculates an indicator or a grade, you now have two implementations that will drift.

### F.2 Data flow through the worker

```
  Market data provider
          │            OHLC candles are POLLED. They are never assembled
          │            from the tick stream — see the note below.
          ▼
  ┌───────────────────┐
  │  Provider adapter │  candle poll shortly after each M15 close;
  │                   │  tick stream for bid/ask + liveness only.
  └─────────┬─────────┘  retry, backoff, reconnect
            ▼
  ┌───────────────────┐
  │  Zod validation   │  malformed → quarantine, never repair
  └─────────┬─────────┘
            ▼
  ┌───────────────────┐
  │  Normalisation    │  UTC, symbol map, tick rounding, provider tag
  └─────────┬─────────┘
            ▼
  ┌───────────────────┐
  │  Candle store     │  idempotent upsert on
  │                   │  (instrument, provider, timeframe, open_time)
  │                   │  is_final flag; aggregation 15M → 1H → 4H → 1D
  └─────────┬─────────┘
            ▼
  ┌───────────────────┐
  │ Technical engine  │  PURE. candles in → indicators, swings,
  │ (packages/core)   │  zones, liquidity, structure out.
  └─────────┬─────────┘  every derived row: occurred_at + confirmed_at
            ▼
  ┌───────────────────┐
  │  Event detector   │  candle close · zone approached · sweep ·
  │                   │  breakout · pullback · invalidation ·
  │                   │  macro shift · scheduled release
  └─────────┬─────────┘
            ▼
  ┌───────────────────┐
  │  Setup state      │  DETERMINISTIC. the only thing that may
  │  machine          │  change setup state. every transition
  └─────────┬─────────┘  persisted with evidence + rule version
            ▼
  ┌───────────────────┐
  │ Planner + grader  │  entry range, structural SL, TP1/2/3,
  │                   │  room, R:R, grade (versioned methodology)
  └─────────┬─────────┘
            ▼
  ┌───────────────────┐        ┌──────────────────────────┐
  │  Alert builder    │◄───────│  Reasoning layer (LLM)    │
  │                   │        │  ADVISORY ONLY            │
  │  DB write first,  │        │  adds narrative + context │
  │  dedupe key,      │        │  cannot change state      │
  │  then dispatch    │        │  cannot change numbers    │
  └─────────┬─────────┘        │  failure is non-fatal     │
            ▼                  └──────────────────────────┘
  ┌───────────────────┐
  │  Notifier adapter │  test adapter → Telegram
  │                   │  retry w/ backoff, never drop
  └───────────────────┘
            │
            ▼
  ┌───────────────────┐
  │  Journal          │  every setup, traded or not, + outcome
  └───────────────────┘        replay resolver
```

**Amended 2026-08-25 after T1.1 — candles are polled, not streamed.**

This section originally implied a websocket-fed candle path. D above and E/U-1's evaluation matrix both carried the same error; **both were corrected in T0.8** and now point here. For the provider chosen in ADR-005 that question is closed by the provider's own documentation:

> "you cannot create OHLC candlestick data using the REST v20 Stream endpoint, since open, high, low, and close data of the period are not guaranteed to be returned in the response packets."

The stream is also documented as delivering at most 4 prices per second per instrument, with window alignment that differs between connections — so two subscribers can legitimately observe different extremes. Sweep detection is the most wick-sensitive logic in the spec (C1), which makes that unacceptable as a source of highs and lows.

The resulting split, which T1.7 implements:

| Path | Source | Used for |
|---|---|---|
| **Candles** | `GET .../candles?granularity=M15&count=2&includeFirst=false`, polled after each 15M boundary | All OHLC. Finality comes from the provider's `complete` flag, not from wall-clock time |
| **Ticks** | Price stream, chunked HTTP, 5-second heartbeat | Current bid/ask for the dashboard and the DR-7 spread record; heartbeat silence is the silent-death detector |

Never mix the two series: the candle endpoint serves base-pricing-group data while the stream serves account pricing, so they are not the same numbers.

**Scope of this amendment:** it records a property of the provider named in ADR-005, which is *Accepted, conditional* on an unresolved account-access check. If that condition fails and the reference feed changes, this section must be revisited along with the ADR. The polling/streaming split is not asserted as true of any other provider.

### F.3 The three hard architectural invariants

These are the ones I'd defend in a review, and they should go verbatim into `CLAUDE.md`:

1. **`packages/core` performs no I/O.** No fetch, no database, no clock reads. Time is passed in. This is what makes the backtest use the identical code path as live, and it is the single strongest defence against a backtest that lies.

2. **Only the deterministic state machine may change setup state.** The LLM annotates; it never decides. This makes hallucination and prompt injection into cosmetic problems rather than trading problems, and it means an LLM outage degrades the product's prose, not its function.

3. **Every derived fact records `occurred_at` and `confirmed_at`.** Engine and backtest queries filter on `confirmed_at`. A lint rule or a code-review checklist item should enforce that no query filters on `occurred_at`.

### F.4 Revised setup state machine

The spec invited review of the state names (§6, Phase 4). My proposal:

```
                        ┌──────────┐
                        │   IDLE   │
                        └────┬─────┘
                             │ price approaches qualifying zone
                             ▼
                        ┌──────────┐
              ┌─────────│ WATCHING │──────────┐
              │         └────┬─────┘          │
              │              │ liquidity event / momentum shift
              │              ▼                │
              │      ┌───────────────┐        │
              │      │  DEVELOPING   │        │
              │      └───────┬───────┘        │
              │              │ 1H close beyond level
              │              ▼                │
              │   ┌────────────────────┐      │
              │   │ BREAKOUT_CONFIRMED │      │
              │   └─────────┬──────────┘      │
              │             │ price returns to zone
              │             ▼                 │
              │   ┌────────────────────┐      │
              │   │  AWAITING_PULLBACK │      │
              │   └─────────┬──────────┘      │
              │             │ zone holds
              │             ▼                 │
              │   ┌────────────────────┐      │
              │   │  AWAITING_TRIGGER  │      │
              │   └─────────┬──────────┘      │
              │             │ 15M confirmation + all gates pass
              │             ▼                 │
              │        ┌──────────┐           │
              │        │  READY   │           │
              │        └────┬─────┘           │
              │             │                 │
    invalidation ───────────┼──── entry range not reached in time
              │             │                 │
              ▼             ▼                 ▼
        ┌───────────┐  ┌──────────┐    ┌──────────┐
        │INVALIDATED│  │ EXPIRED  │    │ EXPIRED  │
        └───────────┘  └──────────┘    └──────────┘
                             │
                             ▼
                        ┌──────────┐
                        │ ARCHIVED │  terminal; outcome resolved
                        └──────────┘
```

**Two deliberate changes from the spec's list:**

- **`DETERIORATING` is removed as a state.** It is a *grade trajectory*, not a lifecycle position. Modelling it as a state creates ambiguous cycles (deteriorating → ready → deteriorating → ...) that are hard to test and produce alert spam. Instead: every active state carries a current `grade` and a `previous_grade`. A downward grade change on an active setup emits the `DETERIORATING` **alert** without any state transition. Same user-visible behaviour, far cleaner state machine.

- **`CANCELLED` split into `INVALIDATED` and `EXPIRED`.** "Price closed back through invalidation" and "the setup simply never triggered" are different outcomes with different learning value. Collapsing them loses information you'll want in Phase 9.

`STRUCTURE_CONFIRMED` → `BREAKOUT_CONFIRMED` because it names the actual event. `NONE` → `IDLE` because `NONE` reads like a null.

**Invariants:** terminal states have no outgoing transitions; `READY` cannot follow a terminal state within the same setup instance (a new instance is required, per §13); transitions are validated against an explicit table and an invalid transition throws rather than logs.

### F.5 Database schema sketch

Not final — this is the proposal to review before Phase 1's schema task. Grouped by concern.

**Reference:** `instruments`, `providers`, `market_hours`, `config`

**Market data:** `candles` — primary key IS the unique constraint on `instrument_id, provider_id, timeframe, open_time`; `is_final`; `ingested_at` and `updated_at`; a partial unique index `WHERE NOT is_final` enforcing at most one forming bar per series. Identity, the six-case conflict rule and the null comparison are settled in **ADR-013**, which also records that T1.3 returns a typed outcome rather than writing an event row. Also `macro_observations` (DXY, yields), `data_quality_events` (created by T1.5, not T1.3)

**Derived structure:** `swings`, `zones`, `zone_reactions`, `liquidity_pools`, `liquidity_events` — all carrying `occurred_at`, `confirmed_at`, `rule_version`

**Market map:** `map_versions`, `map_elements` — immutable; superseded, never edited

**Setups:** `setups` (FK to `map_version_id`), `setup_transitions`, `setup_evidence`, `trade_plans` (versioned per plan revision)

**Alerts:** `alerts` (unique on `dedupe_key`), `alert_deliveries`

**News/macro:** `economic_events`, `economic_releases` (append-only; revisions are new rows), `news_items`, `news_sources`

**AI:** `reasoning_runs` (input snapshot ref, prompt version, model, raw output, validation outcome)

**Journal & research:** `manual_trades`, `setup_outcomes` (hypothetical + actual, MAE, MFE, resolution method), `backtest_runs`, `backtest_results`

**System:** `system_events`, `job_runs`

Roughly 28 tables at full build; Phase 0 creates two (`system_events`, `config`), Phase 1 adds about six.

### F.6 What Phase 0 actually deploys

A boring, fully green skeleton: two Railway services and a database, a health endpoint that reports its DB connection and migration version, structured logs you can read, and CI that goes red when you break it. No market logic at all.

That is deliberately unexciting, and it is the phase people skip. Don't. Every hour spent here is repaid several times over in Phases 2–9, when you'll be debugging subtle numerical disagreements and will badly want a test harness you trust.
