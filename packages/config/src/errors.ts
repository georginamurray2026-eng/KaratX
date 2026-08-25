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
 * SEAM FOR T0.5: that task owns the error taxonomy in `packages/core/errors.ts`
 * (validation | provider | network | database | strategy | ai | config |
 * unexpected) and should re-home this class under the `config` classification
 * with its declared handling policy. It is standalone here only because T0.3
 * needs a named error and the taxonomy does not exist yet.
 */
export class ConfigValidationError extends Error {
  override readonly name = 'ConfigValidationError'
  readonly problems: readonly ConfigProblem[]

  constructor(problems: readonly ConfigProblem[]) {
    super(formatProblems(problems))
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
