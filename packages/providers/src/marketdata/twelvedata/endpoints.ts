/**
 * Every Twelve Data endpoint this adapter can reach, in one table.
 *
 * THE TABLE IS THE POINT, NOT THE CONVENIENCE. ADR-008 records three adapter
 * requirements that are each a silent-corruption bug if missed, and two of them
 * are properties of EVERY request. The tests that enforce those requirements
 * iterate this table, so adding a fourth endpoint without the auth header or
 * without `timezone=UTC` is a test failure rather than an omission nobody
 * notices.
 *
 * A hand-written list in the test file would drift the moment someone adds an
 * endpoint here and not there - and the failure mode of that drift is a request
 * that quietly carries its key in the URL, or one that returns bars ten hours
 * out of position.
 *
 * Only endpoints ACTUALLY EXERCISED against the live API during T1.1 are
 * listed. `symbol_search` and the rest are real but have no consumer, and an
 * entry here asserts that we know how the endpoint behaves.
 */
export const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com' as const

export const TWELVEDATA_ENDPOINTS = {
  /**
   * Historical and recent bars. The backfill's only endpoint.
   *
   * Measured 2026-08-27: returns up to 5,000 bars in one response, newest
   * first. Both of those are properties this adapter asserts rather than
   * assumes - see `assertAscending` and the ordering tests.
   */
  timeSeries: '/time_series',

  /**
   * The oldest bar available for a symbol and interval.
   *
   * Measured 2026-08-27: XAU/USD at 15min begins 2020-01-24 13:00, verified by
   * then requesting that day and getting real bars. Kept because the backfill's
   * start bound should be checked against the provider's own answer rather than
   * against a date copied out of an ADR.
   */
  earliestTimestamp: '/earliest_timestamp',
} as const

export type TwelveDataEndpoint = (typeof TWELVEDATA_ENDPOINTS)[keyof typeof TWELVEDATA_ENDPOINTS]

/** Every endpoint path, for the tests that must cover all of them. */
export const ALL_TWELVEDATA_ENDPOINTS: readonly TwelveDataEndpoint[] =
  Object.values(TWELVEDATA_ENDPOINTS)
