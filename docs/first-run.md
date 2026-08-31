# First real-instance run — the PoC procedure

What this run validates: the seeded entry (SEED → ANCHOR) against real evidence — does
one developer pointer expand into a bounded, citable process surface, and does harvest
read it deeply. The spine render, relational explain and generated probes are later
build phases; this run renders with the inherited department-scope render, and that is
fine — its data is what informs those builds.

## Prerequisites

- VS Code with **sn-scriptsync** (agent API enabled) able to connect to the dev instance;
  the extension writes `.vscode/sn-agent-port.json` into whatever folder is open, and
  that folder is the run's sync root.
- A dev or test instance you have read access to. Never a run repo that is already a
  scored instrument for another process — one workspace per process.
- One developer (you) with: the process's name/trigger/outcome in your own words, and at
  least ONE update set name that shipped it. Epic and docs optional — bring what exists.

## Procedure — driven (recommended: one fresh agent process per stage, enforced)

```bash
cd <product folder, extracted>
node tools/snbrain/bootstrap.js --instance <name> --process "<few words>" --runner copilot
#   -> creates ../<instance>-<process>-brain, copies the product in, initialises the
#      brain, opens VS Code on it and waits for sn-scriptsync's port file
cd ../<instance>-<process>-brain
node tools/snbrain/drive.js dry-run                                   # price it first
node tools/snbrain/drive.js run --runner copilot      # or codex / claude
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
node tools/snbrain/snbrain.js init --instance <name> --sync-root <dir> --budget 400
node tools/snbrain/snbrain.js next --json
```

Then run the loop exactly as `/map-process` describes: each `next` brief names the
stage; the stage skills (snbrain-preflight … snbrain-seed … snbrain-anchor … ) are the
procedures. Fresh context per stage is then a discipline, not a mechanism — use the
driver when the budget is strict.

Expected route: `preflight → orientation → seed → provenance → anchor → harvest(×N) →
explain → verify → questions → GATE → interview → GATE → render`, with `census` recorded
skipped. Watch for at anchor: the resolution of your set (two reads), the recovered sets
from version chains, the exclusion list, and the seedGaps — records that co-shipped with
your process through sets you didn't name.

## What to capture for the build (this run is also an instrument)

1. Did resolution work first try, or did STARTSWITH fuzzing carry it?
2. The sys_update_xml name-parse rate on this instance (anchor's finding will carry it).
3. Set-size distribution: did the batch-set exclusion rule (order of magnitude above
   seeded median) cut the right sets?
4. seedGaps quality: were the unnamed co-shipped records genuinely same-process?
5. Harvest depth: which `must` columns produced the load-bearing claims; what the
   chain-repair tail picked up (that is the T3 story).
6. Anything platform-generic that surprised → a TRANSFER.md row in the same commit.

The answers to 3–5 are the requirements input for the spine render and the relational
explain — that is why the first run happens before those are built.
