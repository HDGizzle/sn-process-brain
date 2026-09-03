---
name: record-producer-forms
description: Invoke when building or modifying a record producer / catalog item FORM via the agent API — "record producer", "sc_cat_item_producer", "catalog variable", "item_option_new", "question_choice", "catalog UI policy", "catalog client script", "MRVS", "multi-row variable set", "portal intake form". Covers variables, choices, containers, conditional show/hide/mandatory. Translated labels: catalog-form-translations; SP page/widget chrome: sp-widget-patterns.
---

# Record Producer / Catalog Forms

Build a portal intake form (record producer or catalog item) with variables, conditional behaviour, sections, and repeatable rows — via the sn-scriptsync agent API. Distilled from a production build of an intake producer whose top radio routes submissions to different target tables. Examples use the placeholder scope `x_acme_fm` — substitute your project's values.

## Anatomy

```
sc_cat_item_producer (the form; extends sc_cat_item)
├── table_name        target table for the default insert (see Routing below)
├── category / sc_catalogs  where it surfaces in the portal
├── item_option_new   the variables (cat_item = producer sys_id)
│   └── question_choice  options for choice/select/radio variables (question = var sys_id)
├── io_set_item → item_option_new_set   attached Variable Sets (incl. MRVS)
├── catalog_ui_policy + catalog_ui_policy_action   conditional show/hide/mandatory
└── catalog_script_client   onLoad/onChange client scripts
```

## Variable types (`item_option_new.type`)

| type | meaning | choices? |
|---|---|---|
| 1 | Yes/No | built-in Yes/No |
| 2 | Multi Line Text | — (`max_length`) |
| 3 | Multiple Choice (radio) | `question_choice` |
| 5 | Select Box (dropdown) | `question_choice` (+ `include_none`) |
| 6 | Single Line Text | — |
| 7 | CheckBox (single boolean) | — (value `true`/`false`) |
| 8 / 21 | Reference / Lookup Select | reference field |
| 9 | Date · 10 Date/Time | — |
| 11 | Label | — (text in `question_text` / `rich_text`) |
| 19 / 20 | Container Start / End | wrap a section |
| 26 Email · 27 URL · 31 (user ref) | | |
| 32 | Multi-Row Variable Set (MRVS) reference | a Variable Set, `type=one_to_many` |
| 33 | Attachment variable | — |

Sections = a **Container Start (19)** … fields … **Container End (20)** pair, often introduced by a **Label (11)** or a rich-text header. Repeatable sub-forms (involved people, witnesses, affected assets, …) = an **MRVS**: an `item_option_new_set` with `type=one_to_many`, its own child variables, linked to the item via `io_set_item`.

**MRVS needs no separate "hosting" variable.** `io_set_item` (`sc_cat_item` + `variable_set` + its own `order`) is what positions the repeatable block on the form — you do **not** need a `type=32` item_option_new pointing at it. A stray `type=32` variable (blank `question_text`, `variable_set=null`) next to a working MRVS is leftover/vestigial — the client-facing field name scripts use (`g_form.getValue('involved_people')`, `g_form.setDisplay('involved_people', …)`) is the variable set's own **`internal_name`**, resolved automatically by the platform once `io_set_item` exists. Don't copy such a vestigial variable when building a new MRVS; `item_option_new_set` + child variables + `io_set_item` is the complete, sufficient set.

## Creating artifacts (agent API)

- **`create_artifact` requires a `name` field on EVERY table** — even `question_choice` (set `name` = the option text).
- Variable: `create_artifact` `item_option_new` with `cat_item`, `name`, `question_text`, `type`, `mandatory`, `order`, `max_length`.
- Choice: `create_artifact` `question_choice` with `name`, `question`(=var sys_id), `text`, `value`, `order`.
- **Select Box "-- None --":** set `include_none=true` on the variable (a Yes/No type 1 has no none — convert to Select Box 5 + add Yes/No choices for a none default).
- **Stop a radio auto-selecting the first option:** set `do_not_select_first=true` on the variable (needed so a "hide until chosen" policy can fire on an empty load).

