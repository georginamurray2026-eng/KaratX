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

**Objective:** working Postgres locally, with migrations under version control. *(Amended 2026-08-31: "and on Railway" removed — ADR-011. The Railway Postgres was created in T0.4 and DELETED in T0.10.)*
**Files:** `packages/db/schema/*`, `packages/db/migrations/*`, `drizzle.config.ts`, `docker-compose.yml` (local Postgres only)
**Depends on:** T0.3
**Acceptance criteria:**
- Local Postgres runs via Docker with one documented command
- First migration creates `system_events` and `config` only
- `pnpm db:migrate` applies cleanly to an empty database
- Migrations are checked into Git and never edited after being applied
**Tests:** integration test against a real (not mocked) test database: migrate up from empty, assert tables exist
**Risks:** OPS-2 — migrations must be a deliberate release step, not automatic on boot. Decide and document now.
**Manual step for you:** installing Docker Desktop. *(Amended 2026-08-31: creating the Railway Postgres is no longer part of this task — ADR-011.)*

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

### T0.10 — Local operational readiness and project documentation

**RE-SCOPED 2026-08-30 by ADR-011.** Was "Railway deployment and project documentation". Deployment moved wholesale to **T6.1**; it is deferred, not met, and nothing below silently absorbs it.

**Objective:** the project provably recoverable on one machine, and the repository able to brief a fresh Claude Code session.
**Files:** `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `README.md`, `scripts/db-backup.*`, `scripts/db-restore.*`; expands `CLAUDE.md` and `docs/STATUS.md`
**Depends on:** all of Phase 0
**Acceptance criteria:**

- **L1.** Migrations run as a deliberate step: `pnpm db:migrate`, invoked by a human, never at boot
- **L2.** No secrets in Git history — verified, not assumed
- **L3. Local backup and restore drill, PERFORMED ONCE.** `pg_dump` to a git-ignored directory, the volume then deliberately destroyed, and the restore proven — including a **positive control** that the sentinel data is absent after destruction and present after restore
- **L4. Local rollback drill, PERFORMED ONCE.** Three parts: a code revert returns the system to working; **old code runs against new schema** (which is the only test ADR-003's forward-compatibility amendment has ever had); and a bad migration is recovered from, end to end
- **L5.** `CLAUDE.md` states the project, the three hard invariants (F.3), the stack, the commands, and where docs live
- **L6.** `docs/STATUS.md` accurately reflects reality
- **L7.** ADRs written: ADR-001 monorepo + worker split, ADR-002 Postgres + Drizzle, ADR-003 migration policy, ADR-004 logging + error model
- **L8.** OPS-5 — verify nothing depends on local filesystem persistence

> **WHY L3 AND L4 ARE NOT DEPLOYMENT WORK WEARING A LOCAL COSTUME.**
>
> **There is no down-migration path.** Drizzle generates forward-only SQL,
> `packages/db/src/bin/migrate.ts` has no down capability, and ADR-003 makes
> applied migrations immutable so a bad one cannot be edited. **The only
> recovery from a bad migration is: restore from backup, then write a new
> forward migration.** Backups are therefore not parallel to rollback — they
> are its ONLY mechanism, which is why L3 must be proven before L4.
>
> **And `pnpm db:reset` runs `docker compose down -v`**, destroying the
> `karatx-pgdata` volume in one command. It differs from `pnpm db:down` by one
> word and by everything. From Phase 1 that volume holds years of candle
> history — the asset the whole project rests on, some of it not re-fetchable
> within free-tier limits. Both drills must be done **before Phase 1 puts
> anything valuable in it.**

**Risks:** OPS-5 — verify nothing depends on local filesystem persistence

---

### T6.1 — Deployment (DEFERRED from T0.10)

**Deferred 2026-08-30 by ADR-011.** Trigger: Phase 6 needs continuous uptime, because an alerting system that only fires while its operator is at the desk is not an alerting system.

**Objective:** both services live and healthy on a hosting platform.
**Depends on:** T0.10, and a decision to pay (est. $9–13/month; re-price at the time)
**Acceptance criteria:**

- **D1.** `web` and `worker` deploy from the same repo as separate services, both healthy
- **D2.** The healthcheck proven to work **as a deploy gate** — a deployment that cannot reach its database must fail rather than go live
- **D3.** Migrations run as a pre-deploy release step, with a failure proven to block the deploy
- **D4.** Secrets configured on the platform, absent from Git
- **D5.** Platform rollback procedure documented and **performed once**
- **D6.** Backup and restore proven against the hosted database

**Preparatory work already done and NOT APPLIED:** `.railway/railway.ts`, `docs/DEPLOYMENT.md`'s settings table and cost section. Read ADR-011's decay warnings first — the Railway IaC SDK is beta, and Config as Code is withdrawn on 2026-12-01, so neither may still work.

**Before starting T6.1:** confirm Serverless is OFF for `worker`. It is opt-in and off by default, so this is a check against human error, not an open question.

> **Amended 2026-08-26.** `CLAUDE.md` and `docs/STATUS.md` were originally
> **created** in this task. Both were pulled forward to T0.6 and now exist.
>
> Scheduling them here was a mistake: §27 makes the repository the project
> memory and `docs/STATUS.md` the handoff file between sessions, and §44
> requires it updated at the end of every substantial session. Deferring them
> to the last task of Phase 0 meant five tasks ran with no handoff file at
> all, and a session had to be resumed from a hand-written document — the
> precise failure §27 exists to prevent.
>
> **From T0.6 onward, `docs/STATUS.md` is maintained continuously** and updated
> at the end of every substantial session, not written once at T0.10. T0.10
> expands both files with deployment specifics and verifies them; it no longer
> creates them.

---

### ⛔ Phase 0 Quality Gate — CLOSED AT LOCAL SCOPE, 2026-08-31

**NOT "Phase 0 complete". A DEPLOYMENT GATE WAS NEVER RUN.** Five criteria are
deferred to T6.1 by ADR-011; nothing has ever been deployed. The full
assessment, including what was and was not proven, is in `docs/STATUS.md`.

```
install exit=0   lint exit=0   format:check exit=0   typecheck exit=0
build   exit=0   test [PostgreSQL STOPPED] exit=0    test:integration exit=0
```

Closed on the test *"would the deferrals cause a Phase 1 defect?"* — checked,
not assumed: no Phase 1 task references deployment, hosting or uptime.


**AMENDED 2026-08-31 by ADR-011.** One criterion was deferred and one split.
The original wording is kept struck through rather than deleted, so a reader
can see what changed and why.

- CI green on `main`
- ~~Both Railway services deployed and healthy~~ — **DEFERRED to T6.1.** Nothing
  is deployed; ADR-011 makes the project local-only for Phases 1–5. This is not
  met and must not be ticked.
- `pnpm typecheck`, `lint`, `test`, `test:integration`, `build` all pass locally
- Rollback proven once — **LOCAL rollback**, drilled 2026-08-31 with three
  deliberate failures. PLATFORM rollback is deferred to T6.1. The two are not
  the same drill and neither substitutes for the other.
- `CLAUDE.md` and `docs/STATUS.md` accurate
- Zero secrets in Git history

> **The gate cannot be passed in full while ADR-011 stands.** That is the
> intended state, not a failure: Phase 1 proceeds with the deployment criterion
> explicitly outstanding rather than quietly reworded away.

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
- The full evaluation matrix from `ARCHITECTURE.md` §E/U-1 filled in for at least three candidates, from **current official documentation** — no remembered facts
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
- `Candle`, `Instrument`, `Timeframe`, `Provider` schemas defined once and imported everywhere. **`Tick` is DEFERRED by ADR-012**, with a recorded reopening trigger — there is no tick source or consumer in Phase 1, and a contract nothing imports cannot satisfy "imported everywhere"
- Prices stored as `NUMERIC`, timestamps as `timestamptz`, all in UTC (NFR-4)
- `market_hours` encodes weekly open/close and the daily break for the chosen provider (FR-1.8)
**Tests:** schema unit tests including malformed, negative, zero and absurd values
**Risks:** getting the candle contract wrong now means migrating every downstream table later

---

### T1.3 — Candle storage with idempotent upsert

**PRECONDITION — CHECK BEFORE STARTING T1.3.** The backup and restore drill
(T0.10 L3) must have been **performed**, not merely written. T1.3 creates the
table that will hold years of candle history in a Docker volume that
`pnpm db:reset` destroys in one command. An untested restore procedure is
indistinguishable from no restore procedure until the moment it matters. If L3
has not been performed, do it first.

**Objective:** a candles table that cannot be corrupted by duplicate delivery.
**Files:** `packages/db/schema/candles.ts`, migration, `packages/db/queries/candles.ts`
**Depends on:** T1.2
**Acceptance criteria:**
- Unique constraint on `(instrument_id, provider_id, timeframe, open_time)` — enforced by the **database**, not TypeScript (§9). **ADR-013 makes it the PRIMARY KEY**, so there is no second index over the same columns
- `is_final` boolean distinguishes closed bars from the forming bar, and a partial unique index `WHERE NOT is_final` enforces **at most one forming bar per series** (ADR-013)
- Index supporting the dominant query: "last N final candles for instrument+timeframe ordered by open_time desc"
- Re-inserting an identical candle is a no-op; a *different* candle for the same key does not silently overwrite
- **AMENDED by ADR-013 — this criterion cannot be met as originally written.** It said a conflict "raises a data-quality event", but `data_quality_events` is created by **T1.5**, not T1.3, and T1.5 requires its detection logic to be pure and to live in `packages/core`. T1.3 therefore returns a **typed outcome** — `applied | noop | conflict | rejected | enriched` — defined once in `packages/contracts` and CONSUMED by T1.5, never redefined there. T1.3 writes no event row
- Comparison uses `IS DISTINCT FROM` per column, not `=`: `volume`, `bid` and `ask` are nullable, and `=` would make a real value arriving where there was none **invisible** (ADR-013)
**Tests:** integration — insert twice (no duplicate); insert conflicting values (conflict outcome, original preserved); insert a second forming bar (rejected by the partial index); the three QUIET cases asserted as deliberately as the loud ones, each paired with a loud sibling using the same detector so that a broken detector cannot pass both; ordered retrieval correctness
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
- **Obligation 31's EVIDENCE half lands here, not in T1.3.** T1.3 adds `--single-transaction` to `db:restore`; proving it required a dump large enough that a failure lands *mid*-restore, and that volume does not exist until this task has run. Re-run the deliberate restore failures against a post-backfill dump — the evidence must come from a dump where the old behaviour would actually have differed
**Tests:** integration with a recorded provider fixture — full run, interrupted-and-resumed run, duplicate run
**Risks:** backfill can be the largest single line item on your bill. Estimate the request count and cost *before* running it in full.

**ESTIMATE DONE 2026-09-04, AND IT SAYS THIS RISK DOES NOT APPLY TO THIS PROVIDER.** The note above was written before ADR-008 chose Twelve Data. On the measured figures — 5,000 bars per request, 35,071 bars/year in the 24/7 era, 24,342 in the weekday-only era — the **full 6.6-year backfill is 35–47 requests, 4.4–5.9 minutes, and $0 on the free tier.** That is **4.4–5.9% of one day's 800 credits**, so nothing breaches a daily cap and there is no multi-day run to design around. **The binding constraint is the 8-credits/minute rate limit, and it binds on wall-clock, not on cost** — which makes resumability a requirement about surviving a 429 inside a ~5-minute job, not a multi-day campaign. **Do not size the retry and checkpoint design for a cost problem this provider does not have.**

**SIZING DECIDED 2026-09-04:**

- **The 15M backfill takes the FULL 6.6 years**, from 2020-01-24, not obligation 41's ~20-day parity minimum. Once 1D leaves the 15M spine the full run costs only ~9 requests more than the minimum, and two windows to reason about later is the worse trade at that price.
- **The 1H and 1D parity inputs are FETCHED, not derived** — 1 request each against 27–36 to aggregate 1D from five years of 15M. Obligation 41 specifies bar counts, and 1299 daily bars is ~5 years. **This is ADR-008's regression-assertion provision used for a second purpose; it does NOT reverse the 15M spine or T1.6 aggregation.**
- **The 800/day and 8/min limits are VENDOR DOCUMENTATION and have never been tested.** Nothing plausible at 2x breaches the cap, but the first real run is also the first measurement of them — record what actually happened.

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
