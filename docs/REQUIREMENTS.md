# XAU/USD Command Centre — Requirement Map

**Date:** 2026-08-25
**Derived from:** Build Specification Parts 1–38 + Engineering Prompt §1–47
**Status:** draft for review. IDs are stable once agreed — tests, ADRs and commits reference them.

**Legend — Phase:** the phase in which the requirement is first delivered.
**Legend — State:** `PLANNED` (agreed, not built) · `BLOCKED` (needs a decision) · `CUT` (recommended out of scope).

---

## FR — Functional Requirements

### FR-1 Market data

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-1.1 | Ingest XAU/USD 15M candles from one nominated reference provider | 1 | BLOCKED (ADR-005 condition) |
| FR-1.2 | Aggregate 1H, 4H, 1D from stored 15M base candles using a configured session boundary | 1 | PLANNED |
| FR-1.3 | Backfill historical 15M candles, resumably and idempotently | 1 | BLOCKED (ADR-005 condition) |
| FR-1.4 | Ingest live price and mark candles final only after the bar's close time has passed on the reference feed | 1 | PLANNED |
| FR-1.5 | Ingest DXY | 1 | BLOCKED (ADR-005 condition) |
| FR-1.6 | Ingest US Treasury yields (2Y and 10Y minimum) | 1 | PLANNED |
| FR-1.7 | Detect and record missing, duplicate, out-of-order, zero, and extreme-value candles without silently repairing them | 1 | PLANNED |
| FR-1.8 | Maintain a market-hours calendar (weekly open/close, daily break, holidays) and suppress staleness alarms outside trading hours | 1 | PLANNED |
| FR-1.9 | Reconcile the reference feed daily against a secondary source and record divergence | 1 | PLANNED |
| FR-1.10 | Detect weekend/holiday gaps and flag affected zones, liquidity pools and live setups for re-evaluation | 2 | PLANNED |

**State changes after T1.1 (2026-08-25):**

`BLOCKED (provider)` was stale on all four rows — the provider evaluation is complete and ADR-005 nominates OANDA v20. It has been replaced with the *actual* remaining blocker rather than removed:

- **FR-1.1, FR-1.3, FR-1.5 remain BLOCKED** on ADR-005's unresolved condition: OANDA's documentation states the v20 API is unavailable to the OANDA Global Markets division, and Thailand residents are listed as OGM-eligible. Until the practice-account check in `DATA_SOURCES.md` §11 passes, the reference feed is not settled. The *approach* for each is decided (FR-1.5's DXY is to be synthesised from OANDA's own six USDX component pairs as `USDX_SYNTHETIC`, cross-checked against FRED `DTWEXBGS`) — only the provider premise is outstanding.
- **FR-1.6 moves to PLANNED.** Its source is the US Treasury's own daily XML feed (`daily_treasury_yield_curve`) — free, official, no API key, history from 1990, and **entirely independent of the OANDA question**. Nothing about it is contingent on ADR-005. Tenors are no longer TBD: the feed publishes 1/1.5/2/3/4/6 months and 1/2/3/5/7/10/20/30 years, so the 2Y and 10Y minimum is satisfied. Note the constraint this carries — the feed is daily, end-of-day, business days only, so yields can inform a daily-or-slower macro bias and nothing faster (see DR-3 and FR-8.4).

This feed is a Phase 1 dependency but is not represented in the INT table; INT-5 currently scopes Treasury sources to Phase 8. Worth reconciling at the next requirements revision.

