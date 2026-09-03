---
name: ui-page-patterns
description: Invoke when the user asks to "create UI page", "sys_ui_page", "Jelly page", "standalone form", "PDF generation page", or when building any classic ServiceNow UI Page. Covers HTML/Jelly template, client script, processing script, GlideAjax, PDF generation, and known pitfalls.
---

# UI Page Patterns — sys_ui_page

Build and maintain ServiceNow classic UI Pages (`.do` URLs) — standalone HTML pages rendered by the Jelly engine, with server-side processing and client-side JavaScript.

Placeholders used throughout: scope `x_acme_fm`, page `case_checklist`, table `x_acme_fm_case`, Script Include `AcmePDFGeneratorAjax`, instance `acmedev`, default language `<default_lang>`. These are **examples** — substitute values from `product.config.json` (`scopes.app`, `instances.dev`, `language.source`).

## Structure

A `sys_ui_page` record has three code fields:

| Field | Type | Purpose |
|---|---|---|
| `html` | Jelly template | The page HTML — rendered server-side. Can use `${variable}` and `<g:evaluate>` Jelly tags. |
| `client_script` | Plain JavaScript | Runs in the browser after the page loads. NOT a Jelly template — just JS. |
| `processing_script` | Server-side JavaScript | Runs before rendering. Use to set variables accessible in the Jelly HTML template. |

**Access:** `/page_name.do` — e.g. `/case_checklist.do?id=<sys_id>` (see the scoped-URL pitfall below).

**Scope:** UI Pages live in a scope (`x_acme_fm`, `global`, etc.). The scope affects which Script Includes are callable.

---

## Creating a UI Page

Use `create_artifact` with all fields in one payload:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ui_page",
    "scope": "<scope_sys_id>",
    "fields": {
      "name": "my_page",
      "description": "Short description",
      "html": "<?xml version=\"1.0\" encoding=\"utf-8\" ?><j:jelly trim=\"false\" xmlns:j=\"jelly:core\" xmlns:g=\"glide\" xmlns:j2=\"null\" xmlns:g2=\"null\"><html>...</html></j:jelly>",
      "client_script": "// your JS here",
      "processing_script": "// server-side JS here"
    }
  }
}
```

Pass the **scope sys_id**, never the scope name string — see the wiki's hard-rules page.

---

## Critical: Updating Fields via `update_record`

`update_record` works cleanly for `sys_ui_page` fields **only when the JSON request is written directly** (e.g. using the Write tool). Using PowerShell's `ConvertTo-Json` to serialize the request body **wraps the content in `{value=...}` notation**, which stores literally in the database and causes a JavaScript compile error on the `client_script` field.

**Rule:** Always write the `update_record` request JSON with the Write tool — never via `ConvertTo-Json`.

```json
// CORRECT — Write tool creates this file directly
{
  "id": "upd",
  "command": "update_record",
  "params": {
    "table": "sys_ui_page",
    "sys_id": "<sys_id>",
    "field": "client_script",
    "scope": "x_acme_fm",
    "content": "var x = 1; // plain JS"
  }
}
```

**If `{value=}` corruption occurs:** use a global-scope fix script with GlideRecord to clear or reset the field — the UI won't let you save while the compile error exists:

```javascript
// Fix script (global scope) — clears corrupted client_script
var gr = new GlideRecord('sys_ui_page');
if (gr.get('<sys_id>')) {
    gr.setValue('client_script', '');
    gr.autoSysFields(false);
    gr.setWorkflow(false); // targeted repair — re-capture the real fix afterwards
    gr.update();
    gs.print('Cleared: ' + gr.getValue('client_script'));
}
```

**Why global scope:** scoped fix scripts can't always update `sys_ui_page` records due to ACLs. Always use global scope for GlideRecord fixes on `sys_ui_page`.

---

## File-Based Sync Pitfall

The `sys_ui_page` table folder (`acmedev/x_acme_fm/sys_ui_page/`) is **not automatically watched** by sn-scriptsync unless it already exists from a previous sync. Creating the folder manually and writing files into it will **not** trigger a sync — `sync_now` reports "No pending files."

**Workaround:** use `update_record` with the Write tool (see above), or a global fix script.

---

## HTML Template (Jelly)

The `html` field must be a valid Jelly document:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<j:jelly trim="false" xmlns:j="jelly:core" xmlns:g="glide" xmlns:j2="null" xmlns:g2="null">
<html lang="<default_lang>">
<head>
    <meta charset="UTF-8"/>
    <style>/* your CSS */</style>
</head>
<body>
    <!-- inject server-side variable from processing_script -->
    <script>var userLang = '${userLang}';</script>
    <!-- form content -->
</body>
</html>
</j:jelly>
```

