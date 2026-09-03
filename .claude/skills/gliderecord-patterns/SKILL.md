---
name: gliderecord-patterns
description: Invoke when the user asks to "query records", "GlideRecord", "database query", "update records", "insert record", "delete record", or when writing any ServiceNow server-side database operation.
---

# GlideRecord Patterns

GlideRecord is the server-side workhorse for reading and writing ServiceNow data. These patterns cover the query forms, performance rules, and write-safety rules that matter in practice.

## Basic Query Patterns

### Single record by sys_id

```javascript
var gr = new GlideRecord("incident")
if (gr.get("<sys_id>")) {
  gs.info("Found: " + gr.getValue("number"))
}
```

### Single record by field value

```javascript
var gr = new GlideRecord("sys_user")
if (gr.get("user_name", "admin")) {
  gs.info("Found user: " + gr.getValue("name"))
}
```

Always test the boolean return of `get()` — proceeding on a miss means you silently read (or write) an empty record.

### Multiple records

```javascript
var gr = new GlideRecord("incident")
gr.addQuery("active", true)
gr.addQuery("priority", "1")
gr.orderByDesc("sys_created_on")
gr.setLimit(100)
gr.query()

while (gr.next()) {
  gs.info(gr.getValue("number"))
}
```

## Encoded Queries

For anything beyond two or three conditions, an encoded query is both terser and easier to validate — you can copy it straight from a list-view URL or the condition builder:

```javascript
var gr = new GlideRecord("incident")
gr.addEncodedQuery("active=true^priority=1^assigned_toISEMPTY")
gr.query()

while (gr.next()) {
  // process
}
```

**Silent-failure warning:** an encoded query containing a misspelled or nonexistent field name does not throw — the platform typically drops the bad condition and returns a broader (or unfiltered) result set. When a query "works" suspiciously well, A/B-test it: run the same query with a deliberately impossible condition and confirm the count changes. Validate field names against the dictionary before trusting results.

## Performance Rules

### 1. Set a limit when you don't need everything

```javascript
var gr = new GlideRecord("incident")
gr.addQuery("active", true)
gr.setLimit(10)
gr.query()
```

### 2. getValue() for scalars, not direct property access

```javascript
// Returns a plain string
var number = gr.getValue("number")

// Direct access returns a GlideElement object — a common source of
// reference-vs-value bugs when stored in arrays or compared later
var element = gr.number
var numberStr = gr.number.toString()
```

### 3. Reference fields: getValue() vs getDisplayValue()

```javascript
// sys_id of the referenced record
var assignedToId = gr.getValue("assigned_to")

// human-readable display value of the referenced record
var assignedToName = gr.getDisplayValue("assigned_to")
```

### 4. Never query inside a loop

```javascript
// BAD — N round trips
for (var i = 0; i < userIds.length; i++) {
  var gr = new GlideRecord("sys_user")
  gr.get(userIds[i])
}

// GOOD — one query with IN
var gr = new GlideRecord("sys_user")
gr.addQuery("sys_id", "IN", userIds.join(","))
gr.query()
while (gr.next()) {
  // process each user
}
```

### 5. Counting: GlideAggregate, never a while-loop

```javascript
// BAD — fetches every row just to count them
var count = 0
var gr = new GlideRecord("incident")
gr.addQuery("active", true)
gr.query()
while (gr.next()) {
  count++
}

// GOOD — the database does the counting
var ga = new GlideAggregate("incident")
ga.addQuery("active", true)
ga.addAggregate("COUNT")
ga.query()
if (ga.next()) {
  var count = ga.getAggregate("COUNT")
}
```

`getRowCount()` on a GlideRecord is also acceptable for a quick count, but GlideAggregate is the right tool when counts feed logic or when grouping is involved.

## CRUD Operations

### Insert

```javascript
var gr = new GlideRecord("incident")
gr.initialize()
gr.setValue("short_description", "Example incident") // example
gr.setValue("caller_id", gs.getUserID())
gr.setValue("priority", "3")
var sysId = gr.insert()
```

Check the return value: `insert()` returns `null` on failure (ACL denial, aborted business rule) without throwing.

### Update

```javascript
var gr = new GlideRecord("incident")
if (gr.get("<sys_id>")) {
  gr.setValue("state", "6")
  gr.setValue("close_notes", "Issue fixed")
  gr.update()
}
```

### Delete — with caution

```javascript
var gr = new GlideRecord("incident")
if (gr.get("<sys_id>")) {
  gr.deleteRecord()
}
```

Never run a delete you haven't first previewed as a read: run the identical query, list the matching records, and get explicit confirmation before switching the loop body to `deleteRecord()`. `deleteMultiple()` skips business rules on some table types — prefer per-record deletes unless you have verified the cascade behavior.

### Bulk update

```javascript
var gr = new GlideRecord("incident")
gr.addQuery("state", "6")
gr.addQuery("resolved_at", "<", gs.daysAgoStart(30))
gr.query()

while (gr.next()) {
  gr.setValue("state", "7")
  gr.update()
}
```

## Write-Safety Exceptions

Two field classes break the "always setValue()" convention:

**Journal fields** (`work_notes`, `comments`, `additional_comments`): use direct assignment (`gr.work_notes = text`) or `setJournalEntry()`. `setValue()` on a journal field can silently post nothing — the update "succeeds" but no journal entry appears (verify on your instance first). See the `journal-field-formatting` skill.

**M2M relationship key columns** (e.g. `sys_group_has_role.role`, `sys_user_grmember.user`): UPDATE on the key column is rejected server-side but the script engine does not throw. Change membership rows by DELETE + INSERT, never by updating the key field in place (verify on your instance first).

## Query Operators

| Operator     | Example                                                | Description           |
| ------------ | ------------------------------------------------------ | --------------------- |
| `=`          | `addQuery('active', true)`                             | Equals                |
| `!=`         | `addQuery('active', '!=', true)`                       | Not equals            |
| `>`, `<`     | `addQuery('priority', '<', '3')`                       | Greater/Less than     |
| `>=`, `<=`   | `addQuery('sys_created_on', '>=', gs.daysAgoStart(7))` | Greater/Less or equal |
| `CONTAINS`   | `addQuery('short_description', 'CONTAINS', 'error')`   | Contains string       |
| `STARTSWITH` | `addQuery('number', 'STARTSWITH', 'INC')`              | Starts with           |
| `ENDSWITH`   | `addQuery('email', 'ENDSWITH', '@example.com')`        | Ends with             |
| `IN`         | `addQuery('state', 'IN', '1,2,3')`                     | In list               |
| `NOT IN`     | `addQuery('state', 'NOT IN', '6,7')`                   | Not in list           |
| `ISEMPTY`    | `addQuery('assigned_to', 'ISEMPTY', '')`               | Field is empty        |
| `ISNOTEMPTY` | `addQuery('assigned_to', 'ISNOTEMPTY', '')`            | Field is not empty    |

## Safety and Security

1. **`setWorkflow(false)`** skips business rules and engines — use it only for targeted repairs and bulk data fixes, and know that on tracked configuration tables it also suppresses update-set capture. If a change made this way must ship, force-add it to the update set and verify.
2. **`setLimit()`** on every query that could match an open-ended row count.
3. **`canRead()` / `canWrite()`** when acting on behalf of a user context — GlideRecord in server scripts bypasses ACLs by default.
4. **Never interpolate untrusted input** into encoded queries; use `addQuery()` parameters or validate first.
5. **Scoped tables:** when a script in one scope touches another scope's table, cross-scope access policies can deny the write while returning no error — read the record back after writing to confirm the change landed.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
