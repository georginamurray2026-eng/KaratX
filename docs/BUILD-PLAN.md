# XAU/USD Command Centre — Build Plan

**Date:** 2026-08-25
**Covers:** section G. Phase 0 and Phase 1 in task detail; later phases as gated outlines.

Each phase has a **quality gate**. Do not start the next phase until the gate is green. The gate is the thing that stops "it mostly works" from compounding into "I don't know what this system is doing."

---

## Phase 0 — Engineering Foundation

**Goal:** a deployed, tested, observable skeleton with zero market logic.
**Estimated:** 10 small tasks. Expect this to feel slow and produce nothing visible. That is correct.

---

### T0.1 — Repository and workspace skeleton

**Objective:** create the monorepo structure with strict TypeScript and working tooling.
**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `apps/web`, `apps/worker`, `packages/{core,contracts,db,providers,config}`, `.gitignore`, `.editorconfig`
**Depends on:** decision 7 (worker split) confirmed
**Acceptance criteria:**
- `pnpm install` succeeds from clean
- `pnpm typecheck` passes across all packages
- `strict: true` and `noUncheckedIndexedAccess: true` set in the base config
- `packages/core` has no dependency on `packages/db` or `packages/providers` (enforced by an ESLint import rule)
**Tests:** one trivial passing test in `packages/core` proving the runner works
**Risks:** workspace path/alias misconfiguration is tedious to debug later — verify cross-package imports resolve in both apps before moving on

---

### T0.2 — Lint, format, and import boundaries

**Objective:** enforce code standards and, importantly, the architectural boundary from F.3 invariant 1.
**Files:** `eslint.config.js`, `.prettierrc`, package scripts
**Depends on:** T0.1
**Acceptance criteria:**
- `pnpm lint` and `pnpm format:check` pass
- An ESLint rule fails the build if `packages/core` imports anything performing I/O
- No warnings suppressed without an inline explanatory comment
**Tests:** a deliberate violating import proves the rule fires, then is removed
**Risks:** over-configured lint becomes something you fight. Keep the ruleset small and the boundary rule strict.

---

### T0.3 — Configuration and secrets

**Objective:** validated environment configuration that fails loudly at boot.
**Files:** `packages/config/*`, `.env.example`, `.gitignore`
**Depends on:** T0.1
**Acceptance criteria:**
- Every env var parsed through a Zod schema at process start
- Missing or malformed config throws a clear, named error before any other work
- `.env` is git-ignored; `.env.example` documents every variable with a comment
- No secret value ever appears in a log line
**Tests:** unit tests for missing var, wrong type, and valid config
**Risks:** SEC-1. Confirm nothing sensitive is already staged before the first commit.

---

### T0.4 — Database, Drizzle, and the first migration

**Objective:** working Postgres locally and on Railway, with migrations under version control.
**Files:** `packages/db/schema/*`, `packages/db/migrations/*`, `drizzle.config.ts`, `docker-compose.yml` (local Postgres only)
**Depends on:** T0.3
**Acceptance criteria:**
- Local Postgres runs via Docker with one documented command
- First migration creates `system_events` and `config` only
- `pnpm db:migrate` applies cleanly to an empty database
- Migrations are checked into Git and never edited after being applied
**Tests:** integration test against a real (not mocked) test database: migrate up from empty, assert tables exist
**Risks:** OPS-2 — migrations must be a deliberate release step, not automatic on boot. Decide and document now.
**Manual step for you:** installing Docker Desktop, and creating the Railway Postgres instance. I'll give exact click-by-click instructions when we get here.

---

### T0.5 — Logging and the error model

**Objective:** structured logs and a classified error taxonomy.
**Files:** `packages/core/errors.ts` (pure types), `packages/providers/logger.ts`
**Depends on:** T0.3
**Acceptance criteria:**
- Pino configured with JSON output, correlation ID support, and redaction of key/token fields
- Error classes for: validation, provider, network, database, strategy, ai, config, unexpected
- Each class declares its handling policy (retry / degrade / alert / stop / quarantine) per §23
- Zero empty catch blocks anywhere in the repo
**Tests:** unit tests asserting redaction works and that error classification is preserved through a rethrow
**Risks:** logging secrets is the classic mistake — test the redaction, don't assume it

---

### T0.6 — Test harness

**Objective:** unit and integration testing that you trust.
**Files:** `vitest.config.ts`, `test/setup.ts`, `test/db.ts`
**Depends on:** T0.4
**Acceptance criteria:**
- `pnpm test` runs unit tests fast, with no database
- `pnpm test:integration` runs against a real ephemeral test database, isolated per run
- Fixture loading helper in place for the golden datasets we'll add in Phase 1
**Tests:** the harness proves itself — a passing unit test and a passing DB test
**Risks:** slow or flaky integration tests get skipped, then rot. Keep them fast and deterministic from day one.

