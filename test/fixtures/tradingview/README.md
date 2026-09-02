# TradingView golden values

Captured 2026-09-02 from `OANDA:XAUUSD` via `tools/tradingview/karatx-golden-export.pine`
(obligation 12, route 1 — Pine `log.info`). 299 consecutive bars per timeframe.

**The format, the parser rule and what is still unproven are documented in
[`docs/INDICATOR-SPEC.md`](../../../docs/INDICATOR-SPEC.md).** They are deliberately
not restated here: two copies of one fact is what obligation 25 spent a day
removing.

The one thing worth repeating where the files are:

**Use the JSON `t` or `iso` for the bar time. NEVER the `Date` column.** They
agree in these three files, and that agreement is a property of the CSV export,
not something to rely on — the Pine Logs *pane* shows wall-clock emit time
instead.
