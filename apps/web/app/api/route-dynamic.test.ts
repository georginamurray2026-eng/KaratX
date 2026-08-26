import { describe, expect, it } from 'vitest'

import * as health from './health/route'
import * as ready from './ready/route'

/**
 * ============================================================================
 * IF THIS TEST IS FAILING, PLEASE READ THIS BEFORE CHANGING ANYTHING.
 * ============================================================================
 *
 * It does not test what the endpoints return. It tests that Next.js is still
 * being told to evaluate them on every request.
 *
 * Next.js will statically evaluate a route handler at build time and serve the
 * result from cache. For a health endpoint that is catastrophic in a quiet
 * way: /api/ready would be rendered once during the build, when the database
 * happened to be reachable, and would then answer "ready" forever - including
 * throughout an outage. Nothing would appear broken. The endpoint would simply
 * stop being connected to reality.
 *
 * T0.7 names this exactly: "health endpoints that always return 200 are worse
 * than none."
 *
 * `export const dynamic = 'force-dynamic'` is what prevents it. It looks like
 * a stray line an optimiser would remove, which is why this test exists.
 *
 * THE FIX IS TO RESTORE THE EXPORT, NOT TO DELETE THIS TEST.
 *
 * Confirm separately in `next build` output. The route table is ground truth;
 * the directive is only an intention:
 *
 *     ├ ƒ /api/health        <- ƒ Dynamic, correct
 *     └ ƒ /api/ready
 *
 *     ○ /api/ready           <- Static. The endpoint is now a cached lie.
 * ============================================================================
 */

const WHY =
  'Next.js would evaluate this route at build time and serve a cached response forever. /api/ready would answer "ready" throughout a database outage, because it was rendered once when the database happened to be up. A health endpoint that cannot report ill health is worse than no health endpoint (T0.7). Restore the export - do not delete this test. Verify in `next build`: the route must appear as "ƒ (Dynamic)", not "○ (Static)".'

describe('health endpoints are never statically cached', () => {
  it.each([
    ['/api/health', health],
    ['/api/ready', ready],
  ])('%s exports dynamic = force-dynamic', (name, route) => {
    expect(
      (route as { dynamic?: string }).dynamic,
      `${name} NO LONGER OPTS OUT OF STATIC RENDERING.\n\n${WHY}`,
    ).toBe('force-dynamic')
  })

  it.each([
    ['/api/health', health],
    ['/api/ready', ready],
  ])('%s runs on the nodejs runtime', (name, route) => {
    expect(
      (route as { runtime?: string }).runtime,
      `${name} IS NO LONGER PINNED TO THE NODEJS RUNTIME.\n\n` +
        'The Edge runtime cannot run `pg`, so /api/ready would fail to connect. ' +
        'Both routes are pinned so they behave identically and neither can drift ' +
        'onto a runtime that silently changes what is available.',
    ).toBe('nodejs')
  })
})

describe('/api/health touches nothing external', () => {
  it('responds without a database, config, or any async work', async () => {
    // The distinction that makes two endpoints worth having: liveness must not
    // fail for a reason a restart would not fix. If this ever needs awaiting or
    // an environment, it has stopped being a liveness check.
    const response = health.GET()

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'web' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