## Catalog UI policies — conditional behaviour

**⚠️ UI policy conditions must be unique per catalog item — never create a second policy with the same condition.** Before creating a new `catalog_ui_policy`, query existing ones on the same `catalog_item` (or table, for non-catalog UI policies) and check their `catalog_conditions`. If one already exists with the **exact same condition** you need, **extend that policy's `script_true`/`script_false`** (add your field's `setDisplay`/`setMandatory`/`clearValue` lines alongside the existing ones) instead of creating a new policy that duplicates the condition. Example: a new field that must show when "location is one of {value A, value B}" belongs inside the existing "ACME - Show location detail (script)" policy that already carries that exact condition — not in a new policy of its own. If two policies with the same condition already exist (from before this rule was known), merge them into one and deactivate/delete the redundant one. Reason: duplicate-condition policies are pure redundancy — they evaluate the same test twice and make the form's conditional logic harder to audit; one condition should have one owner.

Create `catalog_ui_policy` (`applies_to=item`, `catalog_item=<producer>`, `applies_catalog=true`, `on_load=true`, usually `reverse_if_false=true`) + one `catalog_ui_policy_action` per field.

**Condition syntax (`catalog_conditions`)** — `IO:<var_sys_id><op><value>^EQ`:

| Want | Condition |
|---|---|
| radio/select = value | `IO:<id>=passage^EQ` (example choice value) |
| checkbox (type 7) on | `IO:<id>=true^EQ` |
| Yes/No (type 1) = Yes | `IO:<id>=Yes^EQ` |
| reference not empty | `IO:<id>!=^EQ` (e.g. show location detail once a location is picked) |
| value A **or** B | `IO:<id>=a^NQIO:<id>=b^EQ` (`^NQ` starts a new OR query) |
| A **and** B | `IO:<idA>=x^IO:<idB>=y^EQ` |

> Avoid `ISNOTEMPTY` on a choice variable — observed to parse as always-true, so the fields never hid. Use explicit equality / OR instead. (Verify on your instance first.)

**Action record (`catalog_ui_policy_action`):** `ui_policy`, `catalog_variable`=`"IO:<var_sys_id>"`, `variable`=`"<var name>"`, `visible`, `mandatory`, `disabled`.

### 🔥 Pitfalls that cost hours

1. **`create_artifact` / `update_record` SILENTLY DROP reference-ish fields** — confirmed on `catalog_ui_policy_action.ui_policy` / `.catalog_variable`, `item_option_new.validate_regex`, `item_option_new.reference_qual`, and `item_option_new.variable_set` (the field that links a child variable into an MRVS). Scalars (`visible`/`mandatory`/`text`/`value`) save fine; these specific fields come back empty/null → orphaned record, policy or reference qualifier does nothing. The REST write path lacks privilege; it is NOT a scope-switch fix. **Set them via `run_background_script` (GlideRecord `setValue`)** — or for an MRVS's child variables, create the whole `item_option_new` row via background script from the start rather than `create_artifact` + patch. (Verified on a single instance — verify on yours first.) See the wiki's gotchas page.
   ```javascript
   var a = new GlideRecord('catalog_ui_policy_action');
   if (a.get('<action_sys_id>')) {
     a.setValue('ui_policy', '<policy_sys_id>');
     a.setValue('catalog_variable', 'IO:<var_sys_id>');
     a.update();
   }
   ```
