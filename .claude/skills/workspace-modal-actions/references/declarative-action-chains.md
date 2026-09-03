# Declarative Action Chains (Button → Modal)

> Reference for the `workspace-modal-actions` skill. Covers the full DA chain: payload definition → DA assignment → M2M → form action → layout item → event mapping → route. Modal content/view specifics live in `references/modal-views.md`.

Examples use placeholder values — scope `x_acme_fm`, table `x_acme_fm_case`. The worked example (a "Resolve case" modal) is illustrative; substitute your project's values.

## Architecture Overview: The Complete Chain

```
User clicks button on form
        │
        ▼
┌─────────────────────────────────┐
│  UX Form Action                 │  sys_ux_form_action
│  (visible button definition)    │  - label, icon, variant
│  references ──────────────────────► Declarative Action Assignment
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  UX Form Action Layout          │  sys_ux_form_action_layout
│  (button group container)       │  - name, table
│  contains layout items ─────────│
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  UX Form Action Layout Item     │  sys_ux_form_action_layout_item
│  (button position in group)     │  - order, form_action reference
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Declarative Action Assignment  │  sys_declarative_action_assignment
│  (wires button to behavior)     │  - action_name, table, condition
│  ├── client_action ─────────────│──► Payload Definition
│  ├── model ─────────────────────│──► "Form" (360935e9...)
│  ├── declarative_action_type ───│──► "uxf_client_action"
│  └── form_position ─────────────│──► "action_bar"
└─────────────────────────────────┘
        │
        ├──── M2M ────────────────────► Action Config
        │     sys_ux_m2m_action_       sys_ux_action_config
        │     assignment_action_config (groups actions for a workspace)
        │
        ▼
┌─────────────────────────────────┐
│  Payload Definition             │  sys_declarative_action_payload_definition
│  (what happens when clicked)    │  - payload_template (JSON)
│  - route: "sowformmodalv2"      │  - action_key
│  - fields: {table, sysId, ...}  │  - applicable_to → Form model
│  - params: {modalTitle, ...}    │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Event Mapping                  │  sys_ux_addon_event_mapping
│  (routes DA to modal open)      │  - source_da → DA assignment
│  - maps to RECORD#OPEN_MODAL   │  - event_name
│  - on workspace record page     │  - parent_macroponent
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  UX App Route                   │  sys_ux_app_route
│  (route_type: sowformmodalv2)   │  - fields: "table,sysId,title"
│  - maps to Screen Type          │  - DO NOT add "view" to fields!
│  - screen_type reference        │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Screen Type → Screen           │  sys_ux_screen_type → sys_ux_screen
│  (which macroponent to render)  │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Custom Macroponent             │  sys_ux_macroponent
│  (the modal content)            │  - Contains Glide Form data resource
│  ├── Data Resources             │  - forcedViewName (NOT view!)
│  │   └── glide_form_1           │  - table, sysId from route props
│  ├── State Properties           │
│  │   └── hideLoader: false      │  - Controls spinner visibility
│  └── Components                 │
│      └── Form component         │
└─────────────────────────────────┘
```

## Key Tables Reference

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `sys_ux_form_action` | Visible button definition | `label`, `icon`, `variant`, `declarative_action` |
| `sys_ux_form_action_layout` | Button group container | `name`, `table`, `active` |
| `sys_ux_form_action_layout_item` | Button position in group | `order`, `form_action`, `layout` |
| `sys_declarative_action_assignment` | Wires button to behavior | `action_name`, `client_action`, `model`, `table`, `condition`, `declarative_action_type`, `form_position`, `specificity` |
| `sys_declarative_action_payload_definition` | Defines what happens on click | `payload_template`, `action_key`, `applicable_to`, `label` |
| `sys_declarative_action_payload_field` | Individual fields in payload template | `target_name`, `payload_definition` |
| `sys_declarative_action_payload_mapping` | Maps payload def to model | `payload_definition`, `model` |
| `sys_ux_addon_event_mapping` | Routes DA event to action | `source_da`, `event_name`, `parent_macroponent` |
| `sys_ux_m2m_action_assignment_action_config` | Links DA to workspace action config | `action_assignment`, `action_configuration` |
| `sys_ux_action_config` | Groups actions for a workspace | `name` |
| `sys_ux_app_route` | URL route mapping | `route_type`, `fields`, `screen_type`, `optional_parameters` |
| `sys_ux_screen_type` | Screen collection | Links to screen and macroponent |
| `sys_ux_screen` | Screen definition | References macroponent |
| `sys_ux_macroponent` | Custom component definition | JSON blob with data resources, components, state, events |
| `sys_ux_client_script` | Client-side scripts for UX | Script that runs in workspace context |

