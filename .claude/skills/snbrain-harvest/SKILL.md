---
name: snbrain-harvest
description: Invoke to run the HARVEST stage of a project-brain build, or when the user asks to "harvest the instance", "read the artifacts", "build the claim ledger", "collect claims", "map the configuration", "sweep the customer-authored surface". Reads artifacts per area into atomic claims, each carrying a replayable evidence query and a captured response.
---

# HARVEST: read artifacts into claims

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, what to do, the inputs, the artifact, the acceptance
conditions, the remaining budget, the iteration and the cap. **The brief is the current
state; this skill is the procedure. Where they disagree, the brief wins.** If the stage is
not `harvest`, stop and run the stage the CLI named.

## Areas come from census evidence, not from a list

Read `areas[]` out of the census artifact. Each area carries its Band A row count. **Skip
every table with zero Band A rows entirely.** On a real instance most of the scope list
will have zero, and nobody has costed that saving: it is free budget, and spending it on
ServiceNow's own shipped defaults produces maximally derivable, maximally worthless
material.

Where the census branch was `authored-but-undeliberate`, harvest still runs (the transport
and guard legs are unaffected), but the surface narrows to loci carrying evidence of a
**named, completed, non-default** change container. Scratch is not askable.

Where the census branch was `large`, harvest **samples**: the named strata only, 200 rows
per stratum, ordered by `sys_id`, every read stamped `completeness: 'budget-capped'`, and
**every count and absence claim outside a fully enumerated stratum is forbidden**.

### Chain-repair areas — the sys_ids are the query

When the census queue drains, the CLI appends areas with `population: "chain-repair"`. These
did not come from the census and they have no Band A count, no boundary query and no
stratum. They are a **list of sys_ids this run already references and never mapped** —
computed from the ledger, zero instance reads, and handed to you in
`queue.harvestAreaDetail[].targets`.

> A brain is a set of chains, not a pile of facts. Run 4 banked 19,360 claims and **970 of
> its 2,958 references pointed at records nobody mapped** — so a page could say the rule
> calls something and could not say what that something does. The biggest single gap was
> **44 `sys_decision_question` records**: the decision-table chain a blind tester needed and
> could not follow, every sys_id already sitting in the ledger.

Four rules, and the last is the one that gets skipped:

1. **`dictionaryFields()` on the target table first.** This table has never been read in this
   run, so nothing has validated a single column of it.
2. **`sys_idIN` with at most 40 ids per request.** No filter, no boundary clause — the ids
   *are* the boundary.
3. **Claim the declared columns** where the stage table names them; otherwise claim the
   identity and state columns the dictionary offers and say in `coverage.note` which you
   chose and why.
4. **A sys_id that returns NO ROW is a fact, not a miss.** It means the reference points at a
   deleted or out-of-scope record, and the page citing it should say so rather than implying
   a record exists. Record it as an absence claim with the sys_id in the locus, or name it in
   `coverage.note` with a count. Empty results are **guaranteed** in one case: where a column
   is polymorphic the CLI probes every table it has been seen to resolve into, because one
   wasted read is cheaper than a lost chain.

The leg is bounded by **round count**, not by exhaustion — repairing a chain harvests records
whose own references dangle, so an unbounded version is a run that never finishes. What a
round leaves behind is reported as a `chain-repair-round` finding, including the tables it
could not aim at because no column in the ledger has ever resolved to them.

## The claim, and who owns which half

```jsonc
{
  "scope":     "x_acme_fm",
  "locus":     { "table": "sys_script", "sysId": "9ec847db…", "field": "active" },
  "assertion": "active = true",
  "evidence":  { "query": "sys_idIN9ec847db…", "fields": "active,name,sys_updated_on" },
  "rung":      "L1"
}
```

**You own:** `scope`, `locus`, `assertion`, `evidence.query`, `evidence.fields`, the
completeness and guard stamps, and the pointer into `.brain/raw/harvest.ndjson`.

