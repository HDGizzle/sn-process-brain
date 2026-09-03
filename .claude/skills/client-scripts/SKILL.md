---
name: client-scripts
description: Invoke when the user asks to "create client script", "onLoad", "onChange", "onSubmit", "onCellEdit", "g_form", "GlideAjax", "showFieldMsg", "setMandatory", "getMessage", "field message", or when building any ServiceNow client-side form scripting (validation, field visibility).
---

# Client Script Patterns for ServiceNow

Client Scripts run in the user's browser and control form behavior.

## Project Rules (mandatory)

- **Check for an existing client script on the same field/table before creating a new one.** Query `sys_script_client` (or `catalog_script_client` for record producers) for scripts already targeting the same `table`+`field` (or `cat_variable`) combination. If one exists, **extend it** — add your new logic into its existing `onChange`/`onLoad` function — rather than creating a second handler that fires alongside it. Two scripts racing to control the same field is the same "two policies racing to control one field" problem as with UI Policies (see `ui-actions-policies` skill). This applies to every artifact type, not just client scripts: before `create_artifact`, always check whether something reusable already exists (UI Policy, Business Rule, client script, Script Include method) and extend it instead of duplicating.
- **`ui_type: "10"` (All)** — never `"0"` (Desktop only). `"0"` does not fire in Agent or Configurable Workspace. This applies to every `sys_script_client` created.
- **`getMessage()` requires the `messages` field.** Every key passed to `getMessage('<namespace>.x.y')` MUST also be listed in the script's `messages` field. Without it, `getMessage()` returns the raw key as text — silent failure, no console error. Server-side `gs.getMessage()` does NOT need this — it reads `sys_ui_message` directly.
- **GlideAjax to scoped Script Includes uses full `api_name` with scope prefix.** From a client script in scoped-app context:
  ```javascript
  // ❌ WRONG — silently fails, callback returns nothing
  var ga = new GlideAjax('MyFooAjax');
  // ✅ CORRECT — query sys_script_include.api_name to get the right value
  var ga = new GlideAjax('x_acme_fm.MyFooAjax');
  ```
- **Multi-language:** any user-facing text via `g_form.showFieldMsg`, `g_form.addInfoMessage`, `g_form.addErrorMessage`, etc. uses `getMessage('<namespace>.<key>')` with matching `sys_ui_message` records in the project source language plus every target language (see `product.config.json` → `language.source` / `language.targets`; message key namespace from `naming.messageKeyNamespace`). See the `translate-server-scripts` skill for the message-record creation pattern.
- **Always include a `description`** on the script — on create AND update.
- **Date fields read back in the user's DISPLAY format in the configurable workspace** (e.g. `28-08-2026 13:58:01`, not `2026-08-28 …`) *(verify on your instance first)*. `g_form.getValue('due_date')` and the onChange `newValue`/`oldValue` are display-format strings, which `new Date()` **cannot parse** (→ `Invalid Date`, so every comparison is silently false). Never do client-side date math with `new Date()` on a field value. Do the compare **server-side**: send the raw value via GlideAjax and use `var gdt = new GlideDateTime(); gdt.setDisplayValue(value);` (parses the session user's locale), then `gdt.after(...)`.
- **`g_form.getValue()` only sees fields that are ON the form layout.** A field set on the *record* but not placed on the form reads back **empty** client-side — no error. Don't add a field to the form just to read it; resolve it server-side instead: pass `g_form.getUniqueValue()` to a GlideAjax method that GlideRecords the record and reads the field. For a NEW/unsaved record `getUniqueValue()` is `-1` — handle that case and let a server BR be the real backstop.
- **`setValue(field, …)` clears that field's `showFieldMsg`.** Changing a field's value wipes its field messages. A handler that *reverts* a field (`setValue(field, oldValue)`) and then calls `showFieldMsg(field, …)` will lose the message. When you revert a field, show the message with `g_form.addErrorMessage()` (a top banner, not tied to the field) — or `showFieldMsg` on a *different* field. (`showFieldMsg` itself renders fine in the workspace; the revert is what clears it.)

