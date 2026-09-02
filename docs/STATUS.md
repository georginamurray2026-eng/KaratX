# STATUS

Handoff file between Claude Code sessions (§27, §44). The repository is the
project memory — do not rely on conversation history.

**Last verified:** 2026-08-28, by inspecting the repository and running the
commands below. Every figure here came from an actual run, not from a
handover document.

---

## ▶ START HERE — session handoff, 2026-08-31 (evening)

**PHASE 0 IS CLOSED AT LOCAL SCOPE.** Five deployment criteria were DEFERRED to
T6.1 and never run — see the closure below. Do not read "Phase 0 closed" as
"Phase 0 complete".

**T1.2 is SUBSTANTIALLY COMPLETE.** Two commits: `30bf592` (contracts) and
`9c7890b` (reference tables and the seeded calendar). Working tree clean.

### What T1.2 has delivered, against its own criteria

| Criterion | State |
|---|---|
| `Candle`, `Instrument`, `Timeframe`, `Provider` schemas | **DONE** — `packages/contracts/src/market.ts`, 68 unit tests |
| `Tick` schema | **DEFERRED — settled by ADR-012 (2026-09-02).** No longer an open criterion |
| defined once and **imported everywhere** | **NOT YET TRUE.** Nothing consumes them |
| Prices `NUMERIC`, timestamps `timestamptz`, all UTC | **DONE**, with an integration test asserting no naive timestamp column exists |
| `market_hours` encodes weekly open/close and the daily break | **DONE and SEEDED** |

**`Tick` IS DEFERRED, and the deferral is now RECORDED — [ADR-012](./DECISIONS.md),
2026-09-02.** ADR-008 chose 15min bars from `/time_series`; there is no tick
source anywhere in Phase 1 and no consumer. Writing a contract nothing imports
means writing one that will be wrong by the time something does — and it would
make T1.2's "imported everywhere" clause LOOK met while being unmeetable.
**The reopening trigger is explicit in the ADR:** the first provider adapter
receiving tick or quote data, or the first `packages/core` consumer needing
sub-bar granularity. This was T1.2's last openly unmet criterion; it is now
closed by decision rather than by delivery, which is a distinction the ADR
states plainly.

**"Imported everywhere" is not yet true either** — `grep` finds `@karatx/contracts`
in exactly three places and none is a real import: a comment, a
`transpilePackages` entry, and a string inside a test fixture. **The first real
consumer is T1.3.** That clause of the criterion cannot be satisfied by T1.2
alone, which is worth knowing before anyone ticks it.

### The next task is T1.3 — candles. NOT part of T1.2.

**Its migration must NOT be written until the primary key, unique constraint and
index reasoning have been presented and APPROVED.** That is a standing
instruction from the user, and the reason is that `candles` is the table every
other table references, it will hold hundreds of thousands of rows per provider
per year, and its query patterns are only partly knowable because the engine
that queries it does not exist yet.

The reasoning as it currently stands, for re-presentation rather than for
copying into a migration:

- **Primary key `(instrument_id, provider_id, timeframe, open_time)`** —
  composite and natural, no surrogate `id`. That tuple IS the bar's identity; a
  surrogate would let two rows claim to be the same bar with different prices,
  both valid, which is the corruption T1.3's idempotent upsert exists to prevent
  and would move the guarantee out of the database, which §9 forbids.
- **The unique constraint IS that primary key.** A separate unique index over
  identical columns would be a duplicate paying write cost for nothing.
- **Column order is deliberate**: `instrument_id` first because every query
  filters it, `open_time` last because it is the only ranged column and a B-tree
  range-scans only on its trailing column.
- **One extra index**: partial, `WHERE is_final = false`, for the forming bar —
  at most one per series.
- **Deliberately NOT added**: an index on `open_time` alone. It serves "all
  instruments at time T", which does not exist in Phase 1, and would cost a
  write on every insert of a ~161,000-row backfill.

### ⚠️ Hazards a cold session needs

**`config.value` is `jsonb` — NOT NUMERIC.** There are no NUMERIC columns
outside migration 0001. The hazard is real but different from prices: `jsonb`
returns through `JSON.parse`, so **any number stored in `config.value` becomes a
float64**. If a price, tick size or threshold is ever put there it acquires
exactly the corruption the `NUMERIC`-as-string design avoids, by another route,
with no type to stop it. **Nothing reads `config.value` yet — latent, not
broken.** Whoever writes the first consumer needs to know.

**A failed restore leaves the database EMPTY and must be run TWICE.** Observed
live on 2026-08-31: restoring a pre-migration backup over the migrated schema
made layer-3 content verification fire correctly and quarantine `public` to
`failed_restore_<timestamp>` — leaving an empty `public`. The second invocation
then restored properly. **The error message does not say this**, and an operator
mid-incident would reasonably think everything had been lost. Worse, the
documented rollback path in DEPLOYMENT.md trips it every time, because a
pre-migration backup by definition has fewer tables than the current schema.
**Owed: fix the message, and document the two-step behaviour. TRACKED AS
OBLIGATION 38 from 2026-09-02** — it had been carried as an unnumbered "Owed"
line since 2026-08-31, which meant nothing scheduled it and no obligation row
carried it.

### Verified counts — PHASE 0 CLOSURE SNAPSHOT, 2026-08-31 morning

**Superseded.** Current counts are in the handoff at the top of this file; T1.2
has since added tests. Kept because it is the run the Phase 0 closure was
assessed against.

```
install --frozen-lockfile  exit=0     unit tests          307 passed
lint                       exit=0     integration tests    66 passed
format:check               exit=0
typecheck                  exit=0     migrations applied     2
test [PostgreSQL STOPPED]  exit=0     market_hours rows      6
test:integration           exit=0
```

The PostgreSQL-stopped run was verified with a positive control: `pg_isready`
returned "no response" before the suite ran.

### Due NOW, and overdue — ALL CLEAR as of 2026-09-02

1. ~~**Obligation 35 — `Dependabot Updates` red since 2026-08-29.**~~
   **DISCHARGED 2026-09-01 in `7754628`**, and the recorded hypothesis was
   REFUTED rather than confirmed — discovery had never stopped. Replaced by
   **obligation 36**, which asked the one question that session could not
   answer: whether the job is actually green. **Obligation 36 is now DISCHARGED
   ON EVIDENCE (2026-09-02)** — Dependabot alert #1 observed **CLOSED AS FIXED**,
   with a dependency rescan postdating the push. Not "no red runs": that job will
   never run again, so silence proved nothing either way. See OBLIGATIONS.md.
   **Note also:** `7754628` was not pushed until 2026-09-02, so no Dependabot run
   could have executed against it before then. **There is no automatic push** —
   see the refutation in the Phase 0 gate section.
2. ~~**Obligation 10 — CSV fixture quoted commas.**~~ **DISCHARGED 2026-09-02** —
   the loader now REFUSES a quoted field instead of mis-parsing it.
3. ~~**Obligation 25 — split STATUS.md.**~~ **DISCHARGED 2026-09-02** — split
   into `docs/LESSONS.md` and `docs/OBLIGATIONS.md`, moved verbatim and
   verified byte-identical. This file went 3,248 → 1,872 lines.

**NOTHING IS OVERDUE.** 10 and 25 were the last two, both discharged
2026-09-02.

### Obligations — see [OBLIGATIONS.md](./OBLIGATIONS.md)

**The summary table that stood here until 2026-09-02 is DELETED, not
regenerated.** It had already diverged from the ledger it summarised: it filed
obligation 5 as `unscheduled` where the ledger says `T1.4, T1.7`, omitted that
row entirely, and drifted on a label. A second copy inside the Phase 0 gate
section below was worse — fourteen disagreements between the two copies in
total, most of them obligations discharged days earlier.

**Deleted rather than regenerated because there is no mechanism to keep a copy
in step.** Regenerating would have produced a correct table with the same
future: it goes stale the next time the ledger changes, and the only thing
holding it accurate is someone remembering to edit two files — the discipline
obligation 25's split exists to replace. A CI check diffing the two was the
alternative, and it is real, but building a checker to guard a convenience copy
costs more than not having the copy.

**What a cold session should do instead:** open
[OBLIGATIONS.md](./OBLIGATIONS.md) and read the "Lands in" table. It is one
file, and it is the only place an obligation's schedule is recorded.

**Obligation 12 blocks all of Phase 2, not a task.** Read its section before
planning that far ahead: the Pine Script workaround is untried and the fallback
is a purchase.

## ⛔ PHASE 0 CLOSED AT LOCAL SCOPE — 2026-08-31. A DEPLOYMENT GATE WAS NEVER RUN.

**This is not "Phase 0 complete".** Phase 0 is closed at **local scope**, with
**five deployment criteria deferred to T6.1 by ADR-011**. Nothing has ever been
deployed: `.railway/railway.ts` has never been applied and `railway iac plan`
has never run successfully.

**Never run, and not inferable from an obligations table:**

| Deferred criterion | Where it lands |
|---|---|
| `web` and `worker` deploy as separate services, both healthy | T6.1 |
| Healthcheck proven as a **deploy gate** | T6.1 |
| Migrations as a pre-deploy release step, failure blocks the deploy | T6.1 |
| Secrets configured on the platform | T6.1 |
| **Platform** rollback performed once | T6.1 |

**Why closing is honest rather than convenient.** The test applied was *"would
these deferrals cause a Phase 1 defect?"* — not *"does Phase 0 look done?"*.
The answer is no, and it was checked rather than assumed: `grep -inE
"deploy|railway|hosted|production|uptime"` across the whole of Phase 1 returns
nothing. T1.1–T1.10 are provider evaluation, contracts, storage, backfill,
validation, aggregation, live feed, watchdog, reconciliation and the golden
dataset. Every one runs locally. **Holding the phase open would protect
nothing.**

**What WAS proven, locally:** install, lint, format, typecheck all exit 0; 239
unit tests pass **with PostgreSQL stopped**, verified with a positive control;
57 integration tests pass; backup and restore drilled with five deliberate
failures; local rollback drilled with three. Two criteria that failed at the
gate run — `pnpm build` and a stale `CLAUDE.md` — were fixed before closing.

**One thing this closure does NOT establish:** ordered shutdown on SIGTERM. That
test is `skipIf(win32)` and cannot execute on this machine. It is proven by CI
on Linux (2026-08-27) and its code is unchanged since — but no fresh evidence
was produced here, and CI status could not be read from this machine.

---

## ⚠️ THE ONE THING THAT BLOCKS A WHOLE PHASE — obligation 12, C3 golden values

**Read this before planning Phase 2. It is not a task-sized problem.**

**What it is.** Audit finding C3 requires indicator parity — our EMA and Stoch
RSI must match TradingView's own computed values within a documented tolerance.
To assert parity we need TradingView's numbers as a golden dataset. **We do not
have them, and there is currently no route to them.**

**Why Phase 2 cannot proceed without it.** Phase 2 is the technical engine:
EMA, Stoch RSI, swings, structure, zones, liquidity, sweeps, breakout, pullback,
room — all pure functions in `packages/core`. Its gate is "golden-value parity
with TradingView within documented tolerance". **Without TradingView's values
there is nothing to assert engine output against**, so the phase can be built
but not validated. Every downstream phase — the weekly map, the state machine,
grading, and Phase 9's backtest — rests on indicators nobody has checked against
an external reference. Shipping Phase 2 unvalidated would put an unverifiable
assumption underneath everything after it.

**What has been tried.** TradingView's *Export chart data* is a **paid feature
the user does not have**, so the golden CSV planned for T0.6/T1.10 was never
produced. That is the whole of it: **the workaround below is untried.**

**The options, with costs:**

| Route | Cost | Risk |
|---|---|---|
| **1. Pine Script `log.info()`** — make the chart emit its own indicator values | free; scripting time | **UNTRIED.** If output is truncated, rate-limited, or rounded in display, it may not yield fixture-grade numbers |
| **2. One month of paid TradingView**, purely to run the export | one month's subscription | lowest risk, known to work, produces a real CSV |
| **3. Manual transcription of ~20 bars** | tedious, error-prone | a **spot check, not a fixture** — cannot support byte-for-byte reproduction (NFR-12) |

