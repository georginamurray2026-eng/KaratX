import { defineConfig } from 'vitest/config'

import { unitTestConfig } from '../../vitest.shared'

// Unit tests only. Integration tests are excluded by the shared config and run
// via `pnpm test:integration`.
export default defineConfig({ test: unitTestConfig })
