# Form Action Layouts, Split Buttons & Layout Resolution

> Reference for the `workspace-modal-actions` skill. Covers the layout resolution chain (layouts-mandatory + action-config hard rules), the split button / dropdown (layout group) pattern, hiding/removing buttons, and production lessons learned.

Examples use placeholder values — scope `x_acme_fm`, table `x_acme_fm_case`, prefix `ACME - `. Substitute your project's values.

## CRITICAL: How the Workspace Resolves Form Action Layouts

**This is the #1 source of bugs.** If the form action layout doesn't resolve, buttons fall back to raw UI Actions with NO error or indication. Understanding this chain is essential.

### The Resolution Chain

```
sys_ux_page_registry (Workspace Experience)
    │
    │  has UX Page Property: "actionConfigId" = <sys_id>
    ▼
sys_ux_action_config (Action Configuration)
    │
    │  The form action layout's "action_config" field MUST match this sys_id
    ▼
sys_ux_form_action_layout (per table)
    │  action_config = <must match workspace's actionConfigId>
    │  table = <specific table>
    │  Matched by BOTH action_config + table
    ▼
Layout renders split buttons, groups, custom ordering
```

### How to Find Your Workspace's Action Config ID

**This is the FIRST thing to check before creating any form action layout.**

```
1. Query the workspace experience:
   table: sys_ux_page_registry
   query: title=<your workspace name>
   → get sys_id

2. Query the page property:
   table: sys_ux_page_property
   query: page=<experience_sys_id>^name=actionConfigId
   → the "value" field = the action config sys_id your layouts MUST reference

3. Set your form action layout's action_config to THIS value
```

**Example:**
- Experience: `<experience_sys_id>`
- Page property `actionConfigId`: `<action_config_sys_id>`
- ALL form action layouts for tables in that workspace MUST have `action_config = <action_config_sys_id>`

### Common Mistake: Wrong Action Config

If there are MULTIPLE `sys_ux_action_config` records in the same scope (e.g., one OOB and one custom), the form action layout MUST reference the one from the workspace's `actionConfigId` page property — NOT the custom one, unless you also update the page property.

**Symptoms of wrong action config:**
- Form action layout exists, items exist, M2Ms exist, everything looks correct
- But the workspace ignores the layout entirely and renders raw UI Actions
- Deactivating M2M records has NO effect (layout isn't being consulted)
- No error messages anywhere

**Diagnosis:** Query `sys_ux_page_property` for `name=actionConfigId` on your workspace. Compare the `value` with your layout's `action_config`. If they don't match, that's your problem.

---

## Dropdown / Split Button Pattern (Layout Groups)

When you need a primary action button with a dropdown chevron revealing additional sub-actions (like in Service Operations Workspace), use the **Layout Group** pattern. This is how split Save/Save-and-Close buttons on workspace forms are built.

### What it looks like

A split button shows:
- **Left side**: Primary action (clicking executes it directly)
- **Right side (chevron)**: Opens dropdown with additional actions

The underlying component is `now-split-button` from ServiceNow's Horizon Design System.

### Architecture: Split Button Chain

```
sys_ui_action (or sys_declarative_action_assignment)   → Individual action logic
        │
        ▼
sys_ux_form_action                                      → Wraps each action for workspace
        │
        ▼
sys_ux_form_action_layout_group                         → Groups actions into split button
        │                                                  type=1 (Split Action)
        │                                                  actions = comma-separated form_action sys_ids
        ▼
sys_ux_form_action_layout_item                          → Places the GROUP in a layout
        │                                                  item_type = "group" (MUST set explicitly!)
        │                                                  layout_group = layout_group sys_id
        ▼
sys_ux_m2m_action_layout_item                           → M2M: links layout item ↔ layout
        │                                                  icon, variant, display_type, order
        ▼
sys_ux_form_action_layout                               → The button group container (per table)
```

### Key Table: `sys_ux_form_action_layout_group`

| Field | Type | Description |
|-------|------|-------------|
| `name` | string (required) | Display name (e.g., "Assignment Actions") |
| `table` | table_name (required) | Target table (e.g., `x_acme_fm_case`) |
| `type` | choice (required) | `0` = Menu, **`1` = Split Button** |
| `actions` | glide_list | Comma-separated `sys_ux_form_action` sys_ids |
| `active` | boolean | Active flag |

**Action order matters**: First sys_id in the `actions` list = primary button (visible). Remaining = dropdown items, in list order.

### Step-by-Step: Creating a Split Button

#### Step 1: Create the individual actions

Create 2+ UI Actions (or Declarative Actions), each as a simple workspace button following the standard chain (see `references/simple-buttons.md`).

> **`form_button_v2: true` is MANDATORY for every UI Action in the group.** If even one action has `form_button_v2: false`, it won't appear in the dropdown.

#### Step 2: Create UX Form Action records for each

UI Actions created via API do NOT auto-create `sys_ux_form_action` records. You must create them manually:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My Action",
      "table": "x_acme_fm_case",
      "ui_action": "<ui_action_sys_id>",
      "action_type": "ui_action",
      "active": "true"
    }
  }
}
```

**Note**: If using Declarative Actions instead of UI Actions, set `action_type` to `declarative_action` and use the `declarative_action` field (ref to `sys_declarative_action_assignment`) instead of `ui_action`.

#### Step 3: Create the Layout Group (the split button)

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action_layout_group",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My Actions Dropdown",
      "table": "x_acme_fm_case",
      "type": "1",
      "active": "true",
      "actions": "<form_action_1_sys_id>,<form_action_2_sys_id>,<form_action_3_sys_id>"
    }
  }
}
```

