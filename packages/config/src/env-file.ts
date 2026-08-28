import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loading the repository-root `.env` into `process.env`.
 *
 * Lives here rather than in each entry point because three copies of it
 * already existed by T0.8 - the web instrumentation hook, the `db:migrate`
 * CLI, and `@karatx/test-support` - and they had drifted apart. One located
 * the repository root by counting `..` segments, the exact fragility that
 * test-support's own comment warns about; one carried a hand-rolled
 * precedence loop that Node makes unnecessary (see below). A fourth copy was
 * not worth writing.
 */

/** Marker that identifies the repository root. */
const ROOT_MARKER = 'pnpm-workspace.yaml'

/** Depth limit, so a missing marker fails fast instead of walking to `/`. */
const MAX_ASCENT = 12

/**
 * Find the repository root by walking upwards until the workspace file appears.
 *
 * Searching for a marker rather than counting `..` segments: a fixed count is
 * correct exactly until the file moves, and then it resolves to the wrong
 * directory silently instead of failing.
 *
 * Starts from this module's own location, not `process.cwd()`. The working
 * directory depends on how the process was launched - `pnpm --filter` and a
 * platform start command disagree - whereas the module's position in the
 * repository is fixed.
 */
export function findRepoRoot(
  startDir: string = path.dirname(fileURLToPath(import.meta.url)),
): string {
  let current = path.resolve(startDir)

  for (let ascent = 0; ascent < MAX_ASCENT; ascent += 1) {
    if (existsSync(path.join(current, ROOT_MARKER))) return current

    const parent = path.dirname(current)
    // At the filesystem root, `dirname` returns its input.
    if (parent === current) break
    current = parent
  }

  throw new Error(
    `Could not find the repository root: no ${ROOT_MARKER} in ${startDir} or its parents (searched up to ${String(MAX_ASCENT)} levels).`,
  )
}

/**
 * Load the repository-root `.env`, if there is one.
 *
 * "If there is one" is deliberate rather than lenient. Locally the file is
 * where the connection string comes from; a deployed environment has no `.env`
 * at all and the platform injects variables directly. Requiring the file would
 * work in development and fail on deploy.
 *
 * AN EXPLICITLY-SET VARIABLE WINS OVER THE FILE, and `loadEnvFile` already
 * does that itself - documented for `--env-file` and measured on Node 24.19.0
 * during T0.8. That matters: it is what lets `DATABASE_URL=... pnpm
 * db:migrate` target a database other than the one `.env` names, and it is
 * what keeps a deployed platform's injected environment reproducible locally.
 *
 * An earlier version of this function re-applied that precedence by hand,
 * having assumed the opposite. The loop could never change an outcome, and a
 * mutation test proved it: deleting it broke nothing. It was removed rather
 * than left in as insurance - a safeguard that cannot fire is worse than none,
 * because it reads as evidence of a hazard that does not exist. The dependency
 * on Node's behaviour is pinned by a test in env-file.test.ts instead, so a
 * change in Node surfaces as a failure rather than as a silent switch.
 *
 * @returns the path loaded, or undefined if there was no file.
 */
export function loadEnvFileIfPresent(repoRoot?: string, startDir?: string): string | undefined {
  let root = repoRoot

  if (root === undefined) {
    try {
      // `startDir` exists so a test can force the walk to FAIL without changing
      // the process working directory. The failure path is the one that
      // matters here and it is otherwise unreachable from inside the repo.
      root = startDir === undefined ? findRepoRoot() : findRepoRoot(startDir)
    } catch {
      // NOT FATAL, AND NOT SILENT.
      //
      // The `.env` is optional by design - a deployed environment has none and
      // injects variables directly. "I could not locate a repository root" and
      // "there is no .env here" therefore have the same correct outcome:
      // proceed with whatever the platform injected.
      //
      // But they are not the same EVENT, and the difference is diagnostic. On
      // Railway this line's presence says the upward walk failed, which is
      // exactly what STATUS.md obligation 19 exists to detect: `apps/web`
      // resolves the root from a module Next has bundled, so `import.meta.url`
      // points inside `.next/`. Without this notice, a failed walk and a
      // correctly-absent file are indistinguishable.
      //
      // `findRepoRoot` itself still THROWS. Its contract is "find this or
      // fail", @karatx/test-support depends on that, and only this
      // optional-file wrapper softens it.
      process.stderr.write(
        'No repository root found (no pnpm-workspace.yaml above this module), ' +
          'so no .env was loaded. Proceeding with injected environment variables only. ' +
          'This is expected on a deployed platform and unexpected locally.\n',
      )
      return undefined
    }
  }

  const envPath = path.join(root, '.env')
  if (!existsSync(envPath)) return undefined

  process.loadEnvFile(envPath)
  return envPath
}