2. **`mandatory:"false"` + `reverse_if_false` = a field that won't hide.** Reverse flips `mandatory false → true`, and **ServiceNow cannot hide a mandatory field**, so it stays visible (with a red `*`). For a field that is *visible-when-shown but never required*, use **`mandatory:"ignore"`** (leave-alone), not `"false"`. Reserve `mandatory:"true"` for fields that really are required when shown, and set their **base `mandatory=false`** so the policy fully drives it.
3. **⚠️ Retiring a flat field group in favor of an MRVS (or anything else) must also delete its Container Start/End (19/20) and Container Split (24) elements — not just the field variables.** Observed in production: flat variables were deleted and replaced with a new MRVS attached via `io_set_item`, but the old `Container Start(19)`/`Split(24)`/`Container End(20)` elements that used to wrap them were left in place (empty). Result: **the new MRVS silently failed to render at all** — no error, it just didn't show up on the form. Deleting the leftover empty containers fixed it immediately. Lesson: when a section is torn out, enumerate the *whole* order range it occupied (including formatter/split/container markers either side) and remove every element in it, not just the ones that obviously "look like fields."
4. **Rebuilding a `catalog_ui_policy` from declarative to scripted (or any structural rebuild that creates a new record) must explicitly DELETE the old one — under the story's own update set, while it's active.** Observed failure mode: declarative-only policies (+ their actions) were superseded by rebuilt script-based versions carrying the same base name plus a `"(script)"` suffix. The old ones were deleted at some point, but not while the right update set was active, so **no DELETE entry exists in any update set for them** — they were only ever captured as `INSERT_OR_UPDATE` in the original build's set. If that original set was already promoted to a higher environment, the old declarative policies are still live there, running **alongside** the new scripted ones with the same effective condition — the exact "two policies racing to control one field" problem this skill already warns about, just spread across environments instead of within one. Diagnosis via `sys_update_xml`: query the old update set for `catalog_ui_policy`/`catalog_ui_policy_action` rows, then check whether those exact sys_ids still exist live (`query_records` by `sys_id IN ...`) — zero live hits + only `INSERT_OR_UPDATE` in the history means an un-tracked delete happened. The fix requires deleting the stale copies on whichever higher environment actually has them, with the correct update set active there — it cannot be done retroactively from a lower environment that no longer has the record to delete.

### "Hide everything until the type is chosen"
Two working approaches:
- **Client script (onLoad):** `g_form.setDisplay(...)`/`setMandatory(false)` for the downstream fields, re-evaluated onChange of the driver.
- **UI policy:** condition = driver is one of the valid values (`=a^NQ=b^NQ=c^EQ`), `reverse_if_false=true` → hides them when empty. (A plain `ISNOTEMPTY` does NOT work — see above.)

### Declarative actions vs scripting — when to use which (decision rule)

**Use declarative actions for the simple cases; switch to the policy's `Execute if true` / `Execute if false` scripts when the actions can't express what you need** — chiefly *clearing a value when the field hides*.

| Need | Use |
|---|---|
| show / hide / mandatory on a condition | **declarative actions** (`visible` / `mandatory`) |
| **empty a variable's value when it hides** | **scripting** — actions can't do this reliably (below) |
| logic the actions can't model (multi-step, computed) | scripting |

**Why "clear value" pushes you to scripts:**
- The action's **"Clear the variable value" (`cleared`) fires ONLY when the condition is TRUE** (the action runs) — **never on the `reverse_if_false` reverse**. So a normal "show-when + reverse" policy never clears on hide. (Community/KB-confirmed.) Doing it declaratively means *inverting* every policy (condition true = hide, `visible=false` + `cleared=true`) — verbose; scripting is cleaner.
- **`cleared` does NOT cascade from a container/Label to its child variables.** A **Label + checkbox** group hides the checkboxes via the label cascade, but their **values** are not cleared — you must clear **each child checkbox** explicitly.

**Scripting pattern that actually works in Service Portal:**
- Set **`run_scripts = true`** AND **`ui_type = 10` (All)**. Default `ui_type = 0` (Desktop) → the scripts **never run** in Service Portal / Employee Center.
- `script_true` = `g_form.setDisplay(f,true)` (+ `setMandatory(f,true)`); `script_false` = `setMandatory(f,false)` + `setDisplay(f,false)` + **`g_form.clearValue(f)`** (the empty-on-hide). Both wrap in `function onCondition(){…}`.
- Use **`g_form.setDisplay`**, NOT `setVisible` — `setVisible(false)` leaves an empty gap; `setDisplay(false)` removes it.
- Label+checkbox groups: keep show/hide on the **label**, but add `clearValue('<checkbox>')` for **each child checkbox** in `script_false`.

