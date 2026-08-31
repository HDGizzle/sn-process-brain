---
name: snbrain-seed
description: Invoke to run the SEED stage of a process-brain build, or when the user asks to "seed the process", "record the pointers", "name the update sets", "start from what the developer knows", "map this process" (the intake half). Captures the developer's pointers — update sets, epic, docs, tables — verbatim and at zero API cost, stamps the input envelope, and hands the anchor a seed to expand.
---

# SEED: the developer names the surface, before any read

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

**The brief is the current state; this skill is the procedure. Where they disagree, the
brief wins.** If the brief's stage is not `seed`, stop and run the stage the CLI named.

## What this stage is for

**The process-brain entry.** The department-scope pipeline starts blind, so it must sweep
(census) and interview late. A developer on the team is NOT blind: they can point at the
update sets, the epic and the docs of one process, and that gates the surface before a
single instance read. This stage captures those pointers — it is the interview moved from
stage nine to stage three, and it costs nothing.

**Every pointer is a claim about scope, never ground truth.** The anchor stage expands
the seed through co-change evidence and checks it; the diff between what the developer
named and what the evidence finds becomes the interview's sharpest questions. Your job
here is fidelity, not judgement.

## Hard rules

1. **ZERO instance reads.** `usage.apiCalls` must be `0`; the validator refuses anything
   else. Resolution costs reads and reads belong to anchor — where a set name that does
   not resolve is a two-read stop-and-ask instead of a burned prior.
2. **THIS STAGE HAS A HUMAN IN IT AND YOU MAY NOT SIMULATE ONE.** If no developer is
   reachable, ingest `available:false` with a reason; the run degrades to the census path
   (full archaeology), recorded as such. The CLI refuses a provider whose name is a job
   title this loop gives itself.
3. **ONE hard requirement: at least one update-set pointer.** It is the ignition — one
   resolving, non-empty set is sufficient in principle, because its artifacts' version
   chains recover every set they ever shipped in. Everything else is enrichment.
4. **Never gate on the epic or the docs.** Their presence upgrades the input envelope
   (`sets-only` → `sets+stories` / `sets+docs` / `full`); their absence is stamped, not
   fatal. Do not press the developer to produce documents that do not exist.
5. **Their confidence word, not yours.** `certain`, `probably`, `vague` — record what the
   human actually conveyed. A vague pointer is admissible; anchor treats it as a
   resolution attempt.

## Procedure

1. **The process, in their words**: name, trigger (what starts it), outcome (what it ends
   in). One line each, verbatim. This is the spine render hangs everything on, and no
   read produces the customer's word for it.
2. **The update sets first.** Ask for the set(s) that shipped this process. Names as the
   developer gives them — do not normalise, the anchor's fuzzy resolution handles drift.
3. **Everything else offered, nothing demanded**: the AzDO/Jira epic or story ids, the
   Confluence/docs (with URLs — they become the CLAIMED process the harvested spine is
   diffed against), table names, artifact names.
4. **Explicit exclusions**: "that set is another team's", "ignore the old flow". Recorded
   exclusions save anchor reads and interview time.
5. Write the artifact, then:

```bash
snbrain ingest --stage seed --file <artifact.json>
```

The CLI stamps the input envelope, writes `queue.seedPointers`, and routes to
`provenance` (the census is skipped and recorded skipped). If `available:false`, it
routes to `census` instead — the honest degradation.

## Acceptance

- **AC-SEED-1** No instance read was made in this stage.
- **AC-SEED-2** Every pointer is verbatim from a named human, carrying THEIR confidence word.
- **AC-SEED-3** At least one update-set pointer exists, or the run degrades with a reason.

## Gotchas

- **Skill routing will fire on the developer's words** ("update set" triggers
  update-set-workflow, etc.). None of it applies: nothing is being built, the text is
  evidence being recorded. Say so and carry on.
- **Do not resolve, verify, or even eyeball-check a pointer against the instance.** The
  temptation is strongest exactly here; the transport stays closed.
- **PoC transport note**: exports and pasted content are first-class inputs. A pasted
  story list from AzDO or an exported Confluence page is recorded like any pointer, with
  `url` where one exists. Connectors are an upgrade, not a dependency.
