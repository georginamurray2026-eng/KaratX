#!/usr/bin/env node
/**
 * "Is CI green for the commit I am actually on?"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: THE API IS AUTHORITATIVE, REACHING IT IS NOT RELIABLE
 * ---------------------------------------------------------------------------
 *
 * Three wrong readings came out of the GitHub API layer in two days, and not
 * one of them was the API being wrong:
 *
 *   1. CI #52 - a summariser reported a green run that had failed on gitleaks.
 *   2. T1.4 - repeated 403s, read as "no runs" rather than "not answered".
 *   3. 2026-09-06 - a poll returned run 61 for sha 2afd150 and it was one step
 *      from being reported as the push's result. It was an unrelated Dependabot
 *      PR on another branch. The commit under test was run 60.
 *
 * Every one is a TRANSPORT or SELECTION failure sitting between a correct API
 * and a wrong conclusion. Unauthenticated requests are rate limited to 60/hour,
 * and a throttled reply is a JSON OBJECT WITH NO `workflow_runs` KEY rather
 * than an error status - so naive code reads `undefined` and reports nothing
 * found.
 *
 * THE CONTROL: never believe a conclusion without checking WHICH SHA it belongs
 * to. This refuses to print a verdict for any commit other than the one asked
 * about, and says "NOT ANSWERED" rather than "no runs" when the request did not
 * succeed. Both failures are loud, and neither can be mistaken for green.
 *
 * Usage: pnpm ci:status [sha]        (default: HEAD)
 */
import { execFileSync } from 'node:child_process'

const REPO = 'georginamurray2026-eng/KaratX'
const API = `https://api.github.com/repos/${REPO}/actions/runs?per_page=30`

/** Refusal, not a crash. Thrown so the process unwinds normally - see main(). */
class Refused extends Error {}
const refuse = (message) => {
  throw new Refused(message)
}

const main = async () => {
  const argSha = process.argv[2]
  const targetSha = (argSha ?? execFileSync('git', ['rev-parse', 'HEAD']).toString()).trim()
  if (!/^[0-9a-f]{7,40}$/.test(targetSha)) refuse(`Not a sha: ${targetSha}`)

  let response
  try {
    response = await fetch(API, { headers: { accept: 'application/vnd.github+json' } })
  } catch (error) {
    refuse(`NOT ANSWERED - the request itself failed: ${String(error)}`)
  }

  if (!response.ok) {
    refuse(`NOT ANSWERED - HTTP ${response.status}. That is not "no runs"; it is no answer.`)
  }

  const body = await response.json()

  // A rate-limited reply is a JSON object carrying `message` and no runs.
  // Reading `workflow_runs[0]` off that yields undefined and a silently wrong
  // answer, which is failure mode 2 above.
  if (!Array.isArray(body.workflow_runs)) {
    refuse(
      `NOT ANSWERED - the response carried no workflow_runs.` +
        `${body.message ? ` API said: ${body.message}` : ''}\n` +
        `That is not "no runs"; it is no answer.`,
    )
  }

  // SELECTION IS THE THIRD FAILURE MODE. The newest run in the repo belongs to
  // whatever was pushed last ANYWHERE - a Dependabot branch, another PR. Filter
  // to the sha before looking at a single conclusion.
  const mine = body.workflow_runs.filter((run) => run.head_sha.startsWith(targetSha))

  if (mine.length === 0) {
    const newest = body.workflow_runs[0]
    refuse(
      `NO RUN FOUND for ${targetSha.slice(0, 7)}.\n` +
        `  Newest run in the repo is #${newest.run_number} on ${newest.head_sha.slice(0, 7)} ` +
        `(${newest.head_branch}) - NOT your commit.\n` +
        `  Either CI has not started for this sha, or it never ran.`,
    )
  }

  let verdict = 'success'
  for (const run of mine) {
    process.stdout.write(
      `#${String(run.run_number).padEnd(4)} ${run.head_sha.slice(0, 7)}  ` +
        `${run.status}  ${run.conclusion ?? '(running)'}  ${run.name}\n`,
    )
    if (run.status !== 'completed') verdict = 'incomplete'
    else if (run.conclusion !== 'success' && verdict !== 'incomplete') verdict = run.conclusion
  }

  process.stdout.write(`\n${targetSha.slice(0, 7)}: ${verdict.toUpperCase()}\n`)
  if (verdict !== 'success') process.exitCode = 1
}

main().catch((error) => {
  process.exitCode = 1
  process.stderr.write(`${error instanceof Refused ? error.message : String(error)}\n`)
})
