---
name: ui-actions-policies
description: Invoke when the user asks to "create UI action", "form button", "UI policy", "hide field", "make field mandatory", "context menu", "list action", or when building form behavior via ServiceNow UI Actions / UI Policies.
---

# UI Actions & UI Policies for ServiceNow

UI Actions put buttons, links, and context-menu entries on forms and lists. UI Policies drive dynamic form-field behavior (mandatory / visible / read-only) without code, or with a small client-side script when conditions alone are not enough.

## UI Actions

### UI Action Types

| Type                  | Location           | Example            |
| --------------------- | ------------------ | ------------------ |
| **Form Button**       | Form header        | "Resolve Incident" |
| **Form Context Menu** | Right-click menu   | "Copy Record"      |
| **Form Link**         | Related links      | "View CI"          |
| **List Button**       | List header        | "Export Selected"  |
| **List Context Menu** | Right-click on row | "Assign to Me"     |
| **List Choice**       | Actions dropdown   | "Update State"     |
| **List Link**         | List header links  | "New Record"       |

### Form Button UI Action (ES5)

Server-side UI Action scripts on global-scope tables run in Rhino — ES5 only.

```javascript
// Table: sys_ui_action
// Name: Resolve Incident
// Table: incident
// Form button: true
// Active: true
// Condition: current.active == true && current.state != 6

// Script (Server-side - ES5 ONLY):
;(function executeAction() {
  // Validate before resolving
  if (!current.resolution_code) {
    gs.addErrorMessage("Please select a resolution code")
    action.setRedirectURL(current)
    return
  }

  if (!current.close_notes) {
    gs.addErrorMessage("Please provide resolution notes")
    action.setRedirectURL(current)
    return
  }

  // Set resolved state
  current.state = 6 // Resolved
  current.resolved_at = new GlideDateTime()
  current.resolved_by = gs.getUserID()
  current.update()

  gs.addInfoMessage("Incident " + current.number + " has been resolved")
  action.setRedirectURL(current)
})()
```

### Client-Side UI Action (ES5)

```javascript
// Table: sys_ui_action
// Name: Quick Assign
// Client: true
// Onclick: quickAssign()

// Client script (ES5 ONLY):
function quickAssign() {
  // Get current user
  var userId = g_user.userID
  var userName = g_user.getFullName()

  // Confirm action
  var confirmed = confirm("Assign this incident to yourself (" + userName + ")?")
  if (!confirmed) {
    return false
  }

  // Set the field value
  g_form.setValue("assigned_to", userId)
  g_form.setValue("assignment_group", g_user.getGroupID())

  // Save the form
  gsftSubmit(null, g_form.getFormElement(), "save")
  return false
}
```

### List UI Action (ES5)

```javascript
// Table: sys_ui_action
// Name: Close Selected Incidents
// Table: incident
// List button: true
// List choice: true
// Condition: gs.hasRole('itil')

// Script (Server-side - ES5 ONLY):
;(function executeAction() {
  // Get selected records
  var selectedRecords = RP.getParameterValue("sysparm_checked_items")
  if (!selectedRecords) {
    gs.addErrorMessage("No records selected")
    return
  }

  var sysIds = selectedRecords.split(",")
  var closedCount = 0

  for (var i = 0; i < sysIds.length; i++) {
    var gr = new GlideRecord("incident")
    if (gr.get(sysIds[i])) {
      if (gr.state != 7) {
        // Not already closed
        gr.state = 7 // Closed
        gr.closed_at = new GlideDateTime()
        gr.closed_by = gs.getUserID()
        gr.update()
        closedCount++
      }
    }
  }

  gs.addInfoMessage("Closed " + closedCount + " incident(s)")
})()
```

### UI Action with GlideAjax (ES5)

A client-side UI Action can call a client-callable Script Include before deciding whether to submit.

