---
name: sp-widget-patterns
description: Invoke when the user mentions "service portal", "SP widget", "sp_widget", "portal page", "sp_page", "portal form", or when building anything in ServiceNow Service Portal. Covers widget creation, page layout chain, CSS patterns, server/client scripts, and known pitfalls.
---

# Service Portal Widget Patterns

Build and maintain ServiceNow Service Portal widgets and pages. SP uses the same OAuth session as the workspace — use it for any form that needs to be opened from a workspace button without a login prompt.

Placeholders used throughout: scope `x_acme_fm`, table `x_acme_fm_case`, instance `acmedev`. Substitute your engagement's values (see `product.config.json`).

---

## Why SP instead of sys_ui_page for workspace-opened forms

| | `sys_ui_page` (`.do`) | Service Portal |
|---|---|---|
| Auth | Requires classic JSESSIONID session | Shares workspace OAuth session |
| Opened from workspace button | Login prompt (session boundary) | No prompt — same session |
| Bootstrap | Must bring own CSS | Bootstrap 3 already loaded |

**Rule:** If a form is opened from a workspace button (`top.open()`), use Service Portal. A `sys_ui_page` will always prompt for login because the workspace and classic UI run on independent session stacks, even on the same domain.

---

## Widget Structure

An `sp_widget` has these code fields:

| Field | Purpose |
|---|---|
| `template` | Angular HTML template — rendered client-side |
| `client_script` | Angular controller (`api.controller = function($scope, $timeout) { ... }`) |
| `server_script` | Runs server-side before render; populates `data` object |
| `css` | SCSS/CSS scoped to this widget |

---

## Creating a Widget + Page (full chain)

### Step 1 — Create the widget (minimal, then batch-update content)

Example payload (agent API; scope value must be the application's **sys_id**, not its name):

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sp_widget",
    "scope": "<x_acme_fm scope sys_id>",
    "fields": {
      "name": "ACME - My Widget",
      "id": "acme_my_widget",
      "description": "Short description"
    }
  }
}
```

Then update each content field individually — see **Critical: PowerShell JSON assembly** below.

### Step 2 — Find the correct portal

**Never assume `/sp`.** Customers routinely run renamed or multiple portals. Always query first and record the result:

```json
{
  "command": "query_records",
  "params": {
    "table": "sp_portal",
    "query": "url_suffixLIKE<your portal suffix>",
    "fields": "title,url_suffix,sys_id"
  }
}
```

Record the portal's `url_suffix` and `sys_id` in this skill's Customer Project Rules section once discovered — every page create and every workspace button URL depends on them.

### Step 3 — Create the SP page

`name` is **required** alongside `id` and `title` (all three must be set):

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sp_page",
    "scope": "<x_acme_fm scope sys_id>",
    "fields": {
      "name": "my_page",
      "title": "My Page Title",
      "id": "my_page",
      "sp_portal": "<portal_sys_id>",
      "short_description": "..."
    }
  }
}
```

### Step 4 — Create the layout chain (sequential — each needs the previous sys_id)

```
sp_container  →  { sp_page, width: "12", order: "100" }
sp_row        →  { sp_container, order: "100" }
sp_column     →  { sp_row, order: "100", sp_widget: <widget_sys_id> }
sp_instance   →  { sp_column, sp_widget: <widget_sys_id>, order: "100" }
```

### Step 5 — Update button to open the portal page

```javascript
// Workspace button client_script_v2 — example; <portal_suffix> from Step 2
function onClick(g_form) {
    top.open('/<portal_suffix>?id=my_page&case_id=' + g_form.getUniqueValue(), '_blank');
}
```

---

## ⚠️ Critical: PowerShell JSON assembly for large content fields

**Never use `ConvertTo-Json` on a full hashtable when it contains large string values.**

PowerShell 5.1's `ConvertTo-Json -Depth N` on a hashtable can silently pull in PowerShell object metadata (FileSystemProvider class dumps, automation object internals) alongside the string content. The result gets stored in ServiceNow and renders as thousands of lines of garbage text on the page.

