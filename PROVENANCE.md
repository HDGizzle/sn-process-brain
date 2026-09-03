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

## Synced from the OG by a build step (the day-2 layer) — decided 2026-09-02

Both real runs exported a brain with no enforcement hooks and no build skills, because
this file said the layer was "the OG product's job". That contradicted the render
contract (which demands hooks wired and skills present) and the product's own outcome
(a development brain, not a read-only map). The layer is now part of this tree:

| Path | Source | Mechanism |
|---|---|---|
| `.claude/hooks/*` (write guard, capture verifier, kernel integrity, skill trigger, artifact-skill reminder, table gotchas) | OG `.claude/hooks/` | `node tools/sync-og-layer.js` copies, scrubs with the distribution rule table, and records every file's sha256 and the OG commit in `.claude/og-layer.json` |
| `.claude/settings.json` (hook wiring) | OG `.claude/settings.json` | same; the render stage's `--gates` merges minted convention gates into it per engagement |
| `.claude/skills/<every build skill>` (~47; never `snbrain-*`, `map-process`, `bootstrap-project-brain`) | OG `.claude/skills/` | same; `snbrain skills-audit` proves each is routable and reachable from the kernel |

Re-sync when the OG library changes: `node tools/sync-og-layer.js --from <OG repo>`,
then `node tools/build-dist.js` (the gate), then commit. Skills the OG removed are removed
here and named in the manifest's `removed` list.

## Copied as INHERITED PLACEHOLDERS (the selftest demands them; each is slated for replacement)

The first trim left these out and the engine's own selftest failed 5/307 — the engine
and its companions are entangled by design (stage briefs cite `docs/rework-plan.md`;
tests assert the scaffold and kernel toolchain ship at day zero). They are in the fork
to keep the selftest green as the fork-integrity instrument, NOT as product decisions:

| Path | Replacement plan |
|---|---|
| `wiki-scaffold/` | instantiated per engagement by `render.js --scaffold` (dates filled, example rows dropped, story template parameterised); replaced by a spine-shaped scaffold later (see `docs/design.md`) |
| `kernel/CLAUDE.template.md`, `product.config.json`, `tools/render-kernel.js` | the kernel renders three mirrors (Claude, Copilot, Codex), derives the language and platform policy lines from typed config, and refuses unresolved slots or dangling routes; the SME-contract identity ("point at a record, get the spine answer") is still to come |
| `docs/rework-plan.md` | OG design dossier; stage briefs read its provenance-rungs section. Trim to what the briefs cite, or repoint the briefs, when stages are reshaped |

## Deliberately NOT copied (and why)

| Path | Why not |
|---|---|
| `playbooks/`, `probes/`, rest of `docs/` | engagement-shaped for department scope; this product ships a one-afternoon playbook and GENERATES its probes per process |
| `.claude/skills/bootstrap-project-brain`, `map-instance` command | the department-scope entry; this product's entry is `map-process` |

## Line-ending note (inherited)

`tools/snbrain/lib/state.js` is CRLF, `lib/stages.js` is LF — mixed on purpose-by-history.
Multi-line edit anchors must match the file's own endings or they audit as NOT FOUND.

## Reconciliation

When comparing engines later: diff this repo's `tools/snbrain/` against the fork commit
above, not against the sibling's HEAD — changes on their side since the fork are theirs,
not our drift. The synced day-2 layer is compared against the commit named in
`.claude/og-layer.json`, which moves with every re-sync.
