# Modal Views: SOW Form Modal v2, forcedViewName, Spinner & View Scripts

> Reference for the `workspace-modal-actions` skill. Covers the modal *content* side: the `sowformmodalv2` route, forcing a form view inside the modal, loading state, and the client scripts / BRs that back a modal view. The button→modal wiring lives in `references/declarative-action-chains.md`.

Examples use placeholder values — table `x_acme_fm_case`, child table `x_acme_fm_case_detail`. Substitute your project's values.

## SOW Form Modal v2

### What is it?
`sowformmodalv2` is a built-in workspace route type that opens a GlideForm inside a modal dialog. It's the standard way to show a record form in a modal within Next Experience workspaces.

### Route Configuration

**Route Type**: `sowformmodalv2`

**Route `fields`** (required parameters extracted from payload `fields` object):
```
table,sysId,title
```

**Route `optional_parameters`** (from payload `params` object):
```
saveLabel,cancelLabel,parentFormFields,setFieldOnSave,setFieldOnLoad,isGFormSave,modalTitle
```

> **WARNING**: Do NOT add `view` to either `fields` or `optional_parameters`. While it won't break the modal if added to `optional_parameters`, it also won't work — the UXF routing layer does not pass `view` through to macroponent props. Only adding `view` to `fields` breaks the modal.

### Payload Template JSON

```json
{
  "route": "sowformmodalv2",
  "fields": {
    "table": "x_acme_fm_case",
    "sysId": "{{sysId}}",
    "view": "my_custom_view"
  },
  "params": {
    "saveLabel": "Save",
    "isGFormSave": true,
    "modalTitle": "My Modal Title"
  }
}
```

**Important**: `{{sysId}}` is a template variable that gets replaced with the current record's sys_id at runtime. Use this exact syntax.

**Important**: The `view` in `fields` is passed to the route but **NOT forwarded to the macroponent's data resource** by the UXF framework. You must use `forcedViewName` on the data resource instead (see below).

---

## Setting the Form View in a Modal

### The Problem
You want a modal to show a specific form view (e.g., only `state` and `work_notes` fields). The obvious approach — passing `view` through the route — does NOT work because `view` is a reserved concept in UXF routing.

### The Solution: `forcedViewName` on the Glide Form Data Resource

Inside your custom macroponent's JSON definition, the Glide Form data resource has a property called `forcedViewName`. Set this to a **JSON_LITERAL** string with your view name:

```json
{
  "data_resources": {
    "glide_form_1": {
      "data_resource_id": "sn_uib_glide_form",
      "bindings": {
        "table": {
          "type": "CONTEXT_BINDING",
          "value": "props.table"
        },
        "sysId": {
          "type": "CONTEXT_BINDING",
          "value": "props.sysId"
        },
        "forcedViewName": {
          "type": "JSON_LITERAL",
          "value": "my_custom_view_name"
        }
      }
    }
  }
}
```

### Why CONTEXT_BINDING for `forcedViewName` Doesn't Work
Even though you can bind `forcedViewName` to `props.view` via CONTEXT_BINDING, the `view` prop never actually arrives from the route. The UXF framework intercepts it. So you end up with `forcedViewName = undefined` and the default view is shown.

**The only reliable approach**: Hardcode `forcedViewName` as a `JSON_LITERAL` in the macroponent definition.

### Alternative: Workspace Experience View Rules

ServiceNow has a documented feature called **Workspace Experience View Rules** (`sys_ux_view_rule`) that can force a specific view on workspace forms. However, this applies to the entire record page — not specifically to modals. For modal-specific views, `forcedViewName` as JSON_LITERAL remains the only reliable approach.