**The honest position: if route 1 fails, Phase 2 stalls on something with no
cheap alternative.** Route 2 becomes necessary, and it is a purchase. Route 3
cannot substitute — it is too small to be a fixture and would give false
confidence.

**Recommendation: attempt route 1 EARLY, well before Phase 2 begins**, so the
answer is known while there is still time to fall back. Testing it costs an
afternoon; discovering it at the start of Phase 2 costs the phase.

**This blocks nothing in Phase 0 or Phase 1.**

---

### Where things stand

| | |
|---|---|
| Phase 0 tasks | **10 of 10 implemented** |
| Phase 0 gate | **CLOSED AT LOCAL SCOPE 2026-08-31.** All local criteria pass; five deployment criteria DEFERRED to T6.1, never run |
| T0.10 | **CLOSED at local scope.** L5 (CLAUDE.md) was FIXED before the gate closed; L4 remains partial — the destructive-migration variant was never run. **L1 is no longer unenforced:** obligation 33 was DISCHARGED 2026-09-01 by `wiring-assertions.test.ts`, and this cell said otherwise for a day |
| Deployment | **NONE.** ADR-011 makes the project local-only for Phases 1–5 |
| Open obligations | **See [OBLIGATIONS.md](./OBLIGATIONS.md)** — the count is deliberately not restated here. This cell read "**20** as of 2026-09-01" until 2026-09-02, by which point 10, 25 and 36 had also been discharged and 38 opened. It was the fourth copy of a number that lives in one place |

### Verified counts — from an actual run, 2026-08-31

```
lint             exit=0     unit tests          239 passed
format:check     exit=0     integration tests    57 passed (1 skipped)
typecheck        exit=0     db:drill            exit=0
test             exit=0     rollback:check      exit=0
test:integration exit=0
```

**These are measured, not carried forward.** Re-run rather than cite them if
anything has changed — a measurement's validity expires when the code it
measured changes.

### The BUILD-PLAN drift — FOUND AND FIXED 2026-08-31

ADR-011 re-scoped T0.10 on 2026-08-30 and the re-scope reached DECISIONS.md and
BUILD-PLAN.md's T0.10 section. **Three references elsewhere were missed**, found
by grepping the plan for "Railway":

| Location | Was | Now |
|---|---|---|
| **Phase 0 Quality Gate** | "Both Railway services deployed and healthy" | struck through, **DEFERRED to T6.1** |
| T0.4 objective | "locally and on Railway" | amended; the Railway Postgres was deleted in T0.10 |
| T0.4 manual step | "creating the Railway Postgres instance" | amended |

**The gate one mattered most: the gate as written could not pass.** Also
re-dated three obligations (17, 19, 24) that were still due at "T0.10", a task
now closed with deployment deferred. All fixed; recorded as a lesson.

### The next task — the Phase 0 gate

It is in BUILD-PLAN.md under "Phase 0 Quality Gate". As amended it is:

1. CI green on `main`
2. ~~Both Railway services deployed~~ — **DEFERRED, do not tick**
3. `typecheck`, `lint`, `test`, `test:integration`, `build` pass locally
4. Rollback proven once — **LOCAL only**; platform rollback deferred
5. `CLAUDE.md` and `docs/STATUS.md` accurate
6. Zero secrets in Git history

**It cannot be passed in full while ADR-011 stands, and that is the intended
state.** Phase 1 proceeds with the deployment criterion explicitly outstanding.

**Criterion 5 is currently FALSE** — `CLAUDE.md` documents none of the four
commands T0.10 added (`db:backup`, `db:restore`, `db:drill`, `rollback:check`).
Fix that before or during the gate; it is the only cheap failure on the list.

### Obligations by where they land — FROZEN SNAPSHOT, 2026-08-31. DO NOT READ AS CURRENT.

**This table records what was believed during the Phase 0 gate run on
2026-08-31 and is kept as part of that record. It is WRONG as of 2026-09-02**
and is deliberately not updated: obligations 6, 10, 14, 23, 25, 33 and 35 below
are all DISCHARGED, 3 and 4 are T6.1 rather than unscheduled, 11 is missing from
"before Phase 2", and 36, 37 and 38 did not exist yet.

**The authoritative ledger is [OBLIGATIONS.md](./OBLIGATIONS.md).** Nothing here
should be used to plan anything.

| Lands at | Obligations (AS BELIEVED ON 2026-08-31) |
|---|---|
| **before T1.2** | 25 (split STATUS.md) |
| **start of T1.2 — firm** | 35 (Dependabot red since 2026-08-29) |
| **before T1.3** | 33 (ADR-003 unenforced by any check) |
| **T1.3** | 31 (`db:restore` atomicity on a large dump) |
| **T1.7** | 22 |
| **before Phase 2** | 12 |
| **before Phase 6** | 16 |
| **T6.1** | 17, 19, 24, 27 (OPS-8 monitoring), 32 (ADR-003 forward-compat vs readiness) |
| **standing** | 34 (rollback procedure never used cold) |
| **unscheduled** | 3, 4, 5, 6, 7, 9, 10, 11, 14, 23 |

**Obligation 35 is the one with a date attached.** A security control has been
failing since 2026-08-29; it was deferred deliberately, and the deal was that it
gets checked at the start of T1.2 rather than deferred again.

**Obligation 34 is not a task to close.** The rollback procedure was written and
drilled by the same session, so every ambiguity in it was resolved by knowledge
its reader will not have. There is no honest way to close it except by someone
running it cold, and **the first genuine test will be the first real incident.**
That is expected. Leave it listed; when it is first used in anger, record what
was unclear.

### Do not

- Do not tick the deployment criterion. Nothing has been deployed, `railway.ts`
  has never been applied, and `railway iac plan` has never run successfully.
- Do not treat T0.10's re-scope as a completion.
- Do not run `pnpm db:reset` casually — it is `docker compose down -v` and
  destroys the volume. From T1.3 that volume holds candle history.

---

## Current position

| | |
|---|---|
| Phase | **Phase 0 — Engineering Foundation** |
| Complete | **T0.1 – T0.9** (9 of 10). T0.9 closed 2026-08-28 with two partials |
| Next task | **T0.10 — Railway deploy + project documentation** (not started) |
| Branch | `main`, working tree clean. (Commit count deliberately not stated — a self-referential number in a committed file is stale the moment it lands. Use `git log --oneline`.) |
| Remote | `origin` = `github.com/georginamurray2026-eng/KaratX` (**public**, verified unauthenticated 2026-09-01). `main` is pushed MANUALLY — there is no automatic push, and it can sit ahead of the remote. `git status` reports the divergence; `git ls-remote origin refs/heads/main` asks the server. `git rev-parse origin/main` reads a local tracking ref and can agree with `main` even when nothing was ever sent |

Phase 1 task **T1.1** (provider evaluation) was completed early, then **REOPENED
and RE-RUN on 2026-08-27** when OANDA v20 proved unavailable. **It is now
CLOSED: [ADR-008](./DECISIONS.md) supersedes ADR-005.**

> **Cold-session summary of where T1.1 landed.** The feed is **Twelve Data**
> (`XAU/USD`, native 15min, 6.6 years of verified depth, free tier). **Massive**
> (ex-Polygon.io, `C:XAUUSD`) is the reconciliation source AND the trading-calendar
> oracle. **No paid market-data access** — an explicit user constraint. OANDA is
> out because a Thailand-resident account is routed to an entity whose platform
> has no v20 API: **it failed as a broker, not as a data source.** Every number
> in ADR-008 was measured against a live API, not read from documentation.
> ADR-008 carries the reversal conditions; read those before re-litigating it.

---

## Verification state

All run on **2026-08-28** from a clean tree.

```
pnpm install --frozen-lockfile   EXIT=0
pnpm lint                        EXIT=0
pnpm format:check                EXIT=0
pnpm typecheck                   EXIT=0
pnpm test                        EXIT=0   235 tests  (PostgreSQL CONFIRMED STOPPED)
pnpm test:integration            EXIT=0    57 tests + 1 deliberate skip
pnpm --filter @karatx/web build  EXIT=0
pnpm --filter @karatx/web test:e2e EXIT=0    5 Playwright tests
```

Every exit code above is from a run on **2026-08-28**, not recalled. PostgreSQL
was stopped and its absence confirmed (`docker ps` count 0) before the unit
run, so "database-free" is measured rather than assumed.

Unit test breakdown:

| Package | Files | Tests |
|---|---|---|
| `packages/core` | 2 | 47 |
| `packages/test-support` | 4 | 64 |
| `packages/config` | 5 | 46 |
| `packages/db` | 1 | 11 |
| `apps/web` | 1 | 5 |
| `apps/worker` | 3 | 33 |
| `packages/providers` | 1 | 29 |
| **total** | **17** | **235** |

Integration (57): `packages/test-support` 15, `packages/db` 19, `apps/web` 9, `apps/worker` 14 — against real PostgreSQL, each run in its own ephemeral database. Plus 5 Playwright end-to-end tests against a real built server.

**Known failures: none. One deliberate skip**, named honestly rather than
hidden: the worker's end-to-end SIGTERM test is skipped on win32. Measured in
T0.8 — `process.kill(pid, 'SIGTERM')` on Windows calls TerminateProcess, so the
child dies with exit code 1 and its handler never runs. The test would FAIL
here, not pass vacuously. It runs on Linux, which is both the CI platform and
the deployment target. **Until CI has run it, OPS-3's end-to-end criterion is
unproven** — see "Not proven" and obligation 18.

---

## Phase 0 progress, verified from disk

| Task | State | Evidence |
|---|---|---|
| T0.1 Repo + workspace skeleton | **Done** | pnpm workspace, `apps/{web,worker}`, `packages/{core,contracts,db,providers,config}`, strict TS with `noUncheckedIndexedAccess` |
| T0.2 Lint, format, import boundaries | **Done** | ESLint + Prettier; `packages/core` boundary enforced on imports, globals and clock/random syntax. The deferred regression test landed in T0.6 |
| T0.3 Configuration and secrets | **Done, two honest gaps** | Zod schema, `Secret<T>`, sanitised errors. See "Not proven" below |
| T0.4 Database, Drizzle, first migration | **Done** | Docker Postgres 17, `system_events` + `config`, migration applied and idempotent, 9 integration tests |
| T0.5 Logging and error model | **Done** | Pino JSON, 3-layer redaction, correlation IDs, 8-class error taxonomy |
| T0.6 Test harness | **Done, two honest caveats** | `@karatx/test-support`; unit runs exclude integration tests and are verified with PostgreSQL stopped; ephemeral database per integration run; fixture loader; core-boundary regression test |
| T0.7 Web skeleton + health endpoints | **Done, one honest caveat** | Next 16 + React 19; /api/health and /api/ready; boot-time config validation that refuses to start; Playwright smoke test. See "Not proven" for the unenforced criterion |
| T0.8 Worker skeleton | **Done, three honest gaps** | Boot sequence, ordered shutdown, crash logging, heartbeat. 33 unit + 9 integration tests. Criterion 1 met; criteria 2 and 3 partial — see the close-out assessment. Obligations 20, 21, 22 |
| T0.9 CI | **Done, two partials** | Five parallel jobs on GitHub Actions, green on the first Linux run. Secret scanning, dependency scanning, migration immutability. Four deliberate breaks proved across two exercises. Partials: `build` is verified only incidentally and not at all for the worker (obligation 24); `on push` is narrowed to `main` |
| T0.10 Local operational readiness | **NOT CLOSED** | Re-scoped by ADR-011: local-only for Phases 1-5, five deployment criteria DEFERRED to T6.1. L2/L3 met, L1 met but unenforced (obligation 33), L4 partial, **L5 FAILS** - CLAUDE.md documents none of the four new commands. Backup/restore and rollback both drilled with deliberate failures. Obligations 31, 32, 33 |

