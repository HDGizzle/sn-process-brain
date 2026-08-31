---
title: Gotchas — platform-wide silent-failure catalog
last-verified: <fill at engagement>
---

# Gotchas — platform-wide silent-failure catalog

> **Ownership rule.** Only **platform-wide failure classes** live on this page —
> patterns that can bite on any table, any story, any tool path. A gotcha scoped to one
> procedure or artifact type belongs in the **owning skill's Gotchas section** (or the
> owning process/reference page); this page **links, never copies**, and the other side
> links back here for the general class. Agent-API command corrections are owned by
> [agent-api.md](agent-api.md) — every entry below that overlaps it links there.
>
> Entries flagged *(verify on your instance first)* were confirmed on a specific
> instance/version during a real engagement — re-verify before relying on them.
> Entries flagged *(product-specific-conditional)* only apply if the named third-party
> product is in play.

The unifying theme: **ServiceNow rarely throws.** The default failure mode on this
platform is a clean "success" with nothing (or the wrong thing) persisted. Every class
below ends the same way — verify by reading back, never by trusting the response.

## 1. Writes that report success but don't apply

### 1.1 API "success" ≠ write applied ≠ captured
The agent API returns `"success": true` for writes that silently no-op (wrong
transaction scope) and for writes that apply but never land in an update set. Three
separate checks: record (`sys_updated_on` moved + field holds the value), capture
(`sys_update_xml` row in the RIGHT set), scope (dual `switch_context` beforehand).
→ Owner: [agent-api.md](agent-api.md); mechanics in [hard-rules.md](hard-rules.md).

### 1.2 `update_record` swallows Business Rule aborts
A before-BR `setAbortAction(true)` blocks the write, yet the API still answers
"success" and `get_last_error` stays empty. State transitions and guarded writes must
be verified via `run_background_script` (which surfaces the aborting BR + message) or a
read-back — never via the API response.
→ Owner: this page; verification pattern per [agent-api.md](agent-api.md).

### 1.3 M2M relationship columns reject UPDATE — Rhino doesn't throw
`sys_group_has_role.role`, `sys_user_grmember.user`, `sys_user_role_contains.contains`,
etc. refuse UPDATE on the relationship column; the platform logs the refusal but the
Fix Script keeps running and `gs.info`s "success" with data unchanged. Always
DELETE + INSERT.
→ Owner: [agent-api.md](agent-api.md); [hard-rules.md](hard-rules.md).

### 1.4 Journal fields drop `setValue()` writes
`gr.setValue('work_notes', text)` registers **no** journal entry — silently. Direct
assignment (`gr.work_notes = text`) or `setJournalEntry()` is the correct form. This is
the one inversion of the "always setValue" convention; best-practice sweeps flag the
correct code as a violation, so it carries an inline comment.
→ Owner: [conventions.md](conventions.md); [agent-api.md](agent-api.md).

## 2. Reads that silently return empty or wrong data

### 2.1 Silent-empty / silent-unfiltered reads
Three flavors, all returning clean results instead of errors: **wrong instance** (no
authenticated helper tab there → `count: 0`, not an error); **cold/expired helper tab**
(same); **invalid field name in an encoded query** (the bad clause is dropped →
**unfiltered** rows, which is worse than empty). Canary-read a known record before
trusting absence; A/B-test every filter.
→ Owner: [agent-api.md](agent-api.md).

### 2.2 Base-ref → child-field dot-walk in filter conditions matches zero rows
A Business Rule filter condition that dot-walks through a reference field typed on a
**base** table to reach a field that lives only on a **child** table (e.g.
`task_ref.u_child_only_field=value` where `task_ref` points at `task`) returns 0 rows
with no error — the BR is silently dead and never fires. Guard in-script instead;
runtime-verify every new filter condition against a record known to match.
→ Owner: [conventions.md](conventions.md); `business-rule-patterns` skill.

### 2.3 Non-English session hides stored values
A non-English session language makes API queries return **display values**, masking
what is actually stored — translation work done against that view corrupts source
records. Confirm the session language is English before any translation task.
→ Owner: [hard-rules.md](hard-rules.md).

## 3. Silent truncation

### 3.1 `sys_script.name` truncates at 40 characters
Long Business Rule names are chopped mid-word with no error; name-based lookups then
find nothing. Keep BR names ≤ 40 chars and look BRs up by sys_id.
→ Owner: [conventions.md](conventions.md).

### 3.2 `sysevent_email_action.name` truncates at 40 characters
Same class on notifications: names silently cap at 40. Budget names up front —
naming-convention suffixes (e.g. a language-pair suffix like ` - EN` / ` - NL`) eat
into the 40 before the descriptive part does.
→ Owner: `notification-design` skill.

