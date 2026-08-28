# Deployment

How KaratX runs on Railway, and the three things about it that are not obvious.

Read the three warnings first. Each describes a way a deployment can look
healthy while being broken, and each is the kind of thing that is expensive to
learn during an incident.

---

## ⚠️ 1. THE HEALTHCHECK IS A DEPLOY GATE, NOT A LIVENESS PROBE

**Railway only queries the healthcheck while a deployment is going live. It does
not monitor it afterwards.** From Railway's own documentation:

> "Railway does not monitor the healthcheck endpoint after the deployment has
> gone live."

So the healthcheck answers exactly one question — *should this new deployment
replace the old one?* — and answers it once.

**What this means in practice.** If the database becomes unreachable at 3am:

- `/api/ready` starts returning 503, correctly
- **nothing restarts the service**
- **nothing alerts anybody**
- the deployment stays "live" and healthy in Railway's UI
- the dashboard serves 503s until a human notices

**"We have health endpoints" reads as covered and is not.** The endpoints are
correct; nothing is watching them. Continuous monitoring and alerting is OPS-8
and does not exist yet — see STATUS.md obligation 27.

### Which endpoint, and why

**`/api/ready`. Never `/api/health`.**

`/api/health` returns **200 with the database unreachable** — that is its
contract, it touches nothing, and `apps/web/e2e/no-database.spec.ts` asserts
exactly that against a database pinned to an unreachable port. Pointing Railway's
deploy gate at it would let a deployment that cannot reach its database go live
and report success.

`/api/ready` returns **503** unless the database is reachable **and** the schema
matches what the build expects. That is the question a deploy gate should ask.

---

## ⚠️ 2. ROLLBACK DOES NOT ROLL BACK THE DATABASE

**Rolling back code past a migration leaves the new schema live and the old code
running against a shape it has never seen.**

Railway's rollback redeploys a previous *image*. The database is not part of that
image. Whatever the last migration did is still done.

**Only forward-compatible migrations are safe to roll through.** That is a
constraint on how migrations are WRITTEN, not merely on how rollback behaves, and
the rule lives in [`DECISIONS.md`](./DECISIONS.md) under ADR-003 because that is
what someone authoring a migration is already reading:

- **add, do not alter** — new nullable columns and new tables are safe
- **split destructive changes across two releases**, so each step is
  independently roll-back-able
- **a migration that cannot be made forward-compatible is a one-way door** and
  must be flagged as such in its pull request. After it lands, rollback stops
  being a recovery option and **restoring a database backup starts**

---

## ⚠️ 3. ROLLBACK AND REDEPLOY ARE DIFFERENT OPERATIONS

They sound interchangeable. They are not, and the one you get depends on how old
the deployment is.

| | **Rollback** | **Redeploy** |
|---|---|---|
| What it does | restores a previously built **image** | **rebuilds from source** |
| Available | only within the retention window | always |
| Reproducible | yes — the same artefact | no — a fresh build of the same commit |
| Dependencies | exactly as they were | re-resolved at build time |

**Retention by plan:** Trial 24 hours, Hobby 72 hours, Pro 120 hours.

**Past the window, Railway stops offering rollback and offers redeploy instead.**
Someone reaching for "roll back" three days after a bad release gets a *rebuild*
without necessarily noticing — and a rebuild can differ from the original if any
dependency resolved differently, which is precisely when you least want a
surprise.

**If a rollback matters, do it inside the window.** Past that, treat a redeploy
as a new release: it deserves the same scrutiny as any other deploy, not the
confidence a rollback would carry.

---

## Topology

One repository, one Railway project, three services.

| Service | What it is | Runs |
|---|---|---|
| `Postgres` | Railway-managed database | — |
| `web` | Next.js dashboard | `pnpm --filter @karatx/web start` |
| `worker` | long-lived Node process | `pnpm --filter @karatx/worker start` |

`web` and `worker` deploy from the **same repository**, differentiated by build
and start commands rather than by root directory — pnpm workspaces need the
repository root as the build context.

**Watch patterns** stop every push redeploying both services:

- `web` — `apps/web/**`, `packages/**`
- `worker` — `apps/worker/**`, `packages/**`

### Why the worker has no build step

It runs its TypeScript source under `tsx`. See **ADR-009** — one long-lived
process where boot time and image size are irrelevant, so bundling machinery buys
nothing. The ADR records the reversal condition.

---

## Configuration

| Variable | `web` | `worker` | Source |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | Railway **variable reference** to the Postgres service |
| `NODE_ENV=production` | ✓ | ✓ | set on the service |
| `LOG_LEVEL=info` | ✓ | ✓ | set on the service |
| `NEXT_TELEMETRY_DISABLED=1` | ✓ | — | set on the service |
| `PORT` | injected | — | Railway |

**`DATABASE_URL` is a reference, never a copied value.** It is never typed by
hand, never pasted, and never in Git. Use the **private** URL — not
`DATABASE_PUBLIC_URL` — so the database is not exposed to the internet.

**No secrets are needed in GitHub Actions.** CI runs against a throwaway
PostgreSQL service container whose credentials are in the workflow file, exactly
like `.env.example`.

---

## Migrations

**Configured as a Pre-Deploy Command on the `worker` service only:**

```
pnpm --filter @karatx/db db:migrate
```

Railway runs it between build and deploy, in a **separate container**, and *"if
your command fails, it will not be retried and the deployment will not proceed."*
No application process exists while it runs.

**Exactly one service may carry it**, or two deployments race the same database.
It sits on the worker because the worker is the component that refuses to boot
against a mismatched schema.

This satisfies ADR-003's "never at boot" — see the amendment there, which records
the reading so it is not re-litigated.

---

## The rollback drill

**A documented rollback nobody has performed has not been shown to work.** Run
this once, deliberately, and record the result in STATUS.md.

1. Note the current deployment on the `web` service
2. Deploy a change with a **visible marker** — a version string on the root page
3. Confirm the marker is live in a browser
4. **Deployments** → the *previous* deployment → **⋮** → **Rollback**
5. Confirm the marker is **gone** and the old page is served
6. Confirm `/api/ready` still returns **200**
7. Redeploy latest to return to current

**Observe and record whether the rollback re-runs the Pre-Deploy Command.**
Railway's documentation does not say. If it does, migrations re-run — harmless,
since they are idempotent — but it should be a known fact rather than a guess.

---

## Backups and restore

Railway offers **daily** (6 days), **weekly** (1 month) and **monthly** (3
months) schedules on the Postgres service's volume.

**Restore is not in place.** It creates a **new volume**, unmounts the old one,
and goes through a staged deployment for review.

**⚠️ Restoring removes any backups newer than the one restored.** This is why the
restore drill belongs in Phase 0, while the database holds one migration and no
market data. After Phase 1 it costs real history.

### The restore drill

1. Enable **Daily** backups on the Postgres service
2. Take a **manual** backup
3. Insert a marker row into `system_events`
4. Restore the backup from step 2
5. Confirm the marker row is **gone**

---

## What is deliberately absent

- **No volumes on `web` or `worker`.** Neither writes to disk. Audited at T0.10:
  zero filesystem write calls in production code paths; the only reads probe for
  an optional `.env` that does not exist in a deployed environment. Next writes
  `.next/cache` at runtime, which is a cache and correctly ephemeral. (OPS-5)
- **No public database access.** The private `DATABASE_URL` only.
- **No continuous health monitoring.** See warning 1 — this is a known gap, not
  an oversight, and it is obligation 27.
