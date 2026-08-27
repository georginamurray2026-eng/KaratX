import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * Deliberately small. T0.2's stated risk is that "over-configured lint becomes
 * something you fight", so this is a recommended baseline plus exactly one
 * project-specific block: the packages/core boundary.
 *
 * Not type-aware. `projectService` is markedly slower and nothing here needs
 * type information - every boundary rule below is a core ESLint rule operating
 * on the syntax tree. Revisit only if a later task needs a type-aware rule.
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  // T0.2 acceptance criterion: "No warnings suppressed without an inline
  // explanatory comment." `require-description` makes a bare
  // `eslint-disable-next-line` a lint error - a suppression must say why.
  comments.recommended,
  {
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
    },
  },

  // Reports `eslint-disable` directives that no longer suppress anything, so
  // suppressions cannot quietly outlive the problem they were added for.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  // Repository maintenance scripts run under plain Node and legitimately write
  // to the console - reporting IS their output, so `console` is the interface
  // rather than a debugging leftover.
  //
  // Deliberately a SEPARATE block scoped to `scripts/**`. Flat config REPLACES
  // a rule's options rather than merging them (STATUS.md obligation 7), so
  // widening an existing block to cover these files could silently switch off
  // rules elsewhere. A non-overlapping glob cannot.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },

  // T0.5 acceptance criterion: "Zero empty catch blocks anywhere in the repo."
  //
  // `no-empty` already arrives via js.configs.recommended and already covers
  // catch blocks, so this changes no current behaviour. It is pinned
  // explicitly with `allowEmptyCatch: false` so that the guarantee is a stated
  // decision rather than an inherited default that a future config change
  // could relax without anyone noticing.
  //
  // A swallowed error is how a system ends up confidently wrong: the failure
  // happened, nothing recorded it, and the next layer proceeds on bad data.
  //
  // `no-empty` alone is not quite enough: it counts a comment as content, so
  // `catch { /* ignored */ }` passes it while still swallowing the error. The
  // selector below looks at the block's statements, which comments are not
  // part of, and therefore rejects that form too.
  //
  // A genuinely justified empty catch remains possible, but it now costs an
  // explicit `eslint-disable` - which T0.2's require-description rule forces
  // to carry a reason. That is the intended friction.
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CatchClause > BlockStatement[body.length=0]',
          message:
            'Empty catch block. A swallowed error is how a system ends up confidently wrong: handle it, rethrow it, or log it - a comment alone is not handling it.',
        },
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^\\.\\.?\\/.*\\.js$/]',
          message:
            "Relative imports must be extensionless: write './errors', not './errors.js'. This repository uses moduleResolution 'Bundler'. A '.js' specifier pointing at a '.ts' file is a NodeNext convention, and Bundler-based tools are not required to resolve it - Turbopack does not, so this breaks `next build` with a module-not-found error in apps/web caused by an import in a package it merely depends on. TypeScript, Vitest and tsx all resolve it, which is why this stayed invisible until Next.js looked at it. This is deliberate and current: see ADR-006, which also records the condition that would reverse it.",
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // F.3 invariant 1: `packages/core` performs no I/O.
  //   "No fetch, no database, no clock reads. Time is passed in."
  //
  // This is what lets the backtest run the identical code path as live, and
  // ARCHITECTURE-AND-STACK.md calls it the single strongest defence against a
  // backtest that lies. It also underwrites NFR-12 (backtests reproducible
  // byte-for-byte) and closes T0.1's line-26 criterion.
  //
  // Three enforcement surfaces, because imports alone would not enforce the
  // invariant: `fetch`, `Date.now()` and `Math.random()` are globals and need
  // no import at all.
  //
  // Applies to core's tests as well as its source. T0.6 plans a fixture-loading
  // helper for golden datasets; if core's own tests then need file I/O, add the
  // exemption there deliberately and with a reason, rather than pre-opening the
  // hole here.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@karatx/db',
              message:
                'packages/core performs no I/O (F.3 invariant 1). Pass data in; do not query from core.',
            },
            {
              name: '@karatx/providers',
              message:
                'packages/core performs no I/O (F.3 invariant 1). Adapters belong outside the domain.',
            },
            {
              name: '@karatx/config',
              message:
                'packages/core performs no I/O (F.3 invariant 1). Config reads process.env, which is non-deterministic. Pass configuration in as a parameter.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message:
                'packages/core performs no I/O (F.3 invariant 1). Node builtins are not available to the pure domain.',
            },
            {
              group: [
                'fs',
                'fs/*',
                'path',
                'os',
                'http',
                'https',
                'net',
                'dns',
                'crypto',
                'child_process',
                'worker_threads',
                'timers',
                'timers/*',
              ],
              message:
                'packages/core performs no I/O (F.3 invariant 1). Node builtins are not available to the pure domain.',
            },
          ],
        },
      ],

      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'packages/core performs no I/O (F.3 invariant 1). No network access from core.',
        },
        {
          name: 'XMLHttpRequest',
          message: 'packages/core performs no I/O (F.3 invariant 1). No network access from core.',
        },
        {
          name: 'process',
          message:
            'packages/core performs no I/O (F.3 invariant 1). No environment or process access from core.',
        },
        {
          name: 'crypto',
          message:
            'packages/core must be deterministic (NFR-12). Pass any generated identifier in as a parameter.',
        },
      ],

      // Clock and randomness reads. Selectors are deliberately narrow so that
      // legitimate use still passes: `new Date(openTimeMs)` is time being
      // passed in and must remain allowed. Only the argument-less form reads
      // the clock.
      'no-restricted-syntax': [
        'error',
        // Repeated from the repo-wide block above, deliberately. Flat config
        // REPLACES a rule's options rather than merging them, so this array is
        // the complete set for packages/core - omitting the empty-catch
        // selector here would silently switch it off for the one package where
        // correctness matters most. Verified with `eslint --print-config`.
        {
          selector: 'CatchClause > BlockStatement[body.length=0]',
          message:
            'Empty catch block. A swallowed error is how a system ends up confidently wrong: handle it, rethrow it, or log it - a comment alone is not handling it.',
        },
        {
          selector:
            ':matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^\\.\\.?\\/.*\\.js$/]',
          message:
            "Relative imports must be extensionless: write './errors', not './errors.js'. This repository uses moduleResolution 'Bundler'. A '.js' specifier pointing at a '.ts' file is a NodeNext convention, and Bundler-based tools are not required to resolve it - Turbopack does not, so this breaks `next build` with a module-not-found error in apps/web caused by an import in a package it merely depends on. TypeScript, Vitest and tsx all resolve it, which is why this stayed invisible until Next.js looked at it. This is deliberate and current: see ADR-006, which also records the condition that would reverse it.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'packages/core reads no clock (F.3 invariant 1). `new Date()` reads wall-clock time. Pass the timestamp in - `new Date(openTimeMs)` is fine.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'packages/core reads no clock (F.3 invariant 1). Pass the timestamp in as a parameter.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'packages/core must be deterministic (NFR-12: backtests reproduce byte-for-byte). Pass a seeded generator in if randomness is genuinely needed.',
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message:
            'packages/core reads no clock (F.3 invariant 1). Pass elapsed time in as a parameter.',
        },
      ],
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
)