### 3.3 `sys_ui_action.condition` truncates — and still parses as valid JS
The condition field cuts long expressions mid-string (observed mid-role-name); the
remainder parses cleanly and evaluates the **wrong** logic. Any condition beyond a
trivial expression goes into a Script Include method called as a one-line dispatcher
(`x_acme_fm.AcmeUIUtil.canDoThing(current)`). Same lesson for every other
length-limited condition surface (filter conditions, dynamic defaults): keep the inline
expression a one-liner SI call.
→ Owner: `ui-actions-policies` skill; sandbox limits in 5.2.

## 4. Update-set capture gaps

### 4.1 `setWorkflow(false)` / `setUseEngines(false)` suppress capture entirely
Anything written under these lands in **no** update set, even with the right scope and
set active. Reserve for targeted repairs; if one touches a shipping record: say so,
link the record, force-add, re-verify `sys_update_xml`.
→ Owner: [hard-rules.md](hard-rules.md); `update-set-workflow` skill.

### 4.2 `sys_ui_element` deletes are not tracked
Form-layout row deletes never ride an update set — deleting a column leaves dead
`sys_ui_element` rows that must be removed **manually per environment**. Every story
that removes a field from a form needs an explicit per-environment cleanup step.
→ Owner: `update-set-scope-strategy` skill.

### 4.3 `sysauto_script` (scheduled jobs) does not ride update sets
Scheduled-job changes are manual per environment — a runbook step, not an update-set
record. Every story touching a `sysauto_script` needs an explicit deploy step in
[deployment-matrix.md](deployment-matrix.md).
→ Owner: `scheduled-notification-jobs` skill.

### 4.4 Other known capture holes
`sys_group_has_role` DELETEs of pre-existing links don't auto-track
([hard-rules.md](hard-rules.md)); `sys_ui_list`/`sys_ui_list_element` written via REST
orphan with zero `sys_update_xml` rows ([hard-rules.md](hard-rules.md)). The general
antidote is always the same: prove capture via `sys_update_xml`, never via UI/DB
presence.

### 4.5 State Flow scaffolding lands in whatever update set is active at attach
Attaching a classic State Flow (`com.snc.state_flows`) to a table generates engine
artifacts (a Business Rule + client scripts) **at attach time**, captured in whatever
update set happens to be active — easily stranded in Default, in which case the flows
ship with no engine. Attach only with the story set active; verify the generated
artifacts' capture afterwards. *(verify on your instance first)*
→ Owner: `state-flows` skill; see also section 7.

## 5. Silently-dropped values and dead logic

### 5.1 Service Connector field maps drop `glide_list` and `glide_date_time` values *(product-specific-conditional)*
Applies only if the LSMCB Service Connector product is in use. SC field maps silently
discard values targeting these field types — no error, no log, empty target field.
Route such mappings through a Business Rule on the target table instead.
→ Owner: the engagement's integration process page.

### 5.2 Guarded-script sandbox limits — multi-statement scripts break silently
Filter conditions, dynamic defaults, AMB/RecordWatcher conditions, and `javascript:`
prefixes allow exactly **one expression** — no `var`, `if`, loops, assignments, or
`;`-chains. Violations break silently or at upgrade (Incompatible Guarded Scripts
list). Logic goes in a Script Include, called as a one-liner.
→ Owner: [hard-rules.md](hard-rules.md); [conventions.md](conventions.md).

### 5.3 Scoped Script Include called without the scope prefix
`new GlideAjax('AcmeFooAjax')` against a scoped SI fails with no error anywhere — the
callback simply returns nothing, indistinguishable from an empty result. Always the
full `api_name` (`x_acme_fm.AcmeFooAjax`) — from client and server alike.
→ Owner: [hard-rules.md](hard-rules.md).

### 5.4 Client `getMessage()` without the `messages` field renders the raw key
Every key passed to a client script's `getMessage()` must also be listed in the
script's `messages` field — missing entries render the raw key as visible text,
silently. In the configurable workspace, additionally use the callback form.
→ Owner: [hard-rules.md](hard-rules.md); `client-scripts` and
`workspace-client-scripts` skills.

### 5.5 Wrong translation table silently no-ops
`translated_text` fields (e.g. `sys_ux_form_action.name`) need `sys_translated_text`
with `documentkey` — a `sys_translated` row there is simply never read.
→ Owner: [hard-rules.md](hard-rules.md); `translate-workspace-ui` skill.

### 5.6 Modern JS in Rhino saves cleanly, fails at first execution
`const`/`let`/arrow functions in a global-scope server script throw `SyntaxError` only
when the script first **runs** — typically in a production path, not at save time.
Exercise the script; don't just save it.
→ Owner: [hard-rules.md](hard-rules.md); [conventions.md](conventions.md).

