---
title: TBD Register
last-verified: <fill at engagement>
---

# TBD Register

> **Single source of truth** for all open items (TBDs) across the project's stories.
> New items: append to **Open** with the next sequential ID. Closing an item: **move**
> its row to **Resolved** with a one-line outcome and a date — never just delete it.
> **IDs are never reused**, even when an item turns out to be a non-issue: the row moves
> to Resolved with that outcome, and the number stays burned.

## Register rules

- **Sequential IDs, append-only.** TBD-001, TBD-002, … in order of registration. Gaps
  are allowed (see Numbering notes) but numbers are never recycled.
- **One row per item**, one line of text. If an item needs more than a paragraph, it is
  a story, not a TBD — link the story and keep the row short.
- **Close with an outcome, not silence.** The Resolved row must say WHAT resolved it
  (story, external fix, "not a defect — rationale"), in one line, with a date where known.
- **Escalations stay visible.** Deployment blockers get a bold marker in the item text
  (e.g. **HARD prod-cutover blocker**) so a pre-deploy sweep of this page finds them.
- Cross-reference decisions ([decisions.md](decisions.md)) and stories by ID; keep
  current-state mechanics on the owning process page.

## Open

| ID | Story | Item |
|----|-------|------|
| TBD-000 | STRY0000001 | DELETE-ME example: align the definitive group structure with platform administration — current structure is initial. |

## Resolved

| ID | Story | Resolution | Date |
|----|-------|------------|------|
| — | — | *(rows move here from Open with a one-line outcome + date)* | — |

## Numbering notes

<!-- Record every numbering irregularity here so the sequence stays auditable:
     skipped numbers, collision repairs ("recorded elsewhere as TBD-0NN; renumbered here"),
     ids burned by retracted items. An unexplained gap is a future archaeology session. -->

- *(none yet)*
