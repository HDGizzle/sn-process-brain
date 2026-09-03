---
name: journal-field-formatting
description: Invoke when the user asks to "format work notes", "work note HTML", "hyperlink in work notes", "bold in journal field", "[code] tag", "styled work notes", "journal field formatting", or when putting HTML in ServiceNow journal fields (work_notes, comments, additional_comments).
---

# Journal Field Formatting

Journal fields (`work_notes`, `comments`, `additional_comments`) escape HTML by default: markup pasted into them displays as literal text. To get rendered formatting, the HTML must sit inside `[code]...[/code]` tags.

## The Golden Rule

```
Raw HTML in journal fields = ESCAPED (shows as plain text)
HTML inside [code] tags    = RENDERED (bold, links, tables, etc.)
```

**Without `[code]`:**
```
work_notes = '<b>Hello</b>';
// Displays: <b>Hello</b>  (literal text, not bold)
```

**With `[code]`:**
```
work_notes = '[code]<b>Hello</b>[/code]';
// Displays: Hello  (rendered bold)
```

## Writing to Journal Fields — Direct Assignment Only

Journal fields are the one exception to the "always `setValue()`" convention: use direct assignment (`gr.work_notes = text`) or `setJournalEntry()`. `gr.setValue('work_notes', text)` can report success while posting no journal entry at all (verify on your instance first). Do not let a code review "correct" direct journal assignment back to `setValue()`.

## Supported HTML Tags Inside [code]

| Tag | Purpose | Example |
|-----|---------|---------|
| `<b>`, `<strong>` | Bold | `<b>Important</b>` |
| `<i>`, `<em>` | Italic | `<i>Note</i>` |
| `<u>` | Underline | `<u>Underlined</u>` |
| `<br/>` | Line break | `Line 1<br/>Line 2` |
| `<a href="...">` | Hyperlink | `<a href="url">Click here</a>` |
| `<ul>`, `<ol>`, `<li>` | Lists | `<ul><li>Item</li></ul>` |
| `<table>`, `<tr>`, `<td>`, `<th>` | Tables | See examples below |
| `<p>` | Paragraph | `<p>Text</p>` |
| `<span style="...">` | Inline styling | `<span style="color:red">Alert</span>` |
| `<h1>`-`<h6>` | Headings | `<h3>Section</h3>` |

**Stripped/blocked for security:** `<script>`, `<iframe>`, `<img>`.

## Line Breaks

`\n` does not render as a visible line break inside a `[code]` block. Use `<br/>`:

```javascript
// WRONG — runs together on one line
gr.work_notes = '[code]Line 1\nLine 2[/code]';

// CORRECT
gr.work_notes = '[code]Line 1<br/>Line 2[/code]';
```

## Hyperlinks

### Workspace behavior (critical)

Configurable/Next Experience workspaces intercept links pointing at the same instance and open them as workspace tabs — but only for the classic URL form:

- **Standard record URLs** (`/<table>.do?sys_id=xxx`) — intercepted, open as a **workspace tab** (what you want)
- **Long workspace route URLs** (`/now/<workspace-route>/record/<table>/<sys_id>/...`) — NOT intercepted, open in a **new browser tab** (wrong)
- **`target="_blank"`** — forces a new browser tab and defeats interception entirely

So: always build journal links in the standard `<table>.do?sys_id=` form when they should open inside the workspace.

### Standard record link (recommended)

```javascript
var instanceUrl = String(gs.getProperty('glide.servlet.uri'));
if (instanceUrl.charAt(instanceUrl.length - 1) === '/') {
    instanceUrl = instanceUrl.substring(0, instanceUrl.length - 1);
}
var url = instanceUrl + '/' + tableName + '.do?sys_id=' + sysId;
gr.work_notes = '[code]<a href="' + url + '">' + number + '</a>[/code]';
```

Behavior of this link:
- **Workspace:** opens as a new workspace tab (router interception)
- **Classic UI:** opens in the same browser window

### Deliberately escaping the workspace (new browser tab)

When a link genuinely must open outside the workspace, a protocol-relative double-slash URL bypasses the workspace's internal-URL detection:

```javascript
var url = '//' + instanceName + '.service-now.com/' + tableName + '.do?sys_id=' + sysId;
'[code]<a href="' + url + '" target="_blank" rel="noreferrer noopener">Open in browser</a>[/code]'
```

### Anti-patterns

```javascript
// WRONG — long workspace route: opens in a new browser tab, not a workspace tab
var url = instanceUrl + '/now/<workspace-route>/record/<table>/' + sysId + '/sub/record/...';

// CORRECT — standard form, intercepted by the workspace
var url = instanceUrl + '/<table>.do?sys_id=' + sysId;
```

```javascript
// WRONG — target="_blank" forces a browser tab for an internal link
'[code]<a href="' + url + '" target="_blank">Open</a>[/code]'

// CORRECT
'[code]<a href="' + url + '">Open</a>[/code]'
```

Reserve `target="_blank"` for truly external URLs.

## Common Patterns

### Structured note with bold labels

