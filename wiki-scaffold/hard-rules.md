---
title: Hard Rules — full mechanics
last-verified: <fill at engagement>
---

# Hard Rules — full mechanics

> Reference tier. The kernel (`CLAUDE.md`) carries each rule in short form and links here for the full
> mechanics: the rule, why it exists, and the exact verify/recover procedure.
> Agent-API command corrections live in [agent-api.md](agent-api.md) — linked per rule, never duplicated.

## 1. Update-set discipline — never Default, stop-and-ask

**Rule.** No change ever lands in the **Default** update set — not scripts, not config, not data fixes. Stay in the user-named story update set (`<STORY-ID>.<NN> - <description>`). A change in a *different* application scope needs a **same-named update set in that scope**: create it (`sys_update_set`, `state: in progress`), `switch_context` to it, make the change, switch back. If the correct set is unknown or missing, **STOP and ask** — never proceed against Default. Only exception: the user explicitly says "use Default" for that one request.
**Why.** An update set only captures changes whose record scope matches the set's scope, and Default contents never deploy — work landing there is silently lost and must be redone or force-added later.
**Verify / recover.** Before writing: confirm the active set (`query_records` on `sys_update_set` / picker). After: query `sys_update_xml` for the record's sys_id — count 0 means it went to Default → re-apply or force-add under the correct set (§3).

## 2. Dual `switch_context` before any scoped write

**Rule.** Two separate calls before every `create_artifact` / `update_record` / `update_record_batch` on a non-global record: (1) `switchType: "updateset"` (capture), (2) `switchType: "application"` (transaction scope). The `scope` parameter on the write request is **not** a substitute for call 2.
**Why.** The extension stamps `?sysparm_transaction_scope=` from the *session's* application scope; a mismatch produces a silent no-op — API returns `"success": true`, record unchanged, `sys_updated_on` frozen. Observed on `sys_script_include.script`, `sys_group_has_role.role`, `sys_user_role_contains.contains` (verify on your instance first).
**Verify / recover.** After every write: `query_records` on the target → `sys_updated_on` moved AND the field holds the new value. Frozen timestamp → re-check scope, re-switch, retry. See [agent-api.md](agent-api.md) §1.

## 3. Verify update-set capture, not just record existence

**Rule.** After any write meant to ship: query `sys_update_xml` filtered to the active update set's sys_id and confirm an `INSERT_OR_UPDATE` row with the target's `target_name`. API "success" + record present in DB/UI is **not** proof — only `sys_update_xml` is. Related: `setWorkflow(false)` / `setUseEngines(false)` **suppress capture entirely** even with the right scope + set active — reserve for targeted repairs; if one touches a shipping record, say so, link the record, have it right-clicked → "Add to Update Set", and re-verify.
**Why.** Several write paths (bulk data builds, REST Table API writes to `sys_ui_list` / `sys_ui_list_element`, engine-suppressed scripts) create records that look perfectly healthy in the UI while producing zero `sys_update_xml` rows — the orphaning is only visible in the capture table itself.
**Verify / recover.** Missing capture → right-click "Add to Update Set" or force-add via a `GlideUpdateManager2` background script, then re-query `sys_update_xml`. Patterns in the `update-set-workflow` skill; see [agent-api.md](agent-api.md) §3.

## 4. Before ANY delete — show and confirm first

**Rule.** Present the exact list of what will be deleted and wait for explicit user confirmation. Never delete in the same turn the delete is proposed. Applies to update sets, `sys_update_xml` rows, fix scripts, test records, files — and to **indirect paths**: `run_background_script` GlideRecord deletes and scoped-Script-Include delete helpers (e.g. a `TaskUtil.deleteMultipleRecords`-style method), which bypass the API's `deleteRecords` settings gate entirely.
**Why.** Deletes are the one class with no undo, and the tooling gate only guards `delete_record` / `rest_request` DELETE — not script-driven deletes.
**Verify / recover.** After a confirmed delete, query the targets → count 0. Deletes of pre-existing `sys_group_has_role` links don't auto-track (§8) — add a Fix Script step or runbook entry. See [agent-api.md](agent-api.md) §6.

## 5. `create_artifact` scope = sys_id, all fields in the initial payload

**Rule.** `params.scope` MUST be the scope's **sys_id**, never the abbreviation string (`"global"` is tolerated only because it happens to BE a real sys_id). Include **all** fields in the initial payload.
**Why.** A name string corrupts the `sys_scope` FK and breaks downstream cross-scope writes; cross-scope ACLs silently block field updates *after* creation, so a follow-up `update_record` cannot repair a thin payload.
**Verify / recover.** Query back: `sys_scope.value` equals the expected sys_id and every field is present. Known sys_ids: [registry-sys-ids.md](registry-sys-ids.md) (verify per instance). See [agent-api.md](agent-api.md) §2.

## 6. Journal fields — direct assignment, never `setValue`

**Rule.** Write `gr.work_notes = text` or `gr.work_notes.setJournalEntry(text)` — **never** `gr.setValue('work_notes', text)`. The one inversion of the "always setValue" convention; leave a short comment on the line so sweeps don't "correct" it back.
**Why.** `setValue()` on a journal field registers no entry — the write is silently dropped, while direct assignment posts normally (verify on your instance first). Best-practice audits flag the *correct* form as a violation.
**Verify.** Query `sys_journal_field` (`element_id=<sys_id>^element=work_notes`) after the write. See [agent-api.md](agent-api.md) §4.

## 7. M2M relationship columns — DELETE + INSERT, never UPDATE

