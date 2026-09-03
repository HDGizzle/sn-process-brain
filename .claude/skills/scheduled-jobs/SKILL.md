---
name: scheduled-jobs
description: Invoke when the user asks to "create scheduled job", "scheduled script", "cron job", "sysauto_script", "automation schedule", "recurring task", "batch processing", "nightly job", or any ServiceNow scheduled job development. For notifications that fire on a date/time condition, use the scheduled-notification-jobs skill instead.
---

# Scheduled Jobs (sysauto)

> ⚠️ **Resurrected reference — not instance-verified.** This skill was rewritten from an
> archived outline. The patterns below are standard platform behavior, but none of them
> carry this framework's "verified on a live instance" stamp — treat every field name and
> behavior claim as "(verify on your instance first)".

This is the **general** sysauto reference: job types, script structure, scheduling
fields, monitoring, and batch patterns. It complements the narrower
**scheduled-notification-jobs** skill — when the job's purpose is firing a notification
on a date/time condition (due-date reminders, deadline escalations), use that skill; it
carries the event-plus-notification wiring. Come here for everything else that runs on a
schedule.

## Job types

| Type | Table | Purpose |
|---|---|---|
| Scheduled Script Execution | `sysauto_script` | Run a custom server script on a schedule |
| Scheduled Report | `sysauto_report` | Generate and email reports |
| Table Cleaner | `sys_auto_flush` | Age-based record deletion per table/condition |
| LDAP Refresh | `ldap_server_config` | Periodic LDAP sync |
| Discovery Schedule | `discovery_schedule` | Network discovery runs |

Most custom work is `sysauto_script`. `sys_auto_flush` is worth remembering before
writing a hand-rolled cleanup job — a Table Cleaner row (table + matchfield + age in
seconds) does age-based purging with no code.

## JavaScript level

Do **not** assume "scheduled jobs = ES5 always." The script runs in the job's
application scope: global-scope jobs are ES5 (Rhino), while a job created in a scoped
app with modern-JS mode enabled may use ES12 syntax. **Match the scope you're writing
in** — full decision table in the es5-compliance skill. Examples below are ES5 so they
run anywhere.

## Script structure

Wrap the body in an IIFE, use a stable log prefix, and count what you did:

```javascript
// sysauto_script — Name: "ACME - Close stale cases" (example), run daily 02:00
(function executeScheduledJob() {
    var LOG_PREFIX = '[CloseStaleCases] ';
    var closedCount = 0;

    var staleDate = new GlideDateTime();
    staleDate.addDaysLocalTime(-30);

    var gr = new GlideRecord('x_acme_fm_case'); // example table
    gr.addQuery('state', 'IN', '1,2,3');
    gr.addQuery('sys_updated_on', '<', staleDate);
    gr.addQuery('active', true);
    gr.query();

    while (gr.next()) {
        gr.state = 7;
        gr.close_notes = 'Auto-closed after 30 days of inactivity';
        gr.update();
        closedCount++;
    }

    gs.info(LOG_PREFIX + 'Closed ' + closedCount + ' stale cases');
})();
```

### Error handling

Wrap the run in try/catch, count errors per record so one bad row doesn't kill the
batch, and surface failures somewhere a human will see them:

```javascript
(function executeScheduledJob() {
    var LOG_PREFIX = '[SyncUserData] ';
    var stats = { processed: 0, updated: 0, errors: 0 };

    try {
        var gr = new GlideRecord('sys_user');
        gr.addQuery('u_needs_sync', true); // example flag field
        gr.addQuery('active', true);
        gr.setLimit(1000); // batch cap
        gr.query();

        while (gr.next()) {
            stats.processed++;
            try {
                if (syncOne(gr)) {
                    stats.updated++;
                }
            } catch (e) {
                stats.errors++;
                gs.error(LOG_PREFIX + 'Failed for ' + gr.getValue('user_name') + ': ' + e.message);
            }
        }
        gs.info(LOG_PREFIX + 'Done: ' + JSON.stringify(stats));

        if (stats.errors > 0) {
            gs.eventQueue('acme.job.errors', null, JSON.stringify(stats), ''); // example event
        }
    } catch (e) {
        gs.error(LOG_PREFIX + 'Job failed: ' + e.message);
        gs.eventQueue('acme.job.failure', null, e.message, ''); // example event
    }

    function syncOne(userGr) {
        userGr.u_needs_sync = false;
        userGr.u_last_sync = new GlideDateTime();
        return userGr.update();
    }
})();
```

### Batch processing with a time budget

Long-running jobs should self-limit and pick up where they left off, driven by a
"processed" marker on the data rather than in-memory state:

