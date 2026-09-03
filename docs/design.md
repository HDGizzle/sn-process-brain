# Process-brain design — converged 2026-08-20

The decisions below were converged in design conversation before any code changed.
This is the requirements document for adapting the forked engine. House style
throughout is the OG repo's: gate on nothing you can measure, stamp every
degradation, make acceptance criteria citable, and let the CLI own control flow.

## Product thesis

The department brain starts blind, so it must sweep (census) and interview late. A
developer on a team is NOT blind: they can point at the update sets, the epic and the
docs of one process, and that gates the surface immediately. The process brain starts
from those pointers and spends the saved budget on **depth** — the resulting repo must
pass the **point-at-a-record test**: point at any harvested record, ask "what does this
do?", and get spine position + upstream cause + downstream dependents + decision
provenance, every element citing a claim.

## Pipeline

```
preflight → orientation → SEED → provenance → ANCHOR → harvest(gated)
         → explain(relational) → verify → questions → interview → render(spine)
```

Reused as-is (initially): preflight, orientation, provenance, verify, interview.
New: SEED, ANCHOR. Reshaped: harvest (gated by tiers), explain (relational claims),
questions (diff-driven), render (spine + generated probes).

**Census: skipped on the seeded path, kept as the fallback (decided at build, 2026-08-20).**
The stage stays in the table between seed and provenance. A seeded run routes past it
(recorded skipped); a run with no seed (`available:false`) or a `--blind` run takes the
census path exactly as the department-scope product does — one engine, two entries, and
the state records which one ran. This beats deletion: the degradation is honest and
mechanical instead of a different product.

**T3 is the chain-repair leg, not an anchor tier (decided at build, 2026-08-20).** The
referenced-but-never-shipped surface (shared script includes, global BRs) is exactly what
the engine's existing chain-repair machinery mints from dangling references when the
harvest queue drains — bounded by rounds and area caps, and starting from evidence
(claims already in the ledger) rather than prediction. Emitting T3 at anchor would have
read record bodies at anchor time, which is harvest's job and harvest's budget. ANCHOR
therefore emits T1/T2 only.

## SEED — intake (zero API calls)

**Goal:** capture what the developer can point at, verbatim, before any read. Every
pointer is a claim about scope, never ground truth.

**Inputs (PoC transport = exports/pasted content; connectors are an upgrade, not a
dependency):**
- update-set pointers — **the one hard requirement** (see gate below)
- an Azure DevOps epic (or equivalent) — optional
- Confluence/docs — optional
- table names, artifact names, explicit exclusions — optional

**Schema (core):**
- `process { name, trigger, outcome }`
- `pointers[]`: `{ kind: update-set | artifact | table | document | story | epic,`
  `value, namedBy, confidence: certain | probably | vague }`
- `explicitExclusions[]`

**The one hard gate:** at least one update-set pointer that RESOLVES — the name matches
a `sys_update_set` row AND that set has > 0 `sys_update_xml` members. Two reads, spent
at the START of provenance (SEED itself stays at zero API calls; the resolution check
is the first act of the next stage). A pointer that resolves to nothing or to an empty
set is a stop-and-ask at minute one, not a failure discovered after a burned harvest.

**Input envelope (stamped, mirrors the provenance envelope):** `sets-only`,
`sets+stories`, `sets+docs`, `full`. Downstream stages read the stamp instead of
assuming inputs exist. Nothing else about SEED inputs is gated.

**Acceptance:**
- AC-SEED-1: `usage.apiCalls = 0` — the CLI refuses anything else. A prior that costs
  budget is not a prior.
- AC-SEED-2: every pointer is verbatim from a named human, carrying THEIR confidence
  word, not the agent's.
- AC-SEED-3: at least one update-set pointer exists. (Resolution is checked at
  provenance start; if the ONLY pointer fails to resolve, the run stops and asks —
  it does not fall through to a blind sweep.)

## ANCHOR — co-change expansion

**Goal:** turn the seed into a bounded candidate surface with tiered membership, so
harvest reads only what the evidence implicates.

**The insight this stage is built on:** an artifact pointer resolves to its version
chain (`sys_update_version`), the chain resolves to every update set the artifact ever
shipped in, and each set's membership (`sys_update_xml`) yields sibling artifacts.
Artifacts that repeatedly co-ship are co-changed, and co-change is process membership
evidence (git co-change mining, on-platform). This makes a SINGLE honest set
self-amplifying: a 3-artifact hotfix set fans out through version chains to the
process's whole shipping history. That is why one set is a sufficient hard requirement
and docs/epic never need to be gated on.

