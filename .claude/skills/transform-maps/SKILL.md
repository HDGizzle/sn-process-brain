---
name: transform-maps
description: Invoke when the user asks to "import data", "transform map", "import set", "field map", "data source", "CSV import", "LDAP", "coalesce", or when building any ServiceNow data import or transformation.
---

# Transform Maps

Transform maps define how rows staged in an import set table are mapped, transformed, and written into a target table. This skill covers the full import chain: data source → staging table → transform map → field maps → transform scripts.

## Import Architecture

```
Data Source (CSV, LDAP, JDBC, REST)
        ↓
    Import Set Table (staging)
        ↓
    Transform Map (mapping rules)
        ↓
    Target Table (final destination)
```

## Key Components

| Component            | Table               | Purpose                  |
| -------------------- | ------------------- | ------------------------ |
| **Data Source**      | sys_data_source     | Connection configuration |
| **Import Set Table** | sys_db_object       | Staging table            |
| **Import Set**       | sys_import_set      | Import run record        |
| **Transform Map**    | sys_transform_map   | Mapping definition       |
| **Field Map**        | sys_transform_entry | Field mappings           |

All of these are configuration records: build them inside your active update set and verify capture after each write.

## Data Sources

### CSV data source (ES5 example)

```javascript
var ds = new GlideRecord("sys_data_source")
ds.initialize()
ds.setValue("name", "Employee Import - CSV") // example name
ds.setValue("type", "File")
ds.setValue("format", "CSV")
ds.setValue("file_path", "/import/employees.csv")
ds.setValue("header_row", 1)
ds.setValue("csv_delimiter", ",")
ds.setValue("csv_quote", '"')
ds.setValue("import_set_table", "u_employee_import")
ds.insert()
```

### JDBC data source (ES5 example)

```javascript
var ds = new GlideRecord("sys_data_source")
ds.initialize()
ds.setValue("name", "HR System - JDBC")
ds.setValue("type", "JDBC")
ds.setValue("connection_url", "jdbc:oracle:thin:@dbhost:1521:PROD") // example
ds.setValue("username", "readonly_account")
ds.setValue("password", "<encrypted_password>")
ds.setValue("query", "SELECT emp_id, first_name, last_name, email, dept_code FROM employees WHERE active = 1")
ds.setValue("import_set_table", "u_hr_employee_import")
ds.insert()
```

### REST data source (ES5 example)

```javascript
var ds = new GlideRecord("sys_data_source")
ds.initialize()
ds.setValue("name", "External API - REST")
ds.setValue("type", "REST (IntegrationHub)")
ds.setValue("rest_message", restMessageSysId)
ds.setValue("http_method", "GET")
ds.setValue("json_path", "$.data.employees[*]") // where in the response the row array lives
ds.setValue("import_set_table", "u_api_employee_import")
ds.insert()
```

## Import Set Tables

Staging tables extend `sys_import_set_row`. Column names on staging tables conventionally carry the `u_` prefix regardless of scope.

```javascript
// Create the staging table (ES5 example)
var table = new GlideRecord("sys_db_object")
table.initialize()
table.setValue("name", "u_employee_import")
table.setValue("label", "Employee Import")
table.setValue("super_class", "sys_import_set_row")
table.setValue("is_extendable", false)
table.insert()

// Add columns matching the source data
var columns = [
  { name: "u_employee_id", type: "string", max_length: 50 },
  { name: "u_first_name", type: "string", max_length: 100 },
  { name: "u_last_name", type: "string", max_length: 100 },
  { name: "u_email", type: "string", max_length: 255 },
  { name: "u_department", type: "string", max_length: 100 },
  { name: "u_manager_id", type: "string", max_length: 50 },
  { name: "u_start_date", type: "string", max_length: 20 },
]

for (var i = 0; i < columns.length; i++) {
  var col = new GlideRecord("sys_dictionary")
  col.initialize()
  col.setValue("name", "u_employee_import")
  col.setValue("element", columns[i].name)
  col.setValue("internal_type", columns[i].type)
  col.setValue("max_length", columns[i].max_length)
  col.insert()
}
```

