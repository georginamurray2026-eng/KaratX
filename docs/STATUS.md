# STATUS

Handoff file between Claude Code sessions (§27, §44). The repository is the
project memory — do not rely on conversation history.

**Last verified:** 2026-08-26, by inspecting the repository and running the
commands below. Every figure here came from an actual run, not from a
handover document.

---

## Current position

| | |
|---|---|
| Phase | **Phase 0 — Engineering Foundation** |
| Complete | **T0.1 – T0.6** (6 of 10) |
| Next task | **T0.7 — Web skeleton and health endpoints** (not started) |
| Branch | `main`, working tree clean. (Commit count deliberately not stated — a self-referential number in a committed file is stale the moment it lands. Use `git log --oneline`.) |
| Remote | none configured. Nothing has been pushed |

Phase 1 task **T1.1** (provider evaluation) was also completed early, out of
order, because it unblocks Phase 1. See ADR-005.

---

## Verification state

All run on 2026-08-26 from a clean tree.

```
pnpm install --frozen-lockfile   EXIT=0
pnpm lint                        EXIT=0
pnpm format:check                EXIT=0
pnpm typecheck                   EXIT=0    7 projects
pnpm test                        EXIT=0    180 tests, 11 files, 18.2s  (verified with PostgreSQL STOPPED)
pnpm test:integration            EXIT=0     24 tests, 2 files
```

Unit test breakdown:

| Package | Files | Tests |
|---|---|---|
| `packages/core` | 2 | 47 |
| `packages/test-support` | 4 | 64 |
| `packages/config` | 4 | 40 |
| `packages/providers` | 1 | 29 |
| **total** | **11** | **180** |

Integration: `packages/test-support` 15 tests, `packages/db` 9 tests — against real PostgreSQL, each run in its own ephemeral database.

**Known failures: none.** Nothing is skipped, mocked-out or quarantined.

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
| T0.7 Web skeleton + health endpoints | Not started | `apps/web` is a stub; no Next.js installed |
| T0.8 Worker skeleton | Not started | `apps/worker` is a stub; no lifecycle |
| T0.9 CI | Not started | No `.github/` directory exists |
| T0.10 Railway deploy + docs | Not started | — |

