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
| Complete | **T0.1 – T0.5** (5 of 10) |
| Next task | **T0.6 — Test harness** (not started) |
| Branch | `main`, 10 commits, working tree clean |
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
pnpm test                        EXIT=0    116 tests, 7 files
pnpm test:integration            EXIT=0      9 tests, 1 file
```

Unit test breakdown:

| Package | Files | Tests |
|---|---|---|
| `packages/core` | 2 | 47 |
| `packages/config` | 4 | 40 |
| `packages/providers` | 1 | 29 |
| **total** | **7** | **116** |

Integration: `packages/db` — 1 file, 9 tests, against real PostgreSQL.

**Known failures: none.** Nothing is skipped, mocked-out or quarantined.

---

## Phase 0 progress, verified from disk

| Task | State | Evidence |
|---|---|---|
| T0.1 Repo + workspace skeleton | **Done** | pnpm workspace, `apps/{web,worker}`, `packages/{core,contracts,db,providers,config}`, strict TS with `noUncheckedIndexedAccess` |
| T0.2 Lint, format, import boundaries | **Done, one deferral** | ESLint + Prettier; `packages/core` boundary enforced on imports, globals and clock/random syntax. Regression test deferred to T0.6 |
| T0.3 Configuration and secrets | **Done, two honest gaps** | Zod schema, `Secret<T>`, sanitised errors. See "Not proven" below |
| T0.4 Database, Drizzle, first migration | **Done** | Docker Postgres 17, `system_events` + `config`, migration applied and idempotent, 9 integration tests |
| T0.5 Logging and error model | **Done** | Pino JSON, 3-layer redaction, correlation IDs, 8-class error taxonomy |
| T0.6 Test harness | **Not started** | — |
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

---

## Carried-forward obligations

| # | Obligation | Lands in |
|---|---|---|
| 1 | **`packages/core` import-boundary regression test.** T0.2 proved the rule fires with a one-shot manual check, then deleted the probe. Nothing now fails if the rule is weakened. Confirmed absent: no test file loads ESLint | **T0.6** |
| 2 | **Prevent modification of existing migration files on `main`.** Drizzle does not detect tampering (see above), so CI must fail when a commit alters a migration already on `main`. This is the only thing that will actually enforce ADR-003's immutability rule | **T0.9** |
| 3 | **Verify Railway's pre-deploy/release migration mechanism.** Migrations must be a release step, never the service start command (OPS-2). How Railway expresses that is `[VERIFY]` — unconfirmed, `ARCHITECTURE-AND-STACK.md` U-7 | **T0.10** |
| 4 | **Railway backup and restore (OPS-7).** Requires a *tested* restore, not just a configured backup. Entirely outstanding | **T0.10** |
| 5 | **"Avoid infinite retry loops" (§23).** T0.5 defines the `retry` policy but **nothing consumes it**. It lands in T1.4 backfill and T1.7 reconnection, both of which specify bounded exponential backoff with jitter | **T1.4, T1.7** |
| 6 | **No ADR records the TypeScript 6.0.3 pin.** TypeScript 7 is npm's `latest`, but typescript-eslint does not support it and hard-errors on load. A routine `pnpm update` would silently break `pnpm lint`. The reason exists only in commit `d41b2cb` | **unassigned — suggest T0.6 or T0.10** |
| 7 | **ESLint flat-config trap.** Flat config *replaces* a rule's options rather than merging. Any future repo-wide `no-restricted-syntax` rule must be repeated inside the `packages/core` block or it silently switches off there. Verify with `eslint --print-config` | ongoing |
| 8 | **`ARCHITECTURE-AND-STACK.md` §D is wrong and needs correcting.** It describes the worker as "a long-lived singleton process holding a websocket and a scheduler". F.2 was amended during T1.1 to polling — OANDA's own docs state you cannot build OHLC candles from their price stream — but §D was not updated, and §E/U-1's evaluation matrix still frames websocket-vs-polling as an open question. **The code is right; the document is stale.** Candles are polled after each M15 close; the stream supplies bid/ask and heartbeat liveness only. Fix belongs to whichever task next touches the worker — currently **T0.8** | T0.8 |
| 9 | **Migration CLI duplicates redaction logic.** `packages/db/src/bin/migrate.ts` hand-rolls error redaction predating T0.5's logger | low priority |
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
