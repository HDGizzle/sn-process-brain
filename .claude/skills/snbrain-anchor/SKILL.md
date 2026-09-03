---
name: snbrain-anchor
description: Invoke to run the ANCHOR stage of a process-brain build, or when the user asks to "expand the seed", "resolve the update sets", "run the co-change expansion", "build the process surface", "map this process" (the expansion half). Resolves the seeded pointers with two reads each, expands them through version chains and set membership into a tiered T1/T2 surface, and casts the harvest queue from it.
---

# ANCHOR: co-change expansion from the seed

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

**The brief is the current state; this skill is the procedure. Where they disagree, the
brief wins.** If the brief's stage is not `anchor`, stop and run the stage the CLI named.

## What this stage is for

**Turning the seed into a bounded surface with a citable edge per member.** The insight:
an artifact's version chain (`sys_update_version`, rung P4) recovers every update set it
ever shipped in, and each set's membership (`sys_update_xml`, P2) yields sibling
artifacts. Artifacts that repeatedly co-ship are co-changed, and co-change is
process-membership evidence — git co-change mining, on-platform. One honest set is
self-amplifying: a 3-artifact hotfix set fans out through version chains to the process's
whole shipping history.

**Tiers**: T1 = the human named it. T2 = co-change admitted it, with the sets and weight
that prove it. There is no T3 here by design — the referenced-but-never-shipped surface
(shared script includes, global BRs) is what the harvest's existing chain-repair leg
mints from dangling references once the queue drains.

## Hard rules

1. **RESOLVE FIRST.** Each seeded set: one `sys_update_set` read (exact name, then
   STARTSWITH), one aggregate member count. Record every attempt in `resolution[]`,
   failures included — an unresolvable pointer is a finding, never a silent drop.
2. **THE STOP-AND-ASK.** If no seeded set resolves non-empty: `resolutionFailed:true`,
   the failed resolutions as evidence, one BLOCKING finding. The CLI terminates the run
   for the developer to re-aim. Never fall through to a blind sweep — a seeded run that
   quietly widens is a census with a misleading name.
3. **ONE ROUND, EXACTLY.** Axis 1 (version chains) then axis 2 (membership), once. The
   validator holds `expansion.rounds` to 1 when P2 is available; a fixpoint snowballs
   into the full instance.
4. **WEIGHT AND EXCLUDE, VISIBLY — RECOVERED SETS ONLY.** Edge weight `1/|set|`. Exclude
   Default and RECOVERED batch sets (an order of magnitude above the seeded median, or
   named as batches at seed) and list every exclusion with its member count — a silent
   exclusion reads as coverage. **A seeded set is never size-excluded.** The human pointed
   at it, so it stays `role:"seeded"` whatever its size; its `1/|set|` weight already says
   the per-member signal is weak, and the CLI mints a warning for a large one. The
   validator refuses a seeded pointer's set in role `excluded` — the second engagement's
   worker excluded a 95-member named set as a "batch" and the developer then confirmed it
   was required for completeness. The one legal way a named set leaves the surface is the
   developer's own `exclusions[]` at seed.
5. **NO ARTIFACT ENTERS THE SURFACE ON VIBES.** Every T2 member carries `evidence.sets`
   and a numeric `weight`; every T1 member carries the naming route. The validator checks
   per entry.
6. **DEGRADATION IS STAMPED.** No P4 → expand from seeded sets only. No P2 either →
   co-change unavailable; the CLI stamps `refgraph-only` and the render must carry it.
   Read provenance's rung results; do not re-probe them.
7. **Field-validate before every filtered query** (`dictionaryFields()` first), and an
   empty read is not an absence without a same-session canary — the standing platform
   rules apply here as everywhere.

## Procedure

1. Resolve each seeded pointer (rule 1). Documents don't resolve — record them
   `resolved:false` with a note; they are the claimed process, kept for questions.
2. **Axis 1 (P4)**: version chains of the seeded sets' artifacts → recovered sets,
   `via:"version-chain"`, each with **`seededOverlap`** — how many DISTINCT seeded
   artifacts appear in that set. Count it honestly: the CLI demotes recovered sets with
   overlap/members below 0.5 (unless the set shares a seeded story root) and turns their T2-only members into *neighbour gaps* (recorded, asked
   about at the interview, never harvested). Measured on pilot-run-6: chains through shared
   H&S form sections admitted the whole form-design programme as if it were the
   integration — 150 of 284 records.
3. **Axis 2 (P2)**: each live set's `sys_update_xml` entries resolved to target records.
   The preflight probe measured whether the name-parse route works on this instance —
   read its result by what it measures, not by probe number.
4. **Story chain** (only if the envelope carries stories AND provenance induced a naming
   pattern): story ids → matching set names → axis 2.
5. Emit `surface[]`, deduplicated, strongest evidence per record. Fill `seedGaps[]` with
   T2 members whose sets the developer never named — the interview's sharpest material.
6. Judge `adequacy` — converged / barren / exploded — as a measurement with the numbers
   in `why`. Barren and exploded are legal results that mint findings, never retries.
7. Write the artifact, then:

```bash
snbrain ingest --stage anchor --file <artifact.json>
```

The CLI demotes weak-overlap sets, casts the harvest queue from the ADMITTED surface
(tables with ≥5 records get their own area, smaller tables are packed into multi-table
areas of ≤15 records — a brief, not a call, is the expensive unit), records the seeded
process as the Gate 1 candidate, stamps expansion mode and adequacy, and routes to
`harvest`.

## Acceptance

- **AC-ANC-1** Every surface member carries a citable edge (T2: sets + weight; T1: the naming route).
- **AC-ANC-2** Expansion ran exactly one round, recorded.
- **AC-ANC-3** Excluded sets are listed with member counts.

## Gotchas

- **`sys_update_xml.name` parses to `<table>_<sys_id>`** for most entries, but not all
  (choice bundles, dictionary bundles ride differently). An entry you cannot parse is
  recorded in a finding with a count, not skipped silently.
- **The Default set is a set too** — version chains will surface it. It is excluded by
  rule, and its member count still gets listed.
- **A set in another scope batching multiple stories** (the batching convention
  orientation may have recorded) inflates co-change weight; when orientation stated a
  batching convention, weight by story id within the set where the pattern allows.
