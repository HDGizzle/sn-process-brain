---
name: snbrain-provenance
description: Invoke to run the PROVENANCE stage of a project-brain build, or when the user asks to "check provenance", "do update sets tell the story here", "how does this customer ship", "can we do archaeology on this instance", "is there change history", "was this instance cloned". Probes which provenance rungs actually exist and makes archaeology conditional on the answer.
---

# PROVENANCE: which rungs exist on THIS instance

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, what to do, the inputs, the artifact, the acceptance
conditions, the remaining budget, the iteration and the cap. **The brief is the current
state; this skill is the procedure. Where they disagree, the brief wins.** If the stage is
not `provenance`, stop and run the stage the CLI named.

## The assumption this stage exists to destroy

**Update sets are not the change history.** They are one rung, they are the most fragile
rung, and four common realities break them outright:

| What breaks it | What it does |
|---|---|
| **Instance clone** | truncates `sys_update_set` and `sys_update_xml` history, and commonly excludes `sys_update_version` entirely. The instance looks like it has no past |
| **Source-control-linked apps** | changes arrive by pull, not by promotion. No set, real history |
| **CI/CD pipelines** | a service account authors everything, so author-keyed clustering collapses |
| **Store installs** | vendor content arrives as a package version, invisible to set archaeology |

A run that assumes sets and finds none will report "no changes found", which is the same
silent-empty failure the guard layer exists to prevent, one level up the stack. **Detect
how this customer actually ships, then make archaeology conditional on the answer.**

## Read discipline, non-negotiable

Every read goes through `tools/snbrain/lib/api.js`. Field-validate every encoded query
against `session.dictionaryFields(table)` before issuing it: the silent clause-drop is
**confirmed on this transport**, an unknown field returns unfiltered rows. Zero rows is
never absence without a canary. Stream every response to `.brain/raw/provenance.ndjson`.

Read the preflight and census artifacts for facts already settled. Do not re-derive the
install floor, the band sizes or the probe verdicts.

## The ladder, probed

Ten rungs. Probe each, record which exist, and record **how each one dies** here.

| Rung | Source | Yields | Clone-resilient |
|---|---|---|---|
| **P1** | `sys_update_set` name, description, state, parent | story id, sub-set number, tracker id, a human-written intent phrase | no |
| **P2** | `sys_update_xml` for the set | the built list, the co-shipped cluster, intra-set ordering | no |
| **P3** | a story id embedded in a live artifact's `name`, `description`, `short_description` or condition | artifact to story link **with no update sets at all** | **yes** |
| **P4** | `sys_update_version` payload, on demand | **prior field values, the delta** | often no |
| **P5** | `sys_metadata` created and updated by and on, `sys_mod_count` | change episode by author and time window | **yes** |
| **P6** | **retired** | was `sys_customer_update`, a customer-touched flag. No such table or column exists on any instance; the string is the label of `sys_update_xml`, so this rung was P1/P2 under an alias | n/a |
| **P7** | `sys_metadata_delete` | the GONE class, plus deleter and date | yes |
| **P8** | script comments and JSDoc in `script`, `client_script`, `advanced_condition` | verbatim human WHY sentences, TODO and FIXME markers, story ids in comments | **yes** |
| **P9** | `sys_audit` | field-level before and after | depends on clone profile |
| **P10** | journal and description fields on on-platform tracking records | acceptance criteria, discussion | yes |

## Procedure

**1. Update-set volume.** `sys_update_xml` row count across all sets **including
Default**. One aggregate call.

**2. Set states and naming.** `sys_update_set` counted by state. Then induce the name
pattern rather than hardcoding it: cluster all set names, extract the most frequent
`^([A-Z]{2,6}\d{5,8})` shape, and accept it only at support 0.7 or better over at least
8 rows. **The induced pattern is for parsing only, never as a question source.**

> One set name yields four facts with zero model calls. `"STRY0185005.00 - User Story
> 1219475: Uitwerking streefdata acties en case"` gives a story id, a sub-set number,
> an external tracker id and a human-written intent phrase.

**3. Version depth, and this is the distinction that matters.** Count `sys_update_version`
rows, **and separately count the records holding more than one version.** Multi-version
history recovers prior values. Single rows recover nothing. A total that does not separate
the two is not a measurement of this rung.

**4. The GONE class.** `sys_metadata_delete` count. Nothing else catches the case where a
flow is documented as deactivated and has actually been deleted.

**5. The record-level rung, formerly `sys_customer_update`.** Read the preflight verdict;
do not re-probe. There is nothing to probe under that name: it is not a table and not a
column on any instance, it is the label of `sys_update_xml` ("Customer Update"), so P6 is
retired.

> The rung is **update-set membership**, joined on the key the platform already provides:
> `sys_metadata.sys_update_name` IS `sys_update_xml.name`, with `sys_update_set` grouping
> those rows into the co-shipped cluster. Validate `name` on `sys_update_xml` before
> filtering on it, because the clause-drop returns unfiltered rows and would read here as
> total coverage of every population. The kill criterion decides: if membership covers a
> known base population and a known customer population **indiscriminately**, or covers
> neither, the record-level rung is dead and package level is the only path. It is not
> clone-resilient either way — a clone truncates `sys_update_xml` with the rest of the
> update-set tables, and package level is what survives.