**Rule.** `sys_group_has_role`, `sys_user_role_contains`, `sys_user_grmember`, etc. reject UPDATE on the relationship-defining columns (`role`, `contains`, `user`, `group`). Always DELETE the old row + INSERT the new one.
**Why.** The platform logs `"UPDATE operation is not allowed to change the relationship... Use DELETE followed by an INSERT instead."` but **Rhino doesn't throw** — Fix Scripts keep running and `gs.info` "success" while data is unchanged.
**Verify.** Query the M2M table after: new pairing exists, old pairing gone. See [agent-api.md](agent-api.md) §5.

## 8. `sys_group_has_role` is not natively update-set tracked

**Rule.** INSERTs done inside a Fix Script ARE captured by the active update set. For existing records, manual right-click "Add to Update Set" works. DELETEs of pre-existing links (from older update sets) do **not** auto-track — ship them as a Fix Script step OR a deployment-runbook entry.
**Why.** A role-grant removal that must ship (e.g. to close a data-access hole) cannot travel in the update set on its own — left untracked, target environments silently keep the grant.
**Verify.** `sys_update_xml` check per §3; for delete steps, verify the runbook entry exists before declaring the story deployable.

## 9. Translation mechanics — and the multilingual-project policy

**Mechanics (apply whenever any translation work is done).**
- Server messages: `gs.getMessage('<prefix>.<scope>.<key>')` + one `sys_ui_message` record per language.
- Client messages: `getMessage()` + the key listed in the script's `messages` field (missing → the raw key renders); in the configurable workspace use the **callback form** of `getMessage` — the synchronous form silently returns the key.
- Translation tables: `string` fields → `sys_translated`; `translated_text` fields (e.g. `sys_ux_form_action.name`) → `sys_translated_text` with `documentkey` — a `sys_translated` row there silently fails.
- Check the session language matches the source language before any translation work — writing "translations" from the wrong session language corrupts the source rows.
- UI Action `name` leaks as the button label: keep it a clean source-language string *without* a project prefix, translate via `sys_translated`. Other record names (BRs, UI policies) can carry the project prefix (e.g. `ACME - <description>`).

**Multilingual projects only — policy template.** If the engagement mandates multiple languages (fill in at kickoff: `<lang-A>` + `<lang-B>`): every label, button, message, choice, or notification a user can see ships with a `<lang-A>` source AND a `<lang-B>` translation, using the mechanics above. Single-language projects can skip the policy but keep the mechanics for any translated artifact they touch.
**Why.** Every failure mode here is silent — a raw key, an untranslated fallback, or a no-op translation row all render "successfully".
**Verify.** Render in a session set to each target language (or query the translation table with `documentkey`/field match) and confirm every language. Mechanics: `translate-workspace-ui` / `translate-server-scripts` skills.

## 10. Sandbox scripts — single expression only

**Rule.** Filter conditions, dynamic defaults, AMB/RecordWatcher conditions, and `javascript:` prefixes run in the Guarded Script sandbox: one simple expression. No `var`/`let`/`const`, no `if`/`for`/`while`/`switch`, no function declarations, no assignments, no `;`-separated statements. Logic goes in a Script Include, called as a one-liner: `new x_acme_fm.CaseFilterUtil().isHighRisk(current.priority)`.
**Why.** Multi-statement sandbox scripts break silently or at upgrade; on recent family releases (Zurich P9 / Yokohama P13 and later) they surface in the auto-populated **Incompatible Guarded Scripts** list.
**Verify.** Run the Incompatible Guarded Scripts report on each instance before upgrading. Does not apply to client scripts / Script Includes (they run outside the sandbox).

## 11. Scoped Script Includes — full `api_name` with prefix

**Rule.** Calling ANY Script Include in a scoped app from anywhere — GlideAjax, server script, another scope — requires the full `api_name`: `new GlideAjax('x_acme_fm.CaseAjaxUtil')`, never the bare class name.
**Why.** Without the prefix the call silently fails: no error anywhere, the callback simply returns nothing — indistinguishable from an empty result.
**Verify.** Query `sys_script_include.api_name` for the exact string; exercise the call and confirm real data comes back (not just "no error").

## 12. ES5 on the server; scoped-app API restrictions

**Rule.** Business Rules, Script Includes, UI-Action server scripts, and Fix Scripts run on Rhino → **ES5 only** (`var`, no `const`/`let`, no arrow functions, no template literals). Workspace *client* scripts may use modern JS, and some scoped apps run a modern engine — **match the style of the file you're editing**, never "modernize" a Rhino artifact. Additionally in scoped apps: `gs.now()` / `gs.nowDateTime()` are not allowed — use `new GlideDateTime()` (auto-initializes to now) + the `*LocalTime()` methods.
**Why.** Modern syntax in Rhino throws `SyntaxError` only when the script first *executes* — it saves cleanly and fails later in production paths; scoped-API violations likewise fail at runtime.
**Verify.** Exercise the script (don't just save it) and check the system log for syntax/scope errors on first execution.

## 13. Workspace = `sys_ux_*` (configurable), never `sys_aw_*` (classic)

**Rule.** A modern workspace is a **configurable workspace** on the `sys_ux_*` table family. Never build or reason against classic Agent Workspace (`sys_aw_*`). Skill choice follows: `workspace-list-visibility` / `workspace-view-rules` / `workspace-modal-actions`, not any classic-Agent-Workspace guidance.
**Why.** The two table families are disjoint: anything created on `sys_aw_*` is simply never read by a configurable workspace — a full build that silently does nothing. Corollary from the same family: workspace list visibility is governed by **audiences** (`sys_ux_list` ←M2M→ `sys_ux_applicability`), not the `roles` field on the list.
**Verify.** Every workspace artifact touched must live on a `sys_ux_*` table; if a doc, skill, or vendor example points at `sys_aw_*`, it is the wrong surface — stop and re-route.
