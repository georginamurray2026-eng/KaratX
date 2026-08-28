import { Client, Pool } from 'pg'
import { describe, expect, inject, it } from 'vitest'

import { Lifecycle } from './lifecycle'

/**
 * Pool closure, against a REAL database. STATUS.md obligation 21.
 *
 * THE DEFECT THIS FIXES. `lifecycle.test.ts` registers a hook NAMED
 * `database-pool` that pushes a string to an array. Thirty-three passing tests,
 * not one of them touching a connection. It reads as coverage of connection
 * handling; it is coverage of ordering. Same family as `verifyNotInTransaction`
 * and the `limit=200` Saturday query: a thing that looks like the check you
 * want, standing where that check should be.
 *
 * Runs on every platform. It tests `pool.end()`, not signal delivery, so
 * Windows' inability to deliver a catchable SIGTERM is irrelevant here.
 */

/** Backends attached to a database, seen from OUTSIDE the pool under test. */
async function backendCount(observer: Client, datname: string): Promise<number> {
  const result = await observer.query<{ count: string }>(
    // Excludes the observer's own connection: it is attached to the same
    // database and would otherwise be counted as a leak.
    'select count(*)::text as count from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [datname],
  )
  return Number(result.rows[0]?.count ?? '0')
}

/**
 * Wait for a condition, polling.
 *
 * NOT a sleep. `pg_stat_activity` does not necessarily reflect a closed backend
 * the instant `end()` resolves, and the honest options are to poll for a bounded
 * time or to sleep an arbitrary amount until it goes green. The second turns the
 * assertion back into decoration - it would pass for a pool that never closed,
 * given a long enough nap.
 *
 * Returns the last observed value either way, so the caller asserts on a real
 * reading rather than on a timeout.
 */
async function pollUntil(
  read: () => Promise<number>,
  predicate: (value: number) => boolean,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let last = await read()
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await read()
  }
  return last
}

describe('closing the database pool on shutdown', () => {
  it('releases every backend, verified in pg_stat_activity', async () => {
    const url = inject('migratedUrl')
    const datname = new URL(url).pathname.slice(1)

    // A separate connection, deliberately NOT from the pool under test. Asking
    // the pool whether it closed itself would be asking the thing under test to
    // report on itself.
    const observer = new Client({ connectionString: url })
    await observer.connect()

    try {
      const pool = new Pool({ connectionString: url, max: 3 })

      // Force real backends: three concurrent queries, so the pool opens more
      // than one connection rather than lazily reusing a single client.
      await Promise.all([pool.query('select 1'), pool.query('select 2'), pool.query('select 3')])

      // ---------------------------------------------------------------------
      // POSITIVE CONTROL. DO NOT DELETE THIS ASSERTION.
      //
      // "Zero backends after shutdown" is meaningless unless this query can see
      // backends when they exist. A broken query - wrong datname, wrong column,
      // insufficient privileges - returns 0 here AND 0 below, and the test
      // passes while verifying nothing.
      //
      // This is the rule that caught instance 8: an absence result needs a
      // positive control using the same query shape.
      // ---------------------------------------------------------------------
      const before = await backendCount(observer, datname)
      expect(
        before,
        'POSITIVE CONTROL FAILED: could not observe any backend while the pool was ' +
          'demonstrably open. The pg_stat_activity query is broken, so the ' +
          '"zero afterwards" assertion below would prove nothing.',
      ).toBeGreaterThan(0)

      // Registered exactly as boot.ts does it.
      const lifecycle = new Lifecycle()
      lifecycle.onShutdown('database-pool', async () => {
        await pool.end()
      })

      const clean = await lifecycle.shutdown('test')
      expect(clean).toBe(true)

      const after = await pollUntil(
        () => backendCount(observer, datname),
        (n) => n === 0,
      )

      expect(
        after,
        `the pool did not release its connections: ${String(after)} backend(s) still ` +
          `attached to ${datname} after shutdown resolved`,
      ).toBe(0)
    } finally {
      await observer.end()
    }
  })
})
