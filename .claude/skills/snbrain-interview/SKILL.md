---
name: snbrain-interview
description: Invoke to run the INTERVIEW stage of a project-brain build, or when the user asks to "run the interview", "ask the questions", "record the answers", "turn answers into decisions", "do the SME session", "log a decision or a TBD". Puts the ranked question set to the human and records each answer as a decision or debt record linked to the claims it explains.
---

# INTERVIEW: the human loop

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, the question set, the artifact, the acceptance conditions and
the cap. **The brief is the current state; this skill is the procedure. Where they
disagree, the brief wins.** If the stage is not `interview`, stop and run the stage the
CLI named.

This is the stage that produces the product. Every other stage exists to make the
questions in front of you worth a human's time.

## Before anything else: the blind recall, ten minutes

**Do this first, before the human sees a single one of our questions.**

> "Name five things about this instance a new consultant would get wrong."

Record it verbatim, seal it, timestamp it. It is the highest-value ten minutes in the run
and it is **worthless the moment they have seen the generated queue**, because from then
on you are measuring recognition rather than recall. This also produces counter-knowledge
that no amount of reading the instance can produce, which is the thing the machine cannot
derive.

## The questions are already ranked. Do not reorder them

The engine ran the scope filter, the signal catalogue, the anti-waste gates, the ranking
and the cap. Every term of the ranking is on the question record and
`snbrain questions explain <id>` prints all of them plus the exact queries. The top-N
truncation is the mechanism that protects the human, so **surplus is `deferred`, never
discarded and never smuggled into the batch.**

- **Ask only `admitted` questions.** `shadow` questions go to the operator for grading at
  zero cost to the human, and are never sent.
- **Ask them in one batch**, capped.
- **Every question must be answerable in one or two sentences.** A question that needs a
  paragraph gets no answer at all. Measured outcome on the reference engagement: one good
  question with a real consequence sat `_pending_` for eleven days.

## The closed form is the mechanism

**An open question ("why does this exist", "why is this off") may be asked ONLY when the
provenance envelope is empty.** Wherever the envelope carries author, date and container,
the question has already been rewritten against a closed template with two named branches.
Do not "improve" a closed question back into an open one.

Worked, on real data, and the contrast is the argument for the whole build:

> **Open form.** "The client script *ACME Subaction Prefill Due Date* is inactive while
> the rest of the framework is live. Why?"
> **Measured answer: "Unknown, doesn't recall."** It became a TBD.

> **Closed form.** "*ACME Subaction Prefill Due Date* (`sys_script_client 7a029a06…`) was
> created 2026-07-14 and set `active=false` on **2026-07-15 09:47:33 by a.developer**,
> and the deactivation was captured **inside** update set STRY0185005.00 (19 records)
> rather than applied afterwards, so it ships inactive by design of that set. Its three
> cluster-mates all ship active. **(a) deliberate, or (b) unfinished?** If (a), one line
> on why is enough."
> **Answerable in about twenty seconds.**

Same fact, same human. The envelope converts a question they already failed to answer into
one narrow enough that they might.

**Any question whose consequence is countable in one aggregate call must carry the count.**
Not "this may affect some users": "recipients whose preferred language is neither `en` nor
`nl` now match **no** notification, count = N". A question that carries the blast number
gets answered.

## Recording an answer

Record it through the CLI. Never write an answer into a wiki page and never into a claim.

Answers go into the **interview artifact**, which you then ingest — the same seam every other
stage uses. There is no `snbrain questions answer` verb; it was designed, never built, and for
a long time failed *silently* (it parsed as a bare `questions` listing and exited 0, so the
caller came away believing an answer had been recorded).

```jsonc
// .brain/in/interview.json
{
  "stage": "interview", "instance": "<instance>",
  "usage": { "apiCalls": 0, "notes": "no instance reads in this stage" },
  "answers": [{
    "questionId": "Q-a1b2c3d4e5f6",
    "answeredBy": "<name>", "answeredAt": "<date>",
    "kind": "decision",                  // decision | debt | unanswerable | deferred
    "branch": "a",                       // when the question was closed-form
    "verbatim": "<their words, exactly>",
    "rationale": "<their reason, if volunteered>",
    "statement": "<your words — this and the alternative labels are ALL you write>",
    "processName": "<only for a process-naming question: the customer's word>"
  }],
  "acceptance": [{ "id": "AC-INT-1", "result": "pass", "evidence": "..." }]
}
```

```bash
snbrain ingest --stage interview --file .brain/in/interview.json
```

Classification is **mechanical first**:

