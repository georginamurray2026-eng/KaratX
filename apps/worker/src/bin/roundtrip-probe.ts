/**
 * Round-trip latency against the local database — the primitive OQ-24 is built
 * from.
 *
 * Run: pnpm probe:roundtrip
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS IN THE REPOSITORY RATHER THAN IN SOMEONE'S SHELL HISTORY
 * ---------------------------------------------------------------------------
 *
 * OQ-24 quotes **1.1723 ms** for `SELECT 1` and **1.3040 ms** for the provider
 * lookup, and builds its whole write-cost prediction on them. Those numbers came
 * from a script that was written, run once, and deleted — so the figures were
 * reproducible in principle and not in practice, and a later session would have
 * had to rewrite the measurement before it could repeat it.
 *
 * **OQ-22's caching work needs a BEFORE AND AFTER on exactly this measurement.**
 * The threshold it crossed — ~52.6 s of provider lookups, 24.1% of wall clock —
 * is `count x this number`. Showing the cache helped means measuring the same
 * thing the same way, and "the same way" has to be a file rather than a memory.
 *
 * ---------------------------------------------------------------------------
 * THE METHOD IS UNCHANGED AND MUST STAY THAT WAY
 * ---------------------------------------------------------------------------
 *
 * This is byte-for-byte the procedure that produced OQ-24's figures: 300 warmup
 * iterations, then 3,000 timed iterations of each query, on a SINGLE pooled
 * connection, timed with `Date.now()` around the loop rather than per call.
 *
 * **Changing any of that invalidates the comparison it exists to support.** A
 * different `N`, a fresh connection per query, or per-call timing would each
 * produce a defensible number that could not be held against 1.1723 ms. If a
 * better method is wanted, add it alongside and keep this one.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE NUMBER IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * 1.17 ms for `SELECT 1` is SLOW for a local server, and that is the
 * ENVIRONMENT rather than the query: PostgreSQL is in a Docker container
 * reached over localhost TCP on Windows. The same code against a unix socket or
 * a co-located server would be substantially faster. **This figure does not
 * transfer between machines, and a comparison across two of them means
 * nothing.** Re-measure on the machine you are reasoning about.
 *
 * It is also measured OUT OF CONTEXT — a tight loop doing nothing else. OQ-24
 * says so plainly where it multiplies this by a row count, and that estimate has
 * never been checked against an in-situ split.
 */
import { findRepoRoot, loadConfig, loadEnvFileIfPresent } from '@karatx/config'
import { Pool } from 'pg'

/** Timed iterations per query. Changing this breaks comparability with OQ-24. */
const N = 3000
/** Warmup iterations, discarded. */
const WARMUP = 300

const main = async (): Promise<void> => {
  loadEnvFileIfPresent(findRepoRoot())
  const pool = new Pool({ connectionString: loadConfig().databaseUrl.reveal() })
  const client = await pool.connect()
  try {
    for (let i = 0; i < WARMUP; i += 1) await client.query('SELECT 1')
    let t = Date.now()
    for (let i = 0; i < N; i += 1) await client.query('SELECT 1')
    const trivial = (Date.now() - t) / N
    t = Date.now()
    for (let i = 0; i < N; i += 1)
      await client.query('SELECT id FROM providers WHERE key = $1', ['karatx_derived'])
    const lookup = (Date.now() - t) / N
    process.stdout.write(
      `SELECT 1            ${trivial.toFixed(4)} ms/round trip\n` +
        `providers by key    ${lookup.toFixed(4)} ms/round trip\n` +
        `n = ${String(N)} each, single pooled connection, warmed\n\n` +
        `  OQ-24 recorded 1.1723 and 1.3040 on 2026-09-08. A figure far from\n` +
        `  those on the SAME machine means the environment changed, not the code.\n`,
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
})
