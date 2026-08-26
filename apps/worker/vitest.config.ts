import { defineConfig } from 'vitest/config'

import { unitTestConfig } from '../../vitest.shared.ts'

// Unit tests only. Integration tests use vitest.integration.config.ts and run
// via `pnpm test:integration`, keeping `pnpm test` database-free.
export default defineConfig({ test: unitTestConfig })