**Procedure:**
1. Resolve each seeded pointer to sys_ids. Unresolvable pointers become findings,
   never silent drops.
2. **Axis 1 — version chains (P4):** seeded artifact → all sets it ever shipped in.
3. **Axis 2 — set membership (P2):** each set (seeded or recovered) → sibling
   artifacts.
4. Iterate 2↔3 **exactly once** (fixpoint snowballs into the full instance). Weight
   artifact–artifact edges by `1/|set|`. Exclude Default and oversized batch sets;
   list every exclusion with row counts. Provenance's induced story-id pattern
   upgrades weights: same-story sets are near-certain co-membership.
5. **Axis 3 — refgraph one hop** (existing `tools/snbrain/refgraph.js`) over T1/T2:
   catches shared script includes and global BRs that never co-shipped.
6. **Epic chain (only if input envelope has stories AND provenance found the naming
   pattern):** epic → child story IDs → sets whose names match the induced pattern →
   feed into axis 2.

**Output tiers:**
- **T1 named** — the human said so.
- **T2 co-shipped** — evidence: which sets, edge weights.
- **T3 referenced** — evidence: which reference field.
Harvest reads T1+T2 fully, T3 shallowly.

**Seed-adequacy signal (measured, never gated):**
- *converged* — coherent T2 cluster, refgraph edges mostly internal → proceed.
- *barren* — set expands to nothing beyond itself but refgraph shows heavy outbound
  references → probably a partial slice; auto-generate the interview question and
  stamp low seed confidence.
- *exploded* — co-change pulls in half the instance (sprint-dump sets) → exclusions
  fire, developer is asked for story-level sets.

**Degradation (envelope-driven):** no P4 → axis 1 lost, expand from seeded sets only.
No P2 either → co-change unavailable; ANCHOR degrades to refgraph-only AND STAMPS IT,
because a brain built without co-change evidence answers "what belongs to this
process" with weaker confidence and the render must say so.

**Acceptance:**
- AC-ANC-1: every T2/T3 member carries a citable edge (set sys_id + weight, or
  reference field). No artifact enters the surface on vibes.
- AC-ANC-2: expansion ran exactly one round; the round count is recorded.
- AC-ANC-3: excluded sets are listed with row counts — silent truncation reads as
  coverage.

**Learned on the first real run (pilot-run-6, devinst02, 2026-08-28) and built in:**
- **Neighbour demotion.** Version chains through SHARED artifacts (form sections, UX
  lists, ACL roles) reach neighbouring processes as easily as the seeded one; 150 of 284
  admitted records were the H&S model, not the VendorX integration, and adequacy read
  "converged" because it measured size, not provenance. Every recovered set now reports
  `seededOverlap` (distinct seeded artifacts it contains); the CLI demotes sets below
  `ANCHOR_MIN_OVERLAP_RATIO = 0.5` — overlap/members — unless the set shares a seeded story root (pilot-run-7 showed absolute overlap admits every large neighbour: 2 of 162, 6 of 190, 5 of 73), and T2 members admitted only through demoted sets become
  `neighbourGaps` — recorded, askable, never harvested on this budget.
- **Area packing.** One area per table cast 51 areas (30 with ≤3 records) — 51 briefs of
  ~9k tokens for 284 records. Tables with ≥ `ANCHOR_AREA_MIN = 5` records get their own
  area; smaller ones pack into multi-table areas of ≤ `ANCHOR_AREA_PACK = 15` records
  (`targetsByTable` tells the harvest brief which ids belong where). The brief, not the
  call, is the expensive unit: harvest cost 5 calls per area.

## Depth inversion — harvest and explain

The department brain spends budget on coverage (hundreds of artifacts, one pass). The
process brain has 30–80, so the same budget buys depth per artifact, and depth is not
optional polish — it is the product:

- execution order among business rules (order, when: before/after/async)
- parsed conditions and condition overlap between siblings
- field-level data flow: which artifact WRITES a field that another READS
- what each notification/flow actually fires on

**explain produces RELATIONAL claims, not per-artifact summaries.** The unit of
explanation is "where does this sit": upstream cause → artifact → downstream
dependents, plus which sibling would fire in its place if the condition missed.

## Render — the spine

- A **process spine** page: the causal chain trigger → states → actors → hand-offs →
  outcome, as a first-class page.
- Every artifact page ANCHORED to its spine position, with upstream/downstream links
  and decision/story provenance.