---

### T0.7 — Web skeleton and health endpoints

**Objective:** Next.js app with meaningful health reporting.
**Files:** `apps/web/app/*`, `apps/web/app/api/health/route.ts`, `.../api/ready/route.ts`
**Depends on:** T0.4, T0.5
**Acceptance criteria:**
- `/api/health` returns process liveness only
- `/api/ready` returns DB connectivity and applied migration version
- The distinction between the two is documented (NFR-7); later, `/api/ready` also reports data freshness
- No strategy logic in the web app
**Tests:** integration test hitting both endpoints; Playwright smoke test loading the root page
**Risks:** health endpoints that always return 200 are worse than none

---

### T0.8 — Worker skeleton

**Objective:** a long-lived process that starts, logs, connects, and shuts down cleanly.
**Files:** `apps/worker/src/index.ts`, `apps/worker/src/lifecycle.ts`
**Depends on:** T0.4, T0.5
**Acceptance criteria:**
- Boots, validates config, connects to the DB, writes a `system_events` startup row
- Handles SIGTERM: stops accepting work, finishes in flight, closes connections, exits 0 (OPS-3)
- Crash-loops are visible in logs, not silent
**Tests:** integration test asserting startup and graceful shutdown behaviour
**Risks:** NFR-2 — boot-time state reconstruction lands in Phase 4, but design the lifecycle hook for it now

---

### T0.9 — CI

**Objective:** a pipeline that goes red when you break something.
**Files:** `.github/workflows/ci.yml`
**Depends on:** T0.1–T0.8
**Acceptance criteria:**
- On push and PR: install → format check → lint → typecheck → unit tests → integration tests (with a Postgres service) → build → Playwright smoke
- Secret scanning enabled
- Dependency vulnerability scanning enabled (SEC-10)
- A deliberately broken commit turns CI red — verify this once, on purpose
**Tests:** the pipeline is the test
**Manual step for you:** creating the GitHub repository and connecting it. Exact steps when we get there.

---

### T0.10 — Railway deployment and project documentation