```javascript
// Client-side UI Action calling server
// Client: true
// Onclick: checkAndEscalate()

function checkAndEscalate() {
  var incidentId = g_form.getUniqueValue()

  // Check if escalation is allowed
  var ga = new GlideAjax("IncidentAjax")
  ga.addParam("sysparm_name", "canEscalate")
  ga.addParam("sysparm_incident_id", incidentId)
  ga.getXMLAnswer(function (answer) {
    var result = JSON.parse(answer)
    if (result.canEscalate) {
      // Proceed with escalation
      g_form.setValue("priority", 1)
      g_form.setValue("escalation", 1)
      gsftSubmit(null, g_form.getFormElement(), "escalate_incident")
    } else {
      alert("Cannot escalate: " + result.reason)
    }
  })
  return false
}
```

## UI Policies

### UI Policy Structure

| Field                 | Purpose                   |
| --------------------- | ------------------------- |
| **Short description** | Policy name               |
| **Table**             | Target table              |
| **Conditions**        | When to apply             |
| **Reverse if false**  | Undo when condition false |
| **On load**           | Run when form loads       |
| **UI Policy Actions** | Field behaviors           |

### Basic UI Policy (No Script)

Prefer condition-driven policies with declarative actions; only add scripts when the logic cannot be expressed as conditions.

```yaml
# UI Policy: Make Resolution Required on Resolve
Table: incident
Short description: Require resolution fields when resolving
Conditions: state = 6 (Resolved)
On load: true
Reverse if false: true

# UI Policy Actions:
- Field: resolution_code
  Mandatory: true
  Visible: true

- Field: close_notes
  Mandatory: true
  Visible: true

- Field: resolved_by
  Read only: true
```

### UI Policy with Script (ES5)

```javascript
// UI Policy Script - Execute if true
// Runs when condition becomes true (ES5 ONLY!)

function onCondition() {
  // Show/hide fields based on category
  var category = g_form.getValue("category")

  if (category === "hardware") {
    g_form.setDisplay("cmdb_ci", true)
    g_form.setMandatory("cmdb_ci", true)
    g_form.setDisplay("software", false)
  } else if (category === "software") {
    g_form.setDisplay("software", true)
    g_form.setMandatory("software", true)
    g_form.setDisplay("cmdb_ci", false)
  }
}
```

### Complex UI Policy Script (ES5)

```javascript
// UI Policy: VIP Caller Handling
// Condition: None (script handles logic)
// On load: true
// Run scripts: true

// Script - Execute if true (ES5 ONLY!):
function onCondition() {
  var callerId = g_form.getValue("caller_id")
  if (!callerId) {
    return
  }

  // Check if VIP via GlideAjax
  var ga = new GlideAjax("UserAjax")
  ga.addParam("sysparm_name", "isVIP")
  ga.addParam("sysparm_user_id", callerId)
  ga.getXMLAnswer(function (answer) {
    var isVIP = answer === "true"

    if (isVIP) {
      // Highlight form
      g_form.flash("caller_id", "#FFD700", 0)
      g_form.showFieldMsg("caller_id", "VIP Customer", "info")

      // Set default priority
      if (!g_form.getValue("priority")) {
        g_form.setValue("priority", 2)
      }

      // Make assignment group mandatory
      g_form.setMandatory("assignment_group", true)
    }
  })
}
```

### Dynamic Field Visibility (ES5)

```javascript
// UI Policy: Show fields based on incident type
// Table: incident
// On load: true

function onCondition() {
  var incidentType = g_form.getValue("u_incident_type")

  // Reset all conditional fields
  var conditionalFields = ["u_network_details", "u_hardware_model", "u_software_name"]
  for (var i = 0; i < conditionalFields.length; i++) {
    g_form.setDisplay(conditionalFields[i], false)
    g_form.setMandatory(conditionalFields[i], false)
  }

  // Show relevant fields
  switch (incidentType) {
    case "network":
      g_form.setDisplay("u_network_details", true)
      g_form.setMandatory("u_network_details", true)
      break
    case "hardware":
      g_form.setDisplay("u_hardware_model", true)
      g_form.setMandatory("u_hardware_model", true)
      break
    case "software":
      g_form.setDisplay("u_software_name", true)
      g_form.setMandatory("u_software_name", true)
      break
  }
}
```