- `type`: **`1`** = Split Button, `0` = Menu (dropdown only, no primary action)
- `actions`: Comma-separated list. **First = primary button**, rest = dropdown items

#### Step 4: Create the Layout Item pointing to the GROUP

**Critical fields**:
- `item_type`: **Must be `group`** (default is `action` — if you don't set this, the layout item expects an `action` reference and ignores `layout_group`)
- `layout_group`: Reference to the layout group sys_id
- `label` and `table`: **Mandatory** fields

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_form_action_layout_item",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My dropdown layout item",
      "item_type": "group",
      "layout_group": "<layout_group_sys_id>",
      "label": "My Dropdown Label",
      "table": "x_acme_fm_case",
      "order": "25",
      "active": "true"
    }
  }
}
```

#### Step 5: Create the M2M record (CRITICAL — this is what actually makes it visible)

**This is the record that shows up in the related list on the Form Action Layout.** Without it, the button will NOT appear.

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_m2m_action_layout_item",
    "scope": "x_acme_fm",
    "fields": {
      "name": "My dropdown M2M",
      "ux_form_action_layout": "<layout_sys_id>",
      "ux_form_action_layout_item": "<layout_item_sys_id_from_step_4>",
      "order": "25",
      "active": "true"
    }
  }
}
```

The `ux_form_action_layout` is the existing layout for your table (e.g., "ACME - Buttons - x_acme_fm_case").

### `sys_ux_m2m_action_layout_item` Field Reference

This M2M record controls the **visual presentation** of the button/group in the toolbar.

| Field | Type | Description |
|-------|------|-------------|
| `ux_form_action_layout` | reference (required) | The layout this item belongs to |
| `ux_form_action_layout_item` | reference (required) | The layout item (action or group) |
| `order` | integer | Position in the toolbar |
| `active` | boolean | Active flag |
| `icon` | reference → `st_sys_design_system_icon` | Icon displayed on the button. Use the icon's sys_id (e.g., `save_outline`, `user_fill`, `share_fill`) |
| `animate_icon` | boolean | Whether the icon animates on click |
| `variant` | string | Button variant (e.g., `primary`, `secondary`) |
| `display_type` | string | `0` = Button, `1` = Overflow menu |
| `table` | table_name | Target table |

