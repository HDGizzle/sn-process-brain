---
name: sla-management
description: This skill should be used when the user asks to "create SLA", "service level agreement", "SLA definition", "SLA workflow", "task SLA", "breach", "response time", "resolution time", "Breach on Due Date", "relative duration", "due date SLA", or any ServiceNow SLA Management development.
---

# SLA Management

ServiceNow SLA Management attaches measurable service commitments (response time,
resolution time, deadline compliance) to Task-extending records and tracks whether
they are met.

## Components

| Component      | Table          | Role                                          |
| -------------- | -------------- | --------------------------------------------- |
| SLA Definition | `contract_sla` | The rule: conditions, target, schedule        |
| Task SLA       | `task_sla`     | One running instance attached to one task     |
| SLA Workflow   | `wf_workflow`  | Warning/breach automation on the task_sla     |
| Schedule       | `cmn_schedule` | Business-hours calendar the timer counts in   |

## Lifecycle

1. A task is created or updated and matches an SLA definition's **start condition**.
2. The engine inserts a `task_sla` instance and starts the timer (counting only
   inside the attached schedule, if any).
3. The instance moves through stages — In Progress, optionally Paused, then either
   **Achieved** (stop condition met before the target) or **Breached**.
4. Cancel conditions end the instance without recording a breach.

## Creating an SLA Definition

Key `contract_sla` fields:

| Field | Meaning |
| --- | --- |
| `name` | Follow your project prefix convention, e.g. `ACME - Case Resolution 8h` (example) |
| `type` | SLA, OLA, or UC |
| `collection` / `table` | Table the definition attaches to, e.g. `x_acme_fm_case` (example placeholder) |
| `duration_type` | Empty = user-specified duration; otherwise a **relative duration** record (see below) |
| `duration` | ISO 8601 duration when user-specified, e.g. `PT15M`, `P3D` |
| `start_condition` | Encoded query — when the timer attaches and starts |
| `stop_condition` | Encoded query — when the commitment counts as met |
| `pause_condition` | Encoded query — timer suspends while true |
| `cancel_condition` | Encoded query — instance ends, no breach recorded |
| `schedule` | Reference to `cmn_schedule` for business-hours counting |
| `retroactive` | Whether the timer backdates its start (`retroactive_pause` related) |
| `active` | Enable/disable |

Prefer creating definitions through the agent API (`create_artifact` on
`contract_sla`, with the dual scope/update-set context switch your project mandates)
or the SLA Definition form; a background-script insert also works:

```javascript
// Global-scope background script — Rhino, ES5 only (var, no arrow functions)
var slaDef = new GlideRecord("contract_sla");
slaDef.initialize();
slaDef.setValue("name", "ACME - P1 Case Response 15m"); // example
slaDef.setValue("type", "SLA");
slaDef.setValue("collection", "x_acme_fm_case"); // example placeholder table
slaDef.setValue("duration", "PT15M"); // user-specified, ISO 8601
slaDef.setValue("start_condition", "priority=1^active=true");
slaDef.setValue("stop_condition", "state=6^ORstate=7");
slaDef.setValue("pause_condition", "state=3");
slaDef.setValue("cancel_condition", "state=8");
slaDef.setValue("active", true);
slaDef.insert();
```

Read back the inserted record and confirm the condition strings — condition fields
accept any text, and a typo'd field name in an encoded query filters nothing while
reporting no error.

### Condition semantics

- **Start**: the moment the instance attaches. Keep it tight — every matching
  update spawns evaluation.
- **Stop**: what "met" means. Response-style SLAs often stop on a first-touch
  signal (e.g. a journal entry appearing); resolution-style SLAs stop on terminal
  states.
- **Pause**: external-wait states (on hold, awaiting caller). Paused time does not
  count against the target.
- **Cancel**: abandonment paths (cancelled, duplicate) — ends the clock without a
  breach statistic.

## Pattern: Breach on Due Date (relative duration)

When the deadline lives on the task itself (a per-record `due_date` planned by the
user), do **not** model it as a fixed duration. Use a **relative duration**: set
`duration_type` to the OOTB relative duration **"Breach on Due Date"** (OOTB —
verify the record exists on your instance) instead of filling `duration`.

Behavior and guards:

- The instance's planned end **is the task's `due_date`**. Replanning the due date
  moves the breach point with it — no definition change needed.
- The definition carries **no `duration` value**; the relative-duration script
  computes the target per instance.
- **Always guard the start condition with `due_dateISNOTEMPTY`** (plus whatever
  business filter selects the right records). Without the guard, a record with an
  empty due date attaches an SLA that breaches immediately.
- A plain `active=false` stop condition is usually right: the commitment is met
  when the task closes, whenever that is relative to the due date.
- Decide `retroactive` deliberately. `retroactive=false` is the safe default here —
  backdating a due-date-target SLA can mark historical records breached the moment
  the definition activates.
- When you replace a fixed-duration definition with a relative-duration one,
  deactivate the old definition and rename it with a deprecation marker rather
  than deleting it — existing `task_sla` rows still reference it.

## Pattern: never parse workspace display dates client-side

