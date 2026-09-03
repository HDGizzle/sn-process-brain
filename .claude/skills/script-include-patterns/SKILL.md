---
name: script-include-patterns
description: Invoke when the user asks to "create script include", "utility class", "AbstractAjaxProcessor", "GlideAjax", "client callable", "reusable code", or when building any ServiceNow Script Include (server-side library).
---

# Script Include Patterns for ServiceNow

Script Includes are reusable server-side JavaScript libraries callable from any server-side script (and, when client-callable, from the client via GlideAjax).

Placeholders used throughout: scope `x_acme_fm`, table `x_acme_fm_case`, class names `AcmeCaseUtils` / `AcmeCaseUtilsAjax`. These are **examples** — substitute the values from `product.config.json` (`scopes.app`, `naming.*`).

## Core Design Principle — Always Generic, Never Hardcoded

**A Script Include must contain zero hardcoded business values.** Table names, record sys_ids, field names, CSS strings, HTML templates, email addresses, configuration values, and form-specific constants belong to the CALLER — never to the Script Include.

The Script Include is a **reusable engine**; the caller **owns the context**.

| Wrong — hardcoded in SI | Correct — passed by caller |
|---|---|
| `pdfApi.convertToPDF(html, 'x_acme_fm_case', sysId, ...)` | `pdfApi.convertToPDF(html, data.target_table, sysId, ...)` |
| `email.setTo('ehs@example.gov')` | `email.setTo(data.recipient)` |
| `var pageSize = 'A4'` | `var pageSize = data.page_size \|\| 'A4'` |
| Inline CSS in `_styles()` | `config.css \|\| this._defaultStyles()` |

**GlideAjax parameter pattern:** accept a single `sysparm_data` JSON carrying all parameters, and default what can safely be defaulted so callers only pass what differs:

```javascript
generatePDFAjax: function() {
    var data        = JSON.parse(this.getParameter('sysparm_data'));
    var html        = data.html_content;                          // required — no default
    var targetTable = data.target_table     || 'x_acme_fm_case';  // example default
    var pdfName     = data.pdf_name         || 'document.pdf';
    var pageSize    = data.page_size        || 'A4';
    var orientation = data.page_orientation || 'PORTRAIT';
    // ...
}
```

**Why it matters:** a table name or address baked into the SI needs a code deploy to change. Passed by the caller (widget, business rule, another SI), it changes without touching the engine.

## Project Rules

Values below come from `product.config.json`; the mechanics are framework law.

- **Cross-scope DB reads need a `sys_scope_privilege` row.** A scoped SI (e.g. `x_acme_fm`) reading a table owned by another scope — including every hop of a dot-walk such as `caseRecord.requested_for.department.dept_head` — is blocked unless `sys_scope_privilege` holds a matching row: `source_scope=<your scope>`, `target_name=<table>`, `target_type='sys_db_object'`, `operation=read`, `status=allowed`. Each dot-walk hop is checked separately. Failure surfaces as a red UI banner: *"Read operation on table 'X' from scope 'Y' was denied. The application must declare a cross scope access privilege."* Before writing an SI that reaches outside its scope, query `sys_scope_privilege` for `source_scope=<your scope sys_id>` and confirm a read grant for every table touched (`sys_user`, `cmn_department`, `sys_user_group`, …). Add missing rows via `create_artifact` on `sys_scope_privilege`. The `admin` role does NOT bypass this — scope isolation applies regardless.
- **A record's `sys_scope` ≠ effective read scope.** Rows on a global platform table can carry your app's `sys_scope` (because your app inserted them), but the privilege check follows the **TABLE's owning scope**, not the row's. Example: `sys_decision_multi_result` is a global table even when individual rows carry your app scope — reads from a scoped SI still need the cross-scope grant. Row-level `sys_scope` is update-set-tracking metadata, nothing more. Never skip the grant on a "same scope" assumption.
- **Scriptable platform APIs (e.g. `ScriptableDecisionTableAPI`) need a `target_type='scriptable'` privilege row with `operation='execute'`** when called from a scoped SI. Example for calling `getDecision`: `target_name='ScriptableDecisionTableAPI.getDecision'`, `target_type='scriptable'`, `operation='execute'`, `target_scope='global'`. Several OOTB plugin scopes already declare this — query existing `sys_scope_privilege` rows for working examples.
- **Calling a scoped Script Include from anywhere requires the full `api_name` including scope prefix.** Applies to GlideAjax (client), `new x_acme_fm.AcmeCaseUtils()` (server-side cross-scope), and everything in between. Without the prefix the call **silently fails** — no error, callback returns nothing, server-side resolves to undefined.
  ```javascript
  // Client (GlideAjax)
  new GlideAjax('x_acme_fm.AcmeCaseUtilsAjax');   // correct
  new GlideAjax('AcmeCaseUtilsAjax');              // silently fails

  // Server-side cross-scope
  new x_acme_fm.AcmeCaseUtils().doThing();         // correct
  ```
  Query `sys_script_include.api_name` for the exact value.