**Icon reference**: Icons come from `st_sys_design_system_icon`. The sys_id equals the icon name with underscores (e.g., `save_outline`, `user_fill`, `user_group_outline`, `arrow_up_fill`). Query: `query_records` on `st_sys_design_system_icon` with `nameLIKE<keyword>`.

### `sys_ux_form_action_layout_item` Field Reference

| Field | For `item_type=action` | For `item_type=group` |
|-------|----------------------|---------------------|
| `item_type` | `action` (default) | **`group`** (must set explicitly!) |
| `action` | Required — ref to `sys_ux_form_action` | Not used |
| `layout_group` | Not used | Required — ref to `sys_ux_form_action_layout_group` |
| `label` | **Mandatory** — button label | **Mandatory** — group label |
| `table` | **Mandatory** — target table | **Mandatory** — target table |
| `name` | **Mandatory** — internal name | **Mandatory** — internal name |
| `order` | Button position | Group position |

### Complete Agent API Workflow (Split Button)

```
1. create_artifact → sys_ui_action (×N)              → get ui_action_sys_ids
2. create_artifact → sys_ux_form_action (×N)          → get form_action_sys_ids (refs ui_actions)
3. query_records   → sys_ux_form_action_layout        → get layout_sys_id (usually pre-existing)
4. create_artifact → sys_ux_form_action_layout_group  → get group_sys_id (type=1, actions=form_action_ids)
5. create_artifact → sys_ux_form_action_layout_item   → get layout_item_sys_id (item_type=group, layout_group=group_sys_id, label+table MANDATORY)
6. create_artifact → sys_ux_m2m_action_layout_item    → links layout ↔ layout_item (MAKES IT VISIBLE)
```

### Conditions & Visibility

Each individual action (UI Action or Declarative Action) has its own condition. If a condition evaluates to false, that action hides from the dropdown. If ALL actions in a split button group are hidden, the entire split button disappears. (Conditions longer than a trivial expression → Script Include method — see the condition-length hard rule in SKILL.md.)

### Split Button vs Menu

| Type Value | Behavior | Use Case |
|------------|----------|----------|
| `1` (Split Button) | Primary action on left, dropdown on right | When there's a clear default action |
| `0` (Menu) | No primary action, only dropdown | When all actions are equally important |

### Navigation Path (Manual Creation)

`Now Experience Framework > Actions and Events > UX Form Action Groups` navigates to `sys_ux_form_action_layout_group`.

### Replacing an Existing OOB "Save" Button with a Split Button

When a table already has buttons rendered from the form action layout (e.g., a standalone "Save"), adding a split button group requires **deactivating the old standalone M2M** to prevent duplicates:

1. Query M2M records for the layout: `ux_form_action_layout=<layout_sys_id>^ux_form_action_layout_item.label=Save`
2. Identify the OOB standalone Save M2M (item_type=action)
3. **Deactivate** it (set `active=false`) — don't delete, in case you need to revert
4. Create your new group M2M with `variant=primary`

If you skip this, you get a **duplicate Save button** — one from the layout (standalone) and one from your group.

### Form Action → UI Action Reference Must Be Active

Each `sys_ux_form_action` references a `sys_ui_action` via the `ui_action` field. If that UI Action is **inactive**, the form action silently fails to render. The split button will show the dropdown items whose UI Actions are active, but skip the ones with inactive references.

**If you have duplicate UI Actions** (e.g., two "Save" actions for the same table, one active and one inactive), make sure the `sys_ux_form_action` points to the **active** one. Check with:
```
table: sys_ui_action
query: name=Save^table=<your_table>
fields: sys_id,name,active
```

### `use_layout_items_only` (Unify Actions)

