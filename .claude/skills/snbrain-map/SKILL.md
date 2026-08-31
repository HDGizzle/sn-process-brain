---
name: snbrain-map
description: Invoke to build a ServiceNow engagement's project brain from live evidence through the governed snbrain loop — "map this instance", "map-instance", "bootstrap the project brain", "onboard this instance", "build the brain for devinst01", or when the user points Claude Code at an instance and asks for a usable engagement repo. Orchestrates preflight → census → provenance → harvest → explain → verify → questions → GATE → interview → GATE → render, read-only, with the CLI owning every control-flow decision.
---

# snbrain map, orchestration

You are the **orchestrator**. You hold the session, run the stages, and own both human gates.
You do **not** personally census, harvest, verify or judge: those run as subagents with fresh
context, because that separation is the only thing that makes the output trustworthy.

**You do not decide what happens next.** `snbrain` does. You call `next`, you run the stage,
you call `ingest`, and `ingest` tells you the next stage. There is no point in this procedure
where stage ordering is your judgement.

**Read `.claude/snbrain/LOOP.md` before starting.** It is the contract: the verification
ladder, the caps, the stopping rules, the terminal states, the read-only rules. This file is
the procedure. If they ever disagree, LOOP.md wins.

`snbrain` below means `node <framework-repo>/tools/snbrain/snbrain.js`, with an absolute path.

## Non-negotiables

1. **The CLI owns control flow.** `ingest` returns `nextStage` and every terminal state. You
   never infer one, never skip one, never re-order one, and never declare the run finished.
2. **Every stage is a fresh subagent.** Narrow, self-contained brief. It gets the brief from
   `next` and the path to its governing skill, and nothing else from your context.
3. **The maker never checks its own work.** The harvester does not verify its claims. The
   verifier receives claim text and recorded evidence, never the harvester's narration. The
   L3 round-trip agent receives the **claim text only** and derives its own query.
4. **The state file is the memory.** Nothing important lives only in this conversation. If
   this session is compacted or dies, the run resumes from `.brain/` alone.
5. **A stage that could not run is not a stage that passed.** A dead helper tab, a stale port
   file, an exit-2 probe, a query whose fields were not validated: all `blocked`, never green,
   and never "nothing found".
6. **You never skip a gate.** Gate 1 and Gate 2 are `AskUserQuestion` calls made by you.
   Subagents have no interactive tools and cannot ask the user anything.
7. **Zero instance writes.** Every read goes through `tools/snbrain/lib/api.js`. Never write
   another client, never call the extension directly, never use `switch_context`.

---

## How to run any stage

This is the same six steps every time. Learn it once.

```bash
snbrain next --json
```

The brief carries: what to do, which inputs to read, the exact artifact path, the acceptance
conditions, the remaining budget, the iteration and the cap. Then:

1. **Spawn a subagent** (`Task`) whose entire prompt is the brief, plus the absolute path to
   the governing skill for that stage, plus the sync root and instance name. Use a dedicated
   `.claude/agents/snbrain-*.md` definition if one exists; otherwise a general subagent is
   fine as long as the brief is the whole prompt.
2. **Tell it to re-read its governing skill from disk**, every time, even if you believe you
   know what it says. Three reasons, and none is caution: compaction silently drops standing
   constraints and the resulting failures on this platform are silent; a subagent that
   inherits your context inherits your conclusions, which is precisely what maker/checker
   separation exists to prevent; and skills change between runs while a summary in your head
   does not.
3. **It writes exactly one artifact** to the path the brief names, under `.brain/in/`. It does
   not write pages, it does not edit `.brain/` by hand, and it does not update state.
4. **It streams evidence** to `.brain/raw/<stage>.ndjson` rather than returning it. Raw
   evidence never enters your context. You read counts and verdicts, not rows.
5. **YOU ingest it — not the subagent.**
   ```bash
   snbrain ingest --stage <stage> --file .brain/in/<stage>.json
   ```
   The stage brief ends with a `WHEN DONE` line naming this same command, and that line is
   written for the case where a stage is run without an orchestrator. **When you are
   orchestrating, the ownership is yours and the subagent's copy is redundant** — say so when
   you dispatch the subagent, so it writes the artifact and stops rather than ingesting and
   leaving you to discover the state moved under you.

   Only one of you may ingest. Two ingests of one artifact are two iterations against the cap,
   and the second one's `nextStage` is computed from state the first already advanced.

