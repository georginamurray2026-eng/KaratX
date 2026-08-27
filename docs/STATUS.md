# STATUS

Handoff file between Claude Code sessions (§27, §44). The repository is the
project memory — do not rely on conversation history.

**Last verified:** 2026-08-27, by inspecting the repository and running the
commands below. Every figure here came from an actual run, not from a
handover document.

---

## Current position

| | |
|---|---|
| Phase | **Phase 0 — Engineering Foundation** |
| Complete | **T0.1 – T0.8** (8 of 10). T0.8 closed 2026-08-27 with three recorded gaps |
| Next task | **T0.9 — CI** (not started) |
| Branch | `main`, working tree clean. (Commit count deliberately not stated — a self-referential number in a committed file is stale the moment it lands. Use `git log --oneline`.) |
| Remote | none configured. Nothing has been pushed |

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

All run on 2026-08-26 from a clean tree.

```
pnpm install --frozen-lockfile   EXIT=0
pnpm lint                        EXIT=0
pnpm format:check                EXIT=0
pnpm typecheck                   EXIT=0
pnpm test                        EXIT=0    235 tests  (PostgreSQL CONFIRMED STOPPED)
pnpm test:integration            EXIT=0     52 tests + 1 deliberate skip
```

Every exit code above is from a run on 2026-08-27, not recalled. PostgreSQL
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

Integration (52): `packages/test-support` 15, `packages/db` 19, `apps/web` 9, `apps/worker` 9 — against real PostgreSQL, each run in its own ephemeral database. Plus 2 Playwright end-to-end tests against a real built server.

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
| T0.9 CI | Not started | No `.github/` directory exists |
| T0.10 Railway deploy + docs | Not started | — |

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

## THE EXACT NEXT TASK

**T0.9 — CI.** It carries the largest cluster of outstanding obligations, and
it discharges two of T0.8's three gaps by running the suite on Linux.

BUILD-PLAN acceptance criteria: install → format check → lint → typecheck →
unit tests → integration tests (with a Postgres service) → build → Playwright
smoke; secret scanning; dependency vulnerability scanning (SEC-10); and **a
deliberately broken commit turning CI red, verified once on purpose.**

That last one is the positive-control rule applied to the pipeline itself: a
green CI that has never been observed failing has not been shown to work.

Obligations landing in T0.9: **10a** (unit job with NO database service),
**13** (`NEXT_TELEMETRY_DISABLED=1`), **15** (build web before integration
tests), **18** (confirm the SIGTERM test RUNS, not that the suite is green),
and **2** (fail on modification of migrations already on `main`).

**There is a manual step:** creating the GitHub repository and connecting it.
Exact click-by-click instructions when we get there.

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

- **T0.3 "config fails before any other work."** **NOW PROVEN FOR BOTH PROCESSES.** `apps/web` in T0.7 (`instrumentation.ts` validates at server start and calls `process.exit(1)`; 4 integration tests boot a real built server with a broken environment and assert a non-zero exit). `apps/worker` in T0.8, proven by ORDER in the real process's log rather than by reading the source: `configuration validated` must be log line 0 and must precede `database schema verified`. A broken environment produces **no JSON log line at all**, because the logger's level and secret list come from the configuration that just failed — asserted, and confirmed capable of failing by planting an early line and watching three tests break.
- **OPS-3 "SIGTERM stops accepting work, finishes in flight, closes connections, exits 0" — PARTIAL after the T0.8 close-out.** Of four sub-clauses: *finishes in flight* is proven with a synthetic in-flight task; *closes connections* is unverified against a real pool (obligation 21); *stops accepting work* is a seam with no consumer (obligation 22); *exits 0* is unproven on Windows, which cannot deliver a catchable SIGTERM, and the end-to-end test is skipped here (obligation 18). **Do not tick OPS-3 until CI has run it on Linux and the pool assertion exists.**
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

## Lessons — things that should shape later work

Not obligations with an owner. Patterns worth applying deliberately rather than
rediscovering.

### First-boot states are real states, and they are missing from our criteria

