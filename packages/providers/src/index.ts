/**
 * `@karatx/providers` - adapters for market data, calendar, news, LLM and
 * notifications.
 *
 * Every external response is validated at this boundary before it enters the
 * domain (SEC-3). Malformed input is quarantined, never repaired (section 7).
 *
 * The market-data adapter lands in T1.4/T1.7 against OANDA v20 (ADR-005).
 */

export const PROVIDERS_PACKAGE_NAME = '@karatx/providers' as const
