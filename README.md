# sn-process-brain

A **development brain for a single ServiceNow process** — built in one afternoon from
one developer's pointers, deep enough that you can point at any record in the process
and ask "what does this do?" and get an SME-grade answer: where it sits in the process
spine, what upstream change fires it, what downstream depends on what it writes, and
which decision explains why it exists — and complete enough that an agent can start
building on that process the moment the folder opens.

This is a **separate product** from the
[sn-agent-contextualization-framework](../sn-agent-contextualization-framework)
(the department-scope engagement brain). Same engine lineage (see `PROVENANCE.md`),
inverted economics:

| | Department brain (OG) | Process brain (this) |
|---|---|---|
| Entry | brownfield archaeology: census sweeps the whole customer surface | **seeded**: a developer names update sets (+ optional epic, docs) |
| Interview | late — you don't know what to ask until you've dug | **first** — the developer's pointers ARE the prior |
| Budget spent on | coverage: hundreds of artifacts, one pass each | **depth**: 30–80 artifacts, relational claims (ordering, conditions, data flow) |
| Deliverable bar | a navigable domain wiki | passes the **point-at-a-record test**, and ships as a **full development brain** |

## The pipeline

```
preflight → orientation → SEED → provenance → ANCHOR → harvest(gated)
         → explain(relational) → verify → questions → interview → render → finalize
```

- **SEED** — intake, zero API calls. Captures the developer's pointers verbatim.
  ONE hard gate: at least one update-set pointer that resolves to a non-empty set.
  Epic and docs are enrichment, never requirements; their absence is stamped
  (input envelope), not fatal.
- **ANCHOR** — co-change expansion. Seeded artifact → its `sys_update_version` chain →
  every set it ever shipped in (P4); each set → sibling artifacts via `sys_update_xml`
  (P2); one iteration, weighted by 1/|set|, Default and RECOVERED batch sets excluded and
  listed — a seeded set is never size-excluded; plus one refgraph hop. Output: tiered
  surface — T1 named, T2 co-shipped, T3 referenced. The diff between what the human
  named and what the evidence found is the question generator.
- **render** — process pages, generated story pages (one per seeded work item, paired to
  its update sets by the shared id), the glossary and the kernel's vocabulary from ONE
  confirmed-vocabulary model, the evidence and source appendices, the read-only proof,
  the decision ledger, the minted convention gates, and the kernel in three mirrors.
- **finalize** — in place: prunes the mapping machine, audits every shipped skill for
  routability, writes `EXPORT-MANIFEST.json` with a sha256 per file, and restarts git
  history at "project brain <instance> / <process>".

Census is not deleted: a run whose seed is unavailable (or a `--blind` run) degrades to
the census path — the department-scope archaeology — recorded as such. One engine, two
entries, and the state says which one ran.

## What ships in the brain (the day-2 layer)

The deliverable is a **full development brain**, not a read-only map. It carries the OG
framework's enforcement hooks (write guard, capture verifier, kernel integrity, skill
trigger, artifact-skill reminder) wired in `.claude/settings.json`, and the **whole OG
build-skill library** (~47 skills), synced into this tree by `tools/sync-og-layer.js`
from the OG commit recorded in `.claude/og-layer.json` and scrubbed by the same gate
that guards the distribution. `snbrain skills-audit` proves every skill is routable
(quoted trigger phrases) and reachable from the kernel; it runs at render, at finalize
and on demand, and a failure is a blocking finding.

## Running it

```bash
node tools/snbrain/drive.js doctor                                    # which runners are on PATH
node tools/snbrain/bootstrap.js --instance <name> --process "<words>" --runner copilot
node tools/snbrain/drive.js dry-run                                   # price a run: brief size per stage
node tools/snbrain/drive.js run --runner copilot                      # or codex / claude
node tools/snbrain/snbrain.js finalize --by "<your name>"             # at terminal success
```

`drive.js` is the harness-independent loop driver: one **fresh agent process per stage
iteration**, the brief file as its entire prompt, cost logged per spawn. It pauses (exit 4)
at the human gates — seed, orientation, interview — which you run in your own interactive
agent session, then resume. Runner command lines are in `drive.config.json`; the runner
contract (brief + stage metadata + root + model + tool policy → normalised result) is
documented in `drive.js`, and a VS Code-native adapter for machines without a standalone
CLI is designed in `docs/design.md`. Step-by-step: `docs/first-run.md`.

Full stage contracts, degradation rules and open decisions: `docs/design.md`.

## Transfer

Anything platform-generic learned here (silent-failure classes, table gotchas, engine
fixes) graduates to the sibling product, and vice versa. Protocol and ledger:
`TRANSFER.md`.