## CRITICAL RULES

### 0. ALWAYS Provide a Description

Every client script MUST have a `description` field — both when **creating** and **updating**. The description should explain:
- **What** the script does
- **Why** it exists (business context)
- If `applies_extended = true`, which child tables it covers

When updating an existing client script, update the description to reflect the changes.

### 1. ALWAYS Use g_form API — NEVER Raw DOM

```javascript
// BAD — breaks in Mobile, Service Portal, Workspace
document.getElementById('incident.state').style.display = 'none';
element.options[2].remove();

// GOOD — works everywhere
g_form.setDisplay('state', false);
g_form.removeOption('state', '2');
```

### 2. ALWAYS Ship All Project Languages

Every `sys_ui_message` record MUST be created in the project source language AND every configured target language (`product.config.json` → `language.source` / `language.targets`). No exceptions.

```javascript
// Example for a source "en" + target "de" project:
{ key: 'my.message.key', en: 'English text', de: 'German text' }
```

### 3. ES5 Only for Server-Side, ES6 OK for Client Scripts

Client scripts run in modern browsers so ES6 is fine. Server-side global-scope scripts (Business Rules, Script Includes) run on Rhino and must use ES5 — but match the conventions of the file you're editing; scoped apps may support modern JS.

### 4. NO Glide API in Client Scripts

**GlideDateTime, GlideRecord, GlideAggregate, and all other Glide server-side APIs are NOT available in client scripts.** Client scripts run in the browser — only `g_form`, `g_user`, `g_list`, `GlideAjax`, `getMessage()`, and standard JavaScript APIs are available.

```javascript
// ❌ WRONG — GlideDateTime is server-side only, throws ReferenceError in client
var now = new GlideDateTime().getValue();

// ❌ WRONG — GlideRecord is server-side only
var gr = new GlideRecord('incident');

// ✅ CORRECT — use GlideAjax to call a Script Include
var ga = new GlideAjax('x_acme_fm.MyFooAjax');
```

For date/time comparisons on field values, do NOT reach for `new Date()` on the client — field values come back in display format (see Project Rules above). Send the value to the server via GlideAjax and compare with `GlideDateTime.setDisplayValue()` there.

If you need server-side data or logic in a client script, use `GlideAjax` to call a Script Include (see Pattern 8).

---

## Client Script Types

| Type | When it Runs | Use Case |
|------|-------------|----------|
| `onLoad` | Form loads | Set defaults, hide/show fields, initial setup |
| `onChange` | Field value changes | React to user input, cascading updates |
| `onSubmit` | Form submitted | Validation before save |
| `onCellEdit` | List cell edited | Validate inline edits |

---

## CRITICAL: sys_script_client Field Names for create_artifact

When creating client scripts via the Agent API `create_artifact` command, these are the **exact column names** on `sys_script_client`:

| Column Name | Description | Values | CRITICAL NOTES |
|-------------|-------------|--------|----------------|
| `name` | Display name | String | Required |
| `table` | Target table | e.g., `x_acme_fm_case` | Required |
| `type` | Script type | `onLoad`, `onChange`, `onSubmit`, `onCellEdit` | Required |
| `field` | onChange field | e.g., `state` | **NOT `fieldname`!** Only for onChange |
| `script` | The JavaScript | String | Required |
| `messages` | Keys to preload | One key per line (newline-separated) | For getMessage() |
| `ui_type` | Where it runs | `0`=Desktop, `1`=Mobile, **`10`=All** | **USE `10` FOR WORKSPACE!** |
| `active` | Enabled | `true`/`false` | String values |
| `view` | Form view filter | e.g., `case_closure_modal` | Optional — restricts to view |
| `sys_scope` | Application scope | sys_id | Set by scope parameter |
| `applies_extended` | Apply to child tables | `true`/`false` | **Set `true` for parent table scripts!** (NOT `inherited`) |
| `description` | Description text | String | **MANDATORY — always provide!** |

