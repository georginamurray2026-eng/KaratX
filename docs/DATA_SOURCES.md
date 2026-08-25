# Market Data Sources — Evaluation (T1.1)

**Date:** 2026-08-25
**Task:** T1.1 (Phase 1, blocking)
**Decision recorded in:** [`DECISIONS.md`](./DECISIONS.md) — ADR-005

**Method:** every factual claim below was read from current official documentation and is cited with its URL. Where the documentation does not answer a question, the row says so and the question is repeated in [§10 UNVERIFIED](#10-unverified). Nothing here is recalled from memory.

---

## 1. Headline finding — read this first

OANDA is the right reference feed on **data** grounds. Its candle API is a near-exact fit for this system, including a detail that matters more than any other single parameter in Phase 1:

> **`dailyAlignment` defaults to `17` and `alignmentTimezone` defaults to `America/New_York`.**
> — [Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)

That is the daily boundary already confirmed against the user's TradingView chart in `INDICATOR-SPEC.md`, supplied natively and DST-aware by the provider.

**But there is one hard, non-data blocker to resolve before any code is written:**

> "To use this API you must have a v20 trading account, which is **available to all divisions except OANDA Global Markets and OANDA TMS BROKERS S.A.**"
> — [Introduction](https://developer.oanda.com/rest-live-v20/introduction/)

And:

> "Residents of the following countries may apply for an OANDA Global Markets account: Chile, Colombia, Hong Kong, Indonesia, Macao, Malaysia, Mexico, Philippines, Taiwan, **Thailand**, United Arab Emirates, Vietnam."
> — [Check eligible countries](https://help.oanda.com/bvi/en/faqs/eligible-ogm-countries-bvi.htm)

A Thailand-resident **live** OANDA account is routed to OANDA Global Markets (BVI), which is explicitly excluded from v20 API access. Whether the **fxTrade Practice (demo)** environment is likewise routed to OGM for a Thailand-declared applicant is not documented anywhere public. See [§9](#9-the-account-eligibility-blocker) and the manual step in [§11](#11-manual-steps-for-the-user).

---

## 2. Evaluation matrix

Criteria are those from `ARCHITECTURE-AND-STACK.md` §E/U-1. `—` means the documentation does not state it.

| Criterion | **OANDA v20** (reference candidate) | **Twelve Data** (reconciliation candidate) | **Massive** (ex-Polygon.io) (reconciliation candidate) |
|---|---|---|---|
| XAU/USD available | Yes, as a metals **CFD**, symbol `XAU_USD` ([instrument name format](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml): base + quote delimited by `_`). Availability is **division-dependent** ([CFD eligibility](https://help.oanda.com/ca/en/faqs/trade-cfds-steps.htm)) | Yes, `XAU/USD`, listed under precious metals ([Forex](https://twelvedata.com/forex)) | Yes, ticker `C:XAUUSD` (Currencies product) |
| Spot or proxy | OTC CFD on spot gold — the same product TradingView shows under `OANDA:XAUUSD` | Spot reference rate | Spot reference rate |
| 15M granularity | Yes — `M15` in the `CandlestickGranularity` enum ([spec](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml)) | Yes — `15min` ([docs](https://twelvedata.com/docs)) | Aggregates endpoint, custom multiplier + timespan |
| 1H / 4H / 1D granularity | Yes — `H1`, `H4`, `D` (also `W`, `M`) | Yes — `1h`, `4h`, `1day` | Yes |
| **Daily boundary configurable** | **Yes.** `dailyAlignment` integer `[default=17, minimum=0, maximum=23]`; `alignmentTimezone` string `[default=America/New_York]` ([Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)) | — | — |
| **Weekly boundary configurable** | **Yes.** `weeklyAlignment` `[default=Friday]`, enum `Monday…Sunday` ([spec](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml)) | — | — |
| Bid / ask / mid candles | All three. `price` accepts any combination of `M`, `B`, `A`; `[default=M]` | Mid only (not documented otherwise) | Quotes on paid tiers |
| Max candles per request | `count` `[default=500, maximum=5000]` ([Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)) | `outputsize` 1–5000 ([docs](https://twelvedata.com/docs)) | — |
| Candle finality flag | **Yes.** `complete: boolean` — "A flag indicating if the candlestick is complete. A complete candlestick is one whose ending time is not in the future." | — | — |
| Realtime method | Price **tick** stream (chunked HTTP), *not* a candle stream. Candles must be polled. | REST + WebSocket (WS trial-limited on free) | REST + WebSocket (paid) |
| Rate limit | **120 requests per second**, stated on each endpoint page ([Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)) | Free: 8 credits/min, 800/day ([Pricing](https://twelvedata.com/pricing)) | Free: 5 API calls/min ([Pricing](https://massive.com/pricing?product=currencies)) |
| Historical depth | "Historical pricing dating back to 2005" ([OANDA REST API page](https://www.oanda.com/sg-en/platforms/rest-api/)) — stated for FX generally, **not specifically for `XAU_USD`** | "20+ years of historical exchange rates are available even with free plans" ([Forex](https://twelvedata.com/forex)) | Free: 2 years. Starter $49/mo: 10+ years ([Pricing](https://massive.com/pricing?product=currencies)) |
| Cost at our volume | No fee documented for API access; account required | $0 free tier; Grow $79/mo | $0 free tier; Starter $49/mo |
| Revision policy | **Not documented** — see [§10](#10-unverified) | — | — |
| DXY | **No.** Not offered as an instrument | — (not evaluated) | — (not evaluated) |
| Treasury yields | **No** — bond *price* CFDs only, not yields. See [§7](#7-coverage-gaps--dxy-and-treasury-yields) | — | — |
| Redistribution / display licence | Internal use only; third-party redistribution prohibited. Single-user private dashboard is permitted. See [§8](#8-licence--and-what-we-may-do-with-the-data) | Not evaluated (mitigated: we never display reconciliation data) | Not evaluated (same) |
| Status page | **None.** `status.oanda.com` does not resolve (DNS failure, verified 2026-08-25). Only [Planned maintenance](https://www.oanda.com/planned-maintenance/) and [Unplanned maintenance](https://www.oanda.com/unplanned-maintenance/) pages exist | — | — |
| Documentation quality | Good and precise, but **frozen since 2018** — see [§6](#6-operational-profile) | Good | Good |
| **Account eligibility for a Thailand resident** | **BLOCKING RISK** — see [§9](#9-the-account-eligibility-blocker) | No account restriction | No account restriction |

---

## 3. OANDA — access and account

### Environments

| Environment | REST base URL | Streaming base URL |
|---|---|---|
| fxTrade Practice | `https://api-fxpractice.oanda.com` | `https://stream-fxpractice.oanda.com/` |
| fxTrade Live | `https://api-fxtrade.oanda.com` | `https://stream-fxtrade.oanda.com/` |

Source: [Development Guide](https://developer.oanda.com/rest-live-v20/development-guide/)

A practice account is sufficient for market data; OANDA describes the practice environment as one that "exactly mirrors the production API endpoints" ([REST API product page](https://www.oanda.com/sg-en/platforms/rest-api/)).

### Authentication

Bearer token in the HTTP `Authorization` header:

```
Authorization: Bearer 12345678900987654321-abc34135acde13f13530
```

> "There is a link on your OANDA fxTrade account profile page titled 'Manage API Access' (My Account -> My Services -> Manage API Access). From there, you can generate a personal access token […] OANDA does not retain your token so if it is lost or forgotten you must revoke it and generate a new one."
> — [Authentication](https://developer.oanda.com/rest-live-v20/authentication/)

One token grants access to **all sub-accounts** of that OANDA account. Token model implications for us:

- It is a bearer credential with **trading authority**, not a read-only data key. There is no documented read-only scope.
- SEC-1/SEC-12 therefore apply with unusual force: this token can place trades. It must never appear in a log line, an error message, or Git.
- Treat token compromise as an incident requiring immediate revoke-and-regenerate, not a rotation at leisure.

### Cost

No fee for API access is documented on any page reviewed. The API License Agreement's Schedule A refers to "License Fees" but the schedule is unpopulated in the published template — see [§10](#10-unverified).

---

## 4. OANDA — the candles endpoint

### Endpoint

**Use the account-scoped form.** It is the one currently documented on the live docs site with complete defaults:

```
GET /v3/accounts/{accountID}/instruments/{instrument}/candles
```
— [Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)

An account-independent form, `GET /v3/instruments/{instrument}/candles`, is defined in OANDA's official OpenAPI specification ([`v20_instrument.yaml`](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml)), but its documentation page (`developer.oanda.com/rest-live-v20/instrument-ep/`) currently returns **HTTP 404** (verified 2026-08-25). Prefer the account-scoped endpoint; it is documented, and we hold an account ID regardless.

`{instrument}` for spot gold is **`XAU_USD`** — "A string containing the base currency and quote currency delimited by a `_`".

### Parameters — verbatim from the docs

| Parameter | Type | Documented value |
|---|---|---|
| `price` | PricingComponent | "The Price component(s) to get candlestick data for." `[default=M]` — any combination of `M` (mid), `B` (bid), `A` (ask) |
| `granularity` | CandlestickGranularity | `[default=S5]` |
| `count` | integer | `[default=500, maximum=5000]` |
| `from` | DateTime | "The start of the time range to fetch candlesticks for." RFC 3339 or Unix seconds |
| `to` | DateTime | "The end of the time range to fetch candlesticks for." |
| `smooth` | boolean | `[default=False]` — a smoothed candle uses the previous candle's close as its open |
| `includeFirst` | boolean | `[default=True]` — "controls whether the candlestick that is covered by the `from` time should be included" |
| `dailyAlignment` | integer | **`[default=17, minimum=0, maximum=23]`** |
| `alignmentTimezone` | string | **`[default=America/New_York]`** — "Note that the returned times will still be represented in UTC." |
| `weeklyAlignment` | WeeklyAlignment | `[default=Friday]` |
| `units` | DecimalNumber | `[default=1]` — units used to compute the volume-weighted bid/ask |

Sources: [Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/) and [`v20_instrument.yaml`](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml).

### Granularities

`S5, S10, S15, S30, M1, M2, M4, M5, M10, M15, M30, H1, H2, H3, H4, H6, H8, H12, D, W, M`
— [`CandlestickGranularity`](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml)

**`M15`, `H1`, `H4` and `D` are all present.** All four required timeframes are natively available.

### Daily and weekly alignment — the critical finding

Our confirmed chart boundary is 17:00 `America/New_York`. That is OANDA's **default**, expressed exactly the way `INDICATOR-SPEC.md` requires: an hour-of-day plus an **IANA zone name**, not a fixed UTC offset. DST is therefore handled by the provider using the same zone database `luxon` will use on our side.

Weekly alignment is separately configurable, default `Friday`. Note this is a *day*, not a datetime — the weekly candle's boundary time is governed by `dailyAlignment`/`alignmentTimezone`. A weekly candle aligned `Friday` at 17:00 New York matches the gold week's actual close, which resolves the second half of audit finding C2.

**This does not change the T1.6 plan.** We still aggregate 1H/4H/1D/1W ourselves from stored M15 base candles, for the reasons in `BUILD-PLAN.md`. What it gives us is the regression guard T1.6 already calls for: fetch OANDA's own `D` candle with `dailyAlignment=17&alignmentTimezone=America/New_York` and assert our aggregate matches it. That assertion is now cheap and exact.

### Candle finality

```
complete: boolean
  A flag indicating if the candlestick is complete.
  A complete candlestick is one whose ending time is not in the future.
```
— [`Candlestick`](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml)

Map `complete` → our `is_final` column directly. Do not derive finality from wall-clock time.

### Candle price source — a subtlety worth recording

> "the 'candle' endpoint used to retrieve historical data only provides **base-price group** candlestick data" — while live pricing uses "your specific pricing group", producing differences between historical and live data from the API.
> — [REST v20 API troubleshooting guide](https://help.oanda.com/us/en/faqs/rest-v20-api-troubleshooting-guide.htm)

This is **good** for us. Candles come from a base pricing group rather than our account's marked-up pricing, so they are account-independent and stable — which is what a charting feed like TradingView's would also show. It does mean the tick stream and the candle endpoint are not the same price series, so never mix them.

### Pagination

There is no cursor. Page with `from` + `count`, using `includeFirst=false` on continuation requests — the documented purpose of that flag is exactly this: to "poll for future candlesticks but avoid receiving the previous candlestick repeatedly." At `count=5000`, one request covers roughly 52 days of M15 bars.

---

## 5. OANDA — real time

### Method

```
GET /v3/accounts/{accountID}/pricing/stream
```
served from the **streaming** base URL. — [Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/)

Documented behaviour:

> "This pricing stream does not include every single price created for the Account, but instead will provide **at most 4 prices per second (every 250 milliseconds)** for each instrument being requested. If more than one price is created for an instrument during the 250 millisecond window, only the price in effect at the end of the window is sent."

> "Pricing windows for different connections to the price stream are not all aligned in the same way […] different subscribers may observe different prices depending on their alignment."

### Heartbeat and transport

> "The response body for the Pricing Stream uses **chunked transfer encoding**. Each chunk contains Price and/or PricingHeartbeat objects encoded as JSON. Each JSON object is serialized into a single line of text […] **Heartbeats are sent every 5 seconds.**"

Example heartbeat: `{"time":"2016-09-20T15:05:50.163791738Z","type":"HEARTBEAT"}`

The 5-second heartbeat is the silent-death detector T1.7 needs. A stream with an open socket and no heartbeat for more than ~15s is dead; reconnect.

### **Do not build candles from the stream**

> "you cannot create OHLC candlestick data using the REST v20 Stream endpoint, since open, high, low, and close data of the period are not guaranteed to be returned in the response packets."
> — [REST v20 API troubleshooting guide](https://help.oanda.com/us/en/faqs/rest-v20-api-troubleshooting-guide.htm)

**Architectural consequence for T1.7:** the live feed consumer is a **poller**, not a stream consumer, for candles. Poll `.../candles?granularity=M15&count=2&includeFirst=false` shortly after each 15-minute boundary and trust the `complete` flag. The price stream is used only for (a) current bid/ask for the dashboard and the DR-7 spread record, and (b) liveness detection via heartbeat. This is a change of emphasis from `ARCHITECTURE-AND-STACK.md` F.2, which assumed a websocket-fed candle path; the diagram should be amended.

### Reconnection semantics

**Not documented.** No reconnection guidance, no backoff recommendation, no documented disconnect codes. We implement our own per `BUILD-PLAN.md` T1.7 (exponential backoff with jitter, bounded), and the gap-backfill on reconnect is entirely our responsibility. See [§10](#10-unverified).

---

## 6. Operational profile

### Rate limits

**120 requests per second**, printed on each endpoint page under a "Rate Limit" heading ([Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/), [Account Endpoints](https://developer.oanda.com/rest-live-v20/account-ep/)).

Separately, [Best Practices](https://developer.oanda.com/rest-live-v20/best-practices/) recommends:

> "For new connections, we recommend you limit this to **twice per second (2/s)**."
> "For an established connection, we recommend limiting this to **one hundred per second (100/s)**."

and advises HTTP keep-alive: "Subsequent requests will result in reduced latency as the TCP handshaking process is no longer required."

Not documented: concurrent connection limits, burst behaviour, the HTTP status returned when the limit is exceeded, or any `Retry-After` header. See [§10](#10-unverified).

Our actual load is trivially inside these limits: a full 5-year M15 backfill is roughly 175,000 bars ÷ 5,000 = **~35 requests**, and steady state is ~4 requests/hour. Backfill cost is a non-issue here, unlike the risk flagged in `BUILD-PLAN.md` T1.4.

### API stability

The API version is **3.0.25, dated September 28, 2018** — the most recent entry in the [Release Notes](https://developer.oanda.com/rest-live-v20/release-notes/), and the OANDA OpenAPI repository's last commit carries the same date. The API surface has not changed in almost eight years.

Read this two ways. Positively: near-zero breaking-change risk, and our contracts will not churn. Negatively: the documentation is not actively maintained (the 404 on the instrument endpoint page is evidence), so undocumented behaviour is unlikely ever to become documented. Anything in [§10](#10-unverified) should be assumed to stay unverified and must be established empirically instead.

### Status and uptime

- **No public status page.** `https://status.oanda.com/` fails DNS resolution (verified 2026-08-25).
- [Planned maintenance](https://www.oanda.com/planned-maintenance/) and [Unplanned maintenance](https://www.oanda.com/unplanned-maintenance/) pages exist and are the only official incident surface found.
- OANDA publishes periodic **System Availability Reports** as PDFs, but those located are for the EU entities and are years old (e.g. [OEM July 2021](https://www.oanda.com/assets/documents/802/OEM_-_System_Availability_-_July_2021.pdf)). They are a regulatory artefact, not an operational feed.

**Consequence for OPS-8:** we cannot subscribe to a status feed to distinguish "our bug" from "their outage." T1.8's staleness watchdog and T1.9's reconciliation job are therefore the *only* mechanisms that will tell us the feed is broken. Their value goes up.

### Market hours for gold on this feed

> Metals CFDs — Gold (XAU/USD): **"Sun-Fri: 18:05 - 16:59"**, New York timezone.
> — [Trading hours](https://www.oanda.com/sg-en/trading/hours-of-operation/)

The same page documents a **six-minute daily break, 16:59–17:05 New York**, for forex instruments. Holiday hours are published separately: [Holiday trading hours](https://www.oanda.com/bvi-en/cfds/holiday-trading-hours/).

Two things follow for T1.8 and T1.2:

1. The daily break brackets the 17:00 daily boundary. The M15 bar covering 16:45–17:00 New York is truncated by the close, and the 18:05 Sunday open means the week's first bar is partial. **The watchdog must treat 16:59–18:05 New York as a legitimate no-data window every day**, not only at the weekly boundary — otherwise H5's "page you every weekend" failure becomes "page you every night."
2. Store these hours as `America/New_York` local times in `market_hours` (FR-1.8), never as UTC. The 18:05 open is 22:05 UTC under EDT and 23:05 UTC under EST.

Note also that gold's session (18:05–16:59) is not identical to the forex schedule OANDA lists with the 16:59–17:05 break. Model per-instrument hours, not one global schedule.

---

## 7. Coverage gaps — DXY and Treasury yields

Both FR-1.5 and FR-1.6 need a source that is not OANDA.

### DXY — not available from OANDA

OANDA does not offer a US Dollar Index instrument. Its index CFDs are equity indices (US Wall St 30, DE40, UK100, FR40 and similar) — [Indices](https://www.oanda.com/rw-en/trading/cfds/indices/). The true DXY is a licensed ICE product ([U.S. Dollar Index futures](https://www.ice.com/forex/usdx)), so a cheap tick-level feed of it is unlikely to exist at our budget.

**Recommendation — synthesise it from OANDA's own pairs.** The ICE US Dollar Index is a geometric weighted average of six USD pairs, all of which OANDA quotes. Computing it ourselves gives us:

- 15M granularity on the **same feed and the same candle boundaries** as gold — no timestamp reconciliation, no second provider, no extra licence question, no extra cost;
- an index that moves when gold moves, rather than a daily EOD number that is stale for 23 hours of every trading day.

The constant and exponents are published by ICE in the [ICE Dollar Index FAQ](https://www.ice.com/publicdocs/futures_us/ICE_Dollar_Index_FAQ.pdf) and the [ICE FX Indexes Methodology](https://www.nyse.com/publicdocs/nyse/indices/ICE_FX_Indexes_Methodology.pdf). **Both are image-based/subset-font PDFs whose text could not be extracted programmatically in this session — the exact coefficients are therefore UNVERIFIED and must be read off those documents before implementation.** See [§10](#10-unverified). Label the output `USDX_SYNTHETIC` in the database so it can never be mistaken for the licensed index.

**Cross-check source:** [FRED `DTWEXBGS`](https://fred.stlouisfed.org/series/DTWEXBGS) — Nominal Broad U.S. Dollar Index, Board of Governors of the Federal Reserve System, daily, free with a registered API key. This is a *different* index (broad trade-weighted, not the ICE six-currency basket) and is not a substitute, but it is an independent daily sanity check on our synthetic series' direction and magnitude.

**Extra integration cost:** roughly one pure function in `packages/core` plus six more instrument subscriptions we are already paying nothing for. Call it half a day.

### Treasury yields — not available from OANDA

OANDA offers US Treasury **bond price** CFDs (`USB02Y_USD`, `USB05Y_USD`, `USB10Y_USD`, `USB30Y_USD` — [Bonds](https://www.oanda.com/uk-en/trading/cfds/bonds/)). These are prices, not yields. Price and yield move inversely, and a strategy rule written against "yields rising" cannot be fed a bond price without a sign error waiting to happen. Do not substitute one for the other.

**Recommended source: the US Treasury's own daily feed.** Free, official, no API key, no licence problem.

```
BaseURL:  https://home.treasury.gov
Endpoint: /resource-center/data-chart-center/interest-rates/pages/xml
Params:   ?data=daily_treasury_yield_curve&field_tdr_date_value=2026
```

- All years: `?data=daily_treasury_yield_curve&field_tdr_date_value=all&page=0`, incrementing `page` "until there is no data inside the `<entry>` tag." Pagination is zero-based; 300 rows per page.
- By month: `&field_tdr_date_value_month=202604`
- Data available from **1990** for the par yield curve.
- Tenors: "1, 1.5, 2, 3, 4 and 6 months and 1, 2, 3, 5, 7, 10, 20, and 30 years" — 2Y and 10Y are both present, satisfying FR-1.6's minimum.

Source: [Treasury Daily Interest Rate XML Feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed)

**The catch, and it is the one `REQUIREMENTS.md` DR-3 already predicted:** this is **daily, end-of-day, business-days-only** data. Gold trades roughly 23 hours a day, five and a bit days a week. There is no intraday yield in this feed. Two consequences:

1. Yields can only ever inform a *daily-or-slower* macro bias, never a 15M or 1H signal. Any TR rule that wants intraday yield reaction (FR-8.4) cannot be built on this source.
2. The exchange-hours mismatch is severe and must be modelled explicitly, or T1.5's validation will emit a "stale feed" event for yields every evening and all weekend. Give `macro_observations` its own per-series cadence and hours; do not run the gold watchdog over it.

**Extra integration cost:** one XML adapter with a Zod boundary, one daily cron, one `macro_observations` writer. Perhaps a day, and it is Phase 1 work only in the sense that T1.10 asks for it.

**If intraday yields turn out to matter** (a Phase 8 question, not a Phase 1 one), the fallback is a paid provider or deriving a yield proxy from OANDA's own bond-price CFDs. Both are decisions to defer.

---

## 8. Licence — and what we may do with the data

Governing document reviewed: **[OANDA Asia Pacific Pte. Ltd. API License Agreement, 19 May 2021](https://www.oanda.com/assets/documents/714/API_License_Agreement_OAP.pdf)**. This is the Asia Pacific entity's template; the agreement actually binding the user will be the one presented at token generation for whichever division issues the account. Re-read it at that moment.

**Clause 3.1 — the grant** permits, among other things, "creating custom interfaces to the FXTrade System" and "accessing the FXTrade Rate Feed in order to retrieve FXTrade Rates." Our dashboard is a custom interface. Permitted.

**Clause 3.2 — limitations.** Licensee will:

> "(g) use the FXTrade System and the Licensed Materials for its own **internal use only**;
> (h) **not permit any third party** to use the FXTrade System or the Licensed Materials; and
> (i) **not transmit, publish, disseminate, duplicate, display, disclose, offer or otherwise provide, in any form whatsoever, the FXTrade Rates to any third party.**"

**Clause 15(e) — the definition that matters:**

> "'Internal Use' shall mean access to and use of Licensed Material for performance of research and analysis, preparation of hard-copy research documents and reports […] and for other data processing use, analysis and distribution **to the Licensee (if an individual)** or within Licensee's own organization (if an entity) **but not for redistribution of, or the provision of access to, Licensed Material to any third-party** including but not limited to any clients or customers of Licensee or to any other non-Licensee persons or entities."

**Clause 15(a)** adds that the Licensee "will not re-transmit the same from its premises for any purpose, including re-transmission to other premises of the Licensee, without written permission from OANDA."

### What this means concretely

| Intended use | Permitted? |
|---|---|
| Storing years of candles in our own Postgres | Yes — "other data processing use, analysis" |
| Computing indicators, zones, setups from it | Yes — "research and analysis" |
| Displaying prices and levels on a dashboard **only the user can reach** | Yes — distribution "to the Licensee (if an individual)" |
| Sending the user's own alerts to the user's own Telegram | Yes, same basis |
| A public dashboard URL, even unadvertised | **No** |
| Showing the dashboard to a friend, or a screenshot with live rates | **No** — "any third party" |
| An embedded chart from this feed, shared with anyone | **No** |
| Sending OANDA prices to a third-party LLM API as prompt content | **Ambiguous, and a real exposure.** See below |

### Three consequences to act on

1. **M9 / SEC-4 / decision 5 are settled by the licence, not just by security.** `REQUIREMENTS.md` lists FR-10.6 as BLOCKED on decision 5; the licence resolves it — private-network or authenticated-private is the only compliant option. Treat "public URL with real auth" as acceptable; treat "public URL, obscure path" as a breach.

2. **Clause 15(a)'s "re-transmission from its premises" deserves a lawyer's eye if this ever grows.** A Railway-hosted database in a datacentre, fed from the user's premises, is arguably already re-transmission. For a single-user personal research tool this is a theoretical risk, but record it: it is exactly the clause that would bite if the project were ever commercialised.

3. **Phase 7 (LLM) needs a rule now.** Sending raw OANDA rates into a third-party model's API is at least arguably "providing FXTrade Rates to a third party." Cheap mitigation, and one we want for other reasons anyway (FR-7.2, SEC-8): send the reasoning layer **derived, non-reconstructable** facts — "price is 0.4 ATR below the 20 EMA", "zone held on the retest" — not raw OHLC arrays. Add this as a constraint on the FR-7.2 snapshot schema.

---

## 9. The account-eligibility blocker

This is the one finding that could invalidate ADR-005, and it is not a data question.

**What the documentation says, verbatim:**

> "To use this API you must have a v20 trading account, which is available to all divisions except **OANDA Global Markets** and OANDA TMS BROKERS S.A."
> — [Introduction](https://developer.oanda.com/rest-live-v20/introduction/)

> "Residents of the following countries may apply for an OANDA Global Markets account: Chile, Colombia, Hong Kong, Indonesia, Macao, Malaysia, Mexico, Philippines, Taiwan, **Thailand**, United Arab Emirates, Vietnam."
> — [Check eligible countries](https://help.oanda.com/bvi/en/faqs/eligible-ogm-countries-bvi.htm)

Read together: a Thailand-resident live account lands in the one division that cannot use the API.

**What is not documented:** whether the **fxTrade Practice** signup at [hub.oanda.com/apply/demo](https://hub.oanda.com/apply/demo/) routes a Thailand-declared applicant to OANDA Global Markets or to a v20-capable division. That page is a JavaScript application and its country/division logic is not inspectable without completing the flow. The BVI help-centre API page (`help.oanda.com/bvi/en/faqs/api-access-bvi.htm`) sits behind a JS login wall and returned no readable content.

**Also relevant:** OANDA's CFD eligibility page confirms metals CFDs are unavailable to the US division entirely and are division-dependent elsewhere ([How can I trade CFDs](https://help.oanda.com/ca/en/faqs/trade-cfds-steps.htm)). So even with a working token, `XAU_USD`'s presence must be confirmed — via `GET /v3/accounts/{accountID}/instruments`, documented as returning a list that "is dependent on the regulatory division that the Account is located in" ([Account Endpoints](https://developer.oanda.com/rest-live-v20/account-ep/)).

**This resolves in about ten minutes of the user's time**, and cannot be resolved any other way. See [§11](#11-manual-steps-for-the-user). Until it does, T1.2 onward should not start.

**If it resolves badly**, the options, in order of preference:

1. **A demo account under a v20-capable division.** If the signup allows a different country/division for a *practice* account, this is the cleanest outcome — practice data mirrors production and no funds are involved. Whether that is permissible under OANDA's own terms is a question for OANDA support, not something for us to assume.
2. **Change the reference feed.** This breaks the premise of ADR-005 — the whole point of OANDA is matching `OANDA:XAUUSD` on TradingView. Any substitute must be a feed the user can *also* display on TradingView, or C1 reopens in full.
3. **Accept a non-matching feed and widen tolerances.** Poor. It reintroduces exactly the trust failure audit finding C1 describes.

---

## 10. UNVERIFIED

Everything below could not be confirmed against official documentation. Each entry says what was tried and what would settle it.

| # | Question | What was tried | How to resolve |
|---|---|---|---|
| U1 | **Does a Thailand-declared fxTrade Practice signup yield a v20-capable account?** | Fetched [hub.oanda.com/apply/demo](https://hub.oanda.com/apply/demo/) (JS SPA, no readable content); [BVI API help page](https://help.oanda.com/bvi/en/faqs/api-access-bvi.htm) (JS login wall); searched oanda.com and help.oanda.com | **User completes the demo signup** ([§11](#11-manual-steps-for-the-user)). Decisive and fast |
| U2 | **How far back does `XAU_USD` M15 history actually go?** | OANDA states "Historical pricing dating back to 2005" ([REST API page](https://www.oanda.com/sg-en/platforms/rest-api/)) but for FX generally; no per-instrument depth table exists anywhere in the docs | Empirical binary search once a token exists — see [§12](#12-method-for-establishing-15m-history-depth) |
| U3 | **Candle revision policy — does OANDA ever restate a closed bar?** | Grepped every OANDA docs page retrieved (introduction, development guide, best practices, authentication, troubleshooting, pricing-ep, account-ep, instrument-df) for "revis", "restate", "amend", "correct" — **zero matches** | Cannot be resolved from docs. **Detect it instead:** T1.3's conflicting-upsert rule already raises a `data_quality_event` when a re-fetched candle differs from the stored one. Re-fetch the trailing 7 days nightly for the first month and count the events. That measurement *is* the answer |
| U4 | **Rate-limit enforcement behaviour** — HTTP status on breach, `Retry-After` header, concurrent connection cap, burst allowance | [Best Practices](https://developer.oanda.com/rest-live-v20/best-practices/) gives recommendations (2/s new, 100/s established) and each endpoint states 120 req/s, but nothing describes enforcement. No `429` or "too many requests" text anywhere in the docs | Handle defensively: treat any 4xx/5xx as retryable-with-backoff except 400/401/404. Log the actual status when first hit |
| U5 | **Streaming reconnection semantics** — expected disconnect frequency, documented backoff, disconnect reason codes | Read the [Pricing Endpoints](https://developer.oanda.com/rest-live-v20/pricing-ep/) stream section in full; the 5s heartbeat is the only documented liveness signal | Not documented. Implement our own bounded backoff + jitter (T1.7) and measure real disconnect frequency over the Phase 1 trading week |
| U6 | **API access fees.** The [API License Agreement](https://www.oanda.com/assets/documents/714/API_License_Agreement_OAP.pdf) references "License Fees … as set out in Schedule A", but Schedule A is unpopulated in the published template | No fee is mentioned on any product or developer page | Read Schedule A of the agreement actually presented at token generation |
| U7 | **Exact ICE USDX constant and exponents** for the synthetic index | Fetched [ICE Dollar Index FAQ](https://www.ice.com/publicdocs/futures_us/ICE_Dollar_Index_FAQ.pdf) and [ICE FX Indexes Methodology](https://www.nyse.com/publicdocs/nyse/indices/ICE_FX_Indexes_Methodology.pdf); both are subset-font PDFs whose text could not be extracted programmatically | Open both PDFs in a viewer and read the formula. Not needed before Phase 8 |
| U8 | **Whether the account-independent `/v3/instruments/{instrument}/candles` endpoint is still live** | Present in OANDA's official [OpenAPI spec](https://github.com/oanda/v20-openapi/blob/master/yaml/separate/v20_instrument.yaml) (v3.0.25); its docs page returns HTTP 404 | Moot — use the documented account-scoped endpoint. Recorded only so nobody re-discovers the 404 and assumes the API is broken |
| U9 | **Twelve Data: is `XAU/USD` inside the free tier, or gated behind "Commodities market data"?** | [Forex](https://twelvedata.com/forex) lists gold under precious metals within the forex product and claims "20+ years of historical exchange rates … even with free plans"; [Pricing](https://twelvedata.com/pricing) lists "Commodities market data" as a Grow-tier ($79/mo) feature. The two pages are not reconcilable from the outside | Register a free key and request `XAU/USD` at `15min`. Five minutes, zero cost. Only needed at T1.9 |
| U10 | **Massive (ex-Polygon) free tier: does "end of day only" preclude 15M aggregates?** | [Pricing](https://massive.com/pricing?product=currencies) lists the free Currencies tier as 5 calls/min, 2 years history, "minute aggregates", but characterises the data type as end-of-day | Same — register and try. Only needed at T1.9 |
| U11 | **OANDA uptime figures.** No status page (`status.oanda.com` does not resolve); availability reports found are EU-entity-only and from 2021 | Searched oanda.com for "system availability report" | Accept that we have no uptime SLA. Compensate with T1.8 and T1.9 |

---

## 11. Manual steps for the user

In order:

1. Open an OANDA **fxTrade Practice** account at [hub.oanda.com/apply/demo](https://hub.oanda.com/apply/demo/).
2. Log in to the Account Management Portal → **My Account → My Services → Manage API Access** → generate a personal access token. Read Schedule A of the licence accepted at this step (resolves U6).
3. Run the three verification calls below. They resolve U1, U2 and the `XAU_USD` availability question in one sitting.

**Verification call 1 — does the token work, and what account ID do we have?**
```
GET https://api-fxpractice.oanda.com/v3/accounts
Authorization: Bearer <TOKEN>
```
A 401 here means the account sits in a division without v20 access (U1 resolves badly).

**Verification call 2 — is `XAU_USD` present?**
```
GET https://api-fxpractice.oanda.com/v3/accounts/<ACCOUNT_ID>/instruments
Authorization: Bearer <TOKEN>
```
Search the response for `XAU_USD`. Its absence means the account's regulatory division excludes metals.

**Verification call 3 — does a daily candle match the chart?**
```
GET https://api-fxpractice.oanda.com/v3/accounts/<ACCOUNT_ID>/instruments/XAU_USD/candles
      ?granularity=D&count=5&price=M
      &dailyAlignment=17&alignmentTimezone=America%2FNew_York
Authorization: Bearer <TOKEN>
```
Compare the returned OHLC against the 1D candles on the user's TradingView `OANDA:XAUUSD` chart. This is the C1/C2 parity check, performed before a line of ingestion code exists.

---

## 12. Method for establishing 15M history depth

U2 cannot be answered from documentation. It can be answered exactly, in a handful of requests, by binary search on the `from` parameter.

**Probe:**
```
GET .../instruments/XAU_USD/candles?granularity=M15&count=1&includeFirst=true
      &from=<ISO8601>&price=M
```
An empty `candles` array means no data at or after that instant within the returned window; a populated one means history exists there.

**Procedure:** bracket between 2003-01-01 (assume no data) and 2025-01-01 (assume data), then bisect on year, then month, then day. Roughly 15 requests, comfortably inside a 120 req/s limit. Record the earliest timestamp that returns a bar, and record it **per granularity** — depth for `M15` and depth for `D` need not be the same, and `D` depth is what constrains a 1D EMA200's warmup.

**Then check for holes, not just a start date.** A start date in 2005 is worthless if 2008–2011 is sparse. Fetch monthly bar counts across the whole range and compare against the expected count for a roughly 120-hour trading week (~480 M15 bars/week, ~2,000/month). Any month materially below that is a gap, and gaps inside the backtest window are worse than a shorter window that is complete.

Write both results into this document before T1.4 begins.

---

## 13. What this means for the backtesting window (Phase 9)

Phase 9 requires (FR-9.5, H7, DR-2) that the backtest run on **the same provider as live**. OANDA satisfies this in principle: one provider, one instrument, one alignment convention, live and historical from the same endpoint.

**The window is bounded by three things, in descending order of severity:**

1. **Actual `XAU_USD` M15 depth — unknown (U2).** OANDA's "back to 2005" claim is about FX. Gold is a CFD product and may well have been added later. This is the binding constraint and it is unmeasured. Do not commit to a backtest window in the ADR; commit to measuring it first.

2. **Warmup, not just depth.** `INDICATOR-SPEC.md` requires at least 5× the period before an EMA is trusted — 1,000 bars for EMA200. On 1H that is ~1,000 hours, about six weeks; on 1D it is 1,000 trading days, about **four years**. A five-year 1D history therefore yields roughly one usable year of EMA200-dependent signal. **State the backtest window as *usable* bars after warmup, not as raw history.** This is the most common way a backtest window gets overstated.

3. **Price-regime comparability.** `INDICATOR-SPEC.md` already records gold at ~4,635 against the original spec's 3,420–3,470 worked examples — about 35% in what appears to be a short span. A five-year window spans regimes that are not comparable in absolute dollars. This is not an argument for a shorter window; it is an argument for H3's recommendation that **every threshold be expressed in ATR units**, and for segmenting Phase 9 results by volatility regime (FR-9.6 already segments by several dimensions; add this one).

**Provisional recommendation, to be confirmed once U2 is measured:** target the maximum clean M15 history OANDA holds for `XAU_USD`, expect it to be several years, and report Phase 9 results segmented by year so a regime shift is visible rather than averaged away. If depth proves shorter than about three years, revisit whether a paid historical source is worth breaking the same-provider rule for — the answer is probably still no, because H7's trap is worse than a short window.

---

## 14. Reconciliation source recommendation (T1.9)

FR-1.9 needs a second, independent source to measure divergence. It does not need to be good; it needs to be *independent* and cheap. Both candidates qualify. Neither is ever displayed, so [§8](#8-licence--and-what-we-may-do-with-the-data)'s licence concerns do not transfer to them.

**Recommended: Twelve Data**, subject to U9.

- `XAU/USD` at `15min`, `outputsize` up to 5000 ([docs](https://twelvedata.com/docs))
- Free tier: 8 API credits/minute, 800/day; a time series request costs 1 credit per symbol ([Pricing](https://twelvedata.com/pricing))
- A daily reconciliation of one day's 96 M15 bars is **one request** — 0.125% of the free daily allowance

**Fallback: Massive (formerly Polygon.io)**, subject to U10. `C:XAUUSD`; the free Currencies tier gives 5 calls/min and 2 years of history; Starter is $49/mo for 10+ years and real time ([Pricing](https://massive.com/pricing?product=currencies)). Two years of history is ample for divergence monitoring.

Register a key for whichever passes its verification and record the result here. Do this at T1.9, not now.
