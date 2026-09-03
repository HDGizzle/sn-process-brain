# Simple UI Action Buttons in Workspace (No Modal)

> Reference for the `workspace-modal-actions` skill. Read the skill's SKILL.md first for the field cheat sheet and the hard rules (layouts mandatory, action-config match, condition length).

When you only need a workspace button that runs a client script (e.g., `g_aw.openRecord` to open a new tab), you do NOT need the full declarative action payload/modal chain. Instead, use the **UI Action + Form Action registration** pattern.

All examples below use placeholder values — scope `x_acme_fm`, table `x_acme_fm_case`, prefix `ACME - `. Substitute your project's values (see `product.config.json`).

## When to Use This Pattern

- Button should open a new record in a workspace subtab (`g_aw.openRecord`)
- Button runs a simple client-side action (no modal needed)
- Button calls `g_form.submit()` or similar lightweight actions

## Architecture: Simple Button Chain

```
sys_ui_action                     → The actual button logic (client_script_v2)
        │
        ▼
sys_ux_form_action                → Wraps UI Action for workspace (action_type=ui_action)
        │
        ▼
sys_ux_form_action_layout_item    → Places button in a layout (action ref OR layout_group ref)
        │                                  label + table are MANDATORY
        ▼
sys_ux_m2m_action_layout_item     → M2M: links layout item ↔ layout
        │
        ▼
sys_ux_form_action_layout         → The button group container (usually pre-existing per table)
```

## Step 1: Create the UI Action

> **CRITICAL: `form_button_v2` MUST be `true`!** Without this, the UI Action will NOT appear on workspace forms AT ALL — not as a standalone button, not inside a dropdown group, nowhere. This is the #1 cause of "button doesn't show" issues. ALWAYS set `form_button_v2: true` on EVERY UI Action intended for workspace use.

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ui_action",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My Button",
      "table": "x_acme_fm_case",
      "client": "true",
      "form_button_v2": "true",
      "show_insert": "false",
      "show_update": "true",
      "active": "true",
      "order": "50",
      "condition": "gs.hasRole('my_role')",
      "client_script_v2": "function onClick(g_form) {\n    g_aw.openRecord('target_table', '-1', {\n        query: 'field=' + g_form.getUniqueValue()\n    });\n}"
    }
  }
}
```

**Key fields:**
- **`form_button_v2`**: **MUST be `true`** — this is what makes the UI Action visible in workspace. Without it, the button is invisible regardless of all other configuration.
- `client`: must be `true` for client-side actions
- `client_script_v2`: the workspace client script (uses `g_aw`, `g_form`, `g_modal`)
- `condition`: server-side condition (supports `current.*`, `gs.hasRole()`)

> **Hard rule — condition length.** `sys_ui_action.condition` truncates silently at its character limit and the truncated string can still parse as valid JS with the WRONG logic. Anything beyond a trivial expression goes into a Script Include method, called as a one-liner, e.g. `new x_acme_fm.CaseButtonUtil().canDoThing(current)` (example).

## Step 2: Register as UX Form Action

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My Button",
      "table": "x_acme_fm_case",
      "ui_action": "<ui_action_sys_id>",
      "action_type": "ui_action",
      "active": "true"
    }
  }
}
```

**Important:** `action_type` must be `ui_action` (not `uxf_client_action`).

## Step 3: Find the Existing Form Action Layout

Most tables already have a layout. Query first:

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_form_action_layout",
    "query": "table=x_acme_fm_case",
    "fields": "sys_id,label,table,active"
  }
}
```

If no layout exists, create one (its `action_config` MUST match the workspace's `actionConfigId` page property — see `references/form-action-layouts.md`):

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action_layout",
    "scope": "x_acme_fm",
    "fields": {
      "name": "ACME - Buttons - x_acme_fm_case",
      "table": "x_acme_fm_case",
      "active": "true"
    }
  }
}
```

## Step 4: Create Layout Item

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action_layout_item",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My Button",
      "action": "<form_action_sys_id>",
      "label": "My Button",
      "table": "x_acme_fm_case",
      "order": "50"
    }
  }
}
```

## Step 5: Create M2M Link

> **The `variant` field (button color/style) is set HERE on the M2M record, NOT on the layout item!** The `color` field on `sys_ux_form_action_layout_item` does NOT control workspace button appearance.

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_m2m_action_layout_item",
    "scope": "x_acme_fm",
    "fields": {
      "name": "my_button_m2m",
      "ux_form_action_layout": "<layout_sys_id>",
      "ux_form_action_layout_item": "<layout_item_sys_id>",
      "table": "x_acme_fm_case",
      "order": "50",
      "variant": "secondary"
    }
  }
}
```

**Variant options:** `primary`, `primary-positive`, `primary-negative` (red/destructive), `secondary` (default), `secondary-negative`, `tertiary`

## Complete Agent API Workflow

```
1. create_artifact → sys_ui_action        → get ui_action_sys_id
2. create_artifact → sys_ux_form_action   → get form_action_sys_id (refs ui_action)
3. query_records   → sys_ux_form_action_layout → get layout_sys_id (or create)
4. create_artifact → sys_ux_form_action_layout_item → get layout_item_sys_id (refs form_action)
5. create_artifact → sys_ux_m2m_action_layout_item  → links layout ↔ layout_item
```

## Common g_aw Methods for Workspace Client Scripts

```javascript
// Open existing record in new subtab
g_aw.openRecord('table_name', 'sys_id');

// Open NEW record with pre-populated fields
g_aw.openRecord('table_name', '-1', {
    query: 'field1=value1^field2=value2'
});

// Close current tab
g_aw.closeRecord();
```

## Simple vs Modal Pattern Decision

| Need | Pattern | Complexity |
|------|---------|------------|
| Open record in new tab | **Simple UI Action** (this file) | Low - 5 records |
| Run client script, no navigation | **Simple UI Action** (this file) | Low - 5 records |
| Group multiple buttons in a dropdown | **Split Button / Dropdown** (`references/form-action-layouts.md`) | Medium - 7+ records |
| Show form in modal overlay | **Declarative Action + Modal** (`references/declarative-action-chains.md`) | High - 10+ records |
| Custom modal with non-form content | **Declarative Action + Custom Macroponent** | Very High |
