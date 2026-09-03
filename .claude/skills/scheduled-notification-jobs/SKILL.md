---
name: scheduled-notification-jobs
description: Invoke when a notification must fire on a date/time condition rather than a record change — "scheduled notification", "due date reminder", "deadline notification", "gs.eventQueue scheduled", "daily reminder email", "fire event from script", "notification without record change".
---

# Scheduled Notification Jobs — Event-Based Reminders

The pattern for notifications driven by **time conditions** ("7 days before due date") where no record change exists to trigger on. Examples use the placeholder scope `x_acme_fm` and table `x_acme_fm_case` — substitute your project's values.

## When to use this pattern

**Use this when:**
- A notification must fire X days before/after a date field
- Nothing changes on the record at the moment the mail should go out
- You need a daily/weekly/periodic sweep against date conditions

**Do NOT use this when:**
- The trigger is a state change → `generation_type=engine` with filter conditions (see the `notification-design` skill)
- The trigger is a field assignment → `generation_type=engine`

## Architecture

```
Scheduled Job (sysauto_script) — runs daily
    │
    ├── Queries records matching the date condition
    │
    └── For each match: gs.eventQueue('<scope>.<process>.<what_happened>', grRecord, parm1, parm2)
            │
            ↓
        Event Queue (sysevent)
            │
            ↓
        Event Registry (sysevent_register) — documents the event
            │
            ↓
        Notification (sysevent_email_action, generation_type=event)
            └── Sends email to recipient_fields
```

## Why events (not a custom flag field)

Two candidate designs:

| Approach | How it works | Verdict |
|---|---|---|
| **Custom flag field** (`u_reminder_sent`) | Scheduled job flips the flag → flag change triggers a condition-based notification | Rejected: pollutes the schema, needs reset logic whenever the due date moves, adds a field for a single use case |
| **Event from scheduled job** | Scheduled job fires an event → event-based notification sends | Chosen: stateless, zero schema changes, re-evaluates naturally every day, clean separation of concerns |

## Artifacts to create

### 1. Event Registry Record (`sysevent_register`)

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sysevent_register",
    "scope": "x_acme_fm",
    "fields": {
      "event_name": "x_acme_fm.case.due_date_reminder",
      "suffix": "x_acme_fm_case",
      "name": "x_acme_fm.case.due_date_reminder",
      "description": "Fired daily by scheduled job 'ACME - Case due date reminder' when a case's due date is exactly 7 days away. Triggers the reminder notification to the assignee."
    }
  }
}
```

**Event naming convention:** `<scope>.<process>.<what_happened>` — e.g., `x_acme_fm.case.due_date_reminder`. Set BOTH `name` and `event_name`, and register the event in the **same scope as the script that fires it** (see the `notification-design` skill for both silent-failure modes).

The `description` field is critical — it is the only place documenting what fires this event and why. Name the scheduled job, state the condition, and name the notification it triggers.

### 2. Notification Record (`sysevent_email_action`)

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sysevent_email_action",
    "scope": "x_acme_fm",
    "fields": {
      "name": "ACME - Case due date reminder",
      "collection": "x_acme_fm_case",
      "generation_type": "event",
      "event_name": "x_acme_fm.case.due_date_reminder",
      "recipient_fields": "assigned_to",
      "subject": "Don't forget your case (${number})",
      "message_html": "<p>Dear ${assigned_to.first_name},</p><p>...</p>",
      "active": "true",
      "template": "<email_template_sys_id>",
      "weight": "0",
      "send_self": "false",
      "send_to_event_creator": "false"
    }
  }
}
```

**How this differs from a condition-based notification:**
- `generation_type` = `event` (not `engine` — the default; forget this and it never fires from the event)
- `event_name` = the registered event name
- No `action_insert` / `action_update` / `condition` needed — the event IS the trigger
- `${field}` references still resolve, because `gs.eventQueue` passes the GlideRecord

### 3. Scheduled Job (`sysauto_script`)