To pass server-side data to the client, set variables in `processing_script` and reference them as `${variableName}` in the HTML template.

---

## Processing Script

Runs server-side before the page renders. Variables set here are available in the Jelly template:

```javascript
// processing_script
var userLang = gs.getSession().getLanguage() || '<default_lang>';
var caseId = RP.getParameterValue('id') || '';
```

Then in HTML: `<script>var _lang = '${userLang}';</script>`

---

## Client Script Patterns

### Language detection

`g_user_language` is unreliable on `.do` pages. Use this order (example assumes two project languages; `<default_lang>` is the fallback):

```javascript
var _lang = '<default_lang>';
try {
    var _l = (window.NOW && window.NOW.user && window.NOW.user.language) ||
             (typeof g_user_language !== 'undefined' ? g_user_language : null) ||
             document.documentElement.lang || '<default_lang>';
    _lang = String(_l).toLowerCase().substring(0, 2);
    if (_lang !== '<other_lang>') _lang = '<default_lang>'; // clamp to supported set
} catch(e) { _lang = '<default_lang>'; }
```

### Reading URL parameters

```javascript
var caseId = (function() {
    var m = window.location.search.match(/[?&]id=([^&]*)/);
    return m ? decodeURIComponent(m[1]) : null;
})();
```

### Collect / restore form data

```javascript
function collectFormData() {
    var data = {}, inputs = document.getElementById('myForm').querySelectorAll('input,select,textarea');
    for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i]; if (!el.name) continue;
        if (el.type === 'checkbox')   { if (el.checked) data[el.name] = 'true'; }
        else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
        else                          { if (el.value)   data[el.name] = el.value; }
    }
    return data;
}

function restoreFormData(data) {
    if (!data) return;
    var inputs = document.getElementById('myForm').querySelectorAll('input,select,textarea');
    for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i]; if (!el.name || data[el.name] === undefined) continue;
        if (el.type === 'checkbox')   { el.checked = data[el.name] === 'true'; el.dispatchEvent(new Event('change')); }
        else if (el.type === 'radio') { el.checked = data[el.name] === el.value; }
        else                          { el.value = data[el.name]; }
    }
}
```

### Pre-populate from a ServiceNow record

```javascript
if (caseId) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/now/table/x_acme_fm_case/' + caseId +
        '?sysparm_display_value=all&sysparm_fields=sys_created_on,opened_by,opened_by.name', true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = function() {
        if (xhr.status !== 200) return;
        var rec = JSON.parse(xhr.responseText).result;
        function dv(f) { return rec[f] && rec[f].display_value ? rec[f].display_value : ''; }
        restoreFormData({ requester_name: dv('opened_by') });
    };
    xhr.send();
}
```

### Calling a Script Include (GlideAjax)

Always use the **full scoped api_name** (`x_acme_fm.AcmePDFGeneratorAjax`) — without the scope prefix the call fails silently:

```javascript
var ga = new GlideAjax('x_acme_fm.AcmePDFGeneratorAjax');
ga.addParam('sysparm_name', 'generatePDFAjax');
ga.addParam('sysparm_data', JSON.stringify(data));
ga.getXMLAnswer(function(answer) {
    var parsed = JSON.parse(answer);
    if (parsed.status === 'ok') {
        // success
    }
});
```

### localStorage persistence

```javascript
// Save on submit
localStorage.setItem('my_page_data', JSON.stringify(collectFormData()));

// Restore on load
var saved = localStorage.getItem('my_page_data');
if (saved) { try { restoreFormData(JSON.parse(saved)); } catch(e) {} }
```

---

## PDF Generation via Script Include

Use `sn_pdfgeneratorutils.PDFGenerationAPI` server-side (in a Script Include extending `AbstractAjaxProcessor`):

