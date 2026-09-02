# Architecture Decision Records

Decisions are numbered, dated, and immutable once accepted. To change one, write a new ADR that supersedes it; do not edit history.

| ADR | Title | Status | Date |
|---|---|---|---|
| **ADR-001** | **Monorepo with separate `web` and `worker` processes** | **Accepted** | **2026-08-29** |
| **ADR-002** | **PostgreSQL + Drizzle** | **Accepted** | **2026-08-29** |
| **ADR-003** | **Migration policy** | **Accepted** | **2026-08-25** |
| **ADR-004** | **Logging and error model** | **Accepted** | **2026-08-29** |
| **ADR-005** | **Market data provider** | **Accepted, conditional** | **2026-08-25** |
| **ADR-006** | **Extensionless relative imports** | **Accepted** | **2026-08-26** |
| **ADR-007** | **TypeScript pinned to 6.x** | **Accepted** | **2026-08-26** |
| **ADR-008** | **Market data provider, re-evaluated** | **Accepted** | **2026-08-27** |
| **ADR-009** | **Worker runs `tsx` in production** | **Accepted** | **2026-08-28** |
| ADR-010 | Railway configuration mechanism | **NOT WRITTEN** — dangling reference in `.railway/railway.ts` | — |
| **ADR-011** | **Local-only hosting for Phases 1–5** | **Accepted** | **2026-08-30** |

---

## ADR-006: Extensionless relative imports

**Date:** 2026-08-26
**Status:** Accepted
**Task:** T0.7 (discovered while adding the first Next.js build that imports a workspace package)

### Decision

**Relative imports inside this repository carry no file extension.** Write `from './errors'`, never `from './errors.js'`. Enforced by a `no-restricted-syntax` rule in `eslint.config.js`, present in both the repo-wide block and the `packages/core` block.

### Context

T0.1 chose `moduleResolution: "Bundler"` and had packages export TypeScript source rather than compiled JavaScript. Internal imports were nevertheless written as `./errors.js` — a `.js` specifier resolving to an `errors.ts` file.

That is a **NodeNext** convention. Under NodeNext, ESM requires a real extension and TypeScript asks you to write `.js` for a file that compiles to `.js`. Under `Bundler`, no extension is required and the bundler resolves.

The mismatch was invisible for six tasks because every tool we used tolerated it: TypeScript resolves it under `Bundler`, Vitest resolves it, `tsx` resolves it. Nothing strict looked at it until `/api/ready` became the first Next.js code to import a workspace package:

```
Turbopack build failed with 7 errors:
./packages/config/src/index.ts:18:1
Error: Module not found: Can't resolve './errors.js'
```

Turbopack does not map `.js` specifiers onto `.ts` files, and Next 16 has no configuration for it — its Turbopack options are `root`, `rules`, `resolveAlias`, `resolveExtensions` and `debugIds`. There is no `extensionAlias` (webpack has one; Next 16 defaults to Turbopack).

### Alternatives considered

**Build packages to JavaScript and have Next consume `dist/`.** Rejected. It reverses T0.1's decision and taxes every loop for the life of the project: typecheck, test and dev would all need a prior build, and a stale `dist` becomes a new class of confusing bug.

**Switch `next build` to webpack for its `extensionAlias`.** Rejected. It fights the framework default, and Turbopack is where Next is going — the cost grows with each release.

**Stop importing workspace packages from the web app.** Rejected. It duplicates logic, violates F.1, and `/api/ready` genuinely needs `@karatx/db`.

### Reasoning

This is not a Turbopack workaround. It removes an inconsistency: `Bundler` resolution was chosen deliberately in T0.1, and `.js`-pointing-at-`.ts` belongs to a resolution mode this project does not use. Extensionless is what `Bundler` is designed for.

It also removes an entire category of "which tool maps `.js` to `.ts`" surprises, rather than adding one workaround per tool.

Measured before deciding: converting `packages/config` alone took the Turbopack error count from 7 to 3, with every remaining error a `.js` specifier in a package not yet converted, and `pnpm typecheck` continued to pass throughout.

### Consequences

- 44 specifiers across 24 files converted in one mechanical change.
- A lint rule prevents drift. Its message explains *why* extensionless is correct here, because the failure mode is a build error in `apps/web` caused by an import in a package it merely depends on — maximum distance between cause and symptom — and someone arriving with NodeNext habits will otherwise assume the rule is stale.
- The rule is duplicated into the `packages/core` block deliberately. Flat config **replaces** a rule's options rather than merging them; omitting it there would switch it off in the one package where correctness matters most. This has already happened once, in T0.5.

### REVERSAL CONDITION

**This decision is safe only because nothing in this repository currently wants extensions.** It inverts if either of these becomes true:

1. **`moduleResolution` moves to `NodeNext` or `Node16`.** Those modes *require* an extension on relative ESM imports. Extensionless imports would stop resolving.
2. **Any package emits real ESM to be consumed by Node directly**, without a bundler — for example publishing a package, or running compiled output under plain `node` rather than `tsx`. Node's ESM resolver requires extensions.

If either happens, the correct move is to reverse this ADR — convert back to `.js` specifiers and delete the lint rule — **not** to add per-tool workarounds. Write a new ADR superseding this one.

Neither trigger is close today: `tsconfig.base.json` sets `Bundler`, the worker runs through `tsx`, and the web app runs through Next.

---

## ADR-007: TypeScript pinned to 6.x

**Date:** 2026-08-26
**Status:** Accepted
**Task:** Recorded during T0.7; the decision itself was made in T0.2 (commit `d41b2cb`)

### Decision

**TypeScript is pinned to `^6.0.3` and must not be upgraded to 7.x.**

### Context

T0.1 installed `typescript@^7.0.2` because that is what npm's `latest` tag points at. TypeScript 7 is the native rewrite. Adding ESLint in T0.2 failed immediately:

```
Error: typescript-eslint does not support TS 7.0.
```

This is an explicit runtime guard, not a soft peer warning — the package refuses to load. typescript-eslint's declared peer range is `>=4.8.4 <6.1.0`, and its tracking issue targets TS ≥ 7.1, which exists only as a dev build.

### Reasoning

Without the pin there is no `pnpm lint` at all, which would leave F.3 invariant 1 — `packages/core` performs no I/O — completely unenforced. That guarantee is what lets the backtest run the identical code path as live.

6.0.3 is a stable release, not a dev build, and every strict flag T0.1 requires exists unchanged.

Microsoft's documented side-by-side workaround (aliasing `typescript` to `@typescript/typescript6` for tooling while keeping TS 7 for `tsc`) was considered and rejected: it leaves two compilers and two binaries in the repository permanently, and every later task would need to know which resolves where. That is complexity for a speed benefit this project does not need.

### Consequences

- **A routine `pnpm update` that moves TypeScript to 7.x will silently break `pnpm lint`.** Until this ADR existed, the only record of why was a commit message.
- The repository is one minor version behind npm's `latest` and will stay there for a while.

### REVERSAL CONDITION

Upgrade when **typescript-eslint ships support for TypeScript ≥ 7.1** — tracked at `https://github.com/typescript-eslint/typescript-eslint/issues/10940`. Verify by running `pnpm lint` after the bump; the failure is immediate and unmistakable, not subtle.

---

## ADR-003: Migration policy

**Date:** 2026-08-25
**Status:** Accepted
**Task:** T0.4 (written here rather than deferred to T0.10, because the decision is made by the code T0.4 ships)
**Drives:** OPS-2

---

### Decision

**Migrations are generated by a tool, reviewed as SQL, committed immutably, and applied only by an explicit human-or-release action. Nothing migrates at boot.**

| Concern | Decision |
|---|---|
| Generation | `pnpm db:generate` → `drizzle-kit generate`. Pure schema-to-SQL; needs no database and no credentials |
| Review | The generated `.sql` is read before it is committed. It is the reviewable artefact, not the schema TypeScript |
| Application | `pnpm db:migrate` → `packages/db/src/bin/migrate.ts`, an explicit entry point |
| At boot | **Never.** No application code path reaches the migrator |

> **AMENDED 2026-08-28 (T0.10) — what "never at boot" means for Railway, so it is
> not re-litigated.**
>
> **A Railway PRE-DEPLOY COMMAND satisfies this ADR. It is the deliberate
> release step, not a boot-time migration.**
>
> Railway runs it *"between building and deploying your application"*, in a
> **separate container** from the app, with volumes unmounted; if it fails it is
> *"not retried and the deployment will not proceed"*. No application process
> exists yet when it runs, so no application code path reaches the migrator —
> which is exactly the property this ADR protects.
>
> The intent was never "a human must type the command". It was **"the migrator
> must not run inside application startup"**, where a failed or partial
> migration would leave a serving process against a schema it does not expect.
> A separate pre-app container is the standard satisfaction of that.
>
> Configured on the **worker** service only. Exactly one service may carry it,
> or two deploys race the same database, and the worker is the component that
> refuses to boot against a mismatched schema (T0.8) — so the release step and
> its strictest consumer sit together.

---

### MIGRATIONS MUST BE FORWARD-COMPATIBLE — a rule about how they are WRITTEN

**Rolling back code does NOT roll back the database.** Railway's rollback
redeploys a previous *image*; the schema stays wherever the last migration left
it. So a rollback past a migration leaves the **new schema live and the old code
running against it** — code that has never seen that schema and does not expect
it.

