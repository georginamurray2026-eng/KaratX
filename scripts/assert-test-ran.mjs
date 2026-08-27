#!/usr/bin/env node
/**
 * Fail unless a NAMED test actually ran and passed.
 *
 * Discharges STATUS.md obligation 18. A green suite does not mean a test ran:
 * `apps/worker/src/boot.integration.test.ts` skips its SIGTERM case on win32,
 * because Windows cannot deliver a catchable SIGTERM to a Node child. On Linux
 * it must RUN, and a skip reported as green is the failure family this
 * repository has recorded nine times.
 *
 * THREE WAYS THIS FAILS, and the third is the one that matters:
 *
 *   1. the test ran and failed          - obvious
 *   2. the test was SKIPPED             - the case obligation 18 exists for
 *   3. the test was NOT FOUND AT ALL    - renamed or deleted
 *
 * Without 3 this would be a check that passes once the thing it checks is
 * gone, which is precisely the defect it is meant to prevent. Renaming the test
 * is allowed; renaming it without updating this call is not.
 *
 * Usage: node scripts/assert-test-ran.mjs <report.json> "<exact test title>"
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'

const [reportPath, wantedTitle] = process.argv.slice(2)

if (!reportPath || !wantedTitle) {
  console.error('Usage: node scripts/assert-test-ran.mjs <report.json> "<test title>"')
  process.exit(2)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  // A missing report is a failure, not a pass. If the suite never wrote one,
  // this check has no evidence and must say so rather than succeeding quietly.
  console.error(`FAILED: could not read the test report at ${reportPath}`)
  console.error(`  ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// Vitest's JSON reporter uses the Jest shape: testResults[].assertionResults[].
const assertions = (report.testResults ?? []).flatMap((file) =>
  (file.assertionResults ?? []).map((a) => ({ ...a, file: file.name })),
)

const matches = assertions.filter(
  (a) => a.title === wantedTitle || (a.fullName ?? '').includes(wantedTitle),
)

console.log(`Report: ${reportPath}`)
console.log(`Looking for: "${wantedTitle}"`)
console.log(`Total assertions in report: ${assertions.length}\n`)

if (matches.length === 0) {
  console.error(`FAILED: no test titled "${wantedTitle}" appears in the report.`)
  console.error('\nThe test was renamed, deleted, or never collected. This check is')
  console.error('deliberately strict about that: a name-based assertion that passes when')
  console.error('the name is absent would verify nothing at all.')
  console.error('\nIf the test was renamed on purpose, update the title in the CI workflow.')
  process.exit(1)
}

let failed = false
for (const m of matches) {
  const where = m.file ? ` (${m.file})` : ''
  if (m.status === 'passed') {
    console.log(`PASSED: "${m.title}" ran and passed${where}`)
    continue
  }
  failed = true
  if (m.status === 'pending' || m.status === 'skipped' || m.status === 'todo') {
    console.error(`FAILED: "${m.title}" was SKIPPED (status: ${m.status})${where}`)
    console.error('  A skipped test reported inside a green suite verifies nothing.')
    console.error('  On Linux this test must run. Check the skipIf condition.')
  } else {
    console.error(`FAILED: "${m.title}" status is "${m.status}"${where}`)
  }
}

process.exit(failed ? 1 : 0)