`packages/contracts` is still a stub. It is populated in T1.2.

---

## T0.8 CLOSED OUT — assessed 2026-08-27, one criterion met of three

**Assessed against the repository, not against the pre-assessment. Two of the
three pre-assessed verdicts were WRONG and are corrected here.** The
pre-assessment was written from memory at the end of a long session; checking
the code found gaps it had glossed over.

| # | Criterion | Verdict |
|---|---|---|
| 1 | Boots, validates config, connects to the DB, writes a `system_events` startup row | **MET** |
| 2 | Handles SIGTERM: stops accepting work, finishes in flight, closes connections, exits 0 (OPS-3) | **PARTIAL** — four sub-clauses, one proven |
| 3 | Crash-loops are visible in logs, not silent | **PARTIAL** — pre-assessed as MET, which was wrong |

### Criterion 1 — MET

Proven by ORDER in a real process log rather than by reading the source:
`configuration validated` is log line 0 and precedes `database schema verified`.
A broken environment produces no JSON line at all, because the logger's level
and secret list come from the configuration that just failed. One
`process.started` row is asserted in the database by an integration test running
against a real migrated PostgreSQL. Confirmed capable of failing: planting an
early log line broke exactly three tests.

### Criterion 2 — PARTIAL. Do not tick.

| Sub-clause | State |
|---|---|
| finishes in flight | **proven** — a synthetic in-flight task, not zero hooks |
| closes connections | **UNVERIFIED against a real pool.** The lifecycle tests use a hook *named* `database-pool` that pushes to an array. Nothing asserts `pool.end()` actually released connections — e.g. by checking `pg_stat_activity` after shutdown |
| stops accepting work | **SEAM ONLY.** `isShuttingDown` has NO production consumer — `grep` finds it referenced solely by `lifecycle.ts` and its own tests. There is no work to stop accepting until T1.7 |
| exits 0 | **unproven on this platform.** Windows cannot deliver a catchable SIGTERM (measured: `TerminateProcess`, exit 1, handler never runs). The end-to-end test exists and is `skipIf(win32)` |

**The pre-assessment said "mechanism fully covered by 33 unit tests". That
overstated it.** The unit tests cover ordering, timeouts, failing hooks, second
signals and handler-to-exit-code wiring — genuinely thorough — but two of the
four sub-clauses above are not mechanism questions at all, and no number of
unit tests answers them.

### Criterion 3 — PARTIAL. The pre-assessment said MET; that was wrong.

**`installCrashLogging` has never been exercised in a real spawned worker.** It
is unit-tested by pulling the registered listener off `process` and invoking it
directly — which does prove the rethrow, the fatal level and the taxonomy
fields. But no integration test starts a real worker, makes it crash, and
asserts a fatal JSON line reaches stdout.

The T0.8 measurement that showed six failure modes exiting 1 under `tsx` does
not cover this either: **it was run before `crash-logging.ts` existed.**

So "crash-loops are visible in logs" is proven for the handler in isolation and
unproven for the process. That gap is exactly the shape of this project's
recurring defect — a thing that works in a test and has never been observed
working where it matters.

### Also assessed

- **Required test — "integration test asserting startup and graceful shutdown
  behaviour":** the startup half runs and passes. **The graceful-shutdown half
  does not run on this machine.** The test exists; the platform cannot execute it.
- **NFR-2 risk — "design the lifecycle hook for it now":** **MET.** `onShutdown`
  is the seam, and `lifecycle.ts` documents it as such.

### Quality gate — real exit codes, 2026-08-27

```
pnpm install --frozen-lockfile   EXIT=0
pnpm lint                        EXIT=0
pnpm format:check                EXIT=0
pnpm typecheck                   EXIT=0
pnpm test                        EXIT=0   235 tests, PostgreSQL CONFIRMED STOPPED
pnpm test:integration            EXIT=0    52 tests + 1 deliberate skip
```

### Verdict

**T0.8 is CLOSED with three honest gaps, none of which block T0.9.** Nothing is
known to be broken; what is missing is EVIDENCE.

Three of the four unproven sub-clauses are discharged inside T0.9 itself —
running the suite on Linux proves `exits 0` (obligation 18), and obligations 20
and 21 are two integration tests that belong with the CI work. The fourth,
`stops accepting work`, cannot be discharged until there is work to stop
accepting, which is T1.7 (obligation 22).

New obligations 20, 21 and 22 record them.

---
---

## PHASE 0 GATE — RUN 2026-08-31. **NOT PASSED.** Two criteria fail.

**Assessed adversarially against the repository, not against memory of it.** Two
criteria fail outright, one is unverifiable from this machine, one is deferred
by ADR-011, and two are met.

| # | Criterion | Verdict |
|---|---|---|
| 1 | CI green on `main` | **UNVERIFIABLE HERE** |
| 2 | ~~Both Railway services deployed and healthy~~ | **DEFERRED to T6.1** |
| 3 | `typecheck`, `lint`, `test`, `test:integration`, **`build`** pass locally | **FAILS** |
| 4 | Rollback proven once | **MET (local scope)** |
| 5 | `CLAUDE.md` and `docs/STATUS.md` accurate | **FAILS** |
| 6 | Zero secrets in Git history | **MET, with a documented exception** |

### Real exit codes — FULL RUN, 2026-08-31

**Re-run in full because the first run did not stop PostgreSQL, which makes the
unit-suite result a different measurement.**

```
pnpm install --frozen-lockfile   exit=0
lint                             exit=0
format:check                     exit=0
typecheck                        exit=0
test   [PostgreSQL STOPPED]      exit=0     239 unit tests, no database
test:integration                 exit=0      57 passed, 1 SKIPPED
pnpm build                       exit=1     <-- Command "build" not found
pnpm --filter @karatx/web build  exit=0
```

**The Postgres-down run is the one that matters** for T0.6's claim that unit
tests touch no database. Verified with a positive control: `pg_isready` against
the stopped container returned "no response" before the suite ran, so the
absence of failures is not an absence of the condition.

### The skipped test, followed rather than accepted

`57 passed, 1 skipped` is not 58 passed. The skip is
`describe.skipIf(process.platform === 'win32')('receiving SIGTERM')` — **the
ordered-shutdown path never executes on this machine.**

The chain matters:

- It is **proven**, by CI #1 on Linux, 2026-08-27 — obligation 18, discharged,
  with a detector that catches the skip being forced.
- The shutdown code and its test are **unchanged since** — `git log --since` on
  `boot.integration.test.ts` and `index.ts` returns nothing — so the measurement
  has not expired under STATUS.md's own rule.
- **But it was last EXECUTED four days ago, it cannot execute on Windows, and
  its only current evidence is CI — which criterion 1 cannot verify from here.**

So ordered shutdown on SIGTERM is believed-good on a four-day-old run, and this
assessment produced no fresh evidence for it. That is not a failure; it is the
honest limit of what a local gate can establish.

### THE JUDGEMENT CALL, made explicitly

**Question: can Phase 0 close with five deployment criteria outstanding?**

**Answer: YES — as a LOCAL-SCOPE gate with a documented deferral — but NOT
TODAY, because two local criteria fail.**

The deferral is legitimate on three grounds, and the third is the one that
actually decides it:

1. **ADR-011 is an accepted decision with a recorded trigger**, not a
   convenience. It was argued on cost, on architecture, and on what it costs us
   — the accepted-consequences section names data gaps, alerting, and the effect
   on Phase 9's backtest.
2. **T6.1 exists as a real task** with its own six criteria, not a note saying
   "later".
3. **No Phase 1 task depends on any deferred criterion.** Checked, not assumed:
   `grep -inE "deploy|railway|hosted|production|uptime"` across the whole of
   Phase 1 returns nothing. T1.1–T1.10 are provider evaluation, contracts,
   storage, backfill, validation, aggregation, live feed, watchdog,
   reconciliation and the golden dataset. Every one runs locally.

**What would make the deferral illegitimate**, and none of it is true here: if
the criteria had been reworded to fit what we had; if the deferral had no
trigger; if a Phase 1 task needed a deployment; or if "deferred" were recorded
anywhere as "met".

**But closure is blocked by criteria 3 and 5**, and neither is about deployment.
Both are local, both are cheap, and both are exactly what a gate is for.
Closing Phase 0 while `pnpm build` exits 1 and `CLAUDE.md` is stale would make
the gate ceremonial — it would be the third consecutive assessment to
over-credit in the same direction, this time knowingly.

**VERDICT: NOT PASSED, 2026-08-31.** Fix criteria 3 and 5, re-run, then close as
a local-scope gate with the five deployment criteria recorded as OUTSTANDING.

### 3 — FAILS. The gate names a command that does not exist.

```
$ pnpm build
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "build" not found
```

**There is no root `build` script.** Only `apps/web` has one (`next build`);
every other package has none, and `apps/worker` has none *by design* — ADR-009
runs its TypeScript source under `tsx`, which is obligation 24.

So the criterion is unsatisfiable as literally written. The substantive question
— does the only buildable package build? — answers yes, exit 0. **But "nearly
met" is not met**, and the fix is a decision, not a formality: either add a root
`build` that delegates to the packages that have one, or reword the criterion to
name what is actually built. **Do not tick it in its current form.**

### 5 — FAILS. `CLAUDE.md` does not document T0.10's commands.

```
db:backup 0    db:restore 0    db:drill 0    rollback:check 0
```

`CLAUDE.md` exists to brief a session with no memory of this one. Such a session
recovering from a bad change would not learn that `pnpm rollback:check` exists —
the command whose entire purpose is stopping them from reverting a migration.
The criterion says the file must be *accurate*; it is currently *stale*.

### 1 — UNVERIFIABLE from this machine, and not assumed

`gh` is not installed and the repository is private, so GitHub Actions' status
cannot be read from here.

> **CORRECTION, 2026-09-01: THE REPOSITORY IS NOT PRIVATE.**
> `GET /repos/georginamurray2026-eng/KaratX` returns `"private": false`,
> `"visibility": "public"`, **unauthenticated** — verified with no
> `GITHUB_TOKEN` or `GH_TOKEN` in the environment. Actions run status, job
> steps and check-run annotations ARE readable from this machine without `gh`
> and without credentials, and obligation 35 was diagnosed that way. The
> paragraph below is kept because its CAUTION still holds — a red run can sit
> unnoticed — but its stated REASON was wrong, and it cost the project a
> capability it had all along. **What WAS verified — A SINGLE OBSERVATION, LATER MIS-READ AS A MECHANISM:**
on 2026-08-31, `git ls-remote origin refs/heads/main` returned the same SHA as
local `HEAD`. That was ONE reading at ONE moment. It showed only that a push
had happened at some point; it was never evidence that anything pushes by
itself. **REFUTED 2026-09-02** — see the correction below.

**Whether it went green is unknown and must not be inferred.** A human needs to
look. **The Dependabot case is now CLOSED and is worth reading as the worked
example of this exact caution:** obligation 35 recorded `Dependabot Updates` red
since 2026-08-29, obligation 36 refused to call it fixed without looking, and
the closure finally came from a POSITIVE observation — alert #1 CLOSED AS FIXED —
because the failing job would never run again and silence could not distinguish
a fixed control from a broken one.

**REFUTED 2026-09-02 — THERE IS NO AUTOMATIC PUSH.** This paragraph previously
recorded that no `git push` had been issued yet the remote was current, and
concluded "something is pushing automatically... anything committed here is
published immediately". **That conclusion was wrong, and it was wrong on the
day it was written.** It rested on a single matching `ls-remote` reading, which
is evidence that a push occurred at some point and is not evidence of a
mechanism. One observation of a matching state cannot distinguish "it pushes
itself" from "someone pushed".

**How it was refuted:** on 2026-09-02, local `main` stood at `fa8ec1d` with SIX
commits (`7754628`, `5949282`, `c6e4538`, `dd03445`, `10c0195`, `fa8ec1d`)
absent from the remote, which was still at `edfbf3d`. Confirmed with `git
ls-remote origin refs/heads/main`, which asks the server, rather than `git
rev-parse origin/main`, which reads a local tracking ref and can agree with
`main` even when nothing was ever sent.