**Therefore, from T1.3 onward, every migration must be written so that the
PREVIOUS release still works against it.** In practice:

- **Add, do not alter.** New nullable columns and new tables are safe. Renaming
  or dropping a column that the previous release reads is not.
- **Split destructive changes across two releases.** Release N adds the new
  shape and writes both; release N+1 stops writing the old shape; a later
  release drops it. Each step is independently roll-back-able.
- **A migration that cannot be made forward-compatible must be flagged as a
  one-way door in its pull request**, and the deployment treated accordingly:
  after it lands, rollback is no longer a recovery option and restoring a
  database backup is.

This is a constraint on migration AUTHORING, not only on deployment procedure.
It is recorded here rather than only in `DEPLOYMENT.md` because this is the
document someone writing a migration will already be reading.
| `drizzle-kit push` | **Not wired up, deliberately** |
| Immutability | An applied migration is never edited. Corrections are new migrations |
| Local database | Docker Compose, Postgres 17, bound to `127.0.0.1` |
| Production | Railway managed Postgres, from T0.10 |

---

### Context

OPS-2 requires migrations to be "a deliberate release step, never implicitly at boot". T0.4's risk note asks for the decision to be made and documented now rather than discovered later.

The failure this prevents is specific. If migrations run on startup, then: a crash-looping service re-attempts schema changes repeatedly; two instances starting concurrently race on the same DDL; a rollback to a previous image meets a database that has already moved forward; and a migration failure presents as an application that will not start rather than as a release step that failed. On Railway, where a redeploy restarts processes routinely, all four are live risks rather than theoretical ones.

---

### Reasoning

**Generation and application are separated because they have different blast radii.** Generating is safe and offline — `drizzle.config.ts` deliberately carries no `dbCredentials`, so the generate step *cannot* touch a database even by mistake, and needs no secret to run. Applying is the dangerous half and is therefore its own explicit command.

**`drizzle-kit push` is rejected.** It diffs the schema against a live database and mutates it directly. There is no SQL file, so nothing to review before it runs, nothing in Git describing what changed, and no way to apply the identical change to another environment. That is the opposite of a reviewable release step.

**The migrator is unreachable from application code.** `@karatx/db`'s entry point exports the schema but not `runMigrations`; the migrator lives at its own module path and is imported only by the CLI and by the integration test. Neither `apps/worker` nor `apps/web` can reach it transitively, so "nothing migrates at boot" is a structural property rather than a convention.

**`runMigrations(databaseUrl)` takes the connection string as an argument** rather than reading configuration itself. The integration test can therefore point it at a throwaway database without touching `process.env`, and the test exercises the same code path the release step uses rather than a parallel reimplementation.

---

### Immutability, and an honest limit

The rule: **once a migration has been applied anywhere, its file is never edited.** Fixes are new migrations. This is what keeps every environment's history identical and replayable from empty.

**The tooling does not enforce this, and that was verified rather than assumed.** During T0.4 a committed migration was deliberately altered after being applied, and `pnpm db:migrate` was re-run against the already-migrated database:

```
$ pnpm db:migrate
Migrations applied.
EXIT=0

hash before: ec183e7866f2f1f6dfea65e500b2253b30b8c9cb9f6052e085d0490a6d80a519
hash after:  ec183e7866f2f1f6dfea65e500b2253b30b8c9cb9f6052e085d0490a6d80a519
```

Drizzle applied nothing, reported success, and left the recorded hash untouched. It does not compare the file against what it previously applied. **A tampered migration is therefore silently ignored, and the repository and the database drift apart with no error at all.**

Consequences, recorded so this is not rediscovered the hard way:

1. T0.4's acceptance criterion *"migrations are checked into Git and never edited after being applied"* is satisfied by **discipline**, not by the tool. It is a rule, not a guarantee.
2. **T0.9 obligation:** CI must fail if a commit modifies a migration file that already exists on the main branch. That is a cheap `git diff` check and it is the only mechanism that will actually enforce this.
3. Never hand-edit `migrations/meta/*.json`. These are tool output; `packages/db/migrations/` is excluded from Prettier for exactly this reason, so committed artefacts stay byte-identical to what `drizzle-kit` produced.

---

### Consequences

**Good**

- A deploy that ships a schema change fails at the migration step, visibly, rather than as a service that will not boot.
- The generate step needs no credentials, so the common developer action carries no secret-handling risk.
- Re-running `pnpm db:migrate` is a verified no-op, which makes it safe to put in a release pipeline that may retry.
- Migrating from empty is proven by an integration test against real Postgres on every run, not just once.

**Costs and obligations**

- Applying is a manual step someone must remember. On Railway (T0.10) it must be wired as a pre-deploy/release command, **not** into the service start command — and `[VERIFY]` how Railway expresses that, since `ARCHITECTURE.md` U-7 lists it as unconfirmed.
- Immutability is unenforced until the T0.9 check exists.
- A migration that is slow or takes heavy locks will block a release. Not a concern at Phase 0's two tables; it becomes one around the Phase 1 candle tables and their indexes.
- OPS-7 (backup with a *tested* restore) is untouched by this ADR and remains open for T0.10.

---

### Reversibility

**Easy.** The policy is expressed in scripts and one small entry point. Switching to boot-time migration would be a few lines — which is precisely why the reasoning is recorded here, since the change would be cheap to make and expensive to discover.

---

### Gap identified 2026-08-30 (T0.10) — no down path was ever specified

**This ADR made migrations immutable and never said how to get back.** Each half
is defensible alone; the combination was never examined:

- Drizzle generates forward-only SQL, and `packages/db/src/bin/migrate.ts` has
  no down capability.
- An applied migration cannot be edited, by this ADR's own rule.

**So "roll back a bad migration" currently means "restore from backup".** That
is a coherent recovery story, but it was never *chosen* — it is what remains
once the other routes are closed, and it went unstated because the
question asked of this ADR was always "is the policy correct", never "what
happens when a migration is wrong".

**To be precise about what was and was not missed.** This ADR DID record
"OPS-7 (backup with a *tested* restore) is untouched by this ADR and remains
open for T0.10". The backup risk was tracked. **What was never recorded is the
COUPLING** — that OPS-7 is not an adjacent operational item but the mechanism
this ADR silently depends on. Tracked separately, it was schedulable
separately, and deferring it to Phase 6 would have left the migration policy
with no recovery path for six phases without anyone reading it as a change to
this decision.

**It makes a tested backup a HARD DEPENDENCY of the migration policy**, not an
operational nicety. Until T0.10 L3 has been performed, this ADR has no recovery
path at all.

The decision itself is unchanged; this note amends nothing. What follows from it
— that L3 precedes L4, and that L3 is a precondition of T1.3 — is recorded in
BUILD-PLAN.md.

---

## ADR-005: Market data provider

