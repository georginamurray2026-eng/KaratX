import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from './env.js'

describe('findRepoRoot', () => {
  it('finds the root from this package', () => {
    const root = findRepoRoot()
    expect(existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true)
  })

  it('finds the same root from a deeply nested directory', () => {
    // The failure this guards against: the previous helper counted '..'
    // segments, so moving the file changed which directory it resolved to,
    // silently and without error.
    const nested = path.join(findRepoRoot(), 'packages', 'db', 'src', 'schema')
    expect(findRepoRoot(nested)).toBe(findRepoRoot())
  })

  it('finds the root when already at the root', () => {
    const root = findRepoRoot()
    expect(findRepoRoot(root)).toBe(root)
  })

  it('throws a clear error when no repository root exists above the start', () => {
    // Walking off the top of the filesystem must fail loudly rather than
    // returning something arbitrary.
    expect(() => findRepoRoot(path.parse(process.cwd()).root)).toThrow(
      /Could not find the repository root/,
    )
  })
})
