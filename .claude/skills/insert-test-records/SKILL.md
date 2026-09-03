---
name: insert-test-records
description: Invoke when the user asks to "insert test data", "create test records", "sample data", "seed data", "parent-child records", "deduplication", or when seeding dedup-safe (external_reference-keyed) test records into ServiceNow.
---

# Insert Test Records in ServiceNow

Patterns for seeding test data with correct parent-child linkage and safe, idempotent deduplication.

## HARD RULE: dedup query fields MUST exist on the target table

Calling `GlideRecord.addQuery('<field>', value)` with a field name that does not exist on the target table never throws an error. Instead, the platform's invalid-query fallback kicks in:

- The syslog (and script output) receives a line like `QueryEventLogger: Invalid query detected... [Unknown field <field> in table <table>]`.
- The query then returns **every row in the table** — not zero rows.
- `next()` therefore succeeds and hands you the oldest row by `sys_created_on` — a record with no relation whatsoever to your intended dedup key.

Why this is dangerous in a seeder: the "existing record" branch of an upsert then re-links a pre-existing, unrelated production/test record to your new parents and synthetic users, silently overwriting its reference fields. On one engagement this exact failure re-pointed the oldest row of a child table (created weeks earlier for unrelated work) at a brand-new test parent — the only trace was the `QueryEventLogger` line in the syslog. (Verify on your instance first, but treat the fallback as universal.)

**Rules:**

1. Before writing a dedup query against a custom field, confirm the field exists on the table — query `sys_dictionary` with `name=<table>^element=<field>`.
2. Prefer dedup fields that are guaranteed to exist: `sys_id`, `number` (Task-extending tables), `name` (most config tables). If the table has a designated idempotency field such as `external_reference`, use that.
3. Never assume `short_description` exists — it is common on Task-extending tables but absent from many config and data tables.
4. After every seeder run, scan the syslog (or the script output) for `QueryEventLogger: Invalid query`. If it appears, the run hijacked an existing record — find it and restore it.

## Strategy

```
┌─────────────────────────────────────────┐
│  1. PARENT RECORDS                      │
│     Insert first, capture sys_ids       │
├─────────────────────────────────────────┤
│  2. CHILD RECORDS                       │
│     Use parent sys_ids as references    │
├─────────────────────────────────────────┤
│  3. RELATED RECORDS                     │
│     M2M links, contact records, etc.    │
└─────────────────────────────────────────┘
```

**Key principle:** every seeder must be idempotent — safe to run any number of times. Key each record on a stable external reference and skip on match.

## Deduplication via external_reference

```javascript
// Safe insert — re-running produces no duplicates
function safeInsert(table, externalRef, fieldValues) {
    var gr = new GlideRecord(table);
    gr.addQuery('external_reference', externalRef);
    gr.query();
    if (gr.hasNext()) {
        gr.next();
        gs.info('EXISTS: ' + externalRef + ' -> ' + gr.getUniqueValue());
        return gr.getUniqueValue();
    }

    gr.initialize();
    gr.setValue('external_reference', externalRef);
    for (var field in fieldValues) {
        gr.setValue(field, fieldValues[field]);
    }
    var sysId = gr.insert();
    gs.info('CREATED: ' + externalRef + ' -> ' + sysId);
    return sysId;
}
```

If the target table has no `external_reference` field, add one (or pick another guaranteed-unique key per the hard rule above) — do not dedup on a field you have not verified.

## Helper Functions

### Find User by Employee Number

```javascript
function findUserByEmployeeNumber(empNumber) {
    var gr = new GlideRecord('sys_user');
    gr.addQuery('employee_number', empNumber);
    gr.query();
    if (gr.next()) {
        return gr.getUniqueValue();
    }
    gs.warn('User not found: employee_number=' + empNumber);
    return '';
}
```

### Find Record by Encoded Query

```javascript
function findRecord(table, query) {
    var gr = new GlideRecord(table);
    gr.addEncodedQuery(query);
    gr.query();
    if (gr.next()) {
        return gr.getUniqueValue();
    }
    gs.warn('Record not found: ' + table + ' [' + query + ']');
    return '';
}
```

## Parent Record Template

Example uses the placeholder scope `x_acme_fm` and table `x_acme_fm_case` — substitute your own.

