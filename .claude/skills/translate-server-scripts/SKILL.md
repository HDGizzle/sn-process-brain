---
name: translate-server-scripts
description: Invoke when the user asks to "translate scripts", "getMessage", "sys_ui_message", "message keys", "localize server scripts", "hardcoded text", "i18n", "translate messages", or when converting hardcoded server-side script text into translated UI messages.
---

# Translate Server Scripts to Message Keys

Convert hardcoded literal text inside `getMessage()` calls into structured message keys, each backed by one `sys_ui_message` record per project language.

Language slots come from `product.config.json`: `language.source` is the source language, `language.targets` lists the translation targets. Throughout this skill, `<source_lang>` / `<target_lang>` stand for those values. The key namespace comes from `naming.messageKeyNamespace` — written here as `<namespace>`.

## The Problem

Scripts accumulate literal user-facing text passed straight into `getMessage()`:

```javascript
gs.getMessage('Error while submitting the report');
gs.addInfoMessage(gs.getMessage('Status changed to In Progress'));
```

When the literal doubles as the key, nothing is translatable: there is no stable identifier to hang other languages on, and any wording tweak silently orphans existing translations. The fix is a coded key plus one `sys_ui_message` row per language.

## The Conversion

### Step 1 — swap the literal for a key

```javascript
// BEFORE
gs.getMessage('Error while submitting the report');

// AFTER
gs.getMessage('<namespace>.case_management.submission_error');
```

### Step 2 — back the key with sys_ui_message rows

One record per language, all sharing the same `key`:

```javascript
// Example — languages and texts are illustrative
var messages = [
    {
        key: '<namespace>.case_management.submission_error',
        texts: {
            '<source_lang>': 'Error while submitting the report',
            '<target_lang>': '[translated text]'
        }
    }
];
```

## Message Key Naming Convention

Format: `<namespace>.<process>.<description>`

| Part | Purpose | Example |
|------|---------|---------|
| namespace | App/module identifier from `naming.messageKeyNamespace` | `acme` |
| process | Business process the message belongs to | `case_management`, `intake` |
| description | What the message says, compressed | `submission_error`, `category_required` |

### Good key names
- `acme.intake.category_required`
- `acme.case_management.attachment_too_large`
- `acme.close.describe_handling`

### Bad key names
- `error1` — no namespace, no context
- `acme.error` — too vague to stay unique
- a full sentence of user-facing text — that is a literal, not a key

## Extraction Process (from update set XML or script files)

1. **Scan for the call patterns:**
   - `gs.getMessage('...')`
   - `gs.addInfoMessage(gs.getMessage('...'))`
   - `gs.addErrorMessage(gs.getMessage('...'))`
   - `getMessage('...')` (client-side)
2. **For each literal found:** derive the process segment from the script's name and context, invent a descriptive key suffix, and produce the source-language text plus a translation per target language. If the literal was written in a target language, translate it back to the source language for the source row.
3. **Present the full mapping to the developer for sign-off before generating anything** (see Workflow below).

## Template: Translation Background Script

Dedup-safe: existing key+language rows are skipped, so the script can be re-run.

```javascript
// ============================================================
// TRANSLATE SERVER SCRIPTS - [Process Name]
// Scope: [scope_name] | Source: [update set or script name]
// ============================================================

var SCOPE_ID = '[SCOPE_SYS_ID]'; // sys_scope sys_id — never the scope name string

// ============ MESSAGE DEFINITIONS ============
// One entry per key; texts keyed by language code.
var messages = [
    { key: '<namespace>.[process].[description]',
      texts: { '<source_lang>': '[source text]', '<target_lang>': '[translated text]' } }
];

// ============ STEP 1: CREATE UI MESSAGES ============
var msgCreated = 0;
var msgSkipped = 0;

for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    for (var lang in msg.texts) {
        var gr = new GlideRecord('sys_ui_message');
        gr.addQuery('key', msg.key);
        gr.addQuery('language', lang);
        gr.query();

        if (gr.hasNext()) { msgSkipped++; continue; }

        gr.initialize();
        gr.setValue('key', msg.key);
        gr.setValue('language', lang);
        gr.setValue('message', msg.texts[lang]);
        gr.sys_scope = SCOPE_ID;   // bg scripts run global — set scope explicitly
        gr.sys_package = SCOPE_ID;
        gr.insert();
        msgCreated++;
    }
}
gs.info('Messages — Created: ' + msgCreated + ' | Skipped: ' + msgSkipped);

// ============ STEP 2: UPDATE SCRIPTS ============
// Replace the literals with the new keys on the target records.
// var targetScript = new GlideRecord('sys_script');
// if (targetScript.get('[SYS_ID]')) {
//     var script = targetScript.getValue('script');
//     script = script.replace("gs.getMessage('[old literal]')", "gs.getMessage('<namespace>.[process].[key]')");
//     targetScript.setValue('script', script);
//     targetScript.update();
// }
```

**Capture warning:** `setWorkflow(false)` on the script-update step suppresses update-set capture. If the modified script must ship, either update without `setWorkflow(false)` or force-add afterwards and verify via `sys_update_xml` — see the wiki's hard-rules page and the update-set-workflow skill.

## Backfilling Empty Descriptions

While touching a script record anyway, populate an empty `description` field with a meaningful one-liner:

```javascript
var gr = new GlideRecord('[script_table]');
if (gr.get('[SYS_ID]') && !gr.getValue('description')) {
    gr.setValue('description', '[What this script does]');
    gr.update();
}
```

## Workflow for the Agent

1. Read the input (update set XML or script file).
2. Extract every `getMessage()` call carrying a literal.
3. Auto-detect the scope from the XML or folder structure.
4. Generate keys per the naming convention.
5. Produce source-language text + target-language translations for each.
6. Show the overview table to the developer:

| # | Original literal | Proposed key | Source text | Target text(s) |
|---|-----------------|--------------|-------------|----------------|
| 1 | [literal from script] | `<namespace>.case_management.submission_error` | Error while submitting the report | [translation] |

7. **Wait for explicit approval**, then generate the background script.
8. After running: verify capture in the active update set and read back a sample `sys_ui_message` row per language.

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| `getMessage` returns the key itself | Missing `sys_ui_message` record for the session language | Create rows for every project language, source included |
| Wrong language shown | Translation row missing for that language | Confirm one row per key per language |
| Key collision | Duplicate key reused for different text | Use more specific description segments |
| Client-side `getMessage` fails | Keys not preloaded | Add the keys to the Messages field on the client script |
| Messages land in the wrong scope | Background scripts execute in global scope | Set `sys_scope`/`sys_package` explicitly to the app scope sys_id |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
