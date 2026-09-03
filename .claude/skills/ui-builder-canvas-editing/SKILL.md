---
name: ui-builder-canvas-editing
description: This skill should be used when the user asks to investigate or edit a workspace page live in UI Builder via the browser — "open UI Builder", "check UI Builder", "why is this tab missing", "sidebar tab hidden", "record page variant", "tab sidebar", "tab not showing in workspace", "hide tab", "component visibility condition", or any task that requires navigating the UI Builder canvas (not just reading sys_ux_* records via the Agent API). Complements `ui-builder-patterns` (data broker / client state / event concepts) and `workspace-view-rules` (sysrule_view_workspace records) — this skill is specifically about the hands-on browser workflow and the per-tab "Hide tab" gotcha.
---

# UI Builder — Browser Canvas Editing

Hands-on workflow for navigating and editing a workspace page **live in UI Builder through the browser tool**, plus a specific, easy-to-miss gotcha: individual sidebar tabs (Activity, Attachment, Template, ...) have their own static "Hide tab" checkbox that has nothing to do with system properties, ACLs, or `sysrule_view_workspace` records.

**When to use this vs. other skills:**
| Need | Skill |
|---|---|
| Read/write `sys_ux_*` records via the Agent API (no browser) | Agent API `query_records`/`update_record` directly |
| Data brokers, client state, events, macroponent concepts | `ui-builder-patterns` |
| `sysrule_view_workspace` config records (hide journal, tab order JSON, view overrides) | `workspace-view-rules` |
| Buttons / declarative actions / form action layouts | `workspace-modal-actions` |
| **Actually opening UI Builder in the browser to look at or edit a page's canvas** | **this skill** |

## Navigating into UI Builder

Direct URL guesses fail — `https://<instance>.service-now.com/now/experience/ui-builder` returns "Page not found". Don't guess the route.

**Reliable path:**
1. Go to any classic page, click the **All** application menu (top nav), type `UI Builder` in the filter box, wait ~1s for results to narrow (typing alone doesn't filter — the list needs a beat to refresh)
2. Click **UI Builder** under **Now Experience Framework** — opens `/now/builder/ui/home` in a **new tab**
3. On the UI Builder home screen: "Recently opened" shows experiences you've touched before, or use the **Experiences** top-nav tab to search by name
4. Click an experience card (your customer's workspace, e.g. "Facilities Workspace") → its detail page lists **Pages**
5. Use the Pages search box + type filter chips (All/Dashboard/Knowledge base/Landing/List/Record). **Click the search icon** after typing — live-typing does not auto-filter
6. A generic page like `Record` (`/record/{table}/{sysId}`) can have 20–30+ **variants**, one per table (e.g. "Case Record", "Task Record", "Standard Record"). **Click the variant name**, not the page row — the page row just expands/collapses the variant list

## Editor vs. Preview — critical distinction

- **Editor canvas**: clicking a rendered component (e.g. a sidebar tab icon) **selects it in the component tree** and opens its config in the right panel. It does **not** trigger the component's real behavior — clicking a hidden-then-unhidden tab icon here just re-selects the tree node, it won't visibly open the tab's panel.
- **Preview** (button next to Save, top-right): opens a fully live, functioning render with sample test data. Clicking a sidebar tab icon here actually opens the panel and renders real content. **Always verify a fix in Preview, not just by reading the tree** — the Editor canvas will not prove the fix works.
- Save the page (top-right **Save** button) *before* opening Preview so Preview reflects your change.

## The "Tab sidebar" component and per-tab "Hide tab" checkbox

Many workspace record pages have a component named **"Tab sidebar"** (`elementId: viewport_gph` — the same id referenced by the `workspace-activity-stream` skill). It's the vertical icon rail + slide-out panel on the right edge of a record form, typically hosting tabs like Activity, Agent assist, Attachment, Template.

**To find and fix a missing/hidden sidebar tab:**
1. In the component tree (left panel), expand `Body → Resizable panes → right → Tab sidebar`
2. Select **Tab sidebar** → **Configure** tab (right panel) → scroll to the **Tabs** list
3. Hidden tabs are labeled **`Tab (HIDDEN)`** right in the list — instant visual diagnosis, no need to open anything yet
4. Hover the tab row → a small sliders/settings icon appears on the right → click it → **"Edit settings for `<Tab Name>`"** dialog opens with: Tab label, Tab ID, Icon, Count, **Disabled** checkbox, **Hide tab** checkbox
5. Uncheck **Hide tab** → click **Save** in the dialog → then click the page-level **Save** (top-right) — the dialog's own Save does not persist to the server by itself, the page must be saved too
6. Verify in **Preview**: the tab's icon should now appear in the rail; click it to confirm the panel actually renders content (or "No X available" if the underlying data table is simply empty — that's a separate, legitimate data gap, not a visibility bug)

**Why this matters — don't chase properties/ACLs first.** A missing tab can look exactly like it's gated by a system property or an ACL, because there may genuinely be a related, official, similarly-named mechanism nearby — e.g. an installed app can ship a real, documented property that hides a *different* OOTB widget with a confusingly similar name. That property can be a complete red herring for a **specific missing tab** when the actual cause is this simple static checkbox. In one engagement, a tab that was visible on the classic form but absent in the workspace prompted an ACL investigation (a genuine but irrelevant role gap) and a system-property investigation (a genuine but irrelevant documented property) before the actual cause turned out to be the checked "Hide tab" box on that one tab — a 30-second check that would have replaced ~40 minutes of investigation. **Check the Tab sidebar's per-tab "Hide tab" setting FIRST**, before investigating properties, ACLs, data brokers, or `sysrule_view_workspace` records.

## The general "Hide component" pattern (different mechanism, most other components)

Almost every OTHER component's **Configure** tab has a **Component visibility** section:
- **Hide component**: a condition-builder expression (e.g. `record.isValid != true AND (...)`)
- **Test value** radio: **True** (component is hidden) / **False** (component will be visible) / **None** (use the live condition)

This is the general-purpose conditional-visibility mechanism (equivalent to the raw composition's `isHidden` binding you'd see reading the macroponent record via the Agent API). It's how most components are conditionally shown/hidden based on record state, ACLs, roles, etc. — the Tab sidebar's per-tab "Hide tab" checkbox is a **simpler, static, unconditional** override specific to tab-list items, layered on top of this general mechanism.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