6. **Act on the return**, which is
   `{ accepted, rejected, findings, nextStage, terminal, successReachable, successBlockers }`.
   Accepted: call `next` again. Rejected: see "When ingest rejects". Terminal: stop and report.
   **`successReachable: false` means carrying on cannot produce a successful run** — fix what it
   names now, or decide deliberately to finish on a different terminal state.

**Report spend on every ingest.** The CLI cannot see token usage. A stage that reports none is
recorded `spend-unknown`, and that blocks terminal `success` exactly as a failed test does.

### When ingest rejects

A rejection consumes an iteration against the stage's cap (default 3). It is data, not an
obstacle.

- **Read the findings.** They name the field, the rule and the reason.
- **Re-brief the same stage** with `next` (the brief is regenerated and will reflect the
  rejection) and a fresh subagent. Do not patch the artifact from your own context: you did
  not gather it, and a hand-patched artifact is a claim with no evidence behind it.
- **Never hand-edit `.brain/`** to make a rejection go away. That is the schema-drift failure
  the loop was built to stop.
- **Three rejections is a human problem.** `ingest` will terminate `exhausted`. Stop and show
  the findings.

---

## Stage 1, preflight

**The eleven WP-A probes are the preflight stage.** They are already built and tested. Do not
re-implement them and do not "check the connection" some other way.

```bash
node <framework-repo>/tools/snbrain/probe.js --instance <name> --root <sync-root>
```

Exit codes: `0` all probes conclusive, `1` a kill criterion fired, `2` preflight failed.
Probe order is 10, 9, 1, 8, 2, 3, 6, 7, 4, 5, 11, cheapest honesty items first.

**Probes 6 and 7 are negative controls and they must reproduce a failure.** A negative control
that "passes" because nothing went wrong has **failed**, and is reported that way. Probe 6
asks whether an unknown field in an encoded query silently returns unfiltered rows; probe 7
asks whether a query value containing `&` corrupts the request. If either comes back clean,
the guard layer would be defending against a documented failure rather than an observed one,
which is worthless.

**What the first devinst01 run already settled**, so you recognize the shape of an answer and
do not mistake a known fact for an anomaly. These are facts about that instance, not about the
platform: re-run the probes anyway, because a different instance answers differently.

- `rest_request` GET is ungated, so the full REST read surface works through the browser
  session. Paging works. Aggregate counts work.
- **The silent clause-drop reproduced.** An unknown field in an encoded query returns
  unfiltered rows. Field validation before every filtered query is therefore mandatory
  everywhere downstream, not advisory.
- **`sys_customer_update` is not a table and not a column, here or on any instance.** It is
  the *label* of `sys_update_xml` ("Customer Update"), read off the UI and written down as a
  name, so this one is a fact about our vocabulary and not about devinst01. The record-level
  rung is **update-set membership**, joined on the key the platform already provides,
  `sys_metadata.sys_update_name` IS `sys_update_xml.name`. It is not clone-resilient: a clone
  truncates `sys_update_xml` with the rest of the update-set tables, so package-level is the
  only rung that survives one.
- The session is admin, so read ACLs never filter and ACL blindness is **untestable** on that
  instance. Stamp `aclExposure: none` and do not claim ACL coverage.

**Acceptance.** Probe 1 returns 200. Probe 2's page 2 differs from page 1 by **row identity**,
not by row count. Probes 6 and 7 both reproduce the predicted corruption. The capabilities
gates block matches the required state. The identity canary passes. **A probe 1 failure
collapses the REST read path and is a stop-and-report, never a degrade-and-continue**, because
a count-less, absence-less run cannot support a claim ledger.

---

## Stage 2, census

Counts per (table, scope) across the configured table list, restricted to the scopes the
instance actually uses. Plus the author distribution, the package census and the install
floor. This is the stage that produces the **honest denominator** every later number is
reported against.

Rules the subagent must be given explicitly:

- **Validate every field in every encoded query against `sys_dictionary` first**, or issue the
  A/B negation control. This is not hygiene; the clause-drop is live on this transport.
- **A count from a stratum that was not fully enumerated is not a count.** If `/api/now/stats`
  is unavailable, fall back to enumerate-and-count with a row budget and stamp every total
  "counted only what we enumerated".
