# Fork provenance

This repo is a **snapshot fork** of
`sn-agent-contextualization-framework` at commit:

    605fc712f287679a186fb841da0e76d475c9aebb
    (2026-08-20, "docs(build-log): the run-6 runway — 6.9 audited landed-in-substance, PRODUCT-101 and 6.11 noted")

Forked deliberately as a **separate product** rather than a branch: the process brain
inverts the entry (seeded, not census) and the budget (depth, not coverage), and
bending the department-scope pipeline around that would have contorted both. The
divergence between the two engines is the requirements document for an eventual
`snbrain-core` extraction — extract from evidence, not speculation.

## Copied at fork

| Path | What it is |
|---|---|
| `tools/snbrain/` | the full engine: CLI, stage machine (`lib/stages.js`, `lib/state.js`), transport (`lib/api.js`), probe/render/refgraph/gotcha/mutate/selftest tooling |
| `.claude/skills/snbrain-*` | the eleven stage skills + `snbrain-map` orchestrator — the procedure layer the engine drives |
| `.claude/snbrain/LOOP.md` | the loop contract the stage skills and export allowlist reference (copied at the SEED/ANCHOR build, missed by the first trim) |
| `.gitignore` | as-is |

## Copied as INHERITED PLACEHOLDERS (the selftest demands them; each is slated for replacement)

The first trim left these out and the engine's own selftest failed 5/307 — the engine
and its companions are entangled by design (stage briefs cite `docs/rework-plan.md`;
tests assert the scaffold and kernel toolchain ship at day zero). They are in the fork
to keep the selftest green as the fork-integrity instrument, NOT as product decisions:

| Path | Replacement plan |
|---|---|
| `wiki-scaffold/` | replaced by a spine-shaped scaffold (see `docs/design.md`) |
| `kernel/CLAUDE.template.md`, `product.config.json`, `tools/render-kernel.js` | replaced by this product's own kernel: the SME contract ("point at a record, get the spine answer") |
| `docs/rework-plan.md` | OG design dossier; stage briefs read its provenance-rungs section. Trim to what the briefs cite, or repoint the briefs, when stages are reshaped |

## Deliberately NOT copied (and why)

| Path | Why not |
|---|---|
| `.claude/hooks/` (write-guard, capture-verifier, kernel-integrity) | this product is read-only mapping; the write path it guards does not exist here |
| `.claude/skills/` build skills (business-rule-patterns, etc.) | dev-assist layer, OG product's job |
| `playbooks/`, `probes/`, rest of `docs/` | engagement-shaped for department scope; this product ships a one-afternoon playbook and GENERATES its probes per process |

## Line-ending note (inherited)

`tools/snbrain/lib/state.js` is CRLF, `lib/stages.js` is LF — mixed on purpose-by-history.
Multi-line edit anchors must match the file's own endings or they audit as NOT FOUND.

## Reconciliation

When comparing engines later: diff this repo's `tools/snbrain/` against the fork commit
above, not against the sibling's HEAD — changes on their side since the fork are theirs,
not our drift.