**The practical consequence: commits are NOT published on commit.** Nothing
reaches GitHub, CI or Dependabot until someone runs an explicit `git push`.
**This cuts both ways.** The reassurance was false — work can sit unpushed and
un-CI'd for days, as six commits did here, including a security fix believed to
be live. So was the alarm: a committed secret is not published immediately,
which means a window exists in which history can still be rewritten.

### 6 — MET, with a documented exception that should be stated rather than ticked past

Full-history scan across 70 commits, **run with a positive control** (the known
committed local dev password, which the search correctly found — otherwise
"no results" would have been indistinguishable from a broken search, and the
first attempt *was* broken: `grep -t` is not an option and silently produced
nothing).

- **On `main`: clean.** No credentialed connection string, no key literal, no
  PEM block, and `.env` has never been committed — 0 commits, ever.
- Every connection string found is a localhost, fixture or documentation value.
- **One token-shaped literal exists**, `CI_PROOF_TOKEN`, on branch
  `ci/verify-red` — **still present locally AND on origin**. It is the fake
  planted in T0.9 to prove gitleaks fires; it matches no account and its
  permanence was a recorded, deliberate decision. **But STATUS.md describes it
  as living in "a branch that was always going to be deleted", and the branch
  is still there.** Deleting it would not remove the objects — that is the whole
  lesson — so this is cosmetic, not a security action. Recorded rather than
  quietly resolved.

### Can Phase 0 close?

**Not as written, and not today.** But the blocker is not the deferral.

**The five deployment criteria are legitimately deferrable.** ADR-011 is an
accepted decision with a recorded trigger, T6.1 exists with its own criteria,
and Phase 1 does not depend on any of them. A gate that closes with an explicit,
dated, documented deferral is honest; one that quietly rewords the criterion
away is not.

**What actually blocks closure is criteria 3 and 5, and both are cheap.** Fix
`CLAUDE.md`, resolve the `build` criterion, re-run, and Phase 0 closes as a
**LOCAL-SCOPE GATE WITH FIVE DEPLOYMENT CRITERIA OUTSTANDING** — recorded as
outstanding, not as met.

**It should not close before those two are fixed**, because both are exactly the
kind of small failure a gate exists to catch, and ticking either would make the
gate ceremonial.

---

## T0.10 CLOSED OUT — assessed 2026-08-31. NOT fully done.

**Assessed against the repository, separately from the implementation, and
treated as adversarial.** The question asked was not "does this look done" but
"what would I have to find to call this unfinished". Three things were found.

**T0.10 was RE-SCOPED by ADR-011, not completed.** Five of the original nine
sub-criteria are **DEFERRED to T6.1**. A re-scope is not a completion, and this
close-out does not treat it as one.

### The four LOCAL criteria

| # | Criterion | Verdict |
|---|---|---|
| L1 | Migrations run as a deliberate step, never at boot | **MET, BUT UNENFORCED** — see below |
| L2 | No secrets in Git history | **MET**, re-verified 2026-08-31 |
| L3 | Local backup and restore drill, performed once | **MET** — `pnpm db:drill` exit 0 |
| L4 | Local rollback drill, performed once | **PARTIAL** — three of four parts |

**L1 — met by convention, not by a check.** No application code imports
`runMigrations`: `grep -rn "runMigrations" apps/ --include="*.ts"` excluding
tests returns nothing, which is correct. **But nothing enforces it.** No CI
step, no lint rule, no test asserts that boot does not migrate. A future commit
could add a boot-time migration and every gate in this repository would stay
green. The policy is protected by a comment in `migrate.ts` and by ADR-003 —
that is documentation, not a guard. **Obligation 33.**

**L2 — re-verified rather than inherited.** The prior verification was
2026-08-28, and **25 commits** have landed since. STATUS.md's own lesson says a
measurement's validity expires when the code it measured changes, so it was
re-run: the full `3cd3f93..HEAD` diff scanned for connection strings, key
assignments and PEM headers — no matches; `.env` still ignored, 0 commits ever
touching it.

**L4 — three of four parts, and the fourth is named rather than glossed.** The
pass, FAIL-1 (reverted the wrong thing), FAIL-2 (process never restarted) and
FAIL-3 (code back, schema ahead) were all performed with observables recorded
before and after. **The destructive-migration variant was NOT run** — no
migration that drops or narrows a column was applied, so "recover from a bad
migration end to end" rests on the restore being proven (L3) plus the schema-
ahead case, not on a genuinely breaking migration. Honest status: the mechanism
is proven, the specific scenario is not.

### The five DEFERRED criteria — deferred, NOT met

| # | Criterion | Status |
|---|---|---|
| D1 | `web` and `worker` deploy as separate services, both healthy | **DEFERRED to T6.1** |
| D2 | Healthcheck proven as a DEPLOY GATE | **DEFERRED to T6.1** |
| D3 | Migrations as a pre-deploy release step, failure blocks the deploy | **DEFERRED to T6.1** |
| D4 | Secrets configured on the platform | **DEFERRED to T6.1** |
| D5 | Platform rollback performed once | **DEFERRED to T6.1** |

Nothing has ever been deployed. `.railway/railway.ts` has never been applied,
and `railway iac plan` has never run successfully.

### The documentation criteria

| # | Criterion | Verdict |
|---|---|---|
| L5 | `CLAUDE.md` states the project, invariants, stack, **commands**, docs | **FAILS** |
| L6 | `docs/STATUS.md` accurately reflects reality | **MET** — this section |
| L7 | ADRs 001–004 written | **MET** |
| L8 | OPS-5 — nothing depends on local filesystem persistence | **MET, with a note** |

**L5 FAILS, and it is not a quibble.** T0.10 added four commands and `CLAUDE.md`
mentions none of them:

```
db:backup       0 occurrences
db:restore      0
db:drill        0
rollback:check  0
```

The criterion says "states … the commands", and the whole purpose of that file
is briefing a session that has no memory of this one. A session told to recover
from a bad change would not learn that `pnpm rollback:check` exists.

**L8 — met, with the note that `backups/` is now local filesystem state.** It is
an operational artefact rather than an application dependency: no application
code reads it, and nothing in `apps/` breaks if it is absent. The related
limitation, already recorded, is that dumps sit on the same disk as the database
they protect.

### Quality gate — real exit codes, 2026-08-31

```
lint              exit=0        test:integration  exit=0
format:check      exit=0        db:drill          exit=0
typecheck         exit=0        rollback:check    exit=0
test (unit)       exit=0
```

### Verdict

**T0.10's local scope is NOT closed.** L5 fails outright, L1 is unenforced, and
L4 is partial. Owed before Phase 1: update `CLAUDE.md` (L5), and decide
obligation 33. The five deployment criteria are carried to T6.1 with a recorded
trigger, and obligations 31 and 32 remain open against L3 and L4.



## T0.9 CLOSED OUT — assessed 2026-08-28, two criteria met of four

**Assessed against the repository, separately from the implementation, and
treated as adversarial.** The question asked was not "does this look done" but
"what would I have to find to call this unfinished".

| # | Criterion | Verdict |
|---|---|---|
| 1 | install → format → lint → typecheck → unit → integration (Postgres) → build → Playwright, on push AND PR | **PARTIAL** — 7 of 9 sub-parts met; `build` and `on push` both narrowed |
| 2 | Secret scanning enabled | **MET**, with a recorded limitation |
| 3 | Dependency vulnerability scanning (SEC-10) | **MET** |
| 4 | A deliberately broken commit turns CI red, verified once on purpose | **MET, and exceeded** |

### Criterion 1 — PARTIAL. Do not tick.

| Sub-part | State |
|---|---|
| install | **met** — every job, `--frozen-lockfile` |
| format check | **met** — `static` job |
| lint | **met** — and proven running in CI by a deliberate break, not merely present |
| typecheck | **met** — `static` job |
| unit tests | **met** — `unit` job, no `services:` block, and asserts nothing listens on 5432 |
| integration with a Postgres service | **met** — `postgres:17`, pinned to match `docker-compose.yml` |
| **build** | **PARTIAL — see below** |
| Playwright smoke | **met** — `e2e` job, Chromium |
| **on push AND PR** | **NARROWED — see below** |

#### `build` — verified, but incidentally, and not at all for the worker

**`apps/web` IS built on every run, twice**: explicitly in the integration job,
and again inside Playwright's `webServer` for e2e. The production build genuinely
succeeds or the pipeline fails.

**But no job exists whose PURPOSE is to verify the build.** The integration
build step exists to make apps/web's instrumentation test work — it spawns
`next start`, which needs `.next`. Remove that test and the step reads as
deletable, leaving the only build inside a Playwright config. A criterion met as
a side effect of something else is one commit away from not being met.

**And `apps/worker` HAS NO BUILD AT ALL.** It has no `build` script; it runs
`tsx src/index.ts`. So for the worker this is not narrowed — **nothing verifies it
compiles into a deployable artefact, because there is no artefact.** Obligation
24.

#### `on push AND PR` — deliberately narrowed, with a cost already paid

```yaml
on:
  push:
    branches: [main]     # <- filtered
  pull_request:          # <- unfiltered
```

**Every path INTO `main` is covered**: a pull request is checked, and the merge
to `main` is checked. Nothing reaches the default branch unverified.

**But the literal criterion says "on push", and pushes to any other branch fire
nothing.** That is a real narrowing, chosen so CI does not run on every scratch
branch — including the throwaway probe branches this project uses.

**The cost is not hypothetical: it cost two attempts of the deliberate-red
exercise** and produced instance 10, a confident prediction written for a process
nobody had checked could start. Recorded rather than smoothed, and revisit if
branch-push CI is ever wanted.

### Criterion 2 — MET, with a limitation worth stating

gitleaks scans full history on every run, proven by a deliberate break (RuleID
`github-pat`, value REDACTED), and proven capable of firing before the clean
history result was trusted.

**It DETECTS; it does not PREVENT.** GitHub push protection would block a secret
before it lands, but on private repositories that needs paid Secret Protection.

> **CORRECTION, 2026-09-01: this repository is PUBLIC** (`"visibility":
> "public"`, verified unauthenticated). **Secret scanning and push protection
> are FREE on public repositories.** The limitation recorded below was accepted
> on the belief that prevention had to be bought; it does not. See obligation
> 37 — this is a free upgrade from DETECT to PREVENT, and it is not enabled.
The deliberate-red exercise demonstrated the consequence directly: a planted
token entered the repository permanently, broke `main` until the branch was
deleted, and remains visible in the closed PR forever.

### Criterion 3 — MET

`pnpm audit --audit-level=high` fails the build on high and critical.
Dependabot alerts and security updates verified enabled 2026-08-28. Grouped
weekly update PRs configured, after the first push opened five at once.

### Criterion 4 — MET, and exceeded

The criterion asks for one deliberately broken commit verified once. **Four
breaks were proved across two exercises**, with linkable runs, plus step-level
evidence that independent steps report independently. See the deliberate-red
section.

### Also assessed

- **Manual step — creating and connecting the repository:** done. Settings
  verified 2026-08-28.
- **"Tests: the pipeline is the test":** met, and unusually well - the pipeline
  has been observed both green and deliberately red, at step level.
- **Obligations 2, 10a, 13, 15, 18, 20, 21 — all discharged**, each with
  evidence. **20 and 21 were proven at the ASSERTION level rather than the test
  level**: one mutation per assertion, because a test with three assertions and
  one mutation has proven one assertion.
- **Obligation 23 is newly NAMED, not owed by T0.9.**

### Quality gate — real exit codes, 2026-08-28

```
pnpm install --frozen-lockfile   EXIT=0
pnpm lint                        EXIT=0
pnpm format:check                EXIT=0
pnpm typecheck                   EXIT=0
pnpm test                        EXIT=0   235 tests, PostgreSQL CONFIRMED STOPPED
pnpm test:integration            EXIT=0    57 tests + 1 deliberate skip
pnpm --filter @karatx/web build  EXIT=0
pnpm --filter @karatx/web test:e2e EXIT=0
```