### FR-2 Technical engine (deterministic, no LLM)

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-2.1 | EMA 20/50/100/200 per timeframe, TradingView-parity formula, with enforced minimum warmup | 2 | PLANNED |
| FR-2.2 | Stoch RSI 14/14/3/3 per timeframe, TradingView-parity formula | 2 | PLANNED |
| FR-2.3 | Classify EMA environment into 5 bands with a human-readable explanation of *why* | 2 | PLANNED |
| FR-2.4 | Classify Stoch RSI signal as Strong / Moderate / Weak per Part 4 | 2 | PLANNED |
| FR-2.5 | Detect swing highs/lows with an explicit confirmation lag; record `occurred_at` and `confirmed_at` separately | 2 | PLANNED |
| FR-2.6 | Derive market structure (HH/HL/LH/LL, break of structure) per timeframe | 2 | PLANNED |
| FR-2.7 | Identify support/resistance zones with the attributes listed in Part 5 | 2 | PLANNED |
| FR-2.8 | Identify buy-side and sell-side liquidity pools per Part 9 | 2 | PLANNED |
| FR-2.9 | Track liquidity pool status: Fresh / Approaching / Swept / Consumed / Reclaimed | 2 | PLANNED |
| FR-2.10 | Classify a sweep's *reaction* as rejection or acceptance — never assume direction (Part 10, mandatory) | 2 | PLANNED |
| FR-2.11 | Detect breakouts and assess breakout quality | 2 | PLANNED |
| FR-2.12 | Detect pullback / retest of a broken zone and whether the zone held | 2 | PLANNED |
| FR-2.13 | Calculate room-to-target: distance to next zone, liquidity pool, and major swing in both directions | 2 | PLANNED |
| FR-2.14 | Detect structural invalidation of a zone, trendline or map element | 2 | PLANNED |
| FR-2.15 | Compute ATR (or equivalent volatility measure) as the normalising unit for threshold rules | 2 | PLANNED |
| FR-2.16 | Classify session (Asia / London / New York) from UTC using timezone-aware logic | 1 | PLANNED |

### FR-3 Weekly market map

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-3.1 | Generate a versioned weekly map at a configured time relative to market open | 3 | PLANNED |
| FR-3.2 | Map contains: major resistance, major support, buy/sell-side liquidity, PWH/PWL, PDH/PDL, major swings, EMA structure, HTF bias | 3 | PLANNED |
| FR-3.3 | Suggest 1D / 4H / 1H trendlines as advisory output only | 3 | PLANNED |
| FR-3.4 | Emit event-driven `MAP UPDATE REQUIRED` when a map element is invalidated mid-week | 3 | PLANNED |
| FR-3.5 | Preserve all historical map versions immutably; never edit in place | 3 | PLANNED |
| FR-3.6 | Emit a Pine Script snippet rendering the current map's levels, for paste into TradingView | 3 | PLANNED |
| FR-3.7 | Programmatic annotation of an embedded chart | V2 | CUT from V1 (H1) |

### FR-4 Setup detection and lifecycle

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-4.1 | Model setup lifecycle as an explicit state machine with validated transitions | 4 | PLANNED |
| FR-4.2 | Implement the long setup sequence (Part 12) | 4 | PLANNED |
| FR-4.3 | Implement the short setup sequence (Part 13) as the exact inverse | 4 | PLANNED |
| FR-4.4 | Separate core gates from supporting evidence; never reject on a single supporting disagreement (Part 14) | 4 | PLANNED |
| FR-4.5 | Record every state transition with previous state, new state, trigger, evidence refs, timestamp, rule version | 4 | PLANNED |
| FR-4.6 | Expire stale setups per a defined rule | 4 | BLOCKED (rule undefined — H9) |
| FR-4.7 | Govern concurrent and conflicting setups per a defined rule | 4 | BLOCKED (rule undefined — H9) |
| FR-4.8 | Govern re-entry after cancellation without creating an alert loop | 4 | BLOCKED (rule undefined — H9) |

### FR-5 Planning and grading

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-5.1 | Calculate ideal entry range and maximum acceptable entry (Part 16) | 5 | PLANNED |
| FR-5.2 | Calculate a structural stop from invalidation/swing/zone/volatility — never artificially tightened (Part 17) | 5 | PLANNED |
| FR-5.3 | Calculate TP1/TP2/TP3 at meaningful structural levels (Part 18) | 5 | PLANNED |
| FR-5.4 | Calculate R:R per target; reject the setup when a correct stop makes R:R inadequate | 5 | PLANNED |
| FR-5.5 | Apply room-to-target as a hard gate, not a scored factor (Part 15) | 5 | PLANNED |
| FR-5.6 | Assign grade A+/A/B/C via a documented, versioned, testable methodology | 5 | BLOCKED (C4) |
| FR-5.7 | Suggest when moving to breakeven is structurally justified — never at an arbitrary point count (Part 18) | 5 | PLANNED |
| FR-5.8 | Suggest risk band by grade (A+/A normal, B observation, C none), user-overridable (Part 34) | 5 | PLANNED |

