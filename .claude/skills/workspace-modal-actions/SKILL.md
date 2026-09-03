---
name: workspace-modal-actions
description: Use when building or debugging Next Experience workspace form buttons, modals, or declarative actions — triggers "workspace button", "form modal", "SOW form modal", "declarative action", "form action layout", "action bar button", "split button", "dropdown button", "layout group", "event mapping", "payload definition", "macroponent modal", "g_aw.openRecord", "form_button_v2", "actionConfigId", "button invisible workspace", "modal won't open", "workspace button translation".
---

# Workspace Modal & Declarative Action Patterns

How to create buttons on configurable-workspace record forms — simple client-script buttons, split/dropdown buttons, and buttons that open modals (SOW Form Modal v2) via declarative action chains. Earned in production on a configurable-workspace implementation; single-instance findings are flagged.

## Reference files — load on demand

Deep walkthroughs live in `references/`. Read the one that matches the task; this core file holds only rules, cheat sheets, and chain skeletons.

| File | Read when |
|------|-----------|
| `references/simple-buttons.md` | Plain workspace button running a client script (`g_aw.openRecord`, no modal) — full 5-record build |
| `references/form-action-layouts.md` | Split/dropdown buttons (layout groups), the layout resolution chain + `actionConfigId`, hiding/removing buttons, cache-bust, production lessons learned |
| `references/declarative-action-chains.md` | Button that opens a modal: full DA chain (payload def → DA assignment → M2M → event mapping → route), agent API build order, anti-patterns, checklist |
| `references/modal-views.md` | Modal content: `sowformmodalv2` route/payload params, forcing a form view (`forcedViewName`), spinner, view-scoped client scripts/BRs, activity stream formatter |
| `references/translations.md` | Translating buttons/modals: `sys_translated` vs `sys_translated_text`, naming conventions, getMessage `messages` field, untranslatable modal params |

## Project Rules (mandatory)

- **`form_button_v2: "true"` is mandatory.** Without it the button is completely invisible in workspace forms — standalone, in a dropdown group, anywhere. No errors, just silent absence. Check this FIRST when debugging "button doesn't appear."
- **Naming:** keep `sys_ui_action.name` a clean, user-facing button label in the source language WITHOUT the project record prefix (e.g. `Save and Close`, NOT `ACME - Save and Close`). Workspace falls back to `sys_ui_action.name` as the displayed label, so a prefix leaks onto the button. Translated labels go in translation records, never in `name`.
- **Multi-language projects** (see `language.targets` in `product.config.json`): every user-facing text (label, hint, tooltip, message) ships in the source language plus a translation record per target language — see `references/translations.md` and the `translate-workspace-ui` skill.
- **This skill targets configurable workspace (`sys_ux_*`), never classic Agent Workspace (`sys_aw_*`).**

### Hard rules (build constraints)

