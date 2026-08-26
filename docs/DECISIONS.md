# Architecture Decision Records

Decisions are numbered, dated, and immutable once accepted. To change one, write a new ADR that supersedes it; do not edit history.

| ADR | Title | Status | Date |
|---|---|---|---|
| ADR-001 | Monorepo with separate `web` and `worker` processes | Accepted (pre-recorded, to be written in T0.10) | — |
| ADR-002 | PostgreSQL + Drizzle | Accepted (pre-recorded, to be written in T0.10) | — |
| **ADR-003** | **Migration policy** | **Accepted** | **2026-08-25** |
| ADR-004 | Logging and error model | Accepted (pre-recorded, to be written in T0.10) | — |
| **ADR-005** | **Market data provider** | **Accepted, conditional** | **2026-08-25** |
| **ADR-006** | **Extensionless relative imports** | **Accepted** | **2026-08-26** |
| **ADR-007** | **TypeScript pinned to 6.x** | **Accepted** | **2026-08-26** |

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

- Applying is a manual step someone must remember. On Railway (T0.10) it must be wired as a pre-deploy/release command, **not** into the service start command — and `[VERIFY]` how Railway expresses that, since `ARCHITECTURE-AND-STACK.md` U-7 lists it as unconfirmed.
- Immutability is unenforced until the T0.9 check exists.
- A migration that is slow or takes heavy locks will block a release. Not a concern at Phase 0's two tables; it becomes one around the Phase 1 candle tables and their indexes.
- OPS-7 (backup with a *tested* restore) is untouched by this ADR and remains open for T0.10.

---

### Reversibility

**Easy.** The policy is expressed in scripts and one small entry point. Switching to boot-time migration would be a few lines — which is precisely why the reasoning is recorded here, since the change would be cheap to make and expensive to discover.

---

## ADR-005: Market data provider

**Date:** 2026-08-25
**Status:** **Accepted, conditional on a single account-eligibility check (see Conditions).**
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
| **No candle stream** | Poll `.../candles?granularity=M15&count=2&includeFirst=false` after each 15M boundary; trust `complete`. Stream used only for bid/ask and heartbeat liveness. **`ARCHITECTURE-AND-STACK.md` F.2 should be amended** — it currently implies a websocket-fed candle path. | design change | FR-1.4, T1.7 |
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
| 3 | Amend `ARCHITECTURE-AND-STACK.md` F.2 — candles are polled, not streamed | Before T1.7 |
| 4 | Move `REQUIREMENTS.md` FR-10.6 from BLOCKED to PLANNED, citing the licence | Next requirements revision |
| 5 | Add per-series exchange hours and cadence to the `macro_observations` design | T1.10 |
| 6 | Read ICE's published USDX coefficients from their methodology PDFs (U7) | Before the synthetic index is implemented |
| 7 | Verify Twelve Data's free-tier `XAU/USD` access (U9); fall back to Massive (U10) if gated | T1.9 |
| 8 | Nightly trailing-7-day re-fetch for the first month, to measure the undocumented revision policy (U3) | T1.4 onward |