Keep staging columns as strings and do type conversion in the transform — source data is rarely clean enough to trust typed staging columns.

## Transform Maps

```javascript
var tm = new GlideRecord("sys_transform_map")
tm.initialize()
tm.setValue("name", "Employee Import Transform") // example name
tm.setValue("source_table", "u_employee_import")
tm.setValue("target_table", "sys_user")
tm.setValue("order", 100)              // run order when multiple maps share a source
tm.setValue("active", true)
tm.setValue("copy_empty_fields", false)      // empty source values do not blank target fields
tm.setValue("enforce_mandatory_fields", true)
var tmSysId = tm.insert()
```

## Field Mappings

### Direct field mapping

```javascript
function addFieldMap(transformMapId, sourceField, targetField, config) {
  var fm = new GlideRecord("sys_transform_entry")
  fm.initialize()
  fm.setValue("map", transformMapId)
  fm.setValue("source_field", sourceField)
  fm.setValue("target_field", targetField)
  if (config && config.coalesce) {
    fm.setValue("coalesce", true)
  }
  fm.setValue("order", config ? config.order : 100)
  return fm.insert()
}

addFieldMap(tmSysId, "u_employee_id", "employee_number", { coalesce: true, order: 10 })
addFieldMap(tmSysId, "u_first_name", "first_name", { order: 20 })
addFieldMap(tmSysId, "u_last_name", "last_name", { order: 30 })
addFieldMap(tmSysId, "u_email", "email", { order: 40 })
```

### Reference field mapping

When the target field is a reference, the map can resolve the incoming value against a field on the referenced table instead of expecting a sys_id:

```javascript
var deptMap = new GlideRecord("sys_transform_entry")
deptMap.initialize()
deptMap.setValue("map", tmSysId)
deptMap.setValue("source_field", "u_department")
deptMap.setValue("target_field", "department")
deptMap.setValue("reference_key", true)
deptMap.setValue("reference_key_field", "name") // resolve by department name
deptMap.setValue("create_also", false)          // do NOT auto-create missing referenced records
deptMap.insert()
```

Leave `create_also` false unless you explicitly want the import to mint new referenced records — auto-created stubs from dirty source data are painful to clean up.

### Scripted field mapping

A field map with a `source_script` computes the target value; the script sets `answer`:

```javascript
var scriptMap = new GlideRecord("sys_transform_entry")
scriptMap.initialize()
scriptMap.setValue("map", tmSysId)
scriptMap.setValue("target_field", "name")
scriptMap.setValue(
  "source_script",
  "// Combine first and last name\n" + 'answer = source.u_first_name + " " + source.u_last_name;',
)
scriptMap.insert()

// Date normalization example: MM/DD/YYYY -> YYYY-MM-DD
var dateMap = new GlideRecord("sys_transform_entry")
dateMap.initialize()
dateMap.setValue("map", tmSysId)
dateMap.setValue("target_field", "u_start_date")
dateMap.setValue(
  "source_script",
  'var parts = source.u_start_date.split("/");\n' +
    "if (parts.length === 3) {\n" +
    '    answer = parts[2] + "-" + parts[0] + "-" + parts[1];\n' +
    "} else {\n" +
    '    answer = "";\n' +
    "}",
)
dateMap.insert()
```

## Coalesce — Update vs Insert

Coalesce fields are the matching key: when an incoming row matches an existing target record on all coalesce fields, that record is updated; otherwise a new record is inserted. No coalesce field at all means every run inserts duplicates.

```javascript
var coalesceMap = new GlideRecord("sys_transform_entry")
coalesceMap.initialize()
coalesceMap.setValue("map", tmSysId)
coalesceMap.setValue("source_field", "u_employee_id")
coalesceMap.setValue("target_field", "employee_number")
coalesceMap.setValue("coalesce", true)
coalesceMap.setValue("order", 1) // process the key first
coalesceMap.insert()
```