## Creating via Scripts (ES5)

### Create UI Action Programmatically

```javascript
// Create UI Action via background script (ES5 ONLY!)
var uiAction = new GlideRecord("sys_ui_action")
uiAction.initialize()
uiAction.setValue("name", "Escalate to Manager")
uiAction.setValue("table", "incident")
uiAction.setValue("active", true)
uiAction.setValue("form_button", true)
uiAction.setValue("form_style", "btn-warning")
uiAction.setValue("hint", "Escalate this incident to the caller's manager")
uiAction.setValue("condition", "current.active == true && current.priority > 2")
uiAction.setValue(
  "script",
  "(function executeAction() {\n" +
    "    current.priority = 2;\n" +
    "    current.escalation = 1;\n" +
    '    current.work_notes = "Escalated by " + gs.getUserDisplayName();\n' +
    "    current.update();\n" +
    '    gs.addInfoMessage("Incident escalated");\n' +
    "    action.setRedirectURL(current);\n" +
    "})();",
)
uiAction.insert()
```

### Create UI Policy with Actions — Background Script (REQUIRED)

**CRITICAL: UI Policies with actions MUST be created via background script, not via the agent API.**

The sn-scriptsync agent API (`create_artifact`, `update_record`, `update_record_batch`) cannot set the `ui_policy` reference field on `sys_ui_policy_action`. The write reports success, but the reference stays empty — the action record exists yet is orphaned and does nothing. (Verify on your instance first, then treat the background-script route as the default.)

The reliable method is a single background script that inserts the UI Policy and its linked actions together, using `setWorkflow(false)` so engines and business rules do not interfere with the inserts. Note that plain `update()`/`insert()` in a background script keeps update-set capture, while `setWorkflow(false)` can suppress it on some record types — verify capture in `sys_update_xml` after running, and force-add if needed.

#### How to execute
1. Copy the background script
2. Open ServiceNow → **System Definition > Scripts - Background** (or type `/bg` in the filter navigator)
3. Paste and run the script
4. Read back the created records and confirm `sys_ui_policy_action.ui_policy` is populated

#### Basic Example: Mandatory + Visible Fields

```javascript
// Background script — creates UI Policy + linked actions (ES5 ONLY!)
// setWorkflow(false) prevents BRs from interfering during creation

var policy = new GlideRecord('sys_ui_policy');
policy.initialize();
policy.setWorkflow(false);
policy.setValue('short_description', 'Require Close Notes on Close');
policy.setValue('table', 'incident');
policy.setValue('active', true);
policy.setValue('on_load', true);
policy.setValue('reverse_if_false', true);
policy.setValue('conditions', 'state=7');
var policySysId = policy.insert();

if (policySysId) {
    // Action 1: Make close_notes mandatory + visible
    var grAction1 = new GlideRecord('sys_ui_policy_action');
    grAction1.initialize();
    grAction1.setWorkflow(false);
    grAction1.setValue('ui_policy', policySysId);
    grAction1.setValue('field', 'close_notes');
    grAction1.setValue('mandatory', 'true');
    grAction1.setValue('visible', 'true');
    grAction1.setValue('disabled', 'false');
    grAction1.insert();

    // Action 2: Make resolution_code mandatory + visible
    var grAction2 = new GlideRecord('sys_ui_policy_action');
    grAction2.initialize();
    grAction2.setWorkflow(false);
    grAction2.setValue('ui_policy', policySysId);
    grAction2.setValue('field', 'resolution_code');
    grAction2.setValue('mandatory', 'true');
    grAction2.setValue('visible', 'true');
    grAction2.setValue('disabled', 'false');
    grAction2.insert();

    gs.info('Created UI Policy: ' + policySysId + ' with 2 actions');
} else {
    gs.error('Failed to create UI Policy');
}
```

#### Advanced Example: Field Messages on UI Policy Actions

`sys_ui_policy_action` carries native fields for showing an info/warning/error message directly under a form field — no client script needed:

- `field_message` (translated_text) — the message text
- `field_message_type` (choice) — `none`, `info`, `warning`, `error`

If your project ships translations (see `language.source` / `language.targets` in `product.config.json`), add a `sys_translated_text` record per target language, linked to the action.

```javascript
// Background script — UI Policy with field message action (ES5 ONLY!)
// EXAMPLE: scoped table x_acme_fm_case is a placeholder — substitute your table.
// Shows an info message under short_description on form load.

var policy = new GlideRecord('sys_ui_policy');
policy.initialize();
policy.setWorkflow(false);
policy.setValue('short_description', 'ACME - Show description guidance');
policy.setValue('table', 'x_acme_fm_case');
policy.setValue('active', true);
policy.setValue('on_load', true);
policy.setValue('reverse_if_false', false);
// Empty conditions = always applies
var policySysId = policy.insert();

if (policySysId) {
    // Create action with field message
    var grAction = new GlideRecord('sys_ui_policy_action');
    grAction.initialize();
    grAction.setWorkflow(false);
    grAction.setValue('ui_policy', policySysId);
    grAction.setValue('field', 'short_description');
    grAction.setValue('mandatory', 'ignore');
    grAction.setValue('visible', 'ignore');
    grAction.setValue('disabled', 'ignore');
    grAction.setValue('field_message', 'This text is shown in the overviews and reports.');
    grAction.setValue('field_message_type', 'info');
    var actionSysId = grAction.insert();

    // Add a translation for the field_message (one record per target language)
    if (actionSysId) {
        var grTrans = new GlideRecord('sys_translated_text');
        grTrans.initialize();
        grTrans.setWorkflow(false);
        grTrans.setValue('table_name', 'sys_ui_policy_action');
        grTrans.setValue('document_id', actionSysId);
        grTrans.setValue('field_name', 'field_message');
        grTrans.setValue('language', '<target_lang>'); // e.g. from product.config.json language.targets
        grTrans.setValue('value', '<translated message text>');
        grTrans.insert();
    }

    gs.info('Created UI Policy: ' + policySysId + ' with field message action + translation');
} else {
    gs.error('Failed to create UI Policy');
}
```

#### UI Policy Action Field Values

| Field | Values | Notes |
| --- | --- | --- |
| `mandatory` | `'true'`, `'false'`, `'ignore'` | Use `'ignore'` to not change this behavior |
| `visible` | `'true'`, `'false'`, `'ignore'` | Use `'ignore'` to not change this behavior |
| `disabled` | `'true'`, `'false'`, `'ignore'` | Use `'ignore'` to not change this behavior |
| `field_message` | String | Info/warning/error text shown under the field |
| `field_message_type` | `'none'`, `'info'`, `'warning'`, `'error'` | Style of the field message |

#### Why Background Scripts Instead of the Agent API

| Method | Sets `ui_policy` reference? | Result |
| --- | --- | --- |
| `create_artifact` | No — silently fails | Orphaned action, no effect |
| `update_record` | No — silently fails | Reference stays empty |
| `update_record_batch` | No — silently fails | Reference stays empty |
| **Background script** | **Yes** | **Action linked correctly** |

The agent API goes through the ServiceNow REST layer, which fails to set certain reference fields on `sys_ui_policy_action` while still reporting success. Background scripts run server-side GlideRecord inserts and are not subject to that limitation. Always verify with a read-back regardless of the method used.

## Best Practices

1. **Descriptive Names** - Clear purpose in name
2. **Conditions First** - Use conditions before scripts
3. **Minimal Scripts** - Keep scripts short
4. **Reverse If False** - Clean up field states
5. **Test Thoroughly** - Multiple scenarios
6. **Role Security** - Add role conditions
7. **ES5 Only** - No modern JavaScript syntax in global-scope artifacts; match the scope of the file you edit
8. **Form vs List** - Choose appropriate action type
9. **Verify Every Write** - Read back created/updated records; API "success" alone proves nothing

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
