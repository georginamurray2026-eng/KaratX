import { ConfigError } from '@karatx/core'

/** One thing wrong with one environment variable. */
export interface ConfigProblem {
  readonly variable: string
  readonly kind: 'missing' | 'invalid'
  readonly expected: string
}

/**
 * Thrown when the environment does not satisfy the schema.
 *
 * Named, so a boot failure is identifiable rather than an anonymous crash
 * (T0.3: "throws a clear, named error").
 *
 * The message is assembled from variable names and expectations only. It never
 * contains a received value. That is not defensive style, it is necessary:
 * config validation is the first thing that runs at boot, its output goes
 * straight to a deploy log, and `DATABASE_URL` carries a password. Zod's
 * default messages echo received values for several issue types, so this class
 * builds its own text rather than passing those through.
 *
 * Re-homed in T0.5 under `ConfigError` from the core taxonomy, closing the
 * seam T0.3 recorded here. It therefore now carries `category: 'config'` and
 * `policy: 'stop'` (SEC-2: fail fast and loudly on bad configuration), so a
 * caller can classify it without knowing this package exists.
 *
 * Everything T0.3 relied on is unchanged: `name` is still exactly
 * `ConfigValidationError` (the base sets it from the concrete constructor),
 * `message` is still built by `formatProblems`, and `problems` is untouched.
 * T0.3's tests pass without modification, which is the compatibility contract.
 */
export class ConfigValidationError extends ConfigError {
  // A string literal, not new.target.name - see the note in packages/core.
  // A minified production bundle would otherwise report this as 'r'.
  override readonly name: string = 'ConfigValidationError'

  readonly problems: readonly ConfigProblem[]

  constructor(problems: readonly ConfigProblem[]) {
    super(formatProblems(problems), {
      // Variable NAMES only. Their values are exactly what must never reach a
      // log line, which is why the formatter never echoes them either.
      context: { variables: problems.map((problem) => problem.variable) },
    })
    this.problems = problems
  }
}

/**
 * Builds the message a developer actually reads at boot.
 *
 * Reports every problem at once. One failed boot should yield one complete
 * list of things to fix, rather than a fix-restart-discover-the-next-one loop.
 */
export function formatProblems(problems: readonly ConfigProblem[]): string {
  const count = problems.length
  const heading = `Invalid environment configuration (${count} problem${count === 1 ? '' : 's'})`

  const width = Math.max(...problems.map((p) => p.variable.length))
  const lines = problems.map((p) => {
    const name = p.variable.padEnd(width)
    return `  ${name}  ${p.kind}\n  ${' '.repeat(width)}  expected: ${p.expected}`
  })

  return [
    heading,
    '',
    ...lines,
    '',
    'See .env.example for the full list of variables and their meaning.',
  ].join('\n')
}
