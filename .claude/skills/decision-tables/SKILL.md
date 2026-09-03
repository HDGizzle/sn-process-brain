---
name: decision-tables
description: Invoke when the user mentions "decision table", "sys_decision", "DecisionTableAPI", "getDecision", "decision builder", "routing table", "lookup table", "answer table", "configurable mapping", or when building any ServiceNow Decision Table.
---

# Decision Tables for ServiceNow

Decision Tables are an admin-editable lookup mechanism: define typed inputs, write rule rows with conditions, return answer values. The platform evaluates them via `sn_dt.DecisionTableAPI.getDecision(sys_id, inputs)` and returns the first matching row by `order` ascending.

**When to reach for one:** routing decisions (assignment-group lookup, queue selection), configuration switches that admins should own, any mapping that could be expressed as "given input X, return Y" with discrete-value conditions.

**When NOT:**
- Ranged numeric scoring → Script Include
- Per-record dynamic data → Business Rule
- Loops, state, or complex branching → flow / SI
- Hierarchy traversal natively → pre-compute the key in script, decision table only does the lookup

## Critical rules

- **NEVER bulk-populate rule rows or answer rows via raw `GlideRecord` `.insert()` for content meant to ship.** Real builds that did this have produced dozens of `sys_decision_question` and `sys_decision_multi_result` rows that existed in the DB but landed in ZERO update sets — the export was a near-empty shell, discovered only by inspecting the XML. Publishing did NOT rescue them (publish only journals what it changes at publish time; pre-existing unchanged rows stay orphaned). The recovery was a human running the native list action **"Force to Update Set"** on each orphan, not a script. Always use `sn_dt.DecisionTableAPI().createQuestions(decisionID, questions)` for scripted bulk creation (see below) OR build via Decision Builder UI with the right update set active. The raw GR pattern is documented under "Last-resort scripted creation" only, and any record created that way **must be verified** as captured via the `update-set-workflow` skill's verification protocol — and if missing, manually forced via the list action.
- **`createQuestions` prerequisites** (verify on your instance first): (a) `decision_table_crud_api` role on the run-as user, (b) **`enable_publishing=false` on the decision table BEFORE the call** — `createQuestions` errors when draft authoring is on; "just be on a draft" is NOT a reliable workaround in the field. Disable publishing, populate, then re-enable if needed.
- **NEVER `setWorkflow(false)` on records meant to ship in an update set.** It suppresses the tracking mechanism update-set capture relies on. Reserve it for targeted repairs (the UI-lockout fix below, a defensive `active=true` flip after import) where capture is NOT the goal. See the wiki's hard-rules page.
- **`sys_decision.access` defaults to `public`** (callable from any scope). Always set it explicitly in create payloads. `package_private` confines the decision to its own scope and trips `DecisionAccessException` cross-scope.
- **`sys_decision.active=true`** is required for `getDecision()`. Inactive throws `com.glide.decision_table.exceptions.DecisionException: Can not evaluate inactive decision table`. Defensive scripts that call decisions should flip `active=true` at startup so manual deactivation during debugging doesn't break runtime.
- **Decision tables exported with `<active>false</active>` arrive at the target environment inactive.** After import to any environment, flip `active=true` (UI, or a `setWorkflow(false)` script — a legitimate setWorkflow exception because the record itself already shipped).
- **`decision_table_crud_api` role** is required on any runtime context calling `DecisionTableAPI`. `admin` alone does NOT bypass.
- **A scoped caller needs THREE `sys_scope_privilege` rows** for the full read path — each only surfaces after the previous is granted (verify on your instance first):
  1. `target_name=ScriptableDecisionTableAPI.getDecision` `target_type=scriptable` `operation=execute` `target_scope=global` — to call `getDecision()` at all
  2. `target_name=sys_decision_multi_result` `target_type=sys_db_object` `operation=read` `target_scope=global` — to GlideRecord-load the matched answer row (required by the READ pattern below, because `getDecision()`'s response wrapper doesn't surface variable values)
  3. `target_name=sys_variable_value` `target_type=sys_db_object` `operation=read` `target_scope=global` — for `result_elements.<var>` to surface (often already present from prior app needs — verify, don't assume)
- **READ pattern: do NOT trust `resp.result_elements.<var>`.** `getDecision()` returns the matched multi_result row, but its `result_elements` proxy does NOT reliably expose variable values via property access — `'' + resp.result_elements.u_my_output` returns `""` even when `sys_variable_value` has the binding. The naive truthy check `if (resp.result_elements[OUTPUT_VAR])` silently falls through as if no row matched. **Use the response only to identify the matched row's sys_id, then GlideRecord-load that row and read `result_elements` directly** (verify on your instance first):
  ```javascript
  var resp = new sn_dt.DecisionTableAPI().getDecision(DECISION_TABLE_SYS_ID, inputs);
  if (!resp || resp.sys_id == null) return '';
  var matchedSysId = '' + resp.sys_id;
  var gr = new GlideRecord('sys_decision_multi_result');
  if (!gr.get(matchedSysId)) return '';
  return '' + gr.result_elements[OUTPUT_VAR];   // ← the actual bound value (e.g. sys_user_group sys_id)
  ```
  The "diagnostic" GlideRecord pattern shown at the bottom of this skill is in fact the only reliable READ path. Treat it as production code.
- **Source-language `name` + `description` on `sys_decision`** are mandatory (source language per `product.config.json` `language.source`). Decision Builder displays these; ops needs to read the routing without reading code. Row labels stay in the source language — they are admin/ops metadata, not end-user-visible.
- **One decision table per logical decision.** Don't combine routing AND classification AND scoring — `order` becomes impossible to reason about.
- **Calling from scoped code:** `new sn_dt.DecisionTableAPI()`. The `sn_dt` namespace is global; no scope prefix is needed for the API class itself. NB: the `sn_dt` scope record is named "Dynamic Translation" — misleading; the namespace usage for DecisionTableAPI is distinct. (The full-`api_name` convention from the `script-include-patterns` skill still applies to your own scoped Script Includes.)

## Data model — the records that make up a decision table

A Workflow Studio decision table is NOT one record. It is a parent plus several heterogeneous children. **The link field back to the parent differs per child** — this inconsistency is a documented source of wasted time and wrong queries. Memorise the table → link-field map below.

```
sys_decision  (header — extends sys_metadata)
  │
  ├── sys_decision_input             (1..N — INPUT column DEFINITIONS; extends var_dictionary)
  │     link field: model            ← reference → sys_decision  (NOT decision_table)
  │     name  = var__m_sys_decision_input_<DECISION_SYS_ID>   ← shadow table name (auto)
  │     element = u_my_input         ← variable column name (the inputs object key)
  │     internal_type, reference, default_value, label … (inherited var_dictionary fields)
  │
  ├── sys_decision_multi_result_element  (1..N — OUTPUT column DEFINITIONS; extends var_dictionary)
  │     link field: model            ← reference → sys_decision  (NOT decision_table)
  │     name  = var__m_sys_decision_multi_result_element_<DECISION_SYS_ID>
  │     element = u_my_output        ← variable column name (the result_elements key)
  │     reference = sys_user_group   (typical for routing — answer is a reference)
  │
  ├── sys_decision_multi_result      (0..N — PER-ROW result VALUES; values stored as variables)
  │     link field: decision_table   ← reference → sys_decision
  │     label          = "answer X"
  │     result_elements (glide_var → sys_decision_multi_result_element)
  │     // values accessed via gr.result_elements.<output_var_name>
  │
  ├── sys_decision_question          (0..N — RULE ROWS; conditions + pointer to multi_result)
  │     link field: decision_table   ← reference → sys_decision
  │     label           = "Decision_100"
  │     order           = 100             ← first match wins ASCENDING
  │     condition       = encoded query against the inputs (e.g. u_my_inputLIKEsomething^EQ)
  │     answer          = document_id → sys_decision_multi_result   ← THE RESULT LIVES OFF-ROW
  │     input_table     = var__m_sys_decision_input_<DECISION_SYS_ID>
  │     active          = true
  │     default_answer  = false           ← true on exactly one row = catch-all
  │
  ├── sn_decision_table_decision_condition  (Condition record — operator/type binding for a column)
  │
  └── var__m_sys_decision_input_<decisionId>  (virtual M2M dictionary records backing the input
        mapping — auto-generated, can show up in update set exports)
```

**Optional:** `sys_decision_delta` (extends `sys_decision`) holds the draft/working-copy record used by draft authoring when `enable_publishing=true`. See the "UI lockout" pitfall below — a stray delta is the usual cause of authoring controls greying out.

### ⚠️ `sys_decision_answer` DOES NOT EXIST

There is no standalone answer table. The "answer" on a question row is the `answer` field on `sys_decision_question` — a `document_id` polymorphic pointer into `sys_decision_multi_result`. Querying `sys_decision_answer` throws `invalid table name`. Earlier docs and LLM training data that reference it are wrong. The pointer chain is:

```
sys_decision_question.answer (document_id)  →  sys_decision_multi_result (the per-row value record)
                                                         │
                                                         └── result_elements (glide_var)
                                                                  │
                                                                  └── value, e.g. sys_user_group sys_id
```

### Column DEFINITION vs per-row VALUE — easy to confuse

| Records the COLUMN exists | Records the VALUE per rule row |
|---|---|
| `sys_decision_input` (input column def) | (inputs are evaluated, not stored — passed via `getDecision(id, inputs)`) |
| `sys_decision_multi_result_element` (output column def) | `sys_decision_multi_result` (per-row result values, glide_var bucket) |

`sys_decision_multi_result_element` and `sys_decision_multi_result` are **different tables**. The first defines what columns the result has. The second holds the actual answer values that question rows point at.

### Count expectations

For an N-rule decision table with one default catch-all that has no answer:
- `sys_decision_question` count: **N** (rule rows + the default)
- `sys_decision_multi_result` count: **N − 1** (the default legitimately has no answer)

Any other mismatch is a defect — find the rule pointing at nothing (a question whose `answer` document_id resolves to nothing).

### var_dictionary inheritance — critical context

`sys_decision_input` and `sys_decision_multi_result_element` both **extend `var_dictionary`** (same parent that catalog-item variables use). They inherit:

| Inherited field | Purpose |
|---|---|
| `name` | Shadow table name (`var__m_*` per decision sys_id) — auto-set, do not edit |
| `element` | **The variable column name** (e.g. `u_org_path`). This is the key in the inputs object passed to `getDecision()` and the property on `result_elements` |
| `internal_type` | string / reference / choice / boolean / date / integer |
| `reference` | If `internal_type=reference`, the target table |
| `label` | UI display label for the column |
| `default_value` | Default value (constant or `javascript:...`) |
| `mandatory` | UI gate on the input/output |
| `max_length` | For string types |
| `order` | Display order in Decision Builder |
| `reference_qualifier` | Filter on the reference target (e.g. limit sys_user_group choices) |
| `choice` | Choice-table field selector |

When the platform builds a decision table via Decision Builder, it auto-generates:
1. A var_dictionary entry on `sys_decision_input` or `sys_decision_multi_result_element`
2. A dictionary entry on the shadow `var__m_*` table with the variable column

You can write to the variable VALUES on `sys_decision_multi_result` via `gr.result_elements.<element_name>` server-side. The Table REST API silently drops these writes.

## `sys_decision` field reference (native fields)

| Field | Type | Default | Mandatory | Notes |
|---|---|---|---|---|
| `name` | string | | ✅ | Source language; ops-facing |
| `label` | string | | | Display label (rarely set separately from `name`) |
| `description` | string | | | Source language, what the decision does |
| `active` | boolean | `true` | | Required true for `getDecision()` |
| `access` | string | `public` | ✅ | `public` (all scopes) / `package_private` (own scope only) |
| `answer_table` | table_name | | ✅ | Where answer references resolve (e.g. `sys_user_group`) |
| `answer_type` | string | `reference` | | Typically `reference`. Other supported types exist on modern platforms but `reference` covers 95% of cases |
| `reference_qualifier` | conditions | | | Optional encoded query filter on `answer_table` records (e.g. only active groups) |
| `enable_publishing` | boolean | `false` | | Versioning feature; leave default unless you need a promote-with-publish workflow |
| `status` | choice | | | Used by publishing workflow when `enable_publishing=true` |
| `delta` | reference → sys_decision_delta | | | Versioning pointer |
| `sys_overrides` | reference → sys_decision | | | Cross-app override pointer (rare) |
| (plus `sys_metadata` inherited: `sys_id`, `sys_created_on`, `sys_created_by`, `sys_updated_on`, `sys_updated_by`, `sys_mod_count`, `sys_class_name`, `sys_scope`, `sys_package`, `sys_update_name`, `sys_policy`, `sys_replace_on_upgrade`, `sys_name`) | | | | |

## `sys_decision_input` field reference

Only 3 own fields — everything else inherited from `var_dictionary`. Set via Decision Builder UI (recommended) or programmatically with `create_artifact` on `sys_decision_input` populating:

| Field | Type | Notes |
|---|---|---|
| `model` | reference → sys_decision | Parent decision table |
| `parent` | reference → sys_decision_input | For nested var sets (rare) |
| `name` (inherited) | string | Auto-set to `var__m_sys_decision_input_<DECISION_SYS_ID>` |
| `element` (inherited) | string | **The variable column name** — what callers pass as keys in the `inputs` object |
| `internal_type` (inherited) | reference → sys_glide_object | `string`, `reference`, `choice`, `boolean`, `date`, `glide_date_time`, `integer` |
| `reference` (inherited) | reference → sys_db_object | When `internal_type=reference` |
| `label` (inherited) | string | UI display |
| `default_value` (inherited) | string | Constant or `javascript:gs.getUserID()` etc. |

## `sys_decision_multi_result_element` field reference

Same as `sys_decision_input` — 3 native fields + `var_dictionary` inheritance. The variable element name defined here is what you access via `gr.result_elements.<element>` server-side AND what comes back as `resp.result_elements.<element>` from `getDecision()`.

`name` (inherited) auto-sets to `var__m_sys_decision_multi_result_element_<DECISION_SYS_ID>`. The shadow dictionary has one column per output element.

## `sys_decision_question` field reference (rule row)

| Field | Type | Default | Mandatory | Notes |
|---|---|---|---|---|
| `decision_table` | reference → sys_decision | | implicit | Parent decision |
| `label` | string | | ✅ | **Idempotency key — `name` is NOT queryable on this table** |
| `order` | integer | `0` | | First-match-wins ASCENDING |
| `condition` | conditions | | | Encoded query against input variables — empty = always-match (combine with `default_answer=true`) |
| `answer` | document_id | | | Points to a `sys_decision_multi_result` record |
| `default_answer` | boolean | `false` | | Exactly one row should have `true` for catch-all |
| `active` | boolean | `true` | | Inactive rows are skipped |
| `input_table` | string | | | **Must be set** to `var__m_sys_decision_input_<DECISION_SYS_ID>` for the platform to resolve variables in the condition |
| `marked_for_deletion` | boolean | `false` | | Soft delete — used by Decision Builder undo |
| `sys_overrides` | reference → sys_decision_question | | | Override pointer |
| (plus `sys_metadata` inherited fields) | | | | |

## `sys_decision_multi_result` field reference (answer row)

| Field | Type | Default | Mandatory | Notes |
|---|---|---|---|---|
| `decision_table` | reference → sys_decision | | implicit | Parent decision |
| `label` | string | | ✅ | Human-readable answer label (e.g. "Route to Group A") |
| `result_elements` | glide_var → sys_decision_multi_result_element | | | **The value bucket.** Server-side: `gr.result_elements.<element_name> = value`. Attribute: `model_field=decision_table,serializer=VariableValueXMLSerializer` |
| `sys_overrides` | reference → sys_decision_multi_result | | | |
| (plus `sys_metadata` inherited fields) | | | | |

NB: One `sys_decision_multi_result` row CAN be referenced by multiple `sys_decision_question.answer` if the answer is identical — useful for de-duping. There is no FK from multi_result back to question.

## Building a decision table — the three paths (in preference order)

### A. Decision Builder UI (default — best for small/medium tables)
Filter navigator → **Decision Tables** → **All** → New. Define inputs/outputs in the design area. Add rule rows. Save. The platform builds `var_dictionary` entries + shadow tables under the hood.

**Before clicking New / Save:** confirm the active update set is the intended one. Decision Builder writes via the standard ORM path, so capture works correctly when the session is in the right scope + update set. After the build, verify capture (see the `update-set-workflow` skill).

For a table of 30–50 routing rules, the UI is faster than scripting once you have a row template. Use it.

### B. Scaffold via UI, populate rows via `createQuestions` (when scripted bulk-load is required)
1. Create the header + inputs + outputs in Decision Builder so the shadow tables exist and `var_dictionary` is settled.
2. **Disable draft authoring on the decision table** (`enable_publishing = false`). `createQuestions` errors when draft authoring is on.
3. Call `sn_dt.DecisionTableAPI().createQuestions(decisionID, questions)` from a Fix Script (see template below).
4. Re-enable `enable_publishing` if your workflow requires it.
5. **Verify capture** of every rule + answer row via the `update-set-workflow` skill before declaring done.

### C. All via `create_artifact` (header + columns only — tedious for rows)

```javascript
// Example payloads — substitute your own scope sys_id and names.
// 1. Create the decision table header
{
    "command": "create_artifact",
    "params": {
        "table": "sys_decision",
        "scope": "<scope sys_id>",
        "fields": {
            "name": "My Routing Decision",
            "description": "Maps X to Y",
            "active": "true",
            "access": "public",
            "answer_table": "sys_user_group",
            "answer_type": "reference"
        }
    }
}

// 2. Create an input (column definition)
{
    "table": "sys_decision_input",
    "fields": {
        "name": "var__m_sys_decision_input_<DECISION_SYS_ID>",  // shadow table name pattern
        "element": "u_my_input",
        "label": "My input",
        "internal_type": "string",
        "model": "<DECISION_SYS_ID>"
    }
}

// 3. Create an output column (multi_result_element)
{
    "table": "sys_decision_multi_result_element",
    "fields": {
        "name": "var__m_sys_decision_multi_result_element_<DECISION_SYS_ID>",
        "element": "u_my_output",
        "label": "My output",
        "internal_type": "reference",
        "reference": "sys_user_group",
        "model": "<DECISION_SYS_ID>"
    }
}
```

After steps 2–3 the platform builds the shadow table dictionary entries asynchronously. Verify before populating rows.

### Populating rows — canonical scripted API (`createQuestions`)

```javascript
// Prerequisites:
//   1. Run-as user has `decision_table_crud_api` role.
//   2. Decision table has `enable_publishing = false` BEFORE the call.
//   3. Active update set is the intended target. Verify capture after run.

var DEC = '<sys_decision sys_id>';

// 1. Defensive: disable draft authoring for the duration of the bulk load.
//    Re-enable AFTER if your workflow uses draft publishing. Leaving it false is
//    fine for most simple tables.
var grDec = new GlideRecord('sys_decision');
if (grDec.get(DEC)) {
    if (grDec.getValue('enable_publishing') === 'true') {
        grDec.setValue('enable_publishing', false);
        grDec.update();   // tracks normally — DO NOT setWorkflow(false) here, capture must apply
    }
    if (grDec.getValue('active') !== 'true') {
        grDec.setValue('active', true);
        grDec.update();
    }
}

// 2. Build the questions array. Shape per ServiceNow docs — each entry binds
//    a condition (encoded query against the input shadow table) to an answer.
//    See ServiceNow product docs for the exact JSON contract of the questions
//    array (operators, structure of answer objects). Test with one row first
//    on dev, then scale.
var questions = [
    {
        // Example shape — confirm against current docs before relying on field names:
        label: 'Route Field Ops West_100',
        order: 100,
        active: true,
        default_answer: false,
        condition: 'u_org_pathLIKE/Field Ops West/^EQ',
        answer: { u_route_group: '<sys_user_group sys_id>' }
    }
    // … more rows …
];

// 3. Call the documented API
var dt = new sn_dt.DecisionTableAPI();
var result = dt.createQuestions(DEC, questions);
gs.info('createQuestions result: ' + JSON.stringify(result));

// 4. Verify capture — query sys_update_xml for the created rows (see update-set-workflow skill).
//    UI presence and DB presence are NOT proof of capture. Only sys_update_xml is.
```

**If `createQuestions` errors or behaves inconsistently**, double-check `enable_publishing=false` first. That is the most common cause seen in real builds — "just be on a draft" did NOT work; disabling publishing did (verify on your instance first).

### Last-resort scripted creation — raw GlideRecord (FORBIDDEN for ship content)

Listed here for diagnostic / test-only usage. **If you use this pattern for content meant to land in an update set, you MUST verify capture afterward and force-add orphans manually.** Reason: real builds using this pattern have produced dozens of orphan rows across the two child tables.

```javascript
// DIAGNOSTIC / TEST-ONLY pattern. NOT for ship content.
// If used, run the update-set-workflow capture verification afterward.

var grMr = new GlideRecord('sys_decision_multi_result');
grMr.initialize();
grMr.setValue('label', 'Answer: route to Group A');
grMr.setValue('decision_table', DEC);
grMr.result_elements[OUTPUT_VAR] = '<sys_user_group sys_id>';  // server-side only;
                                                                // Table REST silently drops this
var mrSysId = grMr.insert();

var grQ = new GlideRecord('sys_decision_question');
grQ.initialize();
grQ.setValue('label', 'My Decision_100');
grQ.setValue('decision_table', DEC);
grQ.setValue('order', 100);
grQ.setValue('active', true);
grQ.setValue('default_answer', false);
grQ.setValue('condition', INPUT_VAR + 'LIKEsegment-value^EQ');
grQ.setValue('answer', mrSysId);
grQ.setValue('input_table', 'var__m_sys_decision_input_' + DEC);
grQ.insert();
```

**Do NOT call `setWorkflow(false)` here.** That guarantees the rows skip capture. Even without `setWorkflow(false)`, raw GR can miss capture if the session lost its update-set context — always verify.

## Server-side API — `sn_dt.DecisionTableAPI`

```javascript
var dt = new sn_dt.DecisionTableAPI();

// Single — first matching row by `order` ASC
var inputs = {};
inputs['u_my_input'] = '<value to match>';
var resp = dt.getDecision(DECISION_TABLE_SYS_ID, inputs);

if (resp && resp.result_elements && resp.result_elements['u_my_output']) {
    var answerSysId = '' + resp.result_elements['u_my_output'];
}

// All matching rows (rare — usually you want first-match)
var responses = dt.getDecisions(DECISION_TABLE_SYS_ID, inputs);
```

- Inputs object keys = the `element` field on each `sys_decision_input` row.
- Output access: `resp.result_elements.<element>` — coerce to string for FK use. **But see pitfall #1b — this property access is unreliable; use the GlideRecord READ pattern for production code.**
- **Required role:** `decision_table_crud_api` on the runtime user. Other relevant roles: `decision_table_admin` (full CRUD), `decision_rule_author` (rule rows), `decision_result_editor` (answer rows).
- Calling from any scope works as long as `sys_decision.access = "public"`.
- Throws `DecisionException` if the table is inactive.
- Throws `DecisionAccessException` if cross-scope access is denied (table is `package_private`).

## Condition encoded query operators (against input variables)

The `condition` field is an encoded query against the variable shadow table. Same operators as any encoded query. The `^EQ` terminator marker is required.

| Operator | Syntax | Use |
|---|---|---|
| Equals | `<var>=<value>^EQ` | Exact match on choice/string/reference |
| Not equals | `<var>!=<value>^EQ` | |
| Contains | `<var>LIKE<value>^EQ` | Substring (case-insensitive) — `LIKE` is the literal operator, NOT SQL wildcards |
| Starts with | `<var>STARTSWITH<value>^EQ` | |
| Ends with | `<var>ENDSWITH<value>^EQ` | |
| Greater / less | `<var>><value>^EQ`, `<var><<value>^EQ` | Numeric / date |
| Greater/equal, less/equal | `<var>>=<value>^EQ`, `<var><=<value>^EQ` | |
| In list | `<var>IN<v1>,<v2>^EQ` | Comma list |
| Not in list | `<var>NOTIN<v1>,<v2>^EQ` | |
| Empty / not empty | `<var>ISEMPTY^EQ`, `<var>ISNOTEMPTY^EQ` | |
| AND | `^` | Separator (also wraps to `^EQ`) |
| OR | `^OR` | OR within same field group |
| New query (OR group) | `^NQ` | New AND-group |

**Note:** the `LIKE` operator does NOT use SQL `%` wildcards. `LIKE foo` matches any string containing `foo`. Adding `%` to the value literal-matches the percent sign.

## Specificity & ordering (first-match-wins)

When `LIKE` / `STARTSWITH` patterns overlap, `order` controls priority. Lowest `order` evaluated first.

**Substring overlap rule:** if pattern B's value is a substring of any input that pattern A also matches, put **A before B**.

Worked example (slash-delimited paths):
- Row A: `LIKE /Field Ops West/` order=100
- Row B: `LIKE /Field Ops/` order=200
- Input `/.../Field Ops West/...` matches both. A's lower order wins. Correct.
- Input `/.../Field Ops East/...` matches only B. Correct.

**Catch-all:** add a row with `default_answer=true`, no condition, highest order. The platform applies this when nothing else matches. Leave `answer` empty if the desired behaviour is "no answer".

## Cross-scope considerations

- **Decision table accessibility:** `sys_decision.access = "public"` allows callers in other scopes. `package_private` confines.
- **Calling scope needs `decision_table_crud_api`** role on the runtime user.
- **Scoped callers need three `sys_scope_privilege` rows** (see "Critical rules" above for the full list with field values):
  1. `ScriptableDecisionTableAPI.getDecision` `scriptable` `execute` → call the API
  2. `sys_decision_multi_result` `sys_db_object` `read` → load the matched answer row via GlideRecord (mandatory because of pitfall #1b)
  3. `sys_variable_value` `sys_db_object` `read` → `result_elements.<var>` reads under the hood
- **Reading answer-table records:** if the answer is an FK to a table in another scope, the returned sys_id from `getDecision()` is just a string — no read is performed on the answer table during evaluation. But if your script THEN dot-walks or queries the resolved record, cross-scope read privilege applies. See the `script-include-patterns` skill for `sys_scope_privilege` row creation.
- **`sys_decision_multi_result.sys_scope` is misleading** — it may show your app's scope (because Decision Builder writes records in your context), but **the table itself is global**. Reads from a scoped app still require the cross-scope grant above. The record's `sys_scope` is metadata for update-set tracking, NOT an effective same-scope marker for reads.

## ⚠️ Pitfalls — every one of these cost time in real builds

### 1. **Table REST API silently drops writes to variable fields**
You CANNOT set the answer value via a create payload `{"u_my_output": "sys_id"}` on `sys_decision_multi_result`. The field looks valid (it's defined in the shadow table dictionary) but the write is silently dropped — the record is created with no answer value.

**Fix:** server-side script using `gr.result_elements.<element> = value`. Decision Builder UI does this under the hood; you must do the same in scripts.

### 1b. **`getDecision()`'s response does NOT surface `result_elements` values for READ either** ⚠️ (companion to pitfall #1)
Symmetric to the write-side issue, the READ side has its own gotcha: `getDecision()` returns the matched multi_result wrapped, BUT `resp.result_elements.<element>` evaluates as empty string even when `sys_variable_value` has the binding. The naive truthy check `if (resp.result_elements[OUTPUT_VAR])` silently falls through — the caller thinks "no match" while a row in fact matched. This has cost hours in real builds (verify on your instance first).

**Fix:** use `resp.sys_id` to identify the matched answer row, then `new GlideRecord('sys_decision_multi_result').get(sys_id).result_elements[OUTPUT_VAR]` to read the actual value. See "Critical rules" at the top of this skill for the full read pattern.

**Diagnostic signs:**
- Log shows `JSON.stringify(resp.result_elements)` as `{...,"u_my_output":{},...}` (all GlideElement wrappers; `{}` is the wrapper, not the empty value)
- Log shows `''+ resp.sys_id` is the matched answer row's sys_id
- Log shows `''+ resp.result_elements.<var>` is `""`
- Verifying the answer row in the UI shows the bound group/value IS present

### 2. **`gr.variables` vs `gr.result_elements` — the proxy name is the FIELD name**
The glide_var proxy on a record is named after the field on its parent table:
- `sc_req_item.variables` (field name `variables`) → `gr.variables.X`
- `sys_decision_multi_result.result_elements` (field name `result_elements`) → `gr.result_elements.X`

Using `gr.variables.X` on a multi_result errors as `TypeError: Cannot set property "X" of undefined`. **Always check the table's dictionary for the field of type `glide_var` and use that name.**

### 3. **`sys_decision_question.name` is NOT queryable**
Despite the parent table having a `name` field via sys_metadata inheritance, `addQuery('name', X)` on `sys_decision_question` silently no-ops AND returns ALL rows for the rest of the query (so idempotency checks return "exists" even when nothing matches). Error in syslog: `Invalid query detected, please check logs for details [Unknown field name in table sys_decision_question]`.

**Fix:** use `label` for queryable identity. Same display purpose.

### 4. **Deactivating the table breaks everything calling it**
`getDecision()` throws `com.glide.decision_table.exceptions.DecisionException: Can not evaluate inactive decision table` — and the exception aborts whatever script called it (no graceful fallback).

**Fix:** scripts that depend on the table should defensively flip `active=true` at startup. Wrap UAT-style `getDecision()` calls in try/catch.

### 5. **`access`, not `accessible_from`**
Various legacy docs (and LLM training data) refer to the field as `accessible_from`. The actual column on `sys_decision` is **`access`**. Default `public`. Writing `accessible_from` in the payload does nothing — the field doesn't exist on this table.

### 6. **`sys_decision_question.input_table` MUST be set on insert**
If empty, the platform can't resolve which shadow table to evaluate the `condition` against → condition always evaluates false → row never matches. Value pattern: `var__m_sys_decision_input_<DECISION_SYS_ID>`.

### 7. **Order tiebreakers are platform-defined, not stable**
If two questions share the same `order`, the resolution is implementation-defined (usually first-created wins, but don't rely on it). Always give distinct orders.

### 8. **Specificity ordering for `LIKE` is fragile**
See "Specificity & ordering" above. Document the order plan in `description` so future-you remembers why row 100 < row 200.

### 9. **Idempotency on bulk-populate scripts**
Re-running a fix script that creates dozens of rows without a label check duplicates everything. Always:
- Query `sys_decision_question` by `decision_table=<DEC>` + `label=<rowLabel>`
- Skip if exists
- For orphan-multi_result cleanup (multi_results without questions after partial failure), query `sys_decision_multi_result` filtered by `decision_table` and cross-reference question.answer

### 10. **Cross-scope DB reads on resolved answers**
`getDecision()` returns a sys_id string — no DB read on the answer table. But if your code then does `new GlideRecord('sys_user_group').get(sysId)` and you're in a scope without `sys_scope_privilege` for `sys_user_group`, the read fails with the red "cross scope access privilege denied" banner. See the `script-include-patterns` skill.

### 11. **`sn_dt.DecisionTableAPI` requires `decision_table_crud_api` role**
A user with `admin` only may still see "ScriptableDecisionTableAPI access denied". Grant the role explicitly to the runtime user or service account.

### 12. **Update-set capture is NOT automatic for scripted row creation** ⚠️
Decision table rule rows AND answer rows ARE `sys_metadata` and CAN track to update sets — but real builds using raw `GlideRecord.insert()` have produced dozens of question rows and multi_result rows that landed in ZERO update sets, discovered only by inspecting the exported XML. Confirmed contributing factors: writing while no update set was selected; writing while in the wrong session scope; any use of `setWorkflow(false)` or `setUseEngines(false)`; capture suppression by Decision Builder's draft-authoring lifecycle when `enable_publishing=true`. Publishing does NOT retroactively rescue orphan rows — publish only journals what it changes at that moment, and unchanged rows stay orphaned. The fix in the field was a **human** running the native list action **"Force to Update Set"** on each orphan, not a script.

**Rules to prevent recurrence:**
- Prefer the `createQuestions` API or Decision Builder UI over raw GR.
- `enable_publishing=false` before any scripted bulk-load.
- After any decision-table write — UI, API, or script — verify capture per the `update-set-workflow` skill (query `sys_update_xml` filtered to the active update set).
- If capture is missing, the remedy is the native "Force to Update Set" list action on the orphaned records (human-driven), then re-verify.

### 13. **UI lockout — `status='draft'` in DB while UI shows Published, all controls greyed**
Signature: `sys_decision.status='draft'` per the DB; UI shows the table as Active / Published; the Draft view toggle, Create Draft, Save, AND Publish are ALL greyed out — only Test works. Caused by scripted row manipulation colliding with the draft-authoring lifecycle, leaving a stray/inconsistent delta row that the builder can't open.

**Repair recipe** (this IS a legitimate `setWorkflow(false)` exception — see the `update-set-workflow` skill):
```javascript
var dec = new GlideRecord('sys_decision');
if (dec.get('<DECISION_SYS_ID>')) {
    gs.info('BEFORE status: ' + dec.getValue('status'));
    dec.setValue('status', 'published');   // force clean published state
    dec.setWorkflow(false);                 // stop BRs re-corrupting mid-write
    dec.update();
    var c = new GlideRecord('sys_decision');
    c.get('<DECISION_SYS_ID>');
    gs.info('AFTER status: ' + c.getValue('status'));
}
```
Then HARD REFRESH the Workflow Studio tab (Cmd/Ctrl+Shift+R). Create Draft re-enables; click it to enter a real editable draft.

If a clean **duplicate** created via the UI works fine, that confirms the original is state-corrupted (not a scope/permission/vendor lock). Confirmed in a real triage — the duplicate worked first try, the original needed the script repair (verify on your instance first).

### 14. **Agent API: `create_artifact` requires a `name` field**
Even on `sys_decision_multi_result`, where there is no `name` column on the table, the agent API's create_artifact wrapper requires a `name` field in the payload — pass the same value as `label`. Without it: `Missing required field: name`.

### 15. **PowerShell file → JSON payload mangling**
When piping large script strings through PowerShell `Get-Content -Raw` + `ConvertTo-Json` to build agent-API payloads, the content gets wrapped in a PSObject with metadata (`PSPath`, `PSDrive`, etc.) and serialized into the field. Result: corrupted scripts. **Fix:** use `[System.IO.File]::ReadAllText('path')`, which returns a plain `System.String`.

### 16. **Agent API cross-scope writes silently no-op**
Updating a record whose scope doesn't match the browser's active app scope returns `success` but doesn't persist. Switch to the target app scope via `switch_context` first, then update, then switch back. Affects `update_record` and `update_record_batch` on cross-scope `sys_script_fix`, etc. Verify writes by querying the field back.

## Navigation

- **Decision Builder UI**: `/now/decision-builder/home`
- **Records list**: `/sys_decision_list.do`
- **Questions list** (debugging): `/sys_decision_question_list.do?sysparm_query=decision_table=<sys_id>`
- **Multi_results list**: `/sys_decision_multi_result_list.do?sysparm_query=decision_table=<sys_id>`
- **Inputs list**: `/sys_decision_input_list.do?sysparm_query=model=<sys_id>`
- **Multi_result elements list**: `/sys_decision_multi_result_element_list.do?sysparm_query=model=<sys_id>`
- **Shadow tables (rare direct access)**: `/var__m_sys_decision_input_<DECISION_SYS_ID>_list.do`

## Diagnostic queries

```javascript
// List all rules on a decision table, sorted by order
var gr = new GlideRecord('sys_decision_question');
gr.addQuery('decision_table', '<DECISION_SYS_ID>');
gr.orderBy('order');
gr.query();
while (gr.next()) {
    gs.info(gr.getValue('order') + ' :: ' + gr.getValue('label') + ' :: ' + gr.getValue('condition'));
}

// Inspect an answer row's bound values (server-side only — REST won't show them).
// NB: this is ALSO the production READ pattern at runtime — see pitfall #1b.
// `getDecision()` response.result_elements.<var> returns "" even when the binding
// exists; only GlideRecord direct-read on the matched row is reliable.
var gr = new GlideRecord('sys_decision_multi_result');
if (gr.get('<MULTI_RESULT_SYS_ID>')) {
    gs.info('label: ' + gr.label);
    // iterate or access specific variable
    gs.info('value: ' + gr.result_elements.u_my_output);
}

// Test a decision evaluation manually
var resp = new sn_dt.DecisionTableAPI().getDecision('<DECISION_SYS_ID>', { u_my_input: 'test value' });
gs.info(JSON.stringify(resp));
```

## Worked example — substring routing (example only)

Goal: given a slash-delimited organizational path string (e.g. `/ACME/Operations/Field Ops West/Crew 12/`), route to one of several dozen support groups (`sys_user_group` records). Admins must add/edit routing without code changes.

**Decision table:** `ACME - Routing Group Resolver`
- Scope: `x_acme_fm` (example)
- `access`: `public`
- `active`: `true`
- `answer_table`: `sys_user_group`
- **Input** `u_org_path` (string)
- **Output** `u_route_group` (reference → sys_user_group)

**Rows** (ordered most-specific-first):

| order | condition | answer |
|---|---|---|
| 100 | `u_org_pathLIKE/Field Ops West/^EQ` | (multi_result with u_route_group = Field Ops West group sys_id) |
| 110 | `u_org_pathLIKE/Field Ops East/^EQ` | Field Ops East group |
| 200 | `u_org_pathLIKE/Plant Alpha/^EQ` | Plant Alpha group |
| 430 | `u_org_pathLIKE/Plant BR /^EQ` | Plant Bravo group (note: the org tree uses an abbreviation — match what the SOURCE data actually contains, not the display name) |
| 700 | `u_org_pathLIKEDelta Yard^EQ` | Delta Yard group (bare substring match — MUST be ordered before the broader `/Engineering/` row because Delta Yard paths also contain `/Engineering/`) |
| 900 | `u_org_pathLIKE/Engineering/^EQ` | Engineering group (broadest fallback for the division) |
| 9999 | (empty condition, `default_answer=true`) | (empty answer — caller treats no match as "leave routing empty") |

The ordering lesson: every row whose matched inputs are a subset of a broader row's matched inputs gets a LOWER order than the broader row. Row 700 vs 900 is the trap — the narrow match is on a bare substring, so nothing about the condition text signals it overlaps the `/Engineering/` row; only knowledge of the source data does. Document that reasoning in the decision's `description`.

**Calling Script Include** (in the `x_acme_fm` scope — example):

```javascript
var RoutingGroupResolver = Class.create();
RoutingGroupResolver.prototype = {
    DECISION_TABLE_SYS_ID: '<sys_id>',
    OUTPUT_VAR: 'u_route_group',
    INPUT_VAR:  'u_org_path',

    initialize: function () {},

    resolve: function (path) {
        if (!path) return '';
        var inputs = {};
        inputs[this.INPUT_VAR] = '' + path;

        var resp = new sn_dt.DecisionTableAPI().getDecision(this.DECISION_TABLE_SYS_ID, inputs);
        if (!resp || resp.sys_id == null) return '';

        // The response's result_elements proxy does NOT reliably surface variable
        // values -- always GlideRecord-load the matched answer row to read them.
        // Requires sys_decision_multi_result + sys_variable_value cross-scope reads.
        var matchedSysId = '' + resp.sys_id;
        var grMr = new GlideRecord('sys_decision_multi_result');
        if (!grMr.get(matchedSysId)) return '';
        return '' + grMr.result_elements[this.OUTPUT_VAR];
    },

    type: 'RoutingGroupResolver'
};
```

An Assignment Rule that fires this SI on state transition lives separately — see the `assignment-rules` skill.

## Related skills

- **`assignment-rules`** — the natural pairing for routing use cases
- **`script-include-patterns`** — for the calling resolver SI (cross-scope privileges, ES5, full api_name)
- **`gliderecord-patterns`** — direct DB manipulation of `sys_decision_*` tables
- **`business-rule-patterns`** — for cases needing overwrite semantics or write-without-state-transition
- **`update-set-workflow`** — packaging decision table + rows for promotion

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
