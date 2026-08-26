# test/fixtures

Committed test data, loaded via `@karatx/test-support`.

The Phase 1 golden datasets land here: TradingView exports of XAU/USD at 15M,
1H and 1D with indicators applied, used to prove the engine reproduces the
user's chart within a documented tolerance (TEST-1, TEST-13, audit finding C3).

`sample/` holds the small files that prove the loader itself works. Real
fixtures get their own directories.