### Common Mistakes When Creating via Agent API

```json
// BAD — field column is called "field", NOT "fieldname"
{ "fieldname": "state" }   // WRONG — column doesn't exist, value silently ignored!
{ "field": "state" }        // CORRECT

// BAD — ui_type 0 is Desktop only, won't work in Workspace
{ "ui_type": "0" }          // Desktop only — WRONG for workspace modals!
{ "ui_type": "10" }         // All UIs — CORRECT

// BAD — missing field for onChange scripts
{ "type": "onChange" }                          // onChange without field = never fires!
{ "type": "onChange", "field": "state" }        // CORRECT
```

### Example: Creating an onChange Client Script via Agent API

```json
{
  "id": "create_cs1",
  "command": "create_artifact",
  "params": {
    "table": "sys_script_client",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "ACME - My onChange script",
      "table": "x_acme_fm_case",
      "type": "onChange",
      "field": "state",
      "ui_type": "10",
      "active": "true",
      "description": "Explains what this script does and why it exists.",
      "view": "my_form_view",
      "script": "function onChange(control, oldValue, newValue, isLoading, isTemplate) {\n    if (isLoading) return;\n    // logic here\n}"
    }
  }
}
```

### Example: Creating an applies_extended onLoad Script via Agent API

```json
{
  "id": "create_cs2",
  "command": "create_artifact",
  "params": {
    "table": "sys_script_client",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "ACME - Hide journal fields on new record",
      "table": "x_acme_fm_task",
      "type": "onLoad",
      "ui_type": "10",
      "active": "true",
      "applies_extended": "true",
      "description": "Hides journal fields on new record forms. View rules only apply to existing records, so this covers the new record case. Applies to all child tables via applies_extended.",
      "script": "function onLoad() {\n    if (g_form.isNewRecord()) {\n        g_form.setVisible('work_notes', false);\n        g_form.setVisible('comments', false);\n    }\n}"
    }
  }
}
```

---

## onChange Function Signature

```javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
    if (isLoading || newValue === '') {
        return;
    }
    // Your logic here
}
```

| Parameter | Description |
|-----------|-------------|
| `control` | The form element that changed |
| `oldValue` | Value BEFORE the change |
| `newValue` | Value AFTER the change |
| `isLoading` | True if form is loading (ALWAYS skip logic) |
| `isTemplate` | True if loading from template |

### Preventing Infinite Loops

When `g_form.setValue()` is called inside onChange, it triggers onChange again:

```javascript
if (isLoading || newValue === '' || oldValue === newValue) {
    return;
}
```

**Important:** Do NOT use `g_form.setValue()` to reset state fields on validation failure. Let the Business Rule handle validation with `setAbortAction()` instead.

---

## g_form API Reference

### Field Value Methods

| Method | Description | Example |
|--------|-------------|---------|
| `getValue(field)` | Get field value | `g_form.getValue('state')` |
| `setValue(field, value)` | Set field value | `g_form.setValue('state', '1')` |
| `setValue(field, value, displayValue)` | Set reference field | `g_form.setValue('caller_id', sysId, 'John')` |
| `clearValue(field)` | Clear field value | `g_form.clearValue('description')` |
| `getIntValue(field)` | Get as integer | `g_form.getIntValue('priority')` |
| `getDecimalValue(field)` | Get as decimal | `g_form.getDecimalValue('u_amount')` |
| `getBooleanValue(field)` | Get as boolean | `g_form.getBooleanValue('active')` |
| `getDisplayValue(field)` | Get display value | `g_form.getDisplayValue('state')` |

### Field Display Methods

