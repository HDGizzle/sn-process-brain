---
name: approval-workflows
description: Invoke when the user mentions "approval", "approval rule", "approval workflow", "approver", "approval group", "multi-level approval", "delegate approval", "sysapproval", or when building or debugging any ServiceNow approval configuration or approval scripting.
---

> ⚠️ Rebuilt from unverified reference material — verify each pattern on your instance before relying on it.

# Approval Workflows

Approvals route a record through one or more sign-off gates before it proceeds. The engine is table-driven: rules (or a flow) generate individual approval records, users act on those, and the parent record's `approval` field is rolled up from the results.

**Modern default:** for new development, generate approvals from Flow Designer ("Ask for Approval" action) rather than legacy `sysapproval_rule` records — see the `flow-designer` skill. The table architecture below applies either way, because both engines write to the same `sysapproval_*` tables.

## Architecture

```
Parent record (change_request, sc_req_item, x_acme_fm_case, ...)
    → rule / flow decides who must approve
    → sysapproval_approver rows created (state = requested)
    → users approve/reject
    → parent .approval field rolled up; process continues or stops
```

## Key tables

| Table | Purpose |
|---|---|
| `sysapproval_approver` | One row per individual approval decision |
| `sysapproval_group` | Group-approval configuration (any / all / N-of-group) |
| `sysapproval_rule` | Legacy declarative approval rules |
| `sys_user_delegate` | Out-of-office delegation (approvals flag) |

## ES level

The examples below are written ES5-safe so they run in any scope. In a scoped app with ES12 mode enabled, modern syntax is fine — match the JavaScript mode of the artifact you are editing. See the `es5-compliance` skill for the per-scope rules and the ES12 deploy toggle gotcha.

## Approval rules (`sysapproval_rule`)

Fields that matter when creating a rule:

| Field | Meaning |
|---|---|
| `name`, `table`, `active`, `order` | Identity; lower `order` evaluates first |
| `conditions` | Encoded query — when the rule applies |
| `approver` | Who: `manager`, `user`, `group`, or `script` |
| `approver_user` / `approver_group` | The specific user/group when applicable |
| `approval_type` | `and` (all must approve) vs `or` (any one suffices) |
| `wait_for` | Hold this level until the previous level completes |
| `script` | For `approver=script`: returns an array of user sys_ids |

Example script-based approver selection (tiered by cost — pattern, adapt fields to your table):

```javascript
(function getApprovers(current) {
    var approvers = [];
    var cost = parseFloat(current.getValue('estimated_cost')) || 0;
    var requester = current.requested_for.getRefRecord();

    if (requester.manager)
        approvers.push(requester.manager.toString());
    if (cost > 5000)
        approvers.push(lookupDirector(requester));   // your own helper
    if (cost > 25000)
        approvers.push(lookupVp(requester));

    return approvers;
})(current);
```

## Acting on approvals in script

### The journal-field trap (important)

`sysapproval_approver.comments` is a **journal field**. `setValue('comments', text)` posts **nothing, silently**. Use direct assignment:

```javascript
approval.comments = commentText;   // correct — journal fields only
approval.setValue('state', 'approved');  // normal fields: setValue as usual
```

### Processing a decision safely

Validate before writing — state must still be `requested`, and the acting user must be the approver or an active delegate:

```javascript
function processDecision(approvalSysId, decision, commentText) {
    var approval = new GlideRecord('sysapproval_approver');
    if (!approval.get(approvalSysId))
        return { success: false, message: 'Approval not found' };
    if (approval.getValue('state') !== 'requested')
        return { success: false, message: 'Already processed' };
    if (approval.getValue('approver') !== gs.getUserID() &&
        !isActiveDelegateFor(approval.getValue('approver')))
        return { success: false, message: 'Not authorized' };

    approval.setValue('state', decision);          // 'approved' | 'rejected'
    approval.comments = commentText;               // journal — direct assignment
    approval.update();
    return { success: true };
}
```

Prefer letting the platform engine (workflow/flow) roll up the parent's `approval` field. If you must roll up manually: query all `sysapproval_approver` rows for the parent — any `rejected` → rejected; else any `requested` → requested; else any `approved` → approved.

## Group approvals (`sysapproval_group`)

A `sysapproval_group` row links a parent record to an approving group with a threshold:

- `parent` — the record awaiting approval
- `group` — the approving `sys_user_group`
- `approval` — `any` / `all` / `specific_count` (+ `specific_count` value)

To check a threshold in script, `GlideAggregate` COUNT the `approved` rows on `sysapproval_approver` for that parent restricted to the group's members, and compare against the configured requirement.

## Delegation (`sys_user_delegate`)

A delegation row makes another user able to act on approvals during a window:

```javascript
function isActiveDelegateFor(originalApproverId) {
    var now = new GlideDateTime();
    var d = new GlideRecord('sys_user_delegate');
    d.addQuery('user', originalApproverId);
    d.addQuery('delegate', gs.getUserID());
    d.addQuery('approvals', true);
    d.addQuery('starts', '<=', now);
    d.addQuery('ends', '>=', now);
    d.query();
    return d.hasNext();
}
```

Set `approvals=true` (and `assignments` independently) when creating delegations. Always time-bound them (`starts`/`ends`).

## Notifications

The platform ships an `approval.inserted` event/notification pair for new approvals; custom reminders can queue events against the approval record (`gs.eventQueue('<namespace>.approval.reminder', approval, approval.getValue('approver'), '')`). Design them with the `notification-design` skill; date-driven reminders belong in the `scheduled-notification-jobs` skill.

## Practices

1. Make rule conditions specific; overlapping rules with vague conditions create duplicate approvals.
2. Rule `order` matters — document the intended level sequence.
3. Plan for non-response: escalation via SLA or scheduled job, and delegation for out-of-office.
4. Never bulk-update approval states with `setWorkflow(false)` unless you intend to bypass the rollup engine — and say so explicitly.
5. Test every path: approve, reject, mixed group results, delegate acting, re-request after rejection.
6. All user-visible approval texts (notifications, comments templates) follow the project's translation setup — language pair per `product.config.json` (`language.source`/`targets`).

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
