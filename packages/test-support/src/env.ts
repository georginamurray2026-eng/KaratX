import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Marker that identifies the repository root. */
const ROOT_MARKER = 'pnpm-workspace.yaml'

/** Depth limit, so a missing marker fails fast instead of walking to `/`. */
const MAX_ASCENT = 12

/**
 * Find the repository root by walking upwards until the workspace file appears.
 *
 * The previous version of this helper computed the root as `'..', '..', '..'`
 * relative to its own location. That is correct exactly until the file moves -
 * which it just did - and then it silently resolves to the wrong directory
 * rather than failing. Searching for a marker is stable wherever this lives.
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
 * Load the repository-root `.env` into `process.env`, if it exists.
 *
 * Uses Node's built-in `process.loadEnvFile` rather than adding a dotenv
 * dependency.
 *
 * "If it exists" is deliberate rather than lenient. Locally the file is where
 * the connection string comes from; a deployed environment has no `.env` at
 * all and the platform injects variables directly. Requiring the file would
 * work in development and fail in deployment.
 *
 * @returns the path loaded, or undefined if there was no file.
 */
export function loadRepoEnv(): string | undefined {
  const envPath = path.join(findRepoRoot(), '.env')
  if (!existsSync(envPath)) return undefined

  process.loadEnvFile(envPath)
  return envPath
}
