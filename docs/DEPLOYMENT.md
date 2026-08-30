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
| `NODE_ENV=production` | — | ✓ | set on the service |
| `LOG_LEVEL=info` | ✓ | ✓ | set on the service |
| `NEXT_TELEMETRY_DISABLED=1` | ✓ | — | set on the service |
| `PORT` | injected | — | Railway |

**`DATABASE_URL` is a reference, never a copied value.** It is never typed by
hand, never pasted, and never in Git. Use the **private** URL — not
`DATABASE_PUBLIC_URL` — so the database is not exposed to the internet. Railway also bills
network egress, and "using Private Networking when communicating with other
services (such as databases) within your Railway project will help you avoid
unnecessary Network Egress costs" — so the private URL is the cheaper one too.

**No secrets are needed in GitHub Actions.** CI runs against a throwaway
PostgreSQL service container whose credentials are in the workflow file, exactly
like `.env.example`.

### A matched default is not an ASSERTED value

**A value that MATCHES Railway's default and a value ASSERTED to equal that
default are indistinguishable in the UI, different in the project's state, and
only the second survives Railway changing its default.**

Three of `web`'s settings did not stage when first entered, because the value
typed already equalled Railway's own default:

| Setting | Our value | Railway's default |
|---|---|---|
| Healthcheck Timeout | 300 | **documented** — "The default timeout on healthchecks is 300 seconds (5 minutes)" |
| Restart Policy | `ON_FAILURE` | **UNDOCUMENTED**; observed on a fresh service |
| Restart Max Retries | 10 | **UNDOCUMENTED**; observed on a fresh service |

The two undocumented ones are the weaker case. There is no published contract
for Railway to break by changing them, so a change would arrive without notice.

**THE PIN.** Set the field to a different value, then set it back. The
pending-changes counter goes UP on the first edit and **STAYS UP** on the
second: the field is now recorded as an assertion rather than inherited.

```
Healthcheck Timeout   300 -> 299   counter 10 -> 11
                      299 -> 300   counter STAYS at 11
```

**The counter is the only thing that distinguishes the two states.** Both read
`300` in the input box afterwards. Accepting "the field already says 300" leaves
the value unpinned, and looks identical to having pinned it.

**Confirm in the Details panel, not the counter.** The counter has been observed
rendering "0 changes to apply" against a list of nine pending items, so a
counter that merely fails to decrement is indistinguishable from a real
assertion until the itemised panel shows the change.

---

## Cost

Railway bills **per-second on the CPU, memory and disk a service actually
uses** — $20 / vCPU / month, $10 / GB RAM / month, with volumes "billed at a
rate per GB / minutely". An idle service still bills.

| Plan | Fee | Included usage | Volume cap |
|---|---|---|---|
| Free | $0 | **$1 / month** | 0.5 GB |
| Trial | $0 | $5 one-time, **expires after 30 days** | 0.5 GB |
| Hobby | $5 | $5 / month | 5 GB |
| Pro | $20 | $20 / month | 50 GB |

**THIS PROJECT CANNOT RUN ON A FREE TIER.** Two always-on services plus a
Postgres is roughly **$9–13/month** of usage against the Free plan's $1
allowance. The gap is an order of magnitude, not a margin. Hobby's $5 fee covers
the first $5 of usage, so the realistic all-in figure is **$9–13/month**.

**The worker is the CHEAP part** — perhaps $2–2.50/month. It spends its life
waiting on a feed: near-zero CPU, a small constant RAM footprint. The expensive
terms are **Postgres** (memory plus disk, and the disk GROWS as bars accumulate)
and **`web`** (the largest RAM footprint of the three, serving a dashboard that
nobody is looking at most of the time). If cost ever needs cutting, `web` is the
candidate — not the feed, which is the product.

**When credit is exhausted**, Railway "will stop all of your workloads" and
blocks further deploys until a card is added. Volumes are retained 30 days on
Free/Trial, 60 on Hobby, 90 on Pro. A stop, not a data loss — provided someone
notices inside the window.

**Set a usage limit before deploying.** Railway supports configurable maximum
spending thresholds. Use them.

### Serverless / sleeping — NEVER ENABLE ON THE WORKER

Railway's Serverless is **opt-in per service**, not automatic, and not on by
default. "When Serverless is enabled for a service, Railway automatically
detects inactivity based on outbound traffic"; a service is "considered inactive
after 5 minutes" and is woken "when it receives traffic from the internet or
from another service in the same project through the private network".

**A market feed that sleeps is not a market feed.** Worse than the gap itself:
the Phase 1 staleness watchdog would fire on the platform's own behaviour and be
read as a data-provider outage. Leave Serverless **OFF** for `worker`.

It is defensible for `web`, which serves a dashboard on demand and whose
healthcheck is only a deploy gate (warning 1). Not enabled today; noted as the
first lever if cost needs cutting.

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


### WHAT A RESTORE ACTUALLY COSTS

Restoring a three-day-old backup loses three days of writes. What that costs
depends entirely on **which** writes.

**Candles: re-fetchable, cheaply.** Measured against Twelve Data on 2026-08-27 —
5,000 bars per request at 8 credits/minute, history reaching back to 2020-04-06
at 1min and 2020-01-24 at 15min.

| Gap | 1min bars | Requests |
|---|---|---|
| 3 days | 4,320 | **1** |
| 1 month | ~43,200 | 9 |
| 1 year | ~525,600 | 106 |

A three-day gap is a single request. The full 6.6-year backfill at 15min was
measured at 47 requests and roughly six minutes.

**Derived data: NOT re-fetchable, from anywhere.** Detected setups, state
transitions, grades, alerts sent, LLM annotations and the manual trade journal
exist only in our own database. Twelve Data can return the bars; it cannot
return what we concluded from them.

**So backup frequency is governed by DERIVED data, not by candles** — which
inverts the obvious intuition that the biggest table is the thing to protect.
Before Phase 4 a restore costs an API call. From Phase 4 onward it costs
reasoning that exists nowhere else, and backup frequency stops being a
formality and becomes a real decision.

**A caveat that does not go away.** Re-fetched bars are confirmed at restore
time, not at their original time: `occurred_at` survives, `confirmed_at` does
not. Anything measuring detection latency across a re-fetched window is
measuring the restore rather than the system. This is the same limitation
ADR-011 records for machine-sleep gaps, with the same mitigation — exclude
repaired windows from latency-sensitive analysis.

**NOT ESTABLISHED:** whether Twelve Data's free tier imposes a **daily** request
cap. Only the per-minute rate was measured. Establish it before relying on a
large re-fetch, because a 106-request year-long backfill is where a daily cap
would first bite.

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
