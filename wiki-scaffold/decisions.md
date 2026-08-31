---
title: Decision Ledger
last-verified: <fill at engagement>
---

# Architectural Decision Ledger — DEC-001..DEC-NNN

> **Single-source ledger** of all architectural/functional decisions for this
> implementation. **Verify before use:** sys_ids, properties, and instance state drift
> between environments and after upgrades — confirm concrete record references against
> the live instance (and [registry-sys-ids](registry-sys-ids.md)) before relying on them.

## Ledger rules

- **Append-only, sequential numbering.** New decisions take the next free DEC number.
  **Never renumber** — a DEC id, once published, is a permanent address other pages,
  stories, and commits cite.
- **Never reuse a number**, even if a decision is retracted. Retired numbers stay in the
  ledger with their outcome.
- **Supersede in place.** When a later decision replaces an earlier one, mark the OLD
  entry's heading with `⚠️ SUPERSEDED by DEC-NNN` (plus a one-line note of what changed)
  and keep its body — do not delete or rewrite history. The NEW entry states what it
  supersedes.
- **One entry per decision**, written at story-close (or when the decision is taken, if
  earlier). Current-state mechanics belong on the owning process page — the ledger
  records the decision, its rationale, and its consequences, then links out.
- If two branches ever mint the same number independently, resolve the collision here
  and record it in a **Numbering notes** section (see [tbd.md](tbd.md) for the pattern).

## Entry format

```
### DEC-NNN — <one-line decision title>
**Story** <story-ref> — **Decision:** <what was decided, and the alternative(s) rejected>.
**Impact:** <consequences, constraints on future work, what to re-verify after upgrades>.
```

---

### DEC-000 — DELETE-ME example: module operates independently from the adjacent OOTB suite
**Story** STRY0000001 — **Decision:** all relationships between the OOTB suite's roles/groups and this module are removed; the module gets its own group structure. **Impact:** prevents conflicts in role assignment, routing, and authorization; provisioning happens only through the module's own groups. *(This dummy row shows the format — delete it when the first real decision lands.)*

---

*Append new decisions sequentially (DEC-001, DEC-002, …): number — one-line decision —
impact/consequences — owning story. Never renumber; supersessions are noted in place,
never deleted.*