## Declarative Action Implementation Types

| Type | Use Case | Notes |
|------|----------|-------|
| **UXF Client Action** | Opens modals, navigates, dispatches events | Most common for workspace buttons. Dispatches JSON payload. |
| **Client Script** | Runs UI Action-style script client-side | Like classic UI Actions but in workspace context. |
| **Server Script** | Runs UI Action-style script server-side | Executes on the server, can use GlideRecord etc. |

For opening modals, **always use UXF Client Action**. The other types are for simpler actions that don't need modal UI.

---

## Step-by-Step: Creating a Workspace Button That Opens a Modal

### Prerequisites
- A workspace with an action config (`sys_ux_action_config`) — MUST be the one from the workspace's `actionConfigId` page property (see `references/form-action-layouts.md`)
- A form view created on your target table
- The route `sowformmodalv2` available (check `sys_ux_app_route`)

### Step 1: Create the Form View (Manual in ServiceNow)

Go to your target table → Form Layout → New View:
1. Name: `my_custom_modal_view` (lowercase, underscores)
2. Add only the fields you want in the modal
3. Save

This creates records in:
- `sys_ui_view` (the view definition)
- `sys_ui_section` (the form layout for that view)

### Step 2: Create or Verify the Custom Macroponent

The macroponent defines the modal content. If you already have one (e.g., from a previous modal), you can reuse it by changing `forcedViewName`. See `references/modal-views.md` for the full macroponent configuration (forcedViewName as JSON_LITERAL, hideLoader).

### Step 3: Create the Payload Definition

```json
// Table: sys_declarative_action_payload_definition
{
  "action_key": "MY_ACTION_PAYLOAD",
  "label": "My Action Payload",
  "applicable_to": "360935e9534723003eddddeeff7b127d",
  "payload_template": "{\"route\":\"sowformmodalv2\",\"size\":\"lg\",\"fields\":{\"table\":\"x_acme_fm_case\",\"sysId\":\"{{sysId}}\"},\"params\":{\"saveLabel\":\"Save\",\"isGFormSave\":true,\"modalTitle\":\"My Modal Title\"}}"
}
```

**`action_key` naming convention**: Use `SCREAMING_SNAKE_CASE`. Must be unique across all DAs in the instance.

**Modal sizes** (set `size` in the root of the payload JSON): `"sm"`, `"md"` (default), `"lg"`, `"fullscreen"`.

**`applicable_to`**: This is the sys_id of the "Form" model record. The value `360935e9534723003eddddeeff7b127d` is the standard Form model (OOTB — verify on your instance). Query `sys_ux_data_broker_model` if you need to verify.

### Step 4: Create the DA Assignment

> **IMPORTANT**: Navigate via `Now Experience Framework > Actions and Events > Action Bar Declarative Actions` — do NOT navigate directly to `sys_declarative_action_assignment.list`. The `Model` field is hidden by default when accessing the table directly (Vancouver and earlier).

```json
// Table: sys_declarative_action_assignment
{
  "action_name": "my_action",
  "label": "My Button Label",
  "client_action": "<payload_definition_sys_id>",
  "model": "360935e9534723003eddddeeff7b127d",
  "declarative_action_type": "uxf_client_action",
  "form_position": "action_bar",
  "table": "x_acme_fm_case",
  "specificity": "32",
  "specify_condition": "true",
  "condition": "stateIN1,2,5",
  "active": "true"
}
```