```javascript
// ACME - Case due date reminder
// Fires x_acme_fm.case.due_date_reminder for cases due in exactly 7 days.
(function() {
    var grCase = new GlideRecord('x_acme_fm_case');
    grCase.addQuery('active', true);
    grCase.addQuery('state', 'IN', '1,2'); // Open, Work in Progress (example values)
    grCase.addQuery('assigned_to', '!=', '');
    // due_date is exactly 7 days from now (start-of-day comparison)
    grCase.addQuery('due_date', '>=', gs.daysAgoStart(-7));
    grCase.addQuery('due_date', '<', gs.daysAgoStart(-6));
    grCase.query();

    while (grCase.next()) {
        gs.eventQueue(
            'x_acme_fm.case.due_date_reminder',
            grCase,
            grCase.getValue('assigned_to'),
            grCase.getUniqueValue()
        );
    }
})();
```

**Design decisions baked into this script:**

1. **Exactly 7 days out, not "within 7 days".** A daily run combined with an exact-day match is a stateless one-time reminder — no flag field. If the due date is pushed out, the reminder fires again on the new correct day; if it is pulled closer, no duplicate, because the 7-days-out moment already passed.

2. **`gs.daysAgoStart(-7)` / `gs.daysAgoStart(-6)`** bound a single 24-hour window: "the day exactly 7 days from today". `daysAgoStart(-7)` is the start of the day 7 days ahead.

3. **`getUniqueValue()` not `.sys_id`** — the GlideRecord best practice for reading sys_ids.

4. **Filter to live records.** Add `active`, `state`, and any type filters so reminders never fire for closed or cancelled records.

5. **Event parms:** `parm1` = assignee sys_id, `parm2` = record sys_id. Available in the notification as `${event.parm1}` / `${event.parm2}`, though usually unnecessary since `${assigned_to}` and `${sys_id}` already resolve from the record.

## Scheduled Job Configuration

| Field | Value (example) |
|---|---|
| Name | `ACME - Case due date reminder` |
| Run | Daily |
| Time | 07:00 (before the workday starts) |
| Active | true |
| Run as | System (or an appropriate service account) |

Create via the agent API:
```json
{
  "command": "create_artifact",
  "params": {
    "table": "sysauto_script",
    "scope": "x_acme_fm",
    "fields": {
      "name": "ACME - Case due date reminder",
      "script": "(function() { ... })();",
      "active": "true",
      "run_type": "daily",
      "run_time": "07:00:00"
    }
  }
}
```

## Date query patterns for scheduled jobs

| Scenario | Query |
|---|---|
| Due in exactly 7 days | `due_date>=gs.daysAgoStart(-7)^due_date<gs.daysAgoStart(-6)` |
| Due today | `due_date>=gs.beginningOfToday()^due_date<gs.endOfToday()` |
| Overdue (past due) | `due_date<gs.beginningOfToday()` |
| Due within next 3 days | `due_date>=gs.beginningOfToday()^due_date<gs.daysAgoStart(-3)` |
| Due in exactly N days | `due_date>=gs.daysAgoStart(-N)^due_date<gs.daysAgoStart(-(N-1))` |

## Deduplication strategies

| Strategy | How | When to use |
|---|---|---|
| **Exact-day match** (recommended) | Query only records whose date is exactly N days out | Daily job, one-time reminder. Stateless. |
| **Flag field** | Set `u_reminder_sent=true` after firing | Only when you need an "at most once" guarantee independent of job frequency. Requires reset logic. |
| **Event history check** | Query `sysevent` for prior events before firing | Complex and fragile. Avoid. |

**Exact-day match is almost always right.** Stateless, no schema changes, and it handles due-date changes on the source record for free.

## Common Pitfalls

| Pitfall | What happens | Prevention |
|---|---|---|
| "Within 7 days" instead of "exactly 7 days" | Reminder fires every day for a week | Use the exact-day start-of-day range query |
| Custom flag field for deduplication | Schema pollution plus reset logic | Exact-day match is naturally deduplicated |
| Not filtering active/open records | Reminders fire for closed/cancelled records | Always add `active=true` + open-state filters |
| Running the job too frequently | Multiple events per record per day | Daily is enough for date-based reminders |
| Undocumented event registry | The next developer can't find what fires the event | Fill `description` with the job name and condition |
| Reading `.sys_id` directly in the script | Against GlideRecord best practices | Use `getUniqueValue()` |
| Hardcoding the days-before value | Threshold changes need a code change | Consider a system property for the threshold (nice-to-have) |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
