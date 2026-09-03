---
name: scoped-apps
description: Invoke when the user asks to "create application", "scoped application", "custom app", "application scope", "x_ prefix", "app scope", "cross-scope", "application properties", or any ServiceNow scoped application development.
---

# Scoped Application Development

> ⚠️ **Resurrected reference — not instance-verified.** This skill was rewritten from an
> archived outline. The patterns below are standard platform behavior, but none of them
> carry this framework's "verified on a live instance" stamp — treat every field name and
> behavior claim as "(verify on your instance first)". The **framework doctrine** blocks
> (scope sys_id, dual switch, update-set-per-scope) are kernel law, not outline material.

Scoped applications isolate custom development: namespaced tables and APIs, explicit
cross-scope contracts, and clean packaging. Most engagements this framework supports
build inside one primary scoped app (placeholder: `x_acme_fm`).

## Why scoped over global

| Concern | Global scope | Scoped app |
|---|---|---|
| Naming collisions | Possible | Prevented by the `x_` prefix |
| Packaging | Update sets only | App repository / installable app, plus update sets |
| Access control | Everything open by default | Explicit cross-scope design (app access, API access) |
| Store publishing | No | Yes |
| Dependencies | Implicit | Declared |
| JS level | ES5 (Rhino) | ES5 default; modern-JS (ES12) opt-in — see es5-compliance skill |

## Creating the app

Create the application container in **Studio** (System Applications → Studio → Create
Application): name, auto-generated scope (`x_[vendorprefix]_[app]`), version. Configure
runtime access for any global/other-scope tables the app must touch. There is no
supported agent-API route for creating the app container itself — build the container in
Studio, then build its artifacts via the agent API under the rules below.

Naming:

```
x_[vendorprefix]_[app]     scope        e.g. x_acme_fm        (examples)
x_acme_fm_case             scoped table (scope prefix is automatic)
```

## Framework doctrine — writing INTO a scoped app (mandatory)

These rules come from the kernel and the wiki's hard-rules page; they override anything
a vendor doc or generated tool doc says:

1. **Dual `switch_context`.** Before ANY `create_artifact`/`update_record` on a scoped
   record: switch the **update set** AND switch the **application** — two calls, both
   required. Skipping the application switch is a silent no-op: the API says "success",
   the record is unchanged. Verify every write with a read-back.
2. **`create_artifact` scope = the scope's sys_id**, never the scope-name string. Vendor
   docs teach names — wrong for this framework. Look the sys_id up on the wiki's
   registry-sys-ids page (and verify it against the live `sys_scope` row before first use).
3. **Update set per scope.** Changes capture in the update set of the scope they belong
   to. A change in a different scope needs a **same-named update set in that scope**:
   create it, switch, change, switch back. Mechanics: update-set-workflow skill; which
   scope captures what: update-set-scope-strategy skill.
4. **Background scripts run in global scope** regardless of any context switch, and
   cross-scope deletes from them are refused (verify on your instance first). For
   in-scope maintenance operations, expose a public method on a scoped Script Include
   and call that.

## Tables and records

```javascript
// The scope prefix is part of the real table name
var gr = new GlideRecord('x_acme_fm_case'); // example table
gr.initialize();
gr.setValue('name', 'My case');
gr.insert();
```

## Script Includes in a scoped app

```javascript
var CaseUtil = Class.create();
CaseUtil.prototype = {
    initialize: function() {
        this.tableName = 'x_acme_fm_case'; // example
    },

    createCase: function(name, description) {
        var gr = new GlideRecord(this.tableName);
        gr.initialize();
        gr.setValue('name', name);
        gr.setValue('description', description);
        return gr.insert();
    },

    type: 'CaseUtil'
};
```

Two access decisions per Script Include:

- **Accessible from** (`access` field): "This application scope only" (package-private,
  the default) vs "All application scopes" (public). Callers outside the scope need
  public. Note: on some instances this field can only be flipped in the UI, not via the
  agent API (verify on your instance first).
- **Kernel rule — always call scoped Script Includes with the full `api_name`
  including the scope prefix** (`x_acme_fm.CaseUtil`), from anywhere — including inside
  the same scope and inside ACL scripts. Without the prefix: silent failure.

