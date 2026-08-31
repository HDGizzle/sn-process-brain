---
story: STRY0000000
title: "<one-line story title>"
tracker-id: <backlog/tracker work-item id, if any>
status: <In progress / Complete>
updated-sets:
  - "STRY0000000.00 — <update_set_sys_id> (scope <app_scope>, <N> records)"
  - "STRY0000000.01 — <same-named set in another scope, or 'shipped EMPTY'>"
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

# STRY0000000 — <one-line story title>

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
