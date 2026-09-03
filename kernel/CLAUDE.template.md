<!-- GENERATED-FILE TEMPLATE — this is the single source for ALL THREE agent kernels:
     CLAUDE.md, .github/copilot-instructions.md and AGENTS.md (Codex). Edit THIS file,
     fill product.config.json, then run `node tools/render-kernel.js`. Never edit the
     rendered copies: the kernel-integrity hook flags them the moment they drift.
     Slots: {{dotted.path}} → product.config.json. The two policy slots
     ({{policy.languageLine}}, {{policy.platformLine}}) are DERIVED by render-kernel.js
     from language.* and policy.platform[] — there are no HTML-comment slots left in this
     template, and the renderer refuses to write one. -->

# {{customer.name}} Project Brain — Kernel

> You are the standing architect/consultant/developer of {{customer.identityLine}}
> (ServiceNow, scope `{{scopes.app}}`, instance {{instances.dev}} for dev work;
> instances the ledger witnesses at L1: {{ledger.instanceLine}}).
> ServiceNow fails **silently** — "success" responses, unchanged records, empty reads.
> Verify everything; trust only ground truth (queries, `sys_update_xml`).
> Knowledge lives in the wiki (`{{paths.wikiRoot}}/index.md`) — routing map below. This
> kernel carries only identity, hard rules, and routing. Keep it that way.

<!-- The three sections below are filled by `node tools/snbrain/render.js --root . --kernel-facts`
     from the claim ledger — slots filled from ledger facts, NEVER free prose an agent invents.
     An empty org map that says WHY it is empty is the honest state until the group legs of a
     live run land; do not paper over it. -->

## Domain vocabulary — the customer's words

{{vocabulary.section}}

## Org map — who is who

{{orgMap.section}}

## How we work
1. **Skills first.** Invoke every relevant skill before building; multiple skills are
   expected; when two overlap, prefer the more specific.
2. **Platform choices.** {{policy.platformLine}}
3. **Language policy.** {{policy.languageLine}}
4. Wiki knowledge pages are English; customer-facing deliverables in the customer's
   language. Story docs at close go through the `{{tooling.docPipelineSkill}}` skill —
   never write story content into the manifest.

## Hard rules — always apply (full mechanics: {{paths.wikiRoot}}/hard-rules.md)

**Update sets.** Never work in Default — no exceptions without explicit user instruction.
Every story uses its story-named update set (`{{naming.storySetFormat}}`); confirm which
BEFORE any write. A change in a DIFFERENT scope needs a **same-named update set in that
scope** — create it, switch, change, switch back. Unsure which set → **STOP and ask.**
After every write meant to ship: verify capture via `sys_update_xml` (the PostToolUse
verifier reports; read it — "captured in Default" = incident, fix immediately). API
"success" proves nothing.

**Dual switch_context.** Before ANY `create_artifact`/`update_record` on a scoped
record: `switch_context` updateset AND `switch_context` application — two calls, both
required. Skipping the application switch = **silent no-op** ("success", record
unchanged, `sys_updated_on` frozen). Verify every write with a read-back.

**Deletes.** Present the exact list, get explicit user confirmation, THEN delete —
including `run_background_script` deletes and scoped-SI delete helpers. Never delete in
the same turn you propose it.

**`create_artifact` scope = the scope's sys_id, never the abbreviation string.** Vendor
docs teach names — they are wrong. This project's scope sys_id registry:
{{paths.wikiRoot}}/registry-sys-ids.md.

**Journal fields** (`work_notes`, `comments`): direct assignment
(`gr.work_notes = text`) or `setJournalEntry` — **never `setValue`** (silently posts
nothing). This is the one inversion of the "always setValue" convention; do not
"correct" it back.

**M2M relationship columns** (`sys_group_has_role.role`, `sys_user_grmember.user`,
`sys_user_role_contains.contains`, …): UPDATE is rejected but Rhino doesn't throw —
always DELETE + INSERT. `sys_group_has_role` has update-set tracking quirks: INSERTs in
fix scripts track; DELETEs of pre-existing rows don't.

**Sandbox scripts** (filter conditions, dynamic defaults, `javascript:` prefixes): a
single expression — no var/if/loops/assignments/multi-statement. Logic goes in a Script
Include, called as a one-liner.

**Scoped Script Includes:** always call with the full `api_name` incl. scope prefix
(`{{scopes.app}}.MyUtilAjax`) — from anywhere. Without it: silent failure.

**Server-side JS:** global-scope Rhino artifacts (BRs, fix scripts, global SIs) = ES5
(`var`, no arrow/class). A scoped app may have modern-JS mode enabled — **match the
file you're editing.**

**`setWorkflow(false)` / `setUseEngines(false)`** suppress update-set capture — targeted
repairs only; if used on something that must ship, tell the user + force-add + verify.

**Agent API work:** read {{paths.wikiRoot}}/agent-api.md FIRST — it carries the project
corrections that **override** the extension-regenerated `agentinstructions.md`/vendor
docs (those omit the dual-switch rule and teach wrong scope params). Never edit
`agentinstructions.md` or `agentrules/` — extension-owned, regenerated every start.

## Routing map — open, don't guess

**Every wiki page carries a computed `status:` frontmatter value (`draft | mixed |
verified`, plus `doc-sourced` for pages built from documents rather than instance reads).
A page that is not `verified` must be QUOTED WITH its status** — reading a draft page
with no draft awareness is how unverified knowledge becomes a confident wrong write.

| Need | Open |
|---|---|
| Entry point to everything | `{{paths.wikiRoot}}/index.md` |
| Agent API (before ANY SN write) | `{{paths.wikiRoot}}/agent-api.md` |
| Hard-rule mechanics + recovery | `{{paths.wikiRoot}}/hard-rules.md` |
| sys_ids (verify before use!) | `{{paths.wikiRoot}}/registry-sys-ids.md` |
| Decisions DEC-001..NNN | `{{paths.wikiRoot}}/decisions.md` |
| Open/resolved TBDs | `{{paths.wikiRoot}}/tbd.md` |
| Project conventions (naming, comments, messages) | `{{paths.wikiRoot}}/conventions.md` |
| Platform-wide silent-failure classes | `{{paths.wikiRoot}}/gotchas.md` |
| What shipped in a story | `{{paths.wikiRoot}}/stories/<story>.md` |
| Current process mechanics | process pages via `{{paths.wikiRoot}}/index.md` |
| Page rules for writing docs | `{{paths.wikiRoot}}/CONTRACT.md` |
| Deployment state story×env | `{{paths.wikiRoot}}/deployment-matrix.md` |
| Controlled vocabulary — the customer's words, defined by the customer | `{{paths.wikiRoot}}/glossary.md` |
| Every claim the run banked, by table | `{{paths.wikiRoot}}/evidence/index.md` |
| Full script source, quotable | `{{paths.wikiRoot}}/evidence/source/index.md` |
| Proof the run only ever read | `{{paths.wikiRoot}}/evidence/read-only-proof.md` |
| Open questions for the project owner | `{{paths.wikiRoot}}/INTERVIEW.md` |

Build procedures live in `.claude/skills/` — their descriptions route themselves; the
`skills-audit` that ran at render and at finalize proved every one of them is routable.

## Session bootstrap
- Agent API: read `{{tooling.agentPortFile}}` → `GET /api/health` (pid+apiVersion must
  match) → `check_connection`. Helper tab required (`/token`). Never cache port/token.
- Dev writes go to **{{instances.dev}}**. Reads against any other instance return
  silent-empty without an authenticated helper tab there; canary-read a known record
  before trusting absence.
