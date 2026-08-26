import { defineConfig } from 'vitest/config'

import { unitTestConfig } from '../../vitest.shared.ts'

// Unit tests only. The integration tests use vitest.integration.config.ts and
// run via `pnpm test:integration`; keeping them apart is what lets `pnpm test`
// stay database-free.
export default defineConfig({ test: unitTestConfig })
