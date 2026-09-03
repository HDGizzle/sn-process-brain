---
name: workspace-activity-stream
description: Invoke when wiring journal fields (work_notes / comments) into the workspace contextual side panel instead of the form body — "activity stream workspace", "journal in side panel", "work notes side panel", "viewport_gph", "Tab sidebar workspace", "move work notes to sidebar", "side panel missing activity", "activity stream not rendering".
---

# Workspace Activity Stream — wiring journal into the side panel

A default configurable-workspace form often shows journal fields (work_notes / comments) inline in the form body. The pattern in this skill moves them OUT of the form body and INTO the right-side activity stream — the same experience as the OOTB Incident workspace. This needs THREE layers aligned. Get any one wrong and journals disappear entirely.

> ⚠️ **The three layers are independent.** A view rule alone won't work without the macroponent structure AND the form layout entries. Symptom mismatch is common: rule active but no effect → check the macroponent. Macroponent has activity_stream but the panel is blank → check the form layout.

## Non-negotiables

- **All three layers required.** Macroponent (UI shell) + Classic UI Form Layout (data wiring) + View Rule (visibility control). Missing any one means the journal won't render in the side panel.
- **Comparison source:** the OOTB Incident workspace. Query `sys_ux_screen` / `sys_ux_macroponent` on your instance for the "Incident Record" macroponent and use its structure as the known-good reference when wiring a new table.
- **Activity Stream component sys_id:** `821dfc11da1d0fb007579ccb53738fd5` (OOTB — verify on your instance). Referenced by macroponents that render the stream.
- **NEVER edit macroponent JSON by API.** Use UI Builder. Composition JSON can be 270KB+ and is easy to break silently (see the workspace-modal-actions skill).
- **The `activity.xml` formatter on the workspace form view is what populates the stream.** Without it, the activity_stream component renders empty even when the macroponent is correct.

## The 3 Layers

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1 — Macroponent (sys_ux_macroponent)              │
│ The UI shell. Contains:                                  │
│  • stackable_side_by_side_panel (form left, stream right)│
│     ├─ form                                              │
│     ├─ activity_stream_compose                           │
│     └─ activity_stream                                   │
│  • viewport_gph (Tab sidebar — contextual side panel)    │
│     ├─ Details   ├─ RelatedList   ├─ Agent assist        │
│     ├─ Attachment ├─ Template                             │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│ Layer 2 — Classic UI Form Layout (sys_ui_section)       │
│ The data wiring. Workspace form view of the table needs:│
│  • activity.xml formatter (drives the stream component)  │
│  • work_notes field                                      │
│  • comments field (if needed)                            │
│ Add via Configure → Form Layout → switch to workspace    │
│ view in classic UI.                                       │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│ Layer 3 — View Rule (sysrule_view_workspace)            │
│ The visibility control. Optional but recommended:        │
│  • hide_journal_input_fields = true                      │
│  • view = "Default view"  ← NOT empty, NOT "NULL"        │
│  • Linked (M2M) to your workspace's view rules config    │
│ Without this, journal renders inline AND in the side     │
│ panel (duplicated).                                      │
└─────────────────────────────────────────────────────────┘
```

Plus a fourth concern (security): **field-level ACLs** on `<table>.work_notes` for the roles that need access. OOTB `task.work_notes` requires `itil` — custom workspace personas typically don't have it. See the `acl-security` skill.

## How to wire a new table for activity stream

Examples below use placeholder scope `x_acme_fm` and table `x_acme_fm_case` — substitute your own.

### Step 1 — Pick / verify the macroponent

The screen for the table (`sys_ux_screen`) references a macroponent. Check it has BOTH `viewport_gph` and `activity_stream` components:

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_screen",
    "query": "name=<Your Record screen name>",
    "fields": "sys_id,name,macroponent,macroponent.name"
  }
}
```