### Verdict

**T0.9 is CLOSED with two partials, neither of which blocks T0.10 — and both of
which T0.10 is the right place to resolve**, since they are questions about how
the thing is deployed rather than how it is checked.

---

## THE EXACT NEXT TASK

**T0.10 — Railway deployment and project documentation.** The last task in Phase
0, and the one that turns a verified repository into a running system.

BUILD-PLAN acceptance criteria:

- `web` and `worker` deploy from the same repo as separate Railway services, both healthy
- Migrations run as a deliberate release step (OPS-2 / ADR-003)
- Secrets configured in Railway, absent from Git
- **Rollback procedure documented AND PERFORMED ONCE to prove it works**
- `CLAUDE.md` states the project, the three F.3 invariants, the stack, the commands, and where docs live
- `docs/STATUS.md` accurately reflects reality
- ADRs written: ADR-001 monorepo + worker split, ADR-002 Postgres + Drizzle, ADR-003 migration policy, ADR-004 logging + error model

**The rollback criterion is the positive-control rule applied to deployment: a
documented rollback nobody has performed has not been shown to work.**

**Obligations landing in T0.10 — six:** **3** (verify Railway's pre-deploy
release mechanism), **4** (backup AND a TESTED restore), **17** (re-measure
worker boot-failure behaviour against however Railway runs it), **19**
(`apps/web` resolves the repo root from a bundled module), **24** (the worker
has no build artefact), and **6** (no ADR records the TypeScript 6.x pin).

**Obligations 17, 24 and the pino-flush scope limit are ONE UNDERLYING QUESTION:
does production run `tsx` or a compiled artefact?** Every measurement of the
worker's crash and boot behaviour was taken under `tsx`. Answer that first and
three findings resolve together; answer it late and all three need re-measuring.

**Risk from BUILD-PLAN:** OPS-5 — verify nothing depends on local filesystem
persistence.

---

## Architecture in brief

Two deployable processes, one repository (ADR-001, audit H6).

```
apps/web       Next.js dashboard. Reads what the worker wrote. Never computes strategy.
apps/worker    Long-lived Node process: feed, scheduler, engine, dispatcher.
packages/core        pure domain. NO I/O. Indicators, structure, state machine.
packages/contracts   Zod schemas shared across boundaries. (stub)
packages/db          Drizzle schema, migrations, queries.
packages/providers   adapters + the logger.
packages/config      env parsing and validation.
```

**Three hard invariants** (F.3) — these are the ones to defend in review:

1. `packages/core` performs no I/O. No fetch, no database, no clock reads.
   Time is passed in. Enforced twice: ESLint rules (T0.2) and `"types": []`
   so the package cannot even name `process` at the type level (T0.3).
2. Only the deterministic state machine may change setup state. The LLM
   annotates; it never decides.
3. Every derived fact records `occurred_at` and `confirmed_at`. Queries filter
   on `confirmed_at`.

**Stack:** TypeScript 6.0.3 (pinned, see obligations), pnpm 11, PostgreSQL 17,
Drizzle, Zod 4, Vitest 4, Pino 10, ESLint 10, Prettier 3, Node 24.

---

## Commands

```
pnpm install            pnpm lint          pnpm typecheck
pnpm test               pnpm format:check  pnpm test:integration

pnpm db:up              start local Postgres (Docker)
pnpm db:down            stop it, keep data
pnpm db:reset           destroy the volume and start clean
pnpm db:generate        generate a migration from the schema (no DB, no credentials)
pnpm db:migrate         apply migrations — deliberate step, never at boot (ADR-003)

pnpm --filter @karatx/worker dev     run the worker (tsx watch)
pnpm --filter @karatx/worker start   run the worker once
```

Local setup for a fresh machine: `cp .env.example .env` then `pnpm db:up`.
The password in `.env.example` is a throwaway local value matching
`docker-compose.yml`; Postgres is bound to `127.0.0.1` only. Real credentials
never live in this repository.

---

## Not proven — stated honestly rather than ticked

These acceptance criteria are **partially** met. Do not record them as done.

- **T0.9 "build" as a pipeline step — PARTIAL.** `apps/web` is genuinely built on every run, twice, so the production build succeeds or CI fails. But no job exists whose PURPOSE is verifying it: the integration build step exists to make the instrumentation test work, and would read as deletable if that test went. And `apps/worker` has no build at all — obligation 24.
- **T0.9 "on push AND PR" — NARROWED, deliberately.** `push` is filtered to `main`; `pull_request` is not filtered. Every path into `main` is covered, so nothing reaches the default branch unverified. But a push to any other branch fires nothing, which is a real narrowing chosen to keep CI off scratch branches. The cost has already been paid once: it cost two attempts of the deliberate-red exercise and produced instance 10.
- **T0.3 "config fails before any other work."** **NOW PROVEN FOR BOTH PROCESSES.** `apps/web` in T0.7 (`instrumentation.ts` validates at server start and calls `process.exit(1)`; 4 integration tests boot a real built server with a broken environment and assert a non-zero exit). `apps/worker` in T0.8, proven by ORDER in the real process's log rather than by reading the source: `configuration validated` must be log line 0 and must precede `database schema verified`. A broken environment produces **no JSON log line at all**, because the logger's level and secret list come from the configuration that just failed — asserted, and confirmed capable of failing by planting an early line and watching three tests break.
- **OPS-3 "SIGTERM stops accepting work, finishes in flight, closes connections, exits 0" — PARTIAL, and one sub-clause closed 2026-08-27.** Of four:
  - *finishes in flight* — **proven** (synthetic in-flight task, T0.8)
  - *exits 0* — **PROVEN 2026-08-27 by CI #1 on Linux.** The end-to-end SIGTERM test ran and passed, confirmed from the assertion step's output rather than from a green suite. Obligation 18 discharged
  - *closes connections* — **still unverified against a real pool** (obligation 21)
  - *stops accepting work* — **still a seam with no consumer** (obligation 22, T1.7)

  **Do not tick OPS-3.** Two of four sub-clauses remain.
- **T0.8 "crash-loops are visible in logs, not silent" — PARTIAL.** Proven for the handler in isolation: the rethrow, the fatal level, and the `category`/`policy` fields are all unit-tested, and removing the rethrow fails 5 tests. **Not proven for the process** — no test starts a real worker, crashes it, and reads its stdout. Obligation 20.
- **T0.3 "no secret ever appears in a log line."** T0.5 added the logger and
  three redaction layers, so this is now largely covered — but only for output
  going through that logger. Anything using `console.log` directly bypasses it.
- **T0.4 "migrations never edited after being applied."** This is a *rule*, not
  a guarantee. Verified experimentally: Drizzle does **not** detect tampering.
  An altered applied migration was re-run; it reported success, applied
  nothing, and left the recorded hash unchanged. See obligations.
- **T0.6 "`pnpm test` runs unit tests FAST."** Database-free is fully met and
  verified with PostgreSQL stopped. *Fast* is borderline and measured, not
  assumed: **18.2s wall clock, measured at `66be0e4` (T0.6, 2026-08-26) across
  4 packages and 132 tests.** The suite is now 7 packages and 235 tests, so this
  figure is a FLOOR, not a current reading — re-measure before acting on it. Only **5.45s** of that is actual test
  execution, and no single test exceeds 258ms. The remaining ~11s is
  per-package process startup, transform and import — `pnpm -r` spawns a
  separate Vitest process for each of the four packages and pays that cost four
  times. A further 4.9s is the boundary test resolving the ESLint config chain,
  which is inherent to what it checks. **Proposed fix:** a single Vitest
  workspace run instead of `pnpm -r`, sharing one process. Not done in T0.6
  because it changes how every package's tests are invoked and deserves its own
  change. **This is a Phase 2 PREREQUISITE, not an open nice-to-have** — see
  obligation 11.
- **T0.6 "fixture loading helper in place for the golden datasets."** The
  helper exists, is tested, and loads text, CSV and JSON. But it is
  **generic, not candle-aware** — typed candle loading needs the `Candle`
  schema from `packages/contracts`, a stub until T1.2. More importantly,
  **it has never been run against a real TradingView export**, because none
  exists yet. Its inability to parse quoted fields containing commas
  (obligation 10) is therefore an untested assumption about the file format.
  Treat the helper as ready in principle and unproven in practice. **No golden export exists and there is currently no route to one** — see obligation 12.
- **T0.7 "no strategy logic in the web app."** True today — `apps/web` computes nothing; it imports `@karatx/db` to read status and `@karatx/config` to validate. But it is **satisfied by inspection, not enforced**. Nothing stops a future change importing an indicator from `packages/core` and calculating in the dashboard, which is exactly how two implementations of the same rule start drifting (F.1). This is the same shape as the `packages/core` boundary before T0.6 gave it a regression test. See obligation 16.

---

## Lessons — MOVED to docs/LESSONS.md

**Split out on 2026-09-02 (obligation 25).** 1309 lines of
lessons now live in **[LESSONS.md](./LESSONS.md)**, read independently of this
handoff. Nothing was reworded in the move.

---

## T0.9 — CI evidence, recorded 2026-08-27

Run history: https://github.com/georginamurray2026-eng/KaratX/actions

### CI #1 — green on the FIRST Linux run

All five jobs passed. Job totals include checkout, pnpm setup and install:

| Job | Job total |
|---|---|
| format, lint, typecheck | 30 s |
| unit tests (no database) | 21 s |
| integration tests (PostgreSQL) | 56 s |
| Playwright smoke | 48 s |
| secrets, dependencies, immutability | 21 s |

**The instrumented unit figure is 4,292 ms**, not the 21 s job total — the
difference is setup, and quoting the job total would have overstated the suite
by 5x. See obligation 11, now reframed on the strength of it.

### SEC-10 — OBSERVED WORKING 2026-08-28, and the esbuild advisory it surfaced

**SEC-10 was in the same position CI was before the deliberate-red exercise:
configured, plausible, unobserved. It has now been watched, and the division of
labour held.**

| Layer | Role | What it did |
|---|---|---|
| Dependabot alerts | the **broad net** — surfaces everything for a human | **found it** |
| `pnpm audit --audit-level=high` | the **blocking gate** — stops the build only for what is worth stopping it for | reported it, correctly did **not** block |

That is the intended behaviour, not a hole. A gate that fails on every moderate
advisory in a transitive dev dependency gets muted within a month.

#### The advisory: GHSA-67mh-4wv8-2f99, and why we are NOT exposed

**Do not redo this work when the alert resurfaces.** Moderate, CVSS 5.3.
Affected ≤ 0.24.2, patched 0.25.0. Three copies of esbuild are installed and
**only one is affected**:

```
esbuild@0.18.20   AFFECTED   @esbuild-kit/core-utils -> @esbuild-kit/esm-loader
                             -> drizzle-kit -> @karatx/db (devDependencies)
esbuild@0.25.12   patched    drizzle-kit direct dependency
esbuild@0.28.2    patched    tsx, and vite/vitest
```

**THE VULNERABLE FEATURE IS NOT PRESENT IN THE INSTALLED CODE.** This is not
"probably unaffected" — it is verified absence:

- The advisory is specific to the **`serve`** feature: *"Users using the serve
  feature may get the source code stolen by malicious websites."*
- `@esbuild-kit/core-utils@3.3.2` ships **two files**, `index.js` and `index.d.ts`.
- The only esbuild API it references is **`transform(`** — one occurrence.
- **The string `serve` appears nowhere in the package at all**, in code or types.

Reachability is narrower still: that chain loads only under `drizzle-kit`, which
this repository invokes in exactly one place — `db:generate`, run deliberately
by a developer. **Not in CI** (which runs `db:migrate` via `tsx`) and not in
either deployable process.

#### Why CI stayed green — the threshold, not a detection gap

Two possibilities had to be separated, and only one would have been a problem.
Settled by testing all three thresholds:

```
pnpm audit (default)               exit=1
pnpm audit --audit-level=moderate  exit=1
pnpm audit --audit-level=high      exit=0   <- what CI runs
```

And audit reports it in full: *`[moderate] esbuild vulnerable: <=0.24.2 patched:
>=0.25.0`*, with the complete dependency path. **The gate deliberately did not
block. Audit did not miss it.** That difference is invisible without the test.

#### Decision: NO OVERRIDE. Watch upstream instead.

`drizzle-kit@0.31.10` is the latest release; there is no fixed version to move
to. A pnpm override forcing `esbuild@>=0.25` is possible but `@esbuild-kit/core-utils`
declares `^0.18` — three years of API drift — and it would fix an unexploitable
path. **An unverified override is worse than a known-unexploitable transitive.**

**UPSTREAM CONDITION TO WATCH:** drizzle-kit dropping `@esbuild-kit/esm-loader`
in favour of the `tsx` it **already depends on**. Its `dependencies` currently
list both, and the `@esbuild-kit/*` packages are deprecated — their functionality
was folded into `tsx`. When that lands, this resolves with a routine bump.

#### The real finding was the reporting gap

CI showed **nothing**. Without a human opening the Security tab this would have
sat unseen indefinitely. Fixed by printing the full audit report before applying
the threshold — see the lesson on gates reporting what they saw. **The threshold
is unchanged; visibility was the defect, not sensitivity.**

**Do not "fix" this by lowering the threshold to moderate.** That reverses the
design and mutes the gate.

#### Better than expected: the threshold run reports too

CI #14 showed both blocks. The second — `pnpm audit --audit-level=high` — **also
reports the moderate finding and still exits 0**:

```
--- applying the blocking threshold: high and critical only ---
1 vulnerabilities found
Severity: 1 moderate
```

**So the gate sees it, says so, and declines to block — and that design is now
legible in the OUTPUT rather than only in a comment.** Anyone reading the log can
see the threshold making a decision, instead of having to infer from a green tick
that nothing was found.

That is a better outcome than the fix was aiming for. The fix was meant to add
detail; it also made the policy visible.


---

### GitHub repository settings — VERIFIED 2026-08-28, stop asking

Confirmed by the user in the repository settings UI, not inferred:

| Setting | State |
|---|---|
| Dependabot alerts | **enabled** (shows *Disable*, so already on) |
| Dependabot security updates | **enabled** (shows *Disable*) |
| Actions → Workflow permissions | **read-only**, already set |

Recorded explicitly because it has been asked three times. Dependabot alerts are
free on private repositories and are the second half of SEC-10; the read-only
workflow permission is least privilege — nothing in this pipeline writes to the
repository.


### CI #2 — the `pull_request` trigger works, demonstrated incidentally

A Dependabot PR ran the full pipeline and passed. That satisfies the
"on push and PR" half of T0.9's first criterion — **met incidentally rather
than deliberately**, which is worth recording as such: nobody designed that
test, it happened.

### "No secrets in Git history" — GATE ITEM NOW VERIFIED

Previously believed on the strength of `git ls-files`, which answers a
different question: what is TRACKED, not what was ever COMMITTED. Conflating
them is the same error as reading "no restriction found" as "available".

**gitleaks over full history, 2026-08-27: 41 commits scanned, no leaks found,
exit 0.** And the scanner was proven capable of firing first — see the
planted-value lesson, where the initial control failed because the planted key
was one gitleaks allowlists by design.

### The deliberate-red exercise — ALL FOUR BREAKS PROVED, across two runs

**"CI goes red when you break something" is worth nothing without a run where it
did.** T0.9's final acceptance criterion, met with linkable evidence.

#### Attempt 0 — nothing ran at all

Four commits pushed to a branch, with the instruction "do not open a pull
request". The `push` trigger is filtered to `main`, so **nothing fired.** A
detailed prediction of four red jobs had already been written for a process
nobody had checked could start. Recorded as instance 10.

**THE TRIGGER FINDING, which is a permanent property of this pipeline: a branch
push alone fires NOTHING. Opening a pull request is what runs CI** — and after
that, pushes to the branch fire `synchronize` on the open PR. Confirmed from the
remote: `refs/pull/6/merge` existed, which GitHub maintains only for open
PRs.

#### Attempt 1 — PR #6, CI #7. Two of four breaks proved.

| # | Break | Check under test | Result |
|---|---|---|---|
| 1 | `Date.now()` in `packages/core` | F.3 invariant-1 lint rules | **MASKED** — `format:check` tripped on break 3's file first |
| 2 | Tampered an applied migration | obligation 2 immutability | **MASKED** — gitleaks failed first |
| 3 | Planted a GitHub PAT-shaped token | gitleaks | **PROVED** — RuleID `github-pat`, value REDACTED |
| 4 | Forced the SIGTERM test to skip | obligation 18 detector | **PROVED — the headline** |

**Break 4 is the result that matters.** `pnpm test:integration` reported GREEN,
and the job went red at the *next* step: `FAILED: "shuts down cleanly and exits 0" was SKIPPED`.
A skipped test hiding inside a passing suite, caught by the check built for
exactly that.

#### Attempt 2 — PR #8, run 33103674481. The remaining two proved.

Narrow: breaks 1 and 2 only, **and no planted secret** — its check was already
proved, it was what masked break 1, and it carried the blast radius below.

**THE STEP-LEVEL EVIDENCE IS THE POINT, not the job colours.** A job that aborted
at its first failure would show later steps as skipped with no duration. Both
red jobs recorded **seven step durations** and collected everything:

```
static    2s 1s 1s 3s 3s 2s 1s     "2 errors and 1 warning" across the run
          errors.ts 248:10  packages/core reads no clock (F.3 invariant 1).
                            Pass the timestamp in as a parameter
                            no-restricted-syntax

security  1s 1s 2s 6s 4s 4s 0s     migration failing AFTER gitleaks ran,
                                    audit running AFTER the failure
          Comparing migrations against 3cd3f930085f
          FAILED: migrations already on main were changed.
            MODIFIED: packages/db/migrations/0000_init_system_events_and_config.sql
```

**So `a9395d3` and `3cd3f93` are both proven** — independent steps now report
independently, in both jobs. A green run could never have shown this.

**The F.3 boundary rules are confirmed running in CI, not only locally.** That is
the single most valuable check in this repository and it had never been
demonstrated remotely.

**Obligation 2 ran against a REAL `origin/main` for the first time** — the script
had only ever been tested against explicit local refs.

#### PROOF CONDITIONS DIFFER, and this must not be smoothed over

**Breaks 3 and 4 were proved under the ORIGINAL pipeline. Breaks 1 and 2 under
the AMENDED one.** Those are not identical conditions and the four results should
not be quoted as though they were. Nothing suggests the amendment would have
changed 3 or 4 — but that is reasoning, not evidence.

#### The blast radius — predicted wrongly, then tested

Pushing a branch containing a planted secret **turned `main` red**, and every
Dependabot PR with it. Cause: `gitleaks git /repo` scans **every ref in the
clone**, not the checked-out branch, and `actions/checkout` with
`fetch-depth: 0` fetches all branches. The commit was never reachable from
`main` and the file never existed in its tree.

**That is the security control working correctly** — a leaked credential is
leaked, and confining the alarm to one branch would be the weaker design. The
error was planting a secret into a repo-wide scan without accounting for the
blast radius.

**BOTH OF US THEN CONCLUDED "main will stay red forever", REASONING FROM THE
WORDING OF A LESSON RATHER THAN FROM WHAT CHECKOUT ACTUALLY FETCHES.** The claim
conflated two different things:

| Claim | True? |
|---|---|
| The secret stays retrievable via the closed PR's web UI, permanently | **Yes.** Nothing fixes this |
| The secret keeps breaking CI after branch deletion | **No** |

**Settled empirically, not by argument.** A fresh `git clone` fetched
`refs/heads/*` and **zero** `refs/pull/*` refs; the planted commit was
present only because the branch still existed. Deleting the branch made it
invisible to CI, and **CI #10 on `main` went green at `3cd3f93`, all five jobs**.

No `.gitleaks.toml` allowlist was added. Narrowing a security control to
accommodate a temporary condition would have outlived the condition by years,
and created the first entry in a file whose whole purpose is listing secrets to
ignore.

---

### Pino output SURVIVES a crash — a real result, not an absence of trouble

**Measured 2026-08-28 while discharging obligation 20.** A process on its way out
is exactly where buffered logs get dropped. Had the fatal line been lost, **T0.5's
entire error taxonomy would be useless at the moment it matters most** — a
crash-looping worker would leave no evidence at all, which is the failure
obligation 20 exists to prevent.

It was not lost. In every run, both `uncaught` and `unhandled`, the level-60 JSON
line carrying `category` and `policy` reached stdout before the process died.

**SCOPE LIMIT, stated because a figure without its platform is a trap: measured
on Node 24 under `tsx`, writing to stdout with no pino transport.** NOT
established for a different runtime, a different entry point, or a pino transport
(which moves writing to a worker thread and changes the flush behaviour entirely).

**FLAGGED FOR T0.10, same family as obligation 17.** Railway may run the worker
differently, and if the crash line is lost there, we lose the only evidence a
crash-looping worker would leave. Re-measure against however it actually runs.


### Dependabot: works, and the grouping was half-done

Five PRs opened within minutes of the first push, hitting the limit of 5
exactly — so it capped rather than settled. Cause: `github-actions` was left
UNGROUPED while npm was grouped, so every action bump opens its own PR.

Fixed by grouping `github-actions` fully. npm **majors stay individual** on
purpose: a major bump warrants its own review and its own CI run, which is
signal rather than noise.

---

## Carried-forward obligations — MOVED to docs/OBLIGATIONS.md

**Split out on 2026-09-02 (obligation 25).** The obligations ledger — every open
and discharged obligation, with where each one lands — now lives in
**[OBLIGATIONS.md](./OBLIGATIONS.md)**. Nothing was reworded in the move.

**No summary of the ledger is kept in this file.** One stood near the top until
2026-09-02 and was deleted the same day, because it had already diverged from
the ledger it summarised — see the note there. The only obligations table that
is safe to read is the one in OBLIGATIONS.md; a second copy inside the Phase 0
gate section below is a dated snapshot and is labelled as wrong.

---

## §23 findings (recorded here rather than in git history)

`docs/ENGINEERING_PROMPT.md` was committed on 2026-08-26. §23 ERROR HANDLING
was previously unavailable and T0.5 proceeded without it. Now that it is
readable:

- The **eight error categories and five handling policies** in
  `packages/core/src/errors.ts` are **verbatim** from §23.
- §23 **does not prescribe which policy belongs to which category.** It says
  "Determine whether each should: retry; degrade; alert; stop processing;
  quarantine the item." The mapping is therefore **derived**, which is exactly
  what §23 asked for.
- **The provenance note in `errors.ts` stays as written.** It correctly
  describes the names as verbatim and the mapping as derived and cited per
  class. Do not "correct" it to claim it transcribes §23.
- §23 says "Never use empty catch blocks" and "Do not hide exceptions" —
  stronger than the paraphrase T0.5 worked from. The stricter lint selector
  added in T0.5 (rejecting a catch whose body is empty even when it holds a
  comment) matches the source's intent rather than exceeding it.
- §23's "Avoid infinite retry loops" is obligation 5 above.

### The taxonomy in real use — first consumer, T0.8

T0.5 defined the eight categories and five policies. T0.8 is the first code
to consume them for a decision rather than to test them. It works, with one
genuine finding.

**What worked.** `policyOf` walking the cause chain is the right shape: the
worker's top-level handler reports HOW a failure should be handled without
knowing which package raised it. `toKaratxError` meant the crash handlers could
take `unknown` — which is what a catch block and an `uncaughtException` listener
both actually receive — and still emit a classified line. The Pino `err`
serialiser attaching `category` and `policy` to every error line means the
classification reaches the log with no call site doing anything.

