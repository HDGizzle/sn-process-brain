---
name: state-flows
description: This skill should be used when the user asks about "state flow", "sf_state_flow", "state model", "status transitions", "valid next states", "filter state choice list", "state transition guard", "com.snc.state_flows", "StateFlow business rule", "StateFlowAJAX", "getValidStates", or "block illegal transition" — any classic State Flow work on Task-extending (or other) tables. NOT for Flow Designer (sys_hub_flow) — use the "flow-designer" skill.
---

# Classic State Flows (`sf_state_flow` / `com.snc.state_flows`)

The classic **State Flow** feature drives task-style status transitions declaratively: it filters the `state` choice list to only the valid next states on the form, and can mark fields mandatory/visible/read-only per transition, gate transitions by role, append work notes, and fire events. Same engine HRSD / SM / GRC use for their task states. Plugin `com.snc.state_flows`, config table `sf_state_flow`, driven by script includes `global.StateFlow` + `global.StateFlowAJAX`.

> This is **not** Flow Designer. `sf_state_flow` = classic per-table state model. `sys_hub_flow` = Flow Designer → use the `flow-designer` skill.

## ⚠️ THE critical, non-obvious lesson — State Flow does NOT guard the server

**Classic State Flow's server-side enforcement covers only mandatory-fields + work-notes on *configured* transitions. It NEVER enforces transition legality.** The transition *restriction* (which next-states are allowed) is **100% client-side** — it only filters the choice list on the form. A direct API update, data import, or list-edit jumping between arbitrary states sails straight through the server untouched.

The full enforcement truths (what `validateMandatory()` and `getValidStates` actually do, and the guard-BR pattern that provides real enforcement) are owned by **the wiki's gotchas page, section 7 ("Engines that enforce less than they appear to")** — read it before designing any state model. Verified by reading the `global.StateFlow` source *(verify on your instance first)*. The short version:

- Attaching a State Flow auto-creates ONE before-insert/update BR (`State Flow Notes for <table>`, order 10001) that calls `validateMandatory()` (may abort) and `addWorkNotes()` — nothing else. No method anywhere in `global.StateFlow` aborts an illegal from→to jump.
- **Consequence:** if you need "illegal transitions blocked server-side too (API / import / list-edit)", you MUST add your own thin **before-update allow-list guard BR** per table (or one generic Script Include called per table). What you *do* get server-side for free: mandatory-field enforcement on configured transitions (runs on API writes too) + work-note append.

## The auto-created artifacts (know these before you touch a State-Flow table)

Attaching a State Flow bootstraps, per table:

| Artifact | Table | Role |
|---|---|---|
| BR `State Flow Notes for <table>` (order 10001, before ins/upd) | `sys_script` | `validateMandatory` (may abort) + `addWorkNotes` |
| onLoad CS `<table> state flow` | `sys_script_client` | `StateFlowAJAX.getValidStates` → **clears the `state` choice list and re-adds only valid next states**; applies mandatory/readonly/visible for load |
| onChange CS `<table> change state flow` (field `state`) | `sys_script_client` | `StateFlowAJAX.getFieldRequirements` → applies per-new-state field mandatory/readonly/visibility |
| optional per-flow BR / UI Action | — | only if the flow uses an `automatic` (auto-advance) or `manual` (button) type; created by `createBusinessRule` / `createUIAction` |

`getValidStates` = the current state + every `sf_state_flow.end_text` whose `start_text` = current state (active). That is what produces the "choice list shows only valid next states" behavior.

**Deploy trap:** this scaffolding is generated **at attach time** and lands in whatever update set is active at that moment — easily stranded in Default, in which case the flows ship with no engine. Attach only with the story set active and verify capture afterwards — see the wiki's gotchas page, section 4.5.

## `sf_state_flow` config fields that matter

- `table` — reference; can target any table incl. custom Task-extending tables (e.g. `x_acme_fm_case`).
- `start_text` / `end_text` — the from/to state **values** (empty `start_text` = applies on load / from any). `rebuildFlows()` resolves these to the choice sys_ids.
- `mandatory_fields` / `visible_fields` / `read_only_fields` (+ their `not_*` inverses) — comma-separated field list per transition (**this is the server-enforced-mandatory + client field-shaping**).
- `roles` / `manual_roles` / `automatic_roles` — role gating (checked by `validFlow` for manual/automatic types only — see below).
- `work_notes` — auto-appended note on the transition.
- `event` + `event_rule` — fires an event (via a separate auto-created after-BR) on the transition.
- Only `active=true` records count.

