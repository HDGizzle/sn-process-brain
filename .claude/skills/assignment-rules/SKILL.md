---
name: assignment-rules
description: Invoke when the user mentions "assignment rule", "sysrule_assignment", "auto-assign", "routing rule", "route incident", "set assignment_group automatically", "auto-set assigned_to", "assignment script", "filter and script", or when building auto-routing of tasks on Task-extending tables.
---

# Assignment Rules for ServiceNow

`sysrule_assignment` is the OOTB platform mechanism for auto-populating `assignment_group` and `assigned_to` on Task-extending tables (`incident`, `change_request`, `x_acme_fm_case`, etc). Still the recommended primitive on current versions — Flow Designer / Predictive Intelligence are alternatives, not replacements.

**When to reach for one:**
- Condition-driven routing where the answer is a (small set of) group/user references
- Evaluated at insert/update on a Task-extending table
- The target field (`assignment_group` / `assigned_to`) is empty when the rule fires (see Critical Constraint below)

**When NOT:**
- Upstream channel already sets `assignment_group` → AR cannot overwrite — use a Business Rule instead
- Routing depends on values that change DURING the form session (not present at insert/update) → use Data Lookup Rules (`dl_definition`)
- Routing requires ML, scoring, or external API → Flow Designer / Predictive Intelligence

## Project Rules (mandatory)

- **`name` + `description` in the project source language** on `sysrule_assignment` is mandatory. AR records are admin/ops artifacts; end-user translation rarely applies.
- **`order < 100` means "wins early".** Choose tight `condition` for low-order rules so they don't unintentionally pre-empt others. Reserve `1000+` for catch-all/fallback rules.
- **Always pair `assignment_groupISEMPTY` in the condition** when the AR script-sets the group. Documents intent (only fill empty) AND short-circuits unnecessary script execution.
- **Call scoped Script Includes with full `api_name`**: `new x_acme_fm.MyResolver()`. No prefix → silent fail (see `script-include-patterns` skill).
- **ES5 only** in the `script` field. Rhino engine — `var`, no arrow functions, no template literals, no `const`/`let`.
- **Cross-scope reads** from the script need `sys_scope_privilege` rows for every table the script reaches (e.g. `cmn_department` when dot-walking from a person reference to their department). See `script-include-patterns` skill.

## How they fire — timing and ordering

| Event | AR runs? |
|---|---|
| Insert (any record) | ✅ Before insert |
| Update (any record) | ✅ Before update |
| Display / unsaved form-level field change | ❌ — Data Lookup Rules fire there, not AR |
| Delete | ❌ |

**Execution order relative to Business Rules (CRITICAL):**

```
1. before insert/update BRs with order < 1000
2. ⇨ Assignment Rule evaluation (first matching by AR order wins, stops further AR matching)
3. before insert/update BRs with order >= 1000
4. after insert/update BRs
5. async BRs (eventually)
```

