# Indicator Specification (Phase 2 reference)

**Status:** Stoch RSI CONFIRMED. EMA CONFIRMED. **Golden fixtures CAPTURED 2026-09-02 (route 1 proven); PARITY NOT YET ASSERTED — obligation 12.**
**Source of truth:** the user's TradingView chart — `OANDA:XAUUSD`, 1H.
**Purpose:** guarantee that the engine's indicator values match what the user sees on their chart (audit finding C3). Divergence here destroys trust in every alert regardless of how good the strategy logic is.

Belongs in `docs/STRATEGY_RULES.md` once the repo exists.

---

## Chart configuration

| Setting | Value |
|---|---|
| Symbol | `OANDA:XAUUSD` (Gold Spot / U.S. Dollar) |
| Execution broker | IC Markets — not a data source, see ADR-005 |
| Daily boundary | 17:00 `America/New_York` — **CONFIRMED** |
| Chart display timezone | UTC+7 (Asia/Bangkok) — display only, never a calculation input |
| User's operating timezone | `Asia/Bangkok` (UTC+7, no DST) |

### Daily boundary — provenance and guard

Confirmed by the user on 2026-08-25 as 17:00 `America/New_York`, matching the standard spot-gold convention.

Stored as an IANA zone, **never as a fixed UTC offset.** This is 21:00 UTC during EDT and 22:00 UTC during EST. Hard-coding either value produces one wrong daily candle at each DST transition, which then corrupts previous-day high/low for the following week.

**Retain as a regression guard in T1.6:** when aggregating 1D from 15M candles, assert our aggregate matches the provider's own daily candle. This is cheap and catches the case where the provider silently changes its alignment default at some future point. Audit finding C2 is closed, but the assertion stays.

### Second, independent confirmation — found in market data, 2026-08-27

**The boundary is now corroborated by two unrelated sources.** The first was the
user reading it off their own TradingView chart. The second came out of Twelve
Data's historical 15M series during the T1.1 re-evaluation, from a provider that
documents no daily convention at all and was not being asked about one.

Measured over 2024-03-15 to 2024-03-18, `XAU/USD` 15min, requested with an
explicit `timezone=UTC`:

| Observation | Bars | UTC | New York (EDT, UTC-4) |
|---|---|---|---|
| Friday's last bar opens | 84 that day | `2024-03-15 20:45` | 16:45, closing at **17:00** |
| Saturday | 0 | — | market closed |
| Sunday's first bar opens | 8 that day | `2024-03-17 22:00` | 18:00 |
| Monday | 92, not 96 | missing `21:00`–`22:00` | **17:00–18:00**, the daily rollover |

Three separate features of the data agree on the same instant. The Friday
session ends at 17:00 NY. The Monday bar count is short by exactly four 15M
bars, and the missing hour is exactly the one following 17:00 NY. The weekly
reopen is one hour after that boundary.

**Why this is worth more than either source alone.** The chart reading and the
API data share no common origin: one is a broker feed rendered by TradingView,
the other a commodity-data vendor whose own default display timezone is
`Australia/Sydney`. Agreement between them is not two readings of the same
number — it rules out the possibility that the convention was an artefact of how
the user's chart happened to be configured.

**A caveat that matters for provider choice.** This structure is present in
Twelve Data's PRE-2025 data only. From 2026 the same symbol returns a flat 96
bars every calendar day, including Saturdays, with no session gaps at all — the
instrument is documented as a 24/7 "COMMODITY" venue. So the corroboration above
is a fact about historical data, and **the boundary is no longer observable in
that series going forward.**

This does not weaken C2 — the convention is confirmed twice and T1.6 imposes it
rather than discovering it. But the T1.6 regression guard described above cannot
rely on a provider's own daily candle agreeing, because a 24/7 series will
produce Saturday and Sunday "days". **The guard must compare against the trading
calendar, not against the provider.** See STATUS.md on calendar-as-authority.

---

## Stoch RSI — CONFIRMED

TradingView **built-in** Stoch RSI. Confirmed from the Inputs panel.

### Inputs

| Parameter | Value |
|---|---|
| K | 3 |
| D | 3 |
| RSI Length | 14 |
| Stochastic Length | 14 |
| RSI Source | Close |
| Timeframe | Chart |
| Wait for timeframe closes | true |

### Formula

