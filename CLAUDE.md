# KaratX

XAU/USD market-intelligence and setup-alerting system. Watches gold, detects setups, grades them, alerts. **Never places trades.**

**Read in this order:** `docs/ENGINEERING_PROMPT.md` (how to build — 47 sections, the source of truth) → `docs/STATUS.md` (where we are, what is unproven, what is owed) → `docs/BUILD-PLAN.md` (tasks and acceptance criteria) → `docs/DECISIONS.md` (ADRs). Detail lives in the other `docs/` files.

**Non-negotiable** — the rest is in the engineering prompt:

- `packages/core` performs **no I/O**: no fetch, no database, no clock, no randomness. Time is passed in. This is what makes the backtest honest.
- Only the deterministic state machine changes setup state. The LLM annotates; it never decides.
- Every derived fact records `occurred_at` and `confirmed_at`; queries filter on `confirmed_at`.
- Never print or commit a secret. `.env` is git-ignored.
- Plan first, in small steps, and get approval before implementing (§29, §30, §42).
- Say plainly when something is mocked, unproven or incomplete (§32).
- Update `docs/STATUS.md` at the end of every substantial session (§44).

```
pnpm install   pnpm lint   pnpm format:check   pnpm typecheck
pnpm test               unit tests — fast, no database
pnpm test:integration   against real Postgres
pnpm db:up              start local Postgres
pnpm db:migrate         apply migrations (deliberate step, never at boot)
```

First-time setup: `cp .env.example .env` then `pnpm db:up`.

**Stack:** TypeScript (pinned to 6.x — see `docs/STATUS.md`), pnpm workspaces, PostgreSQL + Drizzle, Zod, Vitest, Pino. Two deployable processes: `apps/web` (Next.js) and `apps/worker` (plain Node).
