# XAU/USD Command Centre — Specification Audit

**Date:** 2026-08-25
**Auditor role:** principal engineer / adversarial reviewer
**Source of truth audited:** "XAU/USD 24/7 AI TRADING COMMAND CENTRE — Full V1/V2 Build Specification" (Parts 1–38) plus the Master Engineering Prompt (§1–47).
**Status:** pre-implementation. No code has been written.

> **Scope limit on this audit:** this session has no web access. Every claim below about a third-party provider's pricing, API surface or terms is flagged `[VERIFY]` and must be confirmed against current official documentation in a Claude Code session with web access before it drives a decision. Nothing in this document should be treated as a verified vendor fact.

---

## 0. Overall assessment

The specification is unusually good for a trading-system brief. Three things in particular are right and should be protected:

1. **Deterministic code owns calculation; the LLM only interprets.** (Part 29 / §4)
2. **Do not optimise for confirmation count.** (Part 14, Part 46)
3. **No automatic execution.** (§3)

The specification's weaknesses are almost all in the same family: **it is written in the vocabulary of a discretionary trader, and discretionary vocabulary is not implementable.** Phrases like "meaningful reaction", "decisive breakout" and "sufficient room" are the actual product. They are currently undefined, and until they are defined as measurable rules the system cannot be built, tested, or backtested.

The second family of weakness is **the assumption that "the price" is a single knowable thing.** XAU/USD is an over-the-counter instrument. There is no consolidated tape. This has consequences that run through every part of the spec and are addressed as CRITICAL findings C1–C3.

**Verdict:** proceed, but three CRITICAL items (C1, C2, C3) must be resolved before Phase 1 code, and two (C4, C5) before Phase 4.

---

## A. Findings, classified

Severity means: **CRITICAL** = the system will be confidently wrong and you will trade on it. **HIGH** = will cause significant rework or a broken feature if not addressed now. **MEDIUM** = should be fixed before the relevant phase. **LOW** = tidy-up, cheap.

---

### CRITICAL

#### C1 — There is no authoritative XAU/USD price, and the spec assumes there is

**Where:** everywhere. Parts 5, 12, 16, 17, 19 all specify exact prices ("1H closes above 3,425", "SL: 3,413", "Maximum: 3,429").

**Problem:** gold spot is OTC. Every liquidity provider, broker and data vendor publishes a slightly different bid/ask. Typical divergence between two reputable feeds is on the order of tenths of a dollar in calm markets and can widen materially around news and at rollover. Consequences:

- The system's 1H candle may close at 3,425.30 while the chart you are looking at closed at 3,424.80. The system fires `BREAKOUT CONFIRMED`; you open TradingView and see no breakout. Trust in the product dies on day one.
- A liquidity sweep is a *high/low touch*. Wick extremes diverge between feeds far more than closes do. Sweep detection is the single most feed-sensitive rule in the spec.
- A structural stop at 3,413 on the system's feed is not the same stop on your broker.

**This is not a bug you can fix later.** It determines the provider choice, the dashboard chart, and how you interpret every alert.

**Required decisions and mitigations:**
- Nominate exactly **one reference feed**. All zones, candles, indicators, sweeps and plans are computed on it and only it. Record `provider_id` on every candle row.
- The dashboard must render a chart **from the same feed**, so what you see in the product matches what the product decided. Do not treat your TradingView chart as the arbiter unless you can source the same feed.
- Add a **daily reconciliation job** against a second, cheap source. It does not repair anything; it records max/mean divergence per day into `data_quality_events`. If divergence exceeds a threshold, degrade setup confidence.
- Never present a level to more decimal places than the feed's tick quality justifies. Publish levels as **ranges**, which the spec already does correctly in Part 16.

---

#### C2 — The daily and weekly candle boundary convention is undefined

**Where:** Parts 6, 9 ("previous day high/low", "previous week high/low"), all 1D analysis, Part 2 (1D trend/structure).

