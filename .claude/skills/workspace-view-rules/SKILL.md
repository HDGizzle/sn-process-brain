---
name: workspace-view-rules
description: Invoke when the user asks to "hide journal fields", "hide work notes from form", "workspace view rules", "sysrule_view_workspace", "default tab focus", "tab order", "hide section menu", "hide details", or when configuring workspace form display rules.
---

# Workspace View Rules

Configure how configurable-workspace forms display: hide journal fields from the form body (while keeping them in the activity stream sidebar), control default tab focus, tab order, section collapse behavior, and more.

## Architecture

```
UX View Rules Configuration (sys_ux_view_rules_configuration)
  └── Workspace View Rules (related list)
       └── sysrule_view_workspace
            ├── Table filter
            ├── Form Settings (hide_journal_input_fields, hide_details, etc.)
            ├── Tab Settings (default_tab_focus, tabs_order)
            └── View override script
  └── M2M (sys_ux_m2m_workspace_view_rule_ux_view_rule_config)
       (created automatically when adding view rules via related list)
```

## Key Tables

| Table | Purpose |
|-------|---------|
| `sys_ux_view_rules_configuration` | Container record — linked to workspace UX Application |
| `sysrule_view_workspace` | Individual view rule with form/tab settings per table |
| `sys_ux_m2m_workspace_view_rule_ux_view_rule_config` | M2M linking view rules to configuration (auto-created) |

## How It Works

The `sys_ux_view_rules_configuration` is linked to a workspace's UX Application via the `viewRuleConfigId` page property. Each workspace typically already has one — **find and reuse it; do not create a second configuration**. You add `sysrule_view_workspace` records to its related list, one per table/view combination.

**Important:** The M2M record (`sys_ux_m2m_workspace_view_rule_ux_view_rule_config`) is created **automatically** when you add a view rule via the related list. Do NOT create it manually in that flow. (Only when inserting the rule via script or API do you create the M2M yourself — see Creation Pattern.)

**Always set the table filter.** A `sysrule_view_workspace` with an empty table filter applies globally to every table in the workspace — scope each rule to the table it is meant for.

## Hard rule: `view` must be `"Default view"` — NOT empty, NOT `"NULL"`

The `view` column on `sysrule_view_workspace` is a **name reference** to a `sys_ui_view` record. Passing the literal string `"NULL"` (or leaving the field empty) stores nothing, and the rule **silently fails to apply** — e.g., journal fields keep rendering on the form body with no error anywhere. The OOTB default view is literally named `"Default view"`, and that string is the value that must be stored.

## Common Use Case: Hide Journal Fields from Form

Journal fields (work_notes, comments) appear on both the form body AND the activity stream sidebar. To show them ONLY in the sidebar:

1. Find the existing `sys_ux_view_rules_configuration` for your workspace
2. Add a `sysrule_view_workspace` with `hide_journal_input_fields = true` for the target table

**What does NOT work:**
| Approach | Problem |
|----------|---------|
| Remove journal fields from form view/layout | Removes them from sidebar too |
| UI Policy to hide journal fields | Hides from both form AND compose |
| Form section visibility | Same issue as UI Policy |

## Available Form Settings

| Field | Type | Purpose |
|-------|------|---------|
| `hide_journal_input_fields` | Boolean | Hide work_notes/comments from form body, keep in activity stream sidebar |
| `hide_details` | Boolean | Hide the Details section on the form |
| `hide_section_menu` | Boolean | Hide the section navigation menu |
| `disable_section_collapse` | Boolean | Prevent users from collapsing form sections |
| `default_tab_focus` | String | Which tab to focus by default (e.g., "Details") |
| `default_tab_order` | Boolean | Use default tab ordering |
| `tabs_order` | JSON | Custom tab order as JSON array |
| `experience_restricted` | Boolean | Restrict to workspace experience only |

## Finding the Existing Configuration

Before creating anything, find the existing view rules configuration for your workspace:

```javascript
// Find existing view rules configurations in a scope
var gr = new GlideRecord('sys_ux_view_rules_configuration');
gr.addQuery('sys_scope', 'SCOPE_SYS_ID');
gr.addQuery('active', true);
gr.query();
while (gr.next()) {
    gs.info('Config: ' + gr.getValue('name') + ' | sys_id: ' + gr.getUniqueValue());
}
```

