---
title: Project Conventions
last-verified: <fill at engagement>
---

# Project Conventions

> **Verify before use.** These rules are distilled from things that actually break on
> real ServiceNow instances; where a generic best-practice sweep, vendor doc, or skill
> disagrees (journal fields!), **this page wins**. Verify behavioural claims against the
> live instance before "correcting" code that follows them. Behaviors marked
> *(verify on your instance first)* were confirmed on one instance and may vary by
> release or configuration.

## 1. Variable naming — explicit, no single letters

Every variable gets an intention-revealing name, **including callback/lambda parameters
and short-lived locals**: `caseRow` not `r`, `approvalResponse` not `resp`,
`locationChain` not `chain`. Only tolerated exception: numeric loop counters `i`/`j` in
a classic `for`. A reviewer must never have to read the body to learn what a variable
holds. Applies everywhere: Script Includes, Business Rules, Client Scripts, Fix Scripts,
sandbox one-liners.

**GlideRecord prefixes:** `gr` + table name (`grIncident`, `grUser`) — bare `gr` only when
a single record is in play; `ga` for GlideAggregate (`gaRecords`).

## 2. Server-side JS engine — match the file you're editing

Global-scope Rhino artifacts (Business Rules, fix scripts, global Script Includes) =
**ES5** (`var`, no `const`/`let`/arrow functions/classes). A scoped app may support
**modern JS** (ES6+ classes) depending on its runtime setting — check what the existing
files in that scope actually use. Rule: **match the file you're editing**; don't
"modernize" an ES5 file or down-convert an ES6 one. Workspace client scripts are
modern-JS contexts.

## 3. Translation mechanics

Language policy (which languages ship) is a per-project decision: see
`product.config.json → language.source` / `language.targets`. When the project is
multilingual, never hardcode user-facing text in any language. The mechanics below are
platform law regardless of language pair:

- **Server:** `gs.getMessage('<key>')` → matching `sys_ui_message` records per language;
  no extra wiring.
- **Client:** `getMessage('<key>')` **and** every key listed in the client script's
  `messages` field (comma-separated, no spaces). Missing entry → the raw key renders as
  text, silently. Full pattern: `client-scripts` skill.
- **Translation tables:** field type `string` → `sys_translated`; field type
  `translated_text` (e.g. `sys_ux_form_action.name`) → `sys_translated_text` with
  `documentkey=<record_sys_id>` — using `sys_translated` there silently fails.
- **Before any translation work:** confirm the session language is the source language.
  A translated-language session makes API queries return display values, hiding what is
  actually stored.

## 4. Message keys

Format: `<namespace>.<scope>.<key>` — the namespace is this project's
`product.config.json → naming.messageKeyNamespace` (e.g.
`acme.case_selection.category_required`). Defined as `sys_ui_message` records, one per
project language.

## 5. Record names — source-language names, translations via the translation layer

- **Business Rules / UI Policies:** `<prefix><description>` — the prefix is this
  project's `product.config.json → naming.recordPrefix` (e.g. "ACME - "). Always set a
  `description` field on create AND update. Keep `sys_script.name` ≤ 40 chars —
  **silent truncation beyond that**, after which name-based lookups find nothing; look
  BRs up by sys_id.
- **UI Actions:** clean names **without** the record prefix ("Complete action", "Add sub
  action"). The workspace falls back to `sys_ui_action.name` as the button label, so a
  prefix would leak onto the button. Translated labels go on the layout item via
  `sys_translated` — never on `name`.

## 6. BR filter scoping — scope the filter, but verify the path

Business Rules on high-traffic tables must be scoped (filter condition) so they don't
fire on every record. **But dot-walked filters hide a trap:**

```
filter_condition: parent_case.category=facility     ❌ can match ZERO rows — BR silently dead
```

If `parent_case` references a **base** table (say `x_acme_fm_task`) and `category`
exists only on a child table (`x_acme_fm_case`), the base-ref → child-field dot-walk is
invalid and returns 0 rows **without any error** — the BR simply never fires *(verify on
your instance first; confirmed live on one instance where several active BRs had never
fired)*. Correct pattern: drop the dot-walk from the filter and guard **in-script**:

```javascript
var grCase = new GlideRecord('x_acme_fm_case');
if (!grCase.get(current.getValue('parent_case')) || grCase.getValue('category') != 'facility') {
    return; // parent is not a facility case — out of scope for this rule
}
```

After adding/changing any filter condition: runtime-verify the BR actually fires (A/B
the encoded query in a list view). See the `business-rule-patterns` skill.

## 7. GlideRecord values — setValue/getValue, with ONE inversion

Baseline: always `gr.getValue('field')` / `gr.setValue('field', value)` — never direct
property access.

**Exception — journal fields (`work_notes`, `comments`):** write with **direct
assignment** (`gr.work_notes = text`) or **`gr.work_notes.setJournalEntry(text)`**.
`gr.setValue('work_notes', text)` does **not** register a journal entry — the write is
silently dropped (`setValue` → 0 entries, direct assignment → 1; *verify on your
instance first*). Both correct forms are equivalent here; don't churn a working one for
the other. The `setJournalEntry(text, user)` overload is only for attributing a note to
a *different* user (integration/impersonation scenarios). This is the one place the
"always setValue" rule is inverted — a best-practice sweep WILL flag the correct code as
a violation. Leave a short comment on the line so it isn't "fixed" back into a silent
break. See also [gotchas](gotchas.md).

## 8. Scoped Script Include calls — full `api_name`

Calling any Script Include in a scoped app from anywhere — GlideAjax, server, another
scope — requires the **scope-prefixed `api_name`**:

```javascript
var ga = new GlideAjax('x_acme_fm.CaseUtilsAjax');  // ✅
var ga = new GlideAjax('CaseUtilsAjax');            // ❌ silent failure
```

Query `sys_script_include.api_name` when unsure.

## 9. Sandbox scripts — single expression only

Filter conditions, dynamic defaults, AMB/RecordWatcher conditions, `javascript:` prefixes
run in the Guarded Script sandbox: one expression, no `var`/`if`/loops/assignments/multi-
statement. Logic goes in a Script Include, called as a one-liner:
`new MyHelper().getValue(current.priority)`. Does not apply to client scripts or Script
Includes themselves. (Also a kernel hard rule — see [hard-rules](hard-rules.md).)

## 10. Comments & JSDoc — terse but useful

- **Class JSDoc:** 1–2 lines (what + why-it-exists if non-obvious).
- **Method JSDoc:** 1-line WHAT + `@param` + `@return`. Add a `Why:` line ONLY for
  platform quirks or hidden invariants the next reader would miss.
- **Inline comments:** comment the *why* wherever a future reader would pause — long
  functions, multi-step flows, non-obvious branching, deliberate rule inversions (§7).
  Skip them when the next line is self-explanatory; never restate WHAT the code says.
- No multi-paragraph docstrings on trivial helpers — they hide the logic.