```javascript
// From any scope:
var util = new x_acme_fm.CaseUtil(); // example
var result = util.createCase('Name', 'Desc');
```

`GlideScopedEvaluator` exists for evaluating script fields across scopes, but for normal
cross-scope calls a public Script Include invoked via full api_name is the pattern.

## Cross-scope table access

Access to another scope's tables is governed by that table's application-access settings
(Can read / create / update / delete, "Accessible from"). Check before assuming:

```javascript
var gr = new GlideRecord('x_other_app_table'); // example
if (!gr.isValid()) {
    gs.error('No access to x_other_app_table from this scope');
    return;
}
gr.addQuery('active', true);
gr.query();
```

`isValid()` false means the table doesn't exist *or* this scope can't see it — the
failure is otherwise silent, in line with the platform's general silent-failure habit
(see the wiki's gotchas page).

## Scope fences to expect (verify on your instance first)

Scoped scripts are sandboxed harder than global ones. Fences commonly hit in practice:

- `gs.setProperty` — a scoped script can generally only write properties belonging to
  its own scope.
- `gs.eventQueue` / scheduled event helpers — event registration and queueing can be
  fenced to the owning scope.
- `gs.sleep` and other java-backed helpers — global-scope only.

When a scoped script needs a fenced operation, the usual answers are: own-scope
equivalents (properties named `x_acme_fm.*`, events registered in the app), or a small
public global Script Include that performs the one fenced operation.

## Application properties

```javascript
// Property record: name 'x_acme_fm.default_priority' (example), created inside the app
var defaultPriority = gs.getProperty('x_acme_fm.default_priority', '3');
```

Give every property a default value (second argument AND on the record), and prefix all
property names with the scope. Add a "Properties" module in the app menu filtered on the
scope prefix so admins can find them.

## Scripted REST API (inbound)

A scoped app's REST APIs live under its namespace: `/api/x_acme_fm/cases` (example).

```javascript
// Resource script — GET /api/x_acme_fm/cases (example)
(function process(request, response) {
    var out = [];
    var gr = new GlideRecord('x_acme_fm_case'); // example
    gr.addQuery('active', true);
    gr.query();
    while (gr.next()) {
        out.push({
            sys_id: gr.getUniqueValue(),
            name: gr.getValue('name'),
            state: gr.getValue('state')
        });
    }
    response.setBody({ result: out, count: out.length });
})(request, response);
```

For *outbound* REST from the app, see the rest-integration skill.

## Dependencies

Declare plugin/app dependencies on the application record rather than relying on them
implicitly, and guard optional integrations in code:

```javascript
if (GlidePluginManager.isActive('com.snc.some_plugin')) { // example plugin id
    // safe to use that plugin's API
}
```

## Packaging / publishing checklist

- ACLs exist for every app table (see the acl-security skill).
- No hardcoded sys_ids — use properties or lookups; instance-specific sys_ids belong in
  the wiki's registry-sys-ids page, not in shipped script.
- No hardcoded instance URLs.
- All dependencies declared; properties have defaults.
- No stray global-scope modifications riding along.
- Deployment tested on a clean instance; semantic versioning (major.minor.patch).

## Common mistakes

| Mistake | Problem | Fix |
|---|---|---|
| Passing the scope *name* to `create_artifact` | Wrong/failed scope attribution | Scope **sys_id** from the registry page — kernel rule |
| Skipping the application switch | Silent no-op "success" | Dual `switch_context`, then read-back |
| Cross-scope change in the wrong update set | Change doesn't ship | Same-named update set in that scope |
| Calling a scoped SI without its scope prefix | Silent failure | Full `api_name` always |
| Global modifications inside an app story | Won't deploy cleanly | Keep changes in scope; where unavoidable, separate same-named global set |
| Hardcoded sys_ids in script | Breaks on other instances | Properties / lookups |
| Missing ACLs on app tables | Data exposure | ACL per table before go-live |
| Assuming global APIs work in scope | Runtime scope-fence errors | Check the fences list above; test in-scope early |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