**Problem:** gold feeds disagree on when a day ends. Two common conventions:
- **17:00 New York** (the futures-style rollover most FX/metals brokers use), which is DST-shifting relative to UTC.
- **00:00 UTC**.

These produce *different daily candles, different daily highs and lows, different 1D EMA200, different 1D swing structure, and different PDH/PDL levels*. Previous-day high/low is a first-class liquidity concept in Part 9. Get this wrong and roughly a third of the spec's liquidity map is silently misaligned with your chart.

Weekly is worse: the gold week opens Sunday evening (broker-dependent) and closes Friday evening. "Previous week high/low" needs the same explicit definition.

**Required:** an explicit, configured, documented boundary convention, chosen to match the chart you actually trade from; aggregation implemented from 15M base candles rather than trusting the vendor's D1; and DST-transition tests.

---

#### C3 — Indicator parity with TradingView is assumed, not engineered

**Where:** Parts 3, 4.

**Problem:** you will read the alert, then look at TradingView. If the numbers differ, the product is worthless regardless of how good the logic is. Three specific divergence sources:

1. **Stoch RSI has multiple implementations.** "14/14/3/3" maps to RSI length 14, Stochastic length 14, %K smoothing 3, %D smoothing 3 — but the order of RSI→Stoch→smoothing, and whether %K is smoothed before %D, varies between libraries. Off-the-shelf TA packages will not necessarily match TradingView's built-in.
2. **EMA seeding.** TradingView seeds EMA with an SMA of the first N bars. Naive implementations seed with the first close. On EMA200 this difference persists for hundreds of bars.
3. **Warmup depth.** EMA200 on 1H needs a long history before it stabilises. Computing it from a short backfill produces a plausible-looking but wrong value.

**Required:**
- Pin the exact formulas in `docs/STRATEGY_RULES.md` as pseudocode before implementation.
- Write **golden-value tests**: export a few hundred bars with indicator values from TradingView, commit as a fixture, assert the engine matches within a documented tolerance.
- Define a minimum warmup (proposal: ≥ 5× the longest period, so ≥1000 bars before EMA200 is considered valid) and refuse to emit indicator values below it — this is invariant §13 in the engineering prompt, applied concretely.

---

#### C4 — The grading algorithm — the core product — does not exist

**Where:** Part 21 defines A+/A/B/C only qualitatively. Part 14 and Part 46 forbid counting confirmations. §20 of the engineering prompt requires a documented, testable methodology.

**Problem:** the grade drives which alerts you get, which alerts you act on, and what risk you take (Part 34). It is the single highest-leverage piece of logic in the system, and the spec contains no algorithm — only the constraint that the obvious algorithm (counting) is forbidden.

You cannot build, test or backtest Phases 4–6 without this.

**Required before Phase 4:** a written, versioned grading methodology. My recommendation for the shape (to be debated, not assumed):
- **Gate, don't score, the core requirements.** Location, structural confirmation, pullback, 15M trigger, room-to-target and a valid structural stop are *pass/fail gates*. Fail any gate → not a tradeable setup, maximum grade C. This directly encodes "price location and structure matter more than indicators".
- **Room-to-target and R:R produce a continuous quality measure,** not a checkbox. Part 15 explicitly says this should be one of the strongest filters; scoring it as one tick among fifteen contradicts that.
- **Supporting evidence adjusts within a band, and can only move the grade one step.** EMA/Stoch/DXY/yields/HTF alignment can lift A→A+ or drop A→B. They cannot create an A from a failed gate.
- **Contradiction is weighted asymmetrically.** One strongly opposing higher-timeframe factor should cost more than one mildly supporting factor gains. Otherwise you rebuild checkbox counting with extra steps.
- Version it (`strategy_version`), store the inputs, and never retro-grade historical setups.

---

#### C5 — Nothing captures what actually happened, so the entire learning loop is decorative

**Where:** Part 31 (journal), Part 33 (missed-trade analysis), Part 34 (daily drawdown), Phases 9–11.

