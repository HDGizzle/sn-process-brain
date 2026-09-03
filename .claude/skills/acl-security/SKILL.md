---
name: acl-security
description: Invoke when the user asks to "create ACL", "access control", "security rule", "restrict access", "row level security", "field level security", "role based access", or when building or debugging any ServiceNow ACL or security configuration.
---

# ACL Security Patterns for ServiceNow

Access Control Lists (`sys_security_acl`) are ServiceNow's authorization layer: they decide per user whether a record can be read, written, created, or deleted, and whether an individual field is visible or editable. Everything else (UI policies, client scripts, view rules) is cosmetic — only ACLs actually enforce.

## How ACLs Evaluate

### Specificity: first match wins per operation

For a given operation the engine walks from most specific to least specific and stops at the first level where matching ACLs exist:

1. `table.field` — field ACL on the exact table (e.g. `incident.assignment_group`)
2. `table.*` — field wildcard on the table
3. `table` — record-level ACL
4. Parent-table ACLs — when the table extends another
5. `*` — the global catch-all

### OR within a level, AND across levels

Two rules govern how multiple ACLs combine — get these wrong and you will misdiagnose almost every access bug:

- **Within one level (same `name` + `operation`): OR.** If five ACLs exist on `x_acme_fm_case` / `read`, a user passes as soon as ANY ONE of them grants. You cannot "tighten" access by adding another ACL at the same level — a new grant only ever widens.
- **Within one ACL: AND.** Role list, condition, and script must ALL pass. The role list passes when the user holds any listed role; the condition and script then each get a veto.
- **Across levels: AND.** To see a field value the user must pass BOTH the field-level ACL and the record-level ACL. A field grant never overrides a record deny, and vice versa.

Practical consequence: a parallel custom ACL added next to an OOTB record ACL does not restrict anything — it only adds another OR-branch. To restrict, you must modify or deactivate the granting ACL.

## ACL Types

| Type | Controls | Example question |
| --- | --- | --- |
| **record** | Row-level access | May this user open this case at all? |
| **field** | Field-level access | May they see `assignment_group`? |
| **client_callable_script_include** | GlideAjax access | May they call this AJAX API? |
| **ui_page** | UI page access | May they load this page? |
| **rest_endpoint** | Scripted REST access | May they hit this endpoint? |

## Prefer Extending an OOTB ACL Over Adding a Parallel One

Before designing a new ACL, query the active ACLs already on the target `name` + `operation`:

```
query_records: sys_security_acl
query: name=x_acme_fm_case^operation=read^active=true
```

Pick the OOTB ACL whose condition already matches the rows your new persona should see, then **add your role to its role list and extend its script** (short-circuit pattern below). Only create a separate ACL when extension is genuinely impossible — e.g. the OOTB condition contradicts what the new persona needs.

Trade-off (make it consciously): a modified OOTB ACL surfaces as an explicit skipped/conflict item at the next platform upgrade — visible and reviewable. A parallel custom ACL upgrades silently but can drift away from the OOTB intent unnoticed, and because of OR-within-level it can quietly widen access. Prefer the visible conflict; document which OOTB ACLs you modified in your project's decision log.

### Short-circuit script pattern

When extending an OOTB ACL for an additional persona, keep the OOTB condition unchanged and make the script cheap for the existing audience — only the new persona pays for the expensive computed check. Example (all names are illustrative):

```javascript
// ACL script on x_acme_fm_case / read (extended OOTB ACL)
var currentUser = gs.getUser();
if (currentUser.hasRole('x_acme_fm.case_reader')) {
    answer = true;  // existing audience: unchanged, no extra cost
} else if (currentUser.hasRole('x_acme_fm.area_manager')) {
    // new persona: row-level computed visibility, delegated to a Script Include
    answer = new x_acme_fm.CasePersonaUtil().isCaseVisibleToAreaManager(current.getUniqueValue());
} else {
    answer = false;
}
```

Put row-level visibility logic in a Script Include boolean method (`is*Visible*`, `can*Write*`) rather than inlining it — multiple ACLs can then reuse the same logic and it stays testable. See the script-include-patterns skill.

## Platform Truths That Cost Real Debugging Time

- **`sys_idDYNAMIC<filterId>` does NOT work in ACL conditions — it silently denies** (verify on your instance first). Dynamic filter options work in ACLs only on reference fields (OOTB uses forms like `assigned_toDYNAMIC<criterionId>`); matching the record's own `sys_id` against a dynamic filter does not evaluate. For "does this record itself qualify for this user" logic, use an advanced script ACL calling a Script Include boolean method. The same `sys_filter_option_dynamic` records DO work fine for workspace list filtering — that is a separate consumer of the same table; success there proves nothing about ACL context.
- **Always use the full scoped `api_name` when calling a Script Include from an ACL script** — `new x_acme_fm.CasePersonaUtil()`, never `new CasePersonaUtil()`. This applies even when the ACL nominally lives in the same scope as the Script Include (and always when you extend an OOTB ACL in a scoped app). Without the prefix the call silently yields `undefined`, so the ACL denies with no error anywhere in the logs.
- **Verify every ACL mutation with a read-back.** Agent-API writes against `sys_security_acl` / `sys_security_acl_role` can silently no-op (wrong transaction scope, missing `security_admin` elevation in the session). After every `create_artifact` / `update_record` on these tables, query the record back and confirm `sys_updated_on` moved AND the changed field shows the new value. An API "success" response alone proves nothing.
- **ACL edits require `security_admin` elevation.** The platform enforces elevated privilege for `sys_security_acl` writes; a non-elevated session fails — sometimes with a generic internal error and no server-side log entry. Elevate first, then write, then read back.