**The CLI owns:** the claim `id` (a content hash of locus plus assertion, allocated by the
CLI so that a stagnation breaker can actually fire), `evidence.capturedAt`,
`evidence.capturedResponse`, `status`, `staleAfter`.

> **Why the response is captured and not narrated.** A model-written evidence line is a
> post-hoc rationalization, not an audit trail: chain of thought is unfaithful roughly a
> quarter of the time. So the deterministic layer records what came back, and your job is
> to say what it means. An assertion whose captured response does not support it is
> rejected at ingest, which is the point.

**Claim the REQUIRED columns, including the empty ones.** The brief lists, per table, the
columns the stage table declares — and separately the ones marked **REQUIRED, not
optional**. Those are where that class keeps its logic, and "I claimed a different declared
column" does not cover them. Measured on run `93838afe87`, every one of these passed the
old rule while the logic went unread: 64 UI policies claimed without `script_true` /
`script_false`, 14 notifications without `condition` or `advanced_condition`, 34 state flows
without either transition condition, and the single `sysrule_assignment` doing all
routing-group routing claimed without `script` — on a record whose `group` and `user` are both
empty, so the script *is* the mechanism. An empty required column is still a claim: an
ungated transition is a fact about who may act. If the column genuinely is not on this
instance's version of the table, say so **per column** in `coverage.note` as
`no-column: <table>.<column> — <reason>`; one such declaration excuses that column and no
other.

**Never say a column is empty unless you asked for it.** An unread column and an empty
column are the same JSON. A claim asserting *"`<field>` is empty"* or *"carries neither
script nor condition"* is rejected when `<field>` is not in that claim's own
`evidence.fields` — the previous run rendered *"the script column is empty; the only logic
on the record is the condition"* onto a wiki page, about a workspace UI action whose logic
lives in `client_script_v2`, a column it never requested. Either request the field and
re-read, or say what you did read: *"no condition was requested for this record"* is a true
sentence and *"condition is empty"* is not.

**One claim, one fact.** Claims must be individually addressable, because the bottleneck
in self-correction is error localization rather than correction. Never write "this page is
about X"; write "field F on record R is V". Later, verify says "claim C-0042 asserts X, the
live query returned Y, reconcile", and that is a tractable instruction. "Review this page
for errors" is not.

## Read discipline, non-negotiable

Every read goes through `tools/snbrain/lib/api.js`. Do not write another client.

1. **Field-validate before every filtered query.** `session.dictionaryFields(table)`, then
   resolve every left operand. Split on `^`, `^OR`, `^NQ`, strip `ORDERBY*`, skip
   `javascript:` right-hand sides, and for a dotted path resolve each segment's reference
   table in turn. The silent clause-drop is **confirmed on this transport**: an unknown
   field returns **unfiltered rows** and a clean 200.
2. **Flag the child-field case separately.** A final segment that exists on a **child** of
   the referenced table but not on the referenced table itself is dropped the same way. A
   flagged clause downgrades any zero-row result to `unfiltered-risk` and forces a control.
3. **Field allowlists always. Never `SELECT *`.** Widening `sysparm_fields` is what makes
   most of the census free; widening it without a reason is what blows the payload ceiling.
4. **Never read `script` in a sweep.** Read it per claim, on the sys_id, and only on
   candidates that already passed the gates. Script bodies are the largest payload on the
   instance and the highest data-egress exposure in the run.
5. **Paging.** `pageSize` 100, `widePageSize` 25 for `sys_script`, `sys_update_xml`,
   `sp_widget`, `sys_ui_page`. Always append `ORDERBYsys_id`: any other order can shift
   rows between pages under concurrent writes. Stop when a page returns fewer than
   `pageSize`.
6. **Completeness verdict on every read.** `complete` only when a short page ended it.
   `budget-capped` when the row budget bound first. `truncated` when the non-REST path
   returned exactly `limit`. **A `truncated` result may not back a claim about a count or
   an absence.** Never source completeness from a returned-row count.
