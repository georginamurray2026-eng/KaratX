import { loadConfig } from '@karatx/config'
import { checkDatabase } from '@karatx/db'

/**
 * Readiness. "Can this process do its job?"
 *
 * Fails with 503 when the database is unreachable or the schema does not match
 * the migrations this build ships. A load balancer should stop sending traffic;
 * a supervisor should NOT restart the process, because restarting will not fix
 * a database that is down. See the note in ../health/route.ts.
 *
 * T1.8 adds data freshness here: a feed that stopped an hour ago makes this
 * process unready even though the database is perfectly reachable.
 *
 * No strategy logic, and no market data (F.1). This reads system state only.
 */

// Load-bearing. Without these Next evaluates the route at build time and
// serves a cached 200 forever - a readiness endpoint that always reports ready
// is precisely T0.7's stated risk. `nodejs` because `pg` cannot run on Edge.
// route-dynamic.test.ts fails if either is removed.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const config = loadConfig()
  const database = await checkDatabase(config.databaseUrl.reveal())

  const ready = database.connected && database.migrations?.inSync === true

  return Response.json(
    { status: ready ? 'ready' : 'not_ready', service: 'web', database },
    {
      // 503, not 200-with-a-sad-payload. A monitor that only reads the status
      // code must be able to see this.
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