### FR-6 Alerts

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-6.1 | Emit WATCH / DEVELOPING / CONFIRMED / READY / DETERIORATING / CANCELLED alerts | 6 | PLANNED |
| FR-6.2 | Emit WEEKLY MAP READY and MAP UPDATE alerts | 6 | PLANNED |
| FR-6.3 | Emit news and data-degradation warnings | 6/8 | PLANNED |
| FR-6.4 | Persist every alert to the database before dispatch; DB is source of truth | 6 | PLANNED |
| FR-6.5 | Deduplicate by deterministic key; identical alerts must never send twice | 6 | PLANNED |
| FR-6.6 | Deliver via a pluggable adapter — test adapter first, then Telegram | 6 | PLANNED |
| FR-6.7 | Retry failed delivery with backoff; never lose an alert on provider outage | 6 | PLANNED |
| FR-6.8 | Apply grade-based priority and configurable quiet hours (Part 32) | 6 | PLANNED |
| FR-6.9 | Show B/C setups as intelligence, visually distinct from A+/A action alerts (Parts 20, 21) | 6 | PLANNED |

### FR-7 Reasoning layer

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-7.1 | Provider-abstracted LLM interface | 7 | PLANNED |
| FR-7.2 | Send only validated structured snapshots — never raw ticks | 7 | PLANNED |
| FR-7.3 | Require structured output validated against a Zod schema | 7 | PLANNED |
| FR-7.4 | Reject and log responses containing invented prices, unknown evidence IDs, invalid structure, or contradictory direction | 7 | PLANNED |
| FR-7.5 | **LLM output must never cause a state transition or alter numeric plan values** — annotation only | 7 | PLANNED |
| FR-7.6 | LLM failure must not interrupt market monitoring, detection or alerting | 7 | PLANNED |
| FR-7.7 | Persist every reasoning run: input snapshot, prompt version, model, output, validation result | 7 | PLANNED |

### FR-8 News and macro

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-8.1 | Ingest an economic calendar with scheduled release times in a named timezone | 8 | BLOCKED (provider) |
| FR-8.2 | Store as-released actual/forecast/previous immutably; revisions append, never overwrite | 8 | PLANNED |
| FR-8.3 | Calculate surprise vs forecast (Part 24) | 8 | PLANNED |
| FR-8.4 | Measure actual DXY / yield / XAU reaction post-release and classify whether it confirms the expected interpretation | 8 | PLANNED |
| FR-8.5 | Warn on high-impact events approaching without automatically cancelling technical setups (Part 25) | 8 | PLANNED |
| FR-8.6 | Ingest Tier 1 primary sources (Fed, Treasury, BLS, BEA) | 8 | PLANNED |
| FR-8.7 | Ingest Tier 2 financial news with deduplication and source attribution | 8 | PLANNED |
| FR-8.8 | X/Twitter Tier 4 discovery and credibility scoring | — | CUT (H4) |
| FR-8.9 | "Priced in" reversal research surface | V2 | DEFERRED (M5) |

