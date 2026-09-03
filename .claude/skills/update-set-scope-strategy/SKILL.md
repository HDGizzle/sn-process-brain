---
name: update-set-scope-strategy
description: This skill should be used when the user asks about "update set scope", "global update set", "scoped update set", "which update set", "form elements update set", "sys_ui_element scope", "sys_translated_text not captured", "changes not in update set", "which scope captures", or any question about which update set / scope captures which types of changes in ServiceNow. This is the WHICH-SCOPE-CAPTURES-WHAT reference; for the create/switch/verify/recover procedures, use the update-set-workflow skill.
---

# Update Set Scope Strategy — which scope captures what

Every change is captured by an update set that matches the **scope of the record being changed**. Changes in different scopes land in DIFFERENT update sets, so a story often needs multiple companion sets — one per scope touched. The naming/`.NN` split convention and the create/switch/verify/force-add procedures live in the `update-set-workflow` skill; the never-Default and capture-verification rules live in the project kernel and the wiki's hard-rules page.

Examples below use `x_acme_fm` as the placeholder application scope — substitute your project's scope.

---

## Core rule

| Record being changed | Goes into |
|---|---|
| Global-scope table (sys_ui_element, sys_ui_section, sys_ui_action in global, etc.) | **Global** update set |
| Scoped-app record (`x_acme_fm` table, or `x_acme_fm`-scoped artifact) | **`x_acme_fm`** update set |

The ACTIVE update set in the session must be in the matching scope for changes to land there. If the wrong update set is active, changes go to the Default update set and are lost from deployment — the PostToolUse capture-verifier hook reports which set captured each agent-API write; "captured in Default" = incident.

---

## Which tables go where

### Global scope (needs global update set)
- `sys_ui_element` — form layout (field positions). ⚠️ DELETEs of `sys_ui_element` rows are NOT tracked at all (verify on your instance first) → manual form cleanup per environment.
- `sys_ui_section` — form sections
- `sys_ui_related_list` / `sys_ui_list_control` — related list config
- `sys_ui_list` / `sys_ui_list_element` — list layouts. ⚠️ When written via the REST Table API (agent `create_artifact`), they orphan silently with zero `sys_update_xml` rows — force-add via `GlideUpdateManager2` (header → table-scope set, elements → global set). (Verify on your instance first.)
- `sys_translated_text` — translations of `translated_text` fields (e.g. `sys_ux_form_action.name`, `sys_declarative_action_assignment.label`). The table has **no `sys_scope`** and rides only a **global** set. Editing one while a scoped set is active captures NOTHING, and re-saving the parent doesn't help (its update XML carries the source language only). Fix: global companion set + force-add the rows; verify the target-language `<value>` (per `product.config.json` → `language.targets`) is in the `sys_update_xml` payload. Full pattern: `translate-workspace-ui` skill.
- `sys_ui_action` in global scope
- `sysevent_register` in global scope
- `sys_script_fix` in global scope

### Application scope (needs `x_acme_fm` update set)
- `sys_declarative_action_assignment`
- `sys_ux_form_action`, `sys_ux_form_action_layout_item`
- `sys_script_include`, `sys_script_client`, `sys_script` in `x_acme_fm` scope
- `sys_documentation` (field labels/translations)
- `sysevent_email_action` in `x_acme_fm` scope
- Any table with `sys_scope.scope = x_acme_fm`

### Not tracked by update sets at all (any scope)
- **Data tables** — `sys_user_group`, `sys_user`, `cmn_department`, group members, etc. do NOT auto-ride even with a story set active. To ship them: right-click → "Add to Update Set" per record/list, or force-add (see `update-set-workflow` Pattern C). Example: a rollout of ~40 assignment groups only ships if every group record is manually force-added — with the story set active they still capture nothing on their own.
- `sys_group_has_role` quirks (INSERTs in fix scripts track; DELETEs of pre-existing links don't): see the wiki's hard-rules page.
- `sysauto_script` (scheduled jobs) — manual per-environment rework.
- Attachments and user session data.

---

## Fix scripts — scope matters for TABLE ACCESS, not for update set capture

Fix scripts have two separate concerns:

| Concern | Rule |
|---|---|
| **Which tables can it read/write** | Must match the fix script's own scope. `sys_ui_element` = global table → fix script must be in global scope |
| **Which update set captures the changes IT MAKES** | Determined by the ACTIVE update set when the fix script runs, not the script's own scope |

**Common mistake:** creating a fix script in the app scope to update `sys_ui_element` → fails with `ScopeAccessNotGrantedException`.

**Correct pattern for global tables:**
```json
{ "command": "create_artifact", "params": {
  "table": "sys_script_fix",
  "scope": "global",
  "fields": { "name": "ACME - Fix <description>", "script": "...", "active": "true" }
}}
```
(Example name — use your project's artifact-name prefix.) Switch to the **global** update set first, then run.

---

## Diagnosing "changes not in update set"

1. The capture-verifier hook report after each agent-API write already names the capturing set — check it first.
2. Otherwise query `sys_update_xml` for the record's sys_id to find which set captured it:
   ```json
   { "query": "nameSTARTSWITHsys_ui_element_<sys_id>" }
   ```
3. Count = 0 → the write went to Default (wrong set active) or the table doesn't ride (see above).
4. Recovery: re-apply while the CORRECT set is active in the matching scope, or force-add — procedures in `update-set-workflow` Pattern C.

Update set sys_ids: keep them on the wiki's registry page — always verify per instance before use.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
