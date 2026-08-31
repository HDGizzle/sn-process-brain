---
title: Deployment Matrix — story × environment
last-verified: <fill at engagement>
---

# Deployment Matrix — story × environment

> Registry-class page. **Evidence source:** name it in this header every time the matrix
> is refreshed — e.g. `sys_remote_update_set` query on the target environment, N rows,
> date. Dev counts as "built by definition"; environments you have no authenticated
> access to stay **explicitly UNKNOWN** (an unauthenticated read returns silent-empty,
> not an error — see [gotchas](gotchas.md)).
>
> **State legend:** `committed` = live on that environment · `previewed` = retrieved,
> preview run, NOT applied · `loaded` = retrieved only, NOT applied · `backedout` =
> rolled back. Only `committed` means deployed.

## Matrix

<!-- One row per story (or per update set where a story ships multiple .NN sets).
     Refresh from evidence, never from memory or "should be there". -->

| Story / set | dev | test | acc | prod |
|---|---|---|---|---|
| STRY0000001.00 — DELETE-ME example | built | committed | UNKNOWN | UNKNOWN |

## ⚠️ Flagged anomalies (action needed)

<!-- Any set whose state is not a clean `committed` on an environment it should be live
     on: previewed-not-committed, loaded-only batches, stuck `committing`, backedout +
     recommitted pairs (verify order). Each row says what to verify or do. -->

| Set | State | Meaning / action |
|---|---|---|
| *(none flagged)* | | |

## Notes

- **Manual per-environment steps are invisible to this evidence.** Dictionary flips,
  scheduled-job rework, group-role deletions, records that never ride update sets
  ([gotchas](gotchas.md) capture holes) — their done-state per environment lives in the
  story pages / deployment runbooks, not here. A fully `committed` row does NOT mean the
  runbook ran.
- Update-set evidence proves retrieval/commit state only — it does not prove the commit
  had no collisions or skipped records; check preview logs for suspect sets.