**Field explanations:**
- `action_name`: Internal identifier (no spaces, lowercase)
- `label`: Display label on the button
- `client_action`: **Reference to payload definition** — this is the cascade-deletion danger field
- `model`: Always `360935e9534723003eddddeeff7b127d` for Form context (OOTB — verify on your instance)
- `declarative_action_type`: Always `uxf_client_action` for workspace buttons
- `form_position`: `action_bar` puts it in the form header button area
- `specificity`: `32` is standard for table-specific actions
- `condition`: Encoded query for when button should appear (example above: `stateIN1,2,5`)

### Step 5: Create the M2M Link

```json
// Table: sys_ux_m2m_action_assignment_action_config
{
  "action_assignment": "<da_assignment_sys_id>",
  "action_configuration": "<action_config_sys_id>"
}
```

The `action_configuration` is the workspace's action config record. This tells the workspace to include this DA assignment in its button set.

### Step 6: Create the Form Action

```json
// Table: sys_ux_form_action
{
  "label": "My Button Label",
  "declarative_action": "<da_assignment_sys_id>",
  "icon": "close-outline",
  "variant": "primary"
}
```

### Step 7: Add to Form Action Layout

Mandatory per the layouts-mandatory hard rule — without a layout item the button never renders.

```json
// Table: sys_ux_form_action_layout_item
{
  "form_action": "<form_action_sys_id>",
  "layout": "<form_action_layout_sys_id>",
  "order": "200",
  "table": "x_acme_fm_case"
}
```

### Step 8: Create or Verify Event Mapping

> **NOTE**: `sys_ux_addon_event_mapping` has no navigation menu link. You must navigate directly by typing the table name in the URL: `<instance>/sys_ux_addon_event_mapping.list`

> **CRITICAL**: The event mapping is what wires the button click to the modal opening. If ANY of the required fields below are missing or wrong, **the button will appear but clicking it does absolutely nothing** — no error, no console message, just silent failure. This is the hardest bug to diagnose because the button looks perfectly fine.

#### Required Fields on `sys_ux_addon_event_mapping`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **MANDATORY** | Display name for this mapping |
| `source_da` | reference → `sys_declarative_action_assignment` | **YES** | The DA assignment that triggers this event |
| `controller` | reference → `sys_ux_controller` | **YES** | The UXF controller that handles the event dispatch |
| `source_component` | reference → `sys_ux_macroponent` | **YES** | The macroponent component that emits the source event |
| `target_event` | reference → `sys_ux_event` | **YES** | The UX event to fire (e.g., "[Record Page] Open Modal") |
| `target_payload_mapping` | JSON | **YES** | Maps DA payload fields to the target event parameters |
| `active` | boolean | yes | Must be `true` |

#### How to Find the Correct Values for controller, source_component, and target_event

**These values are NOT guessable, and they differ per workspace.** You MUST copy them from a **working** event mapping on the same workspace. They are workspace-specific platform records — typically the controller is the record-page actions controller, the source component is the record-page action bar component, and the target event is the "[Record Page] Open Modal" event.

**Step-by-step:**
1. Find an existing working event mapping for the same workspace (any button that already opens a modal)
2. Query it with ALL fields:
```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_addon_event_mapping",
    "query": "source_da=<working_da_assignment_sys_id>",
    "fields": "sys_id,name,source_da,controller,source_component,target_event,target_payload_mapping"
  }
}
```
3. Copy the `controller`, `source_component`, and `target_event` values exactly to your new event mapping

If no working modal-opening mapping exists on the workspace yet, query `sys_ux_addon_event_mapping` filtered by the workspace's macroponents, or inspect an OOB workspace (e.g., Service Operations Workspace) for a reference mapping — but always validate against the workspace you are building on.

#### Creating the Event Mapping