| Method | Description | Example |
|--------|-------------|---------|
| `setDisplay(field, show)` | Show/hide field + label (reclaims space) | `g_form.setDisplay('comments', false)` |
| `setVisible(field, show)` | Show/hide field only (label may remain) | `g_form.setVisible('comments', false)` |
| `setReadOnly(field, readOnly)` | Make read-only/editable | `g_form.setReadOnly('state', true)` |
| `setDisabled(field, disabled)` | Disable/enable field | `g_form.setDisabled('priority', true)` |
| `setMandatory(field, mandatory)` | Make required/optional | `g_form.setMandatory('description', true)` |
| `setLabelOf(field, label)` | Change field label | `g_form.setLabelOf('state', 'Status')` |
| `getLabelOf(field)` | Get field label | `g_form.getLabelOf('state')` |

**setDisplay vs setVisible:**
- `setDisplay(field, false)` — Hides field AND label, space is reclaimed
- `setVisible(field, false)` — Hides field only, label may remain

### Choice List Methods

| Method | Description | Example |
|--------|-------------|---------|
| `addOption(field, value, label)` | Add option | `g_form.addOption('state', '10', 'Custom')` |
| `addOption(field, value, label, index)` | Add at position | `g_form.addOption('state', '10', 'Custom', 0)` |
| `removeOption(field, value)` | Remove option | `g_form.removeOption('state', '6')` |
| `clearOptions(field)` | Remove ALL options | `g_form.clearOptions('category')` |
| `getOption(field, value)` | Get option element | `g_form.getOption('state', '1')` |

### Message Methods

| Method | Description | Example |
|--------|-------------|---------|
| `addInfoMessage(msg)` | Blue info banner (top) | `g_form.addInfoMessage('Saved')` |
| `addErrorMessage(msg)` | Red error banner (top) | `g_form.addErrorMessage('Failed')` |
| `clearMessages()` | Clear all banners | `g_form.clearMessages()` |
| `showFieldMsg(field, msg, type)` | Message under field | `g_form.showFieldMsg('state', 'Required', 'error')` |
| `hideFieldMsg(field)` | Hide field message | `g_form.hideFieldMsg('state')` |
| `hideFieldMsg(field, true)` | Hide ALL field messages | `g_form.hideFieldMsg('state', true)` |
| `showErrorBox(field, msg)` | Error box under field | `g_form.showErrorBox('email', 'Invalid')` |
| `hideErrorBox(field)` | Hide error box | `g_form.hideErrorBox('email')` |

**showFieldMsg types:** `'info'` (blue), `'error'` (red), `'warning'` (yellow)

### Section Methods

| Method | Description | Example |
|--------|-------------|---------|
| `setSectionDisplay(section, show)` | Show/hide section | `g_form.setSectionDisplay('notes', false)` |
| `getSectionNames()` | Get all section names | `g_form.getSectionNames()` |
| `isSectionVisible(section)` | Check if visible | `g_form.isSectionVisible('notes')` |
| `activateTab(section)` | Activate tab | `g_form.activateTab('notes')` |

### Reference Field Methods

```javascript
// WRONG — getReference is ASYNC, returns undefined synchronously!
var user = g_form.getReference('caller_id');
alert(user.name);  // undefined!

// CORRECT — use callback
g_form.getReference('caller_id', function(user) {
    alert(user.name);  // Works!
    g_form.setValue('u_caller_email', user.email);
});
```

### Form State Methods

| Method | Description | Example |
|--------|-------------|---------|
| `isNewRecord()` | Is this a new record? | `g_form.isNewRecord()` |
| `getTableName()` | Get table name | `g_form.getTableName()` |
| `getUniqueValue()` | Get sys_id | `g_form.getUniqueValue()` |
| `getViewName()` | Get current view name | `g_form.getViewName()` |
| `isReadOnly()` | Is form read-only? | `g_form.isReadOnly()` |
| `save()` | Save the record | `g_form.save()` |
| `submit()` | Submit the form | `g_form.submit()` |

### Platform Availability

