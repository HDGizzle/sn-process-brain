---
name: snbrain-census
description: Invoke to run the CENSUS stage of a project-brain build, or when the user asks to "run census", "what scopes are on this instance", "who authored what", "find the customer-authored surface", "is there anything customer-built here", "scope and package inventory". Discovers scopes, applications and packages, builds the authorship distribution, and decides whether this instance has a surface worth harvesting.
---

# CENSUS: find the customer-authored surface

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, what to do, which inputs to read, the artifact to produce,
the acceptance conditions, the remaining budget, the iteration and the cap. **The brief
is the current state; this skill is the procedure. Where they disagree, the brief wins.**
If the brief's stage is not `census`, stop and run the stage the CLI named. `next` never
advances state, so a resumed session gets the same brief.

Commands below are written `snbrain <verb>`. If the shell cannot find it, invoke the same
verbs through the CLI entry point in `tools/snbrain/`.

## Read discipline, non-negotiable

Every instance read goes through `tools/snbrain/lib/api.js`. It is a frozen nine-command
allowlist with `rest_request` reachable only via `restGet()` with GET as a literal, an
endpoint allowlist, and an append-before-send request log. Do not write another client.

1. **Field-validate before every filtered query.** `session.dictionaryFields(table)`,
   then resolve every left operand of the encoded query against it. On this transport the
   silent clause-drop is **confirmed, not inherited doctrine**: an unknown field in an
   encoded query returns **unfiltered rows**, and the run reproduced it. An unvalidated
   filtered query is not evidence of anything.
2. **Zero rows is never absence.** On an unproven connection an empty read is more often
   a dead helper tab than an empty table. Re-issue unfiltered with `limit 1`; if that also
   returns nothing, compare against the stats count. A genuinely empty table is a
   legitimate finding. An unreachable one is `blocked`.
3. **Stream, do not accumulate.** Every response appends to `.brain/raw/census.ndjson`.
   Evidence lives on disk, never in context.

## Inputs you must not re-derive

Read the preflight facts from `.brain/state.json` and `.brain/raw/preflight.ndjson`:
whether the REST read path exists, whether `sysparm_offset` paging works, whether
aggregate counts work, what the two negative controls returned, the session's roles, and
the record-level authorship verdict, which is update-set membership joined on
`sys_metadata.sys_update_name` = `sys_update_xml.name` and not the `sys_customer_update`
this once named, that being the label of `sys_update_xml` rather than a column anywhere.
Those were settled by the eleven WP-A probes. Running them again spends budget to learn
nothing.

## Procedure

**1. Package and scope inventory.** `sys_package` with
`sys_id,source,name,version,active,trackable,sys_class_name,sys_created_by,sys_created_on`.
Classify each: `sys_app` is custom, `sys_store_app` is vendor, everything else is base.

> **The trap that inverts this.** A `sys_store_app` whose publisher matches a human
> account in the author distribution is the author's **own published app**, and binning
> it as vendor discards the most decision-rich artifacts on the instance. Check it here,
> with one comparison over data you already hold.

**2. Install floor.** Top five `sys_upgrade_history` rows by `sys_created_on`, plus
`min(sys_created_on)` over `sys_app`. This is the date below which everything is install.
A clone resets it, so record how it was derived, not just the value.

**3. Authorship, totals AND distribution, both, always.** They fail in opposite
directions and neither one alone is a measurement.

- `countRows('sys_metadata', <authored filter>)` detects **too few authored records**.
- `groupCount('sys_metadata', 'sys_created_by')`, then by `sys_package`, then by
  `sys_scope`, detects the **opposite confound**: base and demo records passing an
  authorship filter because an install account carries a human-looking name.

> A total of 107,734 authored rows reads as a rich instance. The group-by on that same
> instance returns `system` 460k, `admin` 307k, `tectonic` 69k, and the picture inverts.
> **Never report one without the other.** A number without its distribution is a claim
> the next reader cannot check.

**4. Actor test — is this author string a person? Decide it with a RULE, never with a
list of names.** An author string is not a person until this says so, and a hardcoded
`user_nameIN<the two names we expected>` is not this test. It is the answer written down
in advance, and it silently sets the whole run's recall.

Five signals, all from one `sys_user` read over the author distribution's top accounts:

