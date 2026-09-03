---
name: platform-analytics-dashboards
description: Invoke when building, editing, or migrating a "Platform Analytics" dashboard or visualization — "par_dashboard", "par_visualization", "Analytics Center", "PA dashboard", "native dashboard", a workspace dashboard "landing page" — or any dashboard that is NOT classic sys_report / pa_dashboards. Covers par_ builds via fix script, single-score/list tiles, dynamic per-user filters, per-experience visibility, and surfacing a dashboard as a workspace landing page.
---

# Platform Analytics Dashboards (the `par_` framework)

Applies to ServiceNow Washington and later (Platform Analytics / `par_` framework).

Modern ServiceNow has **two** dashboard stacks. Know which one is wanted:

| Layer | Classic / **deprecated** | **Platform Analytics (use this)** |
|---|---|---|
| Report / visualization | `sys_report` | **`par_visualization`** |
| Dashboard | `sys_dashboard` / `pa_dashboards` | **`par_dashboard`** |
| Tabs / canvas | `pa_tabs` / `sys_grid_canvas` | **`par_dashboard_tab`** / **`par_dashboard_canvas`** |
| Tile placement | `sys_portal` + prefs + `sys_grid_canvas_pane` | **`par_dashboard_widget`** |
| Visibility | roles on report/dashboard | **`par_dashboard_visibility`** (per experience) |

If a user says "use Platform Analytics, not the deprecated reports," you must build `par_*`. The **Migration Center** (`/now/platform-analytics-workspace/migration-center`) can convert classic→PA but is a UI wizard you cannot drive headless — recreate natively instead.

## The data model (full chain)

```
par_dashboard (name, active, grid="48", sys_ux_* can be empty)
  └─ par_dashboard_tab (dashboard, name, order, active)
       └─ par_dashboard_canvas (dashboard, dashboard_tab, layout=JSON[])
            └─ par_dashboard_widget (canvas, visualization, stored_component,
                                     component(=macroponent), component_props, name, x,y,w,h)
par_visualization (name, title, type, macroponent, properties=JSON, active)
par_dashboard_visibility (dashboard, experience -> sys_ux_page_registry)
```