**Wrong:**
```powershell
$content = Get-Content "file.html" -Raw
$payload = @{ id="upd"; command="update_record"; params=@{ content=$content } } | ConvertTo-Json -Depth 5
# ConvertTo-Json on the hashtable can corrupt large string values
```

**Correct — apply `ConvertTo-Json` to the string only, then build JSON manually:**
```powershell
$content = [System.IO.File]::ReadAllText("file.html")  # ReadAllText avoids BOM/encoding issues
$contentJson = ConvertTo-Json $content                  # Escapes the string, gives "...escaped..."
$json = '{"id":"upd","command":"update_record","params":{"table":"sp_widget","sys_id":"' + $sysId + '","field":"template","content":' + $contentJson + '}}'
[System.IO.File]::WriteAllText("<agent-requests-dir>/req_upd.json", $json)  # your sn-scriptsync requests directory
```

This produces a correctly sized JSON (e.g. 33KB for 22KB of HTML, not 418KB).

---

## CSS: Use Bootstrap 3 — don't reinvent it

SP already loads Bootstrap 3. **Never write custom CSS for things Bootstrap already provides.** Use native Bootstrap classes in the template:

| Element | Bootstrap class |
|---|---|
| Text input / select / textarea | `form-control` |
| Form field wrapper | `form-group` |
| Field label | `control-label` |
| Two/three-column layout | `row` + `col-sm-6` / `col-sm-4` |
| Checkbox / radio | `checkbox` / `radio-inline` |
| Button | `btn btn-success btn-lg` |
| Collapsible card | `panel panel-default` + `panel-heading` + `panel-body` |

Keep the widget `css` field minimal — only add what Bootstrap doesn't cover (example; `#4a90d9` stands in for your customer's brand color):

```css
.panel-heading.my-toggle { background: #4a90d9; color: #fff; cursor: pointer; }
.my-subsection { background: #f9f9f9; border: 1px solid #ddd; padding: 12px; margin: 6px 0 12px 24px; display: none; }
.download-box { background: #dff0d8; border: 1px solid #d6e9c6; padding: 15px; text-align: center; }
.error-box { background: #f2dede; border: 1px solid #ebccd1; padding: 15px; color: #a94442; }
```

---

## Server Script

Reads URL parameters and pre-populates `data` for the client:

```javascript
(function() {
    var caseId = $sp.getParameter('case_id');
    data.case_id = caseId || '';
    data.case = {};
    if (caseId) {
        var gr = new GlideRecord('x_acme_fm_case');
        if (gr.get(caseId)) {
            data.case = {
                sys_created_on: gr.getValue('sys_created_on') || '',
                opened_by:      gr.getDisplayValue('opened_by') || '',
                company:        gr.getDisplayValue('company') || '',
                location:       gr.getDisplayValue('location') || ''
            };
        }
    }
})();
```

---

## Client Script

Angular controller pattern for SP widgets:

```javascript
api.controller = function($scope, $timeout) {
    var c = this;

    // Use $timeout to defer DOM manipulation — template renders AFTER controller init
    $timeout(function() {
        var rec = c.data.case || {};
        if (c.data.case_id && rec.sys_created_on) {
            // pre-populate form
        }
        // set up event listeners, toggles, etc.
    }, 300);

    // Expose functions to template via ng-click="c.myFn()"
    c.generatePDF = function() {
        var ga = new GlideAjax('x_acme_fm.MyScriptInclude');
        ga.addParam('sysparm_name', 'myMethod');
        ga.getXMLAnswer(function(answer) { /* handle response */ });
    };
};
```

**Key rules:**
- `$timeout(fn, 300)` is required before any `document.getElementById()` — the Angular template compiles after the controller runs
- Expose functions on `c` (the controller instance), reference as `ng-click="c.myFn()"` in template
- `GlideAjax` works in SP client scripts — use full scoped api_name: `x_acme_fm.MyClass`
- `c.data.*` is what the server script set on `data.*`
- **If server_script is unavailable**, read URL params directly from the client script: `window.location.search.match(/[?&]case_id=([^&]*)/)` — cleaner and avoids the server_script field restriction

---

## ⚠️ GlideAjax Scope Restriction from SP Portal