**Objective:** both services live, and the repository able to brief a fresh Claude Code session.
**Files:** `railway.json` or service config, `CLAUDE.md`, `docs/STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `README.md`
**Depends on:** all of Phase 0
**Acceptance criteria:**
- `web` and `worker` deploy from the same repo as separate Railway services, both healthy
- Migrations run as a deliberate release step
- Secrets configured in Railway, absent from Git
- Rollback procedure documented and **performed once** to prove it works
- `CLAUDE.md` states the project, the three hard invariants (F.3), the stack, the commands, and where docs live
- `docs/STATUS.md` accurately reflects reality
- ADRs written: ADR-001 monorepo + worker split, ADR-002 Postgres + Drizzle, ADR-003 migration policy, ADR-004 logging + error model
**Risks:** OPS-5 — verify nothing depends on local filesystem persistence

---

### ✅ Phase 0 Quality Gate

- CI green on `main`
- Both Railway services deployed and healthy
- `pnpm typecheck`, `lint`, `test`, `test:integration`, `build` all pass locally
- Rollback proven once
- `CLAUDE.md` and `docs/STATUS.md` accurate
- Zero secrets in Git history

---

## Phase 1 — Data Foundation

**Goal:** trustworthy XAU/USD candles in the database, with data-quality problems visible rather than hidden. **No AI, no indicators, no strategy.**

**⛔ Blocked at the start of this phase** on decisions 1–4 and ADR-005 (provider). T1.1 exists to unblock it.

---

### T1.1 — Provider evaluation and ADR-005

**Objective:** choose the market data provider on evidence.
**Files:** `docs/DATA_SOURCES.md`, `docs/DECISIONS.md` (ADR-005)
**Depends on:** your answers to decisions 1–4
**Acceptance criteria:**
- The full evaluation matrix from `ARCHITECTURE-AND-STACK.md` §E/U-1 filled in for at least three candidates, from **current official documentation** — no remembered facts
- Explicit findings on: daily boundary convention, timestamp timezone, candle revision policy, historical depth and its cost, redistribution licence
- ADR-005 records decision, alternatives, reasoning, consequences, reversibility
**Tests:** none — this is a research task
**Risks:** this is the highest-consequence decision in the project (H7, C1, C2). Do not rush it, and do not let a free tier make the choice for you.

---

### T1.2 — Contracts and instrument reference data

**Objective:** canonical Zod schemas and reference tables.
**Files:** `packages/contracts/market.ts`, `packages/db/schema/{instruments,providers,market_hours}.ts`, migration
**Depends on:** T1.1
**Acceptance criteria:**
- `Candle`, `Tick`, `Instrument`, `Timeframe`, `Provider` schemas defined once and imported everywhere
- Prices stored as `NUMERIC`, timestamps as `timestamptz`, all in UTC (NFR-4)
- `market_hours` encodes weekly open/close and the daily break for the chosen provider (FR-1.8)
**Tests:** schema unit tests including malformed, negative, zero and absurd values
**Risks:** getting the candle contract wrong now means migrating every downstream table later

---

### T1.3 — Candle storage with idempotent upsert

**Objective:** a candles table that cannot be corrupted by duplicate delivery.
**Files:** `packages/db/schema/candles.ts`, migration, `packages/db/queries/candles.ts`
**Depends on:** T1.2
**Acceptance criteria:**
- Unique constraint on `(instrument_id, provider_id, timeframe, open_time)` — enforced by the **database**, not TypeScript (§9)
- `is_final` boolean distinguishes closed bars from the forming bar
- Index supporting the dominant query: "last N final candles for instrument+timeframe ordered by open_time desc"
- Re-inserting an identical candle is a no-op; a *different* candle for the same key raises a data-quality event rather than silently overwriting
**Tests:** integration — insert twice (no duplicate); insert conflicting values (event raised, original preserved); ordered retrieval correctness
**Risks:** §22. This constraint is the foundation of every idempotency guarantee downstream.

---

### T1.4 — Historical backfill

**Objective:** resumable, idempotent import of historical 15M candles.
**Files:** `apps/worker/src/jobs/backfill.ts`, `packages/providers/marketdata/*`
**Depends on:** T1.3
**Acceptance criteria:**
- Resumes from the last successfully stored bar after interruption
- Respects the provider's rate limits with backoff
- Progress logged; a `job_runs` row records start, end, bars imported, errors
- Running it twice imports nothing the second time
**Tests:** integration with a recorded provider fixture — full run, interrupted-and-resumed run, duplicate run
**Risks:** backfill can be the largest single line item on your bill. Estimate the request count and cost *before* running it in full.

---

### T1.5 — Validation and quarantine

**Objective:** detect bad data; never silently repair it (§7).
**Files:** `packages/core/data-quality/*` (pure), `packages/db/schema/data_quality_events.ts`
**Depends on:** T1.3
**Acceptance criteria:**
- Detects: missing bars in a sequence, duplicates, out-of-order arrival, zero/negative values, high < low, close outside [low, high], implausible gaps relative to recent ATR, stale feed
- Each detection writes a typed `data_quality_events` row with severity
- Suspect candles are **quarantined, not corrected**
- Detection logic is pure and lives in `packages/core`
**Tests:** unit tests per anomaly type using hand-built fixtures; a "clean week" fixture that must produce zero events
**Risks:** false positives here will train you to ignore the alerts. Tune thresholds against real data before enabling alerting.

---

### T1.6 — Timeframe aggregation

**Objective:** derive 1H/4H/1D from stored 15M base candles with a correct session boundary.
**Files:** `packages/core/timeframes/aggregate.ts` (pure), `apps/worker/src/jobs/aggregate.ts`
**Depends on:** T1.5, decision 2 (daily boundary)
**Acceptance criteria:**
- Aggregation is pure: `(candles, timeframe, boundaryConfig) => candles`
- Daily boundary is configurable and defaults to whatever your chart uses
- An aggregate is marked `is_final` only when **every** constituent 15M bar is final and present — a missing constituent yields no aggregate, never a partial one
- Weekly boundary aligned to actual market open, not calendar Sunday
**Tests:** unit tests for exact boundaries; a **DST fixture set** covering both the US and UK transition dates in both directions (TEST-6); missing-constituent case; partial-final case
**Risks:** C2. This is the most likely place for a silent, hard-to-spot correctness bug in the whole of Phase 1.

---

### T1.7 — Live feed consumer

**Objective:** continuous ingestion with resilient reconnection.
**Files:** `packages/providers/marketdata/live.ts`, `apps/worker/src/feed.ts`
**Depends on:** T1.4, T1.6
**Acceptance criteria:**
- Reconnects with exponential backoff and jitter; bounded, never an infinite tight loop (§23)
- On reconnect, backfills the gap rather than resuming blind
- A bar is marked final only after its close time has passed on the reference feed
- Every connect, disconnect and reconnect logged as a `system_event`
**Tests:** integration against a fake provider that disconnects, delivers duplicates, delivers out of order, and delivers a stale bar
**Risks:** silent death — a socket that appears open but delivers nothing. T1.8 exists specifically for this.

---

### T1.8 — Staleness watchdog and degraded mode

**Objective:** the system knows when it doesn't know.
**Files:** `packages/core/freshness.ts`, `apps/worker/src/watchdog.ts`, `apps/web/app/api/ready/route.ts`
**Depends on:** T1.7, T1.2 (market hours)
**Acceptance criteria:**
- Freshness computed against expected bar cadence **and** market hours — no alarms during the weekend close (H5)
- Staleness beyond threshold sets a `DATA_DEGRADED` system state
- `/api/ready` reports it; the dashboard shows it prominently
- Degraded state will later suppress setup confidence (NFR-8) — the hook exists now
**Tests:** unit tests for freshness across in-hours, out-of-hours, and holiday cases; integration test asserting `/api/ready` reflects a stale feed
**Risks:** this is the mechanism that stops the system confidently telling you about a market it stopped watching an hour ago

---

### T1.9 — Feed reconciliation

**Objective:** measure how far the reference feed diverges from a second source (C1, FR-1.9).
**Files:** `apps/worker/src/jobs/reconcile.ts`
**Depends on:** T1.7
**Acceptance criteria:**
- A daily job compares closes and high/low extremes against a secondary source
- Records max, mean and 95th-percentile divergence per day
- Never modifies reference data
- Divergence above threshold raises a data-quality event
**Tests:** integration with two fixtures, one deliberately divergent
**Risks:** if divergence turns out to be large, it changes how you must interpret every level the system produces. Better to learn that in Phase 1 than in Phase 10.

---

### T1.10 — DXY and yields; golden dataset

**Objective:** macro series ingested, and a committed fixture for deterministic engine tests.
**Files:** `packages/db/schema/macro_observations.ts`, `packages/providers/macro/*`, `test/fixtures/golden-week/*`
**Depends on:** T1.7
**Acceptance criteria:**
- DXY and at least 2Y/10Y yields ingested with source attribution
- Their **exchange hours** are modelled — they do not trade when gold does, and the mismatch must be explicit rather than producing phantom gaps
- One representative week of XAU/USD candles committed to the repo as a fixture (TEST-13), covering a trend, a range, and a news spike
**Tests:** integration for ingestion; the golden fixture loads and validates
**Risks:** naively treating a missing DXY value during a gold-only session as a data-quality problem will flood the events table

---

### ✅ Phase 1 Quality Gate

- Historical backfill complete for the agreed window; row counts reconcile against expectation
- Live feed sustained for a full trading week with reconnection events logged and handled
- Aggregation verified against your TradingView chart on a manual spot-check — **eyeball a dozen 1H and 1D bars yourself**
- Zero unexplained data-quality events across the last week
- DST fixture tests passing
- ADR-005 written; `docs/DATA_SOURCES.md` complete
- `docs/STATUS.md` updated

---

## Phases 2–12 — Outline

Detail is deliberately deferred; each gets a task breakdown at the start of its phase, once the previous phase's reality is known.

| Phase | Content | Gate |
|---|---|---|
| **2 — Technical engine** | TR-1…TR-15 defined and documented **first**, then EMA, Stoch RSI, swings, structure, zones, liquidity, sweeps, breakout, pullback, room. All pure, all in `packages/core`. | Golden-value parity with TradingView within documented tolerance; all TR rules documented and tested; every §12 case type covered |
| **3 — Weekly map** | Versioned map generation, invalidation detection, event-driven updates, Pine Script export | A full map generated and manually verified against your own chart reading |
| **4 — State machine** | TR-16…TR-22 defined, then the setup lifecycle from F.4 | Every valid transition tested, every invalid one rejected; invariants hold under property tests |
| **5 — Planning & grading** | Entry range, structural stop, targets, R:R, room gate, grading methodology (C4) | Grading methodology documented and versioned before any grade is emitted |
| **6 — Alerts, journal, trade log** | All alert levels, dedupe, retry, quiet hours, manual trade log, outcome resolver | No duplicate alerts under replay; a week of alerts you'd actually have wanted |
| **7 — Reasoning layer** | Provider abstraction, structured I/O, validation, injection defence | Hallucinated/injected/malformed responses all rejected in tests; LLM outage leaves the system fully functional |
| **8 — News & macro** | Calendar, Tier 1 sources, surprise, reaction analysis. **No X.** | Release timestamps verified accurate; revisions append correctly |
| **9 — Backtesting** | Reproducible engine reusing the live code path | Look-ahead guard tests pass; results reproduce byte-for-byte from a pinned dataset |
| **10 — Paper observation** | Live, unrelied-upon, everything recorded | A meaningful sample of setups with resolved outcomes |
| **11 — Manual live use** | You trade; the system watches and journals | — |
| **12 — Statistical learning** | Only with sufficient clean data; minimum sample sizes enforced | — |

---

## Realistic sequencing note

Phases 0 and 1 are largely engineering and will move at a predictable pace. **Phase 2 will be the slowest part of this project by a wide margin** — not because the code is hard, but because defining fifteen trading concepts precisely enough to test is genuinely difficult, and each one will send you back to your charts to check whether the definition matches what you actually do.

That work is the real value of the project. A system built on precise definitions of your own method is useful even if you never automate another line of it.
