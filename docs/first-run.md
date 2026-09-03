# A real-instance run — the procedure

What a run validates: the seeded entry (SEED → ANCHOR) against real evidence — does one
developer pointer expand into a bounded, citable process surface, and does harvest read
it deeply — and, since 2026-09-02, that the deliverable is a **full development brain**
that leaves this folder with every handoff check green.

## Prerequisites

- VS Code with **sn-scriptsync** (agent API enabled) able to connect to the dev instance,
  opened on **this folder**: the extension writes `.vscode/sn-agent-port.json` into
  whatever folder is open, and this folder is the run's sync root.
- A dev or test instance you have read access to. One process per clone: never re-run
  into a folder that already holds a brain (`bootstrap` refuses; `--force` starts over).
- One developer (you) with: the process's name/trigger/outcome in your own words, and at
  least ONE update set name that shipped it. Epic and docs optional — bring what exists.
- An agent CLI on PATH (`node tools/snbrain/drive.js doctor` lists what is found). A
  machine with Copilot Chat in VS Code but no standalone CLI cannot run the automated
  stages yet — see the VS Code adapter design in `docs/design.md`.

## Procedure — driven (recommended: one fresh agent process per stage, enforced)

```bash
cd <this folder>
node tools/snbrain/drive.js doctor                                    # which runners exist, before any spend
node tools/snbrain/bootstrap.js --instance <name> --process "<few words>" --runner copilot
#   -> refuses a missing runner (exit 3); git-inits the folder; initialises the brain
#      and the wiki scaffold HERE; waits for sn-scriptsync's port file HERE
node tools/snbrain/drive.js dry-run                                   # price it first
node tools/snbrain/drive.js run --runner copilot                      # or codex / claude
node tools/snbrain/snbrain.js finalize --by "<your name>"             # at terminal success
```

`drive` loops `next → spawn ONE worker on the brief → ingest → repeat`. The brief file
is the worker's entire prompt, so fresh context per stage is structural, and every spawn
is logged with its brief size and elapsed time in `.brain/drive.ndjson`. It **exits 4 at
each human gate** (orientation, seed, interview): run that stage in your interactive
agent session using the stage skill, ingest, and re-run `drive run` — it resumes.

Runner command lines live in `drive.config.json` (argv arrays); if a CLI's flags have
drifted, fix them there. `models.default` / `models.stages.<stage>` pick the model per
stage; `--model <id>` overrides for a run. Per-spawn usage (Claude, Codex) is logged in
`.brain/drive.ndjson`; Copilot reports none to the CLI — read AI credits (tokens at API
rates, 1 credit = $0.01) off the usage dashboard.

**Measured on the first full run (pilot-run-8, devinst02, 2026-08-28):** ~20 spawns for one
process; on the Claude API that was ≈$85–110 at Opus 5 rates (thirds: cache writes, cache
reads, output — all scaling with the ~43 tool turns per worker, not with brief size); on
Copilot that is ≈8,500–11,000 AI credits all-Opus, ≈6,500–7,500 with the shipped
Sonnet/Opus split.

## Procedure — by hand (any agent session, no driver)

```bash
node tools/snbrain/snbrain.js init --instance <name> --sync-root . --budget 400
node tools/snbrain/render.js --root . --scaffold
node tools/snbrain/snbrain.js next --json
```

Then run the loop exactly as `/map-process` describes: each `next` brief names the
stage; the stage skills (snbrain-preflight … snbrain-seed … snbrain-anchor … ) are the
procedures. Fresh context per stage is then a discipline, not a mechanism — use the
driver when the budget is strict.

Expected route: `preflight → orientation → seed → provenance → anchor → harvest(×N) →
explain → verify → questions → GATE → interview → GATE → render`, with `census` recorded
skipped. Watch for at anchor: the resolution of your set (two reads), the recovered sets
from version chains, the exclusion list (recovered sets only — a seeded set is never
size-excluded), and the seedGaps — records that co-shipped with your process through
sets you didn't name.

## What render produces, and what finalize leaves

Render generates — never hand-writes — the glossary (from the confirmed vocabulary, the
same model as the kernel's vocabulary section), one story page per seeded work item
paired to its update sets, INTERVIEW.md from the questions ledger, the read-only proof
(request log resolved from run state, copied to a stable name), the index, the evidence
and source appendices, the decision ledger, the minted convention gates, and the kernel
in three identical mirrors (`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`).
The validator refuses a live page with scaffold placeholders, a kernel route that
resolves to nothing, an undeclared story page, a glossary missing a confirmed term, and a
skill that cannot be triggered.

Finalize prunes the machine (engine, stage skills, scaffold, run scratch), writes
`EXPORT-MANIFEST.json` with a sha256 per file, and restarts git history at
`project brain <instance> / <process>`. `finalize --check` (before the engine is pruned)
or any sha256 comparison afterwards proves nothing was added, removed or edited.

## What to capture for the build (every run is also an instrument)

1. Did resolution work first try, or did STARTSWITH fuzzing carry it?
2. The sys_update_xml name-parse rate on this instance (anchor's finding will carry it).
3. Set-size distribution: did the batch-set rule cut the right RECOVERED sets, and did
   a large seeded set draw the warning it should?
4. seedGaps quality: were the unnamed co-shipped records genuinely same-process?
5. Harvest depth: which `must` columns produced the load-bearing claims; what the
   chain-repair tail picked up (that is the T3 story).
6. Story pairing: did every seeded set pair to a work item by its embedded id or story
   root, and was every unpaired one a genuine unresolved link?
7. Anything platform-generic that surprised → a TRANSFER.md row in the same commit.