```
rsi     = RSI(close, 14)
raw     = 100 * (rsi - lowest(rsi, 14)) / (highest(rsi, 14) - lowest(rsi, 14))
K       = SMA(raw, 3)
D       = SMA(K, 3)
```

Bands for display: upper 80, middle 50, lower 20. Plot colours: K blue, D orange.

### Implementation traps — these are the whole reason this document exists

**1. RSI uses Wilder's smoothing (RMA), not EMA.**
RMA with period 14 uses `α = 1/14`. An EMA with period 14 uses `α = 2/15`. Both look plausible on a chart; they produce crossovers that fire a bar apart. Implement RMA:

```
rma[i] = (rma[i-1] * (n - 1) + value[i]) / n
```

Seed the first RMA with the SMA of the first `n` values, matching TradingView.

**2. %D is smoothed from %K, not from the raw stochastic.**
Many libraries derive both from `raw`. That produces a %D that is subtly wrong in precisely the situations Part 4 of the spec cares about — whether both lines are "clearly directional" or "relatively flat" after a crossover.

**3. Division by zero when `highest(rsi,14) == lowest(rsi,14)`.**
Occurs in dead-flat conditions. TradingView's behaviour must be verified; do not silently emit 0, 50 or 100 without checking. Add an explicit test for the flat-market case (required by §12 anyway).

> **STILL UNVERIFIED as of 2026-09-02 — and the 2026-09-02 capture does NOT settle it, despite looking like it does.**
>
> The 15m fixture contains bars where `k` is **exactly 0** (i = 5908, 6082, 6083, 6120) and **exactly 100** (ten bars, including three consecutive at i = 6160-6162). It is tempting to read those as trap 3 observed. **They are not.**
>
> `k = 0` is the NORMAL result when RSI sits at its own 14-period low — `raw = 100 * (rsi - lowest) / (highest - lowest)` is legitimately zero, with no division by zero anywhere. The bar context confirms it: at i = 6082-6083 close falls 4383 → 4375 → 4370, and at i = 5908 it falls 4603 → 4600 → 4598. **Those are trending markets hitting a period low, which is the opposite of the dead-flat condition trap 3 describes.** `d` is never exactly 0 in the capture, as expected — it is a 3-period SMA of `k`.
>
> **What the capture DOES establish, and it is worth having:** the boundary values 0 and 100 occur in ordinary data and are EXACT. An engine that produces `1.4e-15` instead of `0`, or `99.9999999997` instead of `100`, disagrees with TradingView on 14 of 299 bars. That is a real parity requirement and it is now evidenced.
>
> **Trap 3 itself remains open.** Confirming it needs a window where RSI is genuinely constant across 14 bars, which this capture does not contain. Do not mark it verified on the strength of the zeros above — that would be concluding from a symptom that has a second, likelier cause.

**4. Warmup.** RSI(14) then Stoch(14) then two 3-period SMAs. Emit no value until at least `14 + 14 + 3 + 3` bars exist, and per the audit's warmup rule prefer a substantially longer margin before treating values as trustworthy.

---

## EMA — CONFIRMED

Indicator in use: **"EMA 20/50/100/200" by "dr sweeps"** — a bundled community Pine script.

**Verified 2026-08-25:** its length-20 output is identical to TradingView's built-in *Moving Average Exponential* at length 20 on the same chart. The script calls standard `ta.ema`. Implement the standard TradingView EMA formula; no special handling required for the community script.

### Formula

```
α       = 2 / (n + 1)
ema[i]  = α * close[i] + (1 - α) * ema[i-1]
ema[0]  = SMA(close, n)        ← TradingView seeds with SMA, NOT the first close
```

Periods: 20, 50, 100, 200. Source: Close.

**Seeding is the trap.** Seeding with the first close instead of an SMA produces an error that persists for hundreds of bars on the 200 EMA — long enough to look right in a spot check and be wrong in a backtest.

**Warmup:** require at least 5× the period before treating an EMA as valid. For EMA200 that is 1000 bars, and the historical backfill must cover it before the engine emits any EMA200-dependent output.

---

## Golden values — fixture seed

Captured 2026-08-25 ~17:06 UTC+7, `OANDA:XAUUSD` 1H.

