import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFileCaptureSink, pageFileName, type CapturePage } from './capture'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'karatx-capture-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const PAGE: CapturePage = {
  runId: 'run-abc',
  page: 1,
  endpoint: '/time_series',
  urlRedacted: 'https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&timezone=UTC',
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"status":"ok","values":[]}',
  requestedStart: '2020-01-24 13:00:00',
  requestedEnd: '2020-01-25 13:00:00',
  capturedAt: '2026-09-04T10:00:00.000Z',
}

describe('createFileCaptureSink', () => {
  it('writes a page file named so a listing sorts in request order', async () => {
    const sink = createFileCaptureSink(root)
    await sink.writePage(PAGE)
    await sink.writePage({ ...PAGE, page: 12 })

    // Zero-padded, so page 2 sorts before page 12 - which a human
    // reconstructing a run depends on.
    expect(pageFileName(1)).toBe('page-00001.json')
    expect(pageFileName(12)).toBe('page-00012.json')
    expect([pageFileName(2), pageFileName(12)].sort()).toEqual([
      'page-00002.json',
      'page-00012.json',
    ])

    const written = await readFile(join(root, 'run-abc', 'page-00001.json'), 'utf8')
    expect(JSON.parse(written).status).toBe(200)
  })

  it('stores the body as TEXT, so decimal renderings survive the round trip', async () => {
    // The capture would otherwise disagree with what arrived, on exactly the
    // renderings ADR-008 requires preserving.
    const body = '{"values":[{"open":"4600.10","close":"4600.123456789012345"}]}'
    const sink = createFileCaptureSink(root)
    await sink.writePage({ ...PAGE, body })

    const record = JSON.parse(await readFile(join(root, 'run-abc', 'page-00001.json'), 'utf8'))

    expect(record.bodyText).toBe(body)
    expect(record.bodyText).toContain('4600.10')
    expect(record.bodyText).toContain('4600.123456789012345')
  })

  it('appends one index line per page, in JSONL', async () => {
    const sink = createFileCaptureSink(root)
    const window = {
      requestedStart: '2020-01-24 13:00:00',
      requestedEnd: '2020-01-25 13:00:00',
      firstBarTime: '2020-01-24T13:00:00.000Z',
      lastBarTime: '2020-01-25T12:45:00.000Z',
      barCount: 96,
    }

    await sink.indexPage('run-abc', 1, window)
    await sink.indexPage('run-abc', 2, { ...window, barCount: 42 })

    const lines = (await readFile(join(root, 'run-abc', 'index.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(lines).toHaveLength(2)
    expect(lines[0].page).toBe(1)
    expect(lines[1].barCount).toBe(42)
  })

  it('THE T1.5 HANDOFF - a bar time locates its page from the index alone', async () => {
    // This is the correction that made the capture design usable: without the
    // window on each entry, T1.5 inherits a directory and no index, and finding
    // one bar's payload means opening every file in a full backfill.
    const sink = createFileCaptureSink(root)

    await sink.indexPage('run-abc', 1, {
      requestedStart: '2020-01-24 13:00:00',
      requestedEnd: '2020-01-25 13:00:00',
      firstBarTime: '2020-01-24T13:00:00.000Z',
      lastBarTime: '2020-01-24T23:45:00.000Z',
      barCount: 44,
    })
    await sink.indexPage('run-abc', 2, {
      requestedStart: '2020-01-25 00:00:00',
      requestedEnd: '2020-01-26 00:00:00',
      firstBarTime: '2020-01-25T00:00:00.000Z',
      lastBarTime: '2020-01-25T23:45:00.000Z',
      barCount: 96,
    })

    const entries = (await readFile(join(root, 'run-abc', 'index.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    // The lookup T1.5 will actually perform, written out so the format is
    // pinned by a use rather than by a shape assertion.
    const wanted = Date.parse('2020-01-25T06:30:00.000Z')
    const found = entries.find(
      (e) => Date.parse(e.firstBarTime) <= wanted && wanted <= Date.parse(e.lastBarTime),
    )

    expect(found?.page).toBe(2)
    expect(found?.file).toBe('page-00002.json')
  })

  it('records a failed page in the index rather than skipping it', async () => {
    // A run's index must account for every page. A page that vanishes from it
    // is indistinguishable from a page never requested.
    const sink = createFileCaptureSink(root)
    await sink.indexPage(
      'run-abc',
      1,
      {
        requestedStart: '2020-01-24 13:00:00',
        requestedEnd: undefined,
        firstBarTime: undefined,
        lastBarTime: undefined,
        barCount: undefined,
      },
      'ValidationError: Unrecognised provider datetime format',
    )

    const entry = JSON.parse((await readFile(join(root, 'run-abc', 'index.jsonl'), 'utf8')).trim())

    expect(entry.error).toMatch(/ValidationError/)
    expect(entry.firstBarTime).toBeNull()
  })
})
