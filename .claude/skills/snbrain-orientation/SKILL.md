---
name: snbrain-orientation
description: Invoke to run the ORIENTATION stage of a project-brain build, or when the user asks to "run orientation", "take the blind recall", "what conventions does this team have", "is any of this already documented", "where do the stories live", "ask before reading". Collects the sealed recall, the stated conventions, the governing documents with a human's current/stale judgement, and where stories actually live — before a single instance read.
---

# ORIENTATION: ask before you read

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, what to do, which inputs to read, the artifact to produce,
the acceptance conditions, the remaining budget, the iteration and the cap. **The brief
is the current state; this skill is the procedure. Where they disagree, the brief wins.**
If the brief's stage is not `orientation`, stop and run the stage the CLI named. `next`
never advances state, so a resumed session gets the same brief.

## What this stage is for

**Everything the instance cannot tell you, asked before the instance can bias you.**

Until this stage existed the loop had exactly one `humanGate`, and it sat eighth of nine —
after the boundary was frozen, after the budget was spent, after 8,239 claims were minted,
and after the ranker had already decided what the operator's ten minutes would be spent on.
The consequence was measured on run `6ef14f5562`:

- ~40 API calls, a dedicated scout pass and one of ten gate slots were spent **inducing** a
  naming convention from 422 rows. The SME then stated it in half a sentence — and
  volunteered a JSDoc convention nothing had thought to look for, because nothing in the
  loop knew that coding standards are a category of thing.
- The run derived `storyPattern: ^(STRY\d{7})(\.\d{2})?` and carried **62 exact story ids**,
  then spent the budget reconstructing 64 story pages from update-set archaeology. The
  SME's very first recall answer said the stories live in Azure DevOps.
- Three of the ten questions put to the human had already been answered in full by the
  sealed recall, taken an hour earlier.

**The rule this stage exists to enforce:**

> The human supplies the corpus and the judgement. The agent supplies the lookups the
> evidence already keys.

Pointing at sixty-four stories is waste when the run derived all sixty-four identifiers.
Deciding which of five Confluence pages is the live one is judgement no lookup replaces.

## Hard rules

1. **ZERO instance reads.** `usage.apiCalls` must be `0`; the validator refuses anything
   else. If you have already read something, you are in the wrong stage.
2. **The recall is sealed BEFORE you show any of our material.** Ask all four prompts,
   record the answers, and do not react to, interpret, summarise or feed back any answer
   until every one is recorded. An answer primed by our vocabulary is not a recall.
3. **Verbatim, in whatever language they used.** Every `recall.topics[].span` must be a
   character-for-character substring of a `prompts[].verbatim`. The CLI checks it. A
   paraphrase cannot be smuggled past this, so do not try to tidy anyone's grammar.
4. **"No answer" is a legal outcome.** Record it. Never invent one, never infer one from
   an adjacent answer.
5. **A document is a lead, not a fact.** Anything recorded here mints a `documented` claim
   on the `DOC` rung, which is outside the L0–L5 verification ladder and can never satisfy
   a `verified` page status. Documents rot: this customer's own hand-built brain carried a
   wrong acronym expansion for five months, and the instance-driven interview is what
   caught it.
6. **Under `--blind` this stage is skipped by the CLI**, not by you. Blind mode exists to
   withhold exactly these inputs. If you are running blind you will never see this brief.

## Procedure

### Step 1 — the sealed recall

Four prompts, asked together, answered before anything of ours is shown:

1. In your own words, end to end: what does this process actually do? Start wherever it
   starts for the people who use it.
2. Name five things about this instance a new consultant would get wrong.
3. What in here was a deliberate decision that looks like an accident — or the reverse:
   what looks deliberate but is really just how it ended up?
4. What has been tried here and abandoned, or built and never used?

Prompts 3 and 4 are the ones no read can reach and the ones the question ranker can never
generate, because a rule enforced *nowhere* leaves no anomaly to rank. They are the reason
this stage is worth a human's time.

Record each answer under `recall.prompts[].verbatim`. Then lift `recall.topics[]` from that
text — each with a `span` that is a literal substring. Lift; do not compose.

**Lift EVERY item of an enumeration, not a selection.** When the human answers with a
list ("looks broken but is deliberate: X, Y, Z, W, V"), every item is its own topic with
its own span. Run pilot-run-8: two of five items in one such list were not lifted, so no
decision was ever minted for them, and the finished brain could not answer about them —
a gap the exam attributed to the brain until the transcript showed it was the presenter's.

### Step 2 — the boundary read-back and the conventions

Read `boundaryAsStated` back to the human in their words, not as a predicate. Census has
not run, so this is what they believe the domain is — it is a hypothesis the census will
test, and recording it is how a later disagreement becomes visible instead of silently
resolved in our favour.

Then the conventions, against the closed `kind` enum. For each, ask for a **pattern** if one
exists, and mark `testable` accordingly. A convention with a pattern gets reconciled against
the ledger at `questions` and the **gap becomes the question** — slots are reserved for it,
so it cannot be crowded out by the cap. A convention without one is recorded and never
guessed at: an induced convention is indistinguishable from drift, because only the author
knows whether it was deliberate.

### Step 3 — documents, and where the stories live

For every governing document: its location, and **a named human's judgement of current or
stale**. That judgement is the whole point. A link list is cheap; knowing which of five
pages is live is not, and it is the one thing no crawl can decide.

Then `tracker`: where stories **actually** live. Ask it separately from whether `rm_story`
rows exist on the instance — they are not the same question, and on this engagement they
have different answers. Record the id form, so a derived identifier can be resolved later
instead of re-derived.

### Then

```bash
snbrain ingest --stage orientation --file <artifact.json>
```

The CLI mints one `documented` claim per stated convention, one decision per convention and
per recall topic, writes `queue.statedConventions` / `statedDocuments` / `recallTopics` and
`facts.tracker`, and routes to `seed` — the second human door, where the developer names
the process surface before the first instance read.

## Acceptance

- **AC-ORI-1** No instance read was made in this stage.
- **AC-ORI-2** A named human judged each recorded document current or stale.
- **AC-ORI-3** Where stories actually live is recorded, distinctly from whether `rm_story`
  rows exist.
- **AC-ORI-4** Every recall topic is quoted, not summarised.

## Gotchas

- **Skill routing will fire on the customer's own words.** A recall mentioning tests,
  scripts or migrations matches `atf-testing`, `client-scripts`, `es5-compliance` and
  others. None of them applies: nothing is being built here, and the text is evidence being
  recorded. Say so and carry on. (`PRODUCT-6`, observed on six separate sessions.)
- **Do not "helpfully" expand an acronym the human used.** If you know what it means, you
  know it from somewhere other than this instance, and the glossary is downstream.
- **Resist reconciling anything here.** Measurement belongs to `questions`, where the
  reserved slots are. This stage records what was said, and nothing else.
