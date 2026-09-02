# Lessons

Patterns worth applying deliberately, carried between sessions. Not obligations — those live in [OBLIGATIONS.md](./OBLIGATIONS.md).

**Split out of `docs/STATUS.md` on 2026-09-02 — obligation 25.** STATUS.md had
reached 3,247 lines of nested headings and pipe-delimited tables and had produced
four anchor-collision incidents, the last of them miscounting obligations by 11
because a regex matched three other tables. This file and its sibling are read
independently of the handoff and are edited most often by script, so separating
them makes scripted edits scope-safe by construction rather than by discipline.

**Content below is moved VERBATIM.** No wording was changed in the split; that
was deliberate, so this commit is reviewable as a move rather than as a rewrite.

## Lessons — things that should shape later work

Not obligations with an owner. Patterns worth applying deliberately rather than
rediscovering.

### First-boot states are real states, and they are missing from our criteria

T0.7's acceptance criteria described `/api/ready` as reporting "DB connectivity
and applied migration version". They did not mention the **unmigrated**
database — and `checkDatabase` got it wrong as a result, reporting a perfectly
reachable database as `connected: false` whenever migrations had not run.

That is not an edge case. **It is the state every fresh deployment is in**,
between the service starting and its release step completing. On Railway it
would have meant debugging connectivity for an hour when the answer was
`pnpm db:migrate`. The bug was a *wrong diagnosis*, not a crash — far harder to
notice, because everything appeared to work as designed.

It was findable only against a genuinely unmigrated PostgreSQL. A mock would
have agreed with whatever the code did. That is the argument for real-database
integration tests, demonstrated rather than asserted.

**At T0.10 and Railway, check deliberately for other states that exist only at
first boot**, rather than assuming the steady state is the only state:

- empty database — no schema at all
- migrated but no data — every table present, every one empty
- no configuration yet — service started before its variables were set
- first run after a rollback to an older image — the database carries
  migrations the code does not ship (already reported as `unknown` migrations)

The same question applies to T0.8's worker and to T1.7's feed: what does this
component do the very first time it runs, before anything upstream has
produced anything?

### A start signal is not proof of a working boot

With configuration validation throwing in `instrumentation.ts`, Next.js printed:

```
✓ Ready in 398ms
Failed to prepare server: ... instrumentation hook: Invalid environment configuration
```

**"✓ Ready" prints before the failure.** Next caught the error and kept
serving: process alive, port bound, HTTP 500 to every request indefinitely —
including `/api/health`, an endpoint defined as touching nothing, contradicting
its own contract.

Every signal a platform uses to judge a deployment reported success. Railway
would have shown a healthy service; a TCP check passes; a log scraper watching
for the ready line finds it. Fixed by `process.exit(1)` in `register()`.

**When T0.8 builds the worker and T0.10 reaches Railway, do not treat a start
signal as proof of a working boot.** Ask what the process does when its
dependencies are absent, and *verify the answer* rather than assuming it.

**Specifically for T0.8:** the worker is a plain Node process, so a thrown
error at boot probably does kill it — but "probably" is exactly what was just
disproved for Next. Verify it the same way, by starting it with a broken
environment and observing the exit code.

### An absence result needs a POSITIVE CONTROL — this is the strongest form of the rule

**AN ABSENCE RESULT IS MEANINGFUL ONLY ALONGSIDE A POSITIVE CONTROL USING THE
SAME QUERY SHAPE. If the query cannot demonstrate PRESENCE where presence is
expected, its absence result proves nothing.**

Before believing "there are no Saturday bars", run the identical query against a
Wednesday. If Wednesday is also empty, the query is broken, not the market.

**This subsumes everything below it.** It would have caught instance 7 (a 403
returns zero rows on a weekday too) and it is the ONLY thing that caught
instance 8, where the older rules all passed and the conclusion was still wrong.
Reach for this first.

---

The earlier, weaker form is kept because it is cheap and catches the common case:

**AN ABSENCE CHECK MUST FIRST ESTABLISH THAT THE OBSERVATION WAS VALID. Zero
results means nothing until the request is confirmed to have succeeded. Every
check for absence needs two assertions:**

1. **the observation succeeded** — HTTP 200, process exited 0, file was read,
   query returned; and
2. **the thing is absent** — zero rows, no match, no warning.

**Conflating them manufactures clean passes out of failed requests.**

Then, separately: **before trusting the check, make it FAIL deliberately and
confirm you see the failure.** A check that has never been observed failing has
not been shown to work.

**THE SECOND RULE DOES NOT SUBSTITUTE FOR THE FIRST.** That is the whole content
of instance 7 below: the sweep *did* fail, and reported success, so "make it
fail on purpose" had nothing to catch. A deliberately-broken run and a
denied-request run produce the same clean output when the check only looks at
the count.

Thirteen instances so far, all caught by reading the actual output rather than the
exit code or the absence of an error:

| Where | What looked fine | What was actually happening |
|---|---|---|
| T0.6 `verifyNotInTransaction` | A guard on the operation that drops databases | `pg_stat_activity.state` is `'active'` during any query, so it could never fire |
| T0.7 Turbopack runtime guard | `NEXT_RUNTIME !== 'nodejs'` early return | Turbopack analyses statically; warnings unchanged, 6 → 6 |
| T0.8 secret-leak probe | "No password in the crash output" | The planted value was a *valid* URL, so nothing failed and no error path ran |
| T0.8 escaping bug | Exit code 1, apparently a config failure | Exit 1 came from esbuild — an unterminated string literal, never reaching the code under test |
| T0.8 `.env` precedence loop | A loop preserving explicitly-set variables over the file | Node's `loadEnvFile` **already** gives the environment precedence. Deleting the loop broke no test — because it had never done anything. Found by mutating it away, not by reading it |
| T0.8 mutation probe, second attempt | 7 integration tests failing — the mutation "working" | The mutation itself was a syntax error, so the worker never started. Seven failures from a broken probe, none from the assertion under test. **The same escaping trap as the row above, two rows apart** |
| **T1.1 EODHD Saturday sweep** | Seven years of Saturdays reported `0 bars   correct - market closed` | **Every one was HTTP 403 "Only EOD data allowed for free users".** The check tested `bars === 0` without testing whether the request succeeded. Zero rows because access was DENIED, rendered as a clean pass. **Written days after this lesson, inside the sweep designed to be rigorous** |
| **T1.1 Massive Saturday check** | `0 bars, request OK -> VALID ABSENCE` — both assertions satisfied | `limit` in that API caps BASE AGGREGATES SCANNED, not results returned. `limit=200` examined **3.3 hours** of the Saturday it claimed to cover. The request genuinely succeeded and genuinely returned zero rows — **the conclusion was still wrong** |
| **T0.9 e2e password test** | "the readiness payload never leaks the password" — passing | Against a REACHABLE database no connection error occurs, so the redaction code never runs. The password was absent only because nothing had handled it. Asserting the 503 FIRST is what makes it real. **Caught while writing the test, not in a later audit — the first time** |
| **T0.9 deliberate-red, first attempt** | A detailed prediction of which four jobs would go red, and why | **PRECONDITION NEVER VERIFIED.** The `push` trigger is filtered to `main` and the accompanying instruction was "do not open a pull request" — so nothing ran at all. The most confident output of the exercise was produced before anything could possibly happen |
| **T0.10 Railway SDK type search** | `preDeploy 0 / restartPolicy 0 / watchPattern 0` — read as "IaC cannot express these" | **Every zero was fake.** The pipeline was `grep … | paste -sd+ | bc` and `bc` is not installed; each `0` came from the author's own `|| echo 0` fallback. The types support **all three**. **The first time a positive control saved a DECISION rather than a test** |
| **T0.10 `railway iac plan` output** | A plan diff reported back in detail: which resources would be created, which settings would change | **THE COMMAND HAD NEVER RUN SUCCESSFULLY.** The SDK version check was still failing. The output was not a misread of a real result — there was no result. Caught only because the other party said so outright. **The only instance where the artefact did not exist at all** |
| **Dependabot Updates, 2026-08-29** | No dependency-update PRs arriving — indistinguishable from having no outdated dependencies | **PARTLY WRONG — corrected 2026-09-01, see obligation 35.** What was recorded: *the update job had been failing since 2026-08-29.* What the run log actually shows: the SCHEDULED update job was **succeeding**, and only the esbuild SECURITY update was red. The lesson survives; the diagnosis under it did not, and it was never checked against the log. Original text follows. **THE UPDATE JOB HAD BEEN FAILING SINCE 2026-08-29.** The healthy signal for this control is SILENCE, so a broken checker and a clean repository produce identical observable output. Found by scrolling past a red run while looking at something else. **The first instance where the broken check was VENDOR-OPERATED and not ours** |

