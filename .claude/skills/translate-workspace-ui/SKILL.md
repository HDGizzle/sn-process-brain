---
name: translate-workspace-ui
description: Invoke when the user asks to "translate workspace", "TRANSLATION_LITERAL", "switcheroo", "macroponent translation", "multilingual workspace", "elementLabel", "sys_translated_text", or when translating workspace UI text (labels/buttons rendered from macroponents).
---

# Translate Workspace UI (Switcheroo Strategy)

Make a workspace built in one language serve users in another: convert `TRANSLATION_LITERAL` labels in the macroponent composition to the source language and back every label with `sys_ui_message` translations.

Language slots come from `product.config.json`: `language.source` (written here as `<source_lang>`) and `language.targets` (`<target_lang>`). The common scenario: designers built the workspace in `<target_lang>`, and the composition must be normalized to `<source_lang>` literals with `<target_lang>` translation rows — but the mechanics are direction-agnostic.

## The Problem

Workspace text rendered from `sys_ux_macroponent` composition JSON uses `TRANSLATION_LITERAL` entries. If those literals are in `<target_lang>`, source-language users see the wrong language, and translation lookup has nothing to key on. Two things must happen per label:

1. The composition JSON literal becomes `<source_lang>` text.
2. `sys_ui_message` rows exist for both `<source_lang>` and each `<target_lang>`, keyed by the source text.

## The Switcheroo Strategy

Each target-language label needs up to THREE replacements in the composition JSON:

```
1. "message": "[target-language text]"   → "message": "[source-language text]"
2. "elementLabel": "[target-language text]" → "elementLabel": "[source-language text]"
3. "elementLabel": "[generic label]"     → "elementLabel": "[source-language text]"
```

### Why elementLabel matters

The platform resolves translations through `elementLabel`. When `elementLabel` differs from the `message` value, the lookup fails — silently, with no error anywhere.

The sneaky case is generic labels. UI Builder assigns defaults like "Heading", "Single score 25", "Rich text" that never match the actual content:

```json
// BEFORE — generic elementLabel, translation lookup FAILS
{
    "elementLabel": "Heading",
    "message": "[target-language heading text]",
    "translationType": "TRANSLATION_LITERAL"
}

// AFTER — elementLabel matches the source text, translation works
{
    "elementLabel": "Case Overview",
    "message": "Case Overview",
    "translationType": "TRANSLATION_LITERAL"
}
```
(Example: "Case Overview" stands for the source-language text.)

## Translation Decision Tree

```
Is it a TRANSLATION_LITERAL?
├── YES → Does elementLabel match the target-language message?
│   ├── YES → Replace both message AND elementLabel with source text
│   └── NO → Is elementLabel generic? ("Heading", "Rich text", ...)
│       ├── YES → Override elementLabel to source text + replace message
│       └── NO → Replace message, then align elementLabel to match it
└── NO → Skip (not translatable via this method — see other paths below)
```

## What Gets Translated

| Element type | Where to find it | Notes |
|-------------|------------------|-------|
| Headings | `"elementLabel": "Heading"` | Generic label — MUST override |
| Scorecards | `"elementLabel": "Single score 25"` | Generic label — MUST override |
| Rich text blocks | `"elementLabel": "Rich text"` | Generic label — MUST override |
| Button labels | Various | Usually already specific |
| Form section captions | `caption` property | Different path — `sys_ui_section` + `sys_translated` |
| Tab labels | `label` property | May need `sys_translated` |

## Composition JSON Structure

Compositions live in `sys_ux_macroponent.composition` as JSON. The relevant fragment per label:

```json
{
    "elementLabel": "Heading",
    "message": "[target-language text]",
    "translationType": "TRANSLATION_LITERAL",
    "propertyName": "label"
}
```

## Template: Translation Background Script

