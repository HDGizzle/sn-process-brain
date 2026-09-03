---
name: dynamic-filter-options
description: Invoke when the user mentions "dynamic filter", "sys_filter_option_dynamic", "DYNAMIC operator", "filter by script", "is one of my groups", "one of my", "multi-value filter", "reusable filter", or when building a ServiceNow Dynamic Filter Option (named filter in the operator dropdown).
---

# Dynamic Filter Options for ServiceNow

`sys_filter_option_dynamic` defines a **named, reusable filter** that returns values from a server-side script. Referenced from encoded queries via `<field>DYNAMIC<filter_sys_id>` — the field's value is matched against the script's return. Used in ACL conditions, list filters, reference qualifiers, and dynamic defaults.

## Required fields — silent failure if any are missing

This is the core failure mode of the table. Creating a filter with only `label` + `script` + `active` looks correct but **the DYNAMIC operator cannot resolve it** — ACL conditions return empty, list filters never fire, no error appears anywhere.

Set ALL of these when creating a new dynamic filter:

| Field | What it does | If missing |
|---|---|---|
| `label` | Display name | Empty in filter dropdowns |
| `script` | Server-side expression returning the filter value(s) | Filter returns nothing |
| **`available_for_filter`** | Must be `true` to allow the filter in list filters AND encoded query DYNAMIC operator | **DYNAMIC operator can't resolve — silent empty result. This is the most common miss.** |
| **`field_type`** | Reference to `sys_glide_object` — declares the scalar type the script returns | Type-check fails — silent failure |
| **`table`** | Target table for the references the filter returns | Filter not bound to the right field type |
| `order` | Display order in the operator dropdown | Cosmetic only |
| `available_for_default` | Allow use as a dynamic default value on fields | Can't be picked as default |
| `available_for_ref_qual` | Allow use in reference qualifiers | Can't be picked in ref qual builder |
| `roles` | Optional comma list — only these roles see it as an option | Visible to everyone |
| `active` | `true` to enable | Filter ignored |

**Standard reference `field_type` sys_id:** `52a227c1bf3320001875647fcf07396a` (label "Reference", scalar `GUID`) (OOTB — verify on your instance). Use this for filters that return sys_ids — which covers almost every persona / "my X" / "one of my Y" pattern.

## Single-value vs multi-value return

The DYNAMIC operator handles both. The return shape dictates the semantics:

```javascript
// Single value — OOTB "Me" filter (sys_id 90d1921e5f510100a9ad2572f2b477fe — OOTB, verify on your instance)
gs.getUserID()
// → DYNAMIC operator → equality: <field> = <returned-sys_id>

// Multi value — OOTB "One of My Groups" filter (sys_id d6435e965f510100a9ad2572f2b47744 — OOTB, verify on your instance)
gs.getUser().getMyGroups()  // returns Array<sys_id>
// → DYNAMIC operator → IN-list: <field> IN (<sys_id1>, <sys_id2>, ...)
```

Multi-value scripts MUST return an Array — not a comma-separated string. The platform serializes the array into the IN-list automatically. A comma-string return is treated as one single string value and never matches.

## Sandbox limitation on the `script` field

The `script` field runs in **Guarded Script** (sandbox) — single expression only, the same rules as encoded query `javascript:` prefixes and other condition-field scripts. Forbidden inside the field:

- `var` / `let` / `const`
- `if` / `for` / `while` / `switch`
- Multiple statements (no `;`-separated sequences)
- Function declarations

For any non-trivial logic, put it in a **Script Include** and call it as a one-liner. The SI runs OUTSIDE the sandbox, so it can do whatever it needs.

```javascript
// sys_filter_option_dynamic.script — sandbox-safe single expression (example)
new x_acme_fm.CasePersonaUtil().getMyActionCaseIds()
```

**The full `api_name` with scope prefix is mandatory** when calling a scoped Script Include from a dynamic filter, since the filter may evaluate in a different scope.

## Cross-scope reads from the SI

If the SI called by the filter reads tables outside its own scope (e.g. a scoped SI walking `sys_user.manager`), the standard `sys_scope_privilege` requirement applies. Verify:

```json
{ "command": "query_records", "params": { "table": "sys_scope_privilege", "query": "source_scope.scope=<si_scope>^target_name=<other_table>^operation=read^status=allowed", "fields": "target_name,operation,status" } }
```

`admin` does NOT bypass scope isolation.