- **Domain separation is terminal.** More than one domain with no explicit domain decision is
  `blocked`, not a filter you quietly add.
- **Zero tables silently absent.** Every in-scope table either has a count or is named with
  `unverifiable: blocked-by-access`.

**Acceptance.** Every in-scope table accounted for. Author, package and scope distributions
reported **as distributions, never as totals**, because a single total hides the install
account that produced most of them.

---

## Stage 3, provenance

Two jobs, and confusing them is the classic error. Job one: **which rungs exist here.** Job
two: **does authorship actually discriminate**, which is the run's real go/no-go.

**Job one, the ladder.** Probe each rung and record availability with a number, never a
boolean guess:

| Rung | Source | Recovers |
|---|---|---|
| R-a | `sys_update_version` | prior field values, the delta. Count the records holding **more than one** version; single rows recover nothing |
| R-b | `sys_metadata` created/updated by and on, plus `sys_mod_count` | change episodes by author and time window. Present on every instance |
| R-c | `sys_metadata_delete` | the GONE class, which nothing else catches |
| R-d | `sys_app` and store-app version and upgrade history | how this customer actually ships, and clone recency |
| R-e | **retired** | was `sys_customer_update`, "customer-touched, independent of update sets". No such table or column exists on any instance; the string is the label of `sys_update_xml`, which **is** the update-set membership table, so this rung was P1/P2 under an alias and inverted |
| P1/P2 | `sys_update_set` name and description, `sys_update_xml` membership | story id, tracker id, a human-written intent phrase, the co-shipped cluster |
| P3 | a story id embedded in a live artifact's name or description | artifact-to-story link **with no update sets at all**. Free, clone-resilient, and easy to forget |
| P8 | script comments and JSDoc | verbatim human WHY sentences. **Never in a sweep**, only on post-gate survivors |

Only when R-a through R-d and P1/P2 are all empty is archaeology genuinely dead, and an
instance where all of them are empty has no customer-authored surface, which is itself the
most important finding the run can produce.

**Job two, the scope filter, and it is calibrated rather than assumed.** Scope is neither
necessary nor sufficient: vendor scopes hold customer work and `global` holds both the base
system and real customer work. Authorship is decided **per record**.

1. Assemble a **negative control set**: 3 records per table family that are certainly base
   (zero mod count, base package, created inside the install date cluster).
2. Assemble a **positive control set**: 3 per family with version history, or an authored
   episode with a human author outside base packages.
3. Score the A1 to A4 predicates and the composites against **both** sets, recording all
   scores, not only the winner's.
4. Choose the predicate with **zero false admits on the negative control** and the highest
   true admits on the positive control.

Then the **four-part discrimination gate**, all four required before a single question may be
emitted:

1. Band A is non-empty.
2. Band A's share of everything is at or below 0.35. A filter admitting more than a third of
   an instance is not a filter.
3. The top Band A author is not also the top Band C author with a share above 0.80 in both.
   If it is, authorship is an artefact of the install account: stamp `authorship: time-only`,
   which disables author-keyed clustering.
4. **Deliberateness.** The Default-set share of authored change is at or below 0.50. This is
   thirty seconds of transport and it is the sharpest gate in the set: gates 1 to 3 pass
   cleanly on a vendor's own dev instance while Band A there is dominated by half-built
   experiments and throwaway tests. **The bands separate customer-authored from
   ServiceNow-shipped; nothing in them separates deliberate from scratch.**

**Acceptance.** The chosen predicate admits **0 of the negative control set**. Presence of an
authorship column is not discrimination, and this gate is where the difference is enforced.
Failing 1 gives `inventory-only`; failing 2 or 3 gives `filter-non-discriminating`; failing 4
gives `authored-but-undeliberate` and the run continues with admission restricted. All three
are stamped with the measured shares, and all three are **results**, not failures. Do not
rescue a thin instance by loosening a threshold.

---

## Stage 4, harvest

Areas are **derived from census evidence**, never a hardcoded list, and aimed by the scope
filter: skip any table with zero Band A rows entirely. On a real instance most tables have
zero, and that is free budget nobody has been costing.

What the subagent produces: **observations**, one per line, streamed to
`.brain/raw/harvest.ndjson`, each carrying `{table, sysId, field, value, sourceQuery}`.