**The finding: policy is a property of the SITUATION, not only of the class.**
Every boot failure in T0.8 had to override the class default:

| Error | Class default | What boot needs | Why |
|---|---|---|---|
| `DatabaseError` — unreachable at boot | `alert` (a human should look; keep running) | `stop` | At boot there is no "keep running" to fall back to. A worker with no database consumes the feed and discards it |
| `DatabaseError` — schema mismatch | `alert` | `stop` | ADR-003: the worker must refuse rather than proceed against a schema it does not expect |

The same `DatabaseError` mid-run, once T1.7 has a feed, genuinely is `alert` or
`retry` — a dropped connection should reconnect, not kill the process. So the
class default is not wrong; it is simply incomplete on its own.

**Is that awkward enough to call the taxonomy unusable? No — and the reason
matters.** The override is a documented constructor option, it is explicit at
each call site, and the resulting log line carries the policy that actually
applied rather than the class default. Nothing is silently wrong. Two of two
boot errors overriding is a small sample; the honest reading is "the default
is tuned for steady state, and boot is not steady state".

**What would make it a real problem, and what to watch for.** If Phase 1
finds most call sites overriding, the category-to-policy mapping is carrying
no information and should be replaced by an explicit policy at every raise
site. **Watch this at T1.4 and T1.7**, which are the first sustained
consumers. Reviewing at T1.7: if the override rate across all raise sites is
above roughly a third, the defaults are decoration.

**One thing NOT done, deliberately.** No `boot` variant of each error class was
added. That would encode the situation in the type and remove the overrides,
but it doubles the taxonomy to carry a distinction that exists at exactly one
point in the process lifetime — and a taxonomy nobody can hold in their head
is one people stop classifying against.

---

## T1.1 re-run and CLOSED — OANDA v20 is UNAVAILABLE (see ADR-008)

**Established 2026-08-27 by the user, following OANDA's own Developer Getting
Started wizard to its end.** A Thailand-resident account is routed to OANDA
Global Markets, which is MT4/MT5 only and has no Portal access. The v20 API
belongs to the fxTrade platform offered by OANDA's other regulated entities.
The wizard offered no separate v20 practice signup. No workaround was
attempted, and none should be: an account obtained by misrepresenting
residence can be closed without notice, which is worse than not having one.

### The generalisation — it failed as a BROKER, not as a data source

**A broker opens a REGULATED ACCOUNT, and regulated accounts are routed by
residence to a legal entity. The API follows the entity, not the brand.** No
amount of evaluating the v20 API could have caught this, because the API was
never the problem. ADR-005's reasoning was sound on what was known; what was
missing was a gate, not better analysis.

**Pure data vendors do not have this failure mode.** They sell a data
subscription, not a regulated account — there is no entity routing and no
residence-dependent platform assignment. That is a structural difference, and
it is the strongest argument for moving off broker feeds entirely.

### Two permanent additions to the evaluation matrix

1. **REGIONAL AVAILABILITY TO A THAILAND-BASED USER IS CHECKED FIRST**, before
   anything else about a candidate is evaluated. It is cheap to check and
   expensive to miss, and it is what eliminated the front-runner after
   everything else had already looked good. **A candidate that cannot be
   confirmed available is marked UNVERIFIED, never assumed available** —
   "no restriction found" and "available" are different claims, and conflating
   them is how this was missed.
2. **CAN THIS PROVIDER'S RESPONSES BE RECORDED AS FIXTURES AND REPLAYED?**
   Replaying real responses against real infrastructure has found four genuine
   defects so far. A protocol that breaks it — protobuf over persistent TCP, a
   Java-only SDK, a proprietary terminal dependency — is expensive in a way
   nothing else in the matrix captures. Score it explicitly.

### Reframe: brand-matching the chart is worth little

The requirement was never OANDA. It was a feed close enough to the traded
chart to be trustworthy. A spot check of OANDA against IC Markets found them
near-identical, so matching the TradingView chart's provider is worth much
less than assumed. **Optimise for API and data quality, not for brand match.**
T1.9's reconciliation job exists to MEASURE divergence rather than assume it.

### cTrader Open API — repurposed, not rejected

**IC Markets via cTrader Open API is NOT the feed, but IS the intended
reconciliation source for T1.9.** From cTrader's own documentation: transport
is TCP with mandatory TLS on port 5035 or WebSocket; encoding is JSON or
Google Protocol Buffers; there is **no HTTP/REST endpoint for historical data
at all**; historical requests are capped at 5 per second per connection.

Against the new criterion 2 that is close to worst-case — a stateful
authenticated session over a persistent socket, where "a response" is a
message in a stream rather than a document that can be saved under
`test/fixtures/` and replayed. Against criterion 3 it is the opposite of
HTTP/JSON.

**Off the hot path those costs stop mattering.** A reconciliation job runs
occasionally, tolerates a slow awkward protocol, and benefits from being an
INDEPENDENT comparator against the actual execution venue — which is strictly
more useful for reconciliation than a second data vendor would be.

### Twelve Data — measured 2026-08-27 (35 credits), NOT yet a recommendation

| Fact | Value | How established |
|---|---|---|
| Thailand access | **works** | authenticated call succeeded from the user's machine |
| XAU/USD 15min earliest | **2020-01-24 13:00** | `earliest_timestamp`, then verified by requesting that day and getting real bars |
| 1min earliest | 2020-04-06 | `earliest_timestamp` |
| 1day earliest | 1979-12-26 | the "since 1980" claim applies to DAILY only |
| Bar density | 35,071 bars/year at 15min | counted from a full 5,000-bar page |
| Full 6.6yr backfill | 47 requests, ~6 min | 5,000 bars/request, 8 credits/min |
| Instrument | Gold Spot, `type: "Precious Metal"` | spot, not CFD or futures — C1 satisfied on evidence |
| Default timezone | **Australia/Sydney (UTC+10)** | documented on the exchange page; ABSENT from the `time_series` body |
| Numeric format | **float32**, ~9 significant figures | `4643.35156` is exactly float32 `4643.3515625` |
| Weekend bars | 0 in 2020–2024, 49 on 2025-06-14, 96 from 2026 | one call per year |
| Gold-specific? | **No** — EUR/USD and GBP/USD identical | the control test that refuted the source-swap hypothesis |

**Two conclusions were revised by later evidence, and the revisions matter more
than the originals.** "Variable decimals mean trailing-zero stripping" was wrong —
it is float32 shortest-round-trip printing, and the decimal count changed only
because gold crossed a magnitude boundary. "The weekday series may have changed
venue" was wrong and never had evidence; one EUR/USD call killed it. New evidence
should invalidate prior findings, not sit alongside them.

**Adapter requirements this produced** (for T1.4, and for the ADR):

- Send the key as `Authorization: apikey <key>`, **never** as a query parameter —
  a key in a URL reaches proxy logs, referrer headers and echoed errors.
- Pass `timezone=UTC` explicitly on every request. A response carries no timezone,
  and the default is UTC+10 — an adapter storing `datetime` as UTC would be wrong
  by ten hours on every candle, silently.
- Preserve the decimal text as received (NFR-12). `Number()` round-tripping
  destroys byte-for-byte reproduction.

---
### 24/7 gold is an INDUSTRY REPRESENTATION, not a Twelve Data defect

**This reframe matters more than either provider measurement, and it arrived by
accident.** Twelve Data emits weekend bars for spot gold from 2025. So does
EODHD. Two unrelated vendors, measured independently, both represent XAU/USD as
a continuously-quoted instrument in 2026.

The first reading — "Twelve Data has a data-quality problem" — was wrong. The
correct reading is that **this is how the market-data industry now represents
spot gold**, and any provider we choose will need the same treatment.

**The calendar-as-authority decision was right for a better reason than we chose
it.** It was adopted as a way to handle one vendor's quirk without a fragile
filter. It is actually the correct posture toward the entire category: no
provider will hand us a series aligned to a 17:00 America/New_York trading week,
so the calendar has to be ours regardless of who supplies the bars.

It also removes what looked like EODHD's decisive advantage — see below.

### EODHD — measured 2026-08-27, BLOCKED by its own free tier

| Fact | Value | How established |
|---|---|---|
| Free tier scope | **EOD only** | HTTP 403 on every intraday request: *"Only EOD data allowed for free users"* |
| Free daily depth | **1 year** (2025-08-26 → 2026-08-25) | the response body carries `"warning": "Data is limited by one year as you have free subscription"` |
| Intraday depth | **UNMEASURABLE** | requires the $29.99/mo plan |
| Saturday sweep | **DID NOT RUN** | see instance 7 in the lessons — seven 403s reported as passes |
| Daily weekend bars | **present**: 47 Sat, 52 Sun of 360 | day-of-week over the full free window |
| Saturday character | opens exactly at Friday's close; ranges $0.14–$0.70 | vs weekday average range $102.18 |
| `volume` field | **unreliable** | 2026-08-04 Tue reports `48` against ~1,000,000 on every other weekday |
| Auth | **query parameter only** (`api_token=`) | no documented header form |
| Metadata | `Name: "Gold Spot US Dollar"`, `Type: "Currency"` | **no timezone field at all**, unlike Twelve Data |

**Inference, labelled:** EODHD's weekend contamination looks different in KIND
from Twelve Data's. Twelve Data manufactures a full 96-bar Saturday averaging
$1.55 per 15M bar; EODHD's Saturdays are near-flat, consistent with a few stray
ticks landing in a UTC-day bucket. Its Sunday ranges ($16–39) fit the genuine
22:00 UTC Sunday open falling inside a UTC calendar day. **Unconfirmable without
intraday access.**

**A process disadvantage, separate from the data.** EODHD's free tier cannot
verify EODHD's own distinguishing claim. Its case rests on deep, clean history
and that is precisely the part payment gates. For a project whose method is
measure-before-committing, **a provider that requires payment before evaluation
is disadvantaged on process grounds** — independently of how good its data turns
out to be.

### Massive — measured 2026-08-27, and the cross-provider validation

| Fact | Value | How established |
|---|---|---|
| Gold exists | **YES** — `C:XAUUSD`, *"Gold (one troy ounce) - United States dollar"* | ticker metadata; resolves the earlier UNVERIFIED |
| Host | `api.massive.com` (and `api.polygon.io` still responds) | both returned HTTP 200 |
| Free 15min intraday | **YES** — though the pricing page says "End of day only" | measured; an entitlement more generous than documented, therefore a RISK |
| Free depth | **~2 years, rolling** | 2024-08-26 OK; 2023-08-28 → HTTP 403 NOT_AUTHORIZED |
| Trading calendar | **RESPECTED** | 0 Saturday bars on 2024-09-14, 2025-06-14, 2026-08-15, 2026-08-22 — all with successful requests AND a weekday positive control |
| 17:00 NY boundary | **VISIBLE** | Fri last bar opens 20:45 UTC (closes 21:00 = 17:00 EDT); Sun opens 21:00 UTC = 17:00 EDT; weekdays 93 of 96 bars, the missing 45 min at the rollover |
| Timestamps | **Unix epoch ms** | no timezone ambiguity possible |
| Numbers | JSON numbers, real 2-decimal prices (`4538.93`) | occasional float64 artefacts (`4536.9400000000005`) |
| Extras | `vw` (VWAP), `n` (trade count) | richer than Twelve Data |
| Density | 24,342 bars/year | 69% of Twelve Data's 35,071 — matching the ~31% of TD bars outside market hours |
| 2yr backfill | ~15 requests, ~3 min | ~50 calendar days per request at `limit=50000` |

**C2 confirmed a THIRD time.** TradingView, Twelve Data's pre-2025 history, and
now Massive's current data all place the daily boundary at 17:00
America/New_York. Massive reopens the week at 17:00 NY; Twelve Data's 2024 data
reopened at 18:00 NY — they agree on the daily boundary, differ by an hour on
the weekly restart.

### Cross-provider validation across the 2025 boundary — the retracted concern is now REFUTED

The earlier "weekday series may have changed venue" claim was retracted for lack
of evidence. With two independent series it became testable. Weekday 15M bars
matched by exact UTC timestamp:

| Era | Day | Matched bars | Mean bar range | Mean |Δclose| | Divergence as % of range |
|---|---|---|---|---|---|
| BEFORE | 2024-09-11 | 92 | 10.0bp | 0.97bp | 9.7% |
| BEFORE | 2024-10-16 | 92 | 9.4bp | 0.78bp | 8.3% |
| AFTER | 2026-06-17 | 93 | 24.6bp | 2.77bp | 11.2% |
| AFTER | 2026-08-19 | 93 | 20.9bp | 2.33bp | 11.1% |

Raw divergence grew **2.91x**. But volatility grew **2.34x** over the same
period, and two feeds sampling different tick streams diverge more when the bar
moves more. **Normalised, divergence changed 1.25x — 9.0% of bar range before,
11.2% after.**

**Conclusion: Twelve Data's WEEKDAY series is sound throughout, and its 6.6
years of depth is real.** The 2025 change added weekend synthesis; it did not
change the weekday instrument.

**Method note.** The raw 2.91x sat just under an arbitrary 3x threshold — close
enough that leaning on the threshold would have been luck rather than evidence.
Normalising by the obvious confound turned a borderline number into a clear one.
**When a ratio lands near a threshold, find the confound rather than invoking
the threshold.**

---
### ADR-008 inputs collected so far

Assemble the ADR from these rather than from memory.

**Confirmed about Twelve Data:** Thailand access works (authenticated call);
XAU/USD is spot gold, not a CFD or futures proxy (`currency_base: "Gold Spot"`,
`type: "Precious Metal"`) — C1 satisfied on evidence; 15min depth 2020-01-24,
verified by fetching bars at that date; native 15min; 6.6-year backfill in 47
requests; free tier permitted full evaluation before payment.

**Adapter decisions:** send the key as `Authorization: apikey <key>`, never a
query parameter — a key in a URL reaches proxy logs, referrer headers and echoed
errors. Pass `timezone=UTC` explicitly on every request; the response carries no
timezone and the default is UTC+10, so a naive adapter is wrong by ten hours on
every candle, silently. Preserve decimal text as received (NFR-12); values are
float32 printed at ~9 significant figures.

**Process decisions:** fetch instrument metadata BEFORE any prices — what the
vendor thinks the symbol IS determines how to read everything it returns.
Absence checks need two assertions (see the lessons).

**Against EODHD:** query-parameter-only auth; unreliable `volume` field; no
timezone in metadata; free tier cannot verify its own distinguishing claim.

**cTrader:** not the feed — protobuf or JSON over TLS TCP, no REST for history,
5 historical requests/second. Repurposed as T1.9's reconciliation source, where
an independent comparator against the actual execution venue beats a second
data vendor.

**Retracted, and recorded as retracted:** that the weekday series changed venue
(refuted by one EUR/USD call); that variable decimals were trailing-zero
stripping (they are float32 printing).

**Still missing:** Massive — does gold exist, and if so its Eastern Time bar
alignment, which is the closest any candidate comes to the 17:00 NY convention
and is now a scored criterion rather than a footnote.

---
### DEFERRED, not closed: paying $29.99 to measure EODHD

**Decision 2026-08-27: do not pay yet.** Recorded with its trigger so this is a
deferred decision rather than a dismissed one.

**Why the question stopped mattering.** The reason to want EODHD was clean deep
history that would avoid a filter dependency. That reason evaporated:

- We are building the calendar assertion **regardless**, because two unrelated
  vendors both emit weekend gold bars.
- EODHD's own clean pre-2020 history sits **behind the same break** in its own
  recent data, so it buys no consistency.
- What $29.99 actually buys is depth beyond 2020 **at 1-minute only** — roughly
  1.9M rows for five years — for a system that aggregates to 15M immediately.
- Twelve Data supplies **6.6 years of native 15M in 47 requests and ~6 minutes.**

**TRIGGER TO REVISIT: Phase 9 demonstrating that 6.6 years of 15M is too short a
backtest window.** If the backtest needs more regime coverage than 2020–2026
provides, pay the $29.99, run the measurement that was blocked today — the
17-year Saturday sweep, real intraday depth, and the 1-minute backfill cost
weighed against that depth — and reopen the comparison.

Nothing else should reopen it. Not price, not the marketing depth figure.

---

### The trading calendar is the AUTHORITY — decided 2026-08-27, built in T1.5

**Do not write a filter that discards what looks wrong. Assert what SHOULD be
present, and record every mismatch as a data-quality event.**

The distinction is the whole point, and it is a failure-mode inversion:

| | A filter | A calendar assertion |
|---|---|---|
| Says | "drop bars that look like weekend" | "our calendar says gold trades these hours on this date, so expect exactly this many bars" |
| When it breaks | silently stops matching; bad bars flow into indicators | the expectation stops being met, and an event is emitted |
| Evidence produced | none | a recorded, queryable data-quality event |
| 92-bars-in-2024 vs 96-in-2026 | a subtlety the filter must be careful about | **a detectable fact the system reports** |

A filter that silently stops working corrupts indicators quietly, which is the
defect class this project keeps finding. A calendar that stops matching produces
something you can see.

**Anything outside the calendar is REJECTED AND RECORDED, never silently
dropped.** F.2 already requires malformed input to be quarantined rather than
repaired; this is the same rule applied to bars that are well-formed but should
not exist. It also turns the Twelve Data weekend behaviour from a liability into
a signal: the series changes character in 2025, and a calendar-driven system
reports exactly when and by how much.

**Not built now.** Recorded as the approach for T1.5. The calendar itself needs
the 17:00 America/New_York boundary (INDICATOR-SPEC.md C2, now confirmed by two
independent sources) plus holiday handling, which is its own work.

**Consequence for T1.6.** The regression guard in INDICATOR-SPEC.md says to
assert our 1D aggregate matches the provider's own daily candle. That cannot
stand against a 24/7 series, which emits Saturday and Sunday "days". The guard
compares against the calendar, not against the provider.

### Check symbol metadata FIRST, for every provider

`symbol_search` returns fields that `time_series` omits entirely:

```
exchange:           "COMMODITY"
exchange_timezone:  "Australia/Sydney"
instrument_type:    "Precious Metal"
```

Both T1.1 anomalies were explained by that one call, and by the exchange page it
points to, which states verbatim: *"Trading hours (24/7): Main market 00:00 -
23:59"* and *"All times are displayed in the Australia/Sydney timezone (AEST,
UTC+10:00)"*.

**The UTC+10 default was not undocumented — we had not looked it up.** Neither
was the 24/7 behaviour. Two hours of investigation, including a hypothesis that
turned out to be wrong, would have started from a much better place with one
metadata call.

**Standard first step for any provider evaluation: fetch the instrument
definition before fetching any prices.** What the vendor thinks the symbol IS
determines how to read everything it returns.

---

### Outcome — ADR-008, decided on measurement

**Twelve Data is the feed. Massive is the reconciliation source and the
calendar oracle. EODHD is deferred with a trigger. Total cost: £0.**

| Provider | Role | Deciding number |
|---|---|---|
| **Twelve Data** | **reference feed** | 6.6 yrs of native 15M, ~161,000 real bars — **3.3x** the alternative — and the weekday series validated against an independent source |
| **Massive** | reconciliation + **calendar oracle** | respects the trading calendar and places the daily boundary at 17:00 NY; 2 yrs depth is too thin to be the spine |
| EODHD | deferred | free tier is EOD-only, so it cannot verify its own distinguishing claim |
| cTrader / IC Markets | optional execution-venue comparator | no REST for history; near worst-case for fixtures |

**Read ADR-008 for the reversal conditions.** The three that matter: Twelve
Data changing its weekday series (T1.9 reconciliation detects it), Phase 9
proving 6.6 years too short, or Massive withdrawing its undocumented free
intraday — which would cost the oracle and the reconciliation source at once.

**One number in ADR-008 is an ESTIMATE, not a measurement:** the assumed 2–3
setups per week driving the Phase 9 cell-count argument. Nothing has measured
it; the detector does not exist until Phase 4. The direction is safe at any
setup rate, but do not quote "60–80 per cell" as fact.

---

## Open questions

| Question | Blocks | Status |
|---|---|---|
| **OANDA account eligibility.** OANDA's docs say the v20 API is unavailable to the OANDA Global Markets division, and Thailand residents are routed there. Whether a *practice* account escapes this is undocumented | ADR-005 is **Accepted, conditional**. Blocks T1.2 onward | Needs a 10-minute manual check — see `DATA_SOURCES.md` §11 |
| **`XAU_USD` M15 history depth.** Unknown. Constrains the Phase 9 backtest window | T1.4, Phase 9 | Measure by binary search — method in `DATA_SOURCES.md` §12 |
| **Monthly budget ceiling** (decision 3) | Provider and hosting choices | Unanswered |
| **Backtest history window** (decision 4) | Provider tier | Depends on the depth measurement above |

Railway PostgreSQL exists but is **deliberately unused** until T0.10. No
Railway credentials are in this repository — verified across full git history.

---

## What a fresh session must know

1. **Read in this order:** `docs/ENGINEERING_PROMPT.md` (how to work) →
   this file (where we are) → `docs/BUILD-PLAN.md` (what is next) →
   `docs/DECISIONS.md` (what was decided and why). **Two files split out of
   this one on 2026-09-02 (obligation 25):** `docs/OBLIGATIONS.md` is the
   authoritative ledger of what is owed, and `docs/LESSONS.md` holds the
   patterns worth applying. Read OBLIGATIONS.md before planning a task.
2. **Do not start a task without a plan approved by the user.** §29, §30 and
   §42 all require explaining before implementing, in small steps.
3. **The three F.3 invariants are non-negotiable.** Especially: nothing in
   `packages/core` may read a clock, generate randomness, or perform I/O.
4. **`pnpm test` must stay database-free and fast.** Integration tests are a
   separate command. `packages/db` deliberately has no `test` script.
5. **Never print a connection string, token or password**, including in commit
   messages and error output.
6. When something is unproven, say so. Several criteria above are partially
   met and are recorded as such rather than ticked.
7. **T1.1 is closed. The feed is Twelve Data; Massive is the reconciliation
   source and calendar oracle; no paid market data.** Read
   [ADR-008](./DECISIONS.md) before reopening it — it carries reversal
   conditions, and a decision recorded with them should not be re-litigated
   from scratch.
8. **An absence result needs a positive control.** Eight recorded instances of
   a check passing while testing nothing, or testing the wrong thing. If a
   query cannot show PRESENCE where presence is expected, its absence result
   proves nothing. This is the single most reusable thing this repository has
   learned.
9. **Measure; do not read.** Nearly every important figure in T1.1 contradicted
   its own documentation in one direction or the other. Where a number matters,
   it was bought with a real API call — and those measurements are recorded
   here precisely so they need not be bought twice.

## Relevant files

```
docs/ENGINEERING_PROMPT.md   the 47-section source of truth for how to build
docs/BUILD-PLAN.md           phases and tasks with acceptance criteria
docs/DECISIONS.md            ADR-003 migration policy, ADR-005 market data provider
docs/REQUIREMENTS.md         FR/NFR/SEC/OPS/TEST requirement IDs
docs/DATA_SOURCES.md         OANDA evaluation, UNVERIFIED list, manual steps
docs/SPEC-AUDIT.md           C/H/M/L findings the design answers to
docs/ARCHITECTURE.md  topology, invariants, schema sketch
docs/INDICATOR-SPEC.md       confirmed EMA and Stoch RSI formulas
eslint.config.js             the packages/core boundary rules
docker-compose.yml           local Postgres 17, 127.0.0.1 only

apps/worker/src/boot.ts      the boot ORDER: config, logger, database, startup row
apps/worker/src/lifecycle.ts ordered shutdown with a per-hook timeout
apps/worker/src/index.ts     entry point; runs on import and exports nothing
packages/config/src/env-file.ts  the single .env loader, shared by four callers
```