T0.7's acceptance criteria described `/api/ready` as reporting "DB connectivity
and applied migration version". They did not mention the **unmigrated**
database — and `checkDatabase` got it wrong as a result, reporting a perfectly
reachable database as `connected: false` whenever migrations had not run.

That is not an edge case. **It is the state every fresh deployment is in**,
between the service starting and its release step completing. On Railway it
would have meant debugging connectivity for an hour when the answer was
`pnpm db:migrate`. The bug was a *wrong diagnosis*, not a crash — far harder to
notice, because everything appeared to work as designed.

It was findable only against a genuinely unmigrated PostgreSQL. A mock would
have agreed with whatever the code did. That is the argument for real-database
integration tests, demonstrated rather than asserted.

**At T0.10 and Railway, check deliberately for other states that exist only at
first boot**, rather than assuming the steady state is the only state:

- empty database — no schema at all
- migrated but no data — every table present, every one empty
- no configuration yet — service started before its variables were set
- first run after a rollback to an older image — the database carries
  migrations the code does not ship (already reported as `unknown` migrations)

The same question applies to T0.8's worker and to T1.7's feed: what does this
component do the very first time it runs, before anything upstream has
produced anything?

### A start signal is not proof of a working boot

With configuration validation throwing in `instrumentation.ts`, Next.js printed:

```
✓ Ready in 398ms
Failed to prepare server: ... instrumentation hook: Invalid environment configuration
```

**"✓ Ready" prints before the failure.** Next caught the error and kept
serving: process alive, port bound, HTTP 500 to every request indefinitely —
including `/api/health`, an endpoint defined as touching nothing, contradicting
its own contract.

Every signal a platform uses to judge a deployment reported success. Railway
would have shown a healthy service; a TCP check passes; a log scraper watching
for the ready line finds it. Fixed by `process.exit(1)` in `register()`.

**When T0.8 builds the worker and T0.10 reaches Railway, do not treat a start
signal as proof of a working boot.** Ask what the process does when its
dependencies are absent, and *verify the answer* rather than assuming it.

**Specifically for T0.8:** the worker is a plain Node process, so a thrown
error at boot probably does kill it — but "probably" is exactly what was just
disproved for Next. Verify it the same way, by starting it with a broken
environment and observing the exit code.

### An absence result needs a POSITIVE CONTROL — this is the strongest form of the rule

**AN ABSENCE RESULT IS MEANINGFUL ONLY ALONGSIDE A POSITIVE CONTROL USING THE
SAME QUERY SHAPE. If the query cannot demonstrate PRESENCE where presence is
expected, its absence result proves nothing.**

Before believing "there are no Saturday bars", run the identical query against a
Wednesday. If Wednesday is also empty, the query is broken, not the market.

**This subsumes everything below it.** It would have caught instance 7 (a 403
returns zero rows on a weekday too) and it is the ONLY thing that caught
instance 8, where the older rules all passed and the conclusion was still wrong.
Reach for this first.

---

The earlier, weaker form is kept because it is cheap and catches the common case:

**AN ABSENCE CHECK MUST FIRST ESTABLISH THAT THE OBSERVATION WAS VALID. Zero
results means nothing until the request is confirmed to have succeeded. Every
check for absence needs two assertions:**

1. **the observation succeeded** — HTTP 200, process exited 0, file was read,
   query returned; and
2. **the thing is absent** — zero rows, no match, no warning.

**Conflating them manufactures clean passes out of failed requests.**

Then, separately: **before trusting the check, make it FAIL deliberately and
confirm you see the failure.** A check that has never been observed failing has
not been shown to work.

**THE SECOND RULE DOES NOT SUBSTITUTE FOR THE FIRST.** That is the whole content
of instance 7 below: the sweep *did* fail, and reported success, so "make it
fail on purpose" had nothing to catch. A deliberately-broken run and a
denied-request run produce the same clean output when the check only looks at
the count.

Eight instances so far, all caught by reading the actual output rather than the
exit code or the absence of an error:

| Where | What looked fine | What was actually happening |
|---|---|---|
| T0.6 `verifyNotInTransaction` | A guard on the operation that drops databases | `pg_stat_activity.state` is `'active'` during any query, so it could never fire |
| T0.7 Turbopack runtime guard | `NEXT_RUNTIME !== 'nodejs'` early return | Turbopack analyses statically; warnings unchanged, 6 → 6 |
| T0.8 secret-leak probe | "No password in the crash output" | The planted value was a *valid* URL, so nothing failed and no error path ran |
| T0.8 escaping bug | Exit code 1, apparently a config failure | Exit 1 came from esbuild — an unterminated string literal, never reaching the code under test |
| T0.8 `.env` precedence loop | A loop preserving explicitly-set variables over the file | Node's `loadEnvFile` **already** gives the environment precedence. Deleting the loop broke no test — because it had never done anything. Found by mutating it away, not by reading it |
| T0.8 mutation probe, second attempt | 7 integration tests failing — the mutation "working" | The mutation itself was a syntax error, so the worker never started. Seven failures from a broken probe, none from the assertion under test. **The same escaping trap as the row above, two rows apart** |
| **T1.1 EODHD Saturday sweep** | Seven years of Saturdays reported `0 bars   correct - market closed` | **Every one was HTTP 403 "Only EOD data allowed for free users".** The check tested `bars === 0` without testing whether the request succeeded. Zero rows because access was DENIED, rendered as a clean pass. **Written days after this lesson, inside the sweep designed to be rigorous** |
| **T1.1 Massive Saturday check** | `0 bars, request OK -> VALID ABSENCE` — both assertions satisfied | `limit` in that API caps BASE AGGREGATES SCANNED, not results returned. `limit=200` examined **3.3 hours** of the Saturday it claimed to cover. The request genuinely succeeded and genuinely returned zero rows — **the conclusion was still wrong** |

The leak probe is the sharpest: it produced confident reassurance from a code
path that never executed. Its exit code and its output both looked like a pass.

This is why the T0.6 boundary test, the T0.7 `force-dynamic` test and the T0.7
boot test were each proven by deliberately breaking the thing they guard. That
is not thoroughness for its own sake — it is the only evidence that the check
is connected to anything.

#### Instance 7 happened while deliberately applying this lesson

**This is the part a future session most needs to know.** The EODHD Saturday
sweep was written specifically because the Twelve Data weekend finding had made
the Saturday test a standard step. It was the rigorous check. It ran seven
requests, every one was refused with HTTP 403, and it printed seven lines saying
`correct - market closed`.

The lesson as previously written — "make it fail on purpose first" — could not
have caught this, because **the sweep did fail and reported success**. A
deliberately-broken run and a denied-request run are indistinguishable to a
check that only looks at the result count. Knowing the rule, and intending to
follow it, was not enough. The rule itself was incomplete.

Hence the two-assertion form above. The status code is not error handling; **it
is half the assertion.**

#### Instance 8 is a DIFFERENT FAILURE CLASS — the rules passed and the answer was wrong

**Instances 1–7 were all "the check tested nothing". Instance 8 is "the check
tested something real, but not the thing claimed".**

The Massive Saturday query returned HTTP 200 and zero bars. Assertion 1
satisfied: the observation succeeded. Assertion 2 satisfied: the thing was
absent. The reported conclusion — "market correctly closed" — was still wrong,
because `limit=200` meant the query had examined only the first 3.3 hours of
that Saturday.

**Strengthening the absence rule could not have caught this, because the rule
was followed correctly.** What caught it was a control: asking whether a WEEKDAY
was also sparse. A weekday returned 33 bars of 96 — visibly wrong — and that is
what exposed the query defect.

Hence the positive-control rule at the top of this section. It is stronger than
the two-assertion rule and it subsumes it.

#### The specific trap, because it will recur

**A `limit` parameter may cap what is SCANNED rather than what is RETURNED.**
Massive documents it plainly — *"Limits the number of base aggregates queried to
create the aggregate results"* — and it had already been read during this very
evaluation. `limit=200` scanned 200 one-minute base aggregates: 3.3 hours,
yielding 13 fifteen-minute bars.

**Read what a limit limits before trusting a short result.** A short result is a
claim about the query at least as much as a claim about the data.

