---
name: custom-related-lists
description: Invoke when the user asks to "create related list", "custom related list", "scripted relationship", "defined related list", "show grandchild records", "hierarchical related list", "flatten hierarchy related list", "related list from different table", or when building a related list that crosses table hierarchy levels.
---

# Scripted Relationships (Custom Related Lists)

A standard related list can only follow one direct foreign-key reference. When the records to show are grandchildren, siblings, reachable only via an intermediate table, or selected by arbitrary logic, the mechanism is a **scripted relationship** on the `sys_relationship` table.

## When to use

| Scenario | Standard related list | Scripted relationship |
|---|---|---|
| Direct children (one reference hop) | Yes | No |
| Grandchildren / deep descendants | No | **Yes** |
| Siblings (records sharing a parent) | No | **Yes** |
| Linked through an intermediate table | No | **Yes** |
| Unrelated table + custom selection logic | No | **Yes** |

Scripted relationships live on **`sys_relationship`** — not on `sys_ui_related_list` / `sys_ui_related_list_entry` (those configure standard related lists).

## Critical fields

| Field | Type | Meaning |
|---|---|---|
| `name` | String | The related-list tab label (source language) |
| `basic_apply_to` | Table name **string** | The table whose form SHOWS the related list |
| `basic_query_from` | Table name **string** | The table whose records are DISPLAYED |
| `query_with` | Script | The refineQuery script that selects the records |
| `advanced` | Boolean | Must be `false` when using the `basic_*` fields |

### THE TRAP: `basic_apply_to` / `basic_query_from` vs `apply_to` / `query_from`

```
basic_apply_to   = plain table name string, e.g. "x_acme_fm_case"
basic_query_from = plain table name string, e.g. "x_acme_fm_action"

NOT:
apply_to     = sys_id reference to sys_db_object   (advanced-mode field — wrong here)
query_from   = sys_id reference to sys_db_object   (advanced-mode field — wrong here)
```

The un-prefixed fields belong to advanced mode and take `sys_db_object` sys_ids. Mixing them up produces a relationship that saves without error and never appears anywhere. Always: **`basic_*` fields + table-name strings + `advanced=false`**.

## The refineQuery script

Every scripted relationship wraps its logic like this:

```javascript
(function refineQuery(current, parent) {
    // current = GlideRecord on the basic_query_from table (the rows to display)
    // parent  = the record whose form is being viewed

    current.addQuery('some_field', parent.sys_id);
})(current, parent);
```

Note the inverted meaning versus Business Rules: here `current` is the **result set being filtered** (queries-from table), and `parent` is the on-screen record — use `parent.sys_id`, `parent.getValue('field')`, etc.

Recommended naming: give every additional GlideRecord variable a name of `gr` + the table/role it queries (`grAction`, `grParentAction`, `grCase`) rather than bare `gr` or vague `grChild` — hierarchy-walking scripts juggle several cursors and readable names prevent cross-wiring. Record any stricter project convention in the Customer Project Rules section.

## Patterns

The examples below use a neutral pair of tables: `x_acme_fm_case` (the parent record) and `x_acme_fm_action` (actions that reference their case via a `case` field and each other via `parent`). Substitute your own tables and reference fields.

### Pattern 0: direct children only (no tree walk)

If only the direct children are needed, `current` already IS the queries-from cursor — one filter suffices, no loop:

```javascript
(function refineQuery(current, parent) {
    // Only the direct sub-actions of the action being viewed
    current.addQuery('parent', parent.getUniqueValue());
})(current, parent);
```

Only reach for the walk patterns below when you genuinely need ancestors or deep descendants.

### Pattern 1: walk UP a hierarchy (find the ancestor)

Climb `parent` references until a record that carries the case reference is found:

```javascript
(function refineQuery(current, parent) {
    var caseId = parent.getValue('case');
    if (!caseId) {
        var actionParent = parent.getValue('parent');
        while (actionParent) {
            var grParentAction = new GlideRecord('x_acme_fm_action');
            if (grParentAction.get(actionParent)) {
                var parentCase = grParentAction.getValue('case');
                if (parentCase) {
                    caseId = parentCase;
                    break;
                }
                actionParent = grParentAction.getValue('parent');
            } else {
                break;
            }
        }
    }
    if (caseId) {
        current.addQuery('sys_id', caseId);
    } else {
        current.addQuery('sys_id', 'INVALID');
    }
})(current, parent);
```

### Pattern 2: walk DOWN a hierarchy (all descendants, iterative BFS)

Collect every descendant with a cursor-based breadth-first walk — **iterative, never recursive** (recursion risks stack overflow on deep trees):

