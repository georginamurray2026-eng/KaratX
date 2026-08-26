/**
 * Runs once when the server starts, before any request is served.
 *
 * This is where configuration is validated. SEC-2 requires the system to fail
 * fast and loudly on bad configuration, and T0.3 recorded "config fails before
 * any other work" as unproven precisely because nothing had a boot sequence
 * until now.
 *
 * Validating inside a route handler would be materially weaker: Next evaluates
 * route handlers lazily, so a broken environment would surface as a 500 on
 * whichever endpoint happened to be hit first, rather than as a refusal to
 * start. `register()` is the only hook that runs before serving.
 *
 * This file contains NO Node API. Next compiles it for the Edge runtime too,
 * and statically warns about every Node API it finds - even behind a runtime
 * guard, because the analysis is static rather than a reachability check. The
 * Node-only work therefore lives in ./instrumentation-node, imported only on
 * the Node runtime. Both routes pin `runtime = 'nodejs'`, so no Edge instance
 * exists whose configuration would need validating.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return

  const { validateConfiguration } = await import('./instrumentation-node')
  await validateConfiguration()
}
