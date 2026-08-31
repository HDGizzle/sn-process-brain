# sn-process-brain

A **mini project brain for a single ServiceNow process** — built in one afternoon from
one developer's pointers, deep enough that you can point at any record in the process
and ask "what does this do?" and get an SME-grade answer: where it sits in the process
spine, what upstream change fires it, what downstream depends on what it writes, and
which decision explains why it exists.

This is a **separate product** from the
[sn-agent-contextualization-framework](../sn-agent-contextualization-framework)
(the department-scope engagement brain). Same engine lineage (see `PROVENANCE.md`),
inverted economics:

| | Department brain (OG) | Process brain (this) |
|---|---|---|
| Entry | brownfield archaeology: census sweeps the whole customer surface | **seeded**: a developer names update sets (+ optional epic, docs) |
| Interview | late — you don't know what to ask until you've dug | **first** — the developer's pointers ARE the prior |
| Budget spent on | coverage: hundreds of artifacts, one pass each | **depth**: 30–80 artifacts, relational claims (ordering, conditions, data flow) |
| Deliverable bar | a navigable domain wiki | passes the **point-at-a-record test**, proven by a generated probe suite |

## The pipeline

```
preflight → orientation → SEED → provenance → ANCHOR → harvest(gated)
         → explain(relational) → verify → questions → interview → render(spine)
```

- **SEED** — intake, zero API calls. Captures the developer's pointers verbatim.
  ONE hard gate: at least one update-set pointer that resolves to a non-empty set.
  Epic and docs are enrichment, never requirements; their absence is stamped
  (input envelope), not fatal.
- **ANCHOR** — co-change expansion. Seeded artifact → its `sys_update_version` chain →
  every set it ever shipped in (P4); each set → sibling artifacts via `sys_update_xml`
  (P2); one iteration, weighted by 1/|set|, batch/Default sets excluded and listed;
  plus one refgraph hop. Output: tiered surface — T1 named, T2 co-shipped, T3 referenced.
  The diff between what the human named and what the evidence found is the question
  generator.
- **render** — a **process spine** page (trigger → states → actors → outcome) with every
  artifact page anchored to its position on it, plus a generated probe suite that IS the
  acceptance gate: sampled artifacts must answer "what does this do in the process" with
  spine position, upstream cause, downstream dependents and decision provenance, each
  citing a claim ID.

Census is not deleted: a run whose seed is unavailable (or a `--blind` run) degrades to
the census path — the department-scope archaeology — recorded as such. One engine, two
entries, and the state says which one ran.

**Build status:** SEED and ANCHOR are implemented and selftested; harvest reads anchor
surfaces natively (named sys_ids, depth doctrine). The relational explain, the spine
render and the generated probe suite are the next build phases — until they land, a run
renders with the inherited department-scope render.

## Running it

```bash
node tools/snbrain/drive.js dry-run                                   # price a run: brief size per stage
node tools/snbrain/snbrain.js init --instance <name> --sync-root <dir> --budget 400
node tools/snbrain/drive.js run --runner copilot                      # or codex / claude
```

`drive.js` is the harness-independent loop driver: one **fresh agent process per stage
iteration**, the brief file as its entire prompt, cost logged per spawn. It pauses (exit 4)
at the human gates — seed, orientation, interview — which you run in your own interactive
agent session, then resume. Runner command lines are in `drive.config.json`.
Step-by-step: `docs/first-run.md`.

Full stage contracts, degradation rules and open decisions: `docs/design.md`.

## What this product deliberately does not have

No write-guard hooks, no dev-assist skills, no build playbooks — this product maps,
read-only. It produces the SME repo; day-2 development on top of that process is the
OG product's job.

## Transfer

Anything platform-generic learned here (silent-failure classes, table gotchas, engine
fixes) graduates to the sibling product, and vice versa. Protocol and ledger:
`TRANSFER.md`.