| Value | Behavior |
|-------|----------|
| `false` (default) | Layout items shown PLUS auto-inherited global UI Actions |
| `true` (unified) | ONLY explicit layout items shown — no auto-inheritance |

**After clicking "Unify actions" on a layout, `use_layout_items_only` becomes `true`.** This is irreversible. From this point, any NEW UI Actions must be manually added as layout items. Existing ones are copied into the layout.

For split buttons, you typically want `use_layout_items_only=true` to have full control over button ordering and grouping.

### Troubleshooting Split Buttons

1. **Layout completely ignored (buttons come from UI Actions)**: Check that `action_config` on the layout matches the workspace's `actionConfigId` page property. This is the #1 cause — see the resolution chain above.
2. **Button doesn't appear — `form_button_v2` not set**: Every UI Action in the group MUST have `form_button_v2=true`. Without it, the action is invisible in workspace — the entire group disappears if all its actions have this missing.
3. **Button doesn't appear — missing M2M**: Check the `sys_ux_m2m_action_layout_item` record exists. The related list on the Form Action Layout must show your item.
4. **Button doesn't appear — wrong item_type**: The layout item `item_type` defaults to `action`. For groups, you **must** explicitly set `item_type=group`. Without this, the item expects an `action` reference and ignores `layout_group`.
5. **Button doesn't appear — missing mandatory fields**: `label` and `table` are mandatory on the layout item. Without them the record is invalid.
6. **Button doesn't appear — inactive UI Action reference**: The `sys_ux_form_action` points to a `sys_ui_action` that is `active=false`. Check the `ui_action` reference field.
7. **Duplicate buttons**: An OOB standalone Save M2M is still active alongside your new group M2M. Deactivate the OOB one.
8. **Split button shows but chevron/group not rendering**: The group renders as separate buttons if the form action layout isn't being used (see #1). When the layout IS used, the `sys_ux_form_action_layout_group` with `type=1` controls the chevron grouping.
9. **Dropdown is empty**: Check that the `actions` glide_list on the layout group contains valid `sys_ux_form_action` sys_ids.
10. **Wrong order in dropdown**: Reorder the sys_ids in the `actions` field on the layout group. First = primary, rest = dropdown order.
11. **Group shows but actions don't execute**: Check the underlying UI Actions or Declarative Actions are active and have correct scripts.
12. **M2M variant keeps resetting**: The `active` field on `sys_ux_m2m_action_layout_item` defaults to `false`. When updating a single field via API (e.g., `variant`), some update methods may reset `active` to its default. Use `update_record_batch` to set both fields atomically, or verify `active=true` after updating. (Verify on your instance first.)

### Pre-Flight Checklist: Before Creating Split Buttons

Run this checklist BEFORE creating any split button records:

```
□ 1. Find workspace actionConfigId:
     sys_ux_page_property where page=<experience> and name=actionConfigId
     → Record the value

□ 2. Verify form action layout exists for your table:
     sys_ux_form_action_layout where table=<your_table> and action_config=<from step 1>
     → If not exists, create one with the CORRECT action_config

□ 3. Verify UI Actions are active and have form_button_v2=true:
     sys_ui_action where table=<your_table> and name=Save
     → Check active=true, form_button_v2=true

□ 4. Verify form actions reference ACTIVE UI Actions:
     sys_ux_form_action where table=<your_table>
     → Check ui_action field points to an active sys_ui_action

□ 5. Check for existing standalone Save M2M on the layout:
     sys_ux_m2m_action_layout_item where ux_form_action_layout=<layout>
     and ux_form_action_layout_item.label=Save
     → Plan to deactivate these after creating the group
```

---

## Hiding or Removing an Existing Workspace Button

When a previously-rendered workspace button needs to disappear (deactivated UI Action / form action / M2M), the deactivation may seem to "not work" after deploy — **the button keeps rendering** even though `sys_ui_action.active=false` is correctly applied in the target instance.