| Rule | Constraint |
|------|-----------|
| **Layouts are mandatory** | **UX Form Action Layouts are mandatory for workspace buttons.** A UI action / DA alone never renders — every button needs a `sys_ux_form_action_layout_item` (+ M2M) on the table's form action layout. Forgetting the layout item = silently invisible button, the classic oversight. |
| **Match the workspace's action config** | **Form action layouts MUST reference the workspace's `actionConfigId` page property.** Any other `sys_ux_action_config` causes **silent layout resolution failure**: the layout is ignored and raw UI Actions render instead. Query `sys_ux_page_property` (`name=actionConfigId`) BEFORE creating any layout. |
| **Condition length** | **`sys_ui_action.condition` truncates silently** at its character limit — and the truncated string can still parse as valid JS with the wrong logic. Any condition beyond a trivial expression goes into a Script Include method, called as a one-liner, e.g. `new x_acme_fm.CaseButtonUtil().canDoThing(current)` (example — use your scope's utility). |

## CRITICAL WARNINGS

1. **Cascade deletion.** `sys_declarative_action_assignment.client_action` is a reference to the payload definition. Deleting the payload definition **cascade-deletes** the DA assignment and its action-config M2M — the button vanishes. Safe order: remove M2Ms → clear `client_action` → delete payload def → delete DA assignment. Full detail: `references/declarative-action-chains.md`.
2. **`view` is reserved in UXF routing.** Never add `view` to a route's `fields` — the modal won't open at all. Force a view with `forcedViewName` as `JSON_LITERAL` on the Glide Form data resource instead (`references/modal-views.md`).
3. **Event mapping has hidden required fields.** `sys_ux_addon_event_mapping` needs `controller`, `source_component`, AND `target_event` (undocumented, not marked mandatory). If any is empty the button renders but clicking does **nothing** — no error anywhere. Copy the three values from a working event mapping on the same workspace (`references/declarative-action-chains.md`).
4. **Update set pollution.** One button+modal easily generates 50+ `sys_update_xml` rows (payload fields, auto `sys_documentation` labels, mappings, M2Ms). Always work in a dedicated update set and audit it.
5. **Deactivate, don't delete.** Retiring a button = `sys_ui_action.active=false` (primary gate) + **hard refresh** (Ctrl+Shift+R) in the target — the layout chain is heavily cached and F5 is not enough (`references/form-action-layouts.md`).

## Workspace Field Name Cheat Sheet — use this, not classic fields

The `sys_ui_action` table has BOTH classic and workspace fields. **Using the wrong ones is the #1 cause of invisible buttons.**

| Purpose | WRONG (Classic UI) | CORRECT (Workspace) |
|---------|----------------------|----------------------|
| Show as form button | `form_button: "true"` | **`form_button_v2: "true"`** |
| Client script | `script` / `onclick` | **`client_script_v2`** |
| Function signature | `function myFunc() { ... }` | **`function onClick(g_form) { ... }`** |

**M2M link fields** (`sys_ux_m2m_action_layout_item`):

| Purpose | WRONG (does not exist) | CORRECT |
|---------|--------------------------|-----------|
| Layout reference | `action_layout` | **`ux_form_action_layout`** |
| Layout item reference | `action_layout_item` | **`ux_form_action_layout_item`** |

**Button styling** — `variant` lives on the **M2M record** (`sys_ux_m2m_action_layout_item`), NOT on the layout item (`color` on the layout item does nothing in workspace). Values: `primary`, `primary-positive`, `primary-negative` (red/destructive), `secondary` (default), `secondary-negative`, `tertiary`.

## Which pattern do I need?

| Need | Pattern | Records | Reference |
|------|---------|---------|-----------|
| Open record in new tab / run client script | Simple UI Action | ~5 | `references/simple-buttons.md` |
| Primary button + dropdown chevron | Split Button (layout group `type=1`) | 7+ | `references/form-action-layouts.md` |
| Dropdown only, no primary | Menu (layout group `type=0`) | 7+ | `references/form-action-layouts.md` |
| Show a record form in a modal | DA chain + `sowformmodalv2` | 10+ | `references/declarative-action-chains.md` + `references/modal-views.md` |
| Custom non-form modal content | DA chain + custom macroponent | most | same, plus UI Builder work |

Before building a status-transition button, check whether the project routes state changes through a state model (state field + state flows + guard business rules) instead of buttons — many implementations do, and a button would then be the wrong pattern.

## Chain skeletons

**Simple button** (no modal):
```
sys_ui_action (form_button_v2=true, client_script_v2)
  → sys_ux_form_action (action_type=ui_action)
  → sys_ux_form_action_layout_item (label+table mandatory)      [layouts-mandatory rule]
  → sys_ux_m2m_action_layout_item (variant lives here)
  → sys_ux_form_action_layout (action_config = workspace actionConfigId)  [action-config rule]
```

**Split button** (adds a group between form action and layout item):
```
sys_ux_form_action (×N)
  → sys_ux_form_action_layout_group (type=1, actions=csv of form_action sys_ids; first = primary)
  → sys_ux_form_action_layout_item (item_type=group ← must set explicitly!)
  → sys_ux_m2m_action_layout_item → layout
```

**Button → modal** (declarative action chain):
```
sys_declarative_action_payload_definition (payload_template: route sowformmodalv2)
  → sys_declarative_action_assignment (client_action=payload def, model=Form 360935e9..., uxf_client_action, action_bar)
  → sys_ux_m2m_action_assignment_action_config (→ workspace action config)
  → sys_ux_form_action (+ layout item + M2M, per the layouts-mandatory rule)
  → sys_ux_addon_event_mapping (controller + source_component + target_event + target_payload_mapping — ALL required)
  → sys_ux_app_route (route_type=sowformmodalv2; fields WITHOUT "view")
  → screen type → screen → macroponent (forcedViewName as JSON_LITERAL, hideLoader=false)
```

Platform constant: Form model (`sys_ux_data_broker_model`) = `360935e9534723003eddddeeff7b127d` (OOTB — verify on your instance). Used in `applicable_to` and `model`.

## Troubleshooting index

| Symptom | First checks | Deep dive |
|---------|--------------|-----------|
| Button doesn't appear | `form_button_v2=true`? Layout item + M2M exist? All `active=true`? Condition matches? | `references/form-action-layouts.md`, `references/declarative-action-chains.md` |
| Layout ignored, raw UI Actions render | Layout `action_config` ≠ workspace `actionConfigId` page property (the #1 killer) | `references/form-action-layouts.md` |
| Button renders, click does nothing | Event mapping `controller` / `source_component` / `target_event` empty — copy from a working mapping | `references/declarative-action-chains.md` |
| Modal shows wrong/default view | `forcedViewName` must be `JSON_LITERAL`; never pass `view` through the route | `references/modal-views.md` |
| Duplicate Save buttons | OOB standalone Save M2M still active next to your group | `references/form-action-layouts.md` |
| Deactivated button still renders | Workspace layout cache — hard refresh (Ctrl+Shift+R), then verify update-set capture | `references/form-action-layouts.md` |
| Translation not applied | Wrong table: `translated_text` fields need `sys_translated_text` (documentkey), `string` fields need `sys_translated` | `references/translations.md` |
| `getMessage()` returns the raw key | Key missing from the client script's `messages` field | `references/translations.md` |
| Activity stream dead in workspace | "Activities (filtered)" formatter missing on the workspace form view | `references/modal-views.md` |

## Pre-flight (every build)

1. Query `sys_ux_page_property` for the workspace's `actionConfigId` — layouts must reference it.
2. Verify/create the form action layout for your table with that `action_config`.
3. `form_button_v2=true` + `active=true` on every UI Action; non-trivial conditions → Script Include one-liner.
4. Layout item (+ M2M) for every button; `variant` on the M2M.
5. Source-language base text + a translation record per target language for every user-facing string (`references/translations.md`).
6. Test in the workspace with a **hard refresh**; audit the update set for orphaned payload fields/labels.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