**⚠️ Scoped-app Service Portal limitation (verify per release):** known error that **catalog UI-policy *scripts* may not run for catalog items in a *scoped application* on Service Portal** (KB0695240 — OOTB, verify on your instance). If your scripts don't fire in the portal, move the logic to a **catalog client script** (those reliably run in SP).

**Don't mix mechanisms on the same field.** A UI policy and an onLoad client script both setting a field's visibility conflict — a client-script `setVisible(false)` can block the policy's show. One owner per field.

## Catalog client scripts (`catalog_script_client`)

`cat_item=<producer>`, `applies_catalog=true`, `ui_type=10` (all), `type` = onLoad/onChange/onSubmit, `cat_variable`=`"IO:<var_sys_id>"` for onChange. Patterns:
- **Prefill from a reference:** `g_form.getReference('requested_for', function(u){ g_form.setValue('phone_number', u.phone || ''); });`
- **GlideAjax to a scoped Script Include — use the FULL `api_name`:** `new GlideAjax('x_acme_fm.UserUtils')` (without the scope prefix it silently fails). See the wiki's conventions page.
- Translated field messages need the `getMessage` callback form AND the key listed in the script's `messages` field — see `client-scripts` / `workspace-client-scripts`.

### 🔥 Lessons from a peer-review pass

- **`name` on `catalog_script_client` is capped at 40 characters** (confirm via `get_table_metadata`) — a repeated prefix like `"ACME - Intake form - "` alone eats half of those 40, leaving little for the actual description and guaranteeing mid-word truncation. **Don't pad the name with context that belongs in `description`** (which is unrestricted) — keep `name` short but *complete* (e.g. `"ACME - Anonymous: clear reporter"`), and put the full explanation in `description`. Check `max_length` before naming anything; don't assume.
- **Never leave ServiceNow's default placeholder comment in a script** — `//Type appropriate comment here, and begin script below` surviving into a "finished" script is a hard signal it was never actually documented. Treat its presence the same as an empty `description`: both must be fixed together.
- **A `cat_variable` reference can point at a deleted variable and nothing will tell you.** An onChange script with `cat_variable="IO:<sys_id>"` where that `item_option_new` no longer exists will simply never fire — no error anywhere. Before trusting a script's `cat_variable`, query `item_option_new` by that sys_id and confirm it still exists.
- **Every hardcoded field-name string in a client script is a silent-failure risk after any rename/consolidation.** `g_form.getValue('requested_for')` / `g_form.setValue('requested_for', ...)` on a form where the field is actually named `u_requested_for` does **nothing** — no error, no console warning, the call just quietly returns nothing / sets nothing. Forms that have gone through renames (legacy names → new convention, individual fields → MRVS) commonly carry scripts still referencing pre-rename names months later, or referencing fields that never existed. **When auditing or writing a client script, cross-check every single hardcoded field-name string against the CURRENT live `item_option_new` list for that cat_item** (`query_records` on `item_option_new` filtered to the producer, or by `variable_set` for MRVS members) — don't spot-check, check all of them. A quick way: dump all current variable `name`s once, then grep the script for each string literal against that set.

## Routing one form to multiple target tables

A record producer auto-inserts one record of `table_name`. To route on a choice (e.g. one option → `x_acme_fm_inspection`, other options → `x_acme_fm_case`, both extending `x_acme_fm_task`):
- Point `table_name` at the **parent** (`x_acme_fm_task`).
- In the producer **script**: branch on `producer.<driver>`, `new GlideRecord('<child class>')`, map `producer.<var>` → fields, `insert()`, set `producer.redirect`, and **abort the default insert**.
- Verify the abort mechanism on the instance first (spike) — record producers don't honour `setAbortAction` the same way Business Rules do; the alternative is setting `current.sys_class_name` to the child class before insert. The `save_script` template note on item_option_new explicitly says *"Avoid current.setAbortAction() and generate a separate record."*

