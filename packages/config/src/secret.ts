/**
 * A configuration value that must never be printed.
 *
 * `DATABASE_URL` is `postgres://user:PASSWORD@host/db` - the very first
 * variable this project defines carries a password. The routine way that leaks
 * is not malice, it is `console.log(config)` during a debugging session, or a
 * template literal in an error message, or `JSON.stringify` in a crash report.
 *
 * This class closes all of those by construction: every standard way of turning
 * a value into text yields `[REDACTED]`. Reading the real value requires an
 * explicit `.reveal()`, which is a single greppable token - so "where can this
 * secret escape to?" is answerable with one search rather than an audit.
 *
 * T0.5 adds Pino redaction on top. That is a second layer, not the only one:
 * redaction protects fields that go through the logger, whereas this protects
 * the value wherever it goes. Note in particular that config validation runs
 * before any logger exists, so at boot this is the only protection there is.
 */
export class Secret<T> {
  readonly #value: T

  constructor(value: T) {
    this.#value = value
  }

  /** Explicit, greppable escape hatch. The only way to read the real value. */
  reveal(): T {
    return this.#value
  }

  /** Covers string concatenation and template literals. */
  toString(): string {
    return Secret.REDACTED
  }

  /** Covers `JSON.stringify`, and therefore Pino's default serialisation. */
  toJSON(): string {
    return Secret.REDACTED
  }

  /** Covers `console.log`, `util.inspect`, and Node's error formatting. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return Secret.REDACTED
  }

  /** Covers implicit coercion, e.g. `'' + secret`. */
  [Symbol.toPrimitive](): string {
    return Secret.REDACTED
  }

  static readonly REDACTED = '[REDACTED]'
}

/** Narrowing helper, so callers can tell a wrapped value from a bare one. */
export function isSecret(value: unknown): value is Secret<unknown> {
  return value instanceof Secret
}