Say all four of these in the brief, verbatim:

- **"Record what you read. You may not create a question."** Questions are computed by the CLI
  from the ledger in stage 6. A harvest agent that emits questions produces a flood of lone
  anomalies, which is the exact failure the question engine exists to prevent.
- **"You may not write pages."** Pages are a render from claims. A harvest stage's only writes
  are its NDJSON stream and its manifest.
- **"Field allowlists always."** Never `SELECT *`. Never read `script` in a sweep; script
  bodies are read per candidate, later, and only for candidates that survived the gates.
- **"A partial is honest and allowed. A confident report from a failed agent stops the run."**

Claims are minted **by the CLI** on ingest, with content-hashed ids, and the CLI records the
captured response. The agent never allocates an id and never writes its own evidence line.

**Acceptance.** Terminal `complete`, or `budget-capped` with every capped stratum named. No
count or absence claim outside a fully enumerated stratum.

---

## Stage 5, verify (this stage loops)

The only leg with measured field evidence: at the pilot customer, 26 claims re-verified in 18 API calls
produced 22 confirmed, 3 drifted and 1 gone, a 15% drift rate over six weeks, and it found an
entire undocumented story that had deprecated a live SLA with zero repo trace. **None of that
drift would have surfaced as an API error.** Deactivations, renames and deletions all return
clean responses. Only value-level comparison catches them.

Each iteration:

1. **Select** stale, unverified and contradicted claims.
2. **L0 validate.** Dictionary check plus canary. An empty canary is terminal `blocked`,
   **never** "absent".
3. **L1 replay.** The **CLI** issues the query and diffs the values. If a model does the
   comparison it is L4, whatever it claims about itself.
4. **L2 cross-source.** Contradictions between two derivations, duplicate slugs for one target
   table, registry against process page, referential integrity of the brain.
5. **L3 round-trip**, sampled and budgeted, with the checker receiving the **claim text only**.
6. **Findings** get content-hashed ids and four separate fields: `severity`, `disposition`,
   `dispositionBy`, `dispositionRung`.
7. **Supersession.** Any decision whose linked claim drifted is flagged
   `needs-reconfirmation` and emits a question with `gate: decision-reconfirmation`. A drifted
   **witness** claim also demotes confidence and says the decision itself may have been
   reversed. This is the one operation no document template can perform, and it is why the
   ledger exists.
8. **Repair.** A repair agent fixes the **claim**, never the finding, and the checker never
   sees the repair agent's reasoning.

Also here, once: the **stratified precision sample**, 5 strata by 12 claims, re-verified by an
**independent path** (REST if the original was the query command and vice versa, plus a direct
record read). **The floor is 85%, 51 of 60.** Below it the run does not proceed to question
generation, because a ledger that is 15% wrong generates questions that are 15% wrong-premise,
and wrong-premise questions are the most expensive way there is to spend an expert's goodwill.

**Stopping.** Converged when zero findings are `blocking` and open, and no claim is past its
staleness horizon (default 14 days, measured rather than chosen). **Stalled** when two
consecutive iterations produce zero resolutions, where a resolution is a claim moving out of
`draft`, `drifted` or `unverified`, counted by the CLI from the ledger. Do not expect finding
ids to repeat: they do not, which is why id equality is not the trigger.

---

## Stage 6, questions

The CLI does the arithmetic. The model writes **one string per question**, the wording. Your
job is to make sure the subagent is given nothing that lets it do more than that.

The pipeline, in order:

1. **Gate.** A question is emitted only on a **contradiction**, a **delta**, or a
   **register-gap against a register that is complete by construction**. A lone anomaly is
   dropped. Of the six instance-derived questions the reference engagement actually asked,
   five were contradictions and one was a delta. Not one was "here is an unusual record".
2. **Cluster.** Group by (table, change-type, author, time window). One question per cluster,
   member count attached. The unit of a good question is a decision, and decisions are
   clusters: four sentences at the pilot customer explain what a per-record detector reports as hundreds of
   findings.
3. **Rank.** `WPM = E·C·A·U / M`, computed by the CLI, no model anywhere in it, every term
   stored on the question record so a disagreement is debuggable.