The leak probe is the sharpest: it produced confident reassurance from a code
path that never executed. Its exit code and its output both looked like a pass.

This is why the T0.6 boundary test, the T0.7 `force-dynamic` test and the T0.7
boot test were each proven by deliberately breaking the thing they guard. That
is not thoroughness for its own sake — it is the only evidence that the check
is connected to anything.

#### Instance 7 happened while deliberately applying this lesson

**This is the part a future session most needs to know.** The EODHD Saturday
sweep was written specifically because the Twelve Data weekend finding had made
the Saturday test a standard step. It was the rigorous check. It ran seven
requests, every one was refused with HTTP 403, and it printed seven lines saying
`correct - market closed`.

The lesson as previously written — "make it fail on purpose first" — could not
have caught this, because **the sweep did fail and reported success**. A
deliberately-broken run and a denied-request run are indistinguishable to a
check that only looks at the result count. Knowing the rule, and intending to
follow it, was not enough. The rule itself was incomplete.

Hence the two-assertion form above. The status code is not error handling; **it
is half the assertion.**

#### Instance 8 is a DIFFERENT FAILURE CLASS — the rules passed and the answer was wrong

**Instances 1–7 were all "the check tested nothing". Instance 8 is "the check
tested something real, but not the thing claimed".**

The Massive Saturday query returned HTTP 200 and zero bars. Assertion 1
satisfied: the observation succeeded. Assertion 2 satisfied: the thing was
absent. The reported conclusion — "market correctly closed" — was still wrong,
because `limit=200` meant the query had examined only the first 3.3 hours of
that Saturday.

**Strengthening the absence rule could not have caught this, because the rule
was followed correctly.** What caught it was a control: asking whether a WEEKDAY
was also sparse. A weekday returned 33 bars of 96 — visibly wrong — and that is
what exposed the query defect.

Hence the positive-control rule at the top of this section. It is stronger than
the two-assertion rule and it subsumes it.

#### When planting a value to prove a check fires, plant one the check REJECTS

**Canonical examples, documentation samples and well-formed placeholders are
frequently allowlisted or valid — which is precisely why they are reached for.**

Two instances, both probes that reported success from a code path that never
executed:

| Probe | Planted | Why it proved nothing |
|---|---|---|
| T0.7 secret-leak check | a **valid** postgres URL | `loadConfig` succeeded, so no error path ran and nothing could have leaked |
| T0.9 gitleaks control | `AKIAIOSFODNN7EXAMPLE` | AWS's canonical documentation key, **allowlisted by gitleaks by design**. "no leaks found" from a scanner that could not have found it |

The gitleaks one was caught before the history scan was cited as evidence.
Re-planted with a GitHub PAT and an RSA private key: exit 1, two findings,
values redacted. Only then was the clean history result worth anything.

#### A default-on-failure turns "the command failed" into "the answer is none"

**In a query whose purpose is to establish ABSENCE, a fallback is not a
convenience. It is the bug.**

Every one of these manufactures a finding out of a failure:

```
|| echo 0            catch { return [] }
?? 0                 2>/dev/null swallowing the error
|| true              .catch(() => undefined)
```

They exist to keep output tidy, and they destroy the exact distinction the
absence rule is built on — "I looked and found nothing" versus "I could not
look".

**INSTANCE 11 IS THE COSTLIEST SO FAR, because it nearly decided an
architecture.** A search of the Railway SDK's shipped types printed
`preDeploy 0`, `restartPolicy 0`, `watchPattern 0`. The pipeline was
`grep -rihc … | paste -sd+ | bc` and `bc` is not installed on this machine, so
every count came from the trailing `|| echo 0`.

**The types support all three.** Without the check, an ADR would have recorded
an architectural limitation that does not exist, and the configuration would
have been split between a file and a UI to work around it.

**What caught it was a positive control** — running the same broken query
against `healthcheck`, `build` and `env`, things that MUST be present.
They came back blank with `bc: command not found`, which exposed the pipeline
rather than the data.

**Note what this instance was NOT: a test.** Every prior instance was a check
that passed while verifying nothing. This was a measurement feeding a DECISION,
with no test involved anywhere. The rule generalises past testing — anything
that reports a count, a list, or an absence is subject to it.

#### When proving a test CAN fail, check WHICH assertion fired

**A test with three assertions and one mutation has proven ONE assertion. The
others remain unobserved, and "the test can fail" is then a claim about the test
rather than about its assertions. Mutate per assertion, or state which ones
remain unexercised.**

Obligation 20's process-crash test carries three assertions: it started, it did
not hang, it exited non-zero. Removing the rethrows made it fail — on the EXIT
CODE, because the event loop emptied and the process exited 0 rather than
hanging. **The hang assertion, the one specifically asked for, had still never
been seen firing.**

A second mutation — rethrows removed AND a `setInterval` holding the loop open —
produced it: *"the process never exited: a crash handler returned instead of
rethrowing, which SUPPRESSES the exit"*, at 30,066 ms.

Reporting after mutation 1 that "the test can fail" would have been a real
observation supporting a claim it does not cover — instance 8 exactly.


#### The specific trap, because it will recur

**A `limit` parameter may cap what is SCANNED rather than what is RETURNED.**
Massive documents it plainly — *"Limits the number of base aggregates queried to
create the aggregate results"* — and it had already been read during this very
evaluation. `limit=200` scanned 200 one-minute base aggregates: 3.3 hours,
yielding 13 fifteen-minute bars.

**Read what a limit limits before trusting a short result.** A short result is a
claim about the query at least as much as a claim about the data.

#### Instance 9 was caught DURING the work, not in a later audit

The T0.9 e2e password test originally passed under mutation: against a
reachable database no connection error occurs, so the redaction code never
runs, and "the password is absent" is true only because nothing handled it.
Asserting the 503 first is what turns it red.

**Instances 1–8 were all found forensically — during a close-out, an audit, or
a later reading. This one was found while writing the test.** That is the
difference between a rule that documents past mistakes and one that is
operating, and it is the whole reason for writing them down.

**Apply it going forward: any assertion of absence gets a deliberate failure
first.**

### DELETING A BRANCH DOES NOT REMOVE A SECRET

**Commits referenced by a pull request stay reachable in GitHub's storage and
remain visible in the closed PR's diff, permanently. Deleting the branch feels
like cleanup and is not.**

**If a real secret is ever committed and pushed, deletion is not the remedy.
REVOKE AND ROTATE IT, then treat the exposure as permanent.** Rewriting history
does not help either once GitHub has the objects.

This gives the planted-value rule below a SECOND edge. Plant something the
check rejects — and something that costs nothing to LEAVE BEHIND FOREVER.

T0.9's deliberate-red exercise planted a GitHub PAT-shaped token in a branch
that was always going to be deleted. It was fake and matches no account, so the
permanence costs nothing. **A real credential would have been retrievable
indefinitely while appearing to have been cleaned up** — which is worse than
not cleaning up at all, because it looks handled.