**Apply it going forward: any assertion of absence gets a deliberate failure
first.**

### A close-out must be ADVERSARIAL, and performed against the artefact

**A session that has just built something assesses it more favourably than the
code supports, and it does not feel like bias at the time.**

The evidence is T0.8. Its pre-assessment — written from memory at the end of a
long session — got **two of three verdicts wrong, and BOTH IN THE SAME
DIRECTION.** Criterion 3 was marked MET when crash logging had never run in a
real process. Criterion 2 was described as "mechanism fully covered by 33 unit
tests" when two of its four sub-clauses were not mechanism questions at all.

Neither error was random. **Errors that are directional are bias, not noise.**

So: **the close-out is a separate step from the implementation, performed
against the code, and treated as adversarial rather than as confirmation.** Its
question is not "does this look done" but "what would I have to find to call
this unfinished". Grep for the consumers of a flag. Check whether a test named
after a resource actually touches one.

**The sharpest instance:** a shutdown hook NAMED `database-pool` that pushes a
string to an array, with 33 passing tests, none of which touch a real
connection. It reads as coverage of connection handling. It is coverage of
ordering. Same family as `verifyNotInTransaction` and the `limit=200` Saturday
query: **a thing that looks like the check you want, standing where that check
should be.**

### A measurement's validity EXPIRES when the code it measured changes

**Record what a measurement was taken against — a commit or a date — or a later
session will cite stale evidence as current.**

T0.8 measured six boot-failure modes under `tsx` and found all six exit 1, which
is why the worker has no explicit `process.exit(1)`. During the close-out that
result was nearly cited as covering the crash handlers. **It does not: it was
measured at `f9a75a5`, and `crash-logging.ts` did not exist until `1b12823`.**

The measurement is still valid for what it measured. It is silently invalid for
the thing it was about to be used for, and nothing in the number itself says
so.

This is the counterpart to recording measurements so they need not be re-bought:
**an undated measurement is not a saved cost, it is a trap.** Every figure in
this file now carries the date or commit it was taken against.

### When a ratio lands near a threshold, find the confound — do not invoke the threshold

**A number close to a decision boundary is not evidence. It is a signal that the
measurement is not yet the right measurement.**

T1.1 asked whether Twelve Data's weekday series changed when its weekend
behaviour did. Raw divergence against an independent provider grew **2.91x**
across the boundary, against a 3x threshold written into the script beforehand.
Reading that as "under threshold, therefore fine" would have been luck, not
analysis — and the decision it fed was which provider the whole system depends
on.

The confound was obvious once looked for: **volatility had grown 2.34x over the
same period**, and two feeds sampling different tick streams diverge more when
the bar moves more. Normalising divergence by bar range gave 9.0% before and
11.2% after — a 1.25x change, clearly noise on a four-day sample.

A borderline number became a clear one, and the answer did not depend on where
the threshold sat. **If the conclusion would flip on a threshold chosen by
judgement, the threshold is doing the work that the measurement should do.**

Ask: what else changed between the two populations being compared, and can the
comparison be normalised by it?

### Measure the platform before writing code that compensates for it

**Three times now, a defensive mechanism was written against an assumed
platform behaviour, and the assumption was wrong in both directions.** The cost
is not wasted code; it is a comment asserting a hazard that does not exist,
which the next reader believes.

| Assumed | Actually | Consequence |
|---|---|---|
| Next.js would surface an instrumentation failure as a failed start | It prints `✓ Ready`, then serves 500s forever | T0.7 needed `process.exit(1)` — the compensation was **necessary** |
| The worker would likewise need an explicit exit | Every one of six failure modes already exits 1 under tsx — **measured at `f9a75a5`; `crash-logging.ts` did not exist until `1b12823`, so this does NOT cover the crash handlers** | T0.8 wrote **no** exit. An unnecessary one would imply Node does not crash on unhandled rejections |
| `process.loadEnvFile` overwrites already-set variables | It gives the environment precedence, and always did (documented for `--env-file`, measured on v24.19.0) | A hand-rolled precedence loop that could never change an outcome, in the repository since T0.7, copied forward in T0.8 before being caught |

