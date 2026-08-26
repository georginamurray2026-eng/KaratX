import type { NextConfig } from 'next'

const config: NextConfig = {
  /**
   * Workspace packages export TypeScript source rather than compiled JS - the
   * T0.1 decision that lets `pnpm typecheck` run with no build step. Next must
   * therefore transpile them itself; without this it receives `.ts` it will not
   * compile and fails at build time.
   *
   * This was flagged as a consequence when that decision was made.
   */
  transpilePackages: ['@karatx/core', '@karatx/contracts', '@karatx/config', '@karatx/db'],

  // Surfaces type errors at build time rather than letting a broken build
  // ship. `pnpm typecheck` checks this too, but a build that quietly ignores
  // type errors is a build that can deploy something broken.
  //
  // There is no `eslint` key: Next 16 removed its built-in ESLint integration.
  // Linting is `pnpm lint` at the repo root, which already covers this app.
  typescript: { ignoreBuildErrors: false },
}

export default config
