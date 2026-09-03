---
name: notification-design
description: This skill should be used when the user asks to "create notification", "email notification", "sysevent_email_action", "notification design", "notification conditions", "translated notification", "email template", "email script", "notification recipient", "OOTB notification", "notification collision", "GDPR email", "privacy-sensitive email", "workspace link email", "generation_type", "event", "sysevent", "gs.eventQueue", "event-based notification", or any ServiceNow notification design, triggering, and implementation.
---

# Notification Design — Definitive Guide

Design and build ServiceNow email notifications: choosing the trigger mechanism, avoiding duplicate-mail collisions, translations, body/recipient design, and the event-based variant. All examples use the placeholder scope `x_acme_fm` and table `x_acme_fm_case` — substitute your own project's values.

## CRITICAL DECISIONS — READ FIRST

### 1. Condition-based is the modern standard — events are the exception

`generation_type` on `sysevent_email_action` controls how the notification fires:

| Value | Label | When to use |
|---|---|---|
| `engine` | Record inserted or updated | **Default for 95% of notifications.** The record change itself is the trigger; filter conditions do the rest. |
| `event` | Event is fired | **Only** when no record change exists to hook onto (scheduled reminders, cross-record aggregations). |
| `triggered` | Triggered | Fired programmatically through the Notification API. Rare. |

Reasons to prefer condition-based:
- The entire trigger definition sits on the notification record — one place to read, one place to debug.
- No supporting artifacts needed (no event registration, no Business Rule calling `gs.eventQueue`).
- The filter builder's `VALCHANGES` / `CHANGESFROM` / `CHANGESTO` operators cover every state-transition case.
- Advanced (scripted) conditions are almost never required.

Reach for events **only** when nothing changes on the record at send time — the canonical case is a scheduled job firing reminders as a date field approaches (see the `scheduled-notification-jobs` skill).

### 2. Check for OOTB notification collisions BEFORE creating anything

List what already fires on your target table:
```
sysevent_email_action.collection = <your_table>
```

Out-of-the-box notifications frequently ship with broad conditions (for example `assigned_toVALCHANGES` with no further filter). Add your own notification with an overlapping trigger and recipients receive **two emails** per change.

**Resolution: deactivate the OOTB record; do not edit it.** Editing OOTB artifacts invites upgrade conflicts; deactivation is clean and reversible.

### 3. Simple state changes never need an advanced condition

The filter-builder operators express nearly everything:

| Intent | Encoded query syntax | Meaning |
|---|---|---|
| Changes | `stateVALCHANGES` | State changed, any direction |
| Changes to | `state=3^stateVALCHANGES` | State changed AND now equals 3 — this IS changesTo(3) |
| Changes from | `stateCHANGESFROM6` | State was 6 before this update |
| Combined | `state=2^stateCHANGESFROM6` | Specifically 6 → 2 |

**`state=3^stateVALCHANGES` is exactly `changesTo(3)`.** Skip the script.

### 4. Translated notifications require a plugin

The "Translated Notifications" related list on `sysevent_email_action` only exists when the **Glide Notification Translation** plugin (`com.glide.notification.translation`) is active. Verify before planning any multilingual build:
```
v_plugin.id = com.glide.notification.translation
```

If the plugin is **not** active, the options are:
- A: request plugin activation (platform admin needed),
- B: build in the primary language only,
- C: duplicate every notification with `preferred_language` advanced conditions (ugly — doubles the artifact count).

**Known issue KB1289001 (verify on your instance first):** static translations can fail when the notification also uses an email template (`sysevent_email_template`). Test one notification + one translation before building the full set; if broken, the workaround is placing translated content directly in the notification body instead of relying on the template.

Pattern when the plugin IS active:
- Parent notification carries the source language (subject + `message_html`) — use your project's `language.source` from `product.config.json`.
- One child record per target language in the "Translated Notifications" related list, each with its own subject + body.
- At send time the platform resolves recipient → `sys_user.preferred_language` → matching translation, falling back to the parent when none matches.

### 5. Email templates own the layout — you supply only body content

When the notification references a `sysevent_email_template` (its `template` field), the template renders header/branding, borders, and footer. Your `message_html` starts at the greeting. Never duplicate layout markup in the body.

---

## Designing Notification Bodies

### Field references in notification HTML

```html
<!-- Direct fields on the current record -->
${short_description}
${number}
${due_date}
${state}

<!-- Dot-walked references (one level) -->
${assigned_to.first_name}     <!-- Greeting: "Dear Alex" -->
${assigned_to.name}           <!-- Full name -->
${parent.number}              <!-- Parent record's number -->
${parent.assigned_to}         <!-- Parent's assignee, display value -->

<!-- Dot-walked references (two levels) -->
${parent.parent.number}
${parent.parent.short_description}
${parent.parent.assigned_to}

<!-- Journal fields -->
${work_notes}                 <!-- Update-triggered notification: renders the LATEST entry only -->
${comments}                   <!-- Same behavior -->
```