Configurable-workspace client scripts receive date fields in the **user's display
format** (e.g. `dd-MM-yyyy`), which `new Date(value)` cannot parse reliably —
client-side date comparison silently produces wrong results per locale. Delegate
every date comparison to a client-callable Script Include and let `GlideDateTime`
parse on the server:

```javascript
// onChange client script on due_date (workspace) — example, ES5
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
  if (isLoading || newValue === "" || oldValue === newValue) {
    return;
  }

  // Display-format value → compare SERVER-side, never new Date(newValue)
  var dateCheck = new GlideAjax("x_acme_fm.CaseUtilAjax"); // full api_name incl. scope prefix — required
  dateCheck.addParam("sysparm_name", "isDueAfterParent");
  dateCheck.addParam("sysparm_parent", g_form.getValue("parent"));
  dateCheck.addParam("sysparm_due_date", newValue);
  dateCheck.getXMLAnswer(function (isAfter) {
    if (isAfter === "true") {
      g_form.setValue("due_date", oldValue); // revert the edit
      // Prefer a top error banner; showFieldMsg has proven unreliable in
      // workspace forms (verify on your instance first)
      getMessage("<namespace>.case.due_after_parent", function (msg) {
        g_form.addErrorMessage(msg);
      });
    }
  });
}
```

Server side, the Ajax method converts both values with `GlideDateTime` (or
`GlideDate`) and returns `"true"`/`"false"` as a string.

Layer the enforcement — the client guard is UX only:

| Layer | Artifact | Purpose |
| --- | --- | --- |
| Server safety net | before insert/update Business Rule with `setAbortAction(true)` | Real enforcement — also catches list edits, API writes, and integrations |
| Live form guard | onChange client script (pattern above) | Immediate feedback, reverts the field |
| Mandatory rule | UI policy (with `reverse_if_false`) | Ensures the date is filled where the business requires it |

Use the same translated message key (`getMessage` client-side,
`gs.getMessage` in the BR) so both layers speak with one voice.

## Task SLA operations

### Query instances on a task

```javascript
var taskSla = new GlideRecord("task_sla");
taskSla.addQuery("task", taskSysId);
taskSla.query();
while (taskSla.next()) {
  gs.info(taskSla.sla.getDisplayValue() +
    " | stage=" + taskSla.stage.getDisplayValue() +
    " | breached=" + taskSla.getValue("has_breached") +
    " | planned_end=" + taskSla.getValue("planned_end_time"));
}
```

### Status helper (Script Include shape)

Useful fields per instance: `stage`, `has_breached`, `percentage`,
`planned_end_time`, `business_time_left`. An at-risk check is typically
`percentage >= 75 && has_breached != "true"`. Compute remaining time with
`GlideDateTime.subtract(now, plannedEnd)` rather than client-side math.

### Pause / resume

Prefer driving pause through the definition's `pause_condition` — the engine
handles pause bookkeeping. Only manipulate `task_sla.pause` directly for targeted
repairs, and verify the write with a read-back (the platform reports success even
when an engine rejects the change).

## Breach automation

Attach a workflow (or Flow) to the definition to act before/at breach:

- **Warning stage** (e.g. 75%): notify the assignee — the goal is preventing the
  breach, not documenting it.
- **Breach**: notify assignee + assignment-group manager, optionally escalate
  (raise priority, set the task `escalation` field, add a work note via direct
  journal assignment — `task.work_notes = text`, never `setValue` on a journal
  field).
- Fire notifications through `gs.eventQueue("<namespace>.sla.breach", task, parm1, parm2)`
  with a registered event and an event-based notification, rather than emailing
  from the workflow script directly.

## Compliance reporting

```javascript
// Compliance rate for one definition in a window — GlideAggregate on task_sla
function getComplianceRate(slaName, startDate, endDate) {
  var agg = new GlideAggregate("task_sla");
  agg.addQuery("sla.name", slaName);
  agg.addQuery("end_time", ">=", startDate);
  agg.addQuery("end_time", "<=", endDate);
  agg.addQuery("active", false); // completed instances only
  agg.addAggregate("COUNT");
  agg.groupBy("has_breached");
  agg.query();

  var total = 0, breached = 0;
  while (agg.next()) {
    var count = parseInt(agg.getAggregate("COUNT"), 10);
    total += count;
    if (agg.getValue("has_breached") === "true") breached = count;
  }
  if (total === 0) return { compliance: 100, total: 0, breached: 0 };
  return {
    compliance: Math.round(((total - breached) / total) * 1000) / 10,
    total: total,
    achieved: total - breached,
    breached: breached
  };
}
```

## Practices

1. Self-describing names with your project prefix: `ACME - P1 Response 15m` (example).
2. Attach a schedule unless the commitment genuinely runs 24/7.
3. Model external waits as pause conditions, not stop conditions.
4. Warn before breach; escalation after breach is damage control.
5. For per-record deadlines, use the Breach-on-Due-Date relative-duration pattern —
   never clone fixed-duration definitions per deadline.
6. Never compare dates in workspace client scripts — delegate to a server SI.
7. Match the JavaScript level to the scope you are writing in: global-scope Rhino
   artifacts are ES5; scoped apps may support modern JS.
8. Verify every definition and condition string with a read-back after writing —
   invalid encoded-query fields are silently ignored.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