```javascript
(function executeScheduledJob() {
    var LOG_PREFIX = '[BatchProcessor] ';
    var BATCH_SIZE = 500;
    var MAX_RUNTIME_MS = 3600000; // 1 hour
    var startTime = new Date().getTime();
    var processed = 0;

    var hasMore = true;
    while (hasMore && (new Date().getTime() - startTime) < MAX_RUNTIME_MS) {
        hasMore = processBatch();
    }

    if (hasMore) {
        gs.warn(LOG_PREFIX + 'Stopped at time budget after ' + processed + ' records; remainder next run');
    } else {
        gs.info(LOG_PREFIX + 'Complete: ' + processed + ' records');
    }

    function processBatch() {
        var gr = new GlideRecord('x_acme_fm_case'); // example table
        gr.addQuery('u_processed', false);          // example marker field
        gr.setLimit(BATCH_SIZE);
        gr.query();
        if (!gr.hasNext()) {
            return false;
        }
        while (gr.next()) {
            gr.u_processed = true;
            gr.u_processed_on = new GlideDateTime();
            gr.update();
            processed++;
        }
        return true;
    }
})();
```

Because the marker lives on the data, the next scheduled run naturally continues the
remainder — no continuation-job re-queuing needed.

### Conditional execution

`sysauto_script` has a **Conditional** checkbox + condition script; alternatively guard
in the script body (business-hours windows, change-freeze checks) and `return` early
with an info log so skipped runs are visible in the logs.

## Schedule configuration

Key `sysauto_script` fields: `run_type` (daily / weekly / monthly / periodically /
once / on demand / business calendar variants), `run_time`, `run_dayofweek`,
`run_period` (for periodically), `conditional` + `condition`, `run_as`, `active`.
(Field values vary slightly by release — verify on your instance first.)

| Need | run_type | Notes |
|---|---|---|
| Every N minutes/hours | periodically | `run_period` holds the interval |
| Nightly | daily | `run_time` e.g. 02:00:00 — schedule off-peak |
| Weekly | weekly | `run_dayofweek` |
| Monthly | monthly | day-of-month field |
| Manual/testing | on demand | run via "Execute Now" |

`run_as` empty = system user. Setting a user changes session context, impersonation
rules, and which ACLs apply inside the job — leave empty unless the job must act as a
specific user.

### Programmatic creation

```javascript
// ES5 — background script / fix script (example)
var job = new GlideRecord('sysauto_script');
job.initialize();
job.setValue('name', 'ACME - Nightly cleanup'); // example, use the project record prefix
job.setValue('active', true);
job.setValue('run_type', 'daily');
job.setValue('run_time', '02:00:00');
job.setValue('script', '(function executeScheduledJob() {\n    // body\n})();');
job.setValue('run_as', ''); // system
job.insert();
```

Framework doctrine applies: create the job in the correct application scope, in the
story-named update set, and verify capture afterward (update-set-workflow skill). A job
belonging to a scoped app must be created while that app is the current application —
via the agent API that means the **dual switch_context** rule from the wiki's hard-rules
page.

## Testing and monitoring

- **Test the body first**: run the script content as a background script (or fix
  script) before wiring it to a schedule — faster loop, visible output.
- **Execute Now**: the UI action on the job record runs it once immediately.
- **`sys_trigger`** is the runtime queue: one row per scheduled execution with
  `next_action` (when it fires next) and `state`. If a job "never runs", look here
  first — a missing/parked trigger row is the usual cause.

```javascript
var trig = new GlideRecord('sys_trigger');
trig.addQuery('name', 'CONTAINS', 'Nightly cleanup');
trig.orderByDesc('sys_created_on');
trig.setLimit(10);
trig.query();
while (trig.next()) {
    gs.info(trig.getValue('name') + ' | state=' + trig.getValue('state') +
        ' | next=' + trig.getValue('next_action'));
}
```

- **Metrics**: for jobs where run history matters, write a summary row per run (job
  name, start/end, records processed, errors) to a small custom log table, in addition
  to `gs.info`. Syslog rotates; your metrics table doesn't.

## Best practices

1. **Idempotent** — safe to run twice; drive continuation off data markers, not memory.
2. **Batch + time budget** — never let one run grow unbounded with the data.
3. **Off-peak scheduling** — heavy jobs at night, staggered so they don't stack.
4. **Log prefix + counters** — every run leaves a one-line summary in syslog.
5. **Per-record try/catch** — one poisoned row must not abort the batch.
6. **Surface failures** — fire an event / notification on errors; nobody reads syslog daily.
7. **Table Cleaner before custom cleanup code** — `sys_auto_flush` may already do it.
8. **Right skill for the job** — date-driven notifications belong to the
   scheduled-notification-jobs skill, not a hand-rolled sysauto_script.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