## Gotchas

- Don't confuse the auto-created `<table> state flow` client scripts / `State Flow Notes` BR with hand-written project artifacts — they're feature-generated and re-linked/deleted by `StateFlow.checkDelete*` when flows change.
- Editing states/choices? Run `new global.StateFlow().rebuildFlows('<table>')` so `sf_state_flow` re-resolves `starting_state`/`ending_state` choice references.
- The `state` field must not be dictionary-override read-only if you want field-driven transitions to work. If you revert such an override on dev, ship the revert to test/prod too — not just dev.
- State Flow field-shaping fights any UI Policy on the same fields — pick one owner per field per state.

---

## ⚠️⚠️ Configurable-workspace caveat (DECISIVE — read before choosing field-driven)

The State Flow "filtered `state` dropdown" is delivered **entirely by a classic onLoad/onChange client script** using `g_form.clearOptions()` + `g_form.addOption()`. That mechanism is **not dependable in the Next Experience / configurable workspace**, for two independent, documented reasons:

1. **Classic client scripts don't run in workspace by default** — they must be explicitly enabled for the workspace surface (`ui_type` incl. workspace, isolate-script settings). Check whether the scripts State Flow generated for your table are `ui_type=10` + `isolate_script=true` — that is the right config, but it only clears hurdle 1.
2. **`addOption`/`removeOption` on a choice list is a documented workspace Known Error (KB1001598)** — "if you are having any dependency then addOption won't work"; `getDisplayBox()` unsupported; `setValue`/`clearValue` on custom fields also flaky (KB1220159). So even a workspace-enabled version of `getValidStates` may not actually restrict the list on the workspace form.

**Implication:** do NOT assume the filtered dropdown works in the configurable workspace. **Settle it empirically first** (load a real record on the actual workspace form, inspect the `state` options) before betting the design on field-driven filtering. Fallbacks if it doesn't hold:
- **Server-guard-primary:** let the field show all states; the **before-update guard BR** rejects illegal picks with a clear message on save. Workspace-safe, worse UX (error-on-save vs hidden option).
- **Button-driven:** wire transitions as UI Actions into the workspace (`sys_ux_form_action` + layout item + m2m — see the `workspace-modal-actions` skill). Usually contradicts a "fewer buttons" design goal, so a last resort.
- **Best-effort hybrid:** the guard BR is the real enforcement; add a workspace client script to filter where it works, accept graceful degradation.

The Process Flow Formatter ribbon is likewise a **classic-form** component — don't assume it renders in a configurable workspace record page.

## `sf_state_flow` field reference (complete, verified — re-verify on your instance)

`sf_state_flow` **extends `sys_metadata`** → update-set-trackable. Custom-table flows go on the **base table** (HR/SM ship extensions `sf_sm_flow`→`sf_hr_case`/`sf_sm_task`/… — irrelevant unless you own those apps).

| Field | Type | Use |
|---|---|---|
| `name` (mand) · `table` (mand) · `number` (auto SF…) · `active` (def true) | — | identity |
| `start_text` / `end_text` | string(100) | from/to state **values** (the fields you set) |
| `starting_state` / `ending_state` (+ `translated_*`) | ref `sys_choice` | auto-resolved from start/end_text by `rebuildFlows()` — don't set by hand |
| `mandatory_fields` · `visible_fields` · `read_only_fields` · `not_mandatory` · `not_visible` · `not_read_only` | glide_list→`sys_dictionary` | per-transition field shaping. **`mandatory_fields` is the only thing enforced server-side.** |
| `roles` · `manual_roles` · `automatic_roles` | glide_list→`sys_user_role` | role gating — **only evaluated for UI-action/automatic transitions via `validFlow`, NOT for field-driven** |
| `manual_condition` / `automatic_condition` | conditions(4000) | encoded query gating the button/auto-BR (e.g. `active=true^stateNOT IN3,4,7^EQ`) |
| `manual_string` / `automatic_string` | condition_string(254) | JS condition gating the button/auto-BR (e.g. `!current.isNewRecord() && current.canWrite()`) |
| `manual_script` / `automatic_script` | script | code run on the transition |
| `work_notes` (str 100) · `work_notes_rule` (ref BR) | — | note text auto-appended + its generated BR |
| `event` (ref `sysevent_register`) · `event_rule` (ref BR) | — | fire an event on the transition |
| `ui_action` · `business_rule` · `client_script` · `change_client_script` · `override` | refs | the auto-generated artifacts this flow is linked to |

