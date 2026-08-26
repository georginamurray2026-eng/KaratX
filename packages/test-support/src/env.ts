/**
 * Repository-root discovery and `.env` loading, for tests.
 *
 * Both live in `@karatx/config` now and are re-exported here rather than
 * reimplemented. By T0.8 four copies of this logic existed and had already
 * drifted: only one applied the "an explicitly-set variable wins over the
 * file" rule, and one located the root by counting `..` segments - the exact
 * fragility the tests below were written to catch.
 *
 * The re-export is deliberate rather than a redirect for callers to follow.
 * Test files keep importing `@karatx/test-support`, which is what
 * `packages/core`'s tests are permitted to import; pointing them at
 * `@karatx/config` instead would widen that exemption for no benefit.
 */
export { findRepoRoot } from '@karatx/config'

/**
 * Load the repository-root `.env` into `process.env`, if it exists.
 *
 * @returns the path loaded, or undefined if there was no file.
 */
export { loadEnvFileIfPresent as loadRepoEnv } from '@karatx/config'