The third is the instructive one, because it was written twice: once in T0.7's
instrumentation hook, then again when that logic was extracted in T0.8 — with a
comment confidently describing a bug that did not exist, and a test that
"passed" while proving only that Node works. A mutation test caught it.

**Apply it going forward: before writing code that compensates for a platform
behaviour, spend the five minutes to observe that behaviour.** Where the code
then depends on it, pin it with a test — `env-file.test.ts` now asserts Node's
precedence not because we implement it, but because `db:migrate` relies on it
and a change in Node should arrive as a test failure rather than as a silently
migrated wrong database.

### Verify that the observable changed — a fix can look right and do nothing

Two fixes so far have *appeared* to address a problem while doing nothing at
all. Both were caught by measuring the observable afterwards; neither would
have been caught by reading the code.

**T0.6 — `verifyNotInTransaction`.** It queried `pg_stat_activity.state` and
refused if it contained `'in transaction'`. But while a query is executing the
state is always `'active'`, including inside an open transaction — so the check
could **never fire**. It read like a safeguard on the one operation that
deletes databases, and was not one. Removed rather than left in place.

**T0.7 — the `NEXT_RUNTIME` guard.** Turbopack warned that `node:fs` is
unavailable in the Edge runtime. Adding `if (process.env.NEXT_RUNTIME !==
'nodejs') return` looked like the fix and silenced **nothing**: Turbopack's
analysis is static, not a reachability check. Only physically moving the Node
APIs into a separate module removed the warnings — 6 → 0, measured at `0a95c5f` (T0.7, 2026-08-26) against a real `next build`.

**The rule: when a fix targets something observable — a warning count, a log
line, a refusal, an exit code — check that the observable actually changed.**
"I added a guard" and "I added a check" are both easy to write, easy to
believe, and independently worthless.

Related: recurring noise in a channel you rely on for signal eventually
destroys that channel. Six warnings on every build is how build output stops
being read, and then a real error hides in it. Same argument as flaky tests,
different surface.

### Runtime names are invisible to a suite that never sees a production build

The boot message read `FATAL: r: Invalid environment configuration`. `r` was
the **minified class name**: T0.5 set `this.name = new.target.name`, which
yields the mangled constructor name in any production bundle.

Every production log line would have carried `"type":"r"` — the entire error
taxonomy silently useless in exactly the environment it exists for, while
development looked perfect indefinitely. T0.5's tests all ran unminified, so
the taxonomy was verified in precisely the conditions where the bug is
invisible.

That is a general problem, not a one-off. **Anything depending on runtime
names — `error.name`, constructor identity, `Function.name`, class names in
serialised output — is invisible to a test suite that never sees a production
build.** This was found only because a test booted a real minified server.

**Before T0.10, audit for other places where a minified build would behave
differently from source, and treat "verified in development" as not covering
it.**

---

## Carried-forward obligations


**22 open, 2 discharged.** Where they land:

- **T0.10** — 3
- **T0.9 — firm** — 3
- **T0.9** — 2
- **before Phase 2** — 2
- **T1.4, T1.7** — 1
- **unassigned — suggest T0.10** — 1
- **ongoing** — 1
- **low priority** — 1
- **open — may become moot** — 1
- **if suite slows** — 1
- **cosmetic** — 1
- **do not "fix"** — 1
- **rationale** — 1
- **audit — not urgent** — 1
- **before Phase 6** — 1
- **T0.10 — firm** — 1

Sorted ascending. Discharged obligations are struck through and kept, so a
later session can see that a question was asked and answered rather than
wondering whether it was ever considered.