**Presentation is chosen by the start/end combination** (all three modes are supported — docs confirm):

| `start_text` | `end_text` | Generates | Presentation |
|---|---|---|---|
| value | value | onChange client script (+ optional auto-BR) | **field-driven** transition between two states |
| empty | value | UI Action + onLoad script | **button** ("processing at end state") |
| value | empty | — | cleanup after cancellation |
| empty | empty | — | cross-transition processing (conditions) |

OOTB `hr_case` uses the **button** pattern (each flow has a `ui_action` ref + `manual_condition` + `manual_string`). A field-driven model is value→value with **no `ui_action`**.

## Role gating for field-driven transitions ≠ a State Flow job

Verified from source: `StateFlow.getValidStates` builds the choice list from `(table, start_text, active)` **only** — it never reads `roles`/`manual_condition`. And `validFlow()` (which *does* evaluate roles/conditions) is only invoked from UI-action/automatic conditions, never on a plain field edit. **So a field-driven `sf_state_flow` transition has zero role enforcement** (wiki gotchas section 7.2). Who-may-transition therefore lives in the **before-update guard BR** (a persona/role Script Include called per transition), or an ACL on the state field/value — not in the flow config. The guard BR does double duty: transition legality **+** role/owner gating.

## State Model — the declarative alternative worth a look

A distinct, newer feature (not State Flow) that "defines the possible states and the allowed transitions between them" as a visual lifecycle — better for strict/compliance transitions and gives declarative **transition legality** (potentially covering part of the guard-BR job with less custom code). Community guidance: State Flows are easier for basic task-table states; State Model for complex strict transitions; often used together. Its configurable-workspace behavior is unverified — evaluate before betting on it.

## More gotchas (from research)

- **Auto-generated automatic-transition BR has a long-standing condition bug** — it keys on the *starting* state, so it fires when the record flows **to A, not to B**. Verify/rewrite any auto-created automatic BR condition.
- **`extended_operators=VALCHANGES;CHANGESFROM;CHANGESTO`** on the `state` dictionary eases transition detection — but server-side only, and only where previous/current are known.
- **Field controls can't carry a condition** — mandatory/visible/read-only apply purely per state transition; conditional field shaping is a UI Policy job.
- **Legacy but alive** — present in Yokohama + Zurich bundles; not deprecated. Docs are thin and pre-Next-Experience. SN's strategic automation push is Flow Designer (not a State Flow replacement for form choice-filtering).
- **`sn_state_flow.StateFlowFilter`** (called by `validFlow` when a `_condition` is set) did not resolve in a name query on one verified instance — irrelevant to field-driven, but confirm before using any condition-gated **button** transition. *(verify on your instance first)*

## Sources

- docs: [Use state flows](https://www.servicenow.com/docs/r/servicenow-platform/c_UseStateFlows.html) · [State flows concept (Zurich)](https://www.servicenow.com/docs/bundle/zurich-servicenow-platform/page/administer/state-flows/concept/c_StateFlows.html) · [Process flow formatter (Yokohama)](https://www.servicenow.com/docs/r/yokohama/platform-administration/r_ProcessFlowFormatter.html)
- Community: [Cheat Sheet — State Flows](https://www.servicenow.com/community/developer-articles/cheat-sheet-state-flows/ta-p/2327959) · [State Transition through State Flow Plugin](https://www.servicenow.com/community/itsm-articles/state-transition-through-state-flow-plugin-id-com-snc-state/ta-p/2411387) · [State Model vs State Flow](https://www.servicenow.com/community/itsm-forum/when-to-use-state-model-and-when-to-use-state-flow/m-p/3358539)
- Workspace limits: [KB1001598 add/removeOption not working in Agent Workspace](https://www.servicenow.com/community/it-service-management-forum/add-remove-options-with-client-script-not-working-in-agent/m-p/496451) · [KB0827632 configure client script for workspace](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0827632) · [KB1220159 setValue in workspace](https://www.servicenow.com/community/developer-forum/g-form-setvalue-not-working-in-agent-workspace/m-p/2858976)

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
