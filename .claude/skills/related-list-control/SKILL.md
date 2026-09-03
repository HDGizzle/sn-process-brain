---
name: related-list-control
description: Invoke when the user asks to "omit new button related list", "hide new button related list", "list control", "sys_ui_list_control", "omit_new", "omit_edit", "omit_delete", or when configuring button visibility on related lists in classic or workspace views.
---

# Related List Control — Omitting Buttons (New / Edit / Delete)

Suppressing related list buttons requires **two separate mechanisms** — one for classic UI, one for workspace. They are completely independent.

| Surface | Table | Key field |
|---|---|---|
| Classic UI | `sys_ui_list_control` | `omit_new`, `omit_edit`, `omit_delete` |
| Workspace (Next Experience) | `sys_declarative_action_assignment` | `enabled = false` |

**`sys_ui_list_control.omit_new` has zero effect in workspace.** Always configure both if both surfaces are used.

---

## Key insight — name is the PARENT table, not the child

The `name` field on `sys_ui_list_control` is the **parent** (containing) table, not the related list's table.

```
Parent record: x_acme_fm_case                      (example)
  └── Related list: Tasks (x_acme_fm_task)
  └── Related list: Reviews (x_acme_fm_review)

sys_ui_list_control.name = "x_acme_fm_case"   ← the PARENT table
sys_ui_list_control.related_list = <identifies the specific list>
```

---

## Finding the `related_list` value

The `related_list` field format depends on how the related list is defined:

### Format 1 — `sys_relationship` based (custom relationship)
```
REL:<sys_relationship_sys_id>
```

**How to find it:** Open the parent record in classic view, right-click the related list header → Configure → List Control. The URL will contain `related_list=REL:<sys_id>`.

Or query `sys_relationship` to find the relationship sys_id:
```json
{
  "command": "query_records",
  "params": {
    "table": "sys_relationship",
    "query": "sys_scope.scope=<your_scope>^nameLIKE<list name fragment>",
    "fields": "sys_id,name"
  }
}
```

### Format 2 — Field-based (simple reference field)
```
<child_table>.<reference_field>
```
Example: `x_acme_fm_review.u_parent_case` (reviews linked to the case via `u_parent_case`).

**How to find it:** Right-click the related list header in classic view → Configure → List Control. The URL will contain `related_list=<table>.<field>`.

---

## How to create the list control record

`create_artifact` fails for `sys_ui_list_control` due to table constraints. Always use a **fix script**:

```javascript
var lc = new GlideRecord('sys_ui_list_control');
lc.initialize();
lc.setValue('name', 'x_acme_fm_case');                 // parent table (example)
lc.setValue('related_list', 'REL:<sys_id>');           // from URL or query
lc.setValue('omit_new', true);                         // hide New button
lc.setValue('omit_edit', false);                       // keep Edit button
lc.setValue('omit_delete', false);                     // keep Delete button
var id = lc.insert();
gs.info('List control created: ' + id);
```

---

## Available omit fields

| Field | Effect |
|---|---|
| `omit_new` | Hides the **New** button on the related list |
| `omit_edit` | Hides inline **Edit** capability |
| `omit_delete` | Hides the **Delete** button |

---

## Finding the `related_list` value from the browser

The fastest way is to navigate to the parent record in classic view, right-click the related list header, and select **Configure > List Control**. The URL will contain:

```
sys_ui_list_control.do?sys_id=-1&sysparm_query=name=<parent_table>^related_list=<value>
```

`sys_id=-1` means no record exists yet — it's a new record form pre-filled with the correct values. Copy those values into the fix script.

---

## Workspace — Omitting the New button via `sys_declarative_action_assignment`

Classic `sys_ui_list_control` does not affect workspace. The workspace renders related list buttons through **Declarative Action Assignments** with model = **Related List**.

### How to find the record

Navigate to: `sys_declarative_action_assignment_list.do` and filter:
- Action Name = `create-new-uxf`
- Action Model = Related List
- Table = `<child table>` (e.g. `x_acme_fm_task`)

Or query:
```json
{
  "command": "query_records",
  "params": {
    "table": "sys_declarative_action_assignment",
    "query": "action_name=create-new-uxf^model=d91731a9534723003eddddeeff7b121c^table=<child_table>",
    "fields": "sys_id,action_name,table,active,enabled"
  }
}
```

`d91731a9534723003eddddeeff7b121c` = the "Related List" model definition sys_id (OOTB — verify on your instance).

### If the record exists — disable it

```json
{
  "command": "update_record_batch",
  "params": {
    "table": "sys_declarative_action_assignment",
    "sys_id": "<sys_id>",
    "fields": { "active": "true", "enabled": "false" }
  }
}
```

### If no record exists — create one

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_declarative_action_assignment",
    "scope": "<scope_sys_id>",
    "fields": {
      "name": "<record_prefix>Disable New button <child_table>",
      "action_name": "create-new-uxf",
      "table": "<child_table>",
      "model": "d91731a9534723003eddddeeff7b121c",
      "active": "true",
      "enabled": "false",
      "label": "New"
    }
  }
}
```

`scope` is the application scope's **sys_id**, never the scope name string. `<record_prefix>` follows the project naming convention (`naming.recordPrefix` in product.config.json, e.g. "ACME - ").

### Critical: `active` vs `enabled`

| Field | Meaning | Correct value |
|---|---|---|
| `active` | Whether the DA record exists in the system | **`true`** — always keep active |
| `enabled` | Whether the button is shown in workspace | **`false`** — this hides the button |

Setting `active = false` deactivates the record entirely (wrong). Only `enabled = false` hides the button.

---

## Pitfalls

| Pitfall | Fix |
|---|---|
| Querying `sys_ui_list_control` with the child table in `name` returns nothing | Use the PARENT table name (e.g. `name=x_acme_fm_case`, not the child) |
| `create_artifact` on `sys_ui_list_control` returns "Operation Failed" | Use a fix script with `GlideRecord.insert()` instead |
| Record not found via API despite URL showing it exists | The URL with `sys_id=-1` means no record exists yet — it's a create form |
| `sys_relationship` not found for a workspace tab | Workspace-only lists use field-based format (`table.field`), not `REL:` format |
| `sys_ui_list_control.omit_new` set but New still shows in workspace | Classic-only — also configure `sys_declarative_action_assignment` with `enabled = false` |
| Set `active = false` on DA assignment but button still shows | Wrong field — set `active = true` + `enabled = false` instead |
| No DA record found for the child table | Create one with `create_artifact` using `active = true`, `enabled = false` |

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