```json
// Table: sys_ux_addon_event_mapping
{
  "name": "My Button Modal",
  "source_da": "<da_assignment_sys_id>",
  "controller": "<controller_sys_id_from_working_mapping>",
  "source_component": "<source_component_sys_id_from_working_mapping>",
  "target_event": "<target_event_sys_id_from_working_mapping>",
  "active": "true"
}
```

#### Target Payload Mapping

Configure the `target_payload_mapping` field on the event mapping record. This JSON maps the DA payload fields to the target event's parameters:

```json
{
  "type": "MAP_CONTAINER",
  "container": {
    "ariaLabel": {
      "type": "EVENT_PAYLOAD_BINDING",
      "binding": { "address": ["ariaLabel"] }
    },
    "route": {
      "type": "EVENT_PAYLOAD_BINDING",
      "binding": { "address": ["route"] }
    },
    "size": {
      "type": "EVENT_PAYLOAD_BINDING",
      "binding": { "address": ["size"] }
    },
    "fields": {
      "type": "EVENT_PAYLOAD_BINDING",
      "binding": { "address": ["fields"] }
    },
    "params": {
      "type": "EVENT_PAYLOAD_BINDING",
      "binding": { "address": ["params"] }
    }
  }
}
```

This maps the declarative action trigger to the `[Record Page] Open Modal` event on the workspace record page. The `MAP_CONTAINER` with `EVENT_PAYLOAD_BINDING` entries passes through the payload definition's fields and params to the modal route.

#### Debugging: Button Clicks But Nothing Happens

If the button appears but clicking does nothing, check these fields **in this exact order**:

1. **`controller`** — Is it set? Is it the correct sys_id? If empty, the event has no dispatcher.
2. **`source_component`** — Is it set? If empty, the platform can't find which component triggers the event.
3. **`target_event`** — Is it set? If empty, there's no event to fire. The modal never gets told to open.
4. **`source_da`** — Does it point to the correct DA assignment?
5. **`target_payload_mapping`** — Is the JSON valid? Does it have the MAP_CONTAINER structure?

**The fastest way to diagnose:** Query the broken event mapping AND a working one side-by-side, comparing every field:

```json
// Query both mappings
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_addon_event_mapping",
    "query": "source_daIN<working_da_sys_id>,<broken_da_sys_id>",
    "fields": "sys_id,name,source_da,controller,source_component,target_event,target_payload_mapping,active"
  }
}
```

Any field that is populated on the working mapping but empty on the broken one is your culprit.

### Step 9: Verify the Route

Ensure a route exists for `sowformmodalv2`:

```json
// Table: sys_ux_app_route
{
  "route_type": "sowformmodalv2",
  "fields": "table,sysId,title",
  "screen_type": "<screen_type_sys_id>",
  "optional_parameters": "saveLabel,cancelLabel,parentFormFields,setFieldOnSave,setFieldOnLoad,isGFormSave,modalTitle"
}
```

**NEVER add `view` to the `fields` value.** This breaks the modal.

---

## Using the Agent API

When creating these records programmatically via the agent API, use `create_artifact` for each record in the correct order:

### Recommended Creation Order

1. **Payload Definition** first (no dependencies)
2. **DA Assignment** (references payload def via `client_action`)
3. **M2M record** (references DA assignment + action config)
4. **Form Action** (references DA assignment)
5. **Form Action Layout Item** (references form action + layout)
6. **Event Mapping** (references DA assignment)

### Example Agent API Calls

The example below builds a "Resolve case" modal button on `x_acme_fm_case` (illustrative — substitute your table, labels, and condition):