## Common ACL Patterns

Illustrative examples — adapt table, field, and role names to your instance.

### 1. Role-based

Empty condition and script, role list only: any listed role grants.

### 2. Ownership-based

```javascript
// Condition:
current.caller_id == gs.getUserID() || current.assigned_to == gs.getUserID() || current.opened_by == gs.getUserID()
```

### 3. Group-based

```javascript
// Script:
answer = gs.getUser().getMyGroups().indexOf(current.assignment_group.toString()) >= 0;
```

Or, cheaper as a condition: `gs.getUser().isMemberOf(current.assignment_group)`.

### 4. Manager-chain

```javascript
// Script: grant if the current user sits anywhere in the caller's management chain
var mgr = current.caller_id.manager;
var me = gs.getUserID();
answer = false;
while (mgr && !mgr.nil()) {
    if (mgr.toString() == me) { answer = true; break; }
    mgr = mgr.manager;
}
```

### 5. Time-window

```javascript
// Script: business hours only (example: 08:00-18:00 local)
var hour = parseInt(new GlideDateTime().getLocalTime().getHourOfDayLocalTime(), 10);
answer = (hour >= 8 && hour < 18);
```

### 6. Data classification

```javascript
// Script: user clearance must meet or exceed record classification
var levels = { 'public': 0, 'internal': 1, 'confidential': 2, 'secret': 3 };
var classification = current.u_data_classification.toString();
var clearance = gs.getUser().getRecord().getValue('u_security_clearance');
answer = levels[clearance] >= levels[classification];
```

## Field-Level Security Patterns

```javascript
// Hide a sensitive field — ACL x_acme_fm_case.u_national_id / read:
answer = gs.hasRole('x_acme_fm.privacy_officer');

// Freeze a field after closure — ACL x_acme_fm_case.short_description / write:
answer = current.state < 6;

// Conditional visibility — ACL x_acme_fm_case.u_internal_notes / read (condition):
gs.hasRole('x_acme_fm.case_worker') || current.caller_id == gs.getUserID()
```

Remember AND-across-levels: a field-read grant is useless if the record-read ACL denies the row.

## Security Best Practices

1. **Least privilege.** An empty role list means every authenticated user passes the role check — always name roles explicitly.
2. **Deny by default.** Rely on the platform's default-deny plus explicit grants; never leave a custom table without ACLs, since inherited wildcards may be far more permissive than you intend.
3. **Conditions over scripts, scripts over queries.** ACLs run on every row render in a list — a script ACL that does a GlideRecord query multiplies into hundreds of queries per list load. Push logic into a condition where possible; if a script must query, delegate to a Script Include so the logic is shared and cacheable.
4. **Test as the target user, never as admin.** Admin bypasses ACLs entirely. Impersonate each persona and walk navigation, lists, forms, and related lists; confirm fields hide, buttons disable, and rows filter.
5. **Cover the APIs.** REST and GlideAjax paths enforce ACLs independently of the UI — a form that hides a field does not protect the Table API. Verify record and field ACLs hold for API access too.

## Debugging ACLs

- **Debug Security Rules** (`/ui_page.do?sys_id=debug_security` or the "Debug Security Rules" module) shows per-element ACL evaluation inline on forms and lists — which ACL matched, which part (role/condition/script) failed.
- **Programmatic check** from a background script:

```javascript
var gr = new GlideRecord('x_acme_fm_case');
gr.get('<sys_id>');
gs.info('read=' + gr.canRead() + ' write=' + gr.canWrite() + ' delete=' + gr.canDelete());
gs.info('field read=' + gr.assignment_group.canRead() + ' field write=' + gr.assignment_group.canWrite());
```

Combine with impersonation to test a specific persona — and if you impersonate inside a background script, log the session back out of the impersonation afterwards.

## Common Mistakes

| Mistake | Problem | Solution |
| --- | --- | --- |
| No ACLs on a custom table | Inherited/wildcard access far wider than intended | Create record + field ACLs at table creation time |
| Adding an ACL to *restrict* | OR-within-level: new ACLs only widen | Modify or deactivate the granting ACL instead |
| Role-only ACLs everywhere | No row-level segregation | Add conditions/scripts for data separation |
| GlideRecord queries in ACL scripts | Runs per row per list — severe slowdown | Conditions, or a shared Script Include |
| Testing as admin | Admin bypasses ACLs | Impersonate real personas |
| Unprefixed Script Include call in ACL script | Silent `undefined` → deny, no log | Always full `api_name` incl. scope prefix |
| Trusting the write API response | ACL writes can silently no-op | Read back: `sys_updated_on` moved + new value present |
| Forgetting REST/GlideAjax | UI-only thinking leaves API paths open | Verify ACLs against Table API and AJAX access |

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
