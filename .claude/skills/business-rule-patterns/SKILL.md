---
name: business-rule-patterns
description: This skill should be used when the user asks to "create a business rule", "before insert", "after update", "async business rule", "business rule not working", "current vs previous", "filter condition", "encoded query", "CHANGESFROM", "CHANGESTO", "setAbortAction", or any Business Rule development.
---

# Business Rule Patterns for ServiceNow

Business Rules (`sys_script`) are server-side scripts that run when records are
queried, displayed, inserted, updated, or deleted. This skill covers when to use each
type, the filter-vs-script division of labor, table inheritance behavior, and the
silent-failure traps specific to BRs.

## Project Conventions

- **Naming:** prefix every BR name with the record prefix from `product.config.json`
  (`naming.recordPrefix`, e.g. `ACME - Require work notes on state change`). Always
  fill the `description` field on create AND update. Keep names **≤ 40 characters** —
  `sys_script.name` truncates silently beyond that and name-based lookups then find
  nothing (see the wiki's gotchas page, section 3.1).
- **User-visible messages** (`gs.addErrorMessage`, `gs.addInfoMessage`, abort
  messages): always through `gs.getMessage('<namespace>.<area>.<key>')` backed by
  `sys_ui_message` records for the language pair configured in `product.config.json`
  (`language.source` / `language.targets`). Never hardcode user-facing text.
- **Engine:** global-scope BRs run on Rhino — ES5 only (`var`, no arrow functions,
  `const`/`let`, or classes). Scoped applications may support modern JS — match the
  style of the artifact you are editing.
- **Scoped Script Includes** called from a BR: always use the full `api_name`
  including the scope prefix (`x_acme_fm.CaseUtil`). Without the prefix the call
  fails silently.

## When to Use Each Type

| Type        | Timing                    | Use Case                              | Performance Impact |
| ----------- | ------------------------- | ------------------------------------- | ------------------ |
| **Before**  | Before database write     | Validate, modify current record       | Low                |
| **After**   | After database write      | Create related records, notifications | Medium             |
| **Async**   | Background (after commit) | Heavy processing, integrations        | None (background)  |
| **Display** | When form loads           | Modify form display, set defaults     | Low                |

## Available Objects

```javascript
// Always available inside a Business Rule:
current  // The record being operated on
previous // The record BEFORE changes (update/delete only)
gs       // GlideSystem utilities
```

## Before Business Rules

Best suited to validation and same-record field manipulation:

```javascript
// Block an illegal transition
(function executeRule(current, previous) {
    if (current.state == 7 && previous.state != 6) {
        current.setAbortAction(true);
        gs.addErrorMessage(gs.getMessage('acme.case.resolve_before_close')); // example key
    }
})(current, previous);
```

```javascript
// Default fields on insert
(function executeRule(current, previous) {
    if (current.isNewRecord()) {
        current.setValue('caller_id', gs.getUserID());
        current.setValue('opened_by', gs.getUserID());
    }
})(current, previous);
```

**Never do in Before rules:**

- Call `current.update()` — the write is already in flight; calling update causes
  recursion. Set fields with `setValue()` and let the platform persist them.
- Heavy queries against other tables (keep the transaction fast).
- External API calls.

## After Business Rules

For operations on related records once the write has committed:

```javascript
// Create a follow-up task when priority becomes P1
(function executeRule(current, previous) {
    if (current.priority.changesTo(1)) {
        var task = new GlideRecord('task');
        task.initialize();
        task.setValue('short_description', 'P1 follow-up: ' + current.number);
        task.setValue('parent', current.sys_id);
        task.insert();
    }
})(current, previous);
```

```javascript
// Roll a counter up to the parent record
(function executeRule(current, previous) {
    var parent = new GlideRecord('x_acme_fm_case'); // example table
    if (parent.get(current.parent_case)) {
        parent.setValue('u_child_count', parseInt(parent.getValue('u_child_count') || 0, 10) + 1);
        parent.update();
    }
})(current, previous);
```

## Async Business Rules

For anything heavy that must not block the user's transaction:

```javascript
// Hand off to an integration
(function executeRule(current, previous) {
    var integrator = new x_acme_fm.ExternalSystemIntegration(); // example SI
    integrator.syncCase(current.getUniqueValue());
})(current, previous);
```

```javascript
// Fire an event for a notification
(function executeRule(current, previous) {
    gs.eventQueue('x_acme_fm.case.priority.high', current, current.assigned_to, gs.getUserID());
})(current, previous);
```

Note: `previous` is not available in async rules, and CHANGES* filter operators do
not evaluate there — differentiate in before/after rules instead.

## Useful Methods

### current Methods

```javascript
current.isNewRecord()          // True if insert
current.isValidRecord()        // True if record exists
current.getValue('field')      // Get field value
current.setValue('field', val) // Set field value
current.setAbortAction(true)   // Cancel the operation
current.operation()            // 'insert', 'update', 'delete'
current.isActionAborted()      // Check if aborted
```

### Field Change Detection

```javascript
current.priority.changes()      // Field changed (any value)
current.priority.changesTo(1)   // Changed TO this value
current.priority.changesFrom(3) // Changed FROM this value
current.priority.nil()          // Field is empty
```

### previous Comparisons

```javascript
// Did the field move?
if (current.state != previous.state) {
    gs.info('State changed from ' + previous.state + ' to ' + current.state);
}

// A specific kind of change
if (current.assigned_to.changes() && !previous.assigned_to.nil()) {
    gs.info('Reassignment occurred');
}
```

## Condition Examples

Use the condition/filter to limit when the rule runs at all:

| Condition                        | Meaning                    |
| -------------------------------- | -------------------------- |
| `current.active == true`         | Only active records        |
| `current.isNewRecord()`          | Only on insert             |
| `current.priority.changes()`     | Only when priority changes |
| `gs.hasRole('admin')`            | Only for admins            |
| `current.assignment_group.nil()` | Only when unassigned       |

## Code Comments (Mandatory)

**Every business rule script MUST carry adequate comments.** Other developers (and
future you) must be able to grasp the intent without tracing every line.

### Required Comments

1. **Header block** — what the BR does, why it exists, and any non-obvious context:

```javascript
(function executeRule(current, previous) {
    // ============================================================
    // Post a work note to the parent case when a child task is
    // created, including a clickable link to the task record.
    // Uses gs.getMessage() for multilingual support.
    // ============================================================
```

2. **Section comments** — before each logical block, explain the *why*:

```javascript
    // Build a workspace-compatible URL (standard table.do format so
    // the workspace intercepts it and opens the record as a tab)
    var taskUrl = instanceUrl + '/x_acme_fm_case_task.do?sys_id=' + taskSysId;

    // Prevent cascading BRs on the parent (we only want to add the
    // work note, not re-trigger state/assignment logic)
    grCase.setWorkflow(false);
    grCase.update();
```

3. **Non-obvious logic** — explain anything that would make a reader pause:

```javascript
    // Only the primary task drives the parent's due date — secondary
    // tasks carry their own deadlines and must not overwrite it
    if (current.u_is_primary == true && current.due_date.changes()) {
```

### What NOT to Comment

Don't narrate the obvious — trust the reader on GlideRecord basics:

```javascript
// BAD — states the obvious
var grCase = new GlideRecord('x_acme_fm_case'); // Get case record
if (!grCase.get(caseSysId)) return; // Return if not found

// GOOD — no comment needed, the code explains itself
var grCase = new GlideRecord('x_acme_fm_case');
if (!grCase.get(caseSysId)) return;
```

## Performance Best Practices

1. **Use conditions/filters** — limit when the rule runs at all
2. **Keep Before rules fast** — avoid queries where possible
3. **Use Async for integrations** — never block the transaction
4. **Avoid Display rules** where possible — they slow every form load
5. **Set Order deliberately** — lower numbers run first (100–500 typical range)
6. **Check "when to run" flags** — insert, update, delete, query

## Common Patterns

### Auto-Assignment

```javascript
// Before Insert/Update
if (current.assignment_group.changes() && !current.assignment_group.nil()) {
    var members = new GroupMembers(current.assignment_group);
    current.assigned_to = members.getNextAvailable();
}
```

### Cascade Updates

```javascript
// After Update — close open children when the parent closes
if (current.state.changesTo(7)) {
    var tasks = new GlideRecord('task');
    tasks.addQuery('parent', current.sys_id);
    tasks.addQuery('state', '!=', 7);
    tasks.query();
    while (tasks.next()) {
        tasks.setValue('state', 7);
        tasks.update();
    }
}
```

## Filter Condition vs Script Logic

> **Golden Rule:** Filter condition = gatekeeper (WHEN to run). Script = logic
> (WHAT to do).

The `filter_condition` field takes an encoded query. The script should NOT re-check
what the filter already guarantees.

### Available Filter Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `=` | Equals | `state=6` |
| `!=` | Not equals | `state!=0` |
| `ISEMPTY` | Field is empty | `assigned_toISEMPTY` |
| `ISNOTEMPTY` | Field has value | `assigned_toISNOTEMPTY` |
| `CHANGESFROM` | Changed from value | `stateCHANGESFROM0` |
| `CHANGESTO` | Changed to value | `stateCHANGESTO6` |
| `VALCHANGES` | Value changed | `stateVALCHANGES` |
| `^OR` | OR operator | `state=6^ORstateCHANGESFROM0` |
| `^EQ` | End of query | `state=6^EQ` |

### Trust the Filter — Don't Duplicate

```javascript
// BAD — filter_condition already guarantees stateCHANGESFROM0
if (previous && previous.state == 0 && current.state != 0) {
    doSomething(); // Unnecessary check!
}

// GOOD — only differentiate between the scenarios the filter allows
// filter_condition: state=6^ORstateCHANGESFROM0^EQ
if (current.state == 6 && current.u_case_type.changes()) {
    handleScenarioA();
    return;
}
else {
    // Filter guarantees stateCHANGESFROM0
    handleScenarioB();
}
```

See `references/example_filter_vs_script_br.js` for a complete worked example of
this structure.

### Test Filter Conditions

Before wiring an encoded query into a BR, test it in a list view:
1. Open the target table list
2. Append `?sysparm_query=[YOUR_ENCODED_QUERY]` to the URL
3. Verify it returns the records you expect — including at least one record you
   KNOW should match (an all-empty result can mean a broken filter, not an empty set)

### Trap: dot-walking a base-table reference into a child-only field

A filter term that dot-walks through a reference field typed on a **base** table to
reach a field that exists only on a **child** (extended) table silently matches
**zero rows** — the BR never fires, and nothing errors at write time (at most an
`Invalid query detected [Unknown field ...]` line in the system log). This is
platform behavior, not a configuration mistake you can fix in the filter. Full
write-up: the wiki's gotchas page, section 2.2.

**Correct pattern — keep the filter to own-table/base-table terms and check the
child field in-script:**

```javascript
// filter_condition: only own-field / base-table terms, e.g. u_is_primary=true
(function executeRule(current, previous) {
    // u_category lives only on the child table, so it cannot be
    // dot-walked in the filter — read it live instead
    var grParent = new GlideRecord('x_acme_fm_case'); // example: child table the ref actually points to
    if (!grParent.get(current.getValue('parent_case')) || grParent.getValue('u_category') != 'hardware') {
        return;
    }
    // ... category-specific logic ...
})(current, previous);
```

A single `get()` at the top of a before-BR is acceptable here — it is the only way
to reach the child-table field. Only fields that exist on the base table itself
(`sys_class_name`, `state`, ...) are safely dot-walkable through such a reference.

## Creating Business Rules via Background Script

Template for creating BRs programmatically:

```javascript
var SCOPE_ID = '[SCOPE_SYS_ID]';
var BR_NAME = '[BUSINESS_RULE_NAME]';
var BR_TABLE = '[TABLE_NAME]';

var existing = new GlideRecord('sys_script');
existing.addQuery('name', BR_NAME);
existing.addQuery('collection', BR_TABLE);
existing.query();

if (existing.hasNext()) {
    gs.info('Business Rule already exists: ' + BR_NAME);
} else {
    var br = new GlideRecord('sys_script');
    br.initialize();
    br.name = BR_NAME;
    br.collection = BR_TABLE;
    br.action_insert = false;
    br.action_update = true;
    br.action_delete = false;
    br.action_query = false;
    br.when = 'before';
    br.order = 100;
    br.active = true;
    br.advanced = true;
    br.filter_condition = '[ENCODED_QUERY]^EQ';
    br.script = '(function executeRule(current, previous) {\n' +
        '    // Logic here\n' +
        '})(current, previous);';
    br.sys_scope = SCOPE_ID;
    br.sys_package = SCOPE_ID;
    var sysId = br.insert();
    gs.info('BUSINESS RULE CREATED: ' + BR_NAME + ' sys_id: ' + sysId);
}
```

Remember: `sys_scope`/`sys_package` take the scope's **sys_id**, never the scope
name string, and the write must land in the correct update set — follow the
`update-set-workflow` skill.

## Table Inheritance and Business Rules

**BRs on a parent table automatically fire for all child (extended) tables.** This
is built into the table hierarchy — no flag or checkbox involved.

### How It Works

```
x_acme_fm_case                ← BR defined here (example hierarchy)
├── x_acme_fm_case_hardware   ← BR fires here too (automatically)
└── x_acme_fm_case_software   ← BR fires here too (automatically)
```

A record in `x_acme_fm_case_hardware` IS a record in `x_acme_fm_case` — that is why
the BR fires.

### Restricting to Parent Only

To make a BR fire ONLY on the parent table and skip children:

```javascript
// At the top of the script
if (current.getRecordClassName() !== 'x_acme_fm_case') return;
```

### Getting the Actual Table Name

When a BR fires on a child table, `current.getRecordClassName()` returns the actual
child table name — use it for table-specific logic:

```javascript
// Returns 'x_acme_fm_case_hardware' even though the BR sits on x_acme_fm_case
var actualTable = current.getRecordClassName();

// Build a URL that opens the correct form
var url = instanceUrl + '/' + actualTable + '.do?sys_id=' + current.getUniqueValue();

// Or fetch the localized table label
var tableLabel = GlideTableDescriptor.get(actualTable).getLabel();
```

### What IS Inherited vs What is NOT

| Artifact | Inherited? |
|----------|-----------|
| **Business Rules** | Yes — fires on all child tables |
| **ACLs** | Yes — inherited by child tables |
| **Dictionary fields** | Yes — child tables get parent fields |
| **Notifications** | No — configured per table |
| **UI Policies** | No — table-specific |
| **Client Scripts** | No — table-specific |

### There Is No "Inherited" Checkbox

`sys_script` has no "inherited" boolean. Inheritance is automatic. The `is_rest`
field (labeled "Web Services") is NOT an inheritance flag — do not set it thinking
it enables inheritance.

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| BR not firing | Wrong action trigger | Check action_insert/update/delete |
| BR not firing | Filter condition not matching | Test encoded query in list view against a known-matching record |
| BR not firing, filter "looks right" | Filter dot-walks a base-table reference into a child-only field | Move the check in-script — see the trap section above / wiki gotchas 2.2 |
| BR fires too often | Filter too broad | Add more specific conditions |
| `previous` is null | Using async BR | Use before/after, not async |
| CHANGESFROM not working | Using in async BR | Only works in before/after |
| Duplicate logic | Re-checking filter in script | Trust the filter_condition |
| Name-based lookup finds nothing | Name silently truncated at 40 chars | Look BRs up by sys_id; keep names ≤ 40 |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