- **Naming:** PascalCase class name; always include `type: 'ClassName'` and `initialize: function() {}`. Do NOT prepend the customer record prefix (`naming.recordPrefix`) to Script Include class names — the scope prefix in `api_name` already namespaces them; the record prefix is for display names of configuration artifacts.
- **Default ES5; ES12 opt-in for scoped apps.** New Script Includes default to ES5 (Rhino): `var`, `Class.create()`, no `const`/`let`. ES12 (ES2021) is available in scoped-app Script Includes (since Tokyo) when modern syntax materially improves clarity — `class`, destructuring, optional chaining, template literals. Opt in via Application Settings → JavaScript Mode, or per-script. **Hard ban in global scope:** ES12 in `global` is broken through Yokohama (KB1699139, PRB1794568) — keep global Script Includes on ES5. **Deploy gotcha (verify on your instance first):** the per-script ES12 toggle does NOT survive update-set promotion — after promotion the script falls back to ES5 and modern syntax throws SyntaxError. Either stay ES5 or document a manual re-toggle step in the deploy notes. See the `es5-compliance` skill for the full when-to-use-which table.
- **Always fill the `description` field** on `sys_script_include`, written in the project's source language (`language.source` in `product.config.json`).
- **Client-callable SIs:** the consuming client script must list every `getMessage` key it uses in its `messages` field — a client-script concern, but design the GlideAjax contract with it in mind.
- **Translations:** if the SI returns user-visible text, use `gs.getMessage('<namespace>.<key>')` (namespace from `naming.messageKeyNamespace`) and create `sys_ui_message` records for the source language plus every target in `language.targets`. Never hardcode user-visible strings.

## Script Include Types

| Type | Use Case | Client Callable |
|---|---|---|
| **Standard** | Server-side utilities | No |
| **Client Callable** | GlideAjax from client | Yes |
| **On-Demand** | Lazy loading | No |
| **AbstractAjaxProcessor** | Client-server communication | Yes |

## Standard Script Include (ES5 example)

```javascript
var AcmeCaseUtils = Class.create();
AcmeCaseUtils.prototype = {
    initialize: function() {
        this.LOG_PREFIX = '[AcmeCaseUtils] ';
    },

    /**
     * Get case by number.
     * @param {string} caseNumber - Case number
     * @returns {GlideRecord|null}
     */
    getByNumber: function(caseNumber) {
        var caseRecord = new GlideRecord('x_acme_fm_case');
        caseRecord.addQuery('number', caseNumber);
        caseRecord.query();
        if (caseRecord.next()) {
            return caseRecord;
        }
        return null;
    },

    /**
     * Get open cases for a user as lightweight objects.
     * @param {string} userSysId
     * @returns {Array}
     */
    getOpenCasesForUser: function(userSysId) {
        var cases = [];
        var caseRecord = new GlideRecord('x_acme_fm_case');
        caseRecord.addQuery('opened_by', userSysId);
        caseRecord.addQuery('active', true);
        caseRecord.orderByDesc('opened_at');
        caseRecord.query();
        while (caseRecord.next()) {
            cases.push({
                sys_id: caseRecord.getUniqueValue(),
                number: caseRecord.getValue('number'),
                short_description: caseRecord.getValue('short_description'),
                state: caseRecord.state.getDisplayValue()
            });
        }
        return cases;
    },

    type: 'AcmeCaseUtils'
};
```