**Root cause: workspace layout caching, not the deactivation itself.** The form action layout chain is heavily cached in the workspace runtime; an already-rendering button keeps appearing in open browser tabs until the cache is busted.

**Confirmed in production (verify on your instance first):** a `sys_ui_action.active=false` change was pushed via update set and applied cleanly to the target (XML verified `<active>false</active>`), but the button still rendered in the open workspace tab. **A hard refresh resolved it instantly** — no other record changes needed.

### After deploy — mandatory cache-bust

After applying any update set that deactivates a workspace button (or any layout / form action change), in the target instance:
- **Hard-refresh** the workspace tab (Ctrl+Shift+R / Cmd+Shift+R). Soft refresh (F5) is NOT enough.
- If you have other browser tabs open on the same workspace, hard-refresh those too — they each cache independently.
- For users actively in-session, they'll need to hard-refresh on their end. Plan deploys around this if many users are active.

### When deactivating, do it cleanly

The button's render chain has multiple gates. Any of these set to `active=false` is sufficient to hide the button (after cache-bust):

| Table | Field | Comment |
|---|---|---|
| `sys_ui_action` | `active` | Standard. Also keeps classic UI in sync. |
| `sys_ux_form_action` | `active` | The workspace wrapper. |
| `sys_ux_m2m_action_layout_item` | `active` | The placement record on the layout. |

**Pick one — pick `sys_ui_action.active=false`** as the primary gate (it covers both classic and workspace). The wrapper / M2M deactivation is overkill unless you specifically want to keep the underlying UI Action available for other surfaces.

**Don't delete** any of these — keep them inactive so re-activation is a single field flip if requirements change. Cascade behaviour on `sys_ux_form_action` deletion is footgun-heavy (see the Cascade Deletion warning in SKILL.md).

### If hard-refresh doesn't fix it

Then it's actually a data problem, not a cache problem. Investigate:
- **Was the deactivation captured in the deployed update set?** Non-`sys_metadata` tables aren't tracked. `sys_ui_action` IS tracked; `sys_ui_annotation` is not. Verify by querying `sys_update_xml` for the record in the target update set.
- **Did the change make it to the target instance?** Query the target's record state directly — don't trust "I committed the set."
- **Is there a separate active form_action wrapper pointing at a different (still-active) ui_action?** Query `sys_ux_form_action` by `name` or by `ui_action` — duplicates happen and one of them may be the one rendering.

---

## Lessons Learned: Split Button Implementation (Production)

This section documents every mistake made during a real implementation of split Save/Save-and-Close buttons across three related tables in one scoped app. Each lesson cost hours of debugging.

### Lesson 1: Wrong Action Config (THE #1 killer)

**What happened:** Created form action layouts pointing to a custom `sys_ux_action_config` created in the app scope. The workspace's `actionConfigId` page property pointed to a different, OOB-shipped config. The layouts were completely invisible — the workspace never consulted them.

**Symptoms:** Buttons rendered from UI Actions. Deactivating M2M records had zero effect. Cache flushing didn't help. No errors anywhere.

**Time wasted:** Hours investigating macroponent composition, DA assignments, client scripts, and cache mechanisms — all the wrong places.

**Fix:** Changed `action_config` on all three layouts to match the workspace's page property value.

**Prevention:** ALWAYS query `sys_ux_page_property` for `actionConfigId` BEFORE creating layouts. See the Pre-Flight Checklist above.

### Lesson 2: Inactive UI Action Reference

**What happened:** A `sys_ux_form_action` (Save) pointed to an inactive `sys_ui_action`. There were TWO Save UI Actions for the table — one active, one inactive. The form action referenced the wrong one.

**Symptoms:** Split button rendered but Save was missing — only "Save and Close" showed. No error.

**Fix:** Updated the `sys_ux_form_action.ui_action` reference to point to the active `sys_ui_action`.