```json
// 1. Create Payload Definition
{
  "command": "create_artifact",
  "params": {
    "table": "sys_declarative_action_payload_definition",
    "scope": "x_acme_fm",
    "fields": {
      "name": "Resolve case payload",
      "action_key": "resolve_case_payload",
      "label": "Resolve case payload",
      "applicable_to": "360935e9534723003eddddeeff7b127d",
      "payload_template": "{\"route\":\"sowformmodalv2\",\"fields\":{\"table\":\"x_acme_fm_case\",\"sysId\":\"{{sysId}}\"},\"params\":{\"saveLabel\":\"Save\",\"isGFormSave\":true,\"modalTitle\":\"Resolve case\"}}"
    }
  }
}

// 2. Create DA Assignment (use sys_id from step 1 response)
{
  "command": "create_artifact",
  "params": {
    "table": "sys_declarative_action_assignment",
    "scope": "x_acme_fm",
    "fields": {
      "name": "resolve_case",
      "action_name": "resolve_case",
      "label": "Resolve case",
      "client_action": "<payload_def_sys_id_from_step_1>",
      "model": "360935e9534723003eddddeeff7b127d",
      "declarative_action_type": "uxf_client_action",
      "form_position": "action_bar",
      "table": "x_acme_fm_case",
      "specificity": "32",
      "specify_condition": "true",
      "condition": "stateIN1,2,5",
      "active": "true"
    }
  }
}

// 3. Create M2M link (use sys_id from step 2)
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_m2m_action_assignment_action_config",
    "scope": "x_acme_fm",
    "fields": {
      "name": "resolve_case_m2m",
      "action_assignment": "<da_assignment_sys_id_from_step_2>",
      "action_configuration": "<workspace_action_config_sys_id>"
    }
  }
}

// 4. Create Event Mapping (use sys_id from step 2)
// CRITICAL: controller, source_component, and target_event MUST be copied
// from a working event mapping on the same workspace!
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ux_addon_event_mapping",
    "scope": "x_acme_fm",
    "fields": {
      "name": "Resolve Case Modal",
      "source_da": "<da_assignment_sys_id_from_step_2>",
      "controller": "<controller_from_working_mapping>",
      "source_component": "<source_component_from_working_mapping>",
      "target_event": "<target_event_from_working_mapping>",
      "target_payload_mapping": "{\"type\":\"MAP_CONTAINER\",\"container\":{\"ariaLabel\":{\"type\":\"EVENT_PAYLOAD_BINDING\",\"binding\":{\"address\":[\"ariaLabel\"]}},\"route\":{\"type\":\"EVENT_PAYLOAD_BINDING\",\"binding\":{\"address\":[\"route\"]}},\"size\":{\"type\":\"EVENT_PAYLOAD_BINDING\",\"binding\":{\"address\":[\"size\"]}},\"fields\":{\"type\":\"EVENT_PAYLOAD_BINDING\",\"binding\":{\"address\":[\"fields\"]}},\"params\":{\"type\":\"EVENT_PAYLOAD_BINDING\",\"binding\":{\"address\":[\"params\"]}}}}"
    }
  }
}
```

### Finding the Action Config sys_id

