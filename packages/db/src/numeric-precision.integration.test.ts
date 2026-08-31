import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

/**
 * The price representation depends on a mechanism, not on a convention.
 *
 * ADR-008 requires preserving the decimal text as received and never
 * round-tripping through `Number()`. That only works if the database layer
 * hands prices back as strings. It does, and this pins WHY:
 *
 *   node-postgres returns NUMERIC (OID 1700) as a STRING by default, because a
 *   JS number cannot represent arbitrary-precision decimals. Drizzle's
 *   `numeric()` column preserves that string.
 *
 * THE HAZARD THIS TEST EXISTS TO CATCH. A future session adding
 * `pg.types.setTypeParser(1700, parseFloat)` "for convenience" would silently
 * convert every price in the system to a float64 and reintroduce exactly the
 * corruption the string representation avoids. Nothing else would fail: the
 * types still line up, the queries still run, and prices quietly become
 * approximations.
 */

const NUMERIC_OID = 1700

describe('NUMERIC round-trip', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: inject('databaseUrl') })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns NUMERIC as a string, not a number', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE TEMP TABLE probe (v NUMERIC(12,5)) ON COMMIT DROP')
      await client.query("INSERT INTO probe VALUES ('4643.35156')")
      const { rows } = await client.query<{ v: string }>('SELECT v FROM probe')

      expect(typeof rows[0]?.v).toBe('string')
      expect(rows[0]?.v).toBe('4643.35156')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('PADS to the declared scale - the value is exact, the TEXT is normalised', async () => {
    // This is the part that would be easy to state wrongly. `8.1` does not come
    // back as "8.1"; it comes back as "8.10000". Nothing is lost - the value is
    // identical - but stored text is NOT byte-identical to what a provider
    // sent, and Twelve Data emits a variable number of decimals.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE TEMP TABLE probe (v NUMERIC(12,5)) ON COMMIT DROP')
      await client.query("INSERT INTO probe VALUES ('8.1')")
      const { rows } = await client.query<{ v: string }>('SELECT v FROM probe')

      expect(rows[0]?.v).toBe('8.10000')
      expect(rows[0]?.v).not.toBe('8.1')
      // Same value, different text.
      expect(Number(rows[0]?.v)).toBe(8.1)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('POSITIVE CONTROL: float8 exhibits the corruption NUMERIC avoids', async () => {
    // Without this, "NUMERIC is exact" is an assertion about a value that might
    // simply be representable. This shows the same query shape producing the
    // wrong answer when the column is a float.
    const client = await pool.connect()
    try {
      const exact = await client.query<{ s: string }>(
        "SELECT ('0.1'::numeric + '0.2'::numeric) AS s",
      )
      const approx = await client.query<{ s: number }>(
        "SELECT ('0.1'::float8 + '0.2'::float8) AS s",
      )

      expect(exact.rows[0]?.s).toBe('0.3')
      expect(approx.rows[0]?.s).not.toBe(0.3)
      expect(0.1 + 0.2).not.toBe(0.3)
    } finally {
      client.release()
    }
  })

  it('no parser is registered for NUMERIC, which is what keeps it a string', async () => {
    // Pins the mechanism itself rather than one of its consequences. If someone
    // registers a parser, this fails and names the reason.
    const { types } = await import('pg')
    const parser = types.getTypeParser(NUMERIC_OID, 'text')
    const parsed = parser('4643.35156')

    expect(typeof parsed).toBe('string')
    expect(parsed).toBe('4643.35156')
  })
})