**Date:** 2026-08-25
**Status:** **SUPERSEDED by [ADR-008](#adr-008-market-data-provider-re-evaluated) on 2026-08-27.** The conditional account-eligibility check failed: OANDA v20 is unavailable to a Thailand-resident account.

> **Do not edit the reasoning below.** It was sound on what was known at the
> time, and the record is more useful intact than corrected. ADR-008 records
> what changed and why. The one thing worth carrying forward is that the
> failure was not in this analysis — it was in what the analysis never checked.
**Task:** T1.1
**Supporting evidence:** [`DATA_SOURCES.md`](./DATA_SOURCES.md) — every claim below is cited there against official documentation.

---

### Decision

**OANDA v20 REST API is the single reference feed** for XAU/USD candles, for both live ingestion and historical backfill.

Specifically:

| Concern | Decision |
|---|---|
| Instrument | `XAU_USD` |
| Base candle | `M15`, `price=M` (mid) |
| Historical + live endpoint | `GET /v3/accounts/{accountID}/instruments/{instrument}/candles` |
| Daily alignment | `dailyAlignment=17`, `alignmentTimezone=America/New_York` — set explicitly on every request, never relied on as a default |
| Weekly alignment | `weeklyAlignment=Friday` |
| Finality | The provider's `complete` flag, mapped to our `is_final` |
| Candle acquisition | **Polling**, not streaming |
| Price stream | Used only for current bid/ask (DR-7, M3) and for liveness via its 5-second heartbeat |
| 1H / 4H / 1D / 1W | Aggregated by us from stored M15 (T1.6), with the provider's own aggregate fetched as a **regression assertion**, not as the source |
| Environment | `api-fxpractice.oanda.com` initially; the same code path against `api-fxtrade.oanda.com` if a live account is ever used |
| Reconciliation source (T1.9) | **Twelve Data** free tier, `XAU/USD` at `15min`; fallback **Massive** (ex-Polygon.io) free Currencies tier |
| DXY (FR-1.5) | **Synthesised** from OANDA's own six USDX component pairs, stored as `USDX_SYNTHETIC`; cross-checked daily against FRED `DTWEXBGS` |
| US Treasury yields (FR-1.6) | **US Treasury daily XML feed**, `daily_treasury_yield_curve`, free and official |

---

### Context

`SPEC-AUDIT.md` finding C1 established that there is no authoritative XAU/USD price: gold spot is OTC and every venue publishes a slightly different quote. The audit's mitigation was to nominate exactly one reference feed and compute everything on it, so that what the system decides matches what the user sees.

The user charts `OANDA:XAUUSD` on TradingView and executes on IC Markets. That fixes the target: the reference feed must be OANDA, or the product's numbers will disagree with the chart the user actually reads and trust will not survive week one.

Finding C2 required an explicit, DST-aware daily boundary. `INDICATOR-SPEC.md` confirmed it as 17:00 `America/New_York`.

T1.1's job was therefore not to choose a provider from a field — it was to check that the already-implied choice is technically viable, and to find what it cannot supply.

---

### Alternatives considered

**1. Twelve Data as the reference feed.** Rejected. It is a good, cheap aggregator, but its XAU/USD is its own composite, not OANDA's book. Using it would mean the system's candles differ from the user's chart by an unknown and unmanaged amount — reintroducing C1 in full. It has no documented configurable daily boundary, which reopens C2. Retained as the **reconciliation** source, where independence is the point and matching is not.

**2. Massive (formerly Polygon.io) as the reference feed.** Rejected for the same reasons. Its free Currencies tier also caps history at two years, and its intraday availability on the free tier is ambiguous. Retained as the reconciliation fallback.

**3. A paid tick-history vendor for backfill, OANDA for live.** Rejected explicitly — this is the trap `SPEC-AUDIT.md` H7 names. Backtesting on one feed and running live on another produces a backtest that does not describe the live system: different wicks, different closes, possibly different daily boundaries. Sweep detection (FR-2.10) is the most wick-sensitive logic in the spec and is exactly what such a mismatch would corrupt. Same provider for live and history is non-negotiable.

**4. IC Markets, the execution broker, as the data source.** Rejected. `ADR-005`'s predecessor decision already recorded IC Markets as execution-only. It offers no public retail market data API, and using it would put the system's numbers out of step with the TradingView chart the user reads.

**5. Building candles from OANDA's price stream instead of polling.** Rejected on the provider's own documented advice: "you cannot create OHLC candlestick data using the REST v20 Stream endpoint, since open, high, low, and close data of the period are not guaranteed to be returned." The stream is also documented as delivering at most 4 prices per second per instrument with connection-dependent window alignment, so two subscribers can legitimately observe different extremes. Wick fidelity matters here more than latency.

**6. A licensed DXY feed.** Rejected on cost and proportionality. DXY is an ICE product; a real-time licensed feed is far outside this project's budget for what is a contextual input. Synthesising it from OANDA's own component pairs gives 15M granularity on the same feed and the same boundaries, at zero marginal cost.

**7. Bond-price CFDs as a yield proxy.** Rejected. OANDA's `USB02Y_USD`/`USB10Y_USD` are prices, not yields, and move inversely. Feeding a price into a rule written about yields is a sign error waiting to happen.

---

### Reasoning

Four things decided it.

**1. The daily boundary is native, and expressed the right way.** `dailyAlignment` defaults to `17` and `alignmentTimezone` to `America/New_York` — an IANA zone name, not a fixed offset, exactly as `INDICATOR-SPEC.md` demands. C2 is not merely satisfiable; it is the provider's default. We still aggregate ourselves (T1.6), but we now have an exact, cheap cross-check to assert against, which is the strongest possible defence against the silent-correctness bug `BUILD-PLAN.md` flags as Phase 1's likeliest.

**2. Every timeframe we need exists natively, and finality is explicit.** `M15`, `H1`, `H4`, `D`, `W` are all in the granularity enum, and `complete` tells us unambiguously whether a bar has closed. FR-1.4 is a field read, not an inference from wall-clock time — which removes an entire class of race condition.

**3. The API is stable to the point of being frozen.** Version 3.0.25 is dated 28 September 2018 and nothing has changed since. For a project whose whole premise is reproducible numbers over years, an API that does not move is worth more than an API with better features.

**4. Bid, ask and mid are all available.** `price` accepts `M`, `B`, `A` in any combination, which satisfies DR-7 and M3's spread requirement from the same endpoint, with no second integration.

The rate limit (120 req/s) is roughly three orders of magnitude above our load. A full five-year M15 backfill is about 35 requests; steady state is about four per hour. `BUILD-PLAN.md` T1.4's warning that "backfill can be the largest single line item on your bill" does not apply to this provider.

---

### Conditions

**This ADR is conditional on one check that could not be completed without the user.**

OANDA's own documentation states the v20 API is "available to all divisions except OANDA Global Markets and OANDA TMS BROKERS S.A." Separately, Thailand residents are listed as eligible for OANDA Global Markets accounts. A Thailand-resident *live* account therefore appears to land in the one division that cannot use the API. Whether a *practice* account does the same is undocumented and not determinable from outside the signup flow.

**Resolution:** the user opens an fxTrade Practice account, generates a token, and runs the three verification calls in `DATA_SOURCES.md` §11. Ten minutes. Until then, T1.2 onward does not start.

**If the check fails**, this ADR is superseded and the fallbacks in `DATA_SOURCES.md` §9 apply, in order: a demo account under a v20-capable division; a different reference feed that the user can also display on TradingView; or — worst — a non-matching feed with widened tolerances, which reopens C1.

A second, smaller condition rides along: `XAU_USD` must actually appear in `GET /v3/accounts/{accountID}/instruments`, since that list is documented as division-dependent and metals are excluded in at least one division.

---

### Consequences

#### What OANDA gives us that we would otherwise have had to build

- Native 17:00 `America/New_York` daily and `Friday` weekly alignment, DST-aware.
- An explicit candle-finality flag.
- Bid/ask/mid from one endpoint, satisfying DR-7 and M3.
- Published market hours for gold — "Sun-Fri: 18:05 - 16:59" New York — feeding `market_hours` (FR-1.8) directly.
- Rate headroom that makes backfill cost and pacing a non-issue.

#### What OANDA cannot supply, and how each gap is filled

| Gap | Fill | Cost | Requirement affected |
|---|---|---|---|
| **No DXY instrument** | Synthesise the ICE six-currency index from OANDA's own `EUR_USD`, `USD_JPY`, `GBP_USD`, `USD_CAD`, `USD_SEK`, `USD_CHF`. One pure function in `packages/core`; same feed, same boundaries, 15M granularity. Store as `USDX_SYNTHETIC`, never as "DXY". Cross-check daily against FRED `DTWEXBGS`. **The exact ICE coefficients are UNVERIFIED (U7) and must be read from ICE's published methodology before implementation.** | ~half a day | FR-1.5 |
| **No Treasury yields** (bond *price* CFDs only) | US Treasury daily XML feed, `daily_treasury_yield_curve`, free, no key, history from 1990, all needed tenors. | ~one day | FR-1.6, DR-3 |
| **Yields are daily EOD, business days only** | Model per-series exchange hours and cadence in `macro_observations`. The gold watchdog must not run over yield series or it will fire every night and all weekend. **Any TR rule requiring intraday yield reaction cannot be built on this source** — a Phase 8 constraint to record now, not discover later. | design constraint | FR-8.4, DR-3, T1.5 |
| **No candle stream** | Poll `.../candles?granularity=M15&count=2&includeFirst=false` after each 15M boundary; trust `complete`. Stream used only for bid/ask and heartbeat liveness. **`ARCHITECTURE.md` F.2 should be amended** — it currently implies a websocket-fed candle path. | design change | FR-1.4, T1.7 |
| **No documented reconnection semantics** | Our own bounded exponential backoff with jitter (T1.7). The 5-second heartbeat is the silent-death detector. | already planned | T1.7 |
| **No documented candle revision policy** | Do not assume immutability. T1.3's conflicting-upsert rule already raises a `data_quality_event` rather than overwriting. Re-fetch the trailing 7 days nightly for the first month and count events — that measurement is the answer. | already planned | T1.3, U3 |
| **No public status page** (`status.oanda.com` does not resolve) | We cannot distinguish "our bug" from "their outage" externally. T1.8 (staleness watchdog) and T1.9 (reconciliation) become the only such signal, and their priority rises accordingly. | none | OPS-8, T1.8, T1.9 |
| **Historical depth for `XAU_USD` unknown** | Measure it by binary search on `from` before T1.4 (`DATA_SOURCES.md` §12). Also check for interior gaps, not just a start date. **Do not state a backtest window until this is measured.** | ~30 min | DR-2, U2 |

#### Licence consequences

The OANDA API License Agreement permits "Internal Use" — research, analysis, data processing, and distribution "to the Licensee (if an individual)" — and prohibits providing FXTrade Rates "to any third party" in any form.

1. **FR-10.6 / decision 5 is now settled by the licence, not just by security.** The dashboard must be private and authenticated. A public URL displaying live OANDA rates is a licence breach regardless of how obscure its path is. `REQUIREMENTS.md` should move FR-10.6 from BLOCKED to PLANNED with this as the rationale.
2. **`FR-3.7` / `FR-10.7` (embedded chart, already deferred to V2) is now more than deferred** — it is only ever permissible for a viewer who is the Licensee.
3. **Phase 7 gains a constraint:** the LLM snapshot (FR-7.2) must carry **derived, non-reconstructable** facts — ATR-relative distances, zone states, structure labels — not raw OHLC arrays. This is arguably required by the licence and is independently desirable for FR-7.2 and SEC-8.
4. **The token is a trading credential, not a data key.** There is no read-only scope. SEC-1 and SEC-12 apply with full force, and compromise is an incident requiring immediate revocation.

#### Cost

Zero marginal data cost. OANDA API access has no documented fee (Schedule A of the licence is unpopulated in the published template and must be checked at token generation — U6). Twelve Data and the Treasury feed are free at our volume. This leaves the entire budget ceiling from decision 3 available to hosting and, later, the LLM.

#### What this does not resolve

C1 is mitigated, not eliminated. Choosing OANDA aligns us with the user's chart; it does not make OANDA's price authoritative. Divergence against the execution broker (IC Markets) remains real and unmeasured, and every level the system publishes should continue to be presented as a **range**, per the audit's mitigation and Part 16 of the build spec.

---

### Reversibility

**Moderately reversible, and the cost rises sharply with time.**

Cheap now, expensive later:

- The provider adapter lives behind `packages/providers/marketdata/*`, and `packages/core` never touches I/O (invariant F.3.1). Swapping the adapter is contained.
- `candles` carries `provider_id` in its unique key (T1.3), so a second provider's data can coexist rather than requiring a migration.
- Alignment is configuration, not code (T1.6 takes `boundaryConfig` as a parameter).

What makes it costly to reverse later:

- Every zone, swing, liquidity pool and setup ever detected is computed on this feed's wicks and closes. Switching providers invalidates all of it as a comparable series — a Phase 9 dataset built on OANDA cannot be extended with another provider's bars without a discontinuity that will quietly poison FR-9.6's statistics.
- The user's chart is the anchor. Changing the feed means either changing the chart or accepting permanent disagreement.

**Practical reading:** reversible at low cost through Phase 2. From Phase 4 onward, treat it as a one-way door and re-derive rather than re-point. If the eligibility check fails, it fails now — which is exactly why it is the gate on this ADR rather than a footnote to it.

---

### Follow-ups created by this decision

| # | Action | When |
|---|---|---|
| 1 | User opens fxTrade Practice account, generates token, runs the three verification calls (`DATA_SOURCES.md` §11) | **Before T1.2** |
| 2 | Measure `XAU_USD` M15 and D history depth and interior gaps (`DATA_SOURCES.md` §12); record in `DATA_SOURCES.md` | Before T1.4 |
| 3 | Amend `ARCHITECTURE.md` F.2 — candles are polled, not streamed | Before T1.7 |
| 4 | Move `REQUIREMENTS.md` FR-10.6 from BLOCKED to PLANNED, citing the licence | Next requirements revision |
| 5 | Add per-series exchange hours and cadence to the `macro_observations` design | T1.10 |
| 6 | Read ICE's published USDX coefficients from their methodology PDFs (U7) | Before the synthetic index is implemented |
| 7 | Verify Twelve Data's free-tier `XAU/USD` access (U9); fall back to Massive (U10) if gated | T1.9 |
| 8 | Nightly trailing-7-day re-fetch for the first month, to measure the undocumented revision policy (U3) | T1.4 onward |

---

## ADR-008: Market data provider, re-evaluated

**Date:** 2026-08-27
**Status:** **Accepted.**
**Task:** T1.1 (re-run)
**Supersedes:** ADR-005
**Supporting evidence:** `STATUS.md` — every number below was measured against a live API on a free-tier key, not read from documentation.

---

### Decision

**Twelve Data is the reference feed. Massive (formerly Polygon.io) is the reconciliation source and the trading-calendar oracle.**

| Concern | Decision |
|---|---|
| Instrument | `XAU/USD` — metadata confirms `currency_base: "Gold Spot"`, `type: "Precious Metal"` |
| Base candle | `15min`, native |
| Endpoint | `GET /time_series` |
| Authentication | `Authorization: apikey <key>` header — **never** the documented query parameter |
| Timezone | `timezone=UTC` **explicitly on every request** |
| Numeric handling | Preserve the decimal text as received; never round-trip through `Number()` |
| Daily alignment | **Imposed by us** in T1.6 at 17:00 `America/New_York`. No provider supplies it |
| Trading calendar | **Ours, and authoritative** — see T1.5. Bars outside it are rejected and recorded, never silently dropped |
| Reconciliation (T1.9) | **Massive**, `C:XAUUSD` at 15min, free tier |
| Calendar oracle | **Massive** — see Reasoning |
| Execution-venue comparator | cTrader Open API, optional, off the hot path |
| Cost | **£0. No paid market-data access**, by explicit constraint |

---

### Context — why ADR-005 failed, and what it teaches

OANDA v20 is **unavailable**. Following OANDA's own Developer Getting Started wizard to its end: a Thailand-resident account is routed to OANDA Global Markets, which is MT4/MT5 only and has no Portal access. v20 belongs to the fxTrade platform of OANDA's other regulated entities. No workaround was attempted, and none should be — an account obtained by misrepresenting residence can be closed without notice, which is worse than not having one.

**The generalisation is worth more than the finding: OANDA did not fail as a data source. It failed as a BROKER.**

A broker opens a regulated account, and regulated accounts are routed by residence to a legal entity. **The API follows the entity, not the brand.** No amount of evaluating the v20 API could have caught this, because the API was never the problem. ADR-005's reasoning was sound; what was missing was a gate, not better analysis.

**Pure data vendors do not have this failure mode.** They sell a data subscription, not a regulated account — no entity routing, no residence-dependent platform assignment.

---

### The reframe that widened the field

ADR-005 treated matching the user's TradingView chart as near-decisive, and derived the provider from it. That was reconsidered.

The requirement was never OANDA. It was **a feed close enough to the traded chart to be trustworthy.** A spot check of OANDA against IC Markets found them near-identical, so brand-matching is worth far less than assumed — and T1.9's reconciliation job exists to *measure* divergence rather than assume it.

This is now quantified. Two independent providers agree on weekday 15M bars to **9–11% of bar range** (0.8–2.8 basis points; roughly \$0.20–\$1.20 on gold). C1's "no authoritative XAU/USD price" is real, but the spread between reputable feeds is small and measurable, not a chasm.

---

### Two criteria added to the matrix, permanently

**1. Regional availability to a Thailand-based user is checked FIRST**, before anything else about a candidate is evaluated. Cheap to check, expensive to miss, and it eliminated the front-runner after everything else had already looked good. **A candidate that cannot be confirmed available is marked UNVERIFIED, never assumed available** — "no restriction found" and "available" are different claims, and conflating them is how ADR-005 happened.

Twelve Data's availability is now **confirmed on evidence**: an authenticated call succeeded from the user's machine.

**2. Can this provider's responses be recorded as fixtures and replayed?** Replaying real responses against real infrastructure has found eight genuine defects in this project. A protocol that breaks it is expensive in a way nothing else in the matrix captured. Demonstrated in practice, not asserted: a real Twelve Data response is committed under `test/fixtures/providers/` and loads through `readJsonFixture` with its decimal text preserved byte-for-byte.

---

### Reasoning

**Depth, and it is real depth.** Twelve Data serves 15min from **2020-01-24**, verified by fetching bars at that date rather than trusting the catalogue. That is ~161,000 real bars after weekend filtering, against Massive's ~48,700 on its 2-year free tier — **3.3x more**.

Critically, that depth was *validated*. Twelve Data began emitting synthetic weekend bars in mid-2025, which raised a reasonable worry that the weekday instrument had also changed. Measured against Massive across the boundary: raw divergence grew 2.91x, but volatility grew 2.34x, and normalised divergence changed only 1.25x (9.0% of bar range before, 11.2% after). **The weekday series is sound throughout.** Without a second independent series this would have remained an open doubt.

**MASSIVE AS CALENDAR ORACLE — a second, independent reason to keep it.**

We had committed to building a trading calendar from scratch, with no way to check it beyond reasoning. Massive **demonstrably implements the correct one**: zero Saturday bars across 2024–2026, Friday's last bar closing 21:00 UTC = 17:00 New York, Sunday opening 21:00 UTC = 17:00 New York, weekdays 93 of 96 bars with the missing 45 minutes at the rollover.

That converts calendar correctness from an assertion we reason about into **a testable proposition with a free reference implementation**. Where our calendar and Massive's bar coverage disagree, one of them is wrong, and we get an event rather than a silent divergence. This is independent of reconciliation and would justify keeping Massive on its own.

It also gave C2 its **third independent confirmation** — TradingView, Twelve Data's pre-2025 history, and Massive's current data all place the daily boundary at 17:00 America/New_York.

**Why not Massive as the feed.** Two years, permanently, under the no-paid-data constraint — and its free intraday access contradicts its own published pricing page, so it is an entitlement that could be withdrawn without notice. Excellent as a check; too thin and too uncertain as the spine.

**Why not EODHD.** Its free tier serves end-of-day only and one year of history, so it cannot verify its own distinguishing claim of deep clean history. **A provider that requires payment before evaluation is disadvantaged on process grounds**, separately from its data. Its \$29.99 is deferred with an explicit trigger, not dismissed.

**Why not cTrader / IC Markets.** Protobuf or JSON over TLS TCP, no REST endpoint for historical data, 5 historical requests per second. Near worst-case against the fixture criterion. Repurposed as an optional execution-venue comparator for T1.9, where a slow awkward protocol is acceptable off the hot path.

---

### The Phase 9 arithmetic, and its honest status

The load-bearing argument for depth is that Phase 9 slices results by four grades and three sessions — twelve cells — and small cells are where fake precision comes from.

At an assumed **2–3 setups per week**, 6.6 years gives roughly 700–1,000 setups, so 60–80 per cell; two years gives 200–300, so 17–25 per cell.

**THAT SETUP RATE IS AN ESTIMATE, NOT A MEASUREMENT. Nothing has measured it.** The detector does not exist until Phase 4.

The *direction* is safe regardless — 3.3x more data helps at any setup rate, and cannot hurt. But **the specific 60–80 per cell figure must not be quoted as fact.** Revise it once Phase 4 reports a real detection rate; if the true rate is far lower, even 6.6 years may not support twelve-cell segmentation, and Phase 9's analysis plan needs revisiting rather than the provider choice.

---

### Consequences

- The trading calendar (T1.5) becomes load-bearing infrastructure, not a filter. Roughly 31% of Twelve Data's returned bars fall outside real market hours.
- **24/7 gold is an industry representation, not a vendor defect.** Twelve Data and EODHD both emit weekend gold bars. The calendar decision is correct for the whole category, not a workaround for one vendor.
- T1.6's regression guard cannot compare our 1D aggregate against the provider's own daily candle — a 24/7 series emits Saturday and Sunday "days". It compares against the calendar.
- Backfill is cheap: 6.6 years in **47 requests, ~6 minutes**, within a free tier of 800 credits/day and 8/minute.
- DXY and US Treasury yields are **not settled by this ADR**. ADR-005's approach (synthesise DXY from component pairs; US Treasury's own XML feed for yields) is untouched and needs re-checking against Twelve Data's symbol coverage.

