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
 * Handles CRLF and a trailing newline. It does NOT handle quoted fields
 * containing commas - the exports this serves do not use them, and a partial
 * quote implementation that looks correct is worse than none.
 */
export function readCsvFixture(relativePath: string): CsvFixture {
  const text = readFixture(relativePath)
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')

  const headerLine = lines[0]
  if (headerLine === undefined) {
    throw new Error(`CSV fixture is empty: ${relativePath}`)
  }

  const header = headerLine.split(',').map((column) => column.trim())

  const rows = lines.slice(1).map((line, index) => {
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
