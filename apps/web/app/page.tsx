/**
 * Deliberately plain.
 *
 * §38: do not build a flashy trading UI that gives a false impression that
 * incomplete backend logic is finished. There is no market data, no feed and
 * no engine yet, so a page implying otherwise would be a lie told in CSS.
 *
 * The real dashboard - freshness, market state, setup state, levels, evidence,
 * warnings, plan and system health - arrives in Phase 6 (FR-10.1).
 */
export default function Home() {
  return (
    <main>
      <h1>KaratX</h1>
      <p>XAU/USD market intelligence. This system never places trades.</p>
      <p>
        Phase 0 skeleton. No market data is being ingested and no strategy logic exists yet. See{' '}
        <code>docs/STATUS.md</code> for what is actually built.
      </p>
      <ul>
        <li>
          <a href="/api/health">/api/health</a> - process liveness
        </li>
        <li>
          <a href="/api/ready">/api/ready</a> - database and migration readiness
        </li>
      </ul>
    </main>
  )
}