Before creating, query for the workspace's action config (and verify it against the `actionConfigId` page property — see `references/form-action-layouts.md`):

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_action_config",
    "query": "nameLIKEWorkspace actions",
    "fields": "sys_id,name"
  }
}
```

### Finding the Form Action Layout sys_id

```json
{
  "command": "query_records",
  "params": {
    "table": "sys_ux_form_action_layout",
    "query": "table=x_acme_fm_case",
    "fields": "sys_id,name,table"
  }
}
```

---

## Troubleshooting the DA Chain

### Button doesn't appear on form

1. **Check `form_button_v2`**: A UI Action-based button MUST have `form_button_v2=true`. #1 cause of invisible workspace buttons.
2. **Check DA assignment condition**: Is the encoded query matching the current record state?
3. **Check M2M link**: Is the DA assignment linked to the correct action config?
4. **Check form action layout**: Is there a layout item for this button? (Layouts-mandatory rule.)
5. **Check active flags**: Is everything set to `active: true`?
6. **Check specificity**: Should be `32` for table-specific actions

### Button appears but modal doesn't open (clicking does nothing)

> **This is the #1 hardest-to-diagnose issue.** The root cause is almost always **missing fields on the event mapping** — see "Debugging: Button Clicks But Nothing Happens" above (controller / source_component / target_event / target_payload_mapping), then:

- **Check route**: Does the `sowformmodalv2` route exist? Are the `fields` correct?
- **DO NOT add `view` to route `fields`** — this breaks the modal entirely
- **Check payload template**: Is the JSON valid on the payload definition? Is `route` set to `sowformmodalv2`?
- **Check browser console**: Look for preload warnings or route resolution errors

**The fastest fix**: Query a working button's event mapping and copy `controller`, `source_component`, and `target_event` values to your broken mapping.

### Records are ACL-locked (can't delete payload fields)

These platform tables are often protected:
- `sys_declarative_action_payload_field`
- `sys_declarative_action_payload_mapping`
- `sys_documentation` (field labels)

**Workaround**: Use a background script with `setWorkflow(false)`. Note: `setWorkflow(false)` also suppresses update-set capture — targeted repairs only.

```javascript
var grPayloadField = new GlideRecord('sys_declarative_action_payload_field');
grPayloadField.setWorkflow(false);
if (grPayloadField.get('sys_id_here')) {
    // Always verify ownership before deleting
    if (grPayloadField.getValue('sys_created_by') == '<your_dev_username>') {
        grPayloadField.deleteRecord();
    }
}
```

### Update set has too many records

Workspace artifacts auto-generate:
- `sys_declarative_action_payload_field` — one per parameter in payload template
- `sys_documentation` (Field Labels) — one per payload field per language
- `sys_declarative_action_payload_mapping` — links payload def to model

These are auto-created and can be safely removed from the update set if orphaned (parent payload def deleted).

**Cleanup script for orphaned `sys_update_xml` entries:**

```javascript
var orphanIds = ['sys_id_1', 'sys_id_2']; // update_xml sys_ids to remove
var updateSetId = 'your_update_set_sys_id';

for (var i = 0; i < orphanIds.length; i++) {
    var grUpdateXml = new GlideRecord('sys_update_xml');
    grUpdateXml.setWorkflow(false);
    if (grUpdateXml.get(orphanIds[i])) {
        if (grUpdateXml.getValue('update_set') == updateSetId) {
            grUpdateXml.deleteRecord();
        }
    }
}
```

---

## Anti-Patterns — What NOT to Do

### 1. Don't pass `view` through the route
```
WRONG  fields: "table,sysId,title,view"    → Modal won't open
WRONG  optional_parameters: "...,view"      → View won't be applied
RIGHT  forcedViewName as JSON_LITERAL       → Works correctly (see references/modal-views.md)
```

### 2. Don't delete payload definitions without clearing references
```
WRONG  Delete sys_declarative_action_payload_definition directly
       → Cascade deletes DA assignment → Button disappears

RIGHT  Clear client_action on DA assignment first
RIGHT  Then delete the payload definition
```

### 3. Don't create multiple routes for the same route_type
```
WRONG  Two sys_ux_app_route records with route_type "sowformmodalv2"
       → Unpredictable behavior, route conflicts

RIGHT  One route per route_type, reuse it across multiple buttons
```

### 4. Don't forget the M2M record
```
WRONG  Create DA assignment without M2M link to action config
       → Button won't appear in workspace (no workspace context)

