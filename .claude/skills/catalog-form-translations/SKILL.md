---
name: catalog-form-translations
description: Invoke when translating a Service Catalog item / record producer form (variable labels, choices, sections, help text, title) into a target language — "translate catalog form", "translate record producer", "catalog variable translation", "choice not translated", "question_text translation", "sys_translated_text". Catalog tables only (item_option_new / question_choice / sc_cat_item); NOT workspace macroponents (translate-workspace-ui) or getMessage/sys_ui_message (translate-server-scripts).
---

# Catalog Form Translations (record producer / catalog item)

Make a Service Catalog form (record producer or catalog item) multilingual. The source label stays in the **source language** (`product.config.json` → `language.source`); the target-language text lives in **`sys_translated_text`** and renders only for users whose session language matches. Examples below use `<target>` for the target language code (`language.targets`).

## The mechanism — one table, real columns

All catalog form text translates through **`sys_translated_text`** (a **global-scoped** table). Real columns:

| column | meaning |
|---|---|
| `tablename` | source table (e.g. `item_option_new`, `question_choice`, `sc_cat_item`) |
| `fieldname` | source field (e.g. `question_text`, `text`, `name`) |
| `documentkey` | sys_id of the source record |
| `language` | `<target>` |
| `value` | the translated text |

> ⚠️ The Agent API's `create_artifact` column mapping for `sys_translated_text` does not match these real columns (it expects `name`/`element`-style fields and fails or mis-maps). Don't fight the mapping — **create these rows via a `run_background_script` GlideRecord** (real columns, full privilege, reliable). See template below.

## What to translate (by table → field)

| Element | tablename | fieldname | Notes |
|---|---|---|---|
| Variable label | `item_option_new` | `question_text` | the bold label above the field |
| Variable help text | `item_option_new` | `help_text` | grey helper under the field |
| Variable instructions | `item_option_new` | `instructions` | |
| Section header / rich-text label | `item_option_new` | `rich_text` | type-11 Label & rich HTML headers (e.g. `<p><strong>…</strong></p>`) — easy to miss |
| Choice option | `question_choice` | `text` | radio / select / checkbox option label |
| Item title (form title) | `sc_cat_item` | `name` | use `sc_cat_item`, **not** `sc_cat_item_producer` |
| Item subtitle | `sc_cat_item` | `short_description` | |
| Item description | `sc_cat_item` | `description` | translated_html |

**Do NOT translate language-neutral choices** — e.g. city or site names, numbers (1, 2), proper nouns (vendor and organization names). With no target-language row they fall back to the stored value, which is already correct. Identity translations are clutter and break future source-language updates.

## Hard-won rules

1. **`sys_translated_text` is GLOBAL-scoped AND may never be captured by ANY update set** *(verify on your instance first)*. On the instance where this was established, `sys_scope` came back `null` on every record regardless of creation route, and a `sys_update_xml` lookup by sys_id returned zero rows — verified three ways: via `create_artifact` (wrong column mapping anyway), via `run_background_script` GlideRecord (explicitly setting `sys_scope` to the scoped app still landed `null`, because `run_background_script` always executes in **global** scope regardless of the active application-scope switch), and via a direct edit through the classic UI form (still `null`, still zero `sys_update_xml` rows). This is **not a scope-switch problem to fix** — the table simply doesn't ride update sets there. **Practical implication: any `sys_translated_text` translation must be manually re-created on every target environment (dev/test/acc/prod)** — it will never travel with the story's update set, no matter which one is active or how carefully scope is switched. Contrast with `sys_translated` (used for `translated_field`-type fields like `item_option_new.question_text`) which **does** capture normally into a scoped update set. See the `update-set-scope-strategy` skill.
2. **Labels stay in the source language; the form shows the translation only for matching sessions.** If you (source-language session) still see source text, that's expected for translated fields — verify in a target-language session or check `gs.getSession().getLanguage()`. Don't "fix" it by overwriting `question_text` with the translation.
3. **🔑 Flush the catalog cache or new translations won't render.** The catalog item caches its rendered variable/choice list (`ZZ_CATALOG_ITEM_CACHE_YY`). Variable *labels* often re-resolve, but **choice options stay stale**. Flush by touching the producer:
   ```javascript
   var p = new GlideRecord('sc_cat_item');
   if (p.get('<producer_sys_id>')) { p.update(); } // no field change — flushes the catalog cache
   ```
   Then the user hard-refreshes (Ctrl+Shift+R). This is the usual cause of "translations exist in DB but show the source language."
