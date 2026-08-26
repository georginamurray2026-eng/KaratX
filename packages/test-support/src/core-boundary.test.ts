import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

import { findRepoRoot } from './env.js'

/**
 * ============================================================================
 * IF THIS TEST IS FAILING, PLEASE READ THIS BEFORE CHANGING ANYTHING.
 * ============================================================================
 *
 * This test does not check your code. It checks that `eslint.config.js` still
 * forbids `packages/core` from performing I/O.
 *
 * It fails when someone edits the ESLint configuration in a way that stops the
 * boundary being enforced. That is almost always accidental - ESLint's flat
 * config REPLACES a rule's options rather than merging them, so adding a
 * repo-wide `no-restricted-syntax` rule silently switches off the one scoped
 * to packages/core. That exact thing happened once already, in T0.5.
 *
 * THE FIX IS TO RESTORE THE RULE, NOT TO DELETE THIS TEST.
 *
 * Why the boundary matters, so the decision is informed:
 *
 *   `packages/core` holds every indicator, structure rule and state
 *   transition. Because it performs no I/O and reads no clock, the backtest
 *   can run the IDENTICAL code path as the live system rather than a parallel
 *   reimplementation. That is the single strongest defence against a backtest
 *   that reports profits the live system would never have made.
 *
 *   The moment core can read a clock, call fetch, or query the database, that
 *   guarantee is gone - and nothing will announce it. The backtest will keep
 *   producing numbers. They will simply stop being true.
 *
 * See ARCHITECTURE-AND-STACK.md F.3 invariant 1, and NFR-12.
 *
 * T0.2 proved these rules fire using a one-shot manual probe which was then
 * deleted, leaving nothing to catch a regression. This test is that probe made
 * permanent (§11: retain regression tests).
 * ============================================================================
 */

const WHY_IT_MATTERS =
  'packages/core must perform no I/O and read no clock (F.3 invariant 1). That is what lets the backtest run the identical code path as live instead of a parallel reimplementation. If this rule is gone, backtests keep producing numbers that are quietly no longer trustworthy. Restore the rule in eslint.config.js - do not delete this test.'

/** A path inside packages/core, so the core-scoped rules resolve for it. */
const VIRTUAL_CORE_FILE = 'packages/core/src/__boundary_probe.ts'

const eslint = new ESLint({ cwd: findRepoRoot() })

/**
 * Lint a snippet AS IF it lived in packages/core.
 *
 * `lintText` with a `filePath` resolves the real configuration for that path,
 * so no probe file is ever written to disk - nothing to exclude from lint,
 * nothing to break typecheck, nothing to commit by accident.
 */
async function ruleIdsFor(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: VIRTUAL_CORE_FILE })
  return (result?.messages ?? [])
    .map((message) => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null)
}

/**
 * ESLint's first lint resolves the whole config chain, which takes several
 * seconds. Paying that once here keeps every individual assertion fast and
 * stops the first test in the file timing out for a reason unrelated to what
 * it asserts.
 */
beforeAll(async () => {
  await ruleIdsFor('export const warmup = 1')
}, 60_000)

/** Every violation, with the rule that must reject it. */
const VIOLATIONS = [
  {
    what: 'importing the database package',
    rule: 'no-restricted-imports',
    code: `import { systemEvents } from '@karatx/db'\nexport const x = systemEvents`,
  },
  {
    what: 'importing the providers package',
    rule: 'no-restricted-imports',
    code: `import { createLogger } from '@karatx/providers'\nexport const x = createLogger`,
  },
  {
    what: 'importing the config package',
    rule: 'no-restricted-imports',
    code: `import { loadConfig } from '@karatx/config'\nexport const x = loadConfig`,
  },
  {
    what: 'importing a node: builtin',
    rule: 'no-restricted-imports',
    code: `import { readFileSync } from 'node:fs'\nexport const x = readFileSync`,
  },
  {
    what: 'importing a bare node builtin',
    rule: 'no-restricted-imports',
    code: `import { createHash } from 'crypto'\nexport const x = createHash`,
  },
  {
    what: 'reading the clock with Date.now()',
    rule: 'no-restricted-syntax',
    code: `export const t = Date.now()`,
  },
  {
    what: 'reading the clock with new Date()',
    rule: 'no-restricted-syntax',
    code: `export const t = new Date()`,
  },
  {
    what: 'reading the clock with performance.now()',
    rule: 'no-restricted-syntax',
    code: `export const t = performance.now()`,
  },
  {
    what: 'generating randomness with Math.random()',
    rule: 'no-restricted-syntax',
    code: `export const r = Math.random()`,
  },
  {
    what: 'calling fetch',
    rule: 'no-restricted-globals',
    code: `export const f = () => fetch('https://example.com')`,
  },
  {
    what: 'reading process.env',
    rule: 'no-restricted-globals',
    code: `export const e = process.env['SECRET']`,
  },
] as const