```javascript
(function refineQuery(current, parent) {
    // Step 1: direct children of the case
    var directIds = [];
    var grDirectAction = new GlideRecord('x_acme_fm_action');
    grDirectAction.addQuery('case', parent.sys_id);
    grDirectAction.query();
    while (grDirectAction.next()) {
        directIds.push(grDirectAction.getUniqueValue());
    }

    // Step 2: BFS down the tree — the array doubles as the queue
    var allIds = directIds.slice();
    var cursor = 0;
    while (cursor < allIds.length) {
        var grSubAction = new GlideRecord('x_acme_fm_action');
        grSubAction.addQuery('parent', allIds[cursor]);
        grSubAction.query();
        while (grSubAction.next()) {
            allIds.push(grSubAction.getUniqueValue());
        }
        cursor++;
    }

    // Step 3: filter the displayed set
    if (allIds.length > 0) {
        current.addQuery('sys_id', 'IN', allIds.join(','));
    } else {
        current.addQuery('sys_id', 'INVALID');
    }
})(current, parent);
```

### Pattern 3: siblings (same ancestor, excluding self)

Combine Pattern 1 (find the ancestor) with Pattern 2 (collect its descendants), then drop the viewed record:

```javascript
var idx = allIds.indexOf(parent.getUniqueValue());
if (idx > -1) {
    allIds.splice(idx, 1);
}
```

…and apply the same `IN` / `INVALID` tail as Pattern 2.

### Pattern 4: records from another table via the ancestor

Find the ancestor with Pattern 1, then filter the (different) queries-from table on it:

```javascript
if (caseId) {
    current.addQuery('case', caseId);
} else {
    current.addQuery('sys_id', 'INVALID');
}
```

## Empty-result idiom

When nothing should be shown:

```javascript
current.addQuery('sys_id', 'INVALID');
```

Never use `addQuery('sys_id', '')` or skip the query entirely — an unfiltered `current` displays **every record in the table**.

## Creating via the agent API

### Step 1: scope + update set first

1. Confirm the target application scope with the user — the relationship must live in the right scope.
2. Dual switch_context (update set AND application) before any write — see the wiki's hard-rules page.
3. Put **all** functional fields in the **initial** `create_artifact` payload — see pitfall 1.

### Step 2: create (example payload)

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_relationship",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "My Related List Name",
      "basic_apply_to": "<table_where_list_appears>",
      "basic_query_from": "<table_whose_records_are_shown>",
      "query_with": "(function refineQuery(current, parent) {\n    // your script here\n})(current, parent);"
    }
  }
}
```

### Step 3: translate the label

For each target language in `product.config.json` (`language.targets`), create a `sys_translated_text` row keyed on the relationship's sys_id:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_translated_text",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "<lang>_<source name>",
      "documentkey": "<relationship_sys_id>",
      "fieldname": "name",
      "language": "<lang>",
      "tablename": "sys_relationship",
      "value": "<translated label>"
    }
  }
}
```

### Step 4: add to the form

This part is manual, by the user:

1. Open any record of the `basic_apply_to` table.
2. Right-click the form header (classic) or banner (workspace) → **Configure > Related Lists**.
3. Move the relationship name to the **Selected** side and save.

## Pitfalls

1. **`basic_apply_to` / `basic_query_from` MUST be in the initial create payload.** In some scope configurations the API accepts a create without them but leaves the fields empty, and cross-scope ACLs then block the follow-up update. If a relationship was created without them, delete it and recreate — do not try to patch it.
2. **Create in the correct scope, first time.** Relationships created in `global` cannot be updated from a scoped-app context (ACL rejection); relationships over scoped tables belong in that app's scope. Check `get_last_error` after every write.
3. **Table-name strings, not sys_ids** — see the trap section above; it is the number-one silent failure on this table.
4. **Iterative BFS, never recursion**, for hierarchy walks (Pattern 2 is the safe template).
5. **Scripted related lists have NO New/Edit buttons.** Platform limitation in both classic and workspace: users can open the listed records but cannot create records from the list.
6. **Workspace visibility is a second gate.** After Configure > Related Lists, verify the list actually renders in workspace; if not, check the workspace view rules (`sysrule_view_workspace` — see the workspace-view-rules skill).
7. **`basic_apply_to` and table hierarchy.** Pointing it at a parent table makes the list available on all extending tables; pointing it at one child limits it to that child. Choose deliberately.
8. **Verify after creation.** Query the record back and confirm `basic_apply_to`, `basic_query_from`, and `sys_scope`:

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_relationship",
    "query": "sys_id=<new_sys_id>",
    "fields": "sys_id,name,basic_apply_to,basic_query_from,sys_scope"
  }
}
```

## Checklist

1. [ ] Target scope confirmed with the user
2. [ ] Dual switch_context done (update set + application)
3. [ ] `clear_last_error` before the write
4. [ ] Created with ALL fields in the initial payload (`name`, `basic_apply_to`, `basic_query_from`, `query_with`)
5. [ ] Read back: `basic_apply_to` / `basic_query_from` populated
6. [ ] Read back: `sys_scope` correct
7. [ ] Label translations created for configured target languages
8. [ ] `get_last_error` checked for silent failures
9. [ ] User informed to add the list via Configure > Related Lists (and to verify workspace visibility)

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