---

### Process lessons this re-evaluation cost, recorded so they are not rediscovered

1. **Check regional availability first.** It is the cheapest check and the one that invalidates everything downstream.
2. **Fetch instrument metadata before any prices.** `symbol_search` returns `exchange_timezone: "Australia/Sydney"` and a venue documented as 24/7 — neither appears in a `time_series` response. Both T1.1 anomalies were explained by that one call. **The UTC+10 default was never undocumented; we had not looked it up.**
3. **Measure before committing.** Every important number here contradicted or refined its documentation: "since 1980" applies to daily bars only; Massive's free tier serves intraday its pricing page denies; EODHD's free tier serves less than implied.
4. **An absence result needs a positive control.** Eight recorded instances of checks that passed while testing nothing or testing the wrong thing.
5. **When a ratio lands near a threshold, find the confound.**

---

### REVERSAL CONDITIONS

**A decision recorded without its reversal conditions gets re-litigated from scratch.** Each of these is monitorable.

| Trigger | Detection | Response |
|---|---|---|
| **Twelve Data changes its WEEKDAY series** the way it changed weekends in 2025 | **T1.9 reconciliation against Massive.** Normalised divergence is 9–11% of bar range today; a sustained move well outside that is the signal. This is precisely what the reconciliation job is for | Re-run the cross-provider comparison. If the weekday instrument has changed, Twelve Data's pre-change history is no longer continuous with live and the feed must be reconsidered |
| **Phase 9 proves 6.6 years too short** | Cell counts in the segmented analysis, once Phase 4 gives a real setup rate | Pay EODHD's \$29.99 for one month and run the measurement blocked in T1.1 — 17-year Saturday sweep, real intraday depth, 1-minute backfill cost weighed against that depth |
| **Massive withdraws its undocumented free intraday** | A 403 `NOT_AUTHORIZED` from the reconciliation job | **This costs the oracle and the reconciliation source at once**, which is why it is listed. Fall back to cTrader for execution-venue reconciliation, and the calendar loses its reference implementation — it must then be validated against a static published calendar instead |
| **Twelve Data's free tier stops covering our needs** | 429s, or credit exhaustion against 800/day | Current usage is ~96 polls/day against 800. Substantial headroom; revisit only if polling frequency changes |
| **A Thailand-availability change** at any provider | An authenticated call failing with an entitlement or region error | Re-run the T1.1 gate. This is the failure that produced this ADR |