| Input | Record |
|---|---|
| `--rationale` non-empty | decision, `rationaleStrength: stated` |
| `--branch` given, no rationale | decision, `rationaleStrength: absent`, plus a debt record if a follow-up is owed |
| `--kind unanswerable` | debt record with an owner and a date; question outcome `unanswerable` |
| `--kind deferred` | question `deferred`, no record |
| archaeology supplied the causal clause and the human did not | decision, `rationaleStrength: inferred`, `derivedFrom: archaeology`, rendered with a visible marker |

Then, and only then, a capped model step writes **exactly two things** from the verbatim
answer: the one-sentence `statement`, and each rejected alternative's `label`. It never
writes `explainsClaims`, `witnessClaims`, ids, dates, attribution or `rationaleStrength`.
The model gets the wording; the CLI keeps the arithmetic and the links.

**`rationaleStrength` is not decoration.** A ledger that cannot tell a rationale a human
stated from one the machine inferred will, six months later, present an inference as a
decision. That has already happened on record: 1,788 characters of a confident
reconstruction, kept under the heading "Original (WRONG) analysis kept for history".

## The two claim links, and why collapsing them breaks everything

The CLI computes both. You do not write either.

- **`witnessClaims`** prove the decision **was taken**. Drift here means the decision may
  not have been taken, or was reversed.
- **`explainsClaims`** are the claims the decision **accounts for**. Drift here means the
  decision's consequences moved.

Both open reconfirmation, with different text and different urgency. Collapse them and
supersession stops working, which is the one thing this ledger does that a markdown
template does not.

## Expect debt more often than decisions

Of the reference engagement's six instance-derived questions, **zero** produced a decision
record at the time of asking, while all thirty-three of its decisions trace to build-time
story documentation rather than to discovery. The near-term deliverable is therefore the
**debt register plus supersession**, and the decision ledger is the long-run artifact that
discovery can only partly exhume.

**Do not inflate a TBD into a DEC.** A debt record with an owner and a date is a true
statement about what the customer knows. A decision record with a manufactured rationale is
a false one, and it will be read as authoritative by every agent that opens the repo.

## `unanswerable` is a first-class outcome

**The human oracle fails about one time in five.** Make saying so cheap and fast, record it
with an owner and a date, and move on. An `unanswerable` is data: it feeds the calibration
that decides which signals earn admission next run. A question padded into a forced answer
is worse than no question, because it enters the ledger wearing a human's name.

Store the answer **verbatim and unparaphrased** alongside the statement. The paraphrase is
a rendering; the verbatim is the evidence.

## Saturation, and stopping

Stop when the last five questions produced fewer than two ledger deltas. Do not keep
asking because there are candidates left: the queue is deep by construction and the cap is
what makes it safe.

If the run injected decoys for calibration, **disclose them immediately and explicitly**
once the answers are in. A decoy discovered later, by the person who answered it, costs
more trust than the calibration was worth.

## The artifact

- `blindRecall`: verbatim, timestamped, recorded before the batch went out
- `asked[]`: question ids, in the order sent, with the form used (`open` or `closed`)
- `answers[]`: id, outcome, `by`, `at`, branch, verbatim path, and the record the CLI
  minted
- `unanswerable[]`: id, owner, date
- `deferred[]`: ids, carried forward, not discarded
- `saturation`: the deltas produced by the last five
- `decoys`: whether injected, and whether disclosed

Write it to the path the brief names, normally `.brain/in/interview.json`, and report the
stage's spend with the ingest.

```bash
snbrain ingest --stage interview --file .brain/in/interview.json
```

`ingest` mints the decision and debt records, writes the claim links CLI-side, updates the
reverse index and returns `{ accepted, rejected, findings, nextStage, terminal }`. **The
CLI decides what is next.**

## Never

- **Never write to the instance.** This stage makes no instance calls at all.
- **Never fabricate an evidence line**, and never attribute a rationale the human did not
  state. `inferred` and `stated` are different fields for exactly this reason.
- **Never report absence as a negative result without a canary.** "No answer" is
  `unanswerable` or `deferred`, both of which are recorded outcomes, not silence.
- **Never ask for something derivable from the instance.** Choice values and labels are
  derivable and must never be asked: the reference glossary listed two states that were
  **both inventions**, and a register built from `sys_choice` cannot invent a state.
- **Never paraphrase the verbatim answer** into the evidence slot.
- **Never exceed the cap** because you had extra candidates.
- **Never send a `shadow` question to the human.**
- **Never write an answer straight into a wiki page.** Pages are rendered from the
  ledgers, and a hand-written page is a fact with no owner.
- **Never decide the next stage.**
