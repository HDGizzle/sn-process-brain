---
name: workspace-list-visibility
description: Invoke when the user mentions "workspace list", "list visibility", "sys_ux_list", "list category", "applicability", "workspace navigation", "menu config", or when configuring which lists appear for which roles in a configurable workspace.
---

# Workspace List Visibility

Build sidebar lists for a configurable workspace and control which roles see them. The visibility model is an M2M chain: list → applicability record → roles/conditions.

## Architecture

```
Menu Config (sys_ux_list_menu_config)          ← the workspace's list sidebar config
  └── Category (sys_ux_list_category)          ← sidebar group heading
       │   configuration → sys_ux_list_menu_config (REQUIRED!)
       └── List (sys_ux_list)                  ← individual list
            │   configuration → sys_ux_list_menu_config (REQUIRED!)
            │   category → sys_ux_list_category
            └── M2M Applicability (sys_ux_applicability_m2m_list)
                 │   list → sys_ux_list
                 └── applicability → sys_ux_applicability
                      ├── Roles
                      └── Conditions
```

## Key Tables

| Table | Purpose |
|-------|---------|
| `sys_ux_list_menu_config` | **The workspace's list menu configuration — MUST be referenced by both category and list** |
| `sys_ux_list_category` | Sidebar group heading — carries its own `configuration` reference |
| `sys_ux_list` | One list definition — needs BOTH `configuration` and `category` set |
| `sys_ux_applicability_m2m_list` | M2M joining a list to an applicability (fields: `list`, `applicability`, `active`) |
| `sys_ux_applicability` | The audience definition — roles and/or conditions |
| `sys_translated` | Label translations for list titles |

## CRITICAL: The `configuration` Field

`sys_ux_list` and `sys_ux_list_category` each carry a `configuration` reference that must point at the workspace's `sys_ux_list_menu_config` record. Leave it empty and the record saves fine — but the list never appears in the sidebar. This is the number-one cause of "invisible list" tickets.

Don't guess the menu-config sys_id — steal it from a list that already works in the same workspace:

```javascript
// Read the configuration value off any working list in this workspace
var gr = new GlideRecord('sys_ux_list');
gr.addQuery('table', '<any_table_with_working_lists>');
gr.addQuery('sys_scope.scope', '<your_scope>');
gr.setLimit(1);
gr.query();
if (gr.next()) {
    var CONFIG_ID = gr.getValue('configuration'); // ← use this for all new lists/categories
    gs.info('Configuration: ' + CONFIG_ID);
}
```

## Two Modes

- **Mode A — full creation:** new category plus its lists, M2M links, applicability, and translations, all from scratch.
- **Mode B — extend existing:** new lists only, attached to a category that already exists.

## Critical Rules

1. **Set scope in code.** Background scripts execute in global scope, so every inserted record needs `sys_scope` and `sys_package` assigned explicitly.
2. **`elementLabel` must equal the source text.** The `sys_translated` lookup matches on it; a mismatch means the translation is silently ignored.
3. **No M2M, no sidebar entry.** A list without its category/config wiring never renders.
4. **No applicability = visible to everyone.** Visibility restriction only exists once an applicability is linked.

## Applicability Pattern

```javascript
// Create or reuse applicability
function getOrCreateApplicability(name, roles, scopeId) {
    var gr = new GlideRecord('sys_ux_applicability');
    gr.addQuery('name', name);
    gr.query();
    if (gr.next()) {
        return gr.getUniqueValue();
    }

    gr.initialize();
    gr.setValue('name', name);
    gr.setValue('roles', roles);  // Comma-separated role sys_ids
    gr.sys_scope = scopeId;
    return gr.insert();
}
```

## List Creation Pattern

```javascript
var SCOPE_ID = '[SCOPE_SYS_ID]';
var CONFIG_ID = '[SYS_UX_LIST_MENU_CONFIG_SYS_ID]'; // REQUIRED — read from an existing list

// 1. Create the list (configuration + category are REQUIRED)
var list = new GlideRecord('sys_ux_list');
list.initialize();
list.setValue('title', 'My List Title');
list.setValue('table', 'incident');                 // example table
list.setValue('configuration', CONFIG_ID);  // ← CRITICAL: without this, list is invisible!
list.setValue('category', categoryId);      // ← CRITICAL: links to sidebar group
list.setValue('filter', 'active=true^priority=1');
list.setValue('columns', 'number,short_description,priority,state');
list.setValue('order_by', 'ORDERBYDESCsys_created_on');
list.sys_scope = SCOPE_ID;
list.sys_package = SCOPE_ID;
var listId = list.insert();

// 2. Link applicability (controls role-based visibility)
var m2mApp = new GlideRecord('sys_ux_applicability_m2m_list');
m2mApp.initialize();
m2mApp.setValue('list', listId);
m2mApp.setValue('applicability', applicabilityId);
m2mApp.sys_scope = SCOPE_ID;
m2mApp.insert();
```

## Translation Pattern

Target languages come from `product.config.json` → `language.targets`. Skip this section for single-language projects.

```javascript
function createTranslation(table, field, docId, lang, label, scopeId) {
    var gr = new GlideRecord('sys_translated');
    gr.addQuery('documentID', docId);
    gr.addQuery('language', lang);
    gr.addQuery('fieldName', field);
    gr.query();
    if (gr.next()) {
        gr.setValue('value', label);
        gr.update();
    } else {
        gr.initialize();
        gr.setValue('tableName', table);
        gr.setValue('fieldName', field);
        gr.setValue('documentID', docId);
        gr.setValue('language', lang);
        gr.setValue('value', label);
        gr.setValue('elementLabel', label);  // MUST match for lookup!
        gr.sys_scope = scopeId;
        gr.insert();
    }
}

// Usage: translate a list title into a target language (example)
createTranslation('sys_ux_list', 'title', listId, '<target_lang>', '<translated title>', SCOPE_ID);
```

## Complete Template

`references/template_workspace_list.js` is a full background-script template for both modes — category, lists, M2M links, applicability, and translations, driven entirely by the placeholder block at the top.

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| **List completely invisible** | **Missing `configuration` field** | **Set `configuration` on BOTH sys_ux_list AND sys_ux_list_category to the workspace's sys_ux_list_menu_config sys_id** |
| List not in sidebar group | Missing `category` on list | Set `category` field on sys_ux_list |
| List visible to wrong roles | Missing applicability M2M | Check sys_ux_applicability_m2m_list |
| Translation not working | elementLabel mismatch | Set elementLabel = source-language value |
| Wrong scope on records | Background script scope | Set sys_scope/sys_package explicitly |

## Checklist

- [ ] **`configuration` field set on category** (points to sys_ux_list_menu_config)
- [ ] **`configuration` field set on each list** (same sys_ux_list_menu_config)
- [ ] `category` field set on each list (points to its sys_ux_list_category)
- [ ] Category created with correct title and order
- [ ] Lists created with correct table, filter, columns
- [ ] Applicability M2M records (sys_ux_applicability_m2m_list) link lists to audience
- [ ] Translations created for source + every target language (per product.config.json)
- [ ] elementLabel matches the source-language value
- [ ] All records have correct sys_scope and sys_package

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