**Prevention:** Always verify `sys_ui_action.active=true` for the referenced UI Action. Check for duplicates: `sys_ui_action where name=Save^table=<your_table>`.

### Lesson 3: Duplicate OOB Save M2M Not Deactivated

**What happened:** The form action layout already had an OOB standalone "Save" layout item linked via M2M. After adding the split button group, both rendered — a standalone Save (filled) and the group Save (outlined).

**Symptoms:** Two Save buttons on the form. One had the chevron, one didn't.

**Fix:** Deactivated the OOB standalone Save M2M (`active=false`).

**Prevention:** Before adding a split button group, query existing M2M records: `ux_form_action_layout=<layout>^ux_form_action_layout_item.label=Save`. Deactivate any standalone Save M2Ms.

### Lesson 4: M2M Variant Not Set to Primary

**What happened:** Created the split button group M2M but forgot to set `variant=primary`. The button rendered as secondary (outlined) instead of primary (filled).

**Fix:** Updated M2M `variant` to `primary`.

**Prevention:** Always set `variant=primary` when creating the group M2M.

### Lesson 5: Translation Mechanism (sys_translated_text vs sys_translated)

**What happened:** Created `sys_translated` records to translate form action names. These are wrong — `sys_ux_form_action.name` is a `translated_text` field type that uses `sys_translated_text` (record-specific by `documentkey`/sys_id), NOT `sys_translated` (global value-match).

**Symptoms:** Translations didn't apply. Translated text never appeared on form action names.

**Fix:** Created `sys_translated_text` records with correct `documentkey`, `tablename`, `fieldname`. Had to use a background script because `create_artifact` can't create records on tables without a `name` field.

**Prevention:** See `references/translations.md`. Check field type before choosing translation mechanism.

### Lesson 6: Don't Touch the Macroponent Composition

**What happened:** Attempted to fix buttons by modifying the macroponent's Action Bar properties (`daClientActionContract`, `actionNodes`, `daModel`) directly in the composition JSON. This broke the action bar completely — it disappeared.

**Key learning:**
- `daClientActionContract: null` = use default resolution (UI Actions + form action layout)
- `daClientActionContract: {}` = explicit override that may blank out actions if DA chain isn't complete
- `actionNodes` override = replaces the default data binding with a script
- `daModel` override = replaces the default model resolution
- **Removing or changing ANY of these from their OOB values can break the action bar with no way to debug**

**Fix:** Restored macroponent to original OOB state. Fixed the actual problem (wrong `action_config`).

**Prevention:** NEVER modify macroponent composition to fix button issues. The problem is almost always in the form action layout chain (wrong action_config, inactive references, missing M2Ms). Fix the data, not the UI component.

### Lesson 7: Multiple Tables May Share Layout Items

When creating form action layouts for multiple tables in the same workspace, the layout items (`sys_ux_form_action_layout_item`) can be shared across layouts via M2M. But each table needs its OWN:
- `sys_ui_action` (table-specific)
- `sys_ux_form_action` (table-specific, references the table-specific UI Action)
- `sys_ux_form_action_layout_group` (table-specific, references table-specific form actions)
- `sys_ux_form_action_layout_item` (can be shared but `table` field must match)
- `sys_ux_m2m_action_layout_item` (links item to the table-specific layout)

### Summary: The Correct Order of Operations

```
1. FIND the workspace's actionConfigId (sys_ux_page_property)
2. CREATE or VERIFY the form action layout with correct action_config + table
3. CREATE UI Actions (form_button_v2=true, active=true)
4. CREATE form actions (referencing ACTIVE UI Actions)
5. CREATE layout group (type=1, actions=form_action_sys_ids in order)
6. CREATE layout item (item_type=group, layout_group=group_sys_id)
7. DEACTIVATE any existing standalone Save M2M on the layout
8. CREATE group M2M (variant=primary, active=true)
9. CREATE translations (sys_translated_text for form action names)
10. TEST — hard refresh the workspace form
```