| Signal | Reads as a person when |
|---|---|
| a `sys_user` row exists for the string | present — no row at all means a platform identity (`system`, `maint`, `glide.maint`, `tectonic`) |
| `last_login_time` | **non-empty**. This is the strongest single signal: somebody has actually signed in as this account |
| email domain | not `example.com` — that domain is the OOTB demo set |
| `sys_created_on` vs the install floor | created at or after the floor, **or** logged in after it |
| `active` / `locked_out` | active and not locked |

> **The trap, and it is the one that inverted the reference run.** On a **developer or
> vendor instance the developer normally works as `admin`**, so "admin is the shared
> install account" is an assumption, not a finding. Do not disqualify it on the age of its
> `sys_user` row: on devinst01 that row dates to 2007-07-03 with `admin@example.com`, which
> says nothing whatever about who has logged in since. Disqualify it, or admit it, on
> `last_login_time` and on **what it actually created and modified** — step 7 axis 1, and
> the package split in step 7. On that instance admin was correctly excluded, but only
> because every one of its 43,188 post-floor records resolved into a vendor package; the
> stated reason ("2007 demo row") was wrong and reached the right answer by luck.

Record the signal that decided each account, not just the boolean. An account excluded on
"no `sys_user` row" and one excluded on "never logged in" are different findings, and the
second one is reversible by a human at the interview.

**5. Per (table, scope) counts**, one aggregate count each, across the scope list, and
only for the scopes step 3 found non-trivial. If stats is unreachable, fall back to
enumerate-and-count with a row budget and stamp every total **"counted only what we
enumerated"**. There is no third rung: the header fallback is structurally unreachable
through this transport.

**6. Domain separation.** `count(domain) > 1` with no explicit domain decision is
terminal `blocked`, not a warning. A session in the wrong domain sees a silent subset and
every count above becomes wrong without any error.

**7. Band the surface, on TWO AXES.** Per record, on evidence, never on scope alone, and
never on package alone. Scope is neither necessary nor sufficient: vendor scopes hold
customer work and `global` holds both the base system and real customer work.

**Axis 1 — CHANGE. Has this record been touched since it arrived?** This is the only axis
carrying real signal, and it is the primary one. Any of:

- `sys_mod_count > 0`
- more than one `sys_update_version` row, or one recorded after the install floor
- an entry in `sys_update_xml` joined on `sys_metadata.sys_update_name` = `sys_update_xml.name`
  (this subsumes the retired `sys_customer_update` predicate, which named the *label* of
  `sys_update_xml` and so was this same membership test restated)
- `sys_updated_on > sys_created_on`, or `sys_updated_by != sys_created_by`

**Axis 2 — ACTOR. Was the change made by a person?** Step 4's rule, applied to
`sys_updated_by` for a change and `sys_created_by` for a creation. Never a name list.

Then:

- **Band A, AUTHORED.** Askable for existence and for change. **Changed ∧ human actor**,
  wherever it lives. A record created after the install floor by a human actor, in a
  package or in none, qualifies on creation alone.
- **Band B, TOUCHED.** Askable for change only. Changed ∧ human actor, but the record
  itself arrived with a vendor package — i.e. **an OOTB record the customer modified**.
- **Band C, PLATFORM.** Never askable. Everything else. Inventory and denominator only.

> **PACKAGE IS A CLASSIFIER, NEVER A GATE, and getting this backwards throws away the
> primary customer surface.** A package says where a record *lives*, not who last *touched*
> it. Modifying an OOTB business rule leaves it in `com.snc.incident` forever. On a real
> customer implementation, modified-OOTB is the **main event** — most of what a consultancy
> does — so any predicate that bins "belongs to a vendor package" as "not customer" reports
> a fully customised ITSM implementation as having zero customer surface.
>
> Measured on devinst01: **66,332** records live in a base package and carry
> `sys_mod_count > 0`; **188,949** across all packages. The run that used a human-name list
> admitted **one** of them. The instance really was clean — but the predicate could not
> have told the difference, and that is the defect. Use the package split to *report* which
> app a finding belongs to, and to separate Band A from Band B. Never to decide Band C.

**8. Run the four-part discrimination gate.** Presence of an authorship column is not
discrimination. All four must hold or the run branches:

| # | Gate | Failure |
|---|---|---|
| 1 | Band A is non-empty | `no-customer-surface` |
| 2 | Band A share of all banded rows is at most **0.35**. On every brownfield instance observed, the customer-authored share is a small minority; a filter admitting more than a third is not a filter | `filter-non-discriminating` |
| 3 | the top Band A author is not also the top Band C author with share above 0.80 in both | `filter-non-discriminating`, or stamp `authorship: 'time-only'`, which disables author-keyed clustering |
| 4 | Default-set share of authored change is at most **0.50**, from one group-by on `update_set.is_default` restricted to the install floor | `authored-but-undeliberate` |