| Method | Desktop | Mobile | Service Portal | Workspace |
|--------|---------|--------|----------------|-----------|
| getValue/setValue | Yes | Yes | Yes | Yes |
| setDisplay/setVisible | Yes | Yes | Yes | Yes |
| setMandatory/setReadOnly | Yes | Yes | Yes | Yes |
| addOption/removeOption | Yes | Yes | Yes | Yes |
| addInfoMessage/addErrorMessage | Yes | Yes | Partial | Partial |
| showFieldMsg | Yes | Yes | Partial | Partial |
| flash | Yes | No | No | No |
| getControl | Yes | No | No | No |

---

## Client-Side getMessage()

### The Problem
Server-side uses `gs.getMessage()`, client-side uses `getMessage()` — they're different functions.

### Setup: Preload Message Keys
On the Client Script form, fill the **Messages** field with keys (one per line):
```
<namespace>.case_selection.category_required
<namespace>.case_selection.option_not_relevant
```

### Usage in Script
```javascript
g_form.addErrorMessage(getMessage('<namespace>.case_selection.category_required'));
g_form.showFieldMsg('field_name', getMessage('my.field.error'), 'error');
```

### Why Preload?
If you don't preload the key in the Messages field, `getMessage()` returns the key itself on first call because the translation hasn't been fetched yet.

### Creating sys_ui_message Records
Always create every project language (example: source `en` + one target language; adjust to `product.config.json` → `language`):
```javascript
// Background script to create messages — example with target language "de"
var messages = [
    { key: '<namespace>.close.describe_handling', en: 'Describe how the case was handled.', de: '<translated text>' },
    { key: '<namespace>.close.added_to_log', en: 'The note will be added to the log.', de: '<translated text>' }
];

messages.forEach(function(msg) {
    ['en', 'de'].forEach(function(lang) {
        var gr = new GlideRecord('sys_ui_message');
        gr.addQuery('key', msg.key);
        gr.addQuery('language', lang);
        gr.query();
        if (!gr.hasNext()) {
            gr.initialize();
            gr.setValue('key', msg.key);
            gr.setValue('language', lang);
            gr.setValue('message', msg[lang]);
            gr.insert();
        }
    });
});
```

---

## Applies Extended — Client Scripts on Parent → Child Tables

A client script on a **parent table** (e.g., `x_acme_fm_task`) can automatically fire on all **child tables** (e.g., `x_acme_fm_case`) by setting the `applies_extended` field to `true`.

**The field is called `applies_extended`, NOT `inherited`.**

### Key Rules

- **`applies_extended = false` (default)**: Script only fires on the exact table it's assigned to
- **`applies_extended = true`**: Script fires on the assigned table AND all extending child tables
- Works in both Desktop and Workspace (as long as `ui_type = "10"`)
- Use `g_form.getTableName()` inside the script if behavior should differ per child table

### Example: Hide journal fields on new records across all child tables

```javascript
// Table: x_acme_fm_task | applies_extended: true | Type: onLoad | UI Type: All (10)
function onLoad() {
    if (g_form.isNewRecord()) {
        g_form.setVisible('work_notes', false);
        g_form.setVisible('comments', false);
    }
}
```

### Example: Per-table logic in applies_extended script

```javascript
// Table: task | applies_extended: true | Type: onLoad | UI Type: All (10)
function onLoad() {
    var table = g_form.getTableName();
    if (table === 'incident') {
        g_form.setMandatory('category', true);
    } else if (table === 'change_request') {
        g_form.setMandatory('justification', true);
    }
}
```

### Gotchas

| Issue | Solution |
|-------|----------|
| Extended script conflicts with child-table-specific script | Use `g_form.getTableName()` guards or consolidate into one script |
| Can't hide a mandatory field | Call `g_form.setMandatory(field, false)` before `g_form.setVisible(field, false)` |
| Script runs on child tables you didn't expect | Add explicit table checks with `g_form.getTableName()` |

---

## Common Patterns

### Pattern 1: Conditional Field Visibility (onChange)

```javascript
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;

    // Hide all dependent fields first
    g_form.setDisplay('field_a', false);
    g_form.setDisplay('field_b', false);

    // Show based on selection
    if (newValue == 'option1') {
        g_form.setDisplay('field_a', true);
    } else if (newValue == 'option2') {
        g_form.setDisplay('field_b', true);
    }
}
```