4. **Only create what's MISSING.** Query existing target-language rows first and skip records that already have one — never duplicate.
5. **🚩 Subtitle placement: `short_description` vs `description` can render differently in customized portal widgets** *(instance-observed — verify on your portal's catalog-item widget)*. On one customized portal catalog-item widget, `short_description` rendered **inline directly under the title** (no divider) while `description` (`trusted_description`) rendered in a **separate block below a border-bottom** → an unwanted horizontal divider line between title and text, with no OOTB toggle. Because such widgets are typically **shared portal-wide**, a CSS or widget edit hits every catalog item. If a one-line subtitle should sit right under the title, prefer `short_description` — and check how your portal's widget renders each field before choosing.
6. **Item-level language convention ≠ variables.** A portal-facing item may store its `name` / `short_description` in the customer-facing target language as the *base* value, while variables keep source-language base + `sys_translated_text` rows. **Match the item's existing convention** — don't force source-first onto the item title/subtitle. ⚠️ `get_record` in a target-language session returns the **translation**, not the base — so it can look like the base is in the target language when it isn't. Verify the actual stored value, and **clean up stale target-language `sys_translated_text` rows** left on `short_description`/`description` from an earlier setup (they can otherwise override or conflict).

## Workflow

1. Enumerate the form's variables + choices (`item_option_new` where `cat_item=<producer>`, `question_choice` where `question IN <choice var ids>`). Better: enumerate the **update set** (`sys_update_xml` `name STARTSWITH item_option_new_` / `question_choice_`) — it's the authoritative list of what was built, and catches variable-set/duplicate records a `cat_item` query misses.
2. Pull existing target-language translations; compute the missing set.
3. Provide the translations (the customer's design source — e.g. a Figma in the target language — is the canonical source for wording).
4. Switch to the **global** update set + global scope.
5. Run the idempotent background script (below).
6. Touch the producer to flush cache.
7. Verify: query the `sys_translated_text` count, check for capture in `sys_update_xml` (`type=Translated Text` — expect zero rows if your instance behaves per rule 1), switch back to the scoped set.

## Template — idempotent background script

```javascript
// rows: [tablename, fieldname, documentkey, translated_value]  — example rows
var LANG = '<target>'; // target language code from product.config.json language.targets
var R = [
  ["item_option_new","question_text","<var_sys_id>","<translated variable label>"],
  ["question_choice","text","<choice_sys_id>","<translated choice label>"],
  ["sc_cat_item","name","<producer_sys_id>","<translated form title>"]
  // ...
];
var made = 0, skip = 0;
for (var i = 0; i < R.length; i++) {
  var t = R[i][0], f = R[i][1], d = R[i][2], val = R[i][3];
  var existing = new GlideRecord('sys_translated_text');
  existing.addQuery('tablename', t);
  existing.addQuery('fieldname', f);
  existing.addQuery('documentkey', d);
  existing.addQuery('language', LANG);
  existing.query();
  if (existing.next()) { skip++; continue; }   // never duplicate
  var translation = new GlideRecord('sys_translated_text');
  translation.initialize();
  translation.setValue('tablename', t);
  translation.setValue('fieldname', f);
  translation.setValue('documentkey', d);
  translation.setValue('language', LANG);
  translation.setValue('value', val);
  translation.insert();
  made++;
}
// flush catalog cache so choices/labels re-render
var producer = new GlideRecord('sc_cat_item');
if (producer.get('<producer_sys_id>')) { producer.update(); }
gs.print('translations made=' + made + ' skipped=' + skip);
```

## Debug

| Symptom | Cause | Fix |
|---|---|---|
| Translation in DB but form shows source language | stale catalog cache | touch producer + hard refresh |
| Form shows source language for everything | session language is the source language | translations are correct; test in a target-language session |
| Choice shows an old/other translation | duplicate choice record renders, or stale cache | enumerate via the update set to find the real sys_id; flush |
| Capture count 0 in update set | `sys_translated_text` may never ride update sets (see rule 1) — not a scope issue | accept it; manually re-create the translation rows on each target environment |
| `create_artifact` fails "Operation Failed" | wrong column mapping for sys_translated_text | use the GlideRecord background script instead |

Related: `record-producer-forms` (building the form), `translate-workspace-ui` (macroponent labels), `translate-server-scripts` (getMessage / sys_ui_message).

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
