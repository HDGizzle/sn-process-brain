---
title: "Gotchas — cross-engagement platform catalogue"
status: "corpus"
---

# Gotchas — the cross-engagement platform catalogue

> **This page ships with the installer and grows across engagements.** It is the scar
> tissue: platform and tooling knowledge learned by writing code, paid for once, carried
> to every next engagement at day zero. On the scored A/B instrument, `needs-a-human`
> gotcha/convention facts are 59% of everything still missing after a full run — and a
> quarter of both scored runs' hits came from installer-shipped doctrine pages, which is
> the mechanism this page is.
>
> **Ownership rule (the pilot engagement's `gotchas.md`, adopted verbatim in spirit).** Only
> **platform-wide failure classes** live here — patterns that can bite on any table, any
> story, any tool path. A gotcha scoped to one procedure or artifact type belongs in the
> **owning skill's** Gotchas section; this page links classes, never copies mechanics.
>
> **To append a confirmed gotcha:**
> `node <framework>/tools/snbrain/gotcha.js --add --title "..." --body "..." --by <name> --engagement <name> [--root <engagement repo>]`
> — it writes the entry here (the framework corpus) and, with `--root`, into that
> engagement's copy too, so the NEXT install ships it. Platform-wide classes only; the
> tool refuses skill-scoped entries and says where they belong.
>
> The unifying theme: **ServiceNow rarely throws.** The default failure mode is a clean
> "success" with nothing (or the wrong thing) persisted. Verify by reading back, never by
> trusting the response.

<!-- snbrain:gotcha-corpus:start -->

### GOTCHA-api-success — API "success" proves nothing
`platform-wide` · first confirmed: the pilot engagement, 2026-07 · by: the pilot engagement team
A write API returns `"success": true` for writes that silently no-op (wrong transaction
scope), writes blocked by a before-BR `setAbortAction(true)` (and `get_last_error` stays
empty), and writes that apply but never land in an update set. Three separate checks,
always: the record moved, the value holds, the `sys_update_xml` row sits in the RIGHT set.

### GOTCHA-boolean-protection — a boolean column cannot be converted, nor replaced under its own name
`platform-wide` · first confirmed: the pilot engagement (STRY0100002), 2026-08 · by: the pilot engagement team
OOTB BR *Boolean Protection* aborts any `sys_dictionary` type change away from boolean —
API reports success, column unchanged. Delete-then-recreate under the SAME name does not
ship either: `sys_update_xml` dedupes by name, the DELETE is replaced by the later insert,
and the target ends up blocked or with a broken field (no `sys_storage_alias`, blank
label). Use a NEW column name; drop the old column in a separate, plain delete.

### GOTCHA-stale-update-xml — `saveRecord` no-ops on an unchanged record; `setForceUpdate` does not refresh capture
`platform-wide` · first confirmed: the pilot engagement (STRY0100012), 2026-07 · by: the pilot engagement team
`new GlideUpdateManager2().saveRecord(gr)` silently leaves a stale `sys_update_xml`
payload in place when the record has not changed since its last capture; re-saving and
`setForceUpdate(true) + update()` both do nothing. Delete the stale `sys_update_xml` row
first, then capture — and verify the PAYLOAD, never the row's existence.

### GOTCHA-showfieldmsg-workspace — `showFieldMsg` + client `getMessage` are unreliable in the configurable workspace
`platform-wide` · first confirmed: the pilot engagement (STRY0180335), 2026-06 · by: the pilot engagement team
In workspace, client `getMessage()` without the client script's `messages` field renders
the raw key, and `showFieldMsg` timing is unreliable on load. Every workspace-facing
client script lists its keys in `messages` and treats `getMessage` as async. Mechanics:
the `workspace-client-scripts` skill owns the pattern.

### GOTCHA-forcedviewname — a workspace form modal renders the wrong view without `forcedViewName`
`platform-wide` · first confirmed: the pilot engagement, 2026-05 · by: the pilot engagement team
A Glide Form data resource inside a workspace modal macroponent renders the Default view
unless `forcedViewName` names the modal's view exactly — silently, with every field the
Default view carries. Note the exact view name at creation. Mechanics: the
`workspace-modal-actions` skill owns the pattern.

### GOTCHA-view-reserved — `view` is a reserved word in workspace routes
`platform-wide` · first confirmed: the pilot engagement, 2026-06 · by: the pilot engagement team
A UX app route or parameter named `view` collides with the platform's own view parameter
and mis-renders or drops the intended target — no error anywhere. Name route parameters
anything else. Mechanics: the `ui-builder-patterns` skill owns the pattern.

### GOTCHA-workspace-render-delay — the workspace paints before its data arrives
`platform-wide` · first confirmed: the pilot engagement, 2026-06 · by: the pilot engagement team
Workspace forms and lists render before data brokers resolve: a client check that runs on
paint reads empty values that are "there" a moment later, and passes/fails wrongly.
Anything that inspects field values on load must wait for the form's ready event, not the
render. Mechanics: the `ui-builder-patterns` / `workspace-client-scripts` skills own the
pattern.

<!-- snbrain:gotcha-corpus:end -->
