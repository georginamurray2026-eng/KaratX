import { describe, expect, it } from 'vitest'

import { CORE_PACKAGE_NAME } from './index'

// T0.1 requires exactly one trivial passing test here: its job is to prove the
// runner is wired up, not to test anything. The real harness (unit/integration
// split, ephemeral test database, fixture loading) is T0.6.
describe('@karatx/core', () => {
  it('is importable and the test runner executes', () => {
    expect(CORE_PACKAGE_NAME).toBe('@karatx/core')
  })
})
