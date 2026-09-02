import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { findRepoRoot } from './env'

/**
 * Loading committed test fixtures.
 *
 * This is the ONLY place in the repository where test code reads the
 * filesystem. `packages/core` may not import `node:fs` even in its tests, so
 * its golden-dataset tests import this instead and the ESLint boundary stays
 * a simple, absolute rule.
 *
 * Deliberately generic: it returns text, rows of strings, or parsed JSON. It
 * does NOT know what a candle is. Typed candle loading needs the `Candle`
 * schema from `packages/contracts`, which is a stub until T1.2 - building it
 * now would mean guessing the schema and rewriting it.
 */

/** Fixtures live here, committed to the repository (TEST-13). */
export const FIXTURES_ROOT = 'test/fixtures'

/** Resolve a fixture path relative to the repository's fixtures directory. */
export function fixturePath(relativePath: string): string {
  return path.join(findRepoRoot(), FIXTURES_ROOT, relativePath)
}

/**
 * Read a fixture as text.
 *
 * @throws if the fixture is missing, naming the resolved path. A test that
 * silently receives an empty string because someone moved a file is far worse
 * than one that fails immediately.
 */
export function readFixture(relativePath: string): string {
  const absolute = fixturePath(relativePath)

  if (!existsSync(absolute)) {
    throw new Error(`Fixture not found: ${relativePath} (looked in ${absolute})`)
  }

  return readFileSync(absolute, 'utf8')
}

/** Parse a fixture as JSON. The caller is responsible for validating shape. */
export function readJsonFixture<T = unknown>(relativePath: string): T {
  const text = readFixture(relativePath)

  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Fixture is not valid JSON: ${relativePath}`, { cause: error })
  }
}

/**
 * Refuse a CSV line containing a double quote.
 *
 * THE FAILURE THIS PREVENTS IS SILENT, WHICH IS WHY IT IS AN ERROR AND NOT A
 * PARSER. Splitting on `,` turns a quoted field into two, so a line like
 *
 *   time,"4,637.29",4637.290,4633.175      (4 real fields, 5-column header)
 *
 * splits into exactly 5 values, PASSES the column-count check, and shifts every
 * subsequent column by one - `close` silently receives `low`'s number. The
 * count check catches the noisy case and cannot catch this one.
 *
 * Since these fixtures carry prices asserted byte-for-byte (NFR-12), a shifted
 * column is wrong numbers presented as right ones.
 *
 * DO NOT "FIX" THIS BY ADDING A QUOTE PARSER HERE. Obligation 10's point is
 * that a half-correct one is worse than none: it would look right on the easy
 * cases and mis-parse escaped quotes and embedded newlines. If a real fixture
 * ever needs quoting, take a tested CSV parser as a dependency - or convert the
 * fixture, which is usually the cheaper answer.
 */
function assertNoQuotedField(relativePath: string, line: string, lineNumber: number): void {
  if (!line.includes('"')) return

  throw new Error(
    `CSV fixture ${relativePath} line ${String(lineNumber)} contains a double quote, ` +
      `which this loader deliberately refuses to parse.\n\n` +
      `  ${line}\n\n` +
      `Splitting on "," would break a quoted field in two. When the resulting ` +
      `count still matches the header, the row parses "successfully" with every ` +
      `column after the quote shifted by one - wrong numbers, no error. ` +
      `Refusing is the only honest answer a splitter can give.\n\n` +
      `Fix the fixture, or use a real CSV parser. Do not add partial quote ` +
      `handling here (obligation 10).`,
  )
}

export interface CsvFixture {
  /** Column names from the first line. */
  readonly header: readonly string[]
  /** One record per data line, keyed by column name. */
  readonly rows: readonly Readonly<Record<string, string>>[]
}

/**
 * Parse a fixture as CSV into header and keyed rows.
 *
 * Values are returned as strings, unconverted. The golden TradingView exports
 * this exists for carry prices whose exact decimal text matters (NFR-12:
 * backtests reproduce byte-for-byte), so parsing them to numbers here would
 * discard information before the caller can decide how to handle it.
 *
 * Handles CRLF and a trailing newline. It does NOT handle quoted fields, and
 * REFUSES them loudly rather than mis-parsing them - see `assertNoQuotedField`.
 * A partial quote implementation that looks correct is worse than none.
 */
export function readCsvFixture(relativePath: string): CsvFixture {
  const text = readFixture(relativePath)
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')

  const headerLine = lines[0]
  if (headerLine === undefined) {
    throw new Error(`CSV fixture is empty: ${relativePath}`)
  }

  assertNoQuotedField(relativePath, headerLine, 1)
  const header = headerLine.split(',').map((column) => column.trim())

  const rows = lines.slice(1).map((line, index) => {
    assertNoQuotedField(relativePath, line, index + 2)
    const values = line.split(',')

    if (values.length !== header.length) {
      throw new Error(
        `CSV fixture ${relativePath} line ${String(index + 2)} has ${String(values.length)} values but the header declares ${String(header.length)} columns.`,
      )
    }

    const row: Record<string, string> = {}
    header.forEach((column, columnIndex) => {
      row[column] = (values[columnIndex] ?? '').trim()
    })
    return row
  })

  return { header, rows }
}