## Client Callable Script Include — the `global.AbstractAjaxProcessor` trap

**CRITICAL: in scoped apps, ALWAYS extend `global.AbstractAjaxProcessor`.** Without the `global.` prefix the method still executes, but the return value is never written into the XML response — `getXMLAnswer` receives `null`. No error anywhere.

```javascript
// WRONG in scoped apps — return value silently lost, getXMLAnswer returns null
AcmeCaseUtilsAjax.prototype = Object.extendsObject(AbstractAjaxProcessor, {

// CORRECT in scoped apps — return value properly set in the XML answer attribute
AcmeCaseUtilsAjax.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {
```

Client-side call pattern:

```javascript
function getCaseDetails(caseSysId, callback) {
    var ga = new GlideAjax('x_acme_fm.AcmeCaseUtilsAjax');  // full api_name — see Project Rules
    ga.addParam('sysparm_name', 'getCaseDetails');
    ga.addParam('sysparm_case_id', caseSysId);
    ga.getXMLAnswer(function(answer) {
        callback(JSON.parse(answer));
    });
}
```

## Inheritance Pattern (ES5)

Use `Object.extendsObject` and chain `initialize` explicitly:

```javascript
var TaskUtils = Class.create();
TaskUtils.prototype = {
    initialize: function(tableName) {
        this.tableName = tableName || 'task';
    },
    getByState: function(state) { /* shared query logic on this.tableName */ },
    type: 'TaskUtils'
};

var AcmeCaseUtilsExtended = Class.create();
AcmeCaseUtilsExtended.prototype = Object.extendsObject(TaskUtils, {
    initialize: function() {
        TaskUtils.prototype.initialize.call(this, 'x_acme_fm_case');
    },
    type: 'AcmeCaseUtilsExtended'
});
```

## CRITICAL: Utils + Ajax Architecture Pattern

For client-server functionality, ALWAYS build TWO Script Includes:

| Script Include | Purpose | Client Callable | Contains |
|---|---|---|---|
| `AcmeCaseUtils` | Server-side logic | **No** | All business logic, queries, ref-qual methods |
| `AcmeCaseUtilsAjax` | Client-callable wrapper | **Yes** | Thin wrapper that delegates to Utils |

```javascript
// CORRECT — Utils holds all logic, reusable from BRs, ref quals, other SIs
var AcmeCaseUtils = Class.create();
AcmeCaseUtils.prototype = {
    initialize: function() {},

    getFilteredRecords: function(parentId) {
        var childRecord = new GlideRecord('x_acme_fm_case');
        childRecord.addQuery('parent', parentId);
        childRecord.query();
        var result = { count: childRecord.getRowCount() };
        if (result.count === 1 && childRecord.next()) {
            result.sys_id = childRecord.getUniqueValue();
            result.display_value = childRecord.getDisplayValue();
        }
        return result;
    },

    getRefQualFilter: function(current) {
        if (current && current.parent_field) {
            return 'parent=' + current.parent_field;
        }
        return 'sys_idISEMPTY';
    },

    type: 'AcmeCaseUtils'
};

// CORRECT — Ajax is a thin wrapper only
var AcmeCaseUtilsAjax = Class.create();
AcmeCaseUtilsAjax.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {

    getFilteredRecords: function() {
        var parentId = this.getParameter('sysparm_parent_id');
        return JSON.stringify(new AcmeCaseUtils().getFilteredRecords(parentId));
    },

    type: 'AcmeCaseUtilsAjax'
});
```

```javascript
// WRONG — logic buried in the Ajax class: unreachable from BRs and ref quals
var AcmeCaseUtilsAjax = Class.create();
AcmeCaseUtilsAjax.prototype = Object.extendsObject(global.AbstractAjaxProcessor, {
    getFilteredRecords: function() {
        var childRecord = new GlideRecord('x_acme_fm_case');
        // ... query logic that nothing server-side can reuse
    },
    type: 'AcmeCaseUtilsAjax'
});
```

