---
name: snbrain-questions
description: Invoke to run the QUESTIONS stage of a project-brain build, or when the user asks to "generate the questions", "what should we ask the SME", "rank the questions", "find the anomalies worth asking about", "build the interview list". Turns claims and findings into a short ranked set of questions a human can answer in one line each, and kills the ones that would waste their time.
---

# QUESTIONS: earn the right to ask

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

**The brief is the current state; this skill is the procedure. Where they disagree, the
brief wins.** If the stage is not `questions`, stop and run the stage the CLI named.

## The thesis this stage carries

MAP does not exist to produce the map. **MAP exists to earn the right to ask the right
questions.** The claim ledger is the mechanism; the decision ledger is the product.

That is not a slogan, it is a measured position. On the reference engagement a perfect
map scores roughly 2 of 9 on that project's own acceptance suite, because the other seven
answers need counter-knowledge, domain vocabulary and decision rationale, and every one of
those came from a human. The map's job is to find the anomalies that make a human's answer
cheap and specific.

## The scarce resource is the human, not the API

Budget your output against **their attention**, not your call count. A question that
wastes two minutes of an expert's evening costs more than a thousand reads.

This has a hard consequence the CLI enforces and you must not fight: **if fewer candidates
clear the confidence floor than the cap allows, send fewer.** A short list is a result.
Padding to hit a number is precisely the waste the metric punishes, and it is the failure
mode that makes an expert stop answering.

## Procedure

**1. Read the ledgers, not your memory of them.**

```bash
snbrain claims --open --json
snbrain findings --disposition open --json
```

**2. Apply the scope filter first, and treat it as load-bearing.** Only
**customer-authored** artifacts can carry a decision. A question about a ServiceNow
default or a store app is worse than useless: it is unanswerable, it signals you cannot
tell their work from the platform's, and it spends the credibility the rest of the list
depends on.

The census stamped the authorship bands. Respect them. And respect the third state:
`authored-but-undeliberate`. On a single-owner or vendor development instance, much of
what passes an authorship filter is scratch, half-built experiments and demo records.
Those were never decided, so there is no WHY to recover. **If the run carries that stamp,
say so in the artifact and expect a much shorter list.**

**3. Generate only from signals that survived the backtest.** The catalogue in the brief
is authoritative and it is shorter than it looks: several plausible signals were deleted
by name after measurement, because they fired constantly on a real engagement and almost
never produced an answerable question. Do not resurrect them because one looks clever on
this instance. If you believe a new signal is warranted, emit it as a **finding** proposing
it, not as questions.

**4. Prefer provenance-narrowed questions.** WHY-as-rationale is not derivable. WHY-as-
provenance partly is. So do not ask an open question when the ledger can close it:

> Weak: "Why does this business rule exist?"
> Strong: "This arrived 12 March in set `STRY0142.01` alongside four notification changes,
> authored by `j.smit`. Deliberate, or collateral?"

The second costs one line to answer. The first costs a meeting and usually gets "dunno".

**5. Run the anti-waste gates and record what each one killed.** A question dies if it is
answerable from the instance, answerable from a document already in the repo, a duplicate
of an open or answered question, or if its answer would change nothing. The kill counts
per gate go in the artifact: they are how the ranking gets calibrated for the next run,
and a gate that never kills anything is a gate that is not implemented.

**6. Hand back candidates. The CLI ranks them.** You supply, per candidate, the fields the
brief's schema names, including the evidence and your confidence. **You do not compute the
score, you do not sort, and you do not choose the cut.** The CLI computes the value
function and applies the cap. This is the same rule as the verify stage: the moment a model
both generates and ranks its own output, the ranking is self-assessment.

**7. Never invent an id.** Question ids are content hashes allocated by the CLI. Supplying
one is a rejection.

**8. Ingest.**

```bash
snbrain ingest --stage questions --file .brain/in/questions.json
```

## What a good question looks like

- **One line of context, one question, answerable in one or two sentences.**
- Cites the specific artifact, with its sys_id, so the human can look while answering.
- Names what changes depending on the answer. If nothing does, the gate should have killed it.
- Asks about intent, not about state. State is what you already read.
- Never two questions wearing one question mark.

## What you must never do

- **Never write to the instance.** This stage reads ledgers and may re-read the instance
  through `tools/snbrain/lib/api.js` to close a gate. Nothing else.
- **Never ask something the ledger already answers.** That is the cheapest possible way to
  lose an expert's trust, and it is entirely avoidable.
- **Never pad the list to the cap.**
- **Never grade your own questions.** Whether a question bought real understanding is
  measured after the interview, from the human's answers, and a model scoring its own
  output is the L4-judging-L4 failure the ladder forbids.
- **Never send a question whose premise is a read error.** Before a question reaches a
  human, its underlying claim must be `verified`, not `draft`. A wrong-premise question
  spends the scarcest input in the whole engagement on our own bug.