7. **Zero rows is never absence.** Re-issue unfiltered with `limit 1`. Rows means the zero
   is about the filter. Zero again means reconcile against the aggregate count. A genuinely
   empty table is a legitimate finding; an unreachable one is `blocked`.
8. **Watermark first.** One read per table at run start, ordered by `sys_updated_on`
   descending, limit 1. Every captured row carries its own `sys_updated_on`. At verify, a
   row updated after that watermark is `changed-in-flight`, not `drifted`. Without this,
   a finding present in iteration 2 and absent in iteration 1 is indistinguishable from
   someone deploying mid-run.
9. **Serialized transport.** Concurrency 1 until measured. **The parallelism goes in the
   model, not the socket:** N harvest workers reason in parallel and their reads queue
   through one limiter. Reads are 100 to 400 ms, reasoning is seconds, so serializing the
   transport costs almost nothing and removes an entire class of unknown. One transient
   fault rejects every pending request for the instance at once, so budget for whole-batch
   retries rather than per-read ones.
10. **Stream, do not accumulate.** Every response appends to `.brain/raw/harvest.ndjson`.

## Traps that make a correct-looking read wrong

- `sys_script.name` and `sysevent_email_action.name` **truncate at 40 characters**. Never
  key a claim on a name. Key on the sys_id.
- `sys_ui_action.condition` **truncates and still parses as valid JS**, so a read of that
  field can look complete and be wrong.
- `sys_security_acl` is itself ACL-protected, so a partial read looks complete. Stamp every
  ACL claim `unverifiable: blocked-by-access` unless the aggregate count reconciles.
  Nothing detects field-level redaction.
- Values containing `&`, `=`, `#`, `+` or `%` re-parse as parameter delimiters on the
  non-REST path, which returns a clean 200 on the wrong query. Route those through REST.
- Display values and reference links must stay pinned off on every read, or a non-English
  session returns localized text where you expect stored values and every downstream
  comparison is corrupt.
- Flow definitions store logic in **related records**, not in a script field, so a naive
  row read under-represents behaviour. That is a modelling gap; stamp it, do not paper
  over it.

## The artifact

- `claims[]`: your half of each claim, as above
- `areasCovered[]`: each with its completeness verdict and, where capped, the named strata
- `watermarks`: per table, at run start
- `guards`: per read batch, the dictionary-validation and identity-canary results
- `caveats[]`: `acl-recursive`, `unfiltered-risk`, `producer-scan-only`, and any other
  stamp a downstream stage must carry forward
- `terminal`: `complete`, or `budget-capped` **with the capped strata named**

A `partial` from a harvest worker that failed is honest and allowed. **A confident report
from a worker that failed stops the run.**

Write it to the path the brief names, normally `.brain/in/harvest.json`, and report the
stage's spend with the ingest. A stage that reports none is recorded `spend-unknown`,
which blocks terminal `success`.

```bash
snbrain ingest --stage harvest --file .brain/in/harvest.json
```

`ingest` validates each claim against the captured evidence, allocates the ids, merges the
ledger and returns `{ accepted, rejected, findings, nextStage, terminal }`. **The CLI
decides what is next.**

## Never

- **Never write to the instance.**
- **Never fabricate an evidence line.** If the response is not in
  `.brain/raw/harvest.ndjson`, the claim does not exist.
- **Never allocate a claim id.** Model-authored ids never repeat, which is exactly why a
  stagnation breaker built on them never fires.
- **Never report absence as a negative result without a canary.**
- **Never write a wiki page.** A stage's only writes are its raw stream and its artifact.
  Pages are a render from claims, and harvesting in order to write pages is what makes two
  workers collide over the same file.
- **Never emit a question.** Record what you read; you may not create a question. Questions
  are computed from the ledger by the engine, deterministically and after the fact.
- **Never test a filter by counting its rows and calling zero "dead".** Zero rows has four
  causes here and only one of them is a dead filter.
- **Never decide the next stage.**