| Field | Value |
|---|---|
| Bar OHLC | O 4,636.455 · H 4,637.290 · L 4,633.175 · C 4,635.065 |
| EMA 20 | 4,640.984 |
| EMA 50 | 4,618.537 |
| EMA 100 | 4,567.144 |
| EMA 200 | 4,489.979 |
| Stoch RSI %K | 13.26 |
| Stoch RSI %D | 11.58 |
| Bid / Ask | 4,634.560 / 4,635.080 (spread 0.52) |

Sanity read: bullish EMA stack (20 > 50 > 100 > 200) with price pulled back below the 20; Stoch RSI deeply oversold with K above D. Internally coherent.

**This is a spot check, not a test fixture.** It was read off the chart legend at three decimal places.

---

## ROUTE 1 IS PROVEN — real fixtures captured 2026-09-02

**Obligation 12's recorded blocker is resolved.** *Export chart data* is a paid feature we do not have; **Pine `log.info` works instead**, via `tools/tradingview/karatx-golden-export.pine`. Routes 2 (buy a month of TradingView) and 3 (transcribe ~20 bars by hand) are no longer needed.

**Committed at `test/fixtures/tradingview/`, 299 consecutive bars each:**

| File | `i` range | `tf` |
|---|---|---|
| `karatx-golden-15m.txt` | 5903 – 6201 | `"15"` |
| `karatx-golden-1H.txt` | 9575 – 9873 | `"60"` |
| `karatx-golden-1D.txt` | 14541 – 14839 | `"1D"` |

### What was VERIFIED, rather than assumed

- **Historical bars DO log.** This was the open question that decided whether the route worked at all; `i` starts thousands of bars before the live edge.
- **`t` is a plain 13-digit integer** on all 897 lines — *checked, not assumed*. Pine could have rendered ~1.79 × 10¹² in scientific notation and produced well-formed-looking, unparseable JSON.
- **`i` is consecutive with no gaps and no duplicates**, verified as `max - min + 1 == unique count` rather than by a sorted-order glance: sorting looks correct when a gap and a duplicate cancel out.
- **Full precision: 8–10 decimal places**, against the legend's 3.
- Every `t` round-trips to its own `iso`; all 15 fields present on every line; **zero null indicator values**, so every bar is past warmup.

### THE FILE FORMAT, and the parser rule

Not the log-pane paste that was expected — **TradingView's CSV export**: a `Date,Message` header, then each row is an ISO date, a comma, and the JSON payload as a **CSV-quoted field with doubled-quote (`""`) escaping**. Unescape before `JSON.parse`.

> **USE THE JSON `t` OR `iso` FOR THE BAR TIME. NEVER THE `Date` COLUMN OR A LOG PREFIX.**
>
> The Pine Logs **pane** shows **wall-clock emit time**; the CSV **export** writes **bar time**. Two different fields that look alike. In these three files they agree on all 897 lines — **that is a property of the export format, not a guarantee.** A pane paste shows the divergence directly: a bar with `"iso":"2026-09-02T15:00:00Z"` was emitted at prefix `15:15:00.589`, fifteen minutes later, because `barstate.isconfirmed` fires at bar close.

The engine must reproduce these within a documented tolerance. **Any bar that fails is a bug in our implementation, not in TradingView.**

### Still unproven, and both are tracked

- **PARITY. Nothing has been asserted yet.** Having something to compare against is necessary and insufficient. Obligation 12 stays open and is narrowed to "parity not yet asserted".
- **The engine needs ~1000 bars of history BEFORE the first golden bar** to reproduce EMA200 — obligation 41. These files are expected OUTPUT and contain no input history.
- **The 300-row export cap is an INFERENCE, not a measurement.** All three files came back at 299 data rows + 1 header while the script requested 300, and identical counts across three different timeframes is not chance. But every capture requested 300, so a cap of exactly 300 has never been distinguished from any other explanation. **One re-run at `logLastNBars = 500` would settle it — tracked as obligation 42, which blocks obligation 40's longer capture.** Until then, do not record 300 as the limit.

---

## Note on price regime

At capture, gold was ~4,635. The original build specification's worked examples used 3,420–3,470 — roughly 35% lower.

This is direct evidence for audit finding H3's recommendation: **express every threshold in ATR units, never in absolute dollars.** A rule reading "sufficient room = 15 points" would already be obsolete, and backtests spanning both regimes would not be comparable. Applies to zone width, equal-high tolerance, breakout margin, stop buffer, and room-to-target.