4. **Anti-waste**, in cost order: duplicate or already-governed, the answer would change
   nothing, answerable from a structured repo field, answerable from the instance (resolvers,
   at most 3 reads each), the capped drop-only residual, then the derivability oracle over the
   top N post-rank only.
5. **Admission floor.** Below the signal-confidence floor a question goes to the **shadow**
   queue, which is for the operator and is never sent to the human.
6. **Cap.** Default 10.

Two emission rules that decide whether an answer arrives:

- **Closed beats open.** An open question ("why does this exist") may be emitted **only** when
  the provenance envelope is empty. Whenever the envelope carries (author, date, container),
  the question is rewritten against its closed template with two named branches. The field
  case: the open form of one the pilot customer question produced "unknown, doesn't recall"; the closed form,
  carrying the author, the timestamp and the containing update set, was answerable in about
  twenty seconds. That conversion is the whole point of mining provenance.
- **Any signal whose consequence is countable in one stats call must carry the count.** A
  question that carries the blast number gets answered.

**And know where the safety actually sits.** Simulated over the reference engagement, the
anti-waste gates leave about 89 survivors on a documented repo and about 155 on a virgin
engagement, against a cap of 10. **The top-N truncation is the safety mechanism and the
ranking function carries the load.** Two gates are dark on run one of any new engagement (the
already-governed arm needs a populated decision ledger, the structured arm needs story
frontmatter): stamp them `unavailable` and report their kill counts as **zero rather than
absent**.

---

## GATE 1, the human chooses what gets asked

**Ordering, and it is not optional when the operator and the SME are the same person.** The
interview opens with a *blind recall* — ten minutes of "what does this process do, in your
words" — which is only worth anything if it happens **before** the human has seen any of our
material. Gate 1 shows them the top N questions *with their wording*, which primes exactly what
the recall is trying to measure. Both steps are right; run in the wrong order, the second
destroys the first, and you cannot tell afterwards that it happened.

So, when operator and SME are one person, either:

- **run the blind recall first**, seal it, and only then put the gate pack up; or
- **omit the question WORDING from the gate pack** — gate, cluster size and blast count are
  enough to judge whether a question is worth an expert's time, and none of them primes a
  recall.

Whichever you choose, say which in the run record. On the reference run neither happened and
nothing noticed.

An **evidence pack**, not a transcript, judgeable in about fifteen seconds. If your gate output
is a wall of prose the operator will start approving without reading, and the gate becomes
decoration. That is the documented failure mode of human review.

The pack:

- **The scope-filter verdict and its numbers.** Band A share, author discrimination, Default
  share, and the stamp. If it is `inventory-only` or `filter-non-discriminating`, that is the
  whole pack and there are no questions to approve.
- **The top N questions**, one line each: the gate that fired, the cluster size, the blast
  count, and the two branches.
- **The suppressed count by gate**, with unavailable gates shown as zero.
- **What the ledger says it cost**: claims written per table against census counts per table.
- **Anything `unverifiable`**, with its sub-reason.

Then `AskUserQuestion`: send · edit the list · abandon. Record the decision, who made it and
when, in the state file.

---

## Stage 7, interview (this stage loops, and it is the product)

**Step one runs before the human sees anything of ours, and it is the highest-value ten
minutes in the run:** the blind recall elicitation. "Name five things about this instance a
new consultant would get wrong." Recorded verbatim, timestamped, sealed before any of our
questions are shown. It is the only recall-shaped evidence obtainable from an expert and it
costs less than one question.

Then ask the approved batch. For each answer:

Answers go into the **interview artifact** and are ingested like every other stage — there is
no `snbrain questions answer` verb. See `.claude/skills/snbrain-interview/SKILL.md` for the
shape.

```bash
snbrain ingest --stage interview --file .brain/in/interview.json
```

- **Record the answer verbatim**, unparaphrased. The CLI classifies mechanically first; only
  then does a capped model step write the decision's `statement` and each alternative's
  `label`, and nothing else. It never writes links, ids, dates, attribution or rationale
  strength.
- **`unanswerable` is a first-class outcome, not a failure.** The human oracle fails about one
  time in five even when willing and present. It mints a debt record with an owner and a date.
- **Distinguish a rationale the human stated from one the machine inferred.** An inferred
  rationale renders with a visible marker. A ledger that cannot tell them apart will present
  an inference as a decision six months later, and that has already happened once on the
  reference project.