- The **why-gap is stated, not filled**: mechanics come from the instance; the why
  comes only from provenance + interview. Where a set is story-named and a doc exists,
  why-answers are strong; where they are not, the page says "no recorded reason" —
  a real SME says that rather than inventing one.
- Docs (when present) are the CLAIMED process; the harvested spine is the ACTUAL one.
  Contradictions between them are questions-stage input, generated at explain/verify
  time.

## The acceptance gate — generated probes

Render generates a **process-specific probe suite**: sample harvested artifacts, ask
"what does this do in the process", and the answer must cite:
1. spine position,
2. upstream cause,
3. downstream dependents,
4. decision provenance (or an explicit why-gap),
each backed by a claim ID. If an answer can't cite all four (with 4 allowed to be an
honest gap), the brain is NOT done rendering, regardless of how many pages exist.
**The deliverable is a repo that passes the point-at-a-record test, not a repo that
has pages.**

## Open decisions (settle during build, in this order)

1. **Set-size exclusion threshold:** fixed number vs induced from this instance's
   set-size distribution. Lean: induced (house pattern), with a fixed floor as
   fallback when there are too few sets to induce from.
2. **T3 timing:** refgraph hop before the human sees the T2 list (fewer interview
   cycles) vs after (cheaper). Lean: before, capped to one hop.
3. **Wiki scaffold shape:** spine page + artifact pages + decision ledger + probe
   suite — design when render is reshaped, not before.
4. **Kernel:** this product's CLAUDE.md identity is the SME contract. Write it after
   the first successful PoC run, from evidence of what the repo actually needed.

## PoC definition of done

A developer provides ≥1 real update set (plus whatever docs/epic they have), says
"map this process", and the run produces a repo where the generated probe suite
passes the point-at-a-record test — with every degradation that occurred stamped and
visible in the render.

## Decisions of 2026-09-02 — the response to the second engagement's findings

