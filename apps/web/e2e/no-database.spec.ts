import { expect, test } from '@playwright/test'

/**
 * Proves the database was ABSENT during this run.
 *
 * Without this file the smoke tests prove less than they appear to. They assert
 * that the root page and `/api/health` work, and the claim being made is that
 * they work WITHOUT a database — but a run that happened to have PostgreSQL
 * available would pass identically. A green suite would be compatible with
 * either condition, and nothing would say which held.
 *
 * That is the same error as reading "no restriction found" as "available", and
 * the same shape as an absence check with no positive control: the observation
 * is real, but it does not support the conclusion drawn from it.
 *
 * So this asserts the condition directly. `/api/ready` is the one endpoint
 * DEFINED as touching the database, and `playwright.config.ts` pins the server's
 * DATABASE_URL to a port nothing listens on.
 */

/** The password in playwright.config.ts's deliberately unreachable URL. */
const PLANTED_PASSWORD = 'n0tar3alpassw0rd'

test('/api/ready reports the database as unreachable, proving there was none', async ({
  request,
}) => {
  const response = await request.get('/api/ready')

  // 503, not 200-with-a-sad-payload: a monitor reading only the status code
  // must see failure.
  expect(response.status()).toBe(503)

  const body = (await response.json()) as {
    status: string
    database: { connected: boolean }
  }

  expect(body.status).toBe('not_ready')
  expect(body.database.connected).toBe(false)
})

test('the server BOOTED despite having no database, which is the intended behaviour', async ({
  request,
}) => {
  // Boot-time validation checks configuration SHAPE, not reachability (that is
  // I/O, and T0.3 deliberately kept it out of the schema). An unreachable but
  // well-formed URL must therefore start the server, and readiness — not
  // startup — is where the failure surfaces.
  //
  // If this ever fails, boot has started connecting to the database, and
  // /api/health stops being the "touches nothing" endpoint its contract claims.
  const health = await request.get('/api/health')

  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok', service: 'web' })
})

test('the readiness payload never leaks the connection password', async ({ request }) => {
  // DATABASE_URL carries a password and /api/ready is exactly the kind of
  // endpoint that ends up on a public status page or in a screenshot. Driver
  // errors do not usually embed the URL, but "usually" is not a guarantee worth
  // relying on for a credential.
  //
  const response = await request.get('/api/ready')

  // ASSERT THE FAILURE PATH ACTUALLY RAN, before asserting what it did not
  // print. Against a REACHABLE database this test would pass while proving
  // nothing: no connection error occurs, so the redaction code never executes,
  // and "the password is absent" is true only because it was never handled.
  //
  // Verified by mutation: removing the DATABASE_URL pin from
  // playwright.config.ts made this test pass vacuously. This line is what
  // turns it red instead.
  expect(response.status()).toBe(503)

  const body = await response.text()

  expect(body).not.toContain(PLANTED_PASSWORD)
  expect(body).not.toContain('e2e:')
})