Nothing else reopens this. Not price, not a marketing depth figure, not a new provider appearing — absent one of the triggers above, the decision stands.

---

## ADR-009: The worker runs `tsx` in production, not a compiled artefact

**Date:** 2026-08-28
**Status:** **Accepted.**
**Task:** T0.10
**Related:** ADR-006 (extensionless imports), STATUS.md obligations 17 and 24

---

### Decision

**`apps/worker` ships and runs its TypeScript source under `tsx`. There is no build step and no compiled artefact.**

Railway start command: `pnpm --filter @karatx/worker start`, which is `tsx src/index.ts`.

`tsx` moves from `devDependencies` to `dependencies` in `apps/worker`.

---

### Reasoning

**This is one long-lived process that restarts rarely, where boot time and image size are irrelevant. Bundling machinery buys nothing here, so it is not worth its cost.**

That is the whole justification. The worker is a singleton that starts once and runs for days. There is no cold-start path, no per-request latency, no horizontal scaling, no image-size pressure. A build step would add configuration, a second failure mode, and a source-map story, in exchange for a faster boot that nobody is waiting on.

**A NOTE ON WHAT IS NOT THE REASONING.** Choosing this keeps every existing measurement of the worker's crash and boot behaviour valid, because they were all taken under `tsx`. **That is a consequence, not a justification.** Selecting a production runtime in order to preserve prior measurements would be backwards, and a future reader who thought that was the argument would be right to distrust the decision. If bundling were otherwise correct, the right move would be to bundle and re-measure.

---

### Alternatives considered

**1. `tsc` per package, then `node dist/index.js`.** Rejected, and it is worth recording why it is not merely more work.

Every `packages/*` is consumed as TypeScript SOURCE — its exports point at `./src/index.ts`. Compiling the worker alone does not work, because its imports resolve to `.ts` files. Making `tsc` work would mean rewriting every package's exports **and adding `.js` extensions to relative imports** — which directly contradicts **ADR-006**, adopted because Turbopack cannot resolve a `.js` specifier pointing at a `.ts` file. This route reopens a settled decision across the whole repository.

**2. Bundling with esbuild or tsup.** Rejected for now, but **kept open** — a bundler resolves specifiers itself, so it does **not** conflict with ADR-006. This is the route to take if the reversal condition below is met.

It would close STATUS.md obligation 24 and T0.9's partial "build" criterion properly, which is a real benefit. Against that: new tooling and configuration at the end of Phase 0, and **every measurement of the worker's crash and boot behaviour must be redone** — six boot-failure modes, the pino crash-flush result, and the SIGTERM path — first under plain `node` locally, then again on the platform. Two rounds of re-measurement rather than one.

---

### Consequences

- **Obligation 24 resolves as a DECISION rather than a gap.** "The worker has no build artefact" stops being an omission and becomes a recorded choice. T0.9's "build" criterion stays partial for the worker, by intent.
- **`tsx` is now production dependency surface**, not merely a development tool. It was already in the tree via `drizzle-kit`, so this widens exposure rather than creating it.
- **Boot transpiles the import graph.** Observed at roughly a second in the integration suite's spawns. Irrelevant for a process that starts once.
- **Obligation 17 still stands.** The runtime now matches what was measured, but the PLATFORM does not: Railway may wrap or supervise the process differently. Exit codes and log flushing must still be re-measured there. This decision reduces that to one round instead of two; it does not remove it.
- **The pino crash-flush result keeps its scope limit.** Proven under `tsx` writing to stdout with no transport. Adding a pino transport would move writing to a worker thread and change flush behaviour, and would need re-measuring.

---

### REVERSAL CONDITION

**Bundle with esbuild or tsup if any of these becomes true:**

- boot time or memory becomes a constraint — for instance if the worker is ever restarted frequently, or run as a scheduled job rather than a daemon;
- a slim production image is needed, for cost or for supply-chain reasons;
- `tsx` becomes unmaintained, or its runtime dependency surface becomes a concern;
- the build artefact is wanted as a first-class thing CI verifies, rather than obligation 24 resting on a decision.

**The route stays open**: ADR-006 does not obstruct bundling, only `tsc`. Reversing means adding a bundler and **re-measuring the worker's crash and boot behaviour under `node`** — the six failure modes, the pino flush, and the SIGTERM path — before deploying it.

---

# Retrospective ADRs (001, 002, 004)

**The three ADRs below were written on 2026-08-28, during T0.10, about decisions
taken weeks earlier. They are NOT contemporaneous with the decisions they
record.**

**Every claim is marked by its source**, because a retrospective ADR that
confabulates its own reasoning is worse than none — it launders a guess into a
decision record, and a later session cannot tell which parts are safe to rely on.

| Marker | Meaning |
|---|---|
| **RECONSTRUCTED** | The reasoning is recorded somewhere — a commit message, an existing document, a code comment. Cited. |
| **INFERRED** | The reasoning is not recorded, but the artefact makes it evident. Stated as inference. |
| **UNKNOWN** | The decision was made and the reasoning is not recoverable. Said plainly, and left. |

**An ADR with UNKNOWNs is more useful than one with plausible paragraphs.**

---

## ADR-001: One repository, two deployable processes

**Date of decision:** ~2026-08-25 (T0.1)
**Date written:** 2026-08-28 (T0.10, retrospective)
**Status:** Accepted, in force.

