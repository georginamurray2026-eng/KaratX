import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repository-root `.env` into process.env, if it exists.
 *
 * Uses Node's built-in `process.loadEnvFile` rather than a dotenv dependency.
 *
 * "If it exists" is deliberate. Locally the file is the source of the
 * connection string; on Railway there is no `.env` at all and the platform
 * injects the environment directly, so a hard requirement here would work in
 * development and fail in deployment.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const envPath = path.join(repoRoot, '.env')

if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
}