## Usage patterns

### ACL condition
```
sys_idDYNAMIC<filter_sys_id>^EQ
```

Combine with OR:
```
sys_idDYNAMIC<filter1>^ORsys_idDYNAMIC<filter2>^EQ
```

Combine with role checks: the role goes on `sys_security_acl_role`, not in the condition.

### List filter (workspace + classic UI)
Once `available_for_filter=true` and `field_type` + `table` match the field being filtered, the filter appears in the operator dropdown for that field.

### Reference qualifier
Set `available_for_ref_qual=true`. Use in the dictionary entry's "Reference qual" field — the filter shows in the picker.

### Dynamic default value
Set `available_for_default=true`. Pick the filter from the field's default-value-options selector.

## Workflow for creating a new dynamic filter

```
1. Decide what the filter returns: single sys_id (equality) vs Array<sys_id> (IN-list)
2. Identify the table the filter targets (the reference type of the field this will gate)
3. Write the Script Include method that does the actual lookup (a sandbox-safe one-liner call becomes the filter's script)
4. switch_context updateset + application (dual-switch hard rule — see the wiki's hard-rules page)
5. create_artifact on sys_filter_option_dynamic with ALL required fields (example values):
   {
     "name": "ACME - <descriptive name>",        // use your project's naming-convention prefix
     "label": "ACME - <descriptive name>",
     "script": "new <scope>.<SIName>().<method>()",
     "active": "true",
     "available_for_filter": "true",
     "field_type": "52a227c1bf3320001875647fcf07396a",   // Reference / GUID (OOTB — verify on your instance)
     "table": "<target_table>",
     "order": "<n>"
   }
6. Verify: query the record back and confirm all four critical fields landed
7. Test the DYNAMIC operator in a sample ACL or list filter; impersonate the target persona
```

## OOTB references for comparison

All sys_ids below are OOTB platform records — verify on your instance before relying on them.

| Filter | sys_id | Returns | Pattern | field_type | table |
|---|---|---|---|---|---|
| Me | `90d1921e5f510100a9ad2572f2b477fe` | Single sys_user sys_id | Equality | reference | sys_user |
| One of My Groups | `d6435e965f510100a9ad2572f2b47744` | Array<sys_user_group> | IN-list | reference | sys_user_group |
| One of My Assignments | `0f63961e5f510100a9ad2572f2b47745` | Array<sys_user> | IN-list | reference | sys_user |
| One of My Approvals | `54635e965f510100a9ad2572f2b4774c` | Array<sys_user> | IN-list | reference | sys_user |

All four use the same `field_type` (Reference, scalar GUID) and differ only on `table` + `script`. Use them as templates whenever building a new persona-style filter (e.g. an Array-returning "Cases where I have an action" filter on `x_acme_fm_case`, backed by a scoped SI method that returns an array for IN-list semantics).

## Verification cheat sheet

After creating/updating any dynamic filter, query it back with these fields and confirm:

```json
{ "command": "query_records", "params": { "table": "sys_filter_option_dynamic", "query": "sys_id=<filter_sys_id>", "fields": "label,script,available_for_filter,field_type.name,table,order,active,sys_updated_on", "limit": 1 } }
```

Required:
- `available_for_filter = true`
- `field_type.name = reference` (or whichever scalar matches)
- `table = <expected target table>`
- `active = true`
- `sys_updated_on` moved (proof of an actual write — see the wiki's hard-rules page on silent no-ops)

If `available_for_filter` is `false` or any of the others are empty, the filter is configured but silently unusable.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Created with only `label`+`script`+`active` | ACL condition using DYNAMIC always evaluates empty; no error | Set `available_for_filter`, `field_type`, `table` |
| Script returns comma-separated string instead of array | IN-list match treats the whole string as a single value | Return an Array (e.g. `result.push(sysId)` then `return result;` not `return result.join(',');`) |
| Used short SI name without scope prefix in `script` | Filter returns nothing, no error | Use the full `api_name`: `new x_acme_fm.CaseFilterUtil().method()` |
| Script is multi-statement / has var declarations | Sandbox parse error at evaluation time, filter dies silently | Move logic into a Script Include, leave the filter's `script` as a single method call |
| `update_record` on filter fields silently no-ops | `sys_updated_on` doesn't move, fields unchanged | switch_context to BOTH updateset AND application scope first (dual-switch hard rule) |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
