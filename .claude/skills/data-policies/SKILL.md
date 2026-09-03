---
name: data-policies
description: Invoke when the user mentions "data policy", "sys_dictionary", "sys_documentation", "sys_choice", "choice list", "create field", "add field", "field validation", "mandatory field", "column attributes", "field translation", or when working on the ServiceNow dictionary / data-model layer.
---

# Data Policies & Dictionary for ServiceNow

The dictionary layer (`sys_dictionary` and friends) defines the schema and default field
behavior; Data Policies (`sys_data_policy2`) enforce data-integrity rules across UI,
import sets, and web services. This skill covers both, plus the label/choice/translation
records that ride along with every field.

## Project Rules (mandatory)

- **Field labels:** create/update `sys_documentation` records — one per project language.
  Do NOT use dictionary overrides just to relabel a field. Pattern:
  ```
  create_artifact on sys_documentation with name=<table>, element=<field>, language=<lang>, label=<new label>
  ```
- **Choice labels (existing choices):** `update_record` on `sys_choice.label`.
- **New choice on a child table:** `create_artifact` on `sys_choice` with
  `name=<child_table>` (this creates a *dedicated* choice on the child).
- **⚠️ Dedicated choice = parent suppression.** The moment a child table gets its FIRST
  dedicated choice on a field, ALL inherited parent choices for that field stop showing
  for that table. So when adding even one new state, create dedicated choices for ALL
  states you want to keep — not just the new one.
- **Languages:** every choice label and field label ships in the project's source
  language plus every target language (see `product.config.json` →
  `language.source` / `language.targets`). The source label is the dictionary/choice
  record itself; each target-language label goes through the same `sys_documentation` /
  `sys_choice` mechanism with the target `language` value.
- **Numeric choice values — spacing rule:** when creating new choices with numeric
  values, always use multiples of **10** (10, 20, 30, …). That leaves room to insert
  values later (11–19, 21–29) without renumbering. Never use consecutive integers
  (1, 2, 3). Query the existing choices first to find the next free slot — legacy
  non-numeric values may coexist with the numeric series; leave them alone and continue
  the numeric series at the next multiple of 10.

## Architecture

```
Dictionary (sys_dictionary)
    ├── Field Definition
    │   ├── Type, Length, Default
    │   └── Dependent Field
    └── Dictionary Overrides (sys_dictionary_override)

Data Policy (sys_data_policy2)
    └── Data Policy Rules (sys_data_policy_rule)
        └── Condition-based field behaviors
```

## Key Tables

| Table                     | Purpose           |
| ------------------------- | ----------------- |
| `sys_dictionary`          | Field definitions |
| `sys_dictionary_override` | Scoped overrides  |
| `sys_data_policy2`        | Data policies     |
| `sys_data_policy_rule`    | Policy rules      |
| `sys_db_object`           | Table definitions |

## Dictionary Management (ES5)

Background/fix scripts run in Rhino — ES5 only (`var`, no arrow functions, no classes).

### Create Table

```javascript
// Create a custom table (ES5)
var table = new GlideRecord('sys_db_object');
table.initialize();
table.setValue('name', 'x_acme_fm_case');       // example scope/table
table.setValue('label', 'Facilities Case');
table.setValue('super_class', 'task');          // extends task
table.setValue('is_extendable', true);
table.setValue('create_access_controls', true);
table.setValue('live_feed_enabled', false);
table.insert();
```

### Before you add a field — reuse & naming check (do this first)

Minting a new `u_*` column should be the last resort, not the reflex. Before creating
any field, run these two checks:

1. **Reuse check — does a field for this purpose already exist?** Look in three places,
   in order:
   - **The inheritance chain.** The table's `super_class` ancestors already expose their
     fields. A Task-extending table inherits `assigned_to`, `due_date`, `state`,
     `short_description`, `description`, `close_notes`, `work_notes`, `parent`,
     `opened_by`, etc. Reuse these (a "conclusion" field is `close_notes`; an
     "investigator" is `assigned_to`) instead of adding a parallel custom column.
   - **Sibling tables under the same base.** A concept is often an established field
     replicated per-table across siblings (it can't always live on the shared base —
     e.g. a "belongs-to-parent" link must exist on the children but *not* on the root
     table). Check whether siblings already define it under a canonical name.
   - **The live record.** Query the target table for the candidate field name. The
     agent API **silently drops** query/response fields that don't exist (returns the
     other fields, no error) — a field absent from the response is not a column there.
     Confirm with a `sys_dictionary` query on `element=<name>` across the table and its
     ancestors.