Reference: [How to Create a Workspace Experience View Rule](https://www.servicenow.com/community/next-experience-articles/how-to-create-a-workspace-experience-view-rule-to-force-a/ta-p/2331936)

### Making it Reusable
If you need the same modal mechanism for multiple views, create **separate macroponents** per view, each with their own `forcedViewName`. Or create a single macroponent and use a different prop name (NOT `view`) like `formViewName` to pass the view name from the route.

### Binding Types Reference

| Type | Syntax | Use When |
|------|--------|----------|
| `JSON_LITERAL` | `{ "type": "JSON_LITERAL", "value": "hardcoded_string" }` | Static values that never change |
| `CONTEXT_BINDING` | `{ "type": "CONTEXT_BINDING", "value": "props.myProp" }` | Dynamic values from route/parent |
| `CLIENT_STATE_BINDING` | `{ "type": "CLIENT_STATE_BINDING", "value": "state.myState" }` | Values from page-level client state |
| `DATA_BINDING` | `{ "type": "DATA_BINDING", "value": "data.myBroker.field" }` | Values from data resources |

---

## Spinner / Loading State

### How the Spinner Works
The macroponent's `state_properties` control the spinner:

```json
{
  "state_properties": {
    "hideLoader": {
      "default_value": false
    }
  }
}
```

- `hideLoader: false` → Spinner shows while form loads → disappears on `FETCH_SUCCESS`
- `hideLoader: true` → No spinner, form just appears (can cause flash of empty content)

### The FETCH_SUCCESS Flow
When the Glide Form data resource finishes loading:
1. Data resource emits `FETCH_SUCCESS` event
2. An event handler on the macroponent catches it
3. Handler sets `hideLoader = true` via `UPDATE_PROPERTIES`
4. Spinner disappears, form is visible

```json
{
  "event_handlers": [
    {
      "event": "FETCH_SUCCESS",
      "source": "glide_form_1",
      "action": "UPDATE_PROPERTIES",
      "payload": {
        "hideLoader": true
      }
    }
  ]
}
```

**Always keep `hideLoader` default as `false`** for proper UX.

---

## Client Scripts for the Modal View

### onLoad Client Script (Filter Choice Values)

When the modal shows a form with a choice field (e.g., `state`), you often want to filter which values are available:

```javascript
// Table: sys_script_client (onLoad)
// View: my_custom_modal_view
// UI Type: All

function onLoad() {
    // Remove all states except the ones we want (example values)
    var keepStates = ['3', '4']; // Only keep these state values
    var allStates = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];

    for (var i = 0; i < allStates.length; i++) {
        if (keepStates.indexOf(allStates[i]) === -1) {
            g_form.removeOption('state', allStates[i]);
        }
    }

    // Make work_notes mandatory
    g_form.setMandatory('work_notes', true);

    // Prefill assigned_to with current user if empty
    if (!g_form.getValue('assigned_to')) {
        g_form.setValue('assigned_to', g_user.userID);
    }
}
```

**Important**: Set the client script's **View** field to match the view name used in the modal. This ensures the script only runs when the form is shown in the modal, not on the regular form.

**Note**: If your project routes state changes through a state model (state flows + guard business rules), do not build choice-filtering close modals for status transitions — the state model layer owns that. Use this technique for non-status modal forms.

### Business Rules for Validation Behind a Modal Save

When the modal form is saved, server-side Business Rules validate (example):

```javascript
// Table: sys_script (before, on update)
// Condition: state changes TO 3 AND previous state IN 1,2,5 (example)

(function executeRule(current, previous) {

    // Auto-fill assigned_to
    if (current.assigned_to.nil()) {
        current.setValue('assigned_to', gs.getUserID());
    }

    // Validate assignment_group
    if (current.assignment_group.nil()) {
        gs.addErrorMessage(gs.getMessage('<namespace>.case_modal.assignment_group_required'));
        current.setAbortAction(true);
        return;
    }

    // Validate work_notes
    if (!current.work_notes.changes() || current.work_notes.nil()) {
        gs.addErrorMessage(gs.getMessage('<namespace>.case_modal.work_notes_required'));
        current.setAbortAction(true);
        return;
    }

    // Validate child records exist (example: at least one detail record)
    var grChild = new GlideRecord('x_acme_fm_case_detail');
    grChild.addQuery('case', current.getUniqueValue());
    grChild.setLimit(1);
    grChild.query();
    if (!grChild.hasNext()) {
        gs.addErrorMessage(gs.getMessage('<namespace>.case_modal.detail_record_required'));
        current.setAbortAction(true);
        return;
    }

})(current, previous);
```

User-facing messages go through `gs.getMessage()` with `sys_ui_message` records per language — never hardcoded strings. See `references/translations.md`.

---

## Troubleshooting Modal Content

### Modal opens but shows wrong/default view

1. **Check `forcedViewName`** on the macroponent's data resource — must be `JSON_LITERAL`, not `CONTEXT_BINDING`
2. **Verify the view exists**: Check `sys_ui_view` for your view name
3. **Verify the form layout**: Check `sys_ui_section` for the view's field configuration
4. **Do NOT try to pass view through the route** — it doesn't work

### Modal opens but no spinner

1. **Check `hideLoader`** in `state_properties` — default must be `false`
2. **Check event handler** for `FETCH_SUCCESS` → `UPDATE_PROPERTIES` → `hideLoader: true`

---

## Reference: Payload Template Parameters

### `fields` object (maps to route `fields`)

| Parameter | Type | Description |
|-----------|------|-------------|
| `table` | string | Target table name |
| `sysId` | string | Record sys_id (use `{{sysId}}` for current record) |
| `title` | string | Optional title override |

### `params` object (maps to route `optional_parameters`)

| Parameter | Type | Description |
|-----------|------|-------------|
| `saveLabel` | string | Label for the save button |
| `cancelLabel` | string | Label for cancel button |
| `isGFormSave` | boolean | Use GlideForm save behavior (recommended: `true`) |
| `modalTitle` | string | Title shown in modal header |
| `parentFormFields` | object | Fields to pass to parent form on save |
| `setFieldOnSave` | object | Fields to set on save |
| `setFieldOnLoad` | object | Fields to set when modal loads |

Note: `modalTitle` and `saveLabel` are NOT translatable via any standard mechanism — see `references/translations.md`.

---

## Activity Stream in Workspace

### Problem: Activity log not working on custom tables

If the activity stream doesn't show entries or the Post button doesn't work in workspace, the most common cause is a **missing "Activities (filtered)" formatter** on the workspace form view.

### Fix: Add "Activities (filtered)" to form layout

1. Open the table in **classic UI** (not workspace)
2. Go to **Configure > Form Layout**
3. Switch to the **workspace** view (or whichever view your workspace uses)
4. Add the **"Activities (filtered)"** formatter to the form layout
5. Save

**This is required even if your custom table extends `task`.** Workspace does not inherit the activity stream configuration from parent tables — each view needs its own formatter.

### Why this happens

- Workspace uses a separate form view from classic UI
- The activity stream component in workspace relies on the "Activities (filtered)" formatter being present on the form layout for that view
- Without it: journal fields (`work_notes`, `comments`) won't display in the activity panel and posting will fail silently

### Reference
- [SN Community — Activity log from workspace not showing on custom table](https://www.servicenow.com/community/developer-forum/activity-log-from-workspace-is-not-showing-up-with-my-custom/m-p/3197082)