```javascript
var note = '[code]' +
    '<b>Task created</b><br/>' +
    '<b>Number:</b> <a href="' + taskUrl + '">' + taskNumber + '</a><br/>' +
    '<b>Type:</b> ' + taskType + '<br/>' +
    '<b>Assigned to:</b> ' + assignedTo + '<br/>' +
    '<b>Description:</b> ' + shortDesc +
    '[/code]';
gr.work_notes = note;
```

### Bulleted list

```javascript
var note = '[code]' +
    '<b>Changes made:</b>' +
    '<ul>' +
    '<li>Updated priority to P1</li>' +
    '<li>Assigned to Network team</li>' +
    '<li>Added affected CI</li>' +
    '</ul>' +
    '[/code]';
```

### Table

```javascript
var note = '[code]' +
    '<b>Summary</b><br/>' +
    '<table border="1" cellpadding="4" cellspacing="0">' +
    '<tr><th>Field</th><th>Old Value</th><th>New Value</th></tr>' +
    '<tr><td>Priority</td><td>3</td><td>1</td></tr>' +
    '<tr><td>State</td><td>New</td><td>In Progress</td></tr>' +
    '</table>' +
    '[/code]';
```

### Colored text

```javascript
var note = '[code]' +
    '<span style="color:red;font-weight:bold">CRITICAL:</span> ' +
    'System outage detected<br/>' +
    '<span style="color:green">Status:</span> Being investigated' +
    '[/code]';
```

## Localized Notes via gs.getMessage()

For translatable formatted notes, store the entire template — `[code]` tags included — in the `sys_ui_message` record, and pass dynamic values as placeholders:

```javascript
// sys_ui_message (source language):
// key: <scope>.<key>            (namespace per your project's message-key convention)
// message: [code]<b>Record updated</b><br/><b>Number:</b> <a href="{0}">{1}</a><br/><b>Changed by:</b> {2}[/code]

var msg = gs.getMessage('<scope>.<key>', [recordUrl, recordNumber, userName]);
gr.work_notes = msg;
```

`{0}`, `{1}`, `{2}`, … are substituted in array order. Provide the message in every configured language pair (see `product.config.json` → `language.source`/`language.targets`).

## Multiple [code] Blocks

One journal entry may contain several `[code]` blocks; anything between them stays plain/escaped:

```javascript
var note = '[code]<b>Header</b>[/code]' +
    '\nPlain text between blocks\n' +
    '[code]<b>Footer</b>[/code]';
```

## Setting Another Record's Work Notes

```javascript
var gr = new GlideRecord('incident');
if (gr.get(sysId)) {
    gr.work_notes = '[code]<b>Formatted note</b>[/code]';
    gr.setWorkflow(false);  // prevent cascading business rules
    gr.update();
}
```

Relevant methods:
- `setWorkflow(false)` — stops business rules/engines from firing on this update. Fine for journal-only data updates; be aware that on tracked configuration records it also suppresses update-set capture.
- `autoSysFields(false)` — leaves `sys_updated_on`/`sys_updated_by` untouched.

## Security Property

`[code]` rendering is governed by a system property:

```
glide.ui.security.allow_codetag = true   (default: true, OOTB — verify on your instance)
```

| Value | Behavior |
|-------|----------|
| `true` (default) | `[code]` tags render HTML in journal fields |
| `false` | `[code]` tags are ignored; all HTML is escaped |

**If `[code]` isn't rendering**, check this property first — security-hardened instances sometimes disable it (a common penetration-test remediation).

**Tradeoff:** with the property enabled, anyone who can write journal entries can inject HTML. The platform strips the dangerous tags (`<script>`, `<iframe>`), but the surface is still larger than plain text. Disabling it also breaks knowledge-article links in comments and markdown formatting in AI-generated work-note summaries.

## Classic UI vs Workspace Rendering

Both classic UI and workspace render `[code]` HTML in journal fields, but not identically:

- Workspace applies its own CSS, which can shift layout
- Complex tables are the most likely to diverge between the two views
- Test formatted notes in both UIs whenever both are in use

## Best Practices

1. **Always wrap HTML in `[code]` tags** — raw HTML never renders in a journal field.
2. **`<br/>`, not `\n`** — newlines are invisible inside `[code]` blocks.
3. **Direct assignment, not `setValue()`** — the journal-field exception; `setValue()` can silently post nothing.
4. **Localize via `gs.getMessage()`** — full `[code]...[/code]` template in `sys_ui_message`, values as `{n}` placeholders.
5. **Build URLs dynamically** — `gs.getProperty('glide.servlet.uri')`, never a hardcoded instance URL.
6. **Standard record URLs only** — `<table>.do?sys_id=`, never long `/now/<workspace-route>/record/...` routes; the workspace intercepts only the standard form.
7. **No `target="_blank"` on internal links** — it bypasses workspace interception; external URLs only.
8. **`setWorkflow(false)` when noting another record** — avoid cascading business-rule storms.
9. **Sanitize interpolated user input** — values dropped into a `[code]` block are rendered as HTML.
10. **Prefer bold labels + `<br/>`** over comma-run-on text for structured notes.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