**6. How this instance ships.** `sys_app` and store-app versions plus `sys_upgrade_history`.
This answers clone recency and the shipping model in the same two calls.

**7. Deliberateness.** One group-by on `sys_update_xml` by `update_set.is_default`,
restricted to the install floor. Thirty seconds of transport, and it is the difference
between "customer-authored" and "customer-decided".

**8. P3, the rung that survives everything.** Scan every Band A artifact's `name`,
`description` and `short_description` for the induced story pattern. The fields are
already read, so it is free, it is clone-resilient, and it is independent of update sets
entirely. This is the rung that catches a renamed record carrying its story id when every
set-shaped rung is gone.

**9. `sys_audit` availability.** Probe once. Availability, not a sweep.

**10. The sweep pre-check, which is a budget guard and not an optimism.** Before any
`sys_update_xml` membership sweep, issue **one** aggregate count with the scoped and dated
filter. Above the configured ceiling (default 25,000 rows, roughly 250 pages, about 12% of
the map budget) **do not sweep**: fall back to the record-level and package-level
predicates, stamp `authorship: 'metadata-only'`, and **record which signals lost strength**.
Designed degradation with a number, not a judgement call at the keyboard.

## Division of labour with CENSUS, read this before you start

Census owns the authorship distribution, the banding and the four-part discrimination gate
that produces the `usable`, `no-customer-surface`, `filter-non-discriminating` and
`authored-but-undeliberate` branches. This stage owns the rungs.

The one piece that can sit on either side is the **predicate calibration**: three
certainly-base records per table family as a negative control, three authored ones as a
positive control, every candidate predicate scored against **both** with all scores recorded,
and the winner is the one that admits **zero** of the negative control. **Acceptance on that
step is zero false admits, and presence of an authorship column is not discrimination.**

**Do it where the brief asks for it. Do not do it twice, and do not skip it because you
assumed census had it.** Read the census artifact first: if it already carries a calibrated
predicate with its control scores, consume it and stamp the rungs. If it does not and the
brief does not ask you to calibrate, record that as a finding rather than choosing a
predicate by judgement.

## Stamps: exactly one provenance stamp, exactly one authorship stamp

| Envelope state | Stamp | What dies |
|---|---|---|
| P1 to P9 present | `provenance: 'full'` | nothing |
| no update sets, P1 and P2 gone | `provenance: 'metadata-only'` | set-anomaly signals die entirely; recency-versus-discipline signals become **unavailable**, not degraded; cluster dissent keeps author and time but its same-episode discriminator degrades to a timestamp comparison |
| cloned, versions excluded, P4 also gone | `provenance: 'current-state-only'` | every delta-gated signal |
| nothing but `sys_metadata` columns | `provenance: 'columns-only'` | cluster dissent and recency both |

| Authorship stamp | When |
|---|---|
| `full` | record-level authorship discriminates |
| `package-level-only` | CI/CD or source-control deploys under a service account, or the record-level column is dead |
| `metadata-only` | the sweep pre-check refused the sweep |
| `time-only` | admin monoculture; author-keyed clustering is disabled |

Nine of eleven question signals survive the worst envelope. **That is not reassurance on a
single-owner dev instance**, because what they survive against is scratch: there,
`provenance: 'metadata-only'` combined with the census branch `authored-but-undeliberate`
is a **stop**, not a degrade. Say so in the artifact.

## The one terminal that matters

**Only when every rung is empty is archaeology genuinely dead.** And an instance where
every rung is empty has no customer-authored surface at all, which is itself the most
important finding the run can produce. Emit it as the headline with the numbers attached.
Do not simulate a change history from current state.

## The artifact

- `rungs[]`: each rung with `present | absent | unavailable`, the count or sample that
  proves it, and the query that produced it
- `provenanceStamp` and `authorshipStamp`, one each
- `storyPattern`: the induced regex, its support count and the row count it was induced
  over, or `null`
- `shipModel`: update sets, source control, CI/CD, store, or mixed, with the evidence
- `cloneEvidence`: what the upgrade history and version depth imply about truncation
- `deliberateness`: the Default share of authored change, measured
- `sweepDecision`: swept, or refused with the pre-check count and the signals downgraded
- `signalsLost[]`: named, so the question stage does not silently under-emit
- `archaeologyConditional`: which downstream work is enabled and which is switched off

Write it to the path the brief names, normally `.brain/in/provenance.json`, and report the
stage's spend with the ingest. A stage that reports none is recorded `spend-unknown`,
which blocks terminal `success`.

```bash
snbrain ingest --stage provenance --file .brain/in/provenance.json
```

`ingest` returns `{ accepted, rejected, findings, nextStage, terminal }`. **The CLI decides
what is next.**

## Never

- **Never write to the instance.**
- **Never assume update sets are the change history.** Prove the rung or stamp it absent.
- **Never fabricate an evidence line.** Every rung verdict traces to a logged request.
- **Never report absence as a negative result without a canary.** A truncated clone and a
  dead helper tab produce the same empty read.
- **Never report a clone-truncated history as an empty history** without saying which one
  it is. Those two facts lead to opposite decisions downstream.
- **Never use the induced story pattern as a question source.** Deviations from it were
  measured and dropped; it parses, it does not accuse.
- **Never sweep past the pre-check ceiling** because the data looked interesting.
- **Never decide the next stage.**