## Reading MRVS data in the producer's own execution script

**The community-documented `producer.<mrvs>.toString()` + `JSON.parse()` pattern does NOT work inside a Record Producer's own execution script — it silently returns an empty string, even when rows were submitted.** (Verified on a single instance — verify on yours first.) That pattern is written for MRVS variables read from a **Catalog Item / RITM** (`current.variables.<mrvs>` in a Business Rule, after submission) — not for `producer.<mrvs>` inside the producer's own script, which is a different execution context. In production this silently dropped every submitted repeatable row into a `JSON.parse('')` short-circuit — no error, no exception, no clue in the logs unless you go looking.

**What actually works:**
```javascript
var rowCount = producer.<mrvs_internal_name>.getRowCount();
var rows = [];
for (var r = 0; r < rowCount; r++) {
    rows.push(producer.<mrvs_internal_name>.getRow(r));
}
// each row is a PLAIN OBJECT keyed by the row's variable internal names —
// no JSON.parse needed:
rows[0].involvement_type     // e.g. "200"
rows[0].employee_ref         // sys_id string
```
Don't trust `JSON.stringify(producer.<mrvs>.getRow(i))` to tell you the shape — it can print a confusing object of null-valued method names (`getCellValue`, `getCells`, …) that aren't actually usable that way. Access the real fields as **direct properties** on the row object instead.

**Diagnosis method that found this** (repeatable for any "form data isn't landing on the record" bug): inject a temporary `gs.info('TAG ' + ...)` block into the producer script logging `producer.<var>.toString()` and `getRowCount()`; submit the **real form through the browser** (a background-script simulation won't populate `producer` the same way); then query `syslog`:
```json
{ "command": "query_records", "params": { "table": "syslog",
  "query": "sys_created_on>=<today HH:MM>^messageLIKETAG", "fields": "sys_created_on,message", "limit": 5 } }
```
This separates "does the row reach the server at all" (`getRowCount()` — if this is `0`, the problem is upstream in the client/form) from "does this specific read API surface it" (`toString()` vs `getRow()` — if `getRowCount()` is right but `toString()` is empty, the problem is purely the read API). The two can fail independently; conflating them wastes time chasing the wrong layer.

**Dead end to skip:** a missing/duplicate `item_option_new` "container" record for the MRVS is **not** the cause of an empty-MRVS symptom — and creating one has been observed to break the live "Add Row" modal (see "MRVS needs no separate hosting variable" above). If MRVS rows aren't reaching a table, suspect the read API first, not the form's variable structure.

## Always-do checklist

1. **Update set + scope discipline.** Catalog artifacts (producer, variables, choices, UI policies, client scripts) are **scoped** (e.g. `x_acme_fm`) → the story's scoped update set. **Translations (`sys_translated_text`) are GLOBAL** → a same-named global companion set (see the catalog-form-translations skill). Switch BOTH update set and application scope before writing; verify capture in `sys_update_xml`.
2. **Verify every write** with `get_record`/`query_records` — agent-API "success" ≠ committed, and it silently drops some reference fields (above).
3. **Flush the catalog cache** (touch the producer: `gr.get(producer); gr.update();`) after structural/translation changes, or the portal serves a stale form.
4. **If the project is multilingual** (see `language.source`/`language.targets` in `product.config.json`): every user-facing label ships in the source language here, with target-language translations added via the catalog-form-translations skill.
5. **Enumerate via the update set** (`sys_update_xml`) to get the authoritative object list — a `cat_item=` query misses variable-set/MRVS members and duplicates.
6. **Before creating a `catalog_ui_policy`, check for an existing one with the same condition** on this catalog item and extend it instead of adding a duplicate — see the pitfall note in "Catalog UI policies" above.
7. **Variable `name` (technical name) is always English snake_case**, even when labels/translations are another-language-first. Don't name a new variable after its translated label.

Related: catalog-form-translations, sp-widget-patterns, client-scripts, ui-actions-policies.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