### The T0.8 close-out lesson, operating rather than remembered

**T0.9 was NOT recorded as complete when its pipeline went green.** Its
acceptance criteria were met and a linkable red run existed, but two of its own
obligations — 20 and 21 — were still unwritten. Declaring it done would have been
precisely the optimistic close-out recorded from T0.8, where two of three
pre-assessed verdicts were wrong and both in the same direction.

Worth recording as a distinct kind of entry: **a lesson that changed a decision
at the moment it applied, rather than being cited afterwards.** The refusal came
before the close-out, not during a later audit of it.


### A risk identified and left unmitigated is not risk management, it is NARRATION

**Predicting a failure and then watching it happen LOOKS like rigour and is not.**
**When a risk is flagged, either mitigate it, or state explicitly that it is
being accepted and why. Silence between prediction and outcome is the failure.**

Before T0.9's first deliberate-red push, this was written verbatim:

> it may fail at `format:check` first instead, since that step runs earlier — my
> inserted code may not be Prettier-clean. If so the lint proof is hidden behind
> an earlier failure.

It happened exactly as described. `format:check` tripped on the planted-secret
file, `lint` was skipped, and break 1 — the F.3 boundary violation, the most
valuable check in the repository — went unproven for two more runs.

**The information to prevent it was available and unused.** Reformatting one file
would have cost seconds.

**This applies to the reviewer too.** The prediction was read, understood, and
acted on by neither party. A flagged risk that both sides acknowledge and neither
owns is worse than an unflagged one, because everyone believes it is handled.

**APPLIED, NOT ONLY LEARNED.** The narrow re-run mitigated it within the hour:
`format:check` and `typecheck` were both run locally and confirmed exit 0
BEFORE the branch was pushed, so neither could mask the check under test. Both
breaks then proved cleanly. The difference between a lesson recorded and a lesson
operating is exactly this, and it is the entire value of this file.

### Reasoning from a symptom without checking the precondition — THREE TIMES

**Before concluding that a fix failed, check that the run contained the fix.**

CI #7 showed the static job aborting at `format:check` with `lint` skipped.
Author and reviewer independently concluded the always() guards were broken. They
were not: **the run was on `d209b50`, which predates the amendment `a9395d3`.**
The guards were absent from that commit, not defective.