```javascript
// ============================================================
// TRANSLATE WORKSPACE UI - [Workspace Name]
// ============================================================

var SCOPE_ID = '[SCOPE_SYS_ID]';
var MACROPONENT_ID = '[MACROPONENT_SYS_ID]';

// ============ TRANSLATIONS ============
// target: text currently in the composition; source: replacement text
var translations = [
    { target: '[target text 1]', source: 'Case Overview',   genericLabel: 'Heading' },
    { target: '[target text 2]', source: 'Reporting Score', genericLabel: 'Single score 25' }
];

// ============ STEP 1: UPDATE COMPOSITION JSON ============
var macro = new GlideRecord('sys_ux_macroponent');
if (macro.get(MACROPONENT_ID)) {
    var composition = macro.getValue('composition');

    for (var i = 0; i < translations.length; i++) {
        var t = translations[i];

        // Switcheroo 1: message value target → source
        composition = composition.split('"message": "' + t.target + '"')
            .join('"message": "' + t.source + '"');

        // Switcheroo 2: elementLabel that matches the target text
        composition = composition.split('"elementLabel": "' + t.target + '"')
            .join('"elementLabel": "' + t.source + '"');

        // Switcheroo 3: generic elementLabel near this message.
        // A blind split/join would hit EVERY element sharing the generic
        // label — locate the right occurrence by context and verify manually.
    }

    macro.setValue('composition', composition);
    macro.update();
    gs.info('Composition updated: ' + MACROPONENT_ID);
}

// ============ STEP 2: CREATE UI MESSAGES ============
var msgCreated = 0;

for (var j = 0; j < translations.length; j++) {
    var tr = translations[j];
    var key = tr.source; // for TRANSLATION_LITERAL, the key IS the source text

    var langs = {};
    langs['<source_lang>'] = tr.source;
    langs['<target_lang>'] = tr.target;

    for (var lang in langs) {
        var gr = new GlideRecord('sys_ui_message');
        gr.addQuery('key', key);
        gr.addQuery('language', lang);
        gr.query();
        if (gr.hasNext()) continue;

        gr.initialize();
        gr.setValue('key', key);
        gr.setValue('language', lang);
        gr.setValue('message', langs[lang]);
        gr.sys_scope = SCOPE_ID;
        gr.sys_package = SCOPE_ID;
        gr.insert();
        msgCreated++;
    }
}
gs.info('UI Messages created: ' + msgCreated);
```

**Capture warning:** if you add `setWorkflow(false)` to the composition update (sometimes needed for repair runs), the change is NOT captured in the update set — force-add and verify via `sys_update_xml` before calling it shipped.

## Form Section Captions

Captions use record-based translation (`sys_translated`), not UI messages:

```javascript
var section = new GlideRecord('sys_ui_section');
section.addQuery('caption', '[target-language caption]');
section.addQuery('name', '[table_name]');
section.query();
if (section.next()) {
    section.setValue('caption', '[source-language caption]');
    section.update();

    var trans = new GlideRecord('sys_translated');
    trans.initialize();
    trans.setValue('tableName', 'sys_ui_section');
    trans.setValue('fieldName', 'caption');
    trans.setValue('documentID', section.getUniqueValue());
    trans.setValue('language', '<target_lang>');
    trans.setValue('value', '[target-language caption]');
    trans.setValue('elementLabel', '[source-language caption]'); // must match the source caption!
    trans.sys_scope = SCOPE_ID;
    trans.insert();
}
```

## Form Modal Params

Translatable params on workspace form modals (e.g. a modal `formTitle`) carry the same shape — apply the identical switcheroo:

```json
{
    "formTitle": {
        "translationType": "TRANSLATION_LITERAL",
        "message": "Close Case",
        "elementLabel": "Close Case"
    }
}
```

## Scope Rules

- `TRANSLATION_LITERAL` messages → create `sys_ui_message` in the **app scope**, not global.
- Form section captions → `sys_translated` table.
- Composition changes → update the macroponent record directly.
- **`translated_text` field translations** (e.g. `sys_ux_form_action.name`, `sys_declarative_action_assignment.label`) → live in `sys_translated_text`, which is **GLOBAL-scoped** — capture them in a **global** update set via force-add (next section), NEVER the scoped story set.