Thirteen findings from the second run (another company's laptop, 2026-08-31; recorded in
the OG repo's `FINDINGS`) and the verdict pass against the first run
(`docs/findings-response-2026-09-02.md`) produced five decisions. They are applied, not
open.

**D1 — Full development brain from day one.** The exported brain ships the OG's hook set,
its `settings.json` wiring and the WHOLE OG build-skill library, synced into this tree by
`tools/sync-og-layer.js` (scrubbed by the distribution gate, recorded in
`.claude/og-layer.json`). `snbrain skills-audit` — at render, at finalize, on demand —
proves every skill is routable (quoted trigger phrases the `skill-trigger.js` hook
harvests) and reachable from the kernel; a failure is a BLOCKING finding. The render
contract was not weakened to accept an empty layer; the layer was made to exist.

**D2 — In-place brain.** No sibling workspace. The cloned product folder is the engagement
root and the workspace; `bootstrap.js` initialises here and waits for the port file here.
`snbrain finalize --by <name>` prunes the machine, regenerates the proof, runs the handoff
checks, writes the hashed manifest and re-initialises git at
`project brain <instance> / <process>`; it refuses below terminal success unless forced
with a reason, and refuses unknown files in the root rather than deleting or shipping them.

**D3 — Offline verification.** Every fix was verified with the selftest (new tests named
after the findings) and by replaying the deterministic renderers over a scratch copy of the
first run's real ledgers. No instance call, no model spend.

**D4 — Publish.** The gated distribution is rebuilt and pushed to the public distribution
repo at the end of every such night.

**D5 — Loop policies.** (a) The update-set-membership-discrimination kill (the census's A3
authorship rung) is DEFERRED at preflight on a run that can still be seeded — a warning
finding plus the stamp `authorshipRung = package-level-only` — and re-raised as blocking
at the seed door only when the seed turns out unavailable, or at once under `--blind`.
The seeded run's gate is the anchor's resolution: no seeded set resolves non-empty →
blocked. (b) A seeded set is NEVER size-excluded: the batch rule applies to recovered
sets only; a large seeded set mints a warning and keeps its 1/|set| weight; the validator
refuses a seeded pointer's set in role `excluded`; the developer's own `exclusions[]` at
seed is the one legal exit.

### Render is generated, and the deliverable is checked as a tree

Everything the last two runs' workers wrote by hand or left as scaffold is generated
from the ledgers by `render.js` — `--scaffold`, `--glossary`, `--stories`, `--interview`,
`--proof`, `--index` — and the kernel by `render-kernel.js` in three mirrors (Claude,
Copilot, Codex) with the language and platform policy lines derived from typed config.
One normalised vocabulary model (`lib/vocabulary.js`: `canonicalTerm`, `aliases[]`, the
DEC number, the witness claims) feeds both the glossary and the kernel section, and a
definition joins its term by identity only. Story pages pair seeded work items to update
sets by the numeric id shared in the set name, or the induced story root; several sets
per story are normal; a seeded set that pairs to nothing is a warning finding.

`lib/handoff.js` is the one definition of "fit to leave": no placeholder in a live page
(`_TEMPLATE.md` exempt), every kernel route resolves, the three mirrors identical, the
read-only proof present with its stable copies, hooks wired and on disk, every skill
routable. `render.validate` runs it on the operating tree; `export` and `finalize` run it
on the tree that ships; `EXPORT-MANIFEST.json` lists every file with its sha256 and
`verify-export` / `finalize --check` fail on any add, delete or modify.

### Next build item — the VS Code-native runner adapter (F1)

**The problem, measured.** `drive.js` models every runner as an executable plus arguments
and spawns one OS process per stage; fresh context per stage is achieved by process
isolation. On a company-managed laptop with Copilot Chat authenticated in VS Code and no
permission to install the standalone Copilot CLI, not one automated stage could run — the
run got as far as bootstrap and the transport, then the launcher prompted to install the
CLI and the developer declined.

**What exists now.** The runner CONTRACT in `drive.js`: a stage request
`{ brief: { text, file, stage, iteration }, root, model, toolPolicy: { readOnly, allowlist },
prompt }` → a normalised result `{ status: ok | failed | unavailable, exit, output, usage,
error, seconds }`. The three CLI presets sit behind it unchanged (`runStage`, kind `cli`).
`detectRunners` names every runner with its availability, including `vscode` as
"designed, not yet available"; `drive.js doctor`, `bootstrap.js` and `drive.js run` all
report a missing runner with the three options — install the CLI, use another runner
that is present, or the adapter — BEFORE any brief is written or any credit is spent.

**The adapter design.** A small VS Code extension, `sn-process-brain-runner`, that:

1. **Registers a runner endpoint** the driver can call without a process boundary: a
   local HTTP listener on 127.0.0.1 with a per-session token written to
   `.vscode/snbrain-runner.json` (the same shape as sn-scriptsync's port file, so
   `drive.js` resolves it the same way). `drive.js` gains runner kind `vscode` whose
   `runStage` POSTs the request and awaits the result; `drive.config.json` gains
   `runners.vscode = { kind: "vscode", portFile: ".vscode/snbrain-runner.json" }`.
2. **Creates one fresh chat request per stage** through the VS Code Language Model API
   (`vscode.lm.selectChatModels` + `sendRequest`) — a NEW request object per stage, no
   conversation history carried, the brief text as the entire user turn plus the same
   one-line worker prompt the CLI runners get. Fresh context is structural again: the
   adapter never reuses a request and never exposes the editor's open chat.
3. **Enforces the tool policy in the adapter**, not in the prompt: the request is issued
   with a tool set the adapter defines — file read, file write restricted to the brief's
   `produce.path` and `.brain/in/`, a `run` tool restricted to `node tools/snbrain/…`
   commands, and the instance client ONLY through `tools/snbrain/lib/api.js`. Every
   `rest_request` the model asks for is checked to be a GET before it is issued; a
   write-shaped call returns a refusal to the model and is logged. Identical restrictions
   to what `--allow-all-tools` CLI runs get from `lib/api.js`, but enforced at the tool
   boundary, so they cannot be talked around.
4. **Returns the normalised result** with `usage` from the LM API's token counts where the
   model exposes them, `status` from whether the ingest command was run (the driver's
   existing reconciliation handles the artifact-written-but-not-ingested case), and the
   model's final text as `output`.
5. **Leaves the human gates to the orchestrating chat**: the driver still exits 4 at
   orientation, seed and interview; the person runs those in their own Copilot Chat with
   the stage skill, exactly as today.

**Acceptance for the build.** A user with Node.js, VS Code, sn-scriptsync and
authenticated Copilot Chat runs the complete loop without installing a CLI; every
automated stage receives only its brief and a newly created request; the read-only
restriction is enforced identically to the CLI runners and the read-only proof shows
zero write-shaped calls; `drive.js doctor` reports `vscode` available when the extension
is running; the CLI runners keep working with no configuration change.

**Why not now.** It needs an extension published to a marketplace (or side-loaded by an
IT department), which is a distribution channel this product does not have yet, and it
should be built against a real company-managed machine — the second engagement's — not
simulated.
