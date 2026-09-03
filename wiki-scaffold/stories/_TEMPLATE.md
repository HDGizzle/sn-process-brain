---
story: <story-id>
title: "<one-line story title>"
tracker: <tracker kind, org/project, and the work-item id or link, if any>
status: <In progress / Complete>
updated-sets:
  - "<set name per naming.storySetFormat: {{storySetFormat}}> — <update_set_sys_id> (scope <app_scope>, <N> records)"
  - "<second set of the same story, or 'shipped EMPTY'>"
built: "<date range>"
affects:
  - "processes/<owning-process-page>.md"
  - "decisions.md (DEC-NNN added)"
  - "tbd.md (TBD-NNN opened/resolved)"
  - "registry-sys-ids.md"
mentions:
  - "<artifact name> — <sys_id>"
---

> Immutable build record (wiki story tier). For CURRENT behavior always consult the
> process pages / live instance — never this page.

# <story-id> — <one-line story title>

<!-- THIS IS A TEMPLATE. Placeholders in angle brackets are the point here and nowhere
     else: a live story page carries the project's own story id and set names, in the
     convention this engagement measured (naming.storySetFormat = {{storySetFormat}}),
     never a generic example from another project. The render stage generates one page
     per seeded story / work item from the anchor's resolved update sets
     (node tools/snbrain/render.js --stories); start from this file only for a story
     closed AFTER the brain was built. -->

<One-paragraph framing: what area of the implementation this story changed, which test
findings / requirements it rolled up, and a link to the owning process page(s) for
current-state mechanics. This page records the DELTA as shipped; it is never edited
after close and never re-verified.>

## What shipped (delta narrative)

<!-- Bulleted narrative of the change as a delta against the pre-story state. Each bullet:
     what changed, why (link DEC-NNN for decisions), and what enforces it. Write history,
     not current state: "the button was retired", not "there is no button". -->

- **<Headline change>** — <what/why; cite [decisions](../decisions.md) entries taken here>.
- **<Second change>** — <…>.

## Update sets

<!-- Every set that shipped this story, exact names, with the sys_id and member count the
     anchor stage resolved. Multiple sets per story are normal (a descriptive suffix such as
     "UI messages", a same-named set in another scope). A set that pairs to no story is an
     unresolved link and is reported as a finding, never dropped. -->

| Set | sys_id | Members | Role |
|---|---|---|---|
| <set name> | `<sys_id>` | <N> | seeded / recovered |

## Shipped records

<!-- Inventory of records created/modified, grouped by function. sys_ids here are
     SHIPPED-RECORD HISTORY (what was created then); current values resolve via
     ../registry-sys-ids.md. -->

| Record | Table | sys_id |
|---|---|---|
| <name> | <table> | `<sys_id>` |

## Decisions taken

| ID | Decision (one line) |
|---|---|
| [DEC-NNN](../decisions.md) | <one-line decision> |

## Open items at close

| ID | Item |
|---|---|
| [TBD-NNN](../tbd.md) | <one-line item> |

## Deploy notes

<!-- Everything a deployer to the next environment must know: update-set commit order,
     manual per-environment steps that do NOT ride update sets (dictionary flips,
     scheduled jobs, group memberships — see gotchas capture holes), migration/fix-script
     ordering, and what to verify after commit. Mirror the environment state into
     ../deployment-matrix.md. -->

- <step / caveat>