## Workspace form-action / split-button labels (`sys_ux_form_action.name`) — capture & migration trap

*(Single-instance-verified behavior — verify on your instance first.)*

The translated label on a workspace **split-button** item — and any `sys_ux_form_action.name` — is a `translated_text`-type field, so its translation lives in **`sys_translated_text`** (`tablename=sys_ux_form_action`, `fieldname=name`, `documentkey=<form action sys_id>`, `language=<target_lang>`). Two facts that jointly produce the classic symptom "target language shows in dev, source language in test":

1. **`sys_translated_text` is effectively GLOBAL-scoped.** It has no `sys_scope` field and does **not** ride a scoped update set. Editing it while a scoped set is active captures **nothing** — `sys_update_xml` count 0, not even Default. It only rides a **global** set. → Put workspace-label translations in a **same-named global companion update set** (the framework's cross-scope companion-set convention — see the update-set-workflow skill), never the scoped story set.
2. **Editing the translation does NOT bundle it into the parent.** Touching `sys_translated_text.value` captures the parent `sys_ux_form_action` shell, but that payload is **source-language-only** (`<name>Save</name>`, no nested `sys_translated_text`). Re-saving the form action does **not** migrate the translation. A label set via a `setWorkflow(false)` switcheroo — or set after the parent was last captured — renders correctly in dev while the deployable XML carries only the source text.

**Fix — the only reliable one: force the translation rows into a GLOBAL update set.** With the **global** set + **global** scope both active, run a background script:

```javascript
var um = new GlideUpdateManager2();
var gr = new GlideRecord('sys_translated_text');
gr.addQuery('tablename', 'sys_ux_form_action');
gr.addQuery('fieldname', 'name');
gr.addQuery('documentkey', '<form_action_sys_id>');
gr.addQuery('language', '<target_lang>');
gr.query();
if (gr.next()) { um.saveRecord(gr); } // forces a "Translated Text" row into the active (global) set
```

Then **verify** in `sys_update_xml`: `update_set=<global_set>^typeINTranslated Text` (or `nameSTARTSWITHsys_translated_text_`). The row's payload must contain the translated `<value>` — presence in the UI/DB is NOT proof of capture; only that `sys_update_xml` row is.

> The standalone-button label path (`sys_ux_form_action_layout_item.label`, a plain `string` field → `sys_translated`) is value-match-based and rides a normal update set fine. It is specifically the **`translated_text` → `sys_translated_text`** path (form-action names, declarative-action assignment labels) that needs the global force-add.

## Workflow for the Agent

1. Read the macroponent composition (from update set XML or a record query).
2. Find all `TRANSLATION_LITERAL` entries carrying target-language text.
3. Identify generic elementLabels that need overriding.
4. Produce the source-language text for each label.
5. Show the overview table to the developer:

| # | Target text | Source text | elementLabel (before) | elementLabel (after) |
|---|------------|-------------|----------------------|----------------------|
| 1 | [target-language heading] | Case Overview | Heading | Case Overview |

6. **Wait for explicit approval** before generating anything.
7. Generate the background script (composition updates + UI messages), run, then verify capture and read back the composition.

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| Translation not showing | elementLabel mismatch | Ensure elementLabel equals the source text exactly |
| Wrong translation shown | `sys_ui_message` in wrong scope | Create in the app scope, not global |
| Generic label not replaced | Blind replacement would hit sibling elements | Context-aware replacement + manual verification |
| Modal title not translated | Modal params skipped | Apply the switcheroo to modal params too |
| Section caption untranslated | Wrong translation table | Captions use `sys_translated`, not `sys_ui_message` |
| Workspace button shows target language in dev, source in test | `sys_translated_text` (translated_text labels) is global-scoped and never rode the scoped/Default set; re-saving the parent captures source-only | Force the `sys_translated_text` rows into a **global** update set via `GlideUpdateManager2().saveRecord()`, then verify the translated `<value>` appears in the `sys_update_xml` payload |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