**Problem:** you execute manually, on a broker the system is deliberately not connected to (§3). The system therefore does not know your entry, your fill, your size, whether you moved to breakeven, or your exit. Part 31 lists `outcome`, `MAE`, `MFE`, `whether user took trade` as if these arrive automatically. They do not.

Part 34's daily-drawdown protection is worse: it requires account P&L the system has no access to.

**Consequences if unaddressed:** Phase 11 statistical learning has no labels. Part 33's headline example ("user rejected 40% of A setups and 72% of those won") cannot be computed. The most valuable long-term feature of the product silently produces nothing.

**Required:**
- A **manual trade log** in the dashboard, built early (I'd put it in Phase 6, not Phase 10) — one screen: link to a detected setup, entry, size, stops, partial exits, final exit, notes. Low-friction or you will not use it.
- A **deterministic outcome resolver** that, for every detected setup whether traded or not, replays subsequent candles against the published plan and records hypothetical TP1/TP2/TP3/SL outcome, MAE and MFE. See M2 for the candle-ambiguity problem.
- Daily drawdown must be computed from the manual trade log and clearly labelled as *your logged trades*, not your account.

---

### HIGH

#### H1 — Part 11 (automatic TradingView annotation) is not achievable as written

**Problem:** TradingView does not expose a public API that lets an external program draw shapes on your personal tradingview.com charts. Pine Script cannot fetch external data. The TradingView **Advanced Charts / Charting Library** is a different product — a self-hosted charting widget you embed in your own dashboard and feed with your own datafeed. It supports drawing programmatically, but it is *your dashboard's chart*, not the chart in your TradingView tab. `[VERIFY]` current licence terms and application process.

The spec's stated goal — "the user should not have to manually copy every liquidity level" — is achievable, just not the way Part 11 implies.

**Recommended path:**
- **V1 (cheap, works this week):** the weekly map generator emits a **Pine Script snippet** with the week's levels hard-coded as horizontal lines/boxes with labels and strength. You paste it into a TradingView indicator once on Sunday, and again when a `MAP UPDATE` fires. This solves 90% of the pain for near-zero engineering cost.
- **V2 (if justified):** embed Advanced Charts in the dashboard with full programmatic annotation, driven by the same reference feed (which also resolves C1's "what am I looking at" problem). Treat as a deliberate, separately-scoped project — it is not a small task.
- Trendlines stay manual per the spec. Correct call.

---

#### H2 — Look-ahead is structurally baked into swing and zone detection

**Where:** Parts 5, 6, 9; Phase 8/9.

**Problem:** a swing high is only a swing high once *N* candles have printed to its right. Every downstream concept — market structure, zone identification, liquidity pools, "major swing" — inherits this lag. The spec never distinguishes:
- **event time** — the timestamp of the bar that formed the pivot, and
- **knowable time** — the close of the bar at which the pivot became confirmable.

If a backtest uses event time, it will look excellent and be fictional.

**Required:** `occurred_at` and `confirmed_at` as separate non-null columns on every derived structure (pivots, zones, liquidity pools, breakouts, map versions). All backtest and live queries filter on `confirmed_at <= T`. A property test asserting `confirmed_at >= occurred_at` and that no engine query ever reads a row by `occurred_at`. This is the single highest-value invariant in the project.

---

#### H3 — Ten load-bearing concepts are too vague to implement

Per §12 of the engineering prompt, these must stop before coding. Each needs an explicit measurable rule, its weaknesses documented, and a version.

| Term | Where | Why it can't be coded as-is |
|---|---|---|
| "meaningful reaction" | Part 5 | How many pips of move, over how many bars, from how close to the zone? |
| "major zone" / strength 9.1/10 | Parts 5, 6 | No formula given; see M1 |
| "decisive breakout" | Part 7 | Close beyond by what margin? Body vs wick? Volume? Follow-through bars? |
| "acceptance above" vs "rejects back below" | Part 10 | The bull/bear fork of the entire sweep engine rests on this. Needs a bar count and a retracement threshold. |
| "liquidity pool" / "equal highs" | Part 9 | Exactly equal never happens. Needs a tolerance in price or ATR units, plus a minimum cluster count. |
| "momentum expanding" | Part 4 | Stoch %K slope over N bars? Rate of change threshold? |
| "EMAs generally sloping upward" / "relatively flat" | Part 3 | Needs slope measured over N bars, normalised by ATR, with thresholds. |
| "sufficient room" | Part 15 | Absolute dollars? ATR multiples? R multiples? Almost certainly the last. |
| "spending too long below zone" | Part 19 | Bar count on which timeframe? |
| "materially changed" (structure/regime) | Part 7 | Triggers map invalidation; needs concrete criteria. |

**Recommended default for several of these: express thresholds in ATR units, not dollars.** Gold's daily range has varied enormously over the years; a rule tuned in absolute dollars will silently stop working when volatility regime changes, and will make older backtest data non-comparable.

---

#### H4 — The X/Twitter tier is expensive, low signal-to-noise, and the largest attack surface

**Where:** Parts 22 (Tier 4), 23; Phase 7.

Three separate problems:
1. **Cost.** X's API pricing has moved repeatedly and the tiers that permit meaningful search/streaming volume are, to my knowledge, priced well above hobby level. `[VERIFY]` — but budget for this being the most expensive line item in the whole system, for the least reliable data.
2. **Signal.** "Credibility: 3/10, Corroboration: none, Status: UNCONFIRMED" is, operationally, noise you will act on anyway at 2am. The spec's own philosophy (Part 14: don't over-filter, but don't trade noise) argues against it.
3. **Security.** External social text is the textbook prompt-injection vector (§17). A post crafted to read as instructions, ingested and passed to the reasoning layer, is a real risk — not theoretical.

**Recommendation: cut X entirely from V1 and V2.** Revisit only if, after Phase 8, primary-source news demonstrably misses events that moved gold. The spec itself defers it (Phase 7) — I'm arguing for stronger: don't schedule it at all yet.

**Mandatory mitigation whenever any external text reaches the LLM:** external content is never placed in a system role; it is wrapped in a clearly delimited untrusted block with an explicit instruction that its contents are data; the model must return structured output referencing supplied evidence IDs; and — critically — **no LLM output may cause a setup state transition.** See the architecture doc; this is a hard invariant.

---

#### H5 — "24/7" is factually wrong and the weekend gap is unhandled

Gold does not trade continuously. There is a weekly close (Friday evening) and open (Sunday evening), broker-dependent, plus a short daily maintenance break on most feeds.

Unaddressed consequences:
- A **staleness watchdog** that alerts on "no ticks for 5 minutes" will page you every weekend unless it knows market hours.
- **Sunday gaps** can open beyond a zone, through a stop, or past a `READY` setup's entry range. The spec has no gap rule. At minimum: any setup surviving the weekend must be re-evaluated on the first candles after open, and a gap through invalidation should CANCEL, not fill.
- The **weekly map job** must run at a time relative to the actual market open in a named timezone, not a fixed UTC hour.

---

#### H6 — Next.js alone is the wrong runtime shape for the monitoring core

**Where:** §2 of the engineering prompt.

Next.js App Router is a good choice for the dashboard. It is a poor host for a persistent websocket consumer and a scheduler, because:
- request-scoped runtimes restart on deploy, and may run multiple instances — your feed connection and cron must be **singletons**;
- a dashboard restart must not drop the market feed;
- long-running state inside a Next server is awkward to test without booting the framework, which contradicts §37 ("test core strategy without starting a browser").

**Recommendation (ADR-worthy, propose accepting now):** one repository, pnpm workspaces, **two deployable processes** — `apps/web` (Next.js) and `apps/worker` (plain long-lived Node) — sharing `packages/core`. On Railway that's two services plus Postgres.

This is not over-engineering under §5: it adds zero new technologies, no queue, no broker, no cache. It is the minimum correct process topology, and retrofitting it after Phase 4 means untangling engine code from the web framework.

---

#### H7 — Historical intraday data is a hard, paid dependency and must match the live feed

Backtesting (Phase 8/9) on 15M gold needs years of clean intraday history. This is generally a paid product, and free sources are typically short-window, rate-limited, or of unverified quality. `[VERIFY]` per provider.

**The trap:** backtesting on provider A and running live on provider B produces a backtest that does not describe your live system — different wicks, different closes, different daily boundaries (C1, C2). The historical depth requirement must therefore be part of the *live* provider selection, not solved separately later.

**This makes provider choice a Phase 0/1 decision with Phase 9 consequences. Decide it once, deliberately, with an ADR.**

---

#### H8 — Alert delivery has no reliability model, and the sleeping-user case is unhandled

Part 19 assumes Telegram works. Telegram outages happen, rate limits exist, and a phone can be offline.

**Required:**
- The **database is the alert source of truth**, not Telegram. Every alert row is written first with a deterministic **dedupe key** (`setup_id + level + state_version`), then dispatched. Telegram failure retries with backoff and never loses the alert; the dashboard shows everything.
- **Priority + quiet hours.** Part 32 says Asia sends exceptional-only, which is a quiet-hours rule in disguise. Make it explicit and configurable: which grades break through at which local hours.
- **Suppression rules** so a setup oscillating on a zone boundary cannot generate twenty alerts. This is §22 idempotency applied to notifications.

---

#### H9 — The setup lifecycle has undefined edges

The spec defines the happy path (Part 12) and cancellation (Part 19). Missing:
- **Expiry.** A `READY` setup where price never returns to the entry range — after how long is it dead? Bars, or a structural condition?
- **Simultaneous conflicting setups.** A long at support and a short at resistance can both be live. Allowed? Which alerts?
- **Max concurrent setups**, to prevent alert flooding in choppy conditions.
- **Re-entry after cancel.** Part 12's sequence can immediately re-trigger. §13's invariant ("READY cannot follow CANCELLED without a new setup instance") is correct — but the rule for *when a new instance may be created* is undefined. Without it you get an infinite alert loop on a chopping level.
- **`DETERIORATING` is not a state.** It is a *grade delta on an existing state*. Modelling it as a state creates ambiguous transitions (deteriorating → back to ready? → deteriorating again?). See the state machine proposal in `ARCHITECTURE.md`.

---

### MEDIUM

**M1 — "9.1/10" is fake precision and contradicts Part 30.** Part 30 correctly bans "87% chance of winning" as unearned precision, then Parts 5/6/19 print zone strengths to one decimal place. A tenth of a point on a zone score is not meaningful information. Either it comes from a documented deterministic formula (in which case publish the formula and the inputs), or it's decoration. **Recommendation:** integer 1–5 or bands (Weak/Moderate/Strong/Major) with the contributing factors listed underneath. Store a finer-grained internal score if useful for ranking; do not display it.

**M2 — Outcome resolution is ambiguous inside a single candle.** If a 15M candle's range contains both TP1 and the SL, you cannot tell from that candle which came first. This affects the journal, missed-trade analysis and every backtest statistic. **Required:** a documented, pessimistic default (assume SL first) *and* the ability to resolve using 1M data where available. Whichever is used must be recorded per outcome row so results are comparable.

**M3 — Spread and slippage are not modelled.** XAU spread widens sharply around high-impact releases and at daily rollover — exactly the moments Parts 24–25 want you active. An entry range calculated on mid price may be unfillable. Minimum: store bid/ask or a spread estimate; add a configurable spread assumption to backtests; warn when the current spread exceeds a threshold.

**M4 — Trendlines cannot be trusted by automated logic.** They are user-drawn (Part 11) and inherently subjective. The system cannot know what you actually drew. **Recommendation:** trendlines are *advisory suggestions only* in V1 and are excluded from grading inputs entirely. Anything else means the grade depends on state the system cannot observe.

**M5 — "Priced in" detection (Part 26) will overfit.** There are a handful of CPI/NFP/FOMC prints per month. Any pattern found in the first year is likely noise. The spec already frames it as research, which is right — enforce it with a minimum sample size before any such finding is allowed to influence grading, and keep it in a separate research surface.

**M6 — Economic calendar data quality is underestimated.** Forecast values differ between providers; releases get revised; scheduled timestamps move. **Required:** store the *as-released* snapshot immutably with source attribution, never overwrite it with a revision — append a new row. Surprise calculations must reference the snapshot they used.

**M7 — Map versioning creates a consistency hazard.** With a Sunday baseline plus event-driven updates (Part 7 / the spec's own closing recommendation — which is a good call), a setup detected Tuesday was evaluated against a specific map version. **Required:** `map_version_id` as a foreign key on every setup and every zone reference, so an alert can always be reconstructed against the map that produced it (§10 auditability).

**M8 — Risk management (Part 34) has no account context.** "Normal predefined risk" and "daily loss limit" need balance and P&L. Ties to C5. Either the user logs trades, or these are advisory percentages only — say which, explicitly, in the UI.

**M9 — Dashboard authentication is unspecified.** A Railway deployment is a public URL. Even single-user, it needs auth. Right-size it: single-user session auth or an identity provider, no multi-tenancy, no roles. Decide in Phase 0 so it isn't retrofitted.

**M10 — DST tests are needed even though Thailand has none.** Thailand is UTC+7 year-round with no DST, which is convenient, but London and New York both shift, and they shift on *different dates*. Session boundaries, the daily candle boundary (C2), and economic-event times all move relative to you twice a year. Explicit fixture tests around each transition date.

---

### LOW

**L1 — Don't take a dependency for session times.** The closing note suggests "babypips API or similar" for a timezone tracker. I'm not aware of a supported public market-hours API from that source `[VERIFY]`, and it isn't needed: session boundaries are computed from IANA timezone data in about fifty lines with `luxon` or `date-fns-tz`, which you need anyway for §8. Adding a third-party dependency for arithmetic you can do locally adds an outage surface for no benefit. **Recommendation: reject.**

**L2 — "OpenAI or Claude for reasoning?"** Answered in `ARCHITECTURE.md` §D. Short version: it's a smaller decision than it feels, the provider abstraction matters more than the choice, and you should decide it with a measurement in Phase 7 rather than an opinion in Phase 0.

**L3 — Inconsistent vocabulary.** "Zone", "level", "support/resistance", "area" are used interchangeably; "liquidity pool", "liquidity", "liquidity level" likewise. Pick one term per concept and enforce it in code, docs and alert copy. Cheap now, annoying later.

**L4 — State names need revision** (the spec invites this). Proposal in the architecture doc.

**L5 — No disclaimer.** Personal single-user tool, so low stakes — but if it is ever shown to another person, generated alerts start to look like financial advice. One line in the UI footer, and a note in the README that this is a personal research tool.

**L6 — No cost budget.** Data + hosting + LLM + calendar. Needs a monthly ceiling before provider selection, because the ceiling determines the shortlist. This is question 3 in the open decisions list.

---

## B. What is missing from the specification entirely

Ordered by how much pain their absence causes:

1. **Manual trade capture** (C5) — the learning loop's missing half.
2. **Feed reconciliation and divergence monitoring** (C1).
3. **Weekend/holiday calendar and gap handling** (H5).
4. **Setup expiry, concurrency and re-entry rules** (H9).
5. **Alert priority, quiet hours and delivery guarantees** (H8).
6. **Authentication** (M9).
7. **Spread/slippage model** (M3).
8. **Backup and restore for the database.** Years of candles and every setup you ever detected is the asset. §35 mentions backups; the spec doesn't.
9. **Cost budget and per-component cost tracking** (L6).
10. **A definition of when the system should say "I don't know."** The spec has `DATA DEGRADED` in the engineering prompt (§7) but no equivalent for *strategy* uncertainty — e.g. price mid-range, no zone nearby, structure unclear. The honest output is silence, and the system should be explicitly designed to produce long stretches of nothing without that looking like a failure.
11. **Behaviour on restart.** Railway redeploys. On boot the worker must reconstruct state: which setups were live, which alerts were sent, where the candle history ends. Should be designed, not discovered.

---

## C. Contradictions found in the specification

| # | Contradiction | Resolution |
|---|---|---|
| 1 | Part 30 bans fake precision; Parts 5/6/19 print "9.1/10" strengths | M1 — banded scores |
| 2 | Part 14 forbids requiring every condition; Part 12 lists 14 sequential STEPs that read as mandatory | Restate Part 12 as: steps 1–8 + 12 are gates, 9–11 + 13 are supporting evidence. Encode in C4's grading model. |
| 3 | Part 46 forbids checkbox counting; Part 21 defines grades by how much evidence agrees | C4 — gates + bounded adjustment, not counting |
| 4 | Title says "24/7"; gold has a weekly close | H5 |
| 5 | Part 11 wants automatic TradingView annotation; Part 11 also says the user draws trendlines manually on tradingview.com — implying the annotated chart and the traded chart are the same, which they cannot be | H1 |
| 6 | Part 32 wants Asia "exceptional-only" alerts but "record all valid setups" | Not really a contradiction — it's a *detection vs notification* distinction. Worth stating explicitly: detection is always on; notification is filtered. Applies to B/C setups (Part 20) too. |
| 7 | Part 34 rejects "maximum 3 trades" in favour of drawdown limits, but drawdown needs account data the system lacks | M8 / C5 |

---

## D. What I recommend cutting or deferring

Cutting scope is the highest-value thing an engineer can do at this stage.

| Item | Spec ref | Recommendation |
|---|---|---|
| X/Twitter intelligence | Parts 22–23 | **Cut from roadmap.** Reconsider only with evidence after Phase 8. |
| Automatic TradingView annotation | Part 11 | **Replace** with Pine Script generation (H1). Revisit embedded charts as a separate V2 project. |
| "Priced in" detection | Part 26 | **Defer** behind a minimum sample size (M5). |
| AI Discovery | Phase 12 | **Defer** — correctly last already; keep it there and don't be tempted. |
| Statistical probabilities | Part 30 / Phase 11 | **Defer** — already correctly gated. |
| Trendlines in automated logic | Parts 6, 11 | **Downgrade** to advisory-only (M4). |
| Playwright E2E | §2 | **Set up in Phase 0, write almost nothing until Phase 6.** A health-check smoke test is enough until there's a dashboard worth testing. |
| Dashboard polish | Part 35, §38 | **Defer** — the spec already says this. Part 35's simple layout is the right target and should not grow. |

Nothing above is a rejection of the idea. It's sequencing: each of these is cheaper to build after the deterministic engine is proven, and several are cheaper to never build.

---

## E. Open decisions I need from you before Phase 1

These are the ones that are genuinely product-specific, expensive, or hard to reverse (§40). Everything else I'll decide, document and continue.

1. **Which broker/feed does the TradingView chart you actually trade from use?** (Drives C1 and C2 and the entire provider shortlist.)
2. **Daily candle boundary: 17:00 New York, or 00:00 UTC?** Check what your current chart uses — the daily candles will tell you immediately.
3. **Monthly budget ceiling** for market data + hosting + LLM + calendar, combined.
4. **How much backtest history do you need?** 2 years vs 5 years vs 10 changes the provider shortlist and the price materially.
5. **Dashboard exposure:** public URL with authentication, or private-network only (e.g. Tailscale)? Affects Phase 0 security work.
6. **Confirm: cut X/Twitter from the roadmap?** (H4)
7. **Confirm: web + worker as two processes?** (H6)

I have deliberately not asked you about: ORM choice, logging library, folder structure, test-DB strategy, state naming, or which LLM to start with. Those are mine to decide, document in an ADR, and proceed with.
