---
name: map-process
description: Build a mini project brain for ONE ServiceNow process from a developer's pointers — "map this process", "map-process", "build the process brain", "the developer has the update sets", or when someone drops an update set name, an epic and a doc and wants an SME-grade repo for that process. Orchestrates preflight → orientation → SEED → provenance → ANCHOR → harvest → explain → verify → questions → GATE → interview → GATE → render, read-only, with the CLI owning every control-flow decision.
---

# MAP-PROCESS: one process, one afternoon, one SME repo

This is the **seeded entry** into the snbrain loop — the process-brain product. The
department-scope entry (`snbrain-map` / map-instance) starts blind and sweeps; this one
starts from what a developer can point at and spends the saved budget on **depth**.

The deliverable bar is the **point-at-a-record test**: point at any harvested record,
ask "what does this do?", and the repo answers with spine position, upstream cause,
downstream dependents, and decision provenance — each citing a claim. A repo with pages
that cannot do that is not done.

## Before the loop — three questions, then the brain, IN THIS FOLDER

Ask the developer, one at a time and nothing else: (1) the instance name as
sn-scriptsync knows it, (2) the process in a few words, (3) which agent CLI they use.
Then bootstrap the brain YOURSELF, here — never ask them to open or name another folder:

```bash
node tools/snbrain/bootstrap.js --instance <instance> --process "<words>" --runner <cli>
```

The cloned product folder IS the engagement root and the workspace. Bootstrap first
checks the runner is on PATH (exit 3 with the options — install the CLI, use another
runner, or the VS Code adapter, which is designed and not yet available — before
anything is written), git-inits the folder if needed, initialises the brain and the wiki
scaffold here, sets `instances.dev`, and waits for sn-scriptsync's port file in this
folder. Tell the developer to connect the extension to the instance in this VS Code
window; if the file does not appear, ask for the folder where sn-scriptsync already syncs
that instance and re-run with `--sync-root`. Every command runs here.

## After the loop — finalize, in this folder

When `drive` reports `done` and terminal `success`:

```bash
node tools/snbrain/snbrain.js finalize --by "<developer's name>"
```

It regenerates the read-only proof, runs the handoff checks (no placeholder in a live
page, every kernel route resolves, the three kernel mirrors identical, hooks wired and
present, every skill routable), prunes the mapping machine out of this folder (the
engine, the stage skills, this skill, the scaffold, the run scratch), writes
`EXPORT-MANIFEST.json` with a sha256 per file, and restarts git history at
`project brain <instance> / <process>`. It refuses below terminal success unless
`--force --reason` is given, and refuses unknown files in the root rather than guessing.
Anything it refused is printed; nothing is deleted on a refusal.

## The loop — the CLI decides, you dispatch

```bash
node tools/snbrain/snbrain.js next --json     # ALWAYS the next action (the brain is initialised)
```

**Preferred: let the driver run the loop.** `node tools/snbrain/drive.js run --runner
<copilot|codex|claude>` spawns one fresh agent process per stage iteration with the
brief as its entire prompt — fresh context is structural, cost is logged per stage in
`.brain/drive.ndjson`. It exits 4 at each human gate; then YOU run that gate stage here,
interactively with the developer (seed, orientation, interview), ingest, and re-run the
driver. `drive.js dry-run` prices a run before any spend.

**By hand** (when no driver): read the brief, invoke the stage skill the brief's stage names
(`snbrain-preflight`, `snbrain-orientation`, `snbrain-seed`, `snbrain-provenance`,
`snbrain-anchor`, `snbrain-harvest`, `snbrain-explain`, `snbrain-verify`,
`snbrain-questions`, `snbrain-interview`, `snbrain-render`), produce the one artifact,
`ingest`, repeat. You never choose the next stage, never allocate an id, never decide
you are finished. Exit code 3 means a human is required — stop and say why.

## What makes this run seeded

- **SEED** (human door, zero reads): the developer names the process (name / trigger /
  outcome), the update sets — the ONE hard requirement — and whatever else they have:
  epic, docs, tables, exclusions. Exports and pasted content are first-class; connectors
  are an upgrade. The input envelope is stamped from what actually arrived and nothing
  is gated on docs or epic.
- **ANCHOR** (the census's replacement): resolves the sets (two reads each — a failed
  resolution is a minute-one stop-and-ask, never a fallthrough to a sweep), expands
  through version chains (P4) and set membership (P2), ONE round, weighted, batch sets
  excluded and listed. Output: a T1/T2 surface with a citable edge per member, cast
  directly as the harvest queue in named sys_ids. The T2-not-named diff (`seedGaps`)
  becomes the interview's sharpest questions.
- **Census is skipped and recorded skipped** on this path. If the seed is unavailable
  (`available:false`) the run degrades to the census path honestly — that is the
  map-instance pipeline, and this skill hands over to `snbrain-map`'s narrative.
- **Depth inversion at harvest**: tens of records read deeply (declared columns including
  the empty ones, the `must` columns where the logic lives, provenance carried per
  claim), not hundreds read once. The chain-repair leg supplies the referenced-but-
  never-shipped tail (shared script includes, global BRs) once the queue drains.

## Gates (same discipline as map-instance)

Two human gates downstream: QUESTIONS → GATE 1 (the developer names the process on the
spine, judges the seed gaps) → INTERVIEW → GATE 2 → RENDER. Do not simulate a human at
either; the validators refuse loop-identity respondents.

**At the interview gate, two rules learned the expensive way (run pilot-run-8):**
- Put ONLY `status: queued` questions to the human — `snbrain questions --status queued
  --json`. `shadow` questions are operator-graded controls; the ingest refuses answers to
  them and each refusal burns one of the stage's three iterations.
- Declare every AC id. A condition that did not arise (no "I don't know" to record as
  debt) is `pass` with that as the evidence — `not-demonstrated` blocks terminal success
  exactly like `fail`, and a completed stage cannot be re-ingested to fix it.

## Standing rules

Read-only throughout; every read goes through `tools/snbrain/lib/api.js`. Field-validate
before every filtered query. An empty read is not an absence without a same-session
canary. Partial is a result. The CLI keeps the arithmetic and the ids.

## Record what the loop gets wrong, as it happens

```bash
node tools/snbrain/snbrain.js quirk --note "<what happened>" [--severity blocker|friction|confusing|idea]
```

Findings about the INSTANCE go in the wiki and gate the run. Findings about **this
product** go here and gate nothing: a brief that contradicted the CLI, a rejection the
brief gave you no way to satisfy, a verb that does not exist, a capability the machine
lacks. One line, at the moment it bites — afterwards nobody remembers.

At the end, `snbrain quirks --report` writes `FINDINGS.md`: the recorded quirks, plus what
the run already knows without being told (rejections per stage, raised bounds, spend
disagreements) and **whether each wiki page carries what its evidence supports**. `finalize`
writes it for you and leaves it untracked, outside the deliverable. Tell the developer to
send it to whoever maintains this loop, and that it is not scrubbed of their own strings.

## Skill-routing note

The developer's own words ("update set", "business rule", "notification") will trigger
build skills. None applies during a mapping run — nothing is being built. Say so and
carry on.