Multiple field maps flagged `coalesce=true` form a compound key: a row matches only when every coalesce field matches.

## Transform Scripts

### onBefore — per-row validation and skipping

```javascript
// Runs before each row is written
;(function runTransformScript(source, map, log, target) {
  // Skip rows you don't want
  if (source.u_status === "INACTIVE") {
    ignore = true
    return
  }

  // Reject incomplete rows loudly — log, then skip
  if (!source.u_employee_id || !source.u_email) {
    log.error("Missing required fields for row: " + source.sys_id)
    ignore = true
    return
  }

  // Normalize values in place
  source.u_email = source.u_email.toString().toLowerCase()
})(source, map, log, target)
```

Setting `ignore = true` skips the row silently from the target table's point of view — always pair it with a `log.error`/`log.warn` so skipped rows are traceable in the import log.

### onAfter — per-row follow-up work

```javascript
// Runs after each row is written; target is the resulting record
;(function runTransformScript(source, map, log, target) {
  if (target && action !== "ignore") {
    var dept = target.department.getDisplayValue()
    var groupName = ""

    if (dept === "IT") {
      groupName = "IT Staff"
    } else if (dept === "HR") {
      groupName = "HR Team"
    }

    if (groupName) {
      addUserToGroup(target.sys_id, groupName)
    }
  }

  function addUserToGroup(userId, groupName) {
    var group = new GlideRecord("sys_user_group")
    group.addQuery("name", groupName)
    group.query()

    if (group.next()) {
      // idempotent: only insert the membership if it does not already exist
      var member = new GlideRecord("sys_user_grmember")
      member.addQuery("user", userId)
      member.addQuery("group", group.getUniqueValue())
      member.query()

      if (!member.next()) {
        member.initialize()
        member.setValue("user", userId)
        member.setValue("group", group.getUniqueValue())
        member.insert()
      }
    }
  }
})(source, map, log, target)
```

### onComplete — end-of-run reporting

```javascript
// Runs once after all rows are processed
;(function runTransformScript(source, map, log, target) {
  var importSet = new GlideRecord("sys_import_set")
  if (importSet.get(source.sys_import_set)) {
    var stats = {
      total: importSet.getValue("rows"),
      inserted: importSet.getValue("insertions"),
      updated: importSet.getValue("updates"),
      errors: importSet.getValue("errors"),
    }

    log.info("Import completed: " + JSON.stringify(stats))

    if (stats.errors > 0) {
      gs.eventQueue("import.errors", importSet, stats.errors.toString())
    }
  }
})(source, map, log, target)
```

## Running Imports Programmatically

```javascript
var loader = new GlideImportSetLoader(dataSourceSysId)
var importSetSysId = loader.loadImportSet()

if (importSetSysId) {
  var transformer = new GlideImportSetTransformer()
  transformer.setImportSetID(importSetSysId)
  transformer.transform()

  // Always read the result back — a completed transform is not a clean transform
  var importSet = new GlideRecord("sys_import_set")
  if (importSet.get(importSetSysId)) {
    gs.info("Import completed: " + importSet.getValue("state"))
    gs.info("Rows: " + importSet.getValue("rows"))
    gs.info("Errors: " + importSet.getValue("errors"))
  }
}
```

## Best Practices

1. **Always stage** — never transform straight from source to target without an import set table.
2. **Define the coalesce key deliberately** — a stable external identifier, not a display name.
3. **Validate in onBefore** — skip bad rows with `ignore = true` plus a logged reason.
4. **Log every skip and failure** — silent row loss is the classic import bug.
5. **Import incrementally** — track a watermark (last import timestamp) in the data source query where the source supports it.
6. **Test with a small slice first** — a handful of rows, verify insert/update/error counts, then scale up.
7. **Have a rollback story** — know how you would identify and remove/revert records from a bad run before you run it.
8. **Schedule via scheduled data sources** for recurring loads rather than ad-hoc manual runs.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
