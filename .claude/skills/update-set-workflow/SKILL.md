---
name: update-set-workflow
description: This skill should be used when the user asks to "update set", "create update set", "switch update set", "change tracking", "force to update set", "orphaned records", "capture verification", "create something", "deploy", "build a feature", or starts any ServiceNow development that requires change tracking. This is the DOING skill — create the story-named set, switch, verify, recover orphans. For WHICH scope captures WHAT, use the update-set-scope-strategy skill.
---

# Update Set Workflow — the DOING skill

Procedures for creating, switching, verifying, and repairing update sets during a build.

**The rules themselves live elsewhere — don't re-derive them here:**

- **The project kernel (`CLAUDE.md`)** carries the full rule set: never Default, story-named sets, dual `switch_context`, verify capture, `setWorkflow(false)` suppression.
- **The wiki's hard-rules page** carries the mechanics, failure history, and recovery per rule.
- **The PostToolUse capture-verifier hook** auto-queries `sys_update_xml` after every agent-API config write and reports which update set captured it. Read its report every time — "captured in Default" = incident, fix immediately. The hook is fail-open (no port file / API down → silent), so when it says nothing, verify manually with the patterns below.
- **Which scope captures which table** (global vs scoped, `sys_ui_*` / `sys_translated_text` / data-table quirks): the `update-set-scope-strategy` skill.

## Create the story-named set(s)

- **Naming:** story-driven work uses
  ```
  <STORY-ID>.NN - <Story Short Description>
  ```
  Example: `STRY0001234.00 - Build Case Intake Form`. Use the story-id format of the customer's backlog tool (configure the prefix as a project convention). The name connects the artifacts to the story for documentation generation (`write-sn-documentation` skill).
- **`.NN` split convention:** number companion sets per scope and/or deployment phase — e.g. `.00` = the scoped-app set (example scope `x_acme_fm`), `.01` = the global companion; or `.00` = deployable core / `.01` = deferred content. Either ordering works — be consistent within a story. One set per scope touched: an update set only captures records in its own scope (see `update-set-scope-strategy`).
- **Description** on the update set is mandatory, written in the project's source language (`product.config.json` → `language.source`).
- Create via:
  ```json
  { "command": "create_artifact", "params": { "table": "sys_update_set",
    "scope": "<target_scope_sys_id>",
    "fields": { "name": "<STORY-ID>.NN - <title>", "state": "in progress",
                "description": "<description>" }}}
  ```

## Switch + write + verify (per-write loop)

1. `query_records` on `sys_update_set` to find the existing set (or create one as above)
2. `switch_context` with `switchType: "updateset"` — for tracking
3. `switch_context` with `switchType: "application"` (scope sys_id) — for transaction scope. Both switches are required for non-global work; skipping #3 = silent no-op (see the wiki's hard-rules page).
4. `create_artifact` / `update_record`
5. **Verify the mutation:** `query_records` on the target — `sys_updated_on` moved AND the field holds the new value. API "success" proves nothing.
6. **Verify capture:** read the capture-verifier hook report; if silent, run Pattern A below. Only `sys_update_xml` is proof — UI/DB presence is not.
7. When crossing a scope boundary mid-task, re-issue the application-scope switch (and switch to that scope's companion set).
8. After work: `get_last_error` to catch silent ACL failures.

## Capture verification via agent API

Update sets are a JOURNAL of tracked writes, not a snapshot of DB state. A record can exist in the DB and appear in zero update sets — e.g. a decision-table build can leave every question row and result-value row present and working in the instance while nothing was captured for deployment. The hook automates Pattern A per write; use these patterns for batches, hook-silent sessions, and post-hoc audits.

### Pattern A — verify a single record's capture

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_update_xml",
    "query": "update_set=<update_set_sys_id>^name=<table>_<record_sys_id>",
    "fields": "sys_id,name,action,type,target_name",
    "limit": 1
  }
}
```

Expect exactly one row with `action=INSERT_OR_UPDATE` (or `DELETE` if you deleted it). If `count=0`, the record is orphaned — recover with Pattern C.

### Pattern B — verify a batch (e.g. all questions on a decision table)

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_update_xml",
    "query": "update_set=<update_set_sys_id>^nameSTARTSWITHsys_decision_question_",
    "fields": "name,target_name,action,sys_created_on",
    "limit": 100,
    "orderBy": "ORDERBYsys_created_on"
  }
}
```

Cross-check the count against what you expect (e.g. N rule rows on the decision table). Any mismatch → orphans exist.

For decision tables specifically, the records to verify are:
- The header (`sys_decision_<sys_id>`)
- Each input column def (`sys_decision_input_<sys_id>`)
- Each output column def (`sys_decision_multi_result_element_<sys_id>`)
- Every rule row (`sys_decision_question_<sys_id>`) — expect N
- Every answer row (`sys_decision_multi_result_<sys_id>`) — expect N − 1 (the default has no answer)

### Pattern C — recover orphans