2. **Naming — a field YOU add keeps its `u_` prefix. Never strip `u_` to mimic an OOTB
   name.** The `u_` prefix honestly marks a field as *your customization* rather than
   vendor OOTB. Seeing the same concept under a bare (no-prefix) name on **sibling
   tables** does NOT mean your new field should match — those bare names exist because
   the **vendor** created those fields in their own app. A field you add to your own
   (or a customized) table is custom; it stays `u_`. Renaming it to the bare OOTB name
   disguises a customization as vendor-owned (misleading on upgrades and audits), and in
   scoped/global contexts the platform usually forces the `u_` prefix anyway. So: reuse
   a genuinely **inherited/available** field when one exists on your table (check #1);
   otherwise add your own **with** the `u_` prefix — don't impersonate OOTB.
   > **Example:** a vendor app defines a bare reference field `fm_case` (→
   > `x_vendor_fm_case`) on its own child tables (`x_vendor_fm_action`,
   > `x_vendor_fm_document`). Your custom-built child table needs the same link, so
   > `u_fm_case` — **with** the `u_` prefix — is correct: it is your customization, not
   > OOTB, and the prefix says so. The bare `fm_case` on the vendor's siblings is not a
   > naming target to copy. (Reuse of a truly inherited field like `parent` is
   > different — that field genuinely exists on your table already.)

### Create Field

```javascript
// Create a field on a table (ES5)
var field = new GlideRecord('sys_dictionary');
field.initialize();

// Table and element
field.setValue('name', 'x_acme_fm_case');
field.setValue('element', 'u_customer_name');

// Field properties
field.setValue('column_label', 'Customer Name');
field.setValue('internal_type', 'string');
field.setValue('max_length', 100);
field.setValue('mandatory', false);
field.setValue('read_only', false);
field.setValue('display', false);
field.setValue('active', true);

// Default value
field.setValue('default_value', '');

// Reference-field specific
// field.setValue('reference', 'customer_account');
// field.setValue('reference_qual', 'active=true');

field.insert();
```

### Field Types

Common `internal_type` values:

| Type            | internal_type       |
| --------------- | ------------------- |
| String          | `string`            |
| Integer         | `integer`           |
| Decimal         | `decimal`           |
| True/False      | `boolean`           |
| Date            | `glide_date`        |
| Date/Time       | `glide_date_time`   |
| Reference       | `reference`         |
| Choice          | `choice`            |
| Journal         | `journal`           |
| Journal Input   | `journal_input`     |
| HTML            | `html`              |
| URL             | `url`               |
| Email           | `email`             |
| Script          | `script`            |
| Conditions      | `conditions`        |

```javascript
// Generic field-creation helper (ES5)
function createField(tableName, fieldDef) {
    var field = new GlideRecord('sys_dictionary');
    field.initialize();
    field.setValue('name', tableName);
    field.setValue('element', fieldDef.name);
    field.setValue('column_label', fieldDef.label);
    field.setValue('internal_type', fieldDef.type);

    if (fieldDef.maxLength)
        field.setValue('max_length', fieldDef.maxLength);
    if (fieldDef.reference)
        field.setValue('reference', fieldDef.reference);
    if (fieldDef.choices)
        field.setValue('choice', 1); // field has a choice list

    return field.insert();
}
```

### Create Choices

```javascript
// Create choice-list values (ES5)
function createChoices(tableName, fieldName, choices) {
    for (var i = 0; i < choices.length; i++) {
        var choice = new GlideRecord('sys_choice');
        choice.initialize();
        choice.setValue('name', tableName);
        choice.setValue('element', fieldName);
        choice.setValue('value', choices[i].value);
        choice.setValue('label', choices[i].label);
        choice.setValue('sequence', (i + 1) * 10);
        choice.setValue('inactive', false);
        choice.insert();
    }
}

// Example usage
createChoices('x_acme_fm_case', 'u_review_status', [
    { value: 'pending', label: 'Pending Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' }
]);
```

## Dictionary Overrides (ES5)

Use overrides to change behavior of an **inherited** field on one child table
(mandatory, label, default, length) — not to relabel per language (that is
`sys_documentation`).

```javascript
// Create a dictionary override (ES5)
var override = new GlideRecord('sys_dictionary_override');
override.initialize();

// The base field being overridden
override.setValue('base_table', 'task');
override.setValue('base_element', 'short_description');

// The child table the override applies to
override.setValue('name', 'x_acme_fm_case');

// Overridden properties
override.setValue('column_label', 'Request Summary');
override.setValue('mandatory', true);
override.setValue('read_only', false);
override.setValue('max_length', 200);
override.setValue('default_value', '');

override.insert();
```

## Data Policies (ES5)

Data policies enforce field states (mandatory / read-only / visible) at the data layer —
unlike UI policies they can also apply to import sets and SOAP/REST writes.

### Create Data Policy

```javascript
// Create a data policy (ES5)
var policy = new GlideRecord('sys_data_policy2');
policy.initialize();

policy.setValue('model_table', 'incident');
policy.setValue('short_description', 'Resolution Fields Required on Resolve');
policy.setValue('active', true);

// Condition — when the policy applies
policy.setValue('conditions', 'state=6'); // Resolved

// Enforcement surfaces
policy.setValue('apply_to_client', true);      // also act as UI policy
policy.setValue('apply_to_import_sets', true);
policy.setValue('apply_to_soap', true);

// Undo the field states when the condition stops matching
policy.setValue('reverse_if_false', true);

var policySysId = policy.insert();

// Attach the field rules
addDataPolicyRule(policySysId, 'resolution_code', true, false, false);
addDataPolicyRule(policySysId, 'close_notes', true, false, false);
```

### Add Policy Rules

```javascript
// Add a data policy rule (ES5)
function addDataPolicyRule(policySysId, fieldName, mandatory, readOnly, hidden) {
    var rule = new GlideRecord('sys_data_policy_rule');
    rule.initialize();
    rule.setValue('sys_data_policy', policySysId);
    rule.setValue('field', fieldName);
    rule.setValue('mandatory', mandatory);
    rule.setValue('read_only', readOnly);
    rule.setValue('visible', !hidden);
    return rule.insert();
}
```

### Scripted-Condition Data Policy

For conditions an encoded query cannot express, set `use_as_condition` and supply a
script that returns true/false:

```javascript
// Data policy with a scripted condition (ES5)
var policy = new GlideRecord('sys_data_policy2');
policy.initialize();

policy.setValue('model_table', 'change_request');
policy.setValue('short_description', 'High Risk Change Requirements');
policy.setValue('active', true);

policy.setValue('use_as_condition', true);
policy.setValue('script',
    '(function checkCondition(current) {\n' +
    '    // High-risk changes require extra documentation\n' +
    '    if (current.risk == "high")\n' +
    '        return true;\n' +
    '    // Also apply to changes touching critical CIs\n' +
    '    if (current.cmdb_ci) {\n' +
    '        var ci = current.cmdb_ci.getRefRecord();\n' +
    '        if (ci.business_criticality == "1 - most critical")\n' +
    '            return true;\n' +
    '    }\n' +
    '    return false;\n' +
    '})(current);'
);

var policySysId = policy.insert();

addDataPolicyRule(policySysId, 'implementation_plan', true, false, false);
addDataPolicyRule(policySysId, 'backout_plan', true, false, false);
addDataPolicyRule(policySysId, 'test_plan', true, false, false);
addDataPolicyRule(policySysId, 'justification', true, false, false);
```

## Field Validation (ES5)

### Dictionary Attribute Validation

```javascript
// Add validation to a dictionary field (ES5)
var field = new GlideRecord('sys_dictionary');
field.addQuery('name', 'incident');
field.addQuery('element', 'u_email');
field.query();
if (field.next()) {
    field.setValue('attributes', 'validate=email');
    field.update();
}
```

Common validation attributes: `validate=email`, `validate=phone_number`,
`validate=url`, `validate=script` (script lives in the field's Calculated Value).

### Script Validation

```javascript
// Calculated-value field with validation (ES5)
// Set in Dictionary > Calculated Value
(function calculate() {
    var phone = current.getValue('u_phone');
    if (!phone) return '';

    var phonePattern = /^\+?[1-9]\d{1,14}$/;
    if (!phonePattern.test(phone.replace(/[\s\-\(\)]/g, ''))) {
        gs.addErrorMessage('Invalid phone number format');
        return '';
    }
    return phone;
})();
```

## Schema Queries (ES5)

### Get Table Fields

```javascript
// List all active fields of a table (ES5)
function getTableFields(tableName) {
    var fields = [];
    var dict = new GlideRecord('sys_dictionary');
    dict.addQuery('name', tableName);
    dict.addQuery('internal_type', '!=', 'collection');
    dict.addQuery('active', true);
    dict.orderBy('element');
    dict.query();
    while (dict.next()) {
        fields.push({
            name: dict.getValue('element'),
            label: dict.getValue('column_label'),
            type: dict.getValue('internal_type'),
            mandatory: dict.getValue('mandatory') === 'true',
            reference: dict.getValue('reference'),
            maxLength: dict.getValue('max_length')
        });
    }
    return fields;
}
```

Note: this queries the table's own rows only — inherited fields live on the ancestor
tables' `sys_dictionary` rows. Walk `sys_db_object.super_class` for the full picture.

### Check Field Exists

```javascript
// Does a field exist on this table? (ES5)
function fieldExists(tableName, fieldName) {
    var dict = new GlideRecord('sys_dictionary');
    dict.addQuery('name', tableName);
    dict.addQuery('element', fieldName);
    dict.query();
    return dict.hasNext();
}
```

## Best Practices

1. **Design the schema before building it** — run the reuse & naming check above first.
2. **Custom fields keep the `u_` prefix** — never disguise a customization as OOTB.
3. **Pick the right `internal_type`** — changing types later is painful and lossy.
4. **Mandatory only when truly required** — data policies with `apply_to_import_sets`
   will block integrations on fields users consider "usually filled".
5. **Data policies for data-layer rules, UI policies for form ergonomics.**
6. **Avoid heavy calculated fields** — they run on every read.
7. **Document custom schema** in the project wiki as you go.
8. **ES5 only in global-scope scripts** — match the scope of the file you're editing.

## Critical: Scope Handling for Background Scripts

Background scripts run in **global scope**; records intended for a scoped app must set
`sys_scope` (and `sys_package`) explicitly, or they land in global:

```javascript
var SCOPE_ID = '<scope_sys_id>'; // sys_id of the sys_scope row — verify on your instance

var field = new GlideRecord('sys_dictionary');
field.initialize();
field.setValue('name', 'x_acme_fm_case');
field.setValue('element', 'u_my_field');
// ... field properties ...
field.sys_scope = SCOPE_ID;   // set scope!
field.sys_package = SCOPE_ID; // set package!
field.insert();
```

## Field Translations (sys_documentation)

After creating fields, add a label per project language. The language pair comes from
`product.config.json` (`language.source` / `language.targets`).

```javascript
function upsertTranslation(tableName, fieldName, lang, label) {
    var gr = new GlideRecord('sys_documentation');
    gr.addQuery('name', tableName);
    gr.addQuery('element', fieldName);
    gr.addQuery('language', lang);
    gr.query();
    if (gr.next()) {
        gr.setValue('label', label);
        gr.update();
    } else {
        gr.initialize();
        gr.setValue('name', tableName);
        gr.setValue('element', fieldName);
        gr.setValue('language', lang);
        gr.setValue('label', label);
        gr.sys_scope = SCOPE_ID;
        gr.insert();
    }
}

// Create a label for the source language and every target language, e.g.:
upsertTranslation('x_acme_fm_case', 'u_my_field', 'en', 'My Field');
upsertTranslation('x_acme_fm_case', 'u_my_field', '<target_lang>', '<translated label>');
```

## Multi-Language Choice Creation

On multi-language projects, create every choice in all project languages:

```javascript
// languages: source first, then targets — from product.config.json
function createChoice(table, field, value, sequence, labelsByLang) {
    var existing = new GlideRecord('sys_choice');
    existing.addQuery('name', table);
    existing.addQuery('element', field);
    existing.addQuery('value', value);
    existing.addQuery('language', Object.keys(labelsByLang)[0]);
    existing.query();
    if (existing.hasNext()) {
        gs.info('Choice already exists: ' + value);
        return;
    }

    for (var lang in labelsByLang) {
        var choice = new GlideRecord('sys_choice');
        choice.initialize();
        choice.setValue('name', table);
        choice.setValue('element', field);
        choice.setValue('value', value);
        choice.setValue('label', labelsByLang[lang]);
        choice.setValue('language', lang);
        choice.setValue('sequence', sequence);
        choice.setValue('inactive', false);
        choice.sys_scope = SCOPE_ID;
        choice.insert();
    }
}

// Example
createChoice('x_acme_fm_case', 'u_review_status', 'approved', 20,
    { en: 'Approved', '<target_lang>': '<translated label>' });
```

## Important Notes

- **Archive tables:** adding fields to extended tables may generate archive-table
  entries — this is normal platform behavior.
- **Update sets:** records created via background scripts are NOT automatically added to
  update sets — force-add and verify capture (see the update-set-workflow skill and the
  wiki's hard-rules page).
- **Three-script pattern** for a complete field setup: 1) create fields
  (`sys_dictionary`), 2) create label translations (`sys_documentation`), 3) create
  choices (`sys_choice`).
- **Choice sets** (`sys_choice_set`) must be created in the UI while in the target app
  scope — a background-script limitation (verify on your instance first).

See `references/` for complete example scripts.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
