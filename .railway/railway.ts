import { github, postgres, project, service } from 'railway'

/**
 * KaratX infrastructure, defined in code.
 *
 * WHY THIS FILE AND NOT `railway.json`. Railway's Config as Code is deprecated:
 * existing files keep working until 2026-12-01, but "New services cannot opt
 * into Config as Code" - and that restriction is per SERVICE, not per project.
 * `web` and `worker` do not exist yet, so a `railway.json` would not have been
 * deprecated-but-working for them. It would simply not be read. See ADR-010.
 *
 * WHAT THIS FILE IS NOT THE ONLY RECORD OF. `DEPLOYMENT.md` carries a table of
 * every setting and its exact value. The SDK's own README says it "is in beta
 * and there will be breaking changes", so the mechanism may not survive; the
 * record should. If this file stops working, the table is enough to reproduce
 * the configuration by hand.
 *
 * VERIFY CHANGES WITH `railway iac plan` BEFORE `apply`. The plan shows a diff.
 */

const REPO = 'georginamurray2026-eng/KaratX'

/** Already exists in the project. Declared so services can reference it. */
const db = postgres('Postgres')

/**
 * The Next.js dashboard. Reads what the worker wrote; never computes strategy.
 */
const web = service('web', {
  source: github(REPO),

  build: {
    buildCommand: 'pnpm --filter @karatx/web build',
    // Without watch patterns, every push redeploys BOTH services. The shared
    // packages are included because a change in packages/core genuinely
    // affects both.
    watchPatterns: ['apps/web/**', 'packages/**', 'package.json', 'pnpm-lock.yaml'],
  },
  start: 'pnpm --filter @karatx/web start',

  // /api/ready, NEVER /api/health.
  //
  // The healthcheck is a DEPLOY GATE - Railway stops querying it once the
  // deployment is live. So it answers one question: should this deployment
  // replace the running one?
  //
  // /api/health returns 200 with the database unreachable. That is its
  // contract - it touches nothing - and apps/web/e2e/no-database.spec.ts
  // asserts exactly that against a database pinned to an unreachable port.
  // Using it here would let a deployment that cannot reach its database go
  // live and report success: the T0.7 "deployment that lies about having
  // worked", one layer up.
  //
  // /api/ready returns 503 unless the database is reachable AND the schema
  // matches what the build expects.
  healthcheck: '/api/ready',
  healthcheckTimeout: 300,

  deploy: {
    // ON_FAILURE, not ALWAYS: a process that exits 0 has finished, and
    // restarting it would hide that. After 10 attempts Railway stops and the
    // service shows as crashed rather than flapping silently - crash-loop
    // visibility, per T0.8.
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
  },

  env: {
    // A REFERENCE, not a copied value. Never typed by hand, never in Git.
    // The PRIVATE URL - not DATABASE_PUBLIC_URL - so the database is not
    // exposed to the internet.
    DATABASE_URL: db.env.DATABASE_URL,

    // NODE_ENV is deliberately NOT set here. Next.js assigns it itself:
    // "If the environment variable NODE_ENV is unassigned, Next.js
    // automatically assigns development when running next dev, or production
    // for all other commands." Setting it would pin a value ahead of the
    // framework's own decision, for a reason we could not evidence.
    //
    // The worker DOES set it - nothing assigns it there, and our schema
    // defaults to 'development', which would be written into system_events.
    LOG_LEVEL: 'info',
    NEXT_TELEMETRY_DISABLED: '1',
  },
})

/**
 * The long-lived worker: feed, scheduler, engine, dispatcher.
 *
 * No build step. It runs its TypeScript source under `tsx` - see ADR-009, which
 * records why bundling machinery buys nothing for one long-lived process and
 * what would reverse that.
 */
const worker = service('worker', {
  source: github(REPO),

  build: {
    // No buildCommand: ADR-009 - the worker runs its TypeScript source under
    // tsx and produces no artefact. This entry exists only to carry the watch
    // patterns, so a push touching only apps/web does not redeploy the worker.
    watchPatterns: ['apps/worker/**', 'packages/**', 'package.json', 'pnpm-lock.yaml'],
  },
  start: 'pnpm --filter @karatx/worker start',

  // MIGRATIONS AS A DELIBERATE RELEASE STEP (OPS-2 / ADR-003).
  //
  // Railway runs this between building and deploying, in a SEPARATE container,
  // and "if your command fails, it will not be retried and the deployment will
  // not proceed". No application process exists while it runs, which is the
  // property ADR-003 protects - see its 2026-08-28 amendment.
  //
  // ON THE WORKER ONLY. Exactly one service may carry it or two deployments
  // race the same database, and the worker is the component that refuses to
  // boot against a mismatched schema (T0.8), so the release step and its
  // strictest consumer sit together.
  preDeploy: 'pnpm --filter @karatx/db db:migrate',

  // No healthcheck: the worker serves no HTTP. Its equivalent is exiting
  // non-zero, which the restart policy below governs.
  deploy: {
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 10,
  },

  env: {
    DATABASE_URL: db.env.DATABASE_URL,
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
  },
})

export default project('KaratX', {
  resources: [db, web, worker],
})
