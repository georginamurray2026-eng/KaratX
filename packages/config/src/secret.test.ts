import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'

import { isSecret, Secret } from './secret'

// A password-shaped value. Not a real credential - it exists so the assertions
// below can prove it never reaches the output.
const PASSWORD = 'p4ssw0rd-should-never-be-printed'
const URL_WITH_PASSWORD = `postgres://karatx:${PASSWORD}@localhost:5432/karatx`

describe('Secret', () => {
  it('returns the real value only via reveal()', () => {
    const secret = new Secret(URL_WITH_PASSWORD)
    expect(secret.reveal()).toBe(URL_WITH_PASSWORD)
  })

  // Each of the following is a real way secrets escape in production code.
  // They are asserted separately so a regression names the exact leak path.

  it('does not leak through a template literal', () => {
    const secret = new Secret(URL_WITH_PASSWORD)
    const rendered = `connecting to ${secret}`
    expect(rendered).toBe('connecting to [REDACTED]')
    expect(rendered).not.toContain(PASSWORD)
  })

  it('does not leak through String()', () => {
    const rendered = String(new Secret(URL_WITH_PASSWORD))
    expect(rendered).toBe('[REDACTED]')
    expect(rendered).not.toContain(PASSWORD)
  })

  it('does not leak through implicit coercion', () => {
    const rendered = '' + new Secret(URL_WITH_PASSWORD)
    expect(rendered).toBe('[REDACTED]')
    expect(rendered).not.toContain(PASSWORD)
  })

  it('does not leak through JSON.stringify (and therefore Pino)', () => {
    const rendered = JSON.stringify({ databaseUrl: new Secret(URL_WITH_PASSWORD) })
    expect(rendered).toBe('{"databaseUrl":"[REDACTED]"}')
    expect(rendered).not.toContain(PASSWORD)
  })

  it('does not leak through util.inspect (and therefore console.log)', () => {
    const rendered = inspect({ databaseUrl: new Secret(URL_WITH_PASSWORD) })
    expect(rendered).toContain('[REDACTED]')
    expect(rendered).not.toContain(PASSWORD)
  })

  it('does not leak the value through the private field at runtime', () => {
    // `#value` is a true private field, so it is absent from enumeration and
    // from Object.keys - not merely conventionally hidden.
    const secret = new Secret(URL_WITH_PASSWORD)
    expect(Object.keys(secret)).toEqual([])
    expect(JSON.stringify(Object.entries(secret))).not.toContain(PASSWORD)
  })

  it('wraps values other than strings', () => {
    const secret = new Secret({ token: PASSWORD })
    expect(secret.reveal()).toEqual({ token: PASSWORD })
    expect(String(secret)).toBe('[REDACTED]')
  })

  it('identifies wrapped values via isSecret', () => {
    expect(isSecret(new Secret('x'))).toBe(true)
    expect(isSecret('x')).toBe(false)
    expect(isSecret(undefined)).toBe(false)
  })
})
