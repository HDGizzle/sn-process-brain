---
title: sys_id Registry
last-verified: <fill at engagement>
---

# sys_id Registry

> ⚠️ **Always verify before use.** sys_ids change between instances and after rebuilds —
> dev / test / acc / prod **diverge** (dictionary overrides are a classic example; scope
> sys_ids and generated artifacts too). Use a live query to confirm any row before
> relying on it. API writes against a stale sys_id fail **silently** — see
> [gotchas](gotchas.md).

## Notation & legend

| Marker | Meaning |
|---|---|
| `verified <date> <instance> ok` (Note column) | Row confirmed against that live instance on that date. **Unmarked rows are unverified.** |
| `verified <date> <instance> DRIFTED: …` | Live state differs from the documented value — the note says how. Fix the row, keep the drift note. |
| `CONFLICT` | Sources disagree on the value; both are kept until a live query resolves it. |
| `DRIFT` | Documented value known superseded on the live instance. |
| `abc123…` or bare 8 chars | **Prefix** as recorded in source docs, not a full sys_id — resolve on the live instance before use. |
| `*varies per instance*` | Never hardcode: query it per instance (e.g. `sys_scope` where `scope=<your_scope>`). |
| `(OOTB — verify on your instance)` | Platform-shipped record; sys_id is usually identical across instances but must still be confirmed once per instance. |

**Registry rules**

- Current sys_ids live **only** on this page (name, table, sys_id, owning story link,
  note). Other pages link here; story pages may inline sys_ids solely as shipped-record
  history.
- Verification is **on-touch**: whenever a story-close or repair touches a row, stamp it.
  There is no calendar sweep.
- When a build note says a record's sys_id was not captured ("harvest at live
  verification"), add a placeholder row naming the record and mark it `sys_id: harvest
  at live verification` — an absent row is how an id gets re-invented wrongly.
- Never copy a sys_id out of this page into code or config without a same-day live
  read-back on the target instance.

## Scopes

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| global | sys_scope | literal `"global"` | — | Accepted as-is by `create_artifact` |
| x_acme_fm (example app scope) | sys_scope | *varies per instance* | — | DELETE-ME example: query `sys_scope` where `scope=x_acme_fm` per instance |

## Workspace UX

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |

## Roles & groups

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |

## Business Rules

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |

## Script Includes

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |

## SLAs & schedules

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |

## Other

| Name | Table | sys_id | Story | Note |
|---|---|---|---|---|
| | | | | |