### Decision

One repository using pnpm workspaces, containing **two deployable processes** —
`apps/web` (Next.js dashboard) and `apps/worker` (plain long-lived Node) — plus
shared `packages/*`. On Railway, two services plus Postgres.

### Reasoning

**RECONSTRUCTED** — `SPEC-AUDIT.md` finding **H6**, "Next.js alone is the wrong
runtime shape for the monitoring core", which recommends exactly this and marks
it *"ADR-worthy, propose accepting now"*. Restated in `ARCHITECTURE.md` §D:

> "Next.js is a request-oriented framework; the monitoring core is a long-lived
> singleton process holding a price stream and a scheduler. Putting them in one
> service means a dashboard deploy drops your feed, and it makes the engine hard
> to test in isolation (which NFR-9 forbids)."

Two independent reasons, both recorded: **deployment coupling** (a dashboard
deploy must not drop the market feed) and **testability** (NFR-9).

**RECONSTRUCTED** — packages export TypeScript **source** rather than built JS.
From the T0.1 commit (`997a03b`): *"so typecheck needs no prior build"*, with
the consequences named in advance — *"T0.7 will need transpilePackages in the
Next.js config, T0.8 will need tsx or a bundler to run the worker."* Both
happened. See ADR-009 for how T0.8's half was settled.

**UNKNOWN** — **why pnpm specifically, rather than npm or Yarn workspaces.**
`ARCHITECTURE.md` records only *"Workspaces are needed for the monorepo shape
below"*, which justifies **a** workspace tool, not this one. npm and Yarn both
offer workspaces. No comparison is recorded anywhere.

*Should this be re-made rather than documented?* **No.** It is load-bearing —
the `workspace:*` protocol, `pnpm-workspace.yaml`, and the `allowBuilds`
policy all depend on it — and no problem has been observed in nine tasks.
Reviewing a working choice with no identified defect would cost a great deal and
decide nothing. Recorded as unknown and left.

### Consequences

- Two Railway services from one repository, differentiated by build and start
  commands. See `DEPLOYMENT.md`.
- `packages/core` may not import `@karatx/db` or `@karatx/providers` —
  F.3 invariant 1, enforced by ESLint since T0.2 and proven running in CI by the
  T0.9 deliberate-red exercise.
- Watch patterns are needed per service, or one push redeploys both.

---

## ADR-002: PostgreSQL with Drizzle ORM

**Date of decision:** ~2026-08-26 (T0.4, and earlier in `ARCHITECTURE.md`)
**Date written:** 2026-08-28 (T0.10, retrospective)
**Status:** Accepted, in force.

### Decision

**PostgreSQL 17** as the only datastore, accessed through **Drizzle ORM** with
Drizzle-generated SQL migrations.

### Reasoning

**RECONSTRUCTED** — PostgreSQL, from `ARCHITECTURE.md`'s stack table:

> "Volume is small — five years of 15M candles is roughly 130k rows. Postgres
> handles this without any special tooling. Explicitly reject time-series
> databases as premature."

A sizing argument with a number in it, and an explicit rejection of the obvious
alternative.

**RECONSTRUCTED** — Drizzle, from the same table:

> "Thin, SQL-shaped, good TypeScript inference, migrations are plain SQL you can
> read. Right fit."

**INFERRED** — *why not Prisma or Kysely.* No comparison is recorded. "Thin" and
"migrations are plain SQL you can read" read as a contrast with heavier ORMs that
own their migration format, but that is inference from the wording, not a
recorded deliberation.

**RECONSTRUCTED** — prices stored as `NUMERIC`. `ARCHITECTURE.md` records
that float64 represents gold prices safely but that **comparisons** are where
floats bite, and mandates `NUMERIC` storage plus a single
`priceCompare(a, b, tick)` helper.

**RECONSTRUCTED** — three local-Postgres choices, from the T0.4 commit
(`62746ce`): pinned to `postgres:17` and verified as 17.11; bound to
`127.0.0.1` only, because a bare `5432:5432` publishes on all interfaces
and that machine already ran exposed containers; and `--locale=C`, because
Postgres sorts text by database collation and a host-dependent locale would make
ordering machine-dependent, which NFR-12's byte-for-byte reproducibility forbids.

**UNKNOWN** — whether any other database was seriously considered. The stack
table presents PostgreSQL as a confirmation rather than a comparison.

*Should this be re-made?* **No.** The sizing argument is sound and checkable, and
the rejection of time-series databases is explicit. Nothing is missing that would
change the answer.

### Consequences

- Migrations are immutable once applied (ADR-003), enforced in CI since T0.9.
- Drizzle does **not** detect tampering with an applied migration — established
  experimentally in T0.4 — which is why the CI check exists at all.
- `drizzle-kit` pulls in a deprecated `@esbuild-kit/*` chain carrying an
  old esbuild. Assessed at T0.9 as not exploitable here; see STATUS.md.

---

## ADR-004: Structured logging and a classified error model

**Date of decision:** ~2026-08-26 (T0.5)
**Date written:** 2026-08-28 (T0.10, retrospective)
**Status:** Accepted, in force.

### Decision

**Pino**, emitting JSON to stdout in every environment, with three independent
layers of secret redaction and correlation IDs carried through
`AsyncLocalStorage`. Errors are classified by an **eight-category taxonomy**
in `packages/core`, each class declaring a default **handling policy**.

### Reasoning

**RECONSTRUCTED** — Pino, from `ARCHITECTURE.md`'s library table, which names
the alternatives it was chosen over:

> `pino` — "Structured JSON logging with redaction. Required by NFR-6."
> Alternatives: "`console.log` (unstructured, no redaction), Winston
> (heavier)."

**RECONSTRUCTED** — JSON in development as well as production, from the
`createLogger` comment: identical output everywhere means a log line
reproducing a problem locally is byte-comparable with one from the deployed
service, and it avoids a pretty-printing transport that exists on only one of
them.

**RECONSTRUCTED** — the logger deliberately does **not** write to
`system_events`, though that table existed. From the same comment: a logger
that depends on the database would fail exactly when the database is what broke,
and logging a database error would attempt a database write.

**RECONSTRUCTED, with a provenance caveat already recorded in the code** — the
eight categories are taken verbatim from `BUILD-PLAN.md`, but the **mapping of
category to handling policy is DERIVED**, not transcribed. `BUILD-PLAN.md`
asks for policies "per §23" of a Master Engineering Prompt that was not in the
repository at the time. `packages/core/src/errors.ts` says so at the top and
cites a justification per class. That note should not be "corrected" into
claiming it transcribes §23.

**RECONSTRUCTED** — `DatabaseError` defaults to `alert` rather than
`retry`, from the T0.5 commit (`0654511`): the class covers both a dropped
connection and a constraint violation, and retrying a constraint violation merely
repeats it.

**UNKNOWN** — why **eight** categories rather than some other number. The list is
recorded; no deliberation about its granularity is.

*Should this be re-made?* **Not yet, but it is under observation.** T0.8 was the
taxonomy's first real consumer and found that **both** boot errors had to
override the class default — policy turns out to be a property of the situation,
not only of the class. STATUS.md records a concrete threshold: if the override
rate across raise sites exceeds roughly a third by T1.7, the defaults are
decoration and policy should move to the raise site. That is the review trigger.

### Consequences

- Every error line carries `category` and `policy`, so a log says how a
  failure should be handled rather than only that one occurred.
- Redaction is three layers: field-name, secret-value scrubbing, and message
  rewriting. Layer 3 needs the actual secret passed in, which is why
  `.reveal()` appears at exactly one place per entry point.
- Anything using `console.log` directly bypasses all three. Recorded in
  STATUS.md as an honest gap since T0.3.

---

## ADR-011: Local-only hosting for Phases 1–5

**Date:** 2026-08-30
**Status:** **Accepted.**
**Task:** T0.10
**Related:** ADR-001 (two processes), ADR-003 (migration policy), ADR-009 (`tsx` in production), DEPLOYMENT.md (cost), STATUS.md — "A COST MODEL is an architectural constraint"

---

### Decision

**KaratX runs entirely on one local machine for Phases 1–5. Postgres in Docker, `web` and `worker` started by hand. Nothing is deployed and nothing is reachable from the internet. Cost: zero.**

The Railway work stands as preparation, not as infrastructure. **Revisit at Phase 6.**

---

### Reasoning

**Three reasons, in the order they actually weighed.**

**1. There is one user, and no reason to be reachable.** A hosted deployment's benefit is availability to others and availability when the machine is off. The first is unwanted at this stage; the second does not matter until Phase 6.

**2. $9–13/month for a system that does not yet do anything.** Measured against what exists today — a schema, a health endpoint and a CI pipeline — that is paying for a property nothing currently needs.

**3. THE DECIDING REASON: cost pressure was about to force an architectural merge.** The Free tier includes $1/month of usage; two always-on services plus Postgres is $9–13. The obvious way to close an order-of-magnitude gap is to run one service instead of two — which would have reversed ADR-001 on financial grounds.

ADR-001 split `web` and `worker` because a dashboard deploy must not drop the market feed and because the feed must be a singleton. **Both reasons still hold, and both would have been surrendered.** Railway's zero-downtime deploys overlap containers, so a merged service would run two feed instances briefly on every deploy — duplicate writes and duplicate alerts, on precisely the singleton the ADR exists to protect.