### 5.7 Negative comparisons silently match empty
`current.type != 'special'` (and the encoded `type!=special`) is **true for records
where the field is empty** — every negative comparison implicitly includes the
empty-value population. When a marker value is later migrated away (field cleared, new
flag introduced), all `!=` tests against the old marker silently start matching the
migrated records: guard conditions fail **open**, mandatory-check BRs fire on the wrong
rows. Prefer positive predicates on an explicit flag (`u_is_special=true`); when a
negative test is unavoidable, add the empty case deliberately
(`type!=special^typeISNOTEMPTY` — or the inverse, chosen on purpose). Migrations that
repoint conditions must sequence flag-backfill → condition-flip → old-value-clear; any
other order lets live records fall through. Related SLA trap: changing a `task_sla`
`start_condition` while SLAs are running cancels every running SLA on the next
non-matching update (and `retroactive=false` loses breach history) — flip conditions
before clearing the old marker values.
→ Owner: this page; `business-rule-patterns` and `sla-management` skills.

### 5.8 Scoped `GlideImportSetTransformer` does not run Transform Map scripts *(verify on your instance first)*
A transform driven through the **scoped** `GlideImportSetTransformer` API executes the
field maps but **not** the Transform Map's onBefore/onAfter (and other) transform
scripts — no error, rows land with the scripted logic simply skipped. Any import path
that invokes the transformer from a scoped app (some integration products do this for
their "external processing" staging route) silently loses script-based parsing. If your
transform needs scripts, run it via the global transformer path, or bypass staging and
write direct-to-target with the parsing logic in the integration layer / target-table
BRs. *(product-specific-conditional: the observed trigger was a third-party integration
product's scoped staging pipeline — but the scoped-API limitation itself is platform
behavior.)*
→ Owner: `transform-maps` skill.

## 6. Context-dependent evaluation traps

### 6.1 `sys_idDYNAMIC` does not evaluate in ACL context
The DYNAMIC operator works in list filters but silently **denies** inside an ACL
condition — no error, just no access. ACL row-gating needs a script condition; the
list-side filtering ships separately as a `sys_filter_option_dynamic`.
→ Owner: `acl-security` / `dynamic-filter-options` skills.

### 6.2 Cross-scope `gs.getMessage` fails from scoped apps *(verify on your instance first)*
`gs.getMessage` called from one scoped app cannot resolve message keys owned by
another scope — the raw key comes back, silently. Workaround: host the
`getMessage`-dependent server logic in the scope that owns the messages (or duplicate
the keys into the calling scope). Re-check on platform upgrades — this is a platform
bug that may be fixed.
→ Owner: `translate-server-scripts` skill.

### 6.3 Classic vs configurable workspace tables are disjoint
Anything built on `sys_aw_*` (classic Agent Workspace) is simply never read by the
configurable workspace (`sys_ux_*`) — a full build that silently does nothing. Related:
workspace list visibility is governed by audiences, not the list's `roles` field.
→ Owner: [hard-rules.md](hard-rules.md); `workspace-list-visibility` skill.

### 6.4 Workspace audience dual-match is nondeterministic
When a user matches **more than one** `sys_ux_applicability` audience wired to
different landing screens, which screen wins is nondeterministic — users intermittently
land on the wrong page with nothing in any log. Catch-all/default audiences are the
usual culprit: give every persona its own dedicated audience routed to exactly one
screen, and never wire a screen to the default catch-all. UI Builder **auto-creates**
an m2m row to the default audience for every new screen — deactivate that row per new
screen before go-live, and re-verify it stayed inactive after each upgrade (upgrades
can re-enable applicability records).
→ Owner: `ui-builder-patterns` / `workspace-list-visibility` skills.

## 7. Engines that enforce less than they appear to

Classic State Flow (`com.snc.state_flows`) *looks* like a transition-enforcement
engine. Verified by reading the `global.StateFlow` source, it is only a **form-layer
convenience** — re-verify against your platform version. *(verify on your instance
first)*

### 7.1 `validateMandatory()` never blocks an illegal transition
It only checks mandatory **fields** on *configured* transitions; a from→to pair with no
matching `sf_state_flow` record returns `true`. Nothing server-side aborts an illegal
transition — API, list-edit, and integration writes sail straight through the state
model.

### 7.2 `getValidStates` keys on `(table, start_text)` only
It cannot offer different next-states to different record subtypes on the same table
(it is blind to any discriminator field), and for field-driven transitions it never
evaluates `roles` or `manual_condition` — i.e. field-driven state changes have **zero
role enforcement**.

### 7.3 The guard-BR pattern is the real enforcement
Put the allowed from→to matrix + per-transition role gating in a Script Include, called
from one before-update guard Business Rule per table. The guard catches every write
path (form, list, API, integration). Optionally, a thin client supplement can call the
same matrix (via GlideAjax) to narrow the state dropdown so users are never *offered* a
transition the guard would refuse — one matrix, two consumers, no drift.
Rule of thumb for where logic lives: transition-scoped → `sf_state_flow`;
state/record-type-scoped → UI policy; conditional or aggregate checks → BR (State Flow
field controls cannot carry a condition); cross-record cascades → BR only, and
pre-check close-blockers rather than letting a downstream abort roll back the write
that triggered the cascade.
→ Owner: `state-flows` skill; capture trap in 4.5.