## Reference Qualifiers via Script Include

When a reference field needs dynamic filtering from the current record, call a Utils method from the reference qualifier — this matters especially in configurable workspaces, where `current` is not reliably available to inline qualifiers:

```
// Dictionary → Reference qualifier field:
javascript:new AcmeCaseUtils().getRefQualFilter(current)
```

Reference qualifiers are sandbox scripts: a single expression, no statements — all logic lives in the Script Include.

## CRITICAL: JSDoc Comments — WHAT + WHY, but TERSE

Every Script Include gets JSDoc — kept **terse and programmatic**. Over-documentation reads as noise, dates fast, and buries the logic. WHY earns its place only when non-obvious; if the code says it, don't repeat it in prose.

**Length budget (aligns with the wiki's conventions page):**
- **Class:** 1–2 lines — what it does, plus why-it-exists if non-obvious. The worked example below is the *ceiling* for a genuinely complex class, not the default.
- **Method:** 1-line WHAT + `@param` + `@returns`. Add **one** short `Why:`/quirk line ONLY for a platform quirk or hidden invariant the next reader would miss — 1–2 lines, never a paragraph.
- **Never** put migration history, story narratives, or "this cost us N hours" backstory in a method header — that belongs in story docs / git. A one-clause story-ID tag (e.g. `(STRY0000123)`) is plenty.

Litmus test: if a line explains what the next line of code plainly does, or recounts history, cut it.

### Class-level JSDoc (ceiling example)

```javascript
/**
 * AcmeCaseUtils
 *
 * Server-side utility for the case table (x_acme_fm_case).
 * Centralises reusable business logic so it can be called from:
 *   - Reference qualifiers (getRefQualFilter)
 *   - AcmeCaseUtilsAjax (thin client-callable wrapper)
 *   - Business rules
 *
 * @class AcmeCaseUtils
 * @scope x_acme_fm
 */
```

### Method-level JSDoc

```javascript
/**
 * Returns an encoded query filtering child records to the parent case.
 *
 * Why Script Include: 'current' is not reliably available to inline
 * reference qualifiers in configurable workspaces.
 *
 * @param {GlideRecord} current - The current case record
 * @returns {string} Encoded query for x_acme_fm_case
 */
```

### Platform quirk comments

```javascript
/**
 * Why global.AbstractAjaxProcessor: in scoped apps, AbstractAjaxProcessor
 * is a global class. Without the 'global.' prefix the method executes but
 * the return value is silently dropped — getXMLAnswer returns null.
 */
```

## Best Practices

1. **Single responsibility** — one class, one purpose
2. **Utils + Ajax pattern** — logic in Utils, thin Ajax wrapper for client calls
3. **Meaningful names** — `AcmeCaseUtils`, never `Utils`; Ajax classes MUST end with `Ajax`
4. **JSDoc, terse** — WHAT + non-obvious WHY + platform quirks, within the length budget above
5. **Error handling** — try-catch with logging
6. **Private methods** — underscore prefix
7. **No side effects** — `initialize` must not modify data
8. **Testable** — methods callable in isolation
9. **Match the file's JS mode** — ES5 by default; ES12 only per the Project Rules above
10. **Scoped GlideAjax** — ALWAYS the full `api_name` with scope prefix
11. **`global.AbstractAjaxProcessor`** — ALWAYS the `global.` prefix in scoped apps
12. **Explicit variable names** — no single-letter or cryptic names anywhere, including callback params (`.map(function (caseRow) {...})`, not `function (r)`) and response holders (`decisionResponse`, not `resp`). Only exception: numeric `for` counters `i`/`j`. See the wiki's conventions page.
13. **No hardcoded sys_ids** — store table/record/decision-table sys_ids in scoped `sys_properties` (`<scope>.<feature>.<key>`) and read via `gs.getProperty(name, '')` with an empty-value guard. Hardcoded sys_ids break promotion across instances.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