| # | Obligation | Lands in |
|---|---|---|
| ~~1~~ | ~~**`packages/core` import-boundary regression test.**~~ **DISCHARGED in T0.6.** `packages/test-support/src/core-boundary.test.ts` lints snippets through the ESLint API against a virtual `packages/core` path and asserts each rule fires. Proven by deliberately weakening `eslint.config.js` two ways: changing the core block glob failed 11 of 15 tests, removing the empty-catch selector failed exactly 1. Both reverted, confirmed with `git diff`. **Its failure messages explain why the boundary exists and say not to delete the test** — the real risk is removal by someone who does not know what it protects | done |
| 2 | **Prevent modification of existing migration files on `main`.** Drizzle does not detect tampering (see above), so CI must fail when a commit alters a migration already on `main`. This is the only thing that will actually enforce ADR-003's immutability rule | **T0.9** |
| 3 | **Verify Railway's pre-deploy/release migration mechanism.** Migrations must be a release step, never the service start command (OPS-2). How Railway expresses that is `[VERIFY]` — unconfirmed, `ARCHITECTURE-AND-STACK.md` U-7 | **T0.10** |
| 4 | **Railway backup and restore (OPS-7).** Requires a *tested* restore, not just a configured backup. Entirely outstanding | **T0.10** |
| 5 | **"Avoid infinite retry loops" (§23).** T0.5 defines the `retry` policy but **nothing consumes it**. It lands in T1.4 backfill and T1.7 reconnection, both of which specify bounded exponential backoff with jitter | **T1.4, T1.7** |
| 6 | **No ADR records the TypeScript 6.0.3 pin.** TypeScript 7 is npm's `latest`, but typescript-eslint does not support it and hard-errors on load. A routine `pnpm update` would silently break `pnpm lint`. The reason exists only in commit `d41b2cb` | **unassigned — suggest T0.10** |
| 7 | **ESLint flat-config trap.** Flat config *replaces* a rule's options rather than merging. Any future repo-wide `no-restricted-syntax` rule must be repeated inside the `packages/core` block or it silently switches off there. Verify with `eslint --print-config` | ongoing |
| ~~8~~ | ~~**`ARCHITECTURE-AND-STACK.md` §D is wrong and needs correcting.**~~ **DISCHARGED in T0.8.** §D no longer says "holding a websocket" and carries a dated correction note; §E/U-1's matrix row now records that the question is resolved for OANDA and that its original answer ("websocket is better for sweep detection") was exactly backwards for this provider — kept as a criterion because it still applies to evaluating a replacement. The F.2 amendment, which had flagged both as uncorrected, now says both were fixed | done |
| 9 | **Migration CLI duplicates redaction logic.** `packages/db/src/bin/migrate.ts` hand-rolls error redaction predating T0.5's logger. **Its `.env` loading was deduplicated in T0.8** — that copy and three others now share `loadEnvFileIfPresent` in `@karatx/config` — but the redaction itself is untouched | low priority |
| 10 | **The CSV fixture loader does not handle quoted fields containing commas.** `readCsvFixture` in `@karatx/test-support` splits on `,` with no quote handling. The TradingView exports it serves are not believed to use quoted fields, and a half-implemented quote parser that looks correct is worse than none — but **this fails as silently wrong numbers, not as an error**, because a quoted `"4,637.29"` would split into two values and either throw a column-count error or, worse, shift every subsequent column. **When real golden data arrives, check whether any field contains a quoted comma before trusting the loader.** **STAYS OPEN, and may become moot:** TradingView's export is a paid feature we do not have (obligation 12). If golden values instead arrive via Pine Script `log.info()`, the format is one we control rather than TradingView's, and this limitation stops mattering. Do not close it on the assumption that the format will be CSV | **open — may become moot** |
| 10a | **REQUIRED, not optional: a CI job that runs unit tests with NO PostgreSQL service attached.** Stopping the database by hand is a spot check that proves it today; only CI makes it a property that cannot silently regress. **This has already regressed once.** During T0.6 `packages/test-support` gained integration tests, its unit script had no config, Vitest's default `include` swept them into `pnpm test`, and the unit suite silently began requiring a database — passing only because Postgres happened to be running. `vitest.shared.ts` now excludes `*.integration.test.ts`, but nothing prevents a future package from being wired up without it. T0.9 must attach no database service to the unit job | **T0.9 — firm** |
| 10b | **Integration isolation is per *run*, not per *file*.** Each run gets its own ephemeral database, so two runs — CI and local, or two CI jobs — cannot collide. **Within** a run, files still share that one database and rely on `fileParallelism: false`. Revisit per-worker schemas if the integration suite becomes slow in Phase 1 | if suite slows |
| 10c | **A pre-T0.6 leftover database `karatx_test` exists on the local server.** It does not match the current anchored naming pattern, so the sweep will correctly never touch it — "unrecognised means untouched". It is harmless clutter from the T0.4 scheme and can be dropped manually whenever convenient | cosmetic |
| 10d | **Do not replace the crash-path test with a "more realistic" kill test.** `db.integration.test.ts` reproduces the post-crash state deterministically via `KEEP_TEST_DB=1`, which skips teardown and leaves exactly the database a crashed run leaves behind. Two attempts at a timing-based kill were tried first and neither was valid — one finished before the kill landed, the other killed a worker while Vitest's main process survived and cleaned up anyway. A timing-based test would be **flaky forever**, and a flaky test around destructive operations is worse than none. Reproducing the state that matters beats simulating the event that causes it | do not "fix" |
| 10e | **Vitest cleans up after a worker crash — the orphan window is narrower than assumed.** Measured during T0.6: killing a test *worker* leaves Vitest's main process alive, which reports `Worker exited unexpectedly` and still runs `globalSetup` teardown, dropping the database. So a crashed test does not usually orphan anything. **The 24-hour floor is still justified**, because it covers the cases teardown genuinely cannot run: machine reboot, a cancelled CI job, SIGKILL of the whole process tree, and Docker stopping underneath a running suite. Those are the real orphan sources | rationale |
| 11 | **PHASE 2 PREREQUISITE — make the unit suite fast before Phase 2 begins.** 18.2s **measured at `66be0e4` (T0.6) over 4 packages; the suite has since grown to 7 packages and 235 tests, so re-measure first**, of which ~11s is `pnpm -r` spawning a separate Vitest process per package. Fix: a single Vitest workspace run sharing one process. **This is a prerequisite, not a nice-to-have.** In Phase 2 the unit suite runs constantly while fifteen TR rule definitions are tuned against TradingView parity data — an 18-second wait at that cadence changes behaviour, and people stop running it. That is §11's rotting risk applied to the *unit* suite rather than the integration suite. Fixing it after Phase 2 has started is fixing it after the damage | **before Phase 2** |
| 12 | **C3 indicator parity still needs TradingView's own computed values, and there is no route to them yet.** TradingView's *Export chart data* is a paid feature the user does not have, so the golden CSV planned for T0.6/T1.10 could not be produced. Without TradingView's own EMA and Stoch RSI numbers there is nothing to assert engine output *against*, and audit finding C3 — parity within a documented tolerance — cannot be closed by inspection alone. **Routes being explored, in order:** (1) Pine Script `log.info()` output, which would let the chart emit its own indicator values; (2) one month of a paid TradingView plan purely to run the export; (3) manual transcription of ~20 bars, enough for a spot check but not a fixture. **Blocks nothing in Phase 0 or Phase 1.** Required before **Phase 2** indicator work begins | **before Phase 2** |
| 13 | **T0.9 must set `NEXT_TELEMETRY_DISABLED=1` in the CI environment.** Next.js collects anonymous build-time telemetry by default. It is declined via the environment variable rather than `next telemetry disable`, because the latter writes machine-global state a fresh CI runner would silently not have. Recorded in `.env.example`; CI needs it set independently | **T0.9** |
| 14 | **`pnpm typecheck` has a blind spot — audit it.** `vitest.shared.ts` sat at the repository root with a type error (it imported `UserConfig` from `vitest/node`, which exports it as `TestUserConfig`) and **no package tsconfig included it**, so nothing checked it. It surfaced only by accident, when `apps/web` happened to pull it in through a relative import. Root-level and config files outside every package's `include` are unchecked today. **Audit which files are outside every package tsconfig and decide deliberately whether each should be covered.** A typecheck with unknown blind spots is worse than one whose shape is known | **audit — not urgent** |
| 15 | **T0.9 must build `apps/web` BEFORE running integration tests.** Its boot tests spawn a real server with `next start`, which requires `.next` to exist. Locally the build is usually already there; a fresh CI checkout has nothing. The test asserts the build exists and says so explicitly rather than surfacing as a confusing timeout, but CI must order the steps: install, build, then integration tests | **T0.9 — firm** |
| 16 | **`apps/web` computing strategy is unenforced.** F.1 says the web app reads what the worker wrote and never computes. That holds today by inspection only — no rule prevents `apps/web` importing an indicator from `packages/core` and calculating in the dashboard, producing two implementations that drift. The fix has a proven shape: an ESLint boundary plus a regression test, exactly as T0.2/T0.6 did for `packages/core`. Cheap now, and the reason to do it before Phase 6 builds the real dashboard | **before Phase 6** |
| 17 | **T0.10 must re-measure worker boot-failure behaviour against however the worker actually runs on Railway.** T0.8 measured six failure modes under `tsx` **at commit `f9a75a5`** and all exited non-zero, so the worker needs no explicit `process.exit(1)`. **That result is valid for `tsx` only.** If production runs compiled output, a different entry point, or a process supervisor that wraps execution, the measurement must be repeated — believing a tsx result about production would be the minified-name mistake in a different costume. **Also check what Railway does with each exit code**: the lifecycle exits 0 on a clean shutdown and 1 when a hook failed or timed out, and that distinction is only useful if the platform acts on it | **T0.10 — firm** |
| 18 | **OPS-3 end to end is unproven, and CI is the only place it can run.** Windows cannot deliver a catchable SIGTERM to a Node child, so `apps/worker/src/boot.integration.test.ts` skips that case on win32. The CI job must run integration tests on Linux, and this test must be confirmed as RUN rather than skipped — a skipped test reported as green is the "verification that tests nothing" failure in its most ordinary form | **T0.9 — firm** |
| 19 | **`apps/web` resolves the repository root from a BUNDLED module.** Its instrumentation hook now calls the shared `loadEnvFileIfPresent`, which walks up from the module's own location looking for `pnpm-workspace.yaml`. Under Turbopack that module is bundled, so `import.meta.url` points inside `.next/`. It resolves correctly today — verified by a real build, 9 integration tests and 2 Playwright tests — but a `standalone` output that copies files elsewhere would break it silently, and the failure mode is "no .env found", not an error. Re-verify if the web deployment mode changes | **T0.10** |
| 20 | **Crash logging has never run in a real worker process.** `installCrashLogging` is unit-tested by invoking the registered listener directly, which proves the rethrow and the taxonomy fields but not that a fatal JSON line reaches stdout from a spawned worker. The T0.8 tsx measurement does not cover it — that ran BEFORE `crash-logging.ts` existed. Needs an integration test that starts a real worker, crashes it, and asserts one fatal line with `category` and `policy` | **T0.9** |
| 21 | **Pool closure is unverified against a real database.** The lifecycle tests use a hook *named* `database-pool` that pushes to an array. Nothing asserts `pool.end()` released connections. Verify by checking `pg_stat_activity` after a shutdown, against a real PostgreSQL — the same "assert the observable changed" discipline that caught `verifyNotInTransaction` | **T0.9** |
| 22 | **`isShuttingDown` has no production consumer.** OPS-3's "stops accepting work" is a SEAM, not a behaviour — `grep` finds it referenced only by `lifecycle.ts` and its own tests. Correct today, since there is no work until the feed exists. **T1.7 must wire the feed consumer to check it**, or the clause is never actually satisfied | **T1.7 — firm** |

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
   `docs/DECISIONS.md` (what was decided and why).
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
docs/ARCHITECTURE-AND-STACK.md  topology, invariants, schema sketch
docs/INDICATOR-SPEC.md       confirmed EMA and Stoch RSI formulas
eslint.config.js             the packages/core boundary rules
docker-compose.yml           local Postgres 17, 127.0.0.1 only

apps/worker/src/boot.ts      the boot ORDER: config, logger, database, startup row
apps/worker/src/lifecycle.ts ordered shutdown with a per-hook timeout
apps/worker/src/index.ts     entry point; runs on import and exports nothing
packages/config/src/env-file.ts  the single .env loader, shared by four callers
```