Via UI (human-driven):

1. Build a list view of the orphan records, filtered to the exact sys_ids you expect (e.g. `/sys_decision_question_list.do?sysparm_query=decision_table=<sys_id>`).
2. Select all rows → right-click → **Force to Update Set** → target the intended set.
3. Re-run Pattern A or B to confirm the rows now appear in `sys_update_xml`.

**Programmatic force-add: ONLY with an explicit `GlideUpdateSet().set('<set_sys_id>')` inside the script itself** (verified working on one instance — even a global bg script can `gus.set()` a scoped set and `saveRecord` a scoped header correctly; verify on your instance first). **⚠️ NEVER rely on the `switch_context` session switch for a bg-script force-add — it does not inherit.** Field-observed (verify on your instance first): the switch returned `"success": true`, but the bg-script force-add landed in **Default** anyway (bg scripts run in a session context that doesn't inherit the helper tab's active set). The classic list-view UI action (step 2 above) — **in the same browser tab whose set is active** — is the reliable route. Verify that tab's set by navigating to the target `sys_update_set.do?sys_id=…` directly rather than trusting the `switch_context` response; if the tab holds the wrong set, the classic UI errors with *"You are attempting to add a record to the system default update set…"* — a reliable tell. (The "Actions on selected rows…" dropdown is a plain `<select>` — drivable programmatically via `sel.value = …; sel.dispatchEvent(new Event('change', {bubbles:true}))`.)

Publishing/re-saving a parent record does NOT capture pre-existing unchanged child rows — force-add is the only remedy.

### Pattern D — captured as INSERT_OR_UPDATE, no DELETE anywhere, but gone from the instance

The inverse of an orphaned insert: a record that a past update set captured as `INSERT_OR_UPDATE`, that no longer exists on the current instance, and that has **no `DELETE` entry for it in any update set**. It was deleted at some point, but not while the right update set was active — so nothing tracked the removal. This is a real risk, not cosmetic, **if the original insert-capturing update set has already been promoted to a higher environment**: that environment still has the now-superseded record, with no update set anywhere that would remove it.

**Confirm it, don't just suspect it:**
```json
{ "command": "query_records", "params": { "table": "sys_update_xml",
  "query": "update_set=<old_set_sys_id>^nameLIKE<table>_", "fields": "name,target_name,action" } }
```
then for every sys_id found:
```json
{ "command": "query_records", "params": { "table": "<table>",
  "query": "sys_idIN<comma-separated sys_ids>", "fields": "sys_id" } }
```
Zero live hits + every capture for those sys_ids across `sys_update_xml` shows only `INSERT_OR_UPDATE` (never `DELETE`) confirms the pattern. Example: a set of declarative `catalog_ui_policy` records is superseded months later by rebuilt script-based versions of the same policies (same purpose, new sys_ids) — the old ones get deleted on the dev instance, but that delete is never captured anywhere, and the original build's update set (already in "complete" state) still shows only `INSERT_OR_UPDATE` for them.

**This cannot be fixed from the instance where the record is already gone** — there's nothing left to delete there, so no DELETE action can be generated. The actual fix has to happen wherever the stale copy still lives: delete it there directly, with the correct update set active on *that* environment. Before doing anything, check whether the original set was actually promoted at all — `state=complete` means "finished, ready to move," not "confirmed retrieved elsewhere." If it was never actually promoted, the stale copy never reached anywhere and there's nothing to fix.

### Verification refinements (field-proven — verify on your instance first)

- **Later-edit capture check:** the same `sys_update_xml` row is updated IN PLACE on every re-save while the set is open — `sys_created_on` stays frozen at first capture. To confirm a *later* edit landed, compare the row's **`sys_updated_on`** against when your edit happened.
- **Batch parents:** ServiceNow natively splits big sets into *Batch Child* sets under one `sys_update_set.parent`. Before calling a record "orphaned", query `parent=<candidate_parent_sys_id>` — the record may be captured in a sibling that ships with the family. Acting on a false "gap" causes unnecessary force-adds.
- **Collateral rows:** a shared set sometimes carries "unrelated" records. Check whether the live record's `sys_updated_on` predates the capture date — if so it was swept in unchanged (safe no-op on promotion), not a real edit needing cleanup.

## Known capture-suppression traps (pointers)

- **`setWorkflow(false)` / `setUseEngines(false)`** suppress capture entirely, even with the right scope + set active — rule and recovery on the wiki's hard-rules page.
- **Data tables (`sys_user_group`, `sys_user`, `cmn_department`, …), `sys_translated_text`, REST-written `sys_ui_list`/`sys_ui_list_element`** don't ride automatically — mapping and quirks in the `update-set-scope-strategy` skill; recovery is Pattern C here.

## Lifecycle

1. **In Progress** — active, receiving changes
2. **Complete** — ready for export/promotion (verify capture BEFORE completing)
3. **Ignore** — changes won't be promoted (experiments only)

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
