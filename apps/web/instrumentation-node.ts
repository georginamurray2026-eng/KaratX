/**
 * The Node-only half of boot-time configuration validation.
 *
 * Kept in its own module so `instrumentation.ts` contains no Node API at all.
 * Turbopack compiles instrumentation.ts for the Edge runtime as well as Node
 * and statically warns about every Node API it finds there - even behind a
 * runtime guard, because the analysis is static. Six build warnings on every
 * build train people to stop reading build output.
 */
export async function validateConfiguration(): Promise<void> {
  // ---------------------------------------------------------------------
  // THE TRY WRAPS THE WHOLE BOOT SEQUENCE, NOT ONE CALL INSIDE IT.
  //
  // A GUARD AROUND ONE CALL IS NOT A GUARD AROUND A CONTRACT. The contract
  // here is "any failure in boot exits non-zero". An earlier version guarded
  // `loadConfig()` specifically, because a bad environment was the failure
  // being thought about when it was written - and left everything else in the
  // same function unprotected.
  //
  // That was not theoretical. `loadEnvFileIfPresent()` sat OUTSIDE the try,
  // and `findRepoRoot` throws when its upward walk fails. Under Next's
  // bundling `import.meta.url` points inside `.next/`, so the walk can fail -
  // and the throw propagated out of `register()`, where Next SWALLOWS it. The
  // result is the exact T0.7 failure the exit below exists to prevent,
  // reached by a path the T0.7 fix did not cover.
  //
  // Guard the SCOPE the property covers, not the line that prompted it.
  // ---------------------------------------------------------------------
  try {
    // Local development keeps the connection string in a git-ignored `.env` at
    // the repository root. Deployed environments have no such file and inject
    // variables directly, so this loads it only if present rather than
    // requiring it - and an explicitly-set variable wins over the file, which
    // is Node's own `loadEnvFile` precedence.
    //
    // It no longer throws when the repository root cannot be found: an absent
    // `.env` is the normal deployed case. It writes an explicit notice to
    // stderr instead, so a failed walk stays distinguishable from a correctly
    // absent file (STATUS.md obligation 19).
    const { loadConfig, loadEnvFileIfPresent } = await import('@karatx/config')

    loadEnvFileIfPresent()
    loadConfig()
  } catch (error) {
    // ConfigValidationError lists every problem at once and never echoes a
    // received value, so this is safe to print even though DATABASE_URL
    // carries a password. Written to stderr directly because no logger exists
    // yet at this point in the boot - that is the whole point of being here.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    process.stderr.write(`\nFATAL: ${message}\n\n`)

    // ---------------------------------------------------------------------
    // DO NOT REMOVE THIS EXIT.
    //
    // Without it, Next.js CATCHES this error and keeps serving. Measured, not
    // assumed - the server logs:
    //
    //     ✓ Ready in 398ms
    //     Failed to prepare server: An error occurred while loading
    //     instrumentation hook: Invalid environment configuration
    //
    // Note the order. "✓ Ready" prints BEFORE the failure. The process stays
    // alive, binds its port, accepts connections, and returns HTTP 500 to
    // every request - indefinitely.
    //
    // That means every signal a platform uses to judge a deployment reports
    // success: Railway sees a healthy service, a TCP health check passes, a
    // log scraper watching for the ready line finds it. It is not a weaker
    // guarantee than SEC-2 wants; it is a deployment that lies about having
    // worked.
    //
    // Worst of all, /api/health returns 500 - an endpoint DEFINED as touching
    // nothing, contradicting its own contract. The one check guaranteed not to
    // fail for external reasons, failing.
    //
    // With this exit, the process refuses to run: Railway sees a failed
    // deploy, a supervisor sees a crash loop with a legible reason, and no
    // load balancer ever routes to it.
    //
    // instrumentation.integration.test.ts fails if this is removed.
    // ---------------------------------------------------------------------
    process.exit(1)
  }
}