### FR-9 Journal, backtesting and learning

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-9.1 | Record every detected setup with full evidence, whether traded or not (Part 31) | 4 | PLANNED |
| FR-9.2 | Manual trade log UI: link to setup, entry, size, exits, notes | 6 | PLANNED |
| FR-9.3 | Deterministic outcome resolver replaying candles against the published plan; record MAE/MFE and resolution method | 6 | PLANNED |
| FR-9.4 | Missed-trade analysis comparing user decisions to hypothetical outcomes (Part 33) | 10 | PLANNED |
| FR-9.5 | Reproducible backtest engine with no look-ahead and no future-data leakage | 9 | PLANNED |
| FR-9.6 | Report expectancy, avg R, median R, win/loss rate, drawdown, MAE, MFE, sample size — segmented by grade, session, EMA/Stoch context, liquidity pattern, room | 9 | PLANNED |
| FR-9.7 | Session performance comparison (Part 32) | 9 | PLANNED |
| FR-9.8 | Statistical promotion of proven combinations, gated on minimum sample size | 12 | DEFERRED |
| FR-9.9 | AI discovery of out-of-strategy patterns, quarantined from the main strategy | 12 | DEFERRED |

### FR-10 Dashboard

| ID | Requirement | Phase | State |
|---|---|---|---|
| FR-10.1 | Show current price, per-timeframe state, active setup, zone, liquidity, news, plan, status (Part 35) | 6 | PLANNED |
| FR-10.2 | Show data freshness and system health prominently | 1 | PLANNED |
| FR-10.3 | Show the evidence and reason behind the current setup state | 6 | PLANNED |
| FR-10.4 | Show alert history | 6 | PLANNED |
| FR-10.5 | Show the current weekly map and its version | 6 | PLANNED |
| FR-10.6 | Dashboard authentication; single-user, private | 0 | PLANNED |
| FR-10.7 | Embedded live chart from the reference feed | V2 | DEFERRED (H1) |

**FR-10.6 unblocked after T1.1 (2026-08-25).** It was BLOCKED pending decision 5 (public URL with auth vs private-network only). That framing treated authentication as a preference. It is not: market-data licence terms make a private, authenticated dashboard the only compliant option, and this holds for **any** reputable provider, so it does not depend on ADR-005's unresolved account-access condition.

The OANDA API License Agreement reviewed in T1.1 grants "Internal Use" only — research, analysis, data processing, and distribution "to the Licensee (if an individual)" — and prohibits the Licensee from "transmit[ting], publish[ing], disseminat[ing], duplicat[ing], display[ing], disclos[ing], offer[ing] or otherwise provid[ing], in any form whatsoever, the FXTrade Rates to any third party."

A public dashboard displaying live rates is therefore a licence breach regardless of how obscure its URL is, which independently reinforces M9's security argument. Decision 5 narrows to *how* (single-user session auth, an identity provider, or private-network-only such as Tailscale) — not *whether*. Right-size it per M9: no multi-tenancy, no roles.

Two related consequences recorded here so they are not rediscovered later: FR-10.7's embedded chart is only ever permissible for a viewer who is the Licensee; and FR-7.2's LLM snapshot should carry derived, non-reconstructable facts rather than raw OHLC arrays, which is desirable for SEC-8 in any case.

---

## NFR — Non-Functional Requirements

| ID | Requirement | Rationale |
|---|---|---|
| NFR-1 | Market monitoring must survive a dashboard deploy or restart | H6 |
| NFR-2 | Worker must reconstruct live state deterministically on boot | Missing item 11 |
| NFR-3 | All candle and event processing idempotent under duplicate delivery | §22 |
| NFR-4 | All timestamps stored in UTC; display in configurable local/session time | §8 |
| NFR-5 | No hard-coded UTC offsets for London/NY; IANA timezone data only | §8 |
| NFR-6 | Structured JSON logging with correlation IDs; no secrets logged | §16 |
| NFR-7 | Health and readiness endpoints distinguishing "up" from "data fresh" | §16 |
| NFR-8 | Degrade safely on stale/uncertain data — suppress confidence rather than fabricate | §7 |
| NFR-9 | Core domain logic testable without booting Next.js or a browser | §37 |
| NFR-10 | Every alert reconstructable from stored evidence | §10 |
| NFR-11 | Strategy rules versioned; historical reasoning never retro-edited | §39 |
| NFR-12 | Backtest results reproducible byte-for-byte from a pinned dataset and version | §14 |
| NFR-13 | LLM calls event-gated, not tick-driven or timer-driven | §4, §24 |
| NFR-14 | Monthly running cost within an agreed ceiling, tracked per component | L6 |
| NFR-15 | Database backed up with a tested restore procedure | Missing item 8 |