- **Expect debt more often than decisions.** Of the reference engagement's six instance-derived
  questions, zero produced a decision record at the time of asking. The near-term deliverable
  is the debt register plus supersession. Do not inflate a TBD into a DEC.

**Saturation:** over the last 5 answered questions, fewer than 2 produced a ledger delta.
Counted by the CLI. Or the queue is empty, or the cap is spent.

---

## GATE 2, de-DRAFT promotion

A claim leaves `draft` only when it has an L1 verification with a captured response, **or** a
linked answered question with an attributed answerer and date. Nothing else promotes it, and
in particular a model's confidence does not.

The pack: how many claims are promoting and on which basis, which pages therefore change
status, which claims remain `draft` and why, and every `unverifiable` with its sub-reason.

`AskUserQuestion`: approve · hold · abandon. The validator refuses to render a page as
`verified` while any claim it renders is `draft`, and it exits non-zero. Do not work around
that refusal.

---

## Stage 8, render, and this is the deliverable

Everything before this was mechanism. **This stage is what the run is for: after it, an agent
opens this repo and does real ServiceNow development in it.** Pages are a **view** rendered
from `claims.jsonl` and `decisions.jsonl`, not a thing anyone types.

What must exist when this stage is accepted:

1. **The kernel** (`CLAUDE.md`), carrying the engagement's identity (instance, tier, scopes,
   customer), its hard rules, and a **routing map from artifact type to governing skill** so
   that a downstream agent lands on the right procedure without being told.
2. **Enforcement wired into `.claude/settings.json`**, hooks actually referenced rather than
   described: kernel integrity, skill triggering, the artifact-skill reminder, the write
   guard, the capture verifier.
3. **Build-procedure skills**, the ones this instance's artifact types actually need, present
   on disk and reachable from the routing map.
4. **The wiki**: registry, decisions, gotchas, conventions, TBDs, story records. Every factual
   row cites a replayable evidence query and a capture timestamp. Every page carries a
   computed `status` of `draft`, `mixed` or `verified`, and **the kernel's routing map states
   that a draft page must be quoted with its status**, because downstream agents otherwise
   read these pages with zero draft awareness.
5. **The honest numbers, in the same visual block as any precision figure**: census counts per
   table and per scope against claims written per table and per scope, the suppressed-candidate
   count, the instance and tier stamp, and the recall disclaimer. Never a coverage rate.
6. **The read-only proof**: the append-only request log, plus the closing capability re-read
   showing the gates block unchanged since preflight. This is the artifact you hand the
   instance owner.

Finally, run the probe suite against the freshly built brain and record the result as the
**baseline**. Failures on day zero are fine: they are the to-do list, and they are the only
measurement anywhere of whether a verified claim actually reaches a model at the moment it is
needed.

---

## Terminal states other than success

| State | When | What you do |
|---|---|---|
| `no-op` | `inventory-only` or `filter-non-discriminating`. There is no customer-authored surface to ask about | Report it as the headline with the measured shares. This is a real finding: a vendor dev instance has no customer-authored surface, and here is the number |
| `blocked` | Dead helper tab, stale port file, collapsed read path, unresolved domain separation, a lock held by another run, no agreed window | Say exactly what is needed to unblock. Never degrade-and-continue |
| `stalled` | Two consecutive verify iterations with zero resolutions | Stop. Show the open findings and the claims that will not move. A human must break the tie |
| `exhausted` | Budget or the runaway guard reached with blocking findings open | Stop. Show what is still open |
| `abandoned` | The operator stopped at a gate | Record and stop |

**Only `success` permits handoff.** Never report a run as done in any other state, and never
soften a `stalled` into "mostly working". A stopped run that reports a real finding is worth
more than a completed run that measures nothing.

## Cost

This is deliberately expensive: a fresh subagent per stage, skills re-read every time,
verification separated from production. That cost buys maker/checker separation, which is the
only reason to believe the output. Multi-agent work runs roughly an order of magnitude above
single-agent work; that is the price, not an accident.

Do not economise by letting one agent both harvest and verify. That saves tokens and destroys
the entire value of the run.

## Customer Project Rules
<!-- Engagement overlay. Record THIS engagement's mandatory conventions and discovered rules
     here. Framework updates never touch this section. -->
