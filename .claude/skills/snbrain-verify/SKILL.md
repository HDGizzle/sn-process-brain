---
name: snbrain-verify
description: Invoke to run the VERIFY stage of a project-brain build, or when the user asks to "verify the claims", "re-check the ledger", "has anything drifted", "replay the claim queries", "is the brain still true", "run L1 verification". Replays every selected claim's evidence query so the CLI can diff it, and promotes, drifts, buries or marks unverifiable each one.
---

# VERIFY: the L1 loop

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, the selection, the artifact, the acceptance conditions, the
remaining budget, the iteration and the cap. **The brief is the current state; this skill
is the procedure. Where they disagree, the brief wins.** If the stage is not `verify`,
stop and run the stage the CLI named.

## The rule the whole rung rests on

**The CLI does the diff. You do not.** You replay the query and hand back the captured
response. If a model compares the stored value to the live value and reports a verdict,
the rung is no longer deterministic re-query, it is model judgement, and it degrades to
the weakest rung in the ladder immediately. There is no partial version of this rule.

| Rung | What it is | Closes a loop? |
|---|---|---|
| **L0** | query validity: every field validated, canary per batch | no, but it makes everything above it meaningful |
| **L1** | deterministic re-query, CLI diffs the values | **yes** |
| **L2** | cross-source contradiction, referential integrity, duplicate slugs | **yes** |
| **L3** | round-trip re-derivation by an isolated agent | **yes**, for what-claims |
| **L4** | model judge against a rubric | **no, never alone** |
| **L5** | human | **yes**, and the only rung that closes a why-claim |

## Procedure

**1. L0 before anything else.** Validate every replay query's fields against
`session.dictionaryFields(table)`, and issue the identity canary once per batch. **A failed
canary is terminal `blocked` for that batch, never `absent`.** An unauthenticated helper
tab returns zero rows and a 200, so on this platform "the record is gone" and "the session
died" are the same observation until the canary separates them. That is the signature
failure of the whole environment.

**2. Replay.** For each selected claim, re-issue its **stored** evidence query through
`tools/snbrain/lib/api.js`. Do not rewrite the query to something you think is better: a
replay that changes the query is not a replay. If a stored query no longer validates,
that is a finding, not a licence to improvise.

**3. Hand back the responses.** Append each to `.brain/raw/verify.ndjson` and reference it
from the artifact. The CLI diffs against the stored `capturedResponse` and writes:

| Status | Meaning |
|---|---|
| `verified` | the live value matches |
| `drifted` | it moved, and the run started before it moved |
| `gone` | the record no longer exists, corroborated by the canary |
| `unverifiable` | see below |

**4. `unverifiable` is a first-class status, not a soft fail.** It carries exactly one
sub-reason: `blocked-by-access`, `no-oracle`, `requires-write`, or `interpretation`. A
two-valued schema forces an honest non-demonstration to be filed as a success, and that has
happened on record: a test case explicitly titled "NOT DEMONSTRATED" was stored
`result: pass` because the schema had nowhere else to put it. **`unverifiable` blocks
terminal `success` exactly as a failure does.**

**4b. A BEHAVIOUR claim is an interpretation, and `verified` is refused for it outright.**
Its assertion is a sentence about what a script does; re-reading the body confirms the
body, never the sentence — the previous run stamped 150 interpretations green by comparing
a field to itself. Re-read the body anyway and record `unverifiable` with reason
`interpretation` and the body you read in `observed` (the CLI hashes it, so the next run
sees the SUBSTRATE change even though the sentence cannot be mechanically re-checked);
`drifted` with a diff when the body changed; `gone` when the record vanished. The reason
belongs to behaviour claims alone — a `<field> = <value>` claim has an oracle, and taking
`interpretation` on one is rejected as verification skipped at zero cost. Interpretations
close at L3 (rule 7 below) or at the interview, never at L1.

**5. `changed-in-flight` is not drift.** A row whose `sys_updated_on` is later than the
run-start watermark changed under you while you were reading. Someone deploying mid-run is
not the same event as a stale claim, and filing one as the other manufactures findings.
The two watermarks bracket the run and the delta between them is the run's own uncertainty
band. Report it as such.

**6. L2, cross-source.** Two independent derivations disagreeing; the registry
contradicting a process page; duplicate slugs pointing at one target table; broken
referential integrity inside the brain; a claim whose rendered-in page no longer exists.
These are absolute and they close loops. Route repair-shaped drift here rather than to the
human: an arithmetic error, a rename with a traceable source, a deletion already recorded.
Doc repair is not a question.

**7. L3, sampled and budgeted.** A fresh agent gets the claim **text only**, derives its
own query, and the CLI diffs its result against the recorded response. **Give it the
claim, never your reasoning and never the original query.** A judge that shares the
maker's context starts agreeing with it, and that separation is the entire value of the
rung.

**8. The stratified precision sample, and it is a gate.** Five strata by twelve claims,
sixty in total, re-verified by an **independent path**: the other transport where one
exists, plus a direct read on the sys_id. **Gate: at least 85%, which is 51 of 60.** Below
that the run does not proceed to question generation. A ledger that is 15% wrong generates
questions that are 15% wrong-premise, and wrong-premise questions are the single most
expensive way to spend a customer's goodwill.

**9. Supersession is computed, not authored.** The CLI maintains the reverse index from
claim to decisions and writes these itself:

| Transition | Effect on every decision referencing it |
|---|---|
| `verified → drifted` on an **explained** claim | `needs-reconfirmation`, reconfirmation row appended, question emitted with gate `decision-reconfirmation` |
| `verified → drifted` on a **witness** claim | as above, plus confidence demoted one step, and the question says the decision itself may have been reversed |
| anything `→ gone` | as above, plus the question is templated "this decision's subject no longer exists" |
| claim removed from the ledger | `orphaned`, flagged in the run summary, **no question**: there is nothing to ask about |

This is the mechanism the whole product turns on. It is what a markdown template cannot
do, and it fires the same second the drift is detected rather than six days later when a
human happens to run a sweep by hand.

**10. Findings, and the field that cannot be rewritten.** A finding carries `severity`,
`disposition`, `dispositionBy` and `dispositionRung` as **separate fields**. Closure is
**no finding with `severity=blocking` AND `disposition=open`**, computed by the CLI from
the ledger.

> On record, six findings were re-emitted in a later iteration with severity downgraded
> from blocking to info and the acceptance text pasted into the message field, taking the
> blocking count from 2 to 0. Nothing was fixed. **No stage can close itself by rewriting
> a severity string.** If you believe a severity is wrong, say so as a finding with an
> attributed disposition; do not edit the field.

**11. Repair.** The maker fixes the **claim**, never the finding. The checker never sees
the maker's reasoning. An L4 finding is discharged by a fix plus re-verification at L1, L2
or L3, or by the human. **Never by asking the same judge again.**

**12. Chain coherence, which the CLI computes and you do not write.** Your L2 pass looks
for contradictions across claims. There is a second cross-claim fact you would never find
by reading, so the CLI adds it to your artifact's findings automatically: **a reference to
a record nobody mapped**. Every sys_id in a captured response is an edge; it **dangles**
when its target is no claim's locus. You get one finding per broken `(table, column)` class
at three or more unreachable targets, plus one aggregate naming the whole population.

> A brain is not a pile of facts, it is a set of chains — the assignment rule reaches its
> resolver, the resolver reaches its decision table, the decision table reaches a group.
> Measured on run 93838afe87: **970 of 2,958 mechanism edges dangle**, while the run
> reported 19,360 claims at 99.96% verified. A chain with one link missing is not 90% of a
> chain, and every one of six deciding facts in two rounds of head-to-head developer tasks
> was a **broken final link**, never a missing fact.

These are **warnings**, and they are not yours to fix: verify does not harvest. Do not
argue with them, do not dispose of them, and do not treat them as a reason to loop. They
are the work list for the next harvest and a statement on the record about what this
deliverable cannot explain. Read the aggregate before you write your L2 note — if it says
a class has never once resolved, that is a cross-claim fact worth a sentence from you
about *why*, which is the part the CLI cannot supply.

## Stopping, and who enforces it

The CLI enforces all of it. You may not argue past any of it.

- **Stagnation.** Two consecutive iterations with **zero resolutions** terminates the run
  as `stalled`. A resolution is a claim whose status moved out of `draft`, `drifted` or
  `unverified`, counted **by the CLI from the ledger**. Finding-id equality is explicitly
  not the trigger: a breaker built on model-authored ids never fired once in 32 recorded
  iterations, because model-authored ids never repeat.
- **Convergence, not the cap.** Blocking counts falling with no repeated loci means
  converging. The per-stage cap exists to bound spend, not to decide truth, and a runaway
  guard sits above the highest observed real convergence so that hitting it is genuinely
  abnormal.
- **Budget.** A stage that reports no usage is recorded `spend-unknown`, which blocks
  terminal `success` exactly as a failure does.

Terminal states: `success | no-op | blocked | stalled | exhausted | abandoned`. **Only
`success` permits handoff. Everything else requires a human.**

## The artifact

- `replays[]`: claim id, the query as stored, the pointer into `.brain/raw/verify.ndjson`,
  the L0 verdict, and the guard stamps. **No verdict field. You do not write verdicts.**
- `unverifiable[]`: claim id plus one sub-reason, with the evidence for the sub-reason
- `changedInFlight[]`: claim id plus the two timestamps
- `l2[]`: contradictions found, each naming both sources
- `l3Sample[]`: the claims sent for round-trip and the isolated agent's derived query
- `precisionSample`: the sixty, the independent path used, and the measured rate
- `findings[]`: `severity`, `disposition`, `dispositionBy`, `dispositionRung`, evidence,
  rule, location

Write it to the path the brief names, normally `.brain/in/verify.json`, and report the
stage's spend with the ingest.

```bash
snbrain ingest --stage verify --file .brain/in/verify.json
```

`ingest` diffs, sets every status, updates the decision index, counts the resolutions and
returns `{ accepted, rejected, findings, nextStage, terminal }`. **The CLI decides what is
next.**

## Never

- **Never write to the instance.**
- **Never diff the values yourself and report the verdict.** That is the one thing this
  stage is not allowed to do.
- **Never fabricate an evidence line.** A replay with no logged request did not happen.
- **Never report absence as a negative result without a canary.**
- **Never rewrite a claim's stored query to make it pass.**
- **Never dismiss an L4 finding with L4**, and never re-run the same judge to close one.
- **Never treat a stage that could not run as a stage that passed.** An exit code of 2 is
  "the gate did not execute", which is not a pass, and reporting it as one is how a build
  ships unverified.
- **Never decide the next stage.**