---

## DR — Data Requirements

| ID | Requirement |
|---|---|
| DR-1 | XAU/USD 15M OHLC(V) with reliable close timestamps, from a single nominated provider |
| DR-2 | Historical depth sufficient for the agreed backtest window, **from the same provider as live** (H7) |
| DR-3 | DXY and Treasury yields — note these have exchange hours and will not align with 24h gold; mismatch must be handled explicitly |
| DR-4 | Economic calendar with actual/forecast/previous and reliable release timestamps |
| DR-5 | Market-hours and holiday calendar for the reference feed |
| DR-6 | Every stored external record carries: provider, ingestion timestamp, source timestamp, and raw payload reference |
| DR-7 | Bid/ask or spread estimate where the provider supplies it (M3) |
| DR-8 | Derived structures carry both `occurred_at` and `confirmed_at` (H2) |

---

## INT — External Integrations

| ID | Integration | Phase | State |
|---|---|---|---|
| INT-1 | Market data provider (XAU/USD, DXY) | 1 | BLOCKED (ADR-005 condition) |
| INT-2 | Telegram Bot API | 6 | PLANNED |
| INT-3 | LLM provider | 7 | PLANNED — choose by measurement |
| INT-4 | Economic calendar provider | 8 | BLOCKED — evaluation required |
| INT-5 | Tier 1 primary sources (Fed/Treasury/BLS/BEA feeds) | 8 | PLANNED |
| INT-6 | Financial news provider | 8 | BLOCKED — evaluation required |
| INT-7 | Railway (hosting, Postgres) | 0 | PLANNED |
| INT-8 | GitHub + Actions | 0 | PLANNED |
| INT-9 | X/Twitter API | — | CUT |

**INT-1 restated after T1.1 (2026-08-25).** "BLOCKED — evaluation required" was stale: the evaluation is complete (`DATA_SOURCES.md`) and ADR-005 nominates OANDA v20. What remains blocking is narrower and specific — the unresolved OANDA account-access condition, not the absence of an evaluation. Yields are dropped from INT-1's scope because their source (the US Treasury daily XML feed) is settled and independent of that condition; see the FR-1 note above. INT-4 and INT-6 are untouched: neither was evaluated in T1.1.

---

## TR — Trading / Domain Rules requiring explicit definition

Each of these must have a written rule, stated weaknesses, and a version in `docs/STRATEGY_RULES.md` **before** the code that implements it. This is the gate described in §12 of the engineering prompt.

| ID | Concept | Blocks |
|---|---|---|
| TR-1 | Swing high/low definition and confirmation lag | FR-2.5 |
| TR-2 | Zone identification: what makes a level a zone, and its price width | FR-2.7 |
| TR-3 | "Meaningful reaction" | FR-2.7 |
| TR-4 | Zone strength scoring | FR-2.7, FR-5.6 |
| TR-5 | Zone freshness and staleness | FR-2.7 |
| TR-6 | "Equal highs/lows" tolerance and minimum cluster size | FR-2.8 |
| TR-7 | Liquidity pool definition and strength | FR-2.8 |
| TR-8 | Sweep detection: what counts as taking liquidity | FR-2.9 |
| TR-9 | Sweep rejection vs acceptance (bar count + retracement threshold) | FR-2.10 |
| TR-10 | "Decisive breakout" and breakout quality score | FR-2.11 |
| TR-11 | Valid pullback and "zone held" | FR-2.12 |
| TR-12 | "Sufficient room" threshold, in ATR or R units | FR-2.13, FR-5.5 |
| TR-13 | Structural invalidation | FR-2.14 |
| TR-14 | EMA slope: "sloping" vs "flat" | FR-2.3 |
| TR-15 | Stoch RSI strength bands and "momentum expanding" | FR-2.4 |
| TR-16 | 15M entry trigger / "bullish confirmation" | FR-4.2 |
| TR-17 | Structural stop placement and buffer | FR-5.2 |
| TR-18 | Target selection rules for TP1/TP2/TP3 | FR-5.3 |
| TR-19 | Minimum acceptable R:R | FR-5.4 |
| TR-20 | Grading methodology | FR-5.6 |
| TR-21 | Setup expiry, concurrency, re-entry | FR-4.6–4.8 |
| TR-22 | Breakeven justification | FR-5.7 |
| TR-23 | Gap handling on weekly open | FR-1.10 |
| TR-24 | Outcome resolution when TP and SL share a candle | FR-9.3 |