**Journal field behavior:** on an update-triggered notification, `${work_notes}` renders only the entry added during that update, not the full history. This pairs naturally with conditions on state changes that require a mandatory work note.

### Links in notification bodies — workspace URLs

Use **relative paths** beginning with `/now/`. The email engine prepends the instance URL, so the same notification works in every environment (dev resolves to dev, prod to prod).

```html
<!-- Workspace link (environment-agnostic) — example -->
<a href="/now/<workspace-route>/record/x_acme_fm_case/${sys_id}">
  View the case in ServiceNow
</a>

<!-- DO NOT hardcode the instance -->
<!-- BAD: <a href="https://acmedev.service-now.com/now/..."> -->
```

The workspace app route must match the `sys_ux_app_route` of your workspace — query that table when unsure.

**Classic UI fallback:** `${URI_REF}` renders a full classic-UI link; use it only when workspace is not the primary UI.

### GDPR / privacy considerations

When recipients have **different access levels**, split the notification per audience and control what each body exposes:

```
Task assigned → case manager (CAN see the parent case)
  → Body may include: case number, description, category, case owner

Task assigned → external/limited assignee (CANNOT see the parent case)
  → Body includes: task description, task number, contact person's name
  → NO case number, NO case description, NO case category
```

**Never assume a dot-walk is safe.** If `${parent.parent.short_description}` can contain privacy-sensitive content, it must not appear in mail sent to recipients who cannot read that record.

If a later change request asks to add previously restricted information, get explicit sign-off that the privacy requirement itself has changed before implementing.

### Body structure patterns (examples)

**Recipient CAN see the parent record:**
```html
<p>Dear ${assigned_to.first_name},</p>
<p>[Action sentence]. The <b>target date</b> is ${due_date}.</p>
<p><a href="/now/[workspace-route]/record/[table]/${sys_id}">View in ServiceNow</a></p>
<hr/>
<p>The case (${parent.number}) this task belongs to:</p>
<p>
  <b>Case type</b>: ${parent.category}<br/>
  <b>Short description</b>: ${parent.short_description}<br/>
  <b>Case owner</b>: ${parent.assigned_to}
</p>
<hr/>
<p>Contact the case owner if you have any questions.</p>
<p>Kind regards,<br/>The ACME team</p>
<p><i>This email was sent automatically, you cannot reply to it.</i></p>
```

**Recipient CANNOT see the parent record (privacy-restricted):**
```html
<p>Dear ${assigned_to.first_name},</p>
<p>[Action sentence]. The <b>deadline</b> is ${due_date}.</p>
<p><a href="/now/[workspace-route]/record/[table]/${sys_id}">View the task here</a></p>
<p>You can find the task by number ${number}.<br/>
Contact ${parent.assigned_to} if you have any questions.</p>
<p>Kind regards,<br/>The ACME team</p>
<p><i>This email was sent automatically, you cannot reply to it.</i></p>
```

### Subject line best practice

Always put a record identifier in the subject so recipients can filter and find mail:
```
A task has been assigned to you (${parent.number})
A sub-task has been completed (${parent.parent.number})
Feedback on your task (${parent.number})
```