`packages/contracts` is still a stub. It is populated in T1.2.

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
```

Local setup for a fresh machine: `cp .env.example .env` then `pnpm db:up`.
The password in `.env.example` is a throwaway local value matching
`docker-compose.yml`; Postgres is bound to `127.0.0.1` only. Real credentials
never live in this repository.

---

## Not proven — stated honestly rather than ticked

These acceptance criteria are **partially** met. Do not record them as done.

- **T0.3 "config fails before any other work."** No boot sequence exists yet.
  `loadConfig()` is the documented first call; **T0.7 and T0.8 must verify the
  ordering.**
- **T0.3 "no secret ever appears in a log line."** T0.5 added the logger and
  three redaction layers, so this is now largely covered — but only for output
  going through that logger. Anything using `console.log` directly bypasses it.
- **T0.4 "migrations never edited after being applied."** This is a *rule*, not
  a guarantee. Verified experimentally: Drizzle does **not** detect tampering.
  An altered applied migration was re-run; it reported success, applied
  nothing, and left the recorded hash unchanged. See obligations.
- **T0.6 "`pnpm test` runs unit tests FAST."** Database-free is fully met and
  verified with PostgreSQL stopped. *Fast* is borderline and measured, not
  assumed: **18.2s wall clock**. Only **5.45s** of that is actual test
  execution, and no single test exceeds 258ms. The remaining ~11s is
  per-package process startup, transform and import — `pnpm -r` spawns a
  separate Vitest process for each of the four packages and pays that cost four
  times. A further 4.9s is the boundary test resolving the ESLint config chain,
  which is inherent to what it checks. **Proposed fix:** a single Vitest
  workspace run instead of `pnpm -r`, sharing one process. Not done in T0.6
  because it changes how every package's tests are invoked and deserves its own
  change. It will matter more in Phase 2, when indicator tests multiply.
- **T0.6 "fixture loading helper in place for the golden datasets."** The
  helper exists, is tested, and loads text, CSV and JSON. But it is
  **generic, not candle-aware** — typed candle loading needs the `Candle`
  schema from `packages/contracts`, a stub until T1.2. More importantly,
  **it has never been run against a real TradingView export**, because none
  exists yet. Its inability to parse quoted fields containing commas
  (obligation 10) is therefore an untested assumption about the file format.
  Treat the helper as ready in principle and unproven in practice until T1.10.

---

## Carried-forward obligations

| # | Obligation | Lands in |
|---|---|---|
| ~~1~~ | ~~**`packages/core` import-boundary regression test.**~~ **DISCHARGED in T0.6.** `packages/test-support/src/core-boundary.test.ts` lints snippets through the ESLint API against a virtual `packages/core` path and asserts each rule fires. Proven by deliberately weakening `eslint.config.js` two ways: changing the core block glob failed 11 of 15 tests, removing the empty-catch selector failed exactly 1. Both reverted, confirmed with `git diff`. **Its failure messages explain why the boundary exists and say not to delete the test** — the real risk is removal by someone who does not know what it protects | done |
| 2 | **Prevent modification of existing migration files on `main`.** Drizzle does not detect tampering (see above), so CI must fail when a commit alters a migration already on `main`. This is the only thing that will actually enforce ADR-003's immutability rule | **T0.9** |
| 3 | **Verify Railway's pre-deploy/release migration mechanism.** Migrations must be a release step, never the service start command (OPS-2). How Railway expresses that is `[VERIFY]` — unconfirmed, `ARCHITECTURE-AND-STACK.md` U-7 | **T0.10** |
| 4 | **Railway backup and restore (OPS-7).** Requires a *tested* restore, not just a configured backup. Entirely outstanding | **T0.10** |
| 5 | **"Avoid infinite retry loops" (§23).** T0.5 defines the `retry` policy but **nothing consumes it**. It lands in T1.4 backfill and T1.7 reconnection, both of which specify bounded exponential backoff with jitter | **T1.4, T1.7** |
| 6 | **No ADR records the TypeScript 6.0.3 pin.** TypeScript 7 is npm's `latest`, but typescript-eslint does not support it and hard-errors on load. A routine `pnpm update` would silently break `pnpm lint`. The reason exists only in commit `d41b2cb` | **unassigned — suggest T0.10** |
| 7 | **ESLint flat-config trap.** Flat config *replaces* a rule's options rather than merging. Any future repo-wide `no-restricted-syntax` rule must be repeated inside the `packages/core` block or it silently switches off there. Verify with `eslint --print-config` | ongoing |
| 8 | **`ARCHITECTURE-AND-STACK.md` §D is wrong and needs correcting.** It describes the worker as "a long-lived singleton process holding a websocket and a scheduler". F.2 was amended during T1.1 to polling — OANDA's own docs state you cannot build OHLC candles from their price stream — but §D was not updated, and §E/U-1's evaluation matrix still frames websocket-vs-polling as an open question. **The code is right; the document is stale.** Candles are polled after each M15 close; the stream supplies bid/ask and heartbeat liveness only. Fix belongs to whichever task next touches the worker — currently **T0.8** | T0.8 |
| 9 | **Migration CLI duplicates redaction logic.** `packages/db/src/bin/migrate.ts` hand-rolls error redaction predating T0.5's logger | low priority |
| 10a | **REQUIRED, not optional: a CI job that runs unit tests with NO PostgreSQL service attached.** Stopping the database by hand is a spot check that proves it today; only CI makes it a property that cannot silently regress. **This has already regressed once.** During T0.6 `packages/test-support` gained integration tests, its unit script had no config, Vitest's default `include` swept them into `pnpm test`, and the unit suite silently began requiring a database — passing only because Postgres happened to be running. `vitest.shared.ts` now excludes `*.integration.test.ts`, but nothing prevents a future package from being wired up without it. T0.9 must attach no database service to the unit job | **T0.9 — firm** |
| 10b | **Integration isolation is per *run*, not per *file*.** Each run gets its own ephemeral database, so two runs — CI and local, or two CI jobs — cannot collide. **Within** a run, files still share that one database and rely on `fileParallelism: false`. Revisit per-worker schemas if the integration suite becomes slow in Phase 1 | if suite slows |
| 10e | **Vitest cleans up after a worker crash — the orphan window is narrower than assumed.** Measured during T0.6: killing a test *worker* leaves Vitest's main process alive, which reports `Worker exited unexpectedly` and still runs `globalSetup` teardown, dropping the database. So a crashed test does not usually orphan anything. **The 24-hour floor is still justified**, because it covers the cases teardown genuinely cannot run: machine reboot, a cancelled CI job, SIGKILL of the whole process tree, and Docker stopping underneath a running suite. Those are the real orphan sources | rationale |
| 10d | **Do not replace the crash-path test with a "more realistic" kill test.** `db.integration.test.ts` reproduces the post-crash state deterministically via `KEEP_TEST_DB=1`, which skips teardown and leaves exactly the database a crashed run leaves behind. Two attempts at a timing-based kill were tried first and neither was valid — one finished before the kill landed, the other killed a worker while Vitest's main process survived and cleaned up anyway. A timing-based test would be **flaky forever**, and a flaky test around destructive operations is worse than none. Reproducing the state that matters beats simulating the event that causes it | do not "fix" |
| 10c | **A pre-T0.6 leftover database `karatx_test` exists on the local server.** It does not match the current anchored naming pattern, so the sweep will correctly never touch it — "unrecognised means untouched". It is harmless clutter from the T0.4 scheme and can be dropped manually whenever convenient | cosmetic |
| 10 | **The CSV fixture loader does not handle quoted fields containing commas.** `readCsvFixture` in `@karatx/test-support` splits on `,` with no quote handling. The TradingView exports it serves are not believed to use quoted fields, and a half-implemented quote parser that looks correct is worse than none — but **this fails as silently wrong numbers, not as an error**, because a quoted `"4,637.29"` would split into two values and either throw a column-count error or, worse, shift every subsequent column. **When the real exports arrive in T1.10, check whether any field contains a quoted comma before trusting the loader.** Phase 2's indicator-parity work depends on this being right | **T1.10** |

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
```