Key facts learned the hard way:
- **Grid is 24–48 columns** (read the dashboard's `grid` value; 48 is common). `w/h/x/y` are grid units.
- A widget references its saved viz via **`stored_component`** (a background rule moves `visualization` → `stored_component` and clears `visualization` on insert — empty `visualization` is normal). **Querying `par_dashboard_widget` by `visualization=<viz>` returns NOTHING** — always query/join by **`stored_component`**. Corollary: `par_visualization` records are **NOT orphans** just because no `widget.visualization` points to them — they're referenced through `stored_component`. Don't "clean them up."
- **Each tab has its own `par_dashboard_canvas`** (`dashboard_tab` set), PLUS the dashboard has **one tab-less default canvas** (`dashboard_tab` empty). An empty placeholder tab still needs its (empty `layout:"[]"`) canvas to exist.
- `par_dashboard_widget.component_props` is a **copy** of the viz `properties`; the **`par_dashboard_canvas.layout`** JSON *also* embeds each tile — and crucially **each `layout` item's `sys_id` IS the `par_dashboard_widget.sys_id`** (plus `x,y,w,h,component_id,component_props,can_edit`). The canvas renders a tile only when a widget with that sys_id is bound to that canvas. All three (viz `properties`, widget `component_props`, canvas `layout` item) must stay in sync.
- ⚠️ **Copying a canvas `layout` alone does NOT move/duplicate the content** — the layout points at widget sys_ids; without recreating the widgets on the new canvas the tab renders **empty**. See "Moving a dashboard into a scope" below.
- Creating a `par_dashboard` **auto-creates a default tab** ("New Tab 1"). Reuse it as your first tab (rename + reorder) instead of leaving an orphan.
- A dashboard only appears in an experience that has a **`par_dashboard_visibility`** row pointing to that experience's `sys_ux_page_registry`. The "Platform Analytics" experience makes it show in Analytics Center; a **workspace** experience makes it selectable inside that workspace.

## Macroponents (the `component` / viz type)

| Viz type | `par_visualization.type` | macroponent (`component`) |
|---|---|---|
| Single score | `Single score` | `d24d53f60350de7a652caf3188a46ed2` (OOTB — verify on your instance) |
| List | `List` | `7ff373544303121093711347efb8f23c` (OOTB — verify on your instance) |

(Bar/pivot/etc. exist too — query an existing `par_visualization` of that type to grab its macroponent.)

## The `properties` JSON (the hard part)

Built by the Analytics Center UI; you replicate it server-side with `JSON.stringify`. The data query lives in `dataSources[].tableOrViewName` + `dataSources[].filterQuery`, joined to `metrics[]` by a shared base64 `id`.

- `dataSources[].id` = `base64("table" + tableName + <unique token>)`
- `metrics[].id` = `base64(dataSources[].id + <unique token>)`  ·  `metrics[].dataSource` must equal `dataSources[].id`
- Use `GlideStringUtil.base64Encode()` (scoped-safe) and a per-call unique token; exact token value is irrelevant, only internal consistency.
- Single score: `metrics[].aggregateFunction="COUNT"`. List: also set top-level `table` + `columns` (comma-separated fields that exist on the queried table).
- Keep `configVersion:"23.0.0-ci-SNAPSHOT"` (or copy from a live viz).

See `assets/build_par_dashboard.template.js` and `assets/update_par_filters.template.js` for working `ssProps()`/`listProps()` builders.

## Dynamic, per-user filters (encoded query)

- **Assigned to me:** `assigned_to=javascript:gs.getUserID()`
- **One of my groups:** `assignment_groupDYNAMIC<sys_id of "One of My Groups">` — find it in `sys_filter_option_dynamic` (script `gs.getUser().getMyGroups()`). OOTB sys_id: `d6435e965f510100a9ad2572f2b47744` (OOTB — verify on your instance).
- **Class filter (Task-extended parent):** `sys_class_nameINchild_a,child_b` — e.g. to count two child types together on a parent table (example): `sys_class_nameINx_acme_fm_case,x_acme_fm_request`.
- These evaluate per viewing user, so tiles read 0 for admins not in the relevant groups — verify by impersonating a real persona.

## Build / update via fix script (the reliable method)

The agent API has **no delete** and embedding huge JSON in `create_artifact` is brittle. Use a **fix script** with `JSON.stringify`:
- **Scope (IMPORTANT — verify on your instance first):** the `par_*` tables are **platform-scoped**, and a **custom-scoped** fix script (e.g. `x_acme_fm`) **cannot write to them** — `GlideRecord.update()/insert()` is denied **silently** (no error, finishes instantly, nothing changes). So **always run the fix script from GLOBAL** and call `gs.getSession().setApplicationId('<scope sys_id>')` at the top to stamp new records into the right scope.
  - The changes are still captured in the **scoped** update set (e.g. the story-named set) as long as (a) the affected records are that scope and (b) that scope's update set is active when it runs — capture follows the *record's* scope, not the runner's. So a global runner + scoped records + active scoped update set = changes in the right update set.
  - Net: don't bother making the runner scoped for `par_*` work; it'll no-op. Keep the runner global; verify changes captured in the intended update set afterward.
- **Update-set capture (verify on your instance first):** server-side GlideRecord create/update of `par_*` from a fix script does **NOT** auto-record into an update set — even with the right scope/active set, `sys_update_xml` ends up empty. (The **Table API** path — `create_artifact`/`update_record` with `sysparm_transaction_scope` — *does* capture, e.g. `par_dashboard_visibility`.) After any scripted par_ build/edit, **force-capture**: in a GLOBAL fix script set the target update set with `new GlideUpdateSet().set('<update_set_sysid>')`, then for every record (`par_dashboard`, `par_dashboard_tab`, `par_dashboard_canvas`, `par_dashboard_widget`, `par_visualization`, `par_dashboard_visibility`) do `gr.get(sysId); gr.setForceUpdate(true); gr.update();`. Verify with `sys_update_xml` (`name=par_dashboard_<sysid>` etc.). See `assets/capture_par_to_updateset.template.js`. Always confirm capture by querying `sys_update_xml` — do not assume.
- **Idempotent build:** delete prior `par_dashboard` (by name+scope) + its tabs/canvas/widgets + same-named `par_visualization` first, so re-runs don't duplicate.
- **In-place edits (preferred once a dashboard is live & embedded):** update `par_visualization.properties` + matching `par_dashboard_widget.component_props` + the canvas `layout` entry — do NOT recreate the dashboard, or you break its sys_id, workspace page binding, and visibility rows.
- Set the session update set first (`switch_context` updateset) and verify with `gs.info` output.

## Agent API (Table API) path — `create_artifact` / `update_record` (agent-friendly)

For **moves and surgical edits** (not bulk builds) the Table API is cleaner than the fix-script dance, and it **auto-captures** into the active update set:
- Switch BOTH `switch_context` updateset AND `switch_context` application (to the target scope) first. Then `create_artifact`/`update_record` with `"scope":"<scope sys_id>"` writes `par_*` records **in that scope** and they land in the active update set automatically (Table API uses `sysparm_transaction_scope`, which the scoped-GlideRecord path can't do).
- **`create_artifact` on `par_dashboard_canvas` / `par_dashboard_widget` REQUIRES a `name` field** — without it the agent server returns **HTTP 400** (even though the UI leaves `name` blank). Pass any name (e.g. `"Overview canvas"`).
- Big `layout` JSON: build the request body programmatically (e.g. Python `json.dumps`) and POST it — don't hand-escape nested quotes.
- After writing, **read back** (`get_record`) and confirm field values + that `sys_update_xml` has the row. Table API reports "Update sent", not "committed".

## Moving a dashboard (or its tabs/canvases/widgets) into a scope — the scope-capture trap

**Symptom:** the scoped update set deploys an **empty / skeleton** dashboard (shell + placeholder tabs, no tiles). **Cause:** tabs/canvases/widgets created or edited in the **Analytics Center often land in `global` scope** even when the `par_dashboard` itself is scoped. A **scoped update set silently does NOT capture global-scope rows**, so the real content (the content tab + its canvas + its widgets) is left behind.

Diagnose: list `par_dashboard_canvas` / `par_dashboard_tab` / `par_dashboard_widget` for the dashboard and check each `sys_scope`. The content tab/canvas being `global` while the dashboard is scoped is the smoking gun.

Fix (recreate in target scope, then delete the global originals):
1. Switch updateset + application scope to the target (e.g. `x_acme_fm`).
2. Recreate the **tab** (`create_artifact par_dashboard_tab`, `dashboard`+`order`+`active`+`name`) in scope.
3. Recreate the **canvas** (`create_artifact par_dashboard_canvas`, `dashboard`+`dashboard_tab`+`name`+`layout`=verbatim copy of the global canvas's `layout`).
4. Recreate **every widget** (`create_artifact par_dashboard_widget`, copy `name`/`component`/`stored_component`/`component_props`/`widget_props`/`x/y/w/h`, set `canvas`=new canvas) and build an **old→new sys_id map**.
5. **Rewrite the new canvas `layout`**: string-replace each old widget sys_id with its new sys_id (the layout item `sys_id` must equal the new widget sys_id), then `update_record` the `layout`. Verify "0 old ids, N new ids" remain.
6. If the project is multilingual, add name translations for the new tab (see Translations).
7. **Delete the global originals** (widgets → canvas → tab) — `delete_record` is usually disabled (`E_DISABLED`), so use a **global background script** with `gr.setWorkflow(false)` (they were never shipped, so suppress capture; deleting global rows from a scoped session is blocked anyway).
8. **Force-capture** any placeholder tab canvases (`new GlideUpdateManager2().saveRecord(gr)`) if they were never captured.
Verify byte-for-byte that the new canvas `layout` equals the old, and re-pull `sys_update_xml` to confirm only scoped rows remain.

**Extras that get swept in and should NOT ship** (strip from the update set): `par_dashboard_user_metadata` (per-user state), `sys_uib_screen_test_values` (UI Builder preview data), `sys_metadata_link` "Metadata Snapshot". The no-op `DELETE` rows from a rebuild (the old replaced widgets/canvas/tab) are harmless but can be stripped for tidiness.

## Cell highlighting (the red/orange due-date bar)

The coloured pill on a list cell (e.g. overdue=red, due-soon=orange) is a **workspace Highlighted Value**, honored by Platform Analytics lists. It is **two records**, NOT CSS in the dashboard and NOT a classic field style:
- `sys_highlighted_value` — one per **table+field** (e.g. `table=x_acme_fm_case`, `field=due_date`).
- `sys_highlighted_value_condition` (children) — each = a filter + a colour:
  - `conditions` = encoded query, can use server JS (`due_date<javascript:gs.beginningOfToday()` for overdue; `due_date>=…beginningOfToday()^due_date<=…gs.daysAgoEnd(-3)` for "within next 3 days").
  - `color` = semantic token: `critical`=red, `warning`/`orange`=orange, `positive`=green, `info`=blue. (Prefer `critical`/`warning` tokens for consistency.)
  - `variant` = `tertiary` → **filled pill** (the visible bar); other variants = outline/text.
  - `order` — **lower wins** when two conditions match the same row (overdue `100` beats due-soon `200`).
- If a colour "doesn't show," first check there's **data in that window** (e.g. no record due in the next 3 days → no orange renders — it's a data situation, not a config bug). Test by setting a record's `due_date` into the window.
- **Distinct from `sys_ui_style`** (classic Field Style): that colours **text** in classic lists/forms (`style:"color: red;"`, `value:"javascript:…"`), is table-specific, and is NOT what the PA list pill comes from. Don't confuse the two when asked "where does the red come from."

## Translations (multilingual names)

Language pair comes from `product.config.json` (`language.source` / `language.targets`). Only **names** are translatable — `par_dashboard`, `par_dashboard_tab`, `par_visualization`, `par_component`. **Tile header text is static** (lives in `component_props.headerTitle` / the canvas `layout`) and is **not** translatable via `sys_translated` — true per-tile translated headers need saved visualizations, not inline headers.
- Translation rows live in **`sys_translated`**: `name`=table, `element`=field (`name` or `title`), `language`=target language code, `label`=translated text.
- For `par_dashboard_tab` the `value` uses a composite key format: `value = "TAB_SYS_ID:<tab_sys_id>:<source-language name>"`, `label`=translated text. Build to the source language first, then add the translation row.

## Make a dashboard the homepage / landing page of a configurable workspace (audience-based)

The workspace **home route** (`sys_ux_app_route` `route_type=home`, one per app config) has **no "default screen" field**. It resolves to the **active `sys_ux_screen` whose `screen_type` matches the route's `screen_type` (the "Home" type) AND whose audience matches the user**. So the homepage is decided by **screen_type + Screen Applicability (audiences)**, not by editing the route.

To make a dashboard the homepage:
1. **Host the dashboard in a screen.** A `sys_ux_screen` (in the workspace `app_config`, scope = your app) whose `macroponent` embeds the dashboard, with `screen_type` = the workspace's **Home** type and `active=true`. (Plus its client scripts/event for the dashboard component.)
2. **Add `par_dashboard_visibility`** for the workspace experience so the dashboard is allowed in that workspace (and one for "Platform Analytics" for the Analytics Center).
3. **Link the screen to audiences** via **`sys_ux_applicability_m2m_screen`** (`screen` → `applicability`). The user lands on this screen if they match one of its linked audiences.

**"Homepage for everybody" (interim, one home for all):**
- Link the screen to the **broad workspace audiences** — the workspace-access audience (example: *ACME FM Workspace*) and the default-home audience (example: *ACME FM Home default*). These cover all workspace roles. Check the audiences' `roles` lists to confirm coverage of every persona role (a niche role in only one audience can fall through — verify the **union** covers everyone you mean by "everybody").
- ⚠️ **Dual-matching trap:** if **two `active` Home-type screens** match the **same** audience, resolution is ambiguous and the landing won't be deterministic. Per-persona landings are handled by **one dedicated audience → one screen**. For "everybody now", make sure the dashboard is the **only active Home screen** (persona screens `active=false`) — then broadening its audiences can't conflict.

**What ships vs. what's a dependency** (when this is in a scoped update set):
- **Ships (captured):** the `sys_ux_screen`, its `macroponent` + client scripts + event, and the **`sys_ux_applicability_m2m_screen`** links (they take the screen's scope).
- **Pre-existing on target (referenced, NOT shipped — they come from earlier work/OOTB):** the **audiences** (`sys_ux_applicability`), the **Home `screen_type`**, the **parent macroponent**, the **home route**, and the **inactive state of competing persona screens**. Flag these as deploy dependencies.

(Alternative/older approach: a UI Builder page using the **Dashboards** page template + repointing the `home` route. The audience+screen_type mechanism above is the recommended, field-verified pattern.) Only **Experience (`par_`) dashboards** can live in a workspace — classic ones must be migrated.

## Testing a per-user dashboard

Tiles/lists use per-user dynamic filters, so a developer/admin not in the relevant groups sees an **empty** dashboard — that's expected, not a bug. To verify rendering, highlighting, and counts: take a record on the queried table, set its **`assignment_group`** to one of *your* groups (so the "one of my groups" filter matches) and/or **`assigned_to`** = you, set `state`/`due_date` to hit the tile/colour you're testing, then refresh. Revert the test record afterwards.

## Instance reference sys_ids — query them, then record them

Never hardcode instance-specific sys_ids from memory. On each engagement, resolve them once and record them in the project's sys-id registry wiki page:

| Thing | How to find it |
|---|---|
| Target app scope sys_id | `sys_scope` where `scope=<your scope name>` (e.g. `x_acme_fm`) |
| Workspace app config | `sys_ux_app_config` — filter by the workspace's name |
| Workspace experience (page registry) | `sys_ux_page_registry` — filter by the workspace's title/path |
| Workspace `home` route | `sys_ux_app_route` where `app_config=<app config>` and `route_type=home` |
| "Platform Analytics" experience | `sys_ux_page_registry` — title "Platform Analytics" |
| "One of My Groups" dynamic filter | `sys_filter_option_dynamic` — script `gs.getUser().getMyGroups()` (OOTB `d6435e965f510100a9ad2572f2b47744` — verify on your instance) |
| Single score / List macroponents | query an existing `par_visualization` of that type and read `macroponent` (OOTB ids above — verify on your instance) |
| Parent task table + children | `sys_db_object` where `super_class.name=<parent table>` |

## Pitfalls checklist
- Built `par_*`, not `sys_report`/`pa_dashboards`. ✅
- Visibility row exists for every experience the dashboard must appear in (Analytics Center AND the target workspace).
- Widget `component`(macroponent) matches the viz type; `stored_component` = viz sys_id (query widgets by `stored_component`, never `visualization`); `component_props` == viz `properties`; canvas `layout` item sys_id == widget sys_id.
- List `columns` are fields that exist on the queried table (parent-table lists can't use child-only fields → use `sys_class_name` for "type").
- **Every sub-record (tab/canvas/widget) is in the TARGET scope, not `global`** — else a scoped update set deploys an empty dashboard. Check each `sys_scope`.
- **Moving/duplicating a dashboard: recreate the widgets and rewrite the canvas `layout` sys_ids** — copying the canvas `layout` alone gives an empty tab.
- `create_artifact` on `par_dashboard_canvas`/`par_dashboard_widget` includes a `name` field (else HTTP 400).
- Stripped non-shippable extras: `par_dashboard_user_metadata`, `sys_uib_screen_test_values`, `sys_metadata_link` snapshot.
- Homepage: the dashboard's screen is the **only active Home-type screen**, linked to audiences covering everybody you mean; competing persona screens `active=false`; audiences/screen_type/parent_macroponent/home-route confirmed to pre-exist on target.
- Cell highlighting is `sys_highlighted_value` (+ `_condition`, `variant=tertiary`, lower `order` wins), NOT `sys_ui_style` and NOT dashboard CSS.
- Fix script scope correct; no `setApplicationId` in a scoped fix script. (For moves/edits, prefer the Table API path — it auto-captures.)
- Verify by impersonating a real persona / assigning a test record to your group (dynamic filters hide data from admins).

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