SP portal pages run GlideAjax in **global scope**, not the widget's scope. A `package_private` Script Include in your app scope **silently returns empty** — no logs, no error. The `access` field cannot be changed via `update_record` after creation (scope-level protection at the database). (Verify on your instance first.)

**Solution:** Create a thin **public wrapper Script Include** in the app scope using `create_artifact` with `access: "public"`. Creation honors this value; updates do not. The wrapper calls the real (package_private) SI server-side within the same scope.

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_script_include",
    "scope": "<x_acme_fm scope sys_id>",
    "fields": {
      "name": "MyPublicAjaxWrapper",
      "client_callable": "true",
      "access": "public",
      "active": "true",
      "script": "var MyPublicAjaxWrapper = Class.create();\nMyPublicAjaxWrapper.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {\n    myMethod: function() {\n        var si = new x_acme_fm.MyPrivateSI();\n        return si.doWork(this.getParameter('sysparm_data'));\n    },\n    type: 'MyPublicAjaxWrapper'\n});"
    }
  }
}
```

Widget calls `x_acme_fm.MyPublicAjaxWrapper` → wrapper calls `new x_acme_fm.MyPrivateSI()` server-side.

---

## ⚠️ Unicode Characters in Templates

**Never use actual Unicode special characters** in templates pushed via PowerShell — em dash, en dash, accented chars all render as garbled multi-byte sequences (e.g. `ÃƒÆ'Ã†â€™...`) because of encoding mismatch in the push pipeline.

**Always use HTML entities:**
- `—` → `&mdash;`
- `–` → `&ndash;`
- `é` → `&eacute;`

---

## ⚠️ `server_script` Cannot Be Updated After Creation

`update_record` on `sp_widget.server_script` silently succeeds but the value stays empty (verify on your instance first). It must be set in the **initial `create_artifact` payload**.

If `server_script` is empty and you need URL parameters, read them directly in the client script instead — this is actually simpler:

```javascript
var _caseId = (function() {
    var m = window.location.search.match(/[?&]case_id=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : '';
})();
```

---

## ⚠️ Large SIs (>~5KB) Fail via GlideAjax from SP Portal

Even with `access: public` set at creation, a Script Include with a large script (70KB+) returns empty from SP portal GlideAjax — no logs, no error. The same SI with a tiny script works fine. **Keep GlideAjax-callable SIs under ~5KB.** (Verify on your instance first.)

Move heavy logic (HTML generation, PDF page building) to either:
- A separate `package_private` SI called server-side from the tiny public wrapper
- The widget's client script (JavaScript, fully client-side)

---

## ⚠️ Renaming a Script Include Requires Updating the Script Too

When you rename a Script Include's `name` field, the `api_name` auto-updates (e.g. `x_acme_fm.NewName`). But the JavaScript class name inside the script and the `type` property **must also be updated manually** to match. If they don't match, GlideAjax returns empty with no error.

```javascript
// After renaming SI to "ACME_MyGenerator":
var ACME_MyGenerator = Class.create();               // ← must match
ACME_MyGenerator.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {
    ...
    type: 'ACME_MyGenerator'                         // ← must match
});
```

---

## Generic PDF Engine Pattern

The cleanest architecture for PDF generation from an SP form:

1. **Widget client script** — generates the full HTML document (CSS + pages) from form data using JavaScript helper functions (`buildPDFHtml(formData)`)
2. **Tiny public SI** — receives `html_content`, `target_table`, `record_sys_id`, `pdf_name`, `page_size`, `page_orientation` and calls `sn_pdfgeneratorutils.PDFGenerationAPI` (OOTB — verify the PDF Generation Utilities plugin is active on your instance). Zero form-specific logic.

```javascript
// Widget sends:
var payload = {
    target_table:     'x_acme_fm_case',
    record_sys_id:    _caseId,
    html_content:     buildPDFHtml(formData),
    pdf_name:         'MyForm_' + _caseId + '.pdf',
    page_size:        'A4',
    page_orientation: 'PORTRAIT'
};
var ga = new GlideAjax('x_acme_fm.ACME_PDFGenerator');
ga.addParam('sysparm_name', 'generatePDFAjax');
ga.addParam('sysparm_data', JSON.stringify(payload));

// Tiny SI receives:
var targetTable = data.target_table || 'x_acme_fm_case';
var html        = data.html_content;
pdfApi.convertToPDFWithHeaderFooter(html, targetTable, recordSysId, pdfName, {...}, '', {});
```