**Dot-walk caveat in subjects:** if one notification fires for records at different hierarchy depths (parent is sometimes the case, sometimes an intermediate task), a single `${parent.number}` resolves to different things per record. Either split into separate notifications per record type, or fall back to `${number}` (the record's own number).

---

## Recipients via dot-walked fields

`recipient_fields` on `sysevent_email_action` supports dot-walking:

| Recipient intent | recipient_fields value | Depth |
|---|---|---|
| The assignee | `assigned_to` | direct |
| Parent record's assignee | `parent.assigned_to` | one level |
| Grandparent's assignee | `parent.parent.assigned_to` | two levels |

**Verify the dot-walk ends at a `sys_user` reference.** An intermediate reference may resolve to a more generic table than you expect (e.g., `parent` on a task-extending table resolves to `task`); the final field must still point at a user.

---

## Creating Notifications via the Agent API

`create_artifact` on `sysevent_email_action` (example — check the wiki's agent-api page for the correct scope parameter form on your setup):

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sysevent_email_action",
    "scope": "x_acme_fm",
    "fields": {
      "name": "ACME - Case task assigned",
      "collection": "x_acme_fm_case",
      "generation_type": "engine",
      "action_insert": "true",
      "action_update": "true",
      "condition": "assigned_toISNOTEMPTY^assigned_toVALCHANGES",
      "recipient_fields": "assigned_to",
      "subject": "A task has been assigned to you (${parent.number})",
      "message_html": "<p>Dear ${assigned_to.first_name},</p>...",
      "active": "true",
      "template": "<email_template_sys_id>",
      "weight": "0",
      "send_self": "false",
      "send_to_event_creator": "false"
    }
  }
}
```

**Key fields:**
| Field | Values | Notes |
|---|---|---|
| `generation_type` | `engine` / `event` / `triggered` | Usually `engine` |
| `action_insert` | `true`/`false` | Fire on insert |
| `action_update` | `true`/`false` | Fire on update |
| `condition` | Encoded query | Filter conditions |
| `recipient_fields` | Comma-separated field names | Supports dot-walking |
| `template` | sys_id of `sysevent_email_template` | Email layout template |
| `event_name` | Event name string | Only for `generation_type=event` |

---

## Deactivating OOTB Notifications

```json
{
  "command": "update_record",
  "params": {
    "table": "sysevent_email_action",
    "sys_id": "<ootb_notification_sys_id>",
    "field": "active",
    "content": "false"
  }
}
```

**Deactivate, never modify,** OOTB notifications — and record the deactivation in your project's decisions log.

---

## Event-Based Notifications — essentials

Only for `generation_type=event` (no record change to hook onto — decision #1). Three artifacts, all required:

1. **Event registration** (`sysevent_register`) — set BOTH `name` AND `event_name` in the payload (`create_artifact` with only `name` can leave the "Event name" field empty, and `gs.eventQueue` resolves against `event_name`). Register the event in the **same scope as the script that fires it** — a scoped script firing an event registered in another scope does nothing at all: no error, no `sysevent` row. (Verified on a single instance — verify on yours first.)
2. **The firing script** (Business Rule or scheduled job; match the scope's supported JS level — global Rhino artifacts are ES5):
   ```javascript
   // gs.eventQueue(event_name, gr, parm1, parm2)
   gs.eventQueue('x_acme_fm.case.due_date_reminder', current,
       current.getValue('due_date'), current.assigned_to.getDisplayValue());
   ```
3. **The notification** — `generation_type` explicitly set to `event` and `event_name` filled. The field defaults to `engine`; leave it and the notification listens for record changes and never fires from your event.

**Event parms in content:** `${event.parm1}` / `${event.parm2}` resolve in both subject and body.

**Event parm as recipient:** tick the boolean `event_parm_1` / `event_parm_2` on the notification (the parm value must be an email address or a `sys_user` sys_id). Never type "Event parm 1" into `recipient_fields` — that field only accepts (dot-walked) record field names.

**Debugging:** query `sysevent` with `name=<event_name>^claimed=false`. Row never appears → the firing script or its scope is wrong. Row appears but no mail → the notification configuration is wrong.

---

## Email Templates & Email Scripts — basics

**Special variables** beyond `${field}` references:

| Variable | Renders |
|---|---|
| `${URI}` / `${URI_REF}` | Classic-UI link to the record (prefer relative `/now/...` workspace links — see above) |
| `${mail_script:script_name}` | Output of a `sys_script_email` email script |
| `${event.parm1}` / `${event.parm2}` | Event parameters (event-based notifications only) |

**Email script skeleton** (`sys_script_email`, ES5):

```javascript
(function runMailScript(current, template, email, email_action, event) {
    template.print('<p>dynamic HTML here</p>');   // inject content
    // email.addAttachment(grAttachment);         // attach files queried from sys_attachment
})(current, template, email, email_action, event);
```

Use email scripts for **dynamic content and attachments only**. Do NOT manage recipients from a mail script — `email.addAddress()` in the `message` script does not reliably add recipients in scoped apps; use `recipient_fields` / `recipient_users` instead. A notification with no recipient configured anywhere (`recipient_users` / `recipient_groups` / `recipient_fields` / event-parm flag) is **silently skipped before any mail script runs**.

---

## Common Pitfalls

| Pitfall | What happens | Prevention |
|---|---|---|
| Not checking OOTB first | Users get duplicate emails | Query `sysevent_email_action.collection` before creating |
| Using events for simple state changes | Extra artifacts for no benefit (event registration + BR + gs.eventQueue) | Use `generation_type=engine` with filter conditions |
| Advanced condition for `changesTo` | Unnecessary complexity | `state=3^stateVALCHANGES` = changesTo(3) |
| Hardcoding instance URL in links | Breaks across environments | Use relative path `/now/...` |
| Including restricted data in emails to limited-access recipients | Privacy/GDPR violation | Split notifications by recipient access level |
| Assuming `${work_notes}` shows all entries | It shows only the latest on update-triggered notifications | This is correct behavior — design for it |
| Not including record ID in subject | Users can't filter/find emails | Always include `${number}` or `${parent.number}` in subject |
| Modifying OOTB notifications | Upgrade conflicts | Deactivate and create your own |
| Forgetting `send_self=false` | Creator gets their own notification | Set explicitly on creation |
| Planning translated notifications without checking plugin | Translation related list doesn't exist on the form | Check `com.glide.notification.translation` is active first (`v_plugin.id`) |
| Using `gs.getMessage()` in notification bodies | Messages don't resolve in email context | Use `${field}` references and HTML directly |
| Event notification left at `generation_type=engine` | Never fires from the event (listens for record changes) | Set `generation_type=event` explicitly + fill `event_name` |
| Event registered in a different scope than the firing script (or `event_name` empty) | `gs.eventQueue` silently no-ops | Register `sysevent_register` in the calling script's scope; set BOTH `name` and `event_name` |

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
