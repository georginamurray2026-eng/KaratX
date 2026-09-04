import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Raw provider payloads, written to disk BEFORE anything parses them.
 *
 * WHY THIS EXISTS, from `packages/db/src/schema/candles.ts`: a bar rejected by
 * a CHECK constraint is GONE unless something captured the payload first, and
 * that comment names T1.4's adapter as the owner because it is the first code
 * to hold a raw provider response. Today a rejected bar is lost. This closes it.
 *
 * ORDER IS THE WHOLE GUARANTEE. The page file is written as soon as the
 * response body is in hand and before validation, parsing or storage. Anything
 * that later refuses the data - a Zod failure, a CHECK violation, an ordering
 * assertion - still leaves the evidence on disk.
 *
 * NOT A TABLE, AND DELIBERATELY SO. `data_quality_events` is T1.5's to design,
 * and T1.5 knows things T1.4 does not. ADR-013 used exactly this reasoning to
 * keep the outcome contract a value rather than an event row: a schema designed
 * twice by two tasks means the second design inherits the first one's guesses.
 *
 * THE INDEX IS THE HANDOFF TO T1.5. A directory of page files answers "what did
 * we receive" only by opening every file. `index.jsonl` records each page's time
 * window, so a data-quality event carrying a bar's `open_time` locates its
 * payload with one scan of a small append-only file rather than a sweep of a
 * full backfill's worth of pages.
 */

/** Where a page's bars actually fell, and what was asked for. */
export interface CaptureWindow {
  /** The `start_date` sent, if any. */
  readonly requestedStart: string | undefined
  /** The `end_date` sent, if any. */
  readonly requestedEnd: string | undefined
  /** Earliest bar open time in the response, ISO UTC. Absent if unparseable. */
  readonly firstBarTime: string | undefined
  /** Latest bar open time in the response, ISO UTC. Absent if unparseable. */
  readonly lastBarTime: string | undefined
  readonly barCount: number | undefined
}

export interface CapturePage {
  readonly runId: string
  readonly page: number
  readonly endpoint: string
  /** URL with any credential-shaped parameter blanked. */
  readonly urlRedacted: string
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** The response body EXACTLY as received, as text. Never re-serialised. */
  readonly body: string
  readonly requestedStart: string | undefined
  readonly requestedEnd: string | undefined
  readonly capturedAt: string
}

/**
 * Where captures go. Injected so the client stays testable without a
 * filesystem, and so tests can assert capture happened without writing files.
 */
export interface CaptureSink {
  /** Persist a raw response. Called before any parsing. */
  writePage: (page: CapturePage) => Promise<void>
  /** Record where the page's bars landed. Called after parsing, if it succeeds. */
  indexPage: (runId: string, page: number, window: CaptureWindow, error?: string) => Promise<void>
}

/** A sink that records nothing. For unit tests that are not about capture. */
export const NULL_CAPTURE_SINK: CaptureSink = {
  writePage: async () => undefined,
  indexPage: async () => undefined,
}

/**
 * Page file name. Zero-padded so a directory listing sorts in request order,
 * which is the order a human reads them in when reconstructing a run.
 */
export function pageFileName(page: number): string {
  return `page-${String(page).padStart(5, '0')}.json`
}

/**
 * A capture sink writing under `<root>/<runId>/`.
 *
 * The root is expected to be git-ignored: these files contain raw market data
 * and, over a full backfill, a great many megabytes of it.
 */
export function createFileCaptureSink(root: string): CaptureSink {
  const runDir = (runId: string): string => join(root, runId)

  return {
    async writePage(page: CapturePage): Promise<void> {
      const dir = runDir(page.runId)
      await mkdir(dir, { recursive: true })

      // The body is embedded as TEXT, not re-parsed and re-serialised. A
      // round-trip through JSON.parse/stringify would silently normalise the
      // very decimal renderings ADR-008 requires us to preserve - the capture
      // would then disagree with what arrived, which defeats its purpose.
      const record = {
        runId: page.runId,
        page: page.page,
        capturedAt: page.capturedAt,
        endpoint: page.endpoint,
        urlRedacted: page.urlRedacted,
        requestedStart: page.requestedStart ?? null,
        requestedEnd: page.requestedEnd ?? null,
        status: page.status,
        headers: page.headers,
        bodyText: page.body,
      }

      await writeFile(
        join(dir, pageFileName(page.page)),
        JSON.stringify(record, null, 2) + '\n',
        'utf8',
      )
    },

    async indexPage(runId, page, window, error): Promise<void> {
      const dir = runDir(runId)
      await mkdir(dir, { recursive: true })

      // JSONL, appended. A partial write at the end of a crashed run costs the
      // last line and leaves every earlier one readable - which a single JSON
      // array rewritten each page would not.
      const entry = {
        page,
        file: pageFileName(page),
        requestedStart: window.requestedStart ?? null,
        requestedEnd: window.requestedEnd ?? null,
        firstBarTime: window.firstBarTime ?? null,
        lastBarTime: window.lastBarTime ?? null,
        barCount: window.barCount ?? null,
        ...(error === undefined ? {} : { error }),
      }

      await appendFile(join(dir, 'index.jsonl'), JSON.stringify(entry) + '\n', 'utf8')
    },
  }
}