```javascript
generatePDF: function(data, targetTable, targetSysId) {
    var html = this.generateHTML(data); // your HTML string
    var pdfApi = new sn_pdfgeneratorutils.PDFGenerationAPI();
    var attachment = pdfApi.convertToPDFWithHeaderFooter(
        html,
        targetTable,
        targetSysId,
        'MyReport.pdf',
        { PageSize: 'A4', PageOrientation: 'PORTRAIT', GeneratePageNumber: 'true',
          TopOrBottomMargin: '15', LeftOrRightMargin: '15' },
        '', {}
    );
    return (attachment && attachment.attachment_id) ? attachment.attachment_id : '';
},
```

**PDF HTML tips:**
- Use inline CSS only (no external stylesheets)
- Avoid modern CSS (flexbox, grid) — stick to `table`-based layout for reliable PDF rendering
- Checkboxes: use `☑` (`&#9745;`) and `☐` (`&#9744;`) as characters, not `<input type="checkbox">`
- Use `page-break-after: always` on a `<div>` for page breaks

---

## Opening a UI Page from a Workspace Button

A declarative action with a `client_script_v2` opens the page in a new tab, passing the record sys_id:

```javascript
// Workspace button client script
function onClick() {
    window.open('/case_checklist.do?id=' + g_form.getUniqueValue(), '_blank');
}
```

(But see the two workspace-specific corrections below — scoped URL prefix and `top.open`.)

---

## Opening a Scoped UI Page from a Workspace Button

UI Pages in a scoped app are **NOT** accessible at `/<name>.do` — they require the scope prefix: `/<scope>_<name>.do`.

```javascript
// WRONG — returns "Page not found" for scoped pages
top.open('/case_checklist.do?id=' + g_form.getUniqueValue(), '_blank');

// CORRECT — includes scope prefix
top.open('/x_acme_fm_case_checklist.do?id=' + g_form.getUniqueValue(), '_blank');
```

## Workspace Button Client Script Rules

When opening a UI Page from a workspace `client_script_v2`:

- **Use `top.open()` not `window.open()`** — `window` is null in the workspace scoped execution context. `top.open(url, '_blank')` accesses the real browser window.
- **Use JavaScript conditions, not encoded query** — `sys_ui_action.condition` in workspace is evaluated as GlideScript JS, not encoded query. `category=10` will never match; use `current.category == '10'` instead.

```javascript
// Correct workspace client_script_v2
function onClick(g_form) {
    top.open('/x_acme_fm_case_checklist.do?id=' + g_form.getUniqueValue(), '_blank');
}
```

```
// Correct condition (JavaScript, not encoded query)
current.category == '10'

// Wrong condition (encoded query format — silently never matches in workspace)
category=10
```

## Pitfalls Summary

| Pitfall | Fix |
|---|---|
| `update_record` via PowerShell `ConvertTo-Json` stores `{value=...}` in `client_script` | Write the JSON request directly with the Write tool |
| `client_script` won't save due to `{value=}` compile error | Global-scope fix script with GlideRecord to clear the field first |
| New `sys_ui_page` folder not watched by sn-scriptsync | Use `update_record` via the agent API instead of file-based sync |
| `g_user_language` returns wrong or null value on `.do` pages | Use `window.NOW.user.language` as primary source |
| Scoped fix script can't update `sys_ui_page` records | Always use **global scope** for GlideRecord fixes on `sys_ui_page` |
| `{value=}` in the `html` field is expected Jelly syntax — in `client_script` it's a bug | `html` is a Jelly template; `client_script` is plain JS — never mix them |
| Scoped UI page returns "Page not found" when opened from a workspace button | Use the `/<scope>_<name>.do` URL prefix, e.g. `/x_acme_fm_case_checklist.do` |
| `window.open()` throws "Cannot read properties of null" in workspace client script | Use `top.open(url, '_blank')` instead |
| Encoded query condition (`category=10`) on workspace `sys_ui_action` never matches | Use a JavaScript condition: `current.category == '10'` |
| Opening a UI page via direct URL shows a login prompt even with an active session | Set `direct=true` on the `sys_ui_page` record — `direct=false` (the default) blocks direct URL access and redirects to login |
| Passing `?id=<sys_id>` in the URL when opening from workspace causes a login prompt | Store the sys_id in `localStorage` before opening the tab, read it in the UI page client script — open the URL without query parameters |
| Classic `.do` UI page always prompts for login when opened from workspace, even with an active session and `direct=true` *(verify on your instance first)* | Root cause: workspace uses OAuth token auth; classic UI requires a separate JSESSIONID session — they are independent even on the same domain. No URL trick fixes this. **Use Service Portal instead** — SP shares the workspace's OAuth session. |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