### Pattern 2: Clear Hidden Fields

When hiding fields, clear their values to prevent stale data:

```javascript
if (newValue != 'option1') {
    g_form.setDisplay('field_a', false);
    g_form.setValue('field_a', '');
}
```

### Pattern 3: Filter Choice Options (onLoad)

```javascript
function onLoad() {
    // Remove states user shouldn't see
    g_form.removeOption('state', '7');
    g_form.removeOption('state', '8');
}
```

### Pattern 4: Placeholder Option with Mandatory Enforcement

Add a "none" placeholder to force user selection — `setMandatory` blocks submission on empty value. Placeholder label via `getMessage()` so it ships in all project languages:

```javascript
function onLoad() {
    // Remove unwanted options
    g_form.removeOption('state', '0');
    g_form.removeOption('state', '1');

    // Add placeholder and select it
    g_form.addOption('state', '', getMessage('<namespace>.state.choose_placeholder')); // e.g. "-- Select a status --"
    g_form.setValue('state', '');
    g_form.setMandatory('state', true);
}

// In onChange — remove placeholder once user makes a real choice
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;
    if (newValue) {
        g_form.removeOption('state', '');
    }
}
```

### Pattern 5: Dynamic Field Messages per Choice

```javascript
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;

    // Clear previous messages
    g_form.hideFieldMsg('state');
    g_form.hideFieldMsg('comments');

    if (!newValue) {
        g_form.setVisible('comments', false);
        return;
    }

    g_form.setVisible('comments', true);
    g_form.setMandatory('comments', true);

    if (newValue === '3') {
        g_form.showFieldMsg('comments', getMessage('<namespace>.state.describe_resolution'), 'info');
    } else if (newValue === '4') {
        g_form.showFieldMsg('state', getMessage('<namespace>.state.consider_completing'), 'info');
        g_form.showFieldMsg('comments', getMessage('<namespace>.state.explain_cancellation'), 'info');
    }
}
```

### Pattern 6: View-Scoped Client Scripts

Restrict client scripts to specific form views:

```javascript
function onLoad() {
    var view = g_form.getViewName();
    if (view !== 'my_custom_view') {
        return;
    }
    // Logic only runs on this view
}
```

**Also set the `view` field on the client script record itself** for double protection.

### Pattern 7: State Transition Validation (Client-Side Feedback)

Show error messages for invalid transitions. Do NOT reset state client-side — let Business Rules handle `setAbortAction()`:

```javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
    if (isLoading || newValue === '') return;

    if (oldValue !== '0') return;

    var category = g_form.getValue('u_category');
    if (!category) {
        g_form.showFieldMsg('u_category', getMessage('my.error.category_required'), 'error');
    }
}
```

### Pattern 8: GlideAjax Server Communication

**CRITICAL: In scoped apps, ALWAYS use the full `api_name` with scope prefix.** Without it, the call **silently fails** — no error, callback never returns real data.

```javascript
// ❌ WRONG — silently fails in scoped apps
var ga = new GlideAjax('MyScriptInclude');

// ✅ CORRECT — use full api_name from sys_script_include.api_name
var ga = new GlideAjax('x_acme_fm.MyScriptIncludeAjax');
```

```javascript
// Client Script
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading || !newValue) return;

    // ALWAYS use scoped api_name for GlideAjax in scoped apps
    var ga = new GlideAjax('x_acme_fm.MyScriptInclude');
    ga.addParam('sysparm_name', 'getUserDetails');
    ga.addParam('sysparm_user_id', newValue);
    ga.getXMLAnswer(function(response) {
        var data = JSON.parse(response);
        g_form.setValue('location', data.location);
    });
}

// Server-side Script Include (ES5!)
var MyScriptInclude = Class.create();
MyScriptInclude.prototype = Object.extendsObject(AbstractAjaxProcessor, {
    getUserDetails: function() {
        var userId = this.getParameter('sysparm_user_id');
        var gr = new GlideRecord('sys_user');
        if (gr.get(userId)) {
            return JSON.stringify({
                location: gr.getValue('location'),
                department: gr.getValue('department')
            });
        }
        return JSON.stringify({});
    },
    type: 'MyScriptInclude'
});
```