**Benefits:** SI is reusable for any form type. Different forms just pass different `html_content` and `target_table`. No hardcoded CSS, page layouts, or table names in the SI.

---

## Template Patching Pattern

To update a single string in a large template without rewriting it entirely:

```powershell
# 1. Fetch current template
$tpl = (query_records for sp_widget).template

# 2. Patch in PowerShell
$patched = $tpl.Replace('old text', 'new text')
# or for regex:
$patched = $tpl -replace 'pattern', 'replacement'

# 3. Push back
$tplJson = ConvertTo-Json $patched
# update_record with field=template, content=$tplJson
```

For garbled Unicode in existing templates: use a lazy regex anchored on the known surrounding text to swap the corrupted bytes for the HTML entity:
```powershell
# Example — replace whatever garbled sequence sits between two known words with the intended entity
$patched = $tpl -replace 'FirstWord.+?SecondWord', 'FirstWord&mdash;SecondWord'
```

---

## Event-Based Email from a Scoped SP Widget

The only reliable way to send email from a scoped Script Include (called via GlideAjax from SP) is `gs.eventQueue` → `sysevent_email_action` notification. All direct email APIs are blocked in scoped context.

### Working architecture

```
SP widget (client)
  → GlideAjax → scoped SI (x_acme_fm)
      → gs.eventQueue('x_acme_fm.pdf.submitted', null, toEmail, attachSysId)
          → sysevent (event queue)
              → sysevent_email_action notification (x_acme_fm scope)
                  → mail script: attach PDF, static recipient delivers email
```

### Critical rules — every one of these will silently break the flow if wrong

**1. `sysevent_register` must be in the SAME scope as the calling script.**
A scoped SI can only fire events registered in its own scope. Events in global scope are silently ignored by scoped `gs.eventQueue`. Create the registration with `scope: "<x_acme_fm scope sys_id>"`, not `scope: "global"`.

**2. The field is `event_name`, not `name`.**
`create_artifact` on `sysevent_register` requires `event_name` to be set explicitly. Setting only `name` leaves the Event name field empty and `gs.eventQueue` silently does nothing.

**3. `generation_type` must be `"event"`, not `"engine"`.**
On `sysevent_email_action`, `"engine"` = "Record inserted or updated" (not event-triggered). Use `"event"` = "Event is fired". Default from `create_artifact` is `"engine"` — always set it explicitly.

**4. The notification needs at least one static recipient.**
A notification with no `recipient_users`, `recipient_groups`, or `recipient_fields` is silently skipped before the mail script ever runs — even with `force_delivery: true`. Always define at least one static recipient. For an external email address (e.g. a regulator inbox like `ehs@example.gov`), create a ServiceNow user with that email and add them to `recipient_users`.

**5. The `message` field is for body/attachment, not dynamic `email.addAddress()`.**
`email.addAddress()` in the `message` mail script does NOT reliably add recipients. Use `recipient_users`/`recipient_fields` for recipients. Reserve the `message` script for attaching the PDF only:

```javascript
(function runMailScript(current, template, email, email_action, event) {
    var attachSysId = event ? event.parm2 : '';
    if (attachSysId) {
        var attachGr = new GlideRecord('sys_attachment');
        if (attachGr.get(attachSysId)) {
            var content = new GlideSysAttachment().getContent(attachGr);
            email.addAttachment(attachGr.getValue('content_type'), attachGr.getValue('file_name'), content);
        }
    }
})(current, template, email, email_action, event);
```

**6. `new global.ScopedClass()` does NOT work without cross-scope privilege.**
Even with `access: public` on the global SI, calling `new global.SomeGlobalEmailSender()` from a scoped SI throws "TypeError: undefined is not a function". Cross-scope privileges are complex to configure. Avoid this pattern — use the event queue approach instead.