That is the third instance in one task of reasoning from output without checking
the precondition — after the trigger finding (a prediction written for a process
that could not start) and the blast radius ("main will stay red forever", derived
from a lesson's wording rather than from what checkout fetches).

**All three were settled the same way: by measuring rather than arguing.** Which
commit did the run contain; does a branch push fire anything; what does a fresh
clone actually fetch.


### Vendor documentation is a STARTING POINT, not evidence

**Where a vendor capability decides something, check the artefact — the types,
the response, the actual behaviour. Twice now the documentation has been wrong
in the direction that would have changed a decision.**

| Vendor | The documentation said | The artefact said |
|---|---|---|
| Massive (T1.1) | free tier is *"End of day only"* | free tier **served 15-minute intraday** |
| Railway (T0.10) | `service()` supports 9 options; pre-deploy, restart policy and watch patterns absent | shipped `.d.ts` supports **all three**, plus `cronSchedule`, `rootDirectory` and container limits |

**Railway also contradicts itself about maturity.** The docs say *"TypeScript is
generally available"*; the SDK's own README says *"The SDK is in beta and there
will be breaking changes."* Both are current, and they cannot both be relied on.

The failure is asymmetric and worth naming: **documentation tends to UNDERSTATE
what a product does** — it lags the code, and omissions are cheaper to ship than
corrections. So "the docs do not mention it" is weak evidence of absence, while
"the docs promise it" is reasonable evidence of intent. Weight them differently.

**Practically:** read the docs to learn what to look for, then confirm against
the thing itself. For an SDK that means the type definitions; for an API, a real
authenticated call; for a platform behaviour, a deliberate test.


### An unsettled item presented inside a LIST OF ACTIONS will be actioned

**The annotation does not survive contact with the format. Either remove the
row, or issue the list without it and raise the open question separately.**

T0.10 issued a variables table for hand-entry into a UI. One row read:

| Variable | Value |
|---|---|
| `NODE_ENV` | **hold** — still unsettled between us |

**It was entered.** Not through carelessness — a row in a table of fields to
enter reads as a field to enter, and the qualifier lost to the format. The
decision to omit it had already been made and agreed.

**The practical form, which is the useful half:** when a decision is made
mid-task, **RE-DERIVE downstream instructions from the artefact** rather than
re-issuing an earlier list with an annotation attached.

**This came with its own natural experiment.** In the same task, Stage 1b was
re-derived by reading `railway.ts` at the moment of use, and was correct.
Stage 2 was re-issued from an earlier draft with a note attached, and produced
the wrong action. Same author, same session, minutes apart — the only variable
was whether the list was regenerated from the source.

**A stale instruction is more dangerous than a wrong one.** A wrong one tends
to fail visibly. A stale one was correct when written, carries the authority of
having been agreed, and describes a world that has since moved.

### The GAP between deciding and doing is where a false claim forms

**A decision is not an application. An approval is not a commit. An intention
to run a command is not its output.** Between settling something and doing it
there is a window in which it is natural to speak as though it is done — and
anything said in that window is a claim about an artefact that does not yet
exist.

Five instances in a single task, all the same shape:

| Spoken of as done | Actually |
|---|---|
| `railway.ts` edited to drop `NODE_ENV` | agreed twice, referred back to as applied, **never edited** until challenged |
| ADR-010 cited as recording the decision | **never written**; `grep -c` returned 0 |
| The upstream vendor issue "filed" | **never drafted** |
| `NODE_ENV` settled and therefore removed from the instructions | settled, but still listed |
| `railway iac plan` output, reported as a diff | **the command had never run successfully** — instance 12 above |

**The last one shows how far this goes.** The others describe an artefact in
the wrong state; that one describes an artefact that was never produced. Same
gap, same confident register — a decision to run something, narrated as though
it had been run.

**The failure is not forgetting — it is the CONFIDENCE OF THE REFERENCE.** Each
was mentioned in passing as an accomplished fact, which is precisely the form
that does not invite checking. Four were caught by the other party asking; one
by a `grep`. **None was caught by its author.**

**Specific hazard worth naming: the agreed-but-uncommitted edit.** The working
tree matches intent, `HEAD` does not, and any tool reading `HEAD` — a diff, a CI
job, `railway iac plan` — reports a divergence that was never real.

**A fabricated reference does not stay put — it PROPAGATES.** Days after
ADR-010 was cited as existing, the other party used it in their own reasoning:
"the divergence risk ADR-010 records". It records nothing; it has never been
written. The false claim had been corrected once and still travelled, because a
citation is normally load-bearing and gets reused rather than re-checked.
`railway.ts` also carries a committed "See ADR-010" pointing at nothing.

**The cost of the gap is therefore not bounded by the moment it happens.**

**Verify that an agreed change LANDED, and where it matters that it was
COMMITTED, before relying on it downstream.**

### A number that NEARLY reconciles is a FINDING, not a rounding error

**When a hypothesis makes an anomaly disappear, test the hypothesis. Do not
adopt it.** A hypothesis that dissolves a discrepancy is the most dangerous kind,
because it removes the reason to keep looking.

T0.10 configured the `web` service by hand in a UI. The pending-changes
counter read **11** where the itemised expectation was 12. The author proposed
that Railway groups a service's variables into a single pending entry — which
would have made 11 exactly correct, and closed the question.

**It was wrong.** Deleting one variable moved the count 11 → 10, so variables are
itemised individually. The real arithmetic was 5 + 2 + 3, and the missing items
were three settings that never staged at all:

| Declared in `railway.ts` | Staged |
|---|---|
| `healthcheckTimeout: 300` | no |
| `restartPolicyType: 'ON_FAILURE'` | no |
| `restartPolicyMaxRetries: 10` | no |

**And opening the panel to find them surfaced two hand-entry errors as well** —
a healthcheck path of `api/ready` missing its leading slash, and a fifth watch
pattern `/apps/**` that exists nowhere in `railway.ts` and would have made every
worker change redeploy web: the precise failure watch patterns exist to prevent.

**Five defects shipped-in-waiting, and the only thing standing between them and
production was a refusal to accept a number that nearly added up.** Under the
grouped-variables hypothesis, 11 was correct, the panel was never opened, and all
five went live.

**The tell was cheap and should be routine: the hypothesis made a TESTABLE
prediction** — delete one variable, and if grouping is real the count does not
move. One click. It moved.

### The ENTRY surface is not a REVIEW surface

**An input box echoes what you typed. It cannot tell you what you meant.** Any
value entered by hand needs reviewing somewhere OTHER than the field it was
entered into.

Both T0.10 hand-entry errors sat in plain sight in their own fields, and both
looked right there: `api/ready` reads as a path, `/apps/**` reads as a watch
pattern. Neither is wrong-looking. They became visible only in Railway's Details
panel, which renders the pending change rather than the input.

**This is the same shape as reviewing a DIFF rather than a file.** The diff is a
second surface, and it is second-ness that does the work — not extra care applied
to the first one.

**It materialised on the FIRST service, on the FIRST attempt.** Two errors in
roughly nine hand-entered fields. That is the measured hand-entry error rate for
this configuration, and it is the argument for IaC stated as a number rather than
a preference.

### A COST MODEL is an architectural constraint, and ours was designed without one

**Deployability, cost and quota are as much a part of an architecture as its
module boundaries. A non-functional constraint nobody wrote down is not absent —
it is UNMEASURED.**

ADR-001 split `web` and `worker` into two processes for two correctness reasons:
a dashboard deploy must not drop the market feed, and the feed must be a
singleton. **Both reasons still hold.** What no ADR recorded was what the
resulting topology COSTS to run:

| | |
|---|---|
| Railway Free tier includes | **$1 / month** of usage |
| Two always-on services plus Postgres | **$9–13 / month** |

An order of magnitude, not a shortfall that can be engineered away. The
architecture is sound and cannot run on a free tier — and nothing in Phase 0
would ever have said so, because no document asked.

**THE TIMING, AND HOW NARROW THE ESCAPE WAS.** This surfaced at the END of Phase
0, before anything was deployed, with the decision still fully open. The trigger
was **a number in the corner of a screen** — "26 days or $4.92 left" — that
nothing in the plan had asked anyone to look at.

The counterfactual is specific. Found instead at T1.7, with a live feed running:
the credit expires, Railway "will stop all of your workloads", and the outage
arrives overnight, mid-Phase-1, **as a feed gap**. T1.8's staleness watchdog
would have fired correctly and pointed at the data provider, because the one
thing it cannot distinguish is a provider outage from a billing event. Hours
would have gone into the wrong system.

**A cheaper decision found early beats a correct diagnosis found late.**

#### The arithmetic that makes the decision easy — RESOURCES, not SERVICES

Merging `web` and `worker` to save money looks like it saves a service's worth.
It does not. **Railway bills the CPU, memory and disk actually consumed; there is
no per-service fee.** One container running both still runs a Next.js server and
a feed loop, so the only saving is one Node runtime's baseline footprint —
roughly **$1–2/month**, not the $5 the plan tiers suggest.

So the trade is not "reverse ADR-001 for $5/month". It is "surrender the
singleton guarantee and feed continuity for about $1.50/month". Stated that way
it does not need deciding.

**The general form: when a cost argues against a design, price the DELTA, not
the line item.** The tier price is what you pay; the delta is what the change
actually buys, and here they differ by a factor of three.


### An IMMUTABLE artefact needs an escape route, and ADR-003 never defined one

**Two individually safe decisions can compose into an unsafe one. Immutability
plus no down path equals no way back — and neither half looks wrong alone.**

ADR-003 made applied migrations immutable, which is right: editing history is
how migration systems become unreproducible. Drizzle generates forward-only SQL,
which is ordinary. **Together they mean a bad migration cannot be edited and
cannot be reversed**, leaving restore-from-backup as the only route — and no
backup procedure had ever been tested.

**THE RISK WAS TRACKED. THE COUPLING WAS NOT.** ADR-003 explicitly recorded
"OPS-7 (backup with a *tested* restore) … remains open for T0.10", so nobody
forgot about backups. What no document said is that OPS-7 **is the migration
policy’s only recovery mechanism**. Listed as an adjacent operational item, it
was schedulable like one — and deferring it would have silently gutted ADR-003
without anyone experiencing that as a decision about migrations.

The ADR was reviewed more than once. The question asked of it was always "is
this policy correct?" — to which the answer is yes. The question that found the
gap was **"what actually happens when a migration is bad?"**, asked in passing
while re-scoping a task.

**A risk recorded in the wrong RELATIONSHIP is nearly as dangerous as one not
recorded at all**, because tracking it creates the impression it is handled.

**THE GENERAL FORM: when a policy FORBIDS something, name the route it leaves
open and check that the route exists.** A prohibition silently elects a
remaining path. ADR-003 forbade editing a migration and thereby elected
restore-from-backup, without saying so and without anyone verifying that
backups worked.

**And it inverts a dependency nobody had written down.** Backups looked like
operational hygiene, schedulable whenever. They are in fact a hard prerequisite
of the migration policy — so "defer backups to Phase 6" silently meant "have no
migration recovery until Phase 6".

### A job that FAILS TO CHECK looks identical to one that checked and found nothing

**When the healthy signal is SILENCE, a broken checker is indistinguishable from
a clean result. The only distinguishing evidence lives somewhere nobody looks.**

`Dependabot Updates #8` went red on 2026-08-29. The observable consequence is
**no dependency-update pull requests** — which is precisely what a repository
with no outdated dependencies looks like. Nothing degraded, nothing alerted, and
the inbox that would have carried the news was the thing that broke.

**This is the audit-gate shape again, one level out.** The T1.1 Saturday sweep
reported `0 bars` when every request was a 403; here the report is "no PRs" when
every run failed. In both, an absence produced by FAILURE was read as an absence
produced by CLEANLINESS.

**The signal that did exist was a red run in a list nobody was reading.** It was
found by scrolling past it while looking at something else — not by any check,
alert or routine. That is not a detection mechanism, and treating it as one
would be the mistake.

**THE MITIGATION, STATED HONESTLY.** `pnpm audit` still runs in CI on every
push, so:

| | |
|---|---|
| **Enforcement against KNOWN advisories** | **INTACT** — the blocking gate is unaffected |
| **DISCOVERY of new advisories** | ~~**LOST**~~ **— THIS ROW WAS WRONG. Corrected 2026-09-01: the scheduled update job was succeeding the whole time; only the esbuild SECURITY update was red. See obligation 35** |

So the repository is not blind, and the loss is real but narrower than it first
looks. Saying "security scanning is broken" would overstate it; saying "it may
clear itself" would understate it. Obligation 35 carries the deadline.

#### THE CONCRETE INSTANCE, measured 2026-09-01 — and how it was actually found

**It was found because a human asked about a red run in a list.** Nothing
alerted. Nothing failed. CI stayed green throughout. There was no mechanism
anywhere in this project that would have surfaced it, and there still is not.

**We wrote this lesson about `pnpm audit`'s silence, and then lived it in a
different service without noticing.** Writing a lesson down does not install it.
The rule was on the page while the instance was running.

**THE DATES, from the run list rather than from memory** — and they do not match
what was recorded:

| | |
|---|---|
| First failing run | **2026-08-27** (33105196543), not 2026-08-29 as recorded |
| Last failing run | 2026-08-29 (33254585583) |
| Most recent Dependabot activity | **2026-08-31 — three runs, all GREEN** |
| Noticed | 2026-09-01, by a human scrolling a list |

So "red since 2026-08-29" was wrong in both directions: the failures started two
days earlier, and by the time it was investigated the most recent Dependabot
runs were already succeeding. **The job had stopped being ATTEMPTED, not stopped
succeeding** — after three consecutive failures nothing tried again, so even the
red signal decayed into no signal at all. An absence that used to be a failure
is worse than a failure, because the one piece of evidence that existed stopped
being produced.

**What makes this instance sharper than the audit-gate one.** There, a control
we own reported uselessly. Here the control is VENDOR-OPERATED and partially
degraded: version updates kept working, security updates did not, and the two
are indistinguishable from outside without opening individual runs. Any check of
the form "is Dependabot working?" would have answered yes.

**The uncomfortable part, stated rather than softened.** The detection mechanism
was a person's curiosity, exercised once, five days late. That is not a
mechanism. Nothing in this repository monitors a vendor-operated job, and until
something does, the honest position is that the next such failure will also be
found by accident or not at all.

### The FIRST fix that addresses a symptom is not always the fix that addresses the failure

**Three mechanisms were needed where one looked sufficient, and the drill is
what showed the gap between them.**

The T0.10 L3 restore began with one guard: `pg_restore --exit-on-error`. It is
the obvious fix, it is necessary, and on its own it is not enough. Running the
failure path produced a second requirement, and reasoning about what it still
could not catch produced a third:

| Layer | Catches | What the others MISS |
|---|---|---|
| sha256 vs manifest, **before** any change | truncation, corruption | the exit code catches this only AFTER starting |
| `--exit-on-error` **during** | anything the archive rejects | says nothing about content |
| row counts vs manifest, **after** | a restore that succeeded with the WRONG content | neither of the above looks at rows |
| the sentinel | a restore that was a **no-op** | counts alone cannot distinguish "restored" from "never emptied" |

**None is redundant, and no single one of them would have been enough.** The
error-code layer is the one everybody writes; it is the one that catches the
least.

### A defect in the FIRST version of a data-loss procedure, past review by two people

**Found on the drill's first run, and only because the drill exercised the
FAILURE path.**

The truncated test dump had no manifest beside it, so the integrity layer was
skipped **silently** and only `pg_restore` caught it. The consequence in real
use: a dump copied somewhere without its sidecar would have had **no integrity
check at all**, and the warning that replaced it was the kind nobody reads
during an incident. A missing manifest is now a refusal.

**Both of us reviewed that design and neither of us saw it.** It was not caught
by care, by reading, or by a second pair of eyes — it was caught by executing
the case that was supposed to fail.

**A drill that tests only success would have shipped it**, and it would then
have been discovered during an actual restore: the one moment when learning that
your recovery procedure lies is least survivable.

A second defect appeared on the next run, of the same kind: the failed run left
its sentinel behind and poisoned the following run's verification. **A drill
that cannot be re-run after it fails is not re-runnable** — and a drill's first
real user is usually someone whose previous attempt just failed.

### "The command failed, so nothing happened" is an ASSUMPTION, not a property

**Failure is not atomic unless something makes it so.** The assumption is made
constantly, it is usually right, and it is not guaranteed.

**Stated honestly for this codebase: we have NOT observed a non-atomic failure
here.** Every one of the five deliberate failures on 2026-08-30 left the
database bit-for-bit unchanged — `pg_restore` validates a custom-format
archive's table of contents before applying anything, so a damaged file fails
before the first `DROP`.

**But that is a property of SMALL dumps, not a property of the command.**
`--exit-on-error` stops the restore; it does not undo it. On a multi-gigabyte
Phase 1 dump, corruption late in the data stream can fail after earlier
statements have committed. Layer 3 would then catch it and quarantine the
schema — **detection, not prevention.**

**Recorded as a reasoned risk, not a measurement**, precisely so a future
session does not cite it as something that was seen. `--single-transaction`
would convert it into a guarantee.

**CORRECTED 2026-09-02 — obligation 31 is SPLIT across two tasks.** This
paragraph previously said obligation 31 "carries it to T1.3, when a table large
enough to demonstrate the difference exists". **T1.3 creates the candles table;
T1.4 fills it.** At T1.3 the database still holds only reference rows, so a
dump would fail before the first statement applies and the old behaviour and
the new would be indistinguishable. The FLAG lands at T1.3; the EVIDENCE lands
at T1.4, against a post-backfill dump. Adding the flag does not discharge the
obligation.

### Design a recovery procedure for the conditions it will be RUN in, not the ones that make it easy to TEST

**The drill started from a clean tree, a known-good commit and no time
pressure. That is the state a recovery procedure is LEAST likely to be run
from.**

Both improvements to the T0.10 L4 rollback procedure came from one question:
*what is a real user doing differently from the drill?*

| The drill assumed | A real recovery has |
|---|---|
| clean working tree | someone **mid-edit**, with unsaved work |
| a known bad commit | uncertainty about which change broke it |
| unlimited time | pressure, and a reflex reach for the nearest command |

Both gaps were invisible from inside the drill, because the drill's starting
state made them impossible to hit. **A procedure tested only under convenient
conditions is a procedure tested where it will never be used.**

What it produced: `pnpm rollback:check` now REFUSES on a dirty tree and names
the two safe options, rather than letting `git revert`'s own refusal provoke a
hurried `git commit -am` or `git checkout .` — which is precisely how T0.9
destroyed two uncommitted edits. And the procedure now opens with a QUESTION,
"does this commit contain a migration?", rather than a command, because
answering it wrong routes someone into a worse state than they started in while
following the document exactly.

**The general form applies past rollbacks:** ask what the operator's state will
actually be — tired, interrupted, half-finished, unsure — and design for that
one.

### Necessary and insufficient, TWICE, in two consecutive drills

**The obvious fix addressed the symptom and left the failure. Both times it took
a second mechanism found by running the failure path.**

| Drill | The obvious fix | Necessary, but it missed |
|---|---|---|
| **L3 restore** | `pg_restore --exit-on-error` | it stops without UNDOING, and skipped integrity entirely when no manifest sat beside the dump |
| **L4 rollback** | detect `.sql` files under `migrations/` | `meta/_journal.json` is what `shippedMigrations()` READS. A journal-only commit passed as **SAFE TO REVERT** — measured, exit 0 — while reverting it would change what the code believes is applied, and therefore the `pending` / `unknown` computation that gates readiness, without touching a line of SQL |

**Neither gap was found by review.** Both were found by executing the case the
fix was supposed to handle, and in both the first fix was the one anybody would
write.

**The shape to watch for: a fix aimed at the OBSERVED SYMPTOM rather than at the
class of failure.** "The restore reported success on a bad file" invites
`--exit-on-error`; "reverting a migration is dangerous" invites looking for
`.sql`. Both are correct and both are narrower than the thing they guard.

**The practical form: after the fix, ask what ELSE is in the same class.** SQL
files are not the only migration state; a non-zero exit is not the same as an
unchanged database.

### A decision carried through where it was MADE is not carried through where it is USED

**The document-scale form of the deciding-vs-doing family — and the reason it
stays invisible longer than the field-scale versions.**

ADR-011 re-scoped T0.10 on 2026-08-30. The decision was recorded in
DECISIONS.md, the re-scope was applied to BUILD-PLAN.md's T0.10 section, and
T6.1 was written. All of that was done. **Three references elsewhere were not**,
and they were found by grepping the plan for "Railway" rather than by reading
it:

| Location | Said | Actually |
|---|---|---|
| **Phase 0 Quality Gate** | "Both Railway services deployed and healthy" | deferred to T6.1 — **the gate as written could not pass** |
| T0.4 objective | "working Postgres locally **and on Railway**" | the Railway Postgres was deleted in T0.10 |
| T0.4 manual step | "creating the Railway Postgres instance" | no longer part of the task |

**The gate one is the dangerous one**, because it sat in the definition of the
very next task. Someone running it would have hit a criterion that cannot be
met, and the two available responses — tick it anyway, or treat Phase 0 as
failed — are both wrong.

**WHY THIS SHAPE HIDES.** The field-scale versions of this family (the `NODE_ENV`
row, the uncommitted `railway.ts` edit, the ADR cited before it was written)
were each caught within a turn or two, because someone was looking at the field.
At document scale nobody is looking: the decision lands in the document where it
was *made*, which is the one the deciding session naturally opens, and the
documents that *consume* it are opened later by someone else. **A fresh session
reads BUILD-PLAN.md for task definitions and would never have opened
DECISIONS.md to check whether the plan still matched it.**

**THE PRACTICAL FORM: after a decision, grep the repository for the thing it
changed, rather than editing the places you remember.** "Railway" was the search
term here and it took one command. The places you remember are exactly the
places you already fixed.

**Fixed 2026-08-31**, with the gate's original wording struck through rather
than deleted, so the change is visible to a reader who was not present for it.

### A measurement flagged as STALE is still being USED. Flagging is not retiring.

**If a number matters enough to gate a phase, it matters enough to re-measure
before citing it. If it does not, it should not be gating anything.**

Obligation 11 carried "**18.2 s on Windows**" from 2026-08-26. Two later audits
looked at it, both noted it needed re-measuring, and **neither re-measured it**.
The obligation's own text says "re-measure locally first". It was cited three
times as the reason a Phase 2 prerequisite existed, and the number was never
re-taken — in a document that carries the lesson *a measurement's validity
expires when the code it measured changes* a few hundred lines above.

**RE-MEASURED 2026-08-31: 38.1 s.** The figure had **doubled**.

| | 2026-08-26 (`66be0e4`) | 2026-08-31 | |
|---|---|---|---|
| Windows wall clock | 18.2 s | **38.1 s** | **2.1x** |
| Tests | 132 | 239 | 1.8x |
| Per test | ~138 ms | ~159 ms | 1.15x |

**The per-test cost barely moved; the absolute cost roughly doubled because the
suite did.** That distinction matters: nothing is degrading, but the edit-run
loop is twice as expensive, and the edit-run loop is what the obligation is
about.

**THE OUTCOME IS THE POINT.** The proposal on the table was to REMOVE obligation
11 as a stale number that should not gate a phase. Re-measuring instead showed
the concern had grown, not evaporated — so removal would have retired a live
problem on the strength of a number too old to justify either keeping OR
dropping it.

**A stale measurement cannot support a decision in EITHER direction.** It cannot
justify keeping the obligation, and it cannot justify dropping it. The only
honest moves are re-measure, or stop citing it. Flagging is neither.

### AN EMPTY AUTHORITY TABLE DOES NOT FAIL — it answers "nothing expected" to every question

**The cleanest example of this family we have, and it was found before the code
existed.**

`market_hours` is the trading-calendar authority. T1.5 asks it "how many bars
should exist on this date?" and compares the answer to what arrived. **With no
rows, the answer is always zero, and zero always matches nothing.**

| | |
|---|---|
| Weekend detection | finds nothing, reports success |
| Every calendar assertion | passes |
| Errors raised | none |
| Alerts | none |
| Symptom | **none** |

**A system that has stopped checking is indistinguishable from a system with
nothing to report.** That is the whole family in one sentence, and here the
failure needs no bug at all — just an unpopulated table.

**THE FIX IS STRUCTURAL, NOT BEHAVIOURAL.** The guard is a database constraint
plus a three-valued answer, not a convention that callers must remember:

- **The calendar cannot be empty** — enforced by the schema, so it cannot be
  forgotten rather than merely discouraged.
- **`expectsBarAt` returns three values, not a boolean:** `EXPECTED`, `CLOSED`,
  `UNKNOWN`. A boolean cannot distinguish "the market is closed" from "we do not
  know", **and only the second should degrade confidence.**

**The consumer contract for UNKNOWN, defined NOW rather than in T1.5** — because
a value with no defined consequence becomes one that everybody handles by
ignoring:

| Value | T1.8 staleness alarm | T1.5 on a bar arriving |
|---|---|---|
| `EXPECTED` | armed | accept |
| `CLOSED` | **suppressed** | quarantine, `bar_outside_calendar` event |
| `UNKNOWN` | **armed — never suppressed** | accept, `calendar_unknown` event |

`CLOSED` silences the watchdog; `UNKNOWN` does not. Treating UNKNOWN as closed
would let an unknown period silently suppress staleness detection, so the feed
could die inside it unnoticed. **T1.8 owns the alarm behaviour; T1.5 owns
emitting the events**, which are kept distinct so they are queryable apart.

**Same reasoning as splitting STATUS.md (obligation 25):** when correctness
depends on someone remembering, make it structural instead.

### EXPECTED FIRST OCCURRENCE — the first US holiday will look like a bug

**It is correct behaviour. Do not investigate it as a fault.**

T1.2 ships recurring rules only; holiday data is T1.5. So on the first US market
holiday the calendar predicts a full session, a shortened or absent one arrives,
and **T1.5 emits a data-quality event that looks exactly like a feed fault.**

**Trigger: the first US holiday after T1.5 goes live.** Not a fixed date — T1.5
does not exist yet, and under ADR-011 the feed runs only while the machine is
awake. **The next one due is Labor Day, Monday 7 September 2026**, when CME gold
runs a shortened session.

**This is the trigger for the holiday obligation, not a separate problem.**
Whoever sees the event should recognise it as the known gap and load holiday
data, not debug the feed.

### A deferred risk should be made CONCRETE before it is deferred

**"Check this later" is not a plan. Ask what the failure would LOOK like — and
the answer sometimes shows the failure is already present.**

Obligation 19 sat as "watch this on Railway" for two whole tasks: `apps/web`
resolves the repository root from a module Next has bundled, so
`import.meta.url` points inside `.next/`. Plausible, deferred, unexamined.

**One question — "what would the symptom be, a thrown error or a silent
undefined?" — turned it into a live defect found before deployment.** Neither,
as it happened: `findRepoRoot` threw, the throw sat OUTSIDE the boot guard, and
Next swallowed it. The T0.7 failure exactly — "✓ Ready" then 500s from every
endpoint — reached by a path the T0.7 fix did not cover.

The cost of asking was one question. The cost of not asking would have been a
deployment that reported success and served nothing.

**Ask it at the moment of deferring, not at the moment of checking.** A risk
recorded with its observable is a test; a risk recorded without one is a hope.

### The positive-control rule applies to GUARDS, not only to absence checks

**A guard proven to fire on every failure has not been shown to stay QUIET on
success. And a guard that always fires would pass every failure test.**

The rule is usually stated for absence queries — "if the query cannot show
presence where presence is expected, its absence result proves nothing". The
same structure applies one step over, and it is much less obvious there.

`apps/web`'s boot-guard tests assert that a throw from either boot call exits
1. Both pass against a `validateConfiguration` that called `process.exit(1)`
**unconditionally** — which would break every successful deployment. The third
test, *"does NOT exit when the boot sequence succeeds"*, is what makes the other
two mean anything.

**For any guard, test the quiet case as deliberately as the loud ones.**

### When several findings share a PRECONDITION, resolve the precondition first

**Look for the shared precondition before working through a list of findings in
order. Answered first, several resolve together; answered late, all of them need
redoing against whatever the answer turns out to be.**

Three separate T0.9/T0.10 findings looked independent:

| Finding | Recorded as |
|---|---|
| Re-measure worker boot-failure behaviour against however Railway runs it | obligation 17 |
| `apps/worker` has no build artefact, so the build criterion is unmeetable for it | obligation 24 |
| Pino crash output survives a crash — measured under `tsx` only | scope limit on the T0.9 evidence |

**All three reduce to one question: does production run `tsx` or a compiled
artefact?** Every measurement of the worker's crash and boot behaviour was taken
under `tsx`. Settle that in T0.10 and three findings resolve at once. Work
through them in list order and each is re-measured separately against an answer
that was available at the start.

The habit is cheap: before starting a list, ask what would have to be true for
several of these to collapse into one.


### A principle applied at one level should be checked at EVERY level it applies to

**The reasoning that produced a decision usually applies further down than it
was applied. Carry it down explicitly, or it stops at the level you happened
to be thinking about.**

T0.9 made the CI jobs PARALLEL, with an argued rationale: sequential surfaces
one bug per cycle, and paid on every red run that trains people to stop
reading CI. **The same commit then wrote sequential STEPS inside each job.**
The commit message argued the principle while the config violated it one level
down.

It was not theoretical. In the deliberate-red exercise a Prettier violation
stopped the static job before `pnpm lint` ran, so the packages/core boundary
rules — the most valuable check in the repository — were never demonstrated.
A planted secret masked a tampered migration in the same way. **Two of four
deliberate breaks proved nothing, because of a defect the exercise itself
exposed.**

It would have bitten hardest during a genuine red build, when nobody is in the
mood to wonder whether a second failure is hidden behind the first.

**Applied, not blanket.** The integration job stays sequential because its
steps are REAL dependencies — migrate, then build, then test, then read the
report the test produced. The rule is "let INDEPENDENT steps run", not "let
every step run".

### A passing gate should still REPORT what it saw

**Detection without reporting is invisible. Ask of every gate: when it passes,
does it say what it examined and what it chose not to act on?**

`pnpm audit --audit-level=high` correctly did not block on a moderate advisory,
and GHSA-67mh-4wv8-2f99 sat in the lockfile against `esbuild@0.18.20` while CI
stayed green. **The finding only surfaced because a human opened the Security
tab**, which nobody had a reason to open.

**CORRECTED 2026-08-28. The original wording of this lesson said the step
"correctly printed nothing" and that "CI showed nothing at all". THAT WAS
FALSE, and it was written into both this lesson and a code comment.** Measured
afterwards: `pnpm audit --audit-level=high` on its own prints

```
1 vulnerabilities found
Severity: 1 moderate          exit=0
```

**Silence was inferred from the fact that nobody noticed** — reasoning from a
symptom to a cause without checking the precondition, which is the error this
file already records three times.

**The real defect is sharper than "silent", and more useful: a two-line count,
with no package, no version, no path and no link, inside the collapsed log of a
green job, is functionally invisible. Reporting that nobody can act on is not
reporting.**

**The finding only surfaced because a human opened the Security tab**, which
nobody had a reason to open. Without that it would have sat unseen indefinitely.

This is not a detection failure, and the distinction matters: audit SAW it and
reported it in its own output. The gap is that the gate, in passing, discarded
everything it had chosen not to act on. **A check that is silent when it passes
tells you nothing about the difference between "found nothing" and "found
something and decided it did not matter".**

Fixed by printing the full report before applying the threshold. The threshold
is unchanged — visibility was the defect, not sensitivity.

**AND NOTE HOW IT WAS ACTUALLY FOUND: by looking somewhere unprompted.** A badge
appeared in the GitHub navigation that no process we had designed pointed at, and
the user opened the Security tab for no reason other than curiosity. **A green
pipeline and an unnoticed advisory coexisted quite comfortably.**

The fix makes it visible in CI from now on, which is the right response. But the
finding itself came from curiosity, not from any mechanism — and that is worth
recording honestly rather than filing it under "the process worked". **Every
process has a boundary, and the only thing that finds what falls outside it is
someone looking where they were not told to.**

Applies to reviewing this project generally: the surfaces nobody has been given a
reason to check are exactly where the next unnoticed thing is.


### When a rule keeps being broken by someone TRYING to follow it, the fix is STRUCTURAL

**Repeated failure to follow a rule, by someone who knows it and is actively
trying, is not carelessness. It is evidence that the structure makes the mistake
available. Remove the affordance rather than asking for more care.**

Four anchor collisions in a single task — a numeric anchor matching a table row,
a heading anchor matching a longer heading containing it, the repair orphaning a
section, and a whole-file regex sweeping in three unrelated tables and
miscounting obligations by ten. **Every one by an author who had written the
anchor lesson and was consciously applying it.**

Asking for more care had already been tried, in writing, and failed four times.
So obligation 25 splits the file instead: scoped sections make a scripted edit
**scope-safe by construction rather than by discipline.**

The general test: if a rule must be applied correctly on every edit, and
competent attention is not enough, the rule is compensating for a structure that
should change. Count the failures before assuming the next attempt will be
different.


### A self-reported success count is not evidence the work landed where intended

**A tool saying it succeeded is a claim about what it DID, not about whether it
did the right thing. Verify the edit landed where intended.**

A T0.9 edit script reported *"4 substitutions"* and one of them rewrote the
wrong row: the regex `| 11 |` matched a row in the unit-test-count table
(`| `packages/db` | 1 | 11 |`) before ever reaching obligation 11. It
silently corrupted the test counts while reporting complete success.

**`format:check` passed.** The file was still valid Markdown — just wrong. No
linter, formatter or test could have caught it, because nothing was malformed.

**THIS IS A NEW VARIANT.** Every prior instance in this file was a CHECK that
tested nothing, or tested the wrong thing. This is a TOOL reporting success for
work it did incorrectly, with no check involved at all. The absence rules and
the positive-control rule are both silent here.

**It is a live hazard for this repository specifically.** STATUS.md is dense
with pipe-delimited tables, and every scripted edit to it uses regex anchors.
A short numeric anchor will match several tables.

**Anchor on start-of-line PLUS distinctive row text**, and **read back the
region you changed** rather than trusting the substitution count.

**THIS HAS NOW HAPPENED THREE TIMES IN ONE TASK.** A numeric anchor
(`| 11 |`) matched a table row before reaching the obligation. A heading anchor
(`### When planting…`) matched INSIDE a longer heading (`#### When planting…`),
consuming one `#` and shifting two heading levels. The repair for that then
orphaned a section, caught by the same read-back.

**It is a property of the FILE, not of any one script.** STATUS.md is over a
thousand lines of nested headings and pipe-delimited tables, dense with repeated
structural text, so short anchors keep matching the wrong thing.

**Prefer exact whole-line matching over regex, and always read back the region
changed. If this happens again, the file is telling us it needs splitting.** The repair
here was found by grepping for the new text and discovering it on line 61
instead of line 773.

**THE TRIGGER HAS NOW FIRED — FOURTH INSTANCE, 2026-08-28.** A summary script
counted obligations with `/^| (~~)?[0-9]+[a-e]?(~~)? |/` across the WHOLE FILE and
swept in rows from three other tables — the T0.8 criteria table, the T0.9
criteria table, and the deliberate-red breaks table. It reported **31 open**
obligations; the real figure, scoped to the section, is **20**.

**This file is now telling us it needs splitting**, as this lesson said it would.
A candidate split, for whoever picks it up: **Lessons** and **Obligations** are
the two sections that are read independently of everything else and edited most
often by script. Moving them to `docs/LESSONS.md` and `docs/OBLIGATIONS.md` would
leave STATUS.md as the handoff document it is meant to be, and would make every
scripted edit scope-safe by construction rather than by discipline.

**Recorded as obligation 25 so it is scheduled rather than remembered.**

### Never run `git commit -am` on a throwaway branch

**It sweeps unrelated uncommitted work into a commit that is then deleted with
the branch. Stage explicitly by path when working on a branch you intend to
destroy.**

Two trivial edits were lost this way in T0.9 — a Vitest reporter config and a
`.gitignore` line — while probing the migration-immutability check on a scratch
branch. Both took a minute to redo. **It could as easily have been an hour of
work, and nothing would have warned at the moment of typing.**

This belongs alongside §41 command safety: the same class of problem, a
routine command whose destructive interaction is not visible while typing it.

### A close-out must be ADVERSARIAL, and performed against the artefact

**A session that has just built something assesses it more favourably than the
code supports, and it does not feel like bias at the time.**

The evidence is T0.8. Its pre-assessment — written from memory at the end of a
long session — got **two of three verdicts wrong, and BOTH IN THE SAME
DIRECTION.** Criterion 3 was marked MET when crash logging had never run in a
real process. Criterion 2 was described as "mechanism fully covered by 33 unit
tests" when two of its four sub-clauses were not mechanism questions at all.

Neither error was random. **Errors that are directional are bias, not noise.**

So: **the close-out is a separate step from the implementation, performed
against the code, and treated as adversarial rather than as confirmation.** Its
question is not "does this look done" but "what would I have to find to call
this unfinished". Grep for the consumers of a flag. Check whether a test named
after a resource actually touches one.

**The sharpest instance:** a shutdown hook NAMED `database-pool` that pushes a
string to an array, with 33 passing tests, none of which touch a real
connection. It reads as coverage of connection handling. It is coverage of
ordering. Same family as `verifyNotInTransaction` and the `limit=200` Saturday
query: **a thing that looks like the check you want, standing where that check
should be.**

### A measurement's validity EXPIRES when the code it measured changes

**Record what a measurement was taken against — a commit or a date — or a later
session will cite stale evidence as current.**

T0.8 measured six boot-failure modes under `tsx` and found all six exit 1, which
is why the worker has no explicit `process.exit(1)`. During the close-out that
result was nearly cited as covering the crash handlers. **It does not: it was
measured at `f9a75a5`, and `crash-logging.ts` did not exist until `1b12823`.**

The measurement is still valid for what it measured. It is silently invalid for
the thing it was about to be used for, and nothing in the number itself says
so.

This is the counterpart to recording measurements so they need not be re-bought:
**an undated measurement is not a saved cost, it is a trap.** Every figure in
this file now carries the date or commit it was taken against.

**A FIGURE WITHOUT ITS PLATFORM IS THE SAME TRAP.** T0.9 measured the unit
suite at **4.3 s on Linux** against **18.2 s on Windows** — roughly 4x faster on
nearly twice the tests. Either number quoted bare would mislead, and they
support opposite conclusions about whether obligation 11 is urgent.

Record platform alongside date and commit, for anything measuring execution.

### When a ratio lands near a threshold, find the confound — do not invoke the threshold

**A number close to a decision boundary is not evidence. It is a signal that the
measurement is not yet the right measurement.**

T1.1 asked whether Twelve Data's weekday series changed when its weekend
behaviour did. Raw divergence against an independent provider grew **2.91x**
across the boundary, against a 3x threshold written into the script beforehand.
Reading that as "under threshold, therefore fine" would have been luck, not
analysis — and the decision it fed was which provider the whole system depends
on.

The confound was obvious once looked for: **volatility had grown 2.34x over the
same period**, and two feeds sampling different tick streams diverge more when
the bar moves more. Normalising divergence by bar range gave 9.0% before and
11.2% after — a 1.25x change, clearly noise on a four-day sample.

A borderline number became a clear one, and the answer did not depend on where
the threshold sat. **If the conclusion would flip on a threshold chosen by
judgement, the threshold is doing the work that the measurement should do.**

Ask: what else changed between the two populations being compared, and can the
comparison be normalised by it?

### Measure the platform before writing code that compensates for it

**Three times now, a defensive mechanism was written against an assumed
platform behaviour, and the assumption was wrong in both directions.** The cost
is not wasted code; it is a comment asserting a hazard that does not exist,
which the next reader believes.

| Assumed | Actually | Consequence |
|---|---|---|
| Next.js would surface an instrumentation failure as a failed start | It prints `✓ Ready`, then serves 500s forever | T0.7 needed `process.exit(1)` — the compensation was **necessary** |
| The worker would likewise need an explicit exit | Every one of six failure modes already exits 1 under tsx — **measured at `f9a75a5`; `crash-logging.ts` did not exist until `1b12823`, so this does NOT cover the crash handlers** | T0.8 wrote **no** exit. An unnecessary one would imply Node does not crash on unhandled rejections |
| `process.loadEnvFile` overwrites already-set variables | It gives the environment precedence, and always did (documented for `--env-file`, measured on v24.19.0) | A hand-rolled precedence loop that could never change an outcome, in the repository since T0.7, copied forward in T0.8 before being caught |

The third is the instructive one, because it was written twice: once in T0.7's
instrumentation hook, then again when that logic was extracted in T0.8 — with a
comment confidently describing a bug that did not exist, and a test that
"passed" while proving only that Node works. A mutation test caught it.

**Apply it going forward: before writing code that compensates for a platform
behaviour, spend the five minutes to observe that behaviour.** Where the code
then depends on it, pin it with a test — `env-file.test.ts` now asserts Node's
precedence not because we implement it, but because `db:migrate` relies on it
and a change in Node should arrive as a test failure rather than as a silently
migrated wrong database.

### Verify that the observable changed — a fix can look right and do nothing

Two fixes so far have *appeared* to address a problem while doing nothing at
all. Both were caught by measuring the observable afterwards; neither would
have been caught by reading the code.

**T0.6 — `verifyNotInTransaction`.** It queried `pg_stat_activity.state` and
refused if it contained `'in transaction'`. But while a query is executing the
state is always `'active'`, including inside an open transaction — so the check
could **never fire**. It read like a safeguard on the one operation that
deletes databases, and was not one. Removed rather than left in place.

**T0.7 — the `NEXT_RUNTIME` guard.** Turbopack warned that `node:fs` is
unavailable in the Edge runtime. Adding `if (process.env.NEXT_RUNTIME !==
'nodejs') return` looked like the fix and silenced **nothing**: Turbopack's
analysis is static, not a reachability check. Only physically moving the Node
APIs into a separate module removed the warnings — 6 → 0, measured at `0a95c5f` (T0.7, 2026-08-26) against a real `next build`.

**The rule: when a fix targets something observable — a warning count, a log
line, a refusal, an exit code — check that the observable actually changed.**
"I added a guard" and "I added a check" are both easy to write, easy to
believe, and independently worthless.

Related: recurring noise in a channel you rely on for signal eventually
destroys that channel. Six warnings on every build is how build output stops
being read, and then a real error hides in it. Same argument as flaky tests,
different surface.

### Runtime names are invisible to a suite that never sees a production build

The boot message read `FATAL: r: Invalid environment configuration`. `r` was
the **minified class name**: T0.5 set `this.name = new.target.name`, which
yields the mangled constructor name in any production bundle.

Every production log line would have carried `"type":"r"` — the entire error
taxonomy silently useless in exactly the environment it exists for, while
development looked perfect indefinitely. T0.5's tests all ran unminified, so
the taxonomy was verified in precisely the conditions where the bug is
invisible.

That is a general problem, not a one-off. **Anything depending on runtime
names — `error.name`, constructor identity, `Function.name`, class names in
serialised output — is invisible to a test suite that never sees a production
build.** This was found only because a test booted a real minified server.

**Before T0.10, audit for other places where a minified build would behave
differently from source, and treat "verified in development" as not covering
it.**