describe('packages/core boundary is still enforced by eslint.config.js', () => {
  it.each(VIOLATIONS)('rejects $what', async ({ what, rule, code }) => {
    const ruleIds = await ruleIdsFor(code)

    expect(
      ruleIds,
      `THE packages/core BOUNDARY HAS BEEN WEAKENED.\n\n` +
        `Code that does this is no longer rejected: ${what}\n` +
        `Expected the rule "${rule}" to report it, but eslint.config.js reported: ` +
        `${ruleIds.length === 0 ? '(nothing)' : ruleIds.join(', ')}\n\n` +
        `${WHY_IT_MATTERS}\n\n` +
        `Most likely cause: a rule was added or reordered in eslint.config.js. Flat ` +
        `config REPLACES a rule's options rather than merging them, so a repo-wide ` +
        `"${rule}" silently overrides the packages/core one. Check with:\n` +
        `  pnpm exec eslint --print-config packages/core/src/errors.ts`,
    ).toContain(rule)
  })
})

/**
 * The other half, and the half people forget.
 *
 * A rule that rejects everything would pass every test above while making
 * packages/core unusable. T1.6 aggregation and every indicator need to build
 * dates from timestamps that were passed in.
 */
describe('the boundary is precise, not blunt', () => {
  const ALLOWED = [
    {
      what: 'constructing a Date from a timestamp passed in',
      code: `export function barOpen(openTimeMs: number): Date {\n  return new Date(openTimeMs)\n}`,
    },
    {
      what: 'importing types from the contracts package',
      code: `import { CONTRACTS_PACKAGE_NAME } from '@karatx/contracts'\nexport const x = CONTRACTS_PACKAGE_NAME`,
    },
    {
      what: 'ordinary pure arithmetic over an array',
      code: `export function mean(values: readonly number[]): number {\n  return values.reduce((a, b) => a + b, 0) / values.length\n}`,
    },
  ] as const

  it.each(ALLOWED)('allows $what', async ({ what, code }) => {
    const ruleIds = await ruleIdsFor(code)

    expect(
      ruleIds,
      `THE packages/core BOUNDARY HAS BECOME TOO BROAD.\n\n` +
        `Legitimate code is now rejected: ${what}\n` +
        `Reported: ${ruleIds.join(', ')}\n\n` +
        `The boundary must forbid reading a clock, not forbid handling time. ` +
        `new Date(openTimeMs) is a timestamp being passed IN, which is exactly what ` +
        `invariant F.3.1 asks for. If this is rejected, T1.6 timeframe aggregation ` +
        `and every indicator become unwritable, and the pressure will be to weaken ` +
        `the boundary altogether.\n\n` +
        `Check the selectors in eslint.config.js are still argument-count specific.`,
    ).toEqual([])
  })
})

/**
 * The specific regression from T0.5, kept as its own test because it is the
 * one that already happened.
 */
describe('regression: the empty-catch selector still applies inside packages/core', () => {
  it('rejects a catch block whose body is empty', async () => {
    const ruleIds = await ruleIdsFor(
      `export function f(): void {\n  try {\n    JSON.parse('{}')\n  } catch {\n    // deliberately ignored\n  }\n}`,
    )

    expect(
      ruleIds,
      `THE EMPTY-CATCH RULE NO LONGER APPLIES INSIDE packages/core.\n\n` +
        `This exact regression happened once, in T0.5. A repo-wide ` +
        `"no-restricted-syntax" rule was added, and because flat config REPLACES a ` +
        `rule's options rather than merging them, the packages/core block silently ` +
        `dropped it - in the one package where swallowing an error matters most.\n\n` +
        `The selector must be repeated inside the packages/core block in ` +
        `eslint.config.js. It is not duplication by accident; it is required.\n\n` +
        `Note this case is NOT caught by "no-empty", which counts a comment as ` +
        `content. §23: "Never use empty catch blocks. Do not hide exceptions."`,
    ).toContain('no-restricted-syntax')
  })
})