**7. `update_record` silently fails when browser scope ≠ record scope.**
If the browser application context is your app scope but the target record is in `global` scope, `update_record` does nothing and returns success. Use a fix script (global scope) to update global-scope records like `sysevent_register`.

### Quick create checklist

```json
// 1. sysevent_register — MUST be in same scope as calling SI
{ "table": "sysevent_register", "scope": "<x_acme_fm scope sys_id>",
  "fields": { "name": "x_acme_fm.pdf.submitted", "event_name": "x_acme_fm.pdf.submitted", "fired_by": "..." }}

// 2. sys_user for external email recipient (example address)
{ "table": "sys_user", "scope": "global",
  "fields": { "name": "EHS Regulator Inbox", "user_name": "ehs_regulator", "email": "ehs@example.gov", "active": "true" }}

// 3. sysevent_email_action notification
{ "table": "sysevent_email_action", "scope": "<x_acme_fm scope sys_id>",
  "fields": { "name": "...", "event_name": "x_acme_fm.pdf.submitted",
              "generation_type": "event",   // ← CRITICAL: not "engine"
              "collection": "",             // empty = fires without record context
              "recipient_users": "<user_sys_id>",
              "active": "true", "subject": "...", "message_html": "...", "message": "<mail_script>" }}
```

---

## Pitfalls Summary

| Pitfall | Fix |
|---|---|
| `ConvertTo-Json` on hashtable with large string → garbage object metadata in template | Use `ConvertTo-Json` on the string only, assemble JSON manually |
| Opening `/sp?id=page` redirects to wrong portal homepage | Query `sp_portal` for the actual `url_suffix` used on the instance; never hardcode `/sp` |
| `sp_page` `create_artifact` fails with "Missing required field: name" | `name`, `title`, and `id` are all required — set all three |
| Widget renders with broken layout / Bootstrap overrides custom CSS | Use Bootstrap 3 native classes; write no custom CSS for things Bootstrap covers |
| DOM manipulation in client script fails — elements not found | Wrap in `$timeout(fn, 300)` — Angular template renders after controller init |
| `server_script` empty after creation | Must be in initial `create_artifact` payload — cannot be set via `update_record`; read URL params in client script instead |
| GlideAjax from SP portal returns empty, no logs | SI is `package_private` OR script is too large (>5KB). Create a tiny public wrapper via `create_artifact` |
| GlideAjax returns empty after renaming SI | Class name and `type` in the script must match the new `api_name` — update the script content after renaming |
| Large SI (70KB+) with `access: public` still returns empty | GlideAjax has a size limit for scoped SIs. Move HTML generation to widget client script |
| Unicode chars in template render as garbled text | Use HTML entities: `&mdash;`, `&ndash;`, `&eacute;` etc. |
| `access` field cannot be changed on Studio-created SI | Platform-level lock — create a new SI via `create_artifact` with `access: public` instead |
| `document.querySelectorAll('.my-class')` returns 0 results | SP scopes widget CSS but NOT DOM IDs/classes — check `$timeout` delay |
| `gs.eventQueue` from scoped SI fires but event never appears in `sysevent` | Event registration is in global scope — scoped apps can only fire events registered in their OWN scope. Create `sysevent_register` with the app scope's sys_id. |
| `sysevent_register` created with `event_name` still empty | Field is `event_name` not `name`. Always set both `name` and `event_name` in `create_artifact`. If browser scope ≠ record scope, use a fix script to update. |
| Notification never fires despite event appearing in `sysevent` | `generation_type` is `"engine"` (record-based) instead of `"event"`. Always set `generation_type: "event"` explicitly. |
| Notification fires but no email generated | No static recipients defined. Add at least one `recipient_users` or `recipient_fields` — `force_delivery` does NOT bypass the zero-recipient check. |
| `email.addAddress()` in mail script ignored — only static recipient gets email | `message` field is for body/attachment content, not recipient control. Use `recipient_users` for static addresses; create a `sys_user` for external email addresses. |
| `new global.MyGlobalSI()` throws "undefined is not a function" | Cross-scope privilege not configured. Even `access: public` is insufficient without explicit privilege. Use event queue pattern instead. |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