Or via the agent API:
```json
{
    "command": "query_records",
    "params": {
        "table": "sys_ux_view_rules_configuration",
        "query": "sys_scope=SCOPE_SYS_ID^active=true",
        "fields": "sys_id,name,description"
    }
}
```

## Creation Pattern

All names and tables below are examples — substitute your own scope (example: `x_acme_fm`), table (example: `x_acme_fm_case`), and naming prefix (example: `ACME - `).

### Via Background Script (ES5)

```javascript
var CONFIG_SYS_ID = '[existing_config_sys_id]';  // Find this first!
var SCOPE_ID = '[scope_sys_id]';

// 1. Create the workspace view rule
var rule = new GlideRecord('sysrule_view_workspace');
rule.initialize();
rule.setValue('name', 'ACME - Hide journal fields from form');  // example name
rule.setValue('table', 'x_acme_fm_case');             // example table — always set this
rule.setValue('view', 'Default view');                // Name of the sys_ui_view — NOT 'NULL', NOT empty (see hard rule above)
rule.setValue('hide_journal_input_fields', true);
rule.setValue('active', true);
rule.setValue('order', 100);
rule.setValue('experience_restricted', true);         // Workspace only
rule.setValue('default_tab_order', true);
rule.sys_scope = SCOPE_ID;
rule.sys_package = SCOPE_ID;
rule.setWorkflow(false);
var ruleId = rule.insert();

// 2. Create the M2M link to the configuration
var m2m = new GlideRecord('sys_ux_m2m_workspace_view_rule_ux_view_rule_config');
m2m.initialize();
m2m.setValue('workspace_view_rule', ruleId);
m2m.setValue('view_rules_configuration', CONFIG_SYS_ID);
m2m.sys_scope = SCOPE_ID;
m2m.sys_package = SCOPE_ID;
m2m.setWorkflow(false);
m2m.insert();

gs.info('Created view rule: ' + ruleId);
```

Note: `setWorkflow(false)` suppresses update-set capture — if the records must ship in an update set, force-add them afterwards and verify capture.

### Via Agent API (create_artifact)

```json
{
    "command": "create_artifact",
    "params": {
        "table": "sysrule_view_workspace",
        "scope": "[scope_sys_id]",
        "fields": {
            "name": "ACME - Hide journal fields from form",
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

**Note:** When using create_artifact, you still need to create the M2M link. Use a background script or a second create_artifact call for the M2M table. Alternatively, create the rule via the platform UI related list, which handles the M2M automatically.

## Custom Tab Order

To control which tabs appear and in what order:

```javascript
rule.setValue('default_tab_order', false);
rule.setValue('tabs_order', JSON.stringify([
    {"label": "Details", "value": "Details"},
    {"label": "Related Items", "value": "REL:sys_id_of_related_list"},
    {"label": "Child Table Tab", "value": "child_table.parent_field"}
]));
```

Tab value formats:
- `"Details"` — the main Details tab
- `"child_table.reference_field"` — a related list tab (e.g., `x_acme_fm_case_task.parent_case`)
- `"REL:sys_id"` — a specific related list definition

## View Override Script

The script field allows dynamic view overrides:

```javascript
(function overrideView(view) {
    // Return view name to use, or null for default
    // Example: use a different view for VIP callers
    if (current.caller_id.vip == 'true') {
        return 'vip_view';
    }
    return null;
})(view);
```

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| Journal fields still on form | Rule not linked to config | Check M2M record exists |
| Journal fields gone from sidebar too | Removed from form layout | Use view rule instead, keep fields in layout |
| Rule has no effect | Wrong table or view | Verify table name and view match |
| **Rule silently doesn't fire — `hide_journal_input_fields=true` but journal still on form** | **`view` field is empty or set to literal `"NULL"`** | **Set `view = "Default view"` (string). See hard rule above.** |
| Rule not applying | Inactive or wrong scope | Check active=true and correct sys_scope |
| Rule applies to unintended tables | Table filter left empty (rule is workspace-global) | Set the table field on the rule |
| Tabs not reordering | default_tab_order=true | Set to false and provide tabs_order JSON |

## Checklist

- [ ] Found existing `sys_ux_view_rules_configuration` for the workspace (never created a duplicate)
- [ ] Created `sysrule_view_workspace` with correct table and settings
- [ ] `view` set to `"Default view"` (not empty, not "NULL")
- [ ] M2M record exists linking rule to configuration
- [ ] Rule is active and in correct scope
- [ ] Tested: journal fields hidden from form but visible in activity stream sidebar

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