**24 undefined rules.** That number is the honest measure of how much design work sits between here and a working Phase 4. It is not a criticism of the spec — it is the normal gap between a trader's mental model and an executable one — but it should reset expectations about timeline.

---

## SEC — Security Requirements

| ID | Requirement |
|---|---|
| SEC-1 | No secrets in Git; `.env` ignored; `.env.example` documented; secret scanning in CI |
| SEC-2 | All environment variables validated at boot via Zod; fail fast and loudly on missing config |
| SEC-3 | All external API responses validated at the boundary before entering the domain |
| SEC-4 | Dashboard requires authentication (M9) |
| SEC-5 | Parameterised queries only (Drizzle default); no string-built SQL |
| SEC-6 | Telegram webhook (if used) verified by secret token; prefer polling if it avoids an inbound surface |
| SEC-7 | External news/social text treated as untrusted data: never in a system role, always delimited, never able to alter application rules |
| SEC-8 | LLM output never granted authority over state transitions or numeric values (FR-7.5) |
| SEC-9 | Outbound requests restricted to a known provider allowlist (SSRF) |
| SEC-10 | Dependency vulnerability scanning in CI |
| SEC-11 | Rate limiting on any public endpoint |
| SEC-12 | Logs redact keys, tokens and PII |

---

## OPS — Operational Requirements

| ID | Requirement |
|---|---|
| OPS-1 | Two Railway services (web, worker) plus managed Postgres |
| OPS-2 | Migrations run deliberately as a release step, never implicitly at boot |
| OPS-3 | Graceful SIGTERM shutdown: close feed, finish in-flight work, release locks |
| OPS-4 | Health check distinguishes process-up from data-fresh |
| OPS-5 | Deployment must never assume local filesystem persistence |
| OPS-6 | Rollback procedure documented and tested once |
| OPS-7 | Database backup with a *tested* restore |
| OPS-8 | Alert on: feed disconnected beyond threshold, migration failure, worker crash loop, LLM error rate, data-quality event spike |
| OPS-9 | Scheduling lives in the worker; exactly-once execution for scheduled jobs |

---

## TEST — Testing Requirements

| ID | Requirement |
|---|---|
| TEST-1 | Unit tests for every indicator, with TradingView golden-value fixtures |
| TEST-2 | Unit tests for every TR-* rule, covering the 20 case types in §12 |
| TEST-3 | Integration tests against a real Postgres for migrations, ingestion, idempotency |
| TEST-4 | State machine tests covering every valid transition and rejecting every invalid one |
| TEST-5 | Property tests for the §13 invariants |
| TEST-6 | DST-transition fixture tests for session, daily boundary and calendar timing |
| TEST-7 | Look-ahead guard tests: assert no engine query reads by `occurred_at` |
| TEST-8 | Idempotency tests: duplicate candle produces no duplicate setup, transition or alert |
| TEST-9 | Degradation tests: stale feed produces DATA DEGRADED, not a confident setup |
| TEST-10 | AI response validation tests: malformed, hallucinated, injected, and contradictory responses all rejected |
| TEST-11 | Playwright smoke on health; expand only from Phase 6 |
| TEST-12 | Every fixed bug gains a permanent regression test |
| TEST-13 | A committed golden dataset (one representative week of candles) for deterministic engine tests |
