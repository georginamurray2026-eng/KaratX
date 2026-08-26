/**
 * Liveness. "Is this process running?" - nothing more.
 *
 * NFR-7 requires health and readiness to be distinguishable, and the
 * distinction is operational, not cosmetic:
 *
 *   /api/health  Is the process alive? A failure here means RESTART ME.
 *                It must touch nothing external, so it cannot fail for a
 *                reason a restart would not fix.
 *
 *   /api/ready   Can the process do its job? A failure here means STOP
 *                SENDING ME TRAFFIC. It checks the database, and later data
 *                freshness (T1.8).
 *
 * Wiring a restart policy to a check that fails when the database is down
 * produces a crash loop during a database incident - restarting a healthy
 * process repeatedly while the actual problem is elsewhere. That is why this
 * endpoint deliberately checks nothing.
 */

// Both directives are load-bearing. Next would otherwise evaluate this route
// at build time and serve a cached response forever - a health endpoint that
// cannot report ill health, which is worse than having none at all (T0.7's
// stated risk). A test asserts these are still present; see
// route-dynamic.test.ts.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'web' },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}