Record the **measured shares** on every gate, passed or failed. A gate that reports only
a verdict cannot be argued with later.

### Division of labour with PROVENANCE, read this before you start

The banding above needs a **calibrated** admitting predicate, chosen against control sets
rather than assumed: three certainly-base records per table family as a negative control,
three authored ones as a positive control, all candidate predicates scored against **both**,
and the winner is the one that admits **zero** of the negative control. That calibration may
be briefed here or at `provenance` depending on the CLI's stage plan.

**Do it where the brief asks for it. Do not do it twice, and do not skip it because you
assumed the other stage had it.** If the brief gives you the gate but no calibrated
predicate and no calibration instruction, say so in the artifact as a finding rather than
picking a predicate by judgement.

## Terminal branches

| Branch | Condition | What the run does |
|---|---|---|
| **usable** | all four gates pass, at least 200 authored rows, at least 25 distinct change episodes | full protocol |
| **usable, derated** | 50 to 199 authored rows, or 10 to 24 episodes | continue, and pre-register that the question set may come back small. The shortfall is the result, not something to pad |
| **no-customer-surface** | gate 1 fails, or under 50 authored rows, or under 10 episodes, or 95% or more of "authored" rows are `admin` inside base packages | terminal `inventory-only`, zero questions, reason stamped. Do **not** harvest and report "no changes found" |
| **filter-non-discriminating** | gate 2 or 3 fails | stop with the numbers: we could not separate your work from ServiceNow's, here is the ratio |
| **authored-but-undeliberate** | gate 4 fails | see below |
| **large** | over 12,000 authored rows, or over 60 scopes | do **not** widen the budget. Freeze it, rank scopes by authored-row count, take the top three plus `global`, switch harvest to sampling, and forbid every count and absence claim outside a fully enumerated stratum |

### authored-but-undeliberate, and why it must be detected rather than passed

Gates 1 to 3 pass **cleanly** on a single-owner vendor dev instance and the filter reports
success. Band A there is dominated by product-development scratch: half-built experiments,
throwaway tests, demo records. That material is genuinely customer-authored, satisfies the
Band A predicates, and is worthless to ask about because there was never a decision, only
tinkering.

**The bands separate customer-authored from ServiceNow-shipped. Nothing in them separates
deliberate from scratch, and Band A membership is not evidence that a decision was taken.**
Without gate 4 the run produces a confident queue of questions about half-built
experiments and no state says so. On a single-owner dev instance this is the **likely**
branch, not the edge case. Report line: *we can see what you built, we cannot see what you
decided, and here is the ratio.*

## The artifact

Write the artifact the brief names, then ingest. Content, at minimum:

- `scopes[]`, `packages[]` with the classification and the publisher-match result
- `installFloor` with its derivation
- `authorship`: totals, the three distributions, band sizes, and all four gates with
  measured shares
- `tableCounts[]` per (table, scope) with a completeness stamp per count
- `areas[]`: the candidate harvest areas **derived from this evidence**, each with its
  Band A row count. A table with zero Band A rows is not an area. Do not carry a
  hardcoded list forward
- `branch`: one of the six above
- every observation carrying the query that produced it and a pointer into
  `.brain/raw/census.ndjson`

Write it to the path the brief names, normally `.brain/in/census.json`, and report the
stage's spend with the ingest. A stage that reports none is recorded `spend-unknown`,
which blocks terminal `success` exactly as a failure does.

```bash
snbrain ingest --stage census --file .brain/in/census.json
```

The CLI validates against the schema, merges into state and the ledgers, and returns
`{ accepted, rejected, findings, nextStage, terminal }`. **The CLI decides what is next.**
Do the next stage it names, not the one you expected.

## Never

- **Never write to the instance.** No command outside the read-only allowlist, ever.
- **Never fabricate an evidence line.** Every number in the artifact traces to a logged
  request and a captured response, or it does not go in.
- **Never report absence as a negative result without a canary.** Zero rows and no
  connection are indistinguishable on this platform.
- **Never report a total without its distribution.** That is the confound this stage
  exists to catch.
- **Never hardcode the harvest areas.** They are derived here, from evidence.
- **Never pass gate 4 silently.** An undeliberate instance that reports `usable` sends a
  human a queue of questions about scratch.
- **Never decide the next stage.** That is `ingest`'s output, not your judgement.