So a BR with `order < 1000` that sets `current.assignment_group` blocks the AR (AR can't overwrite a populated value — see Critical Constraint).

**Within ARs:** matching is by `order` ASC, **first match stops AR processing**. Only ONE AR fires per record per event.

## `sysrule_assignment` field reference (native fields)

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` (inherited from sys_metadata) | string | | Ops identifier |
| `description` (inherited from sys_metadata) | string | | Explanation of intent |
| `table` | table_name | `incident` | Task-extending target. ARs fire on the target table AND on records of tables that extend it (so an AR on `task` applies to `incident`, `change_request`, `x_acme_fm_case`, etc.) |
| `active` | boolean | `true` | |
| `order` | (inherited from `sys_filter`) | | Ascending — lowest matching rule wins |
| `condition` | conditions | | Encoded query — when to fire. Supports `CHANGES`, `CHANGESFROM`, `CHANGESTO`, `ISEMPTY`, etc. |
| `match_conditions` | string | `ALL` | When BOTH a `condition` AND a `script` exist, this controls whether ALL must match (default) or ANY can match. For typical pure-condition or pure-script use cases, leave as `ALL` |
| `group` | reference → sys_user_group | | Direct assignment (when no script) |
| `user` | reference → sys_user | | Direct assignment to a person |
| `script` | string | (commented-out example) | Optional — sets `current.assignment_group` / `current.assigned_to` programmatically. **Takes precedence over `group`/`user` when present** |
| (plus `sys_metadata` inherited: `sys_id`, `sys_created_on/by`, `sys_updated_on/by`, `sys_mod_count`, `sys_class_name`, `sys_scope`, `sys_package`, `sys_update_name`, `sys_policy`) | | | |

NB: the `order` field comes from the `sys_filter` parent table, not `sys_metadata`, but the resolution is the same — set it via the form or API.

## Two authoring patterns

### A. Direct assignment (no script)
Static destination, condition fully expresses routing.

```javascript
{
    "command": "create_artifact",
    "params": {
        "table": "sysrule_assignment",
        "scope": "<scope sys_id>",
        "fields": {
            "name": "ACME - P1 incidents to Major Incident team",
            "description": "Auto-route priority 1 incidents to the Major Incident response group.",
            "table": "incident",
            "condition": "priority=1^assignment_groupISEMPTY^active=true",
            "group": "<sys_user_group sys_id>",
            "active": "true",
            "order": "100"
        }
    }
}
```

### B. Script-driven assignment
Destination depends on related-record data (department, location, classification).

```javascript
(function executeRule(current, previous /*null on insert*/) {
    // Read related data, call a resolver SI, set the field
    var groupId = new x_acme_fm.CaseRoutingResolver().resolve(current.getUniqueValue());
    if (groupId) {
        current.assignment_group = groupId;
    }
    // else: leave empty — accepted quirk; manual triage takes over
})(current, previous);
```

- `current` and `previous` are in scope. On insert, `previous` is null.
- Set `current.assignment_group = '<sys_id>'` / `current.assigned_to = '<sys_id>'` directly.
- **`return` is ignored.** This is a procedure, not a function returning a destination.
- IIFE wrapper is conventional but not required.

## Encoded query patterns in `condition`

| Pattern | Use |
|---|---|
| `state=1` | Static field value |
| `stateCHANGESTO1` | Fires when state becomes 1 (on insert if value=1; on update if previous≠1 and current=1) |
| `stateCHANGESFROM0` | Previous state was 0 (UPDATE ONLY — no fire on insert because no previous) |
| `stateCHANGESFROM0^stateCHANGESTO1` | **Belt-and-braces transition** — only the exact 0→1 path on update |
| `state=1^OR^stateCHANGESTO1` | Insert at state=1 OR transition to state=1 |
| `assignment_groupISEMPTY` | Defensive — fire only when not already routed (paired with script-driven rules) |
| `assigned_toISEMPTY^ORassignment_groupISEMPTY` | Either dimension empty |
| `category=hardware` | Filter by category |
| `priorityIN1,2` | Multiple values |
| `caller_id.departmentISNOTEMPTY` | Dot-walk in the condition (use sparingly — performance) |

### CHANGES operators — insert vs update semantics

The CHANGES family is the most error-prone area of AR conditions:

- **`<field>CHANGES`** — true iff the field's value differs from its previous value
  - On insert: true if the field has any non-default value (no previous to compare against — platform treats absence-to-anything as a "change")
  - On update: true iff `previous.<field> ≠ current.<field>`

- **`<field>CHANGESFROM<x>`** — true iff previous value was exactly `x` AND current differs
  - On insert: **FALSE** (no previous record exists)
  - On update: true iff `previous.<field> = x` AND `current.<field> ≠ x`

- **`<field>CHANGESTO<y>`** — true iff current value is exactly `y` AND previous differs
  - On insert: true iff `current.<field> = y` (absence-to-y counts as "changes to")
  - On update: true iff `current.<field> = y` AND `previous.<field> ≠ y`

**Combinations:**
- `<field>CHANGESFROM<x>^<field>CHANGESTO<y>` → **update-only**, exact x→y transition
- `<field>=<y>^OR<field>CHANGESTO<y>` → insert-at-y OR transition-to-y (covers both flows)
- `<field>CHANGES^<field>=<y>` → any change that lands at y

If you want the AR to fire BOTH on direct insert at state=y AND on transition to state=y, drop CHANGESFROM. If you want ONLY the transition, keep both CHANGES operators.

## Critical Constraint — AR CANNOT overwrite a populated value

**The #1 source of "my AR doesn't fire" bugs.**

- The AR engine sets `current.assignment_group` and `current.assigned_to` ONLY IF those fields are empty when the AR runs.
- If a BR `order < 1000` filled them, AR no-ops silently — no error.
- If an upstream channel (REST insert with field set, integration adapter, import set transform map onAfter, etc.) populated the field, AR no-ops.
- **Data Lookup Rules (`dl_definition` / `dl_matcher`) CAN overwrite** — different mechanism, different table. Use those if overwrite is needed but you want declarative routing.

**Diagnostic flow when AR doesn't appear to fire:**
1. Check `assignment_group` was empty when the AR should have run.
   - Open record audit history; if the field was set by another process, find that process.
2. Check `condition` matches the record state.
   - On the AR list view, right-click → **Show matching → Conditions** for a sanity check.
   - Programmatically: `GlideFilter.checkRecord(rec, '<encoded query>')`.
3. Check `order` — an earlier-ordered AR may have matched and stopped processing.
4. Check `active=true` and `table` matches.
   - Don't forget Task-extending tables: an AR on `task` applies to all subclasses; on `incident` only to incidents.
5. Check the script SETS `current.<field>` (not `return`s a value — returns are ignored).
6. Check role/scope — script calling scoped SIs needs full `api_name`; cross-scope reads need `sys_scope_privilege` rows.

**Workaround when you NEED to overwrite at insert/update:** drop the AR, use a `before insert/update` Business Rule with `order >= 1000` that explicitly writes the field. Lose OOTB AR plumbing, gain control. See `business-rule-patterns` skill.

## Worked example — script-driven AR + decision-table resolver

Example: route a facilities case to a specialist group based on the caller's department, on the first real state transition. Pairs with the `decision-tables` skill.

```
Table:        x_acme_fm_case
Name:         ACME - Facilities case routing
Description:  Sets assignment_group on facilities cases when state transitions
              Draft (0) → New (1), by matching the caller's department against
              the Case Routing decision table. No match → assignment_group
              stays empty and manual triage takes over.
Active:       true
Order:        100
Match cond:   ALL (default)
Condition:    stateCHANGESFROM0^stateCHANGESTO1^assignment_groupISEMPTY^category=facilities
Group:        (empty — script-driven)
User:         (empty)
Script:       see below
```

```javascript
(function executeRule(current, previous /*null on insert*/) {
    var groupId = new x_acme_fm.CaseRoutingResolver().resolve(current.getUniqueValue());
    if (groupId) {
        current.assignment_group = groupId;
    }
})(current, previous);
```

**Why this exact condition:**
- `stateCHANGESFROM0^stateCHANGESTO1` → only fires on the actual transition, not on inserts arriving directly at state=1 (those skip the draft stage)
- `assignment_groupISEMPTY` → defensive; documents intent (won't overwrite anyway, but explicit)
- `category=facilities` → defense-in-depth; explicit scope rather than relying on the transition alone

**Why script-driven (instead of the `group` field):**
- The destination depends on related-record data (the caller's department chain) resolved at runtime via a Decision Table
- The Script Include is independently testable (`new x_acme_fm.CaseRoutingResolver().resolve(caseSysId)` in a background script)
- The Decision Table is independently editable by admins

## ⚠️ Pitfalls

### 1. **AR cannot overwrite — silent no-op (see Critical Constraint)**
Most common failure mode. Audit upstream BRs and channels before reaching for AR.

### 2. **`CHANGESFROM` on insert evaluates FALSE**
`stateCHANGESFROM0` is false on insert because there's no prior record. If you want the rule to fire on first-time-state=1 records too (e.g. from an integration that inserts directly at state=1), drop `CHANGESFROM` and use `state=1` or `stateCHANGESTO1`.

### 3. **Order tiebreakers are NOT stable**
Two ARs sharing the same `order` resolve in implementation-defined order. Always give matching rules on the same table distinct orders.

### 4. **One AR per record per event — first match stops processing**
Unlike BRs (all matching ones run), only the lowest-order matching AR fires. Two ARs that could match the same record cannot layer — the loser silently does nothing.

### 5. **Task-table hierarchy**
ARs on `task` apply to all subclasses (`incident`, `change_request`, `problem`, `sc_req_item`, `x_acme_fm_case`…). If both a `task`-level and a child-table-level AR could match a given record, **order** decides — not table specificity.

### 6. **Script `return` is IGNORED**
The `script` field runs as a procedure. Returning a value (sys_id, true/false) does nothing useful. **Set `current.<field>` directly.**

### 7. **`active` and `condition` both gate**
Both must pass for the AR to be considered. An active AR with a never-matching `condition` is silently inert — a common state when conditions reference fields that get renamed during refactoring.

### 8. **Background-script testing can't fully simulate the BR→AR→BR chain**
`gs.executeNow()` and similar don't perfectly replay the platform's insert/update orchestration. Verify by actually inserting/updating a record (or via ATF).

### 9. **Cross-scope AR**
An AR record can live in scope A while targeting a table in scope B. Cross-scope DB reads from the SCRIPT (e.g. dot-walking from a scoped case record to a global `cmn_department`) still need `sys_scope_privilege` rows for every reached table. Red banner: *"Read operation on table 'X' from scope 'Y' was denied"*. Each dot-walk hop is a separate check. See `script-include-patterns` skill.

### 10. **Update set tracking**
`sysrule_assignment` is `sys_metadata` — it tracks to update sets. The active update set must be set BEFORE creating/editing. AR changes look small but ship cleanly. Don't forget translations for `name` if it is ever surfaced to end users (rarely is).

### 11. **`match_conditions` matters only when BOTH condition AND script are present**
Default `ALL` means both the encoded query AND the script's evaluation context must be satisfied. `ANY` lets either trigger. Most rules use ONE or the OTHER — leave at default unless you're doing a hybrid rule.

### 12. **Calling a scoped SI from an AR script in another scope**
`new x_acme_fm.MyResolver()` works ONLY if you use the full `api_name`. Without the `x_acme_fm.` prefix the call returns undefined and your AR script silently no-ops. **Always full-qualify cross-scope SI calls.**

### 13. **`previous` is null on insert**
A script reading `previous.assignment_group` to detect "was already set" crashes on insert. Always null-check `previous` or use the `current.<field>.changes()` GlideElement method instead.

### 14. **OOB ARs may already exist on common tables**
Tables like `incident` ship with OOB assignment rules (e.g. "assign by category"). When adding a new one, query `sysrule_assignment` filtered to that table and consider whether your `order` will pre-empt or be pre-empted by OOB rules.

### 15. **Domain-separated instances**
ARs are domain-aware. On domain-separated instances, the AR's `sys_domain` controls visibility to records in matching domains. Test in the correct domain context.

## Navigation

- **Filter navigator**: `System Policy` → `Rules` → `Assignment`
- **Direct URL**: `/sysrule_assignment_list.do`
- **Filter by table**: `/sysrule_assignment_list.do?sysparm_query=table=x_acme_fm_case^active=true`
- **Order debugging**: add `order` column to the list view to see priority

## Diagnostic queries

```javascript
// What ARs apply to this Task table (and parent task)?
var gr = new GlideRecord('sysrule_assignment');
gr.addQuery('table', 'IN', 'x_acme_fm_case,task');
gr.addQuery('active', true);
gr.orderBy('order');
gr.query();
while (gr.next()) {
    gs.info(gr.getValue('order') + ' :: ' + gr.getValue('name') + ' :: ' + gr.getValue('condition'));
}

// Test whether a specific record satisfies an AR condition
var rec = new GlideRecord('x_acme_fm_case');
rec.get('<sys_id>');
var match = GlideFilter.checkRecord(rec, '<encoded query>');
gs.info('Condition match: ' + match);

// Simulate the AR-style script body against an existing record (without actually firing the AR)
var rec = new GlideRecord('x_acme_fm_case');
rec.get('<sys_id>');
var groupId = new x_acme_fm.CaseRoutingResolver().resolve(rec.getUniqueValue());
gs.info('Resolver would set: ' + groupId);
```

## Sandbox script gotcha

The `condition` field uses the same encoded-query syntax as anywhere else — **NOT** the Guarded Script sandbox restrictions (those apply to filter conditions on filter dictionaries, dynamic defaults, AMB conditions). Encoded queries can be complex with `^OR` / `^NQ` etc.

If you need conditional logic that an encoded query can't express, use the `script` field with a guard at the top:

```javascript
(function executeRule(current, previous) {
    // Guard — bail out if context not right
    if (current.priority != 1 && current.priority != 2) return;

    // The actual work
    current.assignment_group = '<group sys_id>';
})(current, previous);
```

## Related skills

- **`decision-tables`** — pair an AR with a Decision Table for admin-editable routing data
- **`script-include-patterns`** — resolver SIs called from AR script (cross-scope privileges, ES5, full api_name, JSDoc rules)
- **`business-rule-patterns`** — when you need overwrite semantics, async, or non-Task tables
- **`gliderecord-patterns`** — general DB conventions in the script
- **`data-policies`** — for client-side-equivalent server-side validation (different from ARs but adjacent)
- **`update-set-workflow`** — packaging ARs for promotion

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