Then grep the macroponent's `composition` field for `viewport_gph` and `activity_stream`. If both are present, Layer 1 is done. If not, point the screen at a macroponent that has them (query your instance for one — e.g. the Incident Record macroponent, or a generic "Standard Record"-style macroponent your workspace already ships), OR clone such a macroponent for table-specific work.

**Sanity check elementIds you should see in a working macroponent:**

| ElementId | Purpose |
|---|---|
| `stackable_side_by_side_panel` | Main body layout (form left, stream right) |
| `form` | The form itself (left pane) |
| `activity_stream` | Feed of journal entries (right pane stack) |
| `activity_stream_compose` | Compose box for new entries (right pane stack) |
| `viewport_gph` | "Tab sidebar" = the contextual side panel (right strip) |
| 5 hash-named IDs | The tabs in viewport_gph: Details, RelatedList, Agent assist, Attachment, Template |

The `viewport_gph` wires tab clicks to the SRP UI controller via the `srp_sidebar_list_tab_selected` event mapping (operation `SRP_UI_CTRL#HANDLE_UXF_TAB_SET#TAB_SELECTED`; the dataBrokerId is instance-specific — read it from a working macroponent on your instance). Don't edit this wiring.

### Step 2 — Add work_notes + activity.xml to the workspace form view

This is a **manual step in classic UI** — the agent API can't reliably edit form layouts:

1. Navigate to the table in classic UI
2. Open a record → top-right hamburger → **Configure → Form Layout**
3. Switch the view selector to the **workspace** view (top of the form layout editor)
4. From the Available list, drag in:
   - `Work notes` (journal_input)
   - `Activities` (activity.xml formatter) — usually appears as "Activities" in the formatter list, NOT under the field list
   - Optionally `Additional comments` (journal_input)
5. Save

**Verify the result:** query `sys_ui_element` for the section:

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ui_element",
    "query": "sys_ui_section.name=x_acme_fm_case^sys_ui_section.view.name=workspace^elementINactivity.xml,work_notes,comments",
    "fields": "sys_id,element,position"
  }
}
```

Should return rows for `activity.xml` and `work_notes`.

### Step 3 — Create the view rule

Use the `workspace-view-rules` skill — but the canonical pattern is:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sysrule_view_workspace",
    "scope": "<your app scope sys_id>",
    "fields": {
      "name": "ACME - Hide journal on form case",
      "table": "x_acme_fm_case",
      "view": "Default view",
      "hide_journal_input_fields": "true",
      "active": "true",
      "order": "100",
      "experience_restricted": "true",
      "default_tab_order": "true"
    }
  }
}
```