```javascript
// ============================================================
// INSERT PARENT RECORDS (example: x_acme_fm_case)
// ============================================================

var SCOPE_ID = '<scope_sys_id>'; // background scripts run global — set scope explicitly
var parentIds = {};
var created = 0;
var skipped = 0;

var parents = [
    {
        ref: 'TEST-PARENT-001',
        fields: {
            short_description: 'Test record 1',
            state: '1',
            priority: '3'
        }
    },
    {
        ref: 'TEST-PARENT-002',
        fields: {
            short_description: 'Test record 2',
            state: '1',
            priority: '2'
        }
    }
];

for (var i = 0; i < parents.length; i++) {
    var p = parents[i];
    var gr = new GlideRecord('x_acme_fm_case');
    gr.addQuery('external_reference', p.ref);
    gr.query();

    if (gr.hasNext()) {
        gr.next();
        parentIds[p.ref] = gr.getUniqueValue();
        gs.info('EXISTS: ' + p.ref);
        skipped++;
        continue;
    }

    gr.initialize();
    gr.setValue('external_reference', p.ref);
    for (var field in p.fields) {
        gr.setValue(field, p.fields[field]);
    }
    gr.sys_scope = SCOPE_ID;
    var sysId = gr.insert();
    parentIds[p.ref] = sysId;
    gs.info('CREATED: ' + p.ref + ' -> ' + sysId);
    created++;
}

gs.info('Parents — Created: ' + created + ' | Skipped: ' + skipped);
```

## Child Record Template

```javascript
// ============================================================
// INSERT CHILD RECORDS (example: x_acme_fm_case_detail)
// ============================================================

var childCreated = 0;
var childSkipped = 0;

var children = [
    {
        ref: 'TEST-CHILD-001',
        parentRef: 'TEST-PARENT-001',
        fields: {
            short_description: 'Child of record 1',
            type: 'category_a'
        }
    }
];

for (var j = 0; j < children.length; j++) {
    var c = children[j];
    var parentSysId = parentIds[c.parentRef];

    if (!parentSysId) {
        gs.error('Parent not found for: ' + c.ref);
        continue;
    }

    var cgr = new GlideRecord('x_acme_fm_case_detail');
    cgr.addQuery('external_reference', c.ref);
    cgr.query();

    if (cgr.hasNext()) {
        gs.info('EXISTS: ' + c.ref);
        childSkipped++;
        continue;
    }

    cgr.initialize();
    cgr.setValue('external_reference', c.ref);
    cgr.setValue('parent', parentSysId); // link to parent
    for (var field in c.fields) {
        cgr.setValue(field, c.fields[field]);
    }
    cgr.insert();
    gs.info('CREATED: ' + c.ref);
    childCreated++;
}

gs.info('Children — Created: ' + childCreated + ' | Skipped: ' + childSkipped);
```

## Script Execution Order

Run seeders strictly in dependency order:

1. **Parents first** — capture their sys_ids (print a ref-to-sys_id map at the end).
2. **Children second** — resolve parents via the captured map, never by guessing.
3. **Related records last** — M2M links, contact/party records, attachments.

Keep each script self-contained and re-runnable on its own.

## Debug Tips

| Problem | Cause | Solution |
|---------|-------|----------|
| Duplicate records | No dedup check | Always key on external_reference |
| Rows silently "re-linked" | Dedup field doesn't exist on table | See hard rule — verify via sys_dictionary, check syslog |
| Child without parent | Wrong execution order | Run the parent script first |
| Wrong scope | Background script runs in global | Set sys_scope explicitly |
| User not found | Wrong employee number | Verify in sys_user |
| Missing reference | Invalid parent sys_id | Check the printed parent map |

## Checklist

- [ ] Dedup fields verified to exist on each target table (sys_dictionary)
- [ ] Parent records defined with unique external_reference values
- [ ] Child records linked to correct parent refs
- [ ] Helper functions used for user/record lookups
- [ ] Scripts ordered by dependency, each self-contained
- [ ] Safe to run multiple times (idempotent)
- [ ] Scope set explicitly on all inserted records
- [ ] Syslog checked for `QueryEventLogger: Invalid query` after every run

## Reference Scripts

Worked, runnable examples (placeholder tables and obviously-fake data — adapt before use):

- `references/example_insert_parent_records.js` — parent cases with dedup and a printed sys_id map
- `references/example_insert_child_records.js` — child detail records resolving parents via the map, with a source-value mapping table
- `references/example_insert_related_records.js` — related contact records with a user lookup helper

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
