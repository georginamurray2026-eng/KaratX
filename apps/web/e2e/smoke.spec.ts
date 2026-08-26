import { expect, test } from '@playwright/test'

/**
 * The one end-to-end test Phase 0 calls for.
 *
 * It proves the whole stack serves a real page over HTTP: Next builds, the
 * server starts, configuration validates at boot, and the browser renders. The
 * integration tests call route handlers directly and therefore cannot prove
 * any of that.
 *
 * It asserts nothing about appearance. §38 warns against polish that implies
 * incomplete backend logic is finished, and a test asserting on layout would
 * make that polish expensive to avoid.
 */
test('the root page loads and says what the system is', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'KaratX' })).toBeVisible()

  // The product boundary is stated on the page itself, not only in the docs
  // (§3: no automatic execution, ever).
  await expect(page.getByText('never places trades')).toBeVisible()
})

test('the health endpoint is reachable over HTTP', async ({ request }) => {
  // Proves the route is served by a real server, not merely that the handler
  // function returns the right object.
  const response = await request.get('/api/health')

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok', service: 'web' })
})