**Local hosting removes the pressure without reversing the engineering decision.** That is the point of this ADR. Two processes are preserved, and preserved for their original reasons rather than by an accounting accident.

---

### ACCEPTED CONSEQUENCES

**These are costs we are choosing to pay. None of them is solved.**

#### 1. The feed only runs while the machine is awake

Phase 1 is a continuous feed. Sleep, shutdown, reboots and closing the lid all produce **genuine gaps in collected data**. T1.5's trading-calendar authority will classify them correctly, which means **we will manufacture the data-quality events the system exists to detect.** Every one will be real, and none will be a provider fault.

**What this does to Phase 9's backtest, honestly:**

- **The gaps are NOT RANDOM.** They correlate with when the operator sleeps, so they fall on the same hours of the trading day — one session systematically under-sampled. This biases the sample rather than merely shrinking it, and a backtest run over it would silently under-represent whatever happens in those hours.
- **Indicator warm-up spans gaps invisibly.** An EMA computed across a fourteen-hour hole produces a number that looks entirely ordinary. Nothing about the output announces the discontinuity.
- **Price data is REPAIRABLE by backfill.** Historical bars can be fetched after the fact and reconciled, which is what T1.5 and the reconciliation work are for. With backfill, the bar series can be made continuous and honest.
- **Latency data is NOT repairable, and this is the sharp edge.** A backfilled bar is confirmed long after it occurred. Our `occurred_at` / `confirmed_at` model makes that visible rather than hiding it — which is the model working correctly, and also the reason **anything whose behaviour depends on WHEN WE LEARNED SOMETHING cannot be backtested from a gapped local feed.** Detection latency, alert timeliness, and any rule sensitive to confirmation delay are unbacktestable over gap-repaired periods.

**The practical consequence for Phase 9: the backtest must be able to distinguish live-collected bars from backfilled ones, and must exclude gap-repaired windows from any latency-sensitive measurement.** If that distinction is not in the schema by then, this decision will have quietly corrupted the evaluation. It is an obligation created here, not a risk noted here.

#### 2. No alerts away from the desk

**This is Phase 6's entire premise**, so the revisit trigger is not arbitrary — Phase 6 is the first phase whose value cannot be demonstrated locally at all.

#### 3. The deployment work is deferred, not removed — and gets harder

By Phase 6 there will be more schema, more configuration, a Telegram token to hold, and more to go wrong on first deploy. Two specific decay risks:

- The Railway IaC SDK's own README says it "is in beta and there will be breaking changes". `railway.ts` may not work by Phase 6.
- Railway's Config as Code has a hard cutoff of **2026-12-01**, so the fallback route may be gone as well.

**DEPLOYMENT.md's settings table is the durable artefact**, not `railway.ts`. It records every value and can be applied by hand on any platform. That was already its stated purpose; this decision makes it load-bearing.

---


---

### Observed 2026-08-30 — one measured cost point, and what it does NOT show

The figures above are estimates. Exactly one real measurement exists, taken
during the T0.10 teardown:

| | |
|---|---|
| Trial credit | $4.92 |
| ~24 hours later | $4.91 |
| Running | one idle Postgres and its volume, nothing else |

**About $0.01/day — roughly $0.30/month — for an idle Postgres plus volume.**
That is an order of magnitude below the $3–5/month this ADR estimates for the
same component.

**What it establishes:** the $9–13/month figure is unvalidated and probably
conservative. Treat it as an upper bound rather than a forecast, and do not
quote it as though it were measured.

**What it does NOT establish, and the distinction matters:**

- It is the **SUM** of compute and storage for one service. It cannot separate
  them, so it does not show that compute dominates storage — only that both
  together are small while the database is idle.
- **"Idle" is doing the work.** Phase 1's worker polls and writes continuously
  and `web` serves requests. Nothing here says what an ACTIVE service costs, and
  active is the only case that matters.
- A volume holding years of candles is a cost that **rises over time**. One day
  of an empty volume says nothing about that trajectory.

**Re-measure at T6.1 rather than trusting either number.** Twenty-four hours of
real usage with all three services running replaces both the estimate and this
data point.

### The revisit trigger

**Phase 6 — Telegram alerting.** Not a date, and not "when it feels slow".

The reasoning, recorded so a future reader does not have to reconstruct it: an alerting system that only fires while its operator is at the desk is not an alerting system. Until Phase 6, everything KaratX does is either collection (repairable by backfill) or analysis (re-runnable at any time). **Phase 6 is the first capability whose value is destroyed by downtime rather than merely delayed by it.**

At that point re-open: hosting cost against current usage, whether `web` needs hosting at all or only `worker`, and whether the Railway configuration in DEPLOYMENT.md still applies.

---

### Alternatives considered

**1. Hosted on Railway Hobby, $9–13/month.** Rejected for now on the reasoning above — not because it is wrong, and it is the expected outcome at Phase 6.

**2. Merge `web` and `worker` into one service.** Rejected on both engineering and arithmetic grounds. Railway bills resources, not services, so merging saves one Node runtime's baseline footprint — roughly $1–2/month — **not** the $5 the tier price suggests. The trade was never "reverse ADR-001 for $5/month"; it was "surrender the singleton guarantee for about $1.50/month".

**3. Worker hosted elsewhere, on another provider's free tier.** Rejected on non-financial grounds. It forces `DATABASE_PUBLIC_URL` and puts the database on the public internet; it adds 20–100 ms to every write on a feed making frequent small ones, invalidating timing assumptions in reconciliation and idempotency; it doubles the operational surface for a one-person project. **And the free tiers that would host it are the ones that sleep** — reintroducing, on a platform where it is not opt-in, the exact failure Railway's opt-in Serverless setting allowed us to avoid.

---

### What this does NOT change

- **ADR-001 stands.** Two processes, for their original reasons.
- **ADR-003 stands.** Migrations remain a deliberate step, run by hand rather than by a pre-deploy container. The property being protected — no application process running while migrations apply — is easier to guarantee locally, not harder.
- **ADR-009 stands**, and its `tsx` provision must still be applied.
- **`packages/core` performs no I/O.** Unaffected, and the reason the backtest can be honest at all.

---

## ADR-012: The `Tick` contract is deferred, not forgotten

**Date:** 2026-09-02
**Status:** **Accepted.**
**Task:** T1.2 (closing its one unmet criterion) / T1.3
**Related:** ADR-008 (Twelve Data, 15min bars), BUILD-PLAN T1.2, STATUS.md — "T1.2 is SUBSTANTIALLY COMPLETE"

---

### Decision

**No `Tick` schema is written until a Phase 1 source or consumer for tick data exists.** T1.2's acceptance criterion naming `Tick` is answered by this deferral rather than left open.

**Reopening trigger, explicit:** the first of — a provider adapter that receives tick or quote data, or a `packages/core` consumer that requires sub-bar granularity. Whichever arrives first reopens this ADR; neither exists in Phases 1–5 as planned.

---

### Reasoning

**ADR-008 selected 15-minute bars from Twelve Data's `/time_series`. There is no tick source anywhere in the architecture**, and `grep` for a `Tick` consumer across the repository finds nothing.

**A contract nothing imports will be wrong by the time something does.** The shape of a tick — whether it carries bid and ask, a single mid, a size, a provider sequence number — is determined by the provider that supplies it. Guessing that shape now means either migrating it later or, worse, keeping a wrong contract because it is already there.

**It would also make a criterion look met when it is not.** T1.2 requires schemas "defined once and **imported everywhere**". A type with no importer cannot satisfy that clause, but its presence in the file would read as if it had.

**This is the reasoning ADR-011 applies to deployment**: defer with a recorded trigger, rather than build against a requirement that does not exist yet.

---

### ACCEPTED CONSEQUENCES

- **T1.2's criterion is closed by decision, not by delivery.** Anyone auditing the criterion list will find `Tick` named in BUILD-PLAN and absent from the code. This ADR is the answer to that question, and STATUS.md points at it.
- **If a tick source arrives mid-phase, the contract gets written then, under time pressure.** Accepted, because the alternative is writing it now with strictly less information.

---

## ADR-013: Candle identity, conflict resolution and null comparison

**Date:** 2026-09-02
**Status:** **Accepted.**
**Task:** T1.3
**Related:** ADR-002 (Postgres + Drizzle), ADR-008 (decimal text), ARCHITECTURE.md F.5 and F.3 invariant 3, BUILD-PLAN T1.3/T1.4/T1.5, obligations 31 and 38

---

### Decision

**1. Primary key: `(instrument_id, provider_id, timeframe, open_time)`.** Composite and natural. No surrogate `id`.

**2. The unique constraint IS the primary key.** No second unique index over the same columns.

**3. At most one forming bar per series**, enforced by a partial unique index:

```sql
CREATE UNIQUE INDEX candles_one_forming_idx
  ON candles (instrument_id, provider_id, timeframe)
  WHERE NOT is_final;
```

**4. Two ingestion timestamps:** `ingested_at timestamptz NOT NULL DEFAULT now()` — first arrival, never rewritten — and `updated_at timestamptz NOT NULL DEFAULT now()`, advanced **only when a column value actually changes**. Set explicitly in SQL. No triggers.