Then create the M2M to your workspace's view rules configuration. Find its sys_id first — query `sys_ux_view_rule_configuration` (or open an existing rule's M2M) for the config record belonging to your workspace:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_m2m_workspace_view_rule_ux_view_rule_config",
    "scope": "<your app scope sys_id>",
    "fields": {
      "name": "ACME - case journal hide rule",
      "workspace_view_rule": "<sysrule_view_workspace_sys_id>",
      "view_rules_configuration": "<your workspace view rules config sys_id>"
    }
  }
}
```

> ⚠️ **`view = "Default view"` is mandatory.** Empty or `"NULL"` makes the rule silently fail. See the `workspace-view-rules` skill.

### Step 4 — Field-level ACLs on work_notes

OOTB `task.work_notes` field-level READ/WRITE ACLs require `itil`. Custom workspace personas usually don't have `itil`. Without overriding, the activity stream renders but those users see no journal entries.

Pattern: create two field-level ACLs on `<your_table>.work_notes` granting your application roles. Example for `x_acme_fm_case.work_notes`:

```json
// READ ACL — application roles can see existing entries
{
  "table": "sys_security_acl",
  "fields": {
    "name": "x_acme_fm_case.work_notes",
    "operation": "read",
    "active": "true",
    "advanced": "false",
    "admin_overrides": "true"
  }
}
```

Then add `sys_security_acl_role` rows for `x_acme_fm.workspace_user` and any other relevant application roles.

```json
// WRITE ACL — assignee writes on their own open record
{
  "table": "sys_security_acl",
  "fields": {
    "name": "x_acme_fm_case.work_notes",
    "operation": "write",
    "active": "true",
    "advanced": "false",
    "admin_overrides": "true",
    "condition": "assigned_toDYNAMIC90d1921e5f510100a9ad2572f2b477fe^stateNOT IN3,4,7^EQ"
  }
}
```

The `90d1921e5f510100a9ad2572f2b477fe` dynamic filter is the OOTB "assigned to me" / "Me" constant (OOTB — verify on your instance). The state values in the condition are an example — substitute your table's closed states. Gating WRITE to the assignee on open records only keeps the journal privacy-safe: users can only add notes to their own active work.

See the `acl-security` skill for OR/AND semantics and OOTB-extension patterns.

## Debug Recipes

### Symptom: journal renders inline on the form, not in the side panel

Cause: View rule missing, inactive, or its `view` field is empty/`"NULL"` instead of `"Default view"`.

Check:
```json
{
  "command": "query_records",
  "params": {
    "table": "sysrule_view_workspace",
    "query": "table=x_acme_fm_case^active=true",
    "fields": "sys_id,name,view,hide_journal_input_fields,active"
  }
}
```

Then verify the M2M row linking the rule to your workspace's view rules configuration exists.

### Symptom: side panel exists but activity stream tab/component is blank

Cause: Form view missing the `activity.xml` formatter and/or the `work_notes` field.

Check:
```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ui_element",
    "query": "sys_ui_section.name=x_acme_fm_case^sys_ui_section.view.name=workspace",
    "fields": "element,position"
  }
}
```

Add via classic UI → Configure → Form Layout → workspace view.

### Symptom: a non-itil workspace persona sees no journal entries (but admin does)

Cause: OOTB `task.work_notes` READ ACL requires `itil`. The persona lacks `itil`.

Fix: Create a field-level READ ACL on `<your_table>.work_notes` granting your workspace base role (e.g. `x_acme_fm.workspace_user`) so every persona that inherits it can read the journal.

### Symptom: macroponent has activity_stream but it renders nowhere visible

Cause: The macroponent uses `stackable_side_by_side_panel` but the activity_stream is parented to the wrong slot, OR `viewport_gph` is missing entirely.

Fix: compare the macroponent's elementId tree against a known-good macroponent on your instance (e.g. the OOTB Incident Record macroponent). If `viewport_gph` is absent, restructure in UI Builder — don't patch JSON via API.

## Checklist for a new table

- [ ] **Layer 1** — Screen's macroponent has `viewport_gph` + `activity_stream` + `activity_stream_compose` + `stackable_side_by_side_panel`. Compare the elementId list against a known-good macroponent on your instance.
- [ ] **Layer 2** — Workspace form view has the `activity.xml` formatter + `work_notes` field. Manual step in classic UI Configure → Form Layout.
- [ ] **Layer 3** — `sysrule_view_workspace` with `hide_journal_input_fields=true`, `view="Default view"` (not empty), linked via M2M to your workspace's view rules configuration.
- [ ] **Security** — Field-level READ + WRITE ACLs on `<table>.work_notes` granting the roles you want (OOTB default requires `itil`).
- [ ] **Test as a non-itil persona** — Hard refresh (Ctrl+Shift+R) the workspace tab. Confirm journal visible in side panel, NOT in form body, with the right read+write permissions.

## Related skills

- `workspace-view-rules` — full mechanics of the `sysrule_view_workspace` table
- `workspace-modal-actions` — overlapping warning about not editing macroponent JSON via API
- `acl-security` — extending OOTB field ACLs vs. creating parallel ones
- `translate-workspace-ui` — if any new side-panel tab needs translated labels

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
