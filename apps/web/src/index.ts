/**
 * `@karatx/web` - Next.js dashboard, trade log, admin.
 *
 * The web app never computes strategy. It reads what the worker wrote
 * (ARCHITECTURE-AND-STACK.md F.1). If the dashboard ever calculates an
 * indicator or a grade, there are two implementations and they will drift.
 *
 * Next.js itself, the health endpoints and the root page land in T0.7. This
 * module exists only so T0.1 can verify that cross-package imports resolve
 * from inside this app - the risk called out in the task.
 */

import { CONTRACTS_PACKAGE_NAME } from '@karatx/contracts'
import { CORE_PACKAGE_NAME } from '@karatx/core'

export const WEB_APP_LINKED_PACKAGES = [
  CORE_PACKAGE_NAME,
  CONTRACTS_PACKAGE_NAME,
] as const
