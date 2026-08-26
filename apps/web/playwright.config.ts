import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests (§11 requires Playwright for important user workflows).
 *
 * Deliberately tiny for now. ARCHITECTURE-AND-STACK.md is explicit: set
 * Playwright up in Phase 0 with one smoke test, and write almost nothing more
 * until Phase 6. Writing end-to-end tests before there is a dashboard worth
 * testing is wasted effort that then rots.
 *
 * Chromium only. Cross-browser coverage would triple the browser download and
 * the run time to test a page that is currently four paragraphs; add browsers
 * when there is a UI whose rendering could plausibly differ.
 */
export default defineConfig({
  testDir: './e2e',
  // `next start` needs a production build, and this is the one place that can
  // guarantee it rather than assuming a stale .next is current.
  webServer: {
    command: 'pnpm build && pnpm start --port 3461',
    url: 'http://127.0.0.1:3461',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: { baseURL: 'http://127.0.0.1:3461', ...devices['Desktop Chrome'] },
  // A flaky end-to-end test is worse than none: it trains people to re-run
  // rather than investigate. Failures should be real.
  retries: 0,
  reporter: [['list']],
})