RIGHT  Always create sys_ux_m2m_action_assignment_action_config
```

### 5. Don't use `update_record_batch` for ALL fields at once on DA assignment
When updating a DA assignment, set `client_action` carefully — if you set it to an invalid/empty value, the button breaks silently.

---

## Checklist: New Workspace Button + Modal

- [ ] **Form view** created on target table (`sys_ui_view` + `sys_ui_section`)
- [ ] **Client Script** created for the view (onLoad behavior: filter choices, set mandatory fields)
- [ ] **Business Rules** created for server-side validation (before update)
- [ ] **Macroponent** has `forcedViewName` set as `JSON_LITERAL` on data resource
- [ ] **Macroponent** has `hideLoader: false` in `state_properties`
- [ ] **Payload Definition** created with correct `payload_template` JSON
- [ ] **DA Assignment** created with ALL required fields:
  - [ ] `client_action` → payload definition
  - [ ] `model` → `360935e9534723003eddddeeff7b127d` (OOTB Form model — verify on your instance)
  - [ ] `declarative_action_type` → `uxf_client_action`
  - [ ] `form_position` → `action_bar`
  - [ ] `specificity` → `32`
  - [ ] `condition` → encoded query for when to show
- [ ] **M2M record** created linking DA assignment → action config
- [ ] **Form Action** created referencing DA assignment
- [ ] **Form Action Layout Item** created in the correct layout group (layouts-mandatory rule)
- [ ] **Event Mapping** created with ALL required fields:
  - [ ] `source_da` → DA assignment
  - [ ] `controller` → UXF controller (copy from working mapping)
  - [ ] `source_component` → action bar macroponent (copy from working mapping)
  - [ ] `target_event` → "[Record Page] Open Modal" event (copy from working mapping)
  - [ ] `target_payload_mapping` → MAP_CONTAINER JSON with EVENT_PAYLOAD_BINDING entries
- [ ] **Route** exists for `sowformmodalv2` (usually pre-existing, verify `fields` does NOT contain `view`)
- [ ] **Update set** is clean — no orphaned payload fields or field labels
- [ ] **Test**: Button visible → Click → Modal opens → Correct view shown → Spinner works → Save validates → Record updates

---

## Reference: Common sys_ids

| Record | sys_id | Notes |
|--------|--------|-------|
| Form model (`sys_ux_data_broker_model`) | `360935e9534723003eddddeeff7b127d` | Used in `applicable_to` and `model` fields (OOTB — verify on your instance) |

---

## Undocumented Knowledge (discovered through production testing — verify on your instance first)

- `forcedViewName` as `JSON_LITERAL` on the Glide Form data resource — not in any public docs
- `view` is reserved in UXF routing — adding to route `fields` breaks the modal completely
- `client_action` reference on DA assignment causes cascade deletion when payload definition is deleted
- `sys_declarative_action_payload_field` and `sys_documentation` records are often ACL-protected
- **`sys_ux_addon_event_mapping` requires `controller`, `source_component`, AND `target_event` fields** — without all three, the button click silently fails (no error, no console output). These fields are not mentioned in any ServiceNow documentation. They must be copied from an existing working event mapping on the same workspace. The `source_da` and `target_payload_mapping` fields alone are NOT sufficient.

---

## External References

### Official ServiceNow Documentation
- [Configuring an Action Button to Open a Custom Modal (Xanadu)](https://www.servicenow.com/docs/bundle/xanadu-platform-user-interface/page/administer/configurable-workspace/concept/configuring-an-action-button-to-open-a-custom-modal.html)
- [Render a Component in a Modal](https://www.servicenow.com/docs/bundle/xanadu-platform-user-interface/page/administer/workspace/task/set-up-ui-action-render-custom-component.html)
- [Understanding UI Actions and Declarative Actions (KB1811593)](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB1811593)

### Best Community Guides
- [Dylan Lindgren — Declarative Actions: The COMPLETE Guide](https://www.dylanlindgren.com/2023/12/29/declarative-actions-in-servicenow-the-complete-guide/) — includes a single-page cheatsheet PDF with table relationship diagram
- [jessems.com — Opening a Modal from a Record in Configurable Workspaces](https://jessems.com/posts/2023-03-24-opening-modal-from-a-record-in-configurable-workspaces/)
- [nextexp.jessems.com — Passing Variables into a Modal](https://nextexp.jessems.com/configurable-workspaces/tutorials/guide-passing-variables-into-a-modal)
- [SN Community — Workspace for a Custom App: Buttons](https://www.servicenow.com/community/next-experience-blog/workspace-for-a-custom-app-buttons/ba-p/2603633)
- [SN Community — UI Builder Essentials: Modals and Modeless Dialogs](https://www.servicenow.com/community/next-experience-blog/ui-builder-essentials-modals-and-modeless-dialogs/ba-p/3184395)