---

## g_user Object

```javascript
var userName = g_user.userName;      // User name
var userID = g_user.userID;          // sys_id
var firstName = g_user.firstName;    // First name
var lastName = g_user.lastName;      // Last name
var fullName = g_user.getFullName(); // Full name

// Role checks
if (g_user.hasRole('admin')) { }
if (g_user.hasRole('itil')) { }
if (g_user.hasRoleExactly('incident_manager')) { }  // No admin override
if (g_user.hasRoleFromList('itil,incident_manager')) { }
```

---

## Common Mistakes

| Mistake | Problem | Solution |
|---------|---------|----------|
| Using `fieldname` in create_artifact | Column is `field`, value silently ignored | Use `"field": "state"` |
| `ui_type: "0"` for workspace scripts | Desktop only, won't fire in workspace | Use `"ui_type": "10"` (All) |
| Missing `field` on onChange | Script never fires | Always set `field` for onChange type |
| Forgetting `isLoading` check | Script runs unnecessarily on load | Always `if (isLoading) return;` |
| Raw DOM manipulation | Breaks in Workspace/Mobile/Portal | Use g_form API exclusively |
| `g_form.setValue()` in onChange without loop guard | Infinite loop | Add `oldValue === newValue` check |
| Resetting state in client script | Conflicts with Business Rule abort | Let BR handle `setAbortAction()` |
| Using `GlideDateTime` in client script | Server-side only, throws ReferenceError | Compare dates server-side via GlideAjax |
| Using `GlideRecord` in client script | Server-side only, not available in browser | Use `GlideAjax` to call a Script Include |
| Using `gs.getMessage()` client-side | Wrong API, doesn't exist on client | Use `getMessage()` + preload Messages field |
| Not preloading message keys | `getMessage()` returns key on first call | Fill Messages field on client script form |
| Missing target-language translations | UI shows source-language-only or raw keys | Create `sys_ui_message` records for every project language |
| Using `getControl()` | Desktop-only, breaks everywhere else | Use g_form methods instead |
| Synchronous `getReference()` | Returns undefined, async only | Use callback: `g_form.getReference(field, callback)` |
| Forgetting `applies_extended` on parent table scripts | Script only fires on parent, not child tables | Set `"applies_extended": "true"` for parent table scripts |
| Missing description | No context for future developers | **Always** provide a description on create AND update |
| GlideAjax without scope prefix | **Silently fails** in scoped apps — no error, no data | Use full `api_name`: `x_acme_fm.MyAjax` not `MyAjax` |
| All logic in Ajax class | Can't reuse from BRs, ref quals, other server code | Use Utils + Ajax pattern: logic in Utils, Ajax is thin wrapper |

---

## Code Readability

ALL client scripts MUST be well-commented and easy to interpret:

1. **Comment the purpose** — explain what the script does and why, not just what each line does
2. **Comment non-obvious logic** — thresholds, mappings, formulas, business rules behind the code
3. **Use clear variable names** — `category` not `c`, `riskScore` not `r`, unless the formula is well-known
4. **Group logic with whitespace and section comments** — separate input gathering, validation, calculation, and output
5. **Inline-comment magic values** — if a value like `'3'` maps to "Moderate priority", say so

---

## Performance Best Practices

1. **Minimize server calls** — combine multiple GlideAjax calls into one
2. **Always check `isLoading`** — skip onChange logic during form load
3. **Debounce rapid changes** — use `setTimeout` for text field onChange

```javascript
var timeout;
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) return;
    clearTimeout(timeout);
    timeout = setTimeout(function() {
        performExpensiveOperation(newValue);
    }, 300);
}
```

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