**5. Identity is exact `NUMERIC` equality**, never text equality and never float. Comparison uses `IS DISTINCT FROM` on every compared column.

**6. Six conflict cases**, branching on the **stored** row's `is_final`.

**7. The outcome is a typed value defined in `packages/contracts`.** T1.3 writes no event row.

---

### Reasoning

#### The primary key

That tuple **is** the bar's identity. A surrogate `id` would permit two rows claiming to be the same bar with different prices, both valid — the corruption the idempotent upsert exists to prevent — and would move the guarantee out of the database, which §9 forbids.

`provider_id` is in the key because candles are per-provider, not canonical: T1.9 reconciles Twelve Data against Massive, so both providers' bars for one instrument and timeframe must coexist as distinct rows.

**Column order is deliberate.** Three equality-filtered columns first, the single ranged column last, because a B-tree range-scans only on its trailing column. The dominant query — "last N final bars for instrument+provider+timeframe, newest first" — becomes a backwards index scan with no sort step.

**`provider_id` is second rather than last, and that is a bet with a known shape.** Every Phase 1 reader supplies a provider: T1.4 backfill, T1.5 validation, T1.7 live feed. T1.9 reconciliation is the only multi-provider reader, and under this ordering it would use the `instrument_id` prefix and then scan. **Those access patterns are known from BUILD-PLAN prose, not from code — the engine that queries this table does not exist yet.** The ordering is therefore chosen on the asymmetry of being wrong: a missing index is a forward migration and cheap, while a wrong primary key means rewriting the largest table in the system.

#### Indexes, separated by confidence

**Confident:** the primary key's index, and nothing else for read performance. It fully serves the dominant query.

**Confident about omitting** — an index on `open_time` alone, which serves "all instruments at time T" (a query that does not exist in Phase 1) and would cost a write on every insert of a ~161,000-row backfill; and a separate `provider_id` index, since both foreign keys are `ON DELETE no action` against reference tables that are never deleted from.

**Speculative, and deliberately NOT created:** a reconciliation index for T1.9. It is named here so that a later session adds it against a measured query plan rather than rediscovering the need from scratch.

**Note a reversal:** an earlier STATUS.md draft proposed a partial `WHERE is_final = false` index for *lookup*. That was wrong — at most one forming bar exists per series and every access supplies the full three-column equality prefix, so the primary key already answers it in one descending scan. The partial index in decision 3 exists for **correctness**, not for speed.

#### Prices: exact values, normalised text

`NUMERIC(12,5)` **pads to the declared scale**: `'8.1'` is stored and returned as `'8.10000'`. This is asserted by an existing test, `numeric-precision.integration.test.ts`. Two consequences follow.

**The useful one:** `'4635.06'` and `'4635.060'` are the same stored value *and* the same returned text, so a formatting-only difference is unrepresentable and cannot raise a conflict. That requirement is satisfied by the storage layer rather than by comparison logic.

**The one that must be recorded honestly: ADR-008's "preserve the decimal text as received" is NOT fully honoured at the storage layer, and that is accepted here.** The provider's original decimal rendering is unrecoverable once stored. It is accepted because:

- **NUMERIC pads rather than truncates.** The *value* is exact; only the rendering differs. Nothing numeric is lost.
- **ADR-008 itself says not to reconstruct full precision**, because Twelve Data supplies mid prices that were never precise. A rendering carries no information the value lacks.
- **`raw_datetime` earns its column and prices do not.** A timezone mis-parse is both **unrecoverable and undetectable** after the fact — which is the entire reason that column exists. A padded decimal is neither: the value is intact and any difference is visible.
- **Four extra text columns on ~161,000 rows per year**, to preserve a rendering that carries no information, is the wrong trade.

**Do not "fix" this by adding a `raw_ohlc` column.** It was considered and rejected here, with reasons.

#### Null comparison — why `=` is wrong

`volume` is nullable and the contracts file records that **0 and null are different facts**. `bid` and `ask` are null for Twelve Data today.

Under SQL, `null = null` is UNKNOWN. A rule written with `<>` therefore fails in **both** directions at once: null-vs-null yields NULL and stays quiet by accident, and `null <> 123` *also* yields NULL — so **a real volume arriving where there was none would be invisible.** A null-volume bar is the ordinary case for spot gold, so this is the common path, not an edge case.

`IS DISTINCT FROM` returns `false` for null/null and `true` for null/123. Applied per column:

| Column                         | Nullable | Comparison                                          |
| ------------------------------ | -------- | --------------------------------------------------- |
| `open`, `high`, `low`, `close` | no       | `IS DISTINCT FROM` (identical to `=` here; uniform) |
| `volume`                       | **yes**  | `IS DISTINCT FROM`                                  |
| `bid`, `ask`                   | **yes**  | `IS DISTINCT FROM`                                  |
| `raw_datetime`                 | no       | **excluded** — recorded separately, not a conflict   |
| `is_final`                     | no       | branches the rule; not compared                     |

Incoming decimal strings are cast `::numeric`, so the comparison uses NUMERIC semantics rather than text.

#### The six cases

Branching on the **stored** row's `is_final`, because the forming bar legitimately changes on every poll. A rule that compared values without that branch would either raise a false event on every poll of the current bar, or silently overwrite finalised history.

| Stored    | Incoming                                       | Behaviour                          | Event         |
| --------- | ---------------------------------------------- | ---------------------------------- | ------------- |
| non-final | non-final                                      | update the forming bar             | none          |
| non-final | final                                          | update and finalise                | none          |
| final     | identical                                      | no-op; `updated_at` unchanged      | none          |
| final     | different value                                | **reject**; original preserved     | conflict      |
| final     | non-final                                      | **reject**; do not un-finalise     | conflict      |
| final     | `null → value` on `volume` / `bid` / `ask`     | **enrichment**; apply              | informational |

**Enrichment is `null → value` ONLY, and the asymmetry is the point.** `value → null` is a provider losing data, and it rejects like any other conflict. Without that asymmetry stated explicitly, the sixth case becomes a hole through which real data loss passes as an upgrade.

Enrichment exists at all because `provider_id` is in the primary key, so **changing provider creates new rows rather than conflicts.** The only way this case arises is a tier change within one provider that begins supplying bid/ask on a series already stored. Treating that as mass historical corruption would be wrong; so would overwriting a non-null price with a different non-null price.

#### Why T1.3 writes no event row

`data_quality_events` does not exist as of 2026-09-02 (T1.5 creates it). BUILD-PLAN assigns it to **T1.5**, yet makes raising such an event a **T1.3** acceptance criterion. Rather than have T1.3 define a table T1.5 owns, the upsert returns a typed outcome — `applied | noop | conflict | rejected | enriched` — and the caller decides what to persist.

**T1.5's criteria require detection logic to be pure and to live in `packages/core`.** A minimal table at T1.3 would mean the schema is designed twice, by two tasks with different information, and the second design would inherit the first's guesses.

**Condition, and it is load-bearing: the outcome type is defined once in `packages/contracts` and CONSUMED by T1.5, never redefined there.** A second definition is exactly the drift F.1 exists to prevent — two implementations of one concept, free to diverge silently.

`system_events` is not the home for this either: its own schema comment states that nothing in it is a derived market fact.

---

### ACCEPTED CONSEQUENCES

**1. The forming-bar index makes finalisation order-sensitive, and can stall the feed.** Bar N+1 cannot be inserted while bar N is still non-final, so ingestion must finalise N and insert N+1 in **one transaction**.

**This is not a free win.** If finalising bar N fails, bar N+1 **cannot be inserted at all** — the feed stalls rather than degrading, and every subsequent bar for that series is blocked until the stuck forming bar is resolved. That may well be the right behaviour for a system whose purpose is to refuse corrupt history, but it is a consequence we are choosing, not a property we get for free. **T1.7 must know the feed can be blocked by a stuck forming bar, and must alert on it rather than retry silently.**

**2. ADR-008's decimal-text preservation is partially unmet at the storage layer**, as set out above. Recorded so that it is not later rediscovered and filed as a defect.

**3. T1.3 cannot satisfy its own BUILD-PLAN criterion as written.** "Raises a data-quality event" becomes "returns a typed outcome that the caller persists". BUILD-PLAN is amended to say so, rather than the criterion being quietly reinterpreted.

**4. `updated_at` is only as truthful as the upsert's `WHERE` clause.** If a later change drops the distinctness guard from `DO UPDATE`, the column silently degrades from "when this row last changed" into "when we last saw it", and nothing fails. The test asserting that a no-op leaves `updated_at` untouched is what protects it.

**5. THE ENRICHMENT CASE HAS NO REAL PRODUCER, and its test is therefore synthetic.** `bid` and `ask` are null on every Twelve Data bar today, so the `null → value` path has no natural source: the test must construct the row itself. **A passing test is evidence about the RULE, not about the PATH.** Nothing has ever exercised this case with data a provider actually sent, and until something does, "enrichment works" is a statement about a fixture.

**What would first exercise it for real:** a Twelve Data tier change that begins supplying bid/ask, or a second provider supplying them — noting that a second *provider* creates new rows rather than enrichment, since `provider_id` is in the primary key, so it would have to be bid/ask arriving on a series already stored under the same provider. Whichever happens first is the moment to check this rule against reality rather than against the fixture.
