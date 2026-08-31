# snbrain contextualization loop, loop specification

> The authoritative definition of the instance-contextualization loop. Read this before
> running or changing any part of it. Orchestration lives in the `snbrain-map` skill and
> the entry point is `/map-instance`; this file is the *contract*, meaning trigger, goal,
> verification, stopping rules, memory, and who is allowed to decide what.
>
> Design basis: a loop specification is `trigger + goal + verification + stopping rule +
> memory`. A pipeline missing the last two is not a loop, it is an unbounded retry.
>
> This is the pilot customer's proven build-loop discipline (`<reference-engagement>/.claude/loop/LOOP.md`)
> re-derived for mapping rather than building. Where a rule is carried across unchanged it
> says so, and where mapping forced a different answer it says why.

## 0. Shape

This is **not one loop**. It is three legs with three genuinely different shapes, separated
by two human gates, and the shapes are a consequence of which leg has a feedback signal.

```
                       /map-instance <instance>
                                │
                                ▼
                       snbrain init   ⇒  .brain/state.json   (stage=preflight, iteration 0)
                                │
   ╔════════════════════════════╪══════════════════════════════════════════════════════╗
   ║  THE SEAM. Every box below is entered this way and never any other way.           ║
   ║     snbrain next             ⇒  the brief for the CURRENT stage. Never advances.  ║
   ║     the agent does the work  ⇒  writes ONE artifact to the path the brief names.  ║
   ║     snbrain ingest           ⇒  validates, merges, AND DECIDES THE NEXT STAGE.    ║
   ╚════════════════════════════╪══════════════════════════════════════════════════════╝
                                ▼
       [ PREFLIGHT ]    transport facts, the eleven WP-A probes, two negative controls
             │          cannot run ⇒ `blocked`. Zero instance writes, in every branch.
             ▼
   ═════════════════ MAP  (ONE-SHOT, BUDGETED, RESUMABLE. NOT A LOOP) ═════════════════
             │                purpose: feed the question engine, not write a map
       [ CENSUS ]       scopes, packages, authorship distribution, counts per table
             │
       [ PROVENANCE ]   which ladder rungs exist here, plus the scope filter's four-part
             │          discrimination gate. Cannot discriminate ⇒ `no-op`, zero questions,
             │          and the numbers ARE the finding.
             ▼
       [ HARVEST ]      N areas derived from census evidence, never a literal array.
             │          Observations only. A harvest stage may not write a question. Ever.
             │
   ═════════════════ VERIFY  (THIS ONE IS A LOOP) ═════════════════════════════════════
             │
     ┌────▶  [ VERIFY ]  L1 replay issued and diffed BY THE CLI, L2 cross-source,
     │           │       referential integrity, supersession flags on every DEC whose
     │           │       claim moved.
     │      blocking findings open?
     │        yes│   no ─────────────────▶ converged
     └───────────┘  repair the CLAIM, never the finding. Checker never sees the repair
             │      agent's reasoning.
             │      two consecutive iterations with zero resolutions ⇒ `stalled`
             ▼
   ═════════════════ INTERVIEW  (ALSO A LOOP, AND IT IS THE PRODUCT) ══════════════════
             │
       [ QUESTIONS ]    scope filter ⇒ contradiction/delta/register-gap gate ⇒ cluster
             │          ⇒ WPM rank (CLI arithmetic) ⇒ anti-waste ⇒ admission floor ⇒ cap
             │
   ╔══ GATE 1  the human reviews an evidence pack, not a transcript ══╗
             │
       [ INTERVIEW ]    ask, record verbatim, mint DEC or TBD, recompute the ledger
             │          saturation: over the last 5 answers, fewer than 2 ledger deltas
             ▼
   ╔══ GATE 2  the human approves de-DRAFT promotion ══╗
             │
       [ RENDER ]       claims + decisions ⇒ kernel, hook wiring, build skills, wiki
             │          THE ENGAGEMENT REPO IS NOW USABLE. That is the acceptance test,
             │          not a page count and not a coverage number.
             ▼
       terminal:  success | no-op | blocked | stalled | exhausted | abandoned
```

**Why the three shapes differ, stated once so nobody redraws this as one loop.** Drift has a
signal: replay a claim's evidence query and diff the values, and the model cannot manufacture
the result. Coverage has none: re-querying a claim proves that claim is still true, nothing
whatsoever proves what was never written down, and every coverage ratio is either trivially
gamed (an agent maximizes it by dumping rows) or uncomputable (the harvest areas partition
disjoint table families, so every claim is found by exactly one pass, singletons equal total
detections, and every capture-recapture estimator returns zero information by construction).
So **VERIFY loops, MAP does not, and MAP's stopping rule is a budget that is labelled a
budget.** INTERVIEW loops because the human is an oracle whose answers change the ledger, and
it is first in importance because the decision ledger is the deliverable and the map is the
mechanism that earns the right to ask.

## 1. Trigger

**Manual, once per engagement.** `/map-instance <instance>`, typed by the operator in the
engagement repo. No cron, no auto-trigger, no CI job.

Three reasons, and the first is not about safety:

1. **The substrate is attended.** Every read goes through a live VS Code extension host and
   an authenticated browser helper tab. There is no unattended mode to build.
2. **The instance is not ours.** A sustained read sweep against a customer or vendor
   instance runs inside a window agreed with whoever owns it, and that window is a **gate,
   not a courtesy**. A shared sub-prod instance also carries nightly clones, scheduled jobs,
   integration tests and other consultants.
3. Automated triggering is the least valuable loop component and the most dangerous one.

## 2. Goal

**An engagement repo an agent can do real ServiceNow development in.** Concretely, at the end
of a `success` run the repo carries:

- a **kernel** (`CLAUDE.md`) with the engagement's identity, its hard rules, and a routing
  map from artifact type to the skill that governs it;
- **enforcement wired into `.claude/settings.json`**, not described in prose;
- **build-procedure skills**, the ones this instance's artifact types actually need;
- a **wiki** carrying registry, decisions, gotchas, conventions, TBDs and story records,
  where every factual row cites a replayable evidence query and a verification timestamp,
  and every page's `status` is computed from the claims it renders rather than typed by hand.

**And say the negative out loud, because it is the whole design.** The goal is not a map. A
perfectly executed MAP pass scores roughly **2 of 9** on the reference engagement's own
acceptance probe suite, because seven of those nine need counter-knowledge, domain vocabulary
or decision rationale, and every one of those came from a human. The number to quote is not
"MAP scores 2 of 9". It is **"MAP scores 2 of 9 on its own and is the only cheap way to find
out which 7 questions to ask."** The claim ledger is a mechanism. The decision ledger is the
product.

## 3. The seam: `next` and `ingest`

This is the control-flow contract, and it is the reason the loop is portable to another
harness later. **The CLI owns the state machine, the caps, the budget, the gates and the
terminal states. The agent supplies reasoning only.**

```
snbrain init --instance <name> [--root <dir>]
      creates .brain/ and writes state.json with stage=preflight, iteration 0

snbrain next [--json]
      the brief for the CURRENT stage: what to do, which inputs to read, what artifact to
      produce, the acceptance conditions, remaining budget, iteration and cap.
      NEVER advances state. Idempotent, so a resumed session gets the same brief.

snbrain ingest --stage <stage> --file <path>
      validates the artifact against that stage's schema, merges it into state and the
      ledgers, decides the next stage, returns { accepted, rejected, findings, nextStage,
      terminal }.  THE CLI DECIDES WHAT IS NEXT, NEVER THE AGENT.

snbrain status [--json]              stage, iterations, budget spent, claim and question
                                     counts, terminal
snbrain claims|questions [--status X]  read the ledgers
```

### 3.1 The eight stages

| # | Stage | Settles | Artifact | Loops? |
|---|---|---|---|---|
| 1 | `preflight` | connection verified, WP-A probes run, transport facts recorded | probe results | no |
| 2 | `census` | scopes, packages, authorship distribution, customer-authored surface | counts per (table, scope) | no |
| 3 | `provenance` | which ladder rungs exist on this instance (update sets, versions, deletes), and whether the scope filter discriminates | rung availability + chosen predicate + control-set scores | no |
| 4 | `harvest` | artifacts per area, emitted as CLAIMS | observations, streamed | no |
| 5 | `verify` | L1 re-query of claims, diff values, mark verified / drifted / gone / unverifiable | verdicts + findings | **yes** |
| 6 | `questions` | generate, scope-filter, rank, anti-waste filter, emit ranked questions | ranked queue | no |
| 7 | `interview` | human answers, recorded as DECISIONS linked to the claims they explain | answers | **yes** |
| 8 | `render` | claims + decisions to wiki pages and kernel; the engagement repo becomes usable | the repo itself | no |

### 3.2 Rules of the seam, all binding

1. **The agent never chooses the next stage.** It calls `next`, does the work, calls
   `ingest`, and repeats until `ingest` reports a terminal state. There is no branch in the
   procedure where the agent reasons about ordering.
2. **`next` never mutates state.** Calling it twice returns the same brief. This is what
   makes a killed terminal, a compacted context or a crashed session resumable rather than
   restartable.
3. **Rejection is data, not failure.** `ingest` returning `accepted: false` with findings
   consumes an iteration and re-briefs the same stage. It is not an error to work around.
4. **Text in, text out.** No stage may depend on a harness-native structured-output mode.
   Every stage writes a file at a path the CLI dictates, and the CLI reads that file.
5. **The CLI mints every id.** Claim ids are content hashes of `locus + assertion`, allocated
   by the CLI. Question ids are content hashes of the **locus set**, never the wording.
   Decision ids are allocated append-only and never renumbered.
6. **A stage that could not run is not a stage that passed.** A dead helper tab, a stale port
   file, an unreachable instance and an exit-2 probe are all `blocked`, never green, and
   never "zero rows found".

## 4. Verification ladder

Every check in this loop declares its rung. Higher rung means weaker evidence. **A loop may
only be closed by the highest rung available for that claim.** the pilot customer's ladder is a trust
ordering rather than a ServiceNow concept, so it ports; what does not port is its L3
("does the thing actually do the thing", driven in the browser), because that is a *build*
rung and the surfaces this loop reads are not observable that way.

| Rung | Kind | In this loop | Trust | Closes a loop? |
|---|---|---|---|---|
| **L0** | Query validity | Every field in an encoded query validated against `sys_dictionary`, or an A/B negation control issued. Positive identity canary per batch. | Precondition | No. It is what makes everything above it mean anything. |
| **L1** | Deterministic re-query | **The CLI** replays the claim's evidence query and diffs the values. Also: referential integrity of the produced brain, frontmatter conformance, slug canonicality, evidence-query presence on every registry row. | Absolute | **Yes** |
| **L2** | Cross-source contradiction | Two independent derivations disagree. Registry contradicts a process page. Two harvest areas minted different slugs for one target table. A decision's witness claim moved. | Absolute | **Yes** |
| **L3** | Round-trip re-derivation | A fresh agent receives the **claim text only**, derives its own query, and the CLI diffs the result against the recorded response. Also the derivability oracle (AW-5). | High | **Yes**, for WHAT-claims |
| **L4** | Model judge | An assessor reading pages against CONTRACT as a rubric. The AW-4d "so what" residual. | **Low. Never closes a loop alone.** | No |
| **L5** | Human | An interview answer, a de-DRAFT approval, a gate decision. | Final | **Yes**, and it is the only rung that can close a WHY-claim |

### 4.1 Hard constraints on the ladder

- **An L4 finding may not be dismissed by L4.** Carried unchanged from the pilot customer. It is closed by a
  repair plus L1/L2/L3 re-verification, or by a human at a gate. The judge never grades its
  own fix.
- **L1 means the CLI issued the query.** If a model performs the comparison it is L4
  immediately, whatever it says about itself. This is not a suspicion, it is a design
  consequence: a model-written evidence line is a post-hoc rationalization rather than an
  audit trail, so the CLI captures the response.
- **Severity is not a free-text field any stage may rewrite.** A finding carries `severity`,
  `disposition`, `dispositionBy` and `dispositionRung` as **four separate fields**, and
  closure is the predicate **"no finding with `severity=blocking` AND `disposition=open`"**.
  the pilot customer's build loop shows exactly why: six findings were re-emitted in one iteration with
  severity downgraded from blocking to info and the acceptance text pasted into the message
  field, taking the blocking count from 2 to 0 (`the pilot customer/.claude/loop/state/STRY0186518.json`).
  No stage can close itself by editing a string.
- **`unverifiable` is a first-class status** with four sub-reasons: `blocked-by-access`,
  `no-oracle`, `requires-write`, `interpretation` — the last for behaviour claims alone,
  whose sentence no re-read can confirm (PRODUCT-89): the substrate is re-read and hashed
  instead, and the claim closes at L3 or L5, never at L1.
  A binary schema forces an honest non-result to be filed as a
  success, and at the pilot customer it did exactly that: a test case titled "NOT DEMONSTRATED" is recorded
  `result: pass` because the schema had nowhere else to put it.
- **Outcomes are three-valued.** `pass | fail | not-demonstrated`, and `not-demonstrated`
  blocks terminal `success` exactly as `fail` does.
- **Absence is never evidence.** On this platform an empty read is more often a dead helper
  tab or a silently dropped clause than an empty table, and the clause-drop has been
  reproduced live: an unknown field in an encoded query returns **unfiltered** rows. Any
  claim whose content is an absence, a count, or a "nothing matched" requires L0 in the same
  batch, and any stratum that was not fully enumerated may not carry a count or an absence
  claim at all.

## 5. Separation of maker and checker

Non-negotiable, and the reason this loop is viable at all: models do not reliably self-correct
without external feedback, and reward hacking emerges specifically when the generator and the
judge share context.

- The **harvester never verifies its own claims.** VERIFY is a separate stage with a separate
  brief, and the replay query is issued and diffed by the CLI.
- The **checker receives artifacts only**: claim text, the recorded evidence, live reads. It
  never receives the harvester's narration, rationale or self-report.
- For **L3 round-trip**, the checker receives the **claim text only** and must derive its own
  query. Showing it the evidence line turns verification into confirmation, and a claim whose
  truth depends on which query you used is by definition a bad claim.
- The **derivability oracle (AW-5)** runs as an isolated agent with ledger-only access,
  **after** ranking and over the top N only, and kills a question only under exact id match
  (every claim id in the question's sources appears in the agent's cited ids, compared as
  strings by the CLI).
- The **AW-4d residual** is one capped model call over a bounded candidate set with a closed
  output vocabulary, **drop-only**: it may not resurrect a question another gate killed and
  may not alter a rank. A stage that can only shrink the queue cannot manufacture work for a
  human.
- **A repair agent fixes the CLAIM, never the finding.**

**The model writes exactly three strings in this entire loop:** a question's wording, a
decision's `statement`, and each `alternatives[].label`. Ids, ranks, links, counts, dates,
attribution, severity and status are CLI arithmetic. Everything else it produces is
observations with a `sourceQuery` attached.

## 6. Stopping rules

Enforced by the CLI as preconditions the model cannot argue past, never by the model.

### 6.1 The three legs

| Leg | Stopping rule | Honest label |
|---|---|---|
| **MAP** (census, provenance, harvest) | **Budget.** Query count, wall clock, page count, spend ceiling. | A budget, and it is called a budget. There is no convergence criterion here and inventing one would be theatre. |
| **VERIFY** | **Convergence**: zero findings with `severity=blocking` AND `disposition=open`, zero claims past their staleness horizon, and zero claims still `draft`/`unverified`/`drifted`. Reachable because the ledger is finite and enumerable — and it is *priced*: the brief states the job as distinct loci, batched reads and field validations, not as a claim count. On run `6ef14f5562` that was 231 calls (138 batched reads + 93 field validations) against 93 remaining, not the "~8,179 re-queries" its quirks log recorded. | Convergence over the **ledger**, and never a statement about the instance (see 6.5). Where the budget genuinely cannot reach the rest, a **named person** runs `snbrain close-unsampled`, which settles them `unverifiable/not-sampled`, records the population and the price, and blocks `success`. No artifact may write that reason. |
| **INTERVIEW** | **Saturation**: over the last 5 answered questions, fewer than 2 produced a **ledger delta** (a new claim id, a `draft` claim promoted, or a new DEC or TBD record), counted by the CLI. Or the queue is empty. Or the question cap is spent. | A saturation rule with a number, not a model's opinion that it is finished. |

### 6.2 Caps

- **Per-stage iteration cap, default 3.** For the non-looping stages this bounds *rejection
  retries*: three rejected artifacts for one stage is a stage that cannot produce a valid
  artifact, which is a human problem.
- **VERIFY's shipped cap is 12**, and it is a **runaway guard rather than a control**. the pilot customer's
  cap of 3 was hit five times across three runs and terminated zero of them, because real
  convergence there took 10 to 11 assessments. A cap overridden 100% of the time is a speed
  bump that generates schema drift. Convergence and stagnation are the real terminators; 12
  sits above the highest observed real convergence, so reaching it is genuinely abnormal.
  **Do not "fix" this by picking a number slightly larger than 3.**
- **`snbrain override --cap` is a first-class recorded verb with `--by` attribution.** The
  overrides that will happen become data instead of hand-edited JSON. the pilot customer invented three
  different undocumented schemas for this across three runs, none of which appears in its
  own state module.

### 6.3 Stagnation, and the specific defect it exists to fix

**Two consecutive iterations with ZERO resolutions terminates the run as `stalled`,**
regardless of remaining cap. A **resolution** is a claim whose status moved out of
`draft`, `drifted` or `unverified`, **counted by the CLI from the ledger.**

**Finding-id set equality is explicitly NOT the trigger.** the pilot customer's stagnation breaker compares
the blocking id sets of consecutive iterations, and it **never fired once in 32 recorded
iterations** (`the pilot customer/.claude/loop/state.js:140-146`), because the ids are authored by the model
and model-authored slugs never repeat. Set equality over model-chosen strings is dead code.
Content-hashed ids allocated by the CLI are what make any progress test possible at all, and
that is the second reason id allocation is not the model's job.

### 6.4 Escalate, do not grind

On `stalled` or `exhausted`, stop and hand the state file to the operator. Do not silently
continue, do not widen the scope list, do not "approach it another way". Re-attempting an
unchanged failure is the definition of a loop that cannot progress.

### 6.5 The disclosure that rides on every stopping rule

VERIFY converges when every claim in the ledger is verified and uncontradicted. **That
condition is reachable on a ledger covering 5% of the instance, and the loop cannot tell the
difference.** Therefore:

1. **A precision number is never reported without the recall disclaimer in the same visual
   block.** Not a footnote.
2. **Every report carries the denominator that does exist:** artifacts counted by the census
   per table and per scope, versus claims written per table and per scope. Not a coverage
   rate, an honest inventory, and it lets a reader see that 4,000 UI policy rows produced 12
   claims.
3. **The suppressed-candidates list is reported.** It is free, mechanical, and the only
   recall-shaped signal the machine can produce about itself.

## 7. Terminal states

Every run ends in exactly one, written to `.brain/state.json`. Carried from the pilot customer unchanged,
because they are proven.

| State | Meaning |
|---|---|
| `success` | Every leg closed, render green, the engagement repo is usable |
| `no-op` | Nothing to do. Includes the honest empty results below, which are findings rather than failures |
| `blocked` | Cannot proceed without a decision or an access the loop does not have (dead helper tab, unresolvable domain separation, a collapsed read path, a missing window) |
| `stalled` | Two consecutive iterations, zero resolutions |
| `exhausted` | Budget or runaway guard reached with blocking findings still open |
| `abandoned` | The operator stopped the run at a gate |

**`success` is the only state that permits handoff. All others require a human.**

### 7.1 Stamps are reasons, not extra states

The scope filter produces verdicts that decide whether asking anything is defensible. They are
recorded as `terminalReason` plus the measured shares, and they map onto the six:

| Stamp | Meaning | Effect |
|---|---|---|
| `inventory-only` | No customer-authored surface at all | Zero questions. Render the inventory. Terminal `no-op`, and **this is a real result**: a vendor dev instance has no customer-authored surface, and here is the number |
| `filter-non-discriminating` | Authorship exists but does not separate customer work from ServiceNow's | Zero questions. Terminal `no-op` with the shares reported |
| `authored-but-undeliberate` | We can see what you built, we cannot see what you decided (Default-set share of authored change above the threshold) | The run continues with admission restricted to loci carrying deliberateness evidence. Rides along, stamped on every page |
| `budget-capped` | A harvest stratum was sampled rather than enumerated | Rides along. Every capped stratum is named, and no count or absence claim may be made outside a fully enumerated stratum |
| `spend-unknown` | A stage reported no usage on `ingest` | **Blocks `success`**, exactly as `not-demonstrated` does |

### 7.2 What blocks `success`

`snbrain ingest` refuses the terminal transition if any of these hold, and that refusal is the
last guard against verification debt:

1. any finding with `severity=blocking` AND `disposition=open`;
2. any page rendered `status: verified` that renders a claim still `draft`;
3. any stage recorded `spend-unknown`;
4. any test outcome recorded `not-demonstrated`;
5. the stratified precision sample below its floor (default 85%, 51 of 60), because a ledger
   that is 15% wrong generates questions that are 15% wrong-premise, and wrong-premise
   questions are the most expensive way there is to spend an expert's goodwill;
6. Gate 2 not approved;
7. any claim settled `unverifiable/not-sampled` — the population nobody read — and separately any
   `kind: aggregate` claim in that state at all, since every honesty ratio in the deliverable is
   computed over the census denominators and they are one `/stats` call each.

## 8. Memory

`.brain/` in the engagement repo is the durable spine. It survives context compaction, session
restarts and subagent boundaries. Nothing important lives only in the conversation.

| Path | Holds |
|---|---|
| `.brain/state.json` | stage, iteration counts, budget spent, per-stage terminal states, gate decisions with timestamps, scope-filter stamps, and **pointers** |
| `.brain/claims.jsonl` | one line per atomic claim, append-only |
| `.brain/questions.jsonl` | one line per generated question, append-only |
| `.brain/decisions.jsonl` | one line per answered question |
| `.brain/raw/<stage>.ndjson` | streamed evidence, **never held in context** |
| `.brain/in/<stage>.json` | the artifact the agent writes for `ingest`, at the exact path the brief names |
| `.brain/findings/<iteration>.json` | findings, out of line |
| `.brain/index/claim-decisions.json` | reverse index `claim to decisions[]`, rebuilt on every ledger write |

Why the split, and it is not tidiness: the pilot customer's single state file reached 354 KB (roughly 89k
tokens) because it writes the full findings array into every iteration entry, which means the
"durable spine that survives compaction" cannot actually be re-read into context. And its
projection is wrong in a way that hides work: `state.js show` prints `loop A: 4/3 iterations`,
an internally impossible figure, because it iterates only the live iterations and is blind to
archived ones. Sixteen real iterations, seven shown. **The projection is the real interface,**
so `snbrain status` prints a token-budgeted projection that is correct by construction.

Three consequences that are procedure, not preference:

- Every stage runs as a **fresh subagent** with a narrow, self-contained brief.
- Every stage **re-reads** its governing skill. Nothing is carried in context, because
  compaction silently drops standing constraints and on this platform the resulting failure
  is silent too.
- Every stage's result reaches disk through `ingest` **before** the orchestrator moves on.

## 9. Reading an instance we do not own

This is the contextualization analogue of the pilot customer's update-set ownership rule, and it is stricter,
because at the pilot customer the instance is ours and here it is not.

**The loop never writes to the instance. Not once, in any branch, including error paths.**
Being careful is not sufficient, so four mechanisms in `tools/snbrain/lib/api.js` make it
structural:

1. **Command allowlist**, nine commands in a frozen Set out of the 43 the extension
   dispatches, rejected before a socket opens. Two exclusions look harmless and are not:
   `sync_now` flushes the pending-write queue **to** the instance, and `switch_context`
   changes the session's update set and application scope.
2. **REST method is a literal.** `rest_request` is reachable only through `restGet()`, which
   hardcodes `GET`. No caller supplies a method, so none can smuggle one.
3. **Endpoint allowlist**, because GET is not universally safe on this platform. Only
   `/api/now/{table,stats,attachment}/`, and action-shaped parameters are refused.
4. **The request log is written before the send**, append-only NDJSON, so a crashed or
   timed-out call still appears. This is what makes read-only *provable* after the fact
   rather than merely asserted, and it is the artifact you hand the instance owner.

Also binding:

- **`switch_context` is forbidden**, and not only because it is a write. It mutates global
  browser-tab state, so under any concurrency one agent's switch changes another's context.
  The adapter records the scope reported at connect and stamps it on the run.
- **One workspace, one run.** A lockfile at `.brain/locks/<instance>.lock` holds pid,
  startedAt and runId. Contention waits with jittered backoff to a bounded deadline, then
  terminal `blocked` naming the holding pid. Never proceed unserialized.
- **Serialized transport.** `maxConcurrency` defaults to 1. The parallelism lives in the
  model, not in concurrent HTTP: reads are 100 to 400 ms and reasoning is seconds, so
  serializing the transport costs almost nothing and removes an entire class of unknown.
- **A batch abort is instance-wide.** One transient fault rejects every pending request for
  that instance at once, so retry logic must handle whole-batch rejection and the budget
  arithmetic must assume it.
- **Data egress is bounded.** Script bodies are never read in a sweep. They are read per
  candidate, and only for candidates that already survived the anti-waste gates, roughly 30
  to 60 records per run.
- **The window is a gate.** Record who agreed to it and when, in the state file.

## 10. Budget

Declared at start, enforced by the CLI, spent per stage, and reconciled at the end. The
default profile:

| Stage | Purpose | Expected calls | Hard cap |
|---|---|---:|---:|
| `preflight` | probes, canary, capability capture | 28 | 44 |
| `provenance` (part 1) | rung detection and deliberateness | 15 | 27 |
| `census` | counts per table per scope | 70 | 120 |
| `provenance` (part 2) | scope-filter calibration against both control sets | 24 | 40 |
| `harvest` | the sweep | 420 | 700 |
| `verify` | ledger, guards, stratified re-verification | 130 | 200 |
| `render` | closing watermarks, reconciliation, read-only proof | 36 | 60 |
| reserve | retries, canary re-issues, batch-abort recovery | | 109 |
| **total** | | **723** | **1,300** |

Global default `budget.apiCalls = 2000`, wall clock 45 minutes, spend ceiling USD 50 per run.
Wall clock is the real constraint, not calls: at one read per second, 1,300 reads is about 22
minutes of pure transport and the model's reasoning dominates. Plan two connected sessions of
60 minutes or less inside the agreed window.

**Spend reporting is part of the seam.** The CLI does not see token usage, so the harness shim
reports usage back on `ingest`. A stage that reports none is recorded `spend-unknown`, and
that blocks terminal `success`. Multi-agent pipelines cost roughly an order of magnitude more
than single-agent work; that is the accepted price of maker/checker separation, not something
to discover from an invoice.

## 11. Autonomy level

**L2, assisted and human-gated.** Report and act within a bounded loop; the human holds both
gates and the handoff.

One asymmetry against the pilot customer worth stating precisely: this loop is **read-only against the
instance**, so the blast radius that justifies gates in the build loop does not exist here.
The gates remain for a different reason. **The machine cannot produce WHY.** Gate 1 protects
the scarcest resource in the engagement, which is the expert who can answer, by making the
question list something a human chose to send. Gate 2 refuses to let a machine-derived draft
become "verified" without a human saying so.

This loop does not graduate to L3. The ceiling is not the transport, it is that no verifier
catches intent mismatch, and on this platform the failure is silent.

## 12. Anti-patterns this spec exists to prevent

| Anti-pattern | Guard |
|---|---|
| A model deciding it is finished | §3, the CLI owns `nextStage` and every terminal state |
| `while true` around a stranger | §6 budget, caps, stagnation, runaway guard |
| A stagnation breaker that never fires | §6.3, resolutions counted from the ledger; ids content-hashed by the CLI |
| A stage closing itself by editing a severity string | §4.1, four separate fields and a closure predicate over two of them |
| Self-approving loop | §5 maker/checker separation, artifacts-only briefs, checker gets claim text only |
| Coverage theatre | §0 and §6.1, MAP's stopping rule is a budget and is labelled one |
| Precision quoted as if it were recall | §6.5, disclaimer in the same visual block, census denominator, suppressed list |
| Pretending L4 is L1 | §4, every check declares its rung; L1 means the CLI issued the query |
| Reporting "no changes found" on an instance that never used update sets | §7.1, `inventory-only` and `filter-non-discriminating` are stamped results with numbers |
| Treating an empty read as an empty table | §4.1, L0 in the same batch, positive canary, no absence claims outside enumerated strata |
| A question flood from lone anomalies | §0, contradiction / delta / register-gap gate, clustering, ranking, cap. **The cap is the safety mechanism, and the ranking function carries the load** |
| Asking about ServiceNow's own defaults | §7.1, the scope filter's four-part discrimination gate runs before any question is emitted |
| Approval fatigue at gates | Gates receive an **evidence pack**, not a transcript. See the `snbrain-map` skill |
| Context rot erasing standing constraints | §8, fresh subagent per stage, skills re-read every time, `next` is idempotent |
| Verification debt | §7.2, `success` is refused while any of six conditions holds |
| Writing to an instance we do not own | §9, four structural mechanisms plus an append-only request log |

## 13. Files

| Path | Role | Status |
|---|---|---|
| `.claude/snbrain/LOOP.md` | This spec. The contract | this file |
| `.claude/commands/map-instance.md` | The slash command the operator types | built |
| `.claude/skills/snbrain-map/SKILL.md` | Orchestration procedure, what main-Claude does | built |
| `tools/snbrain/lib/api.js` | READ-ONLY sn-scriptsync client. Every instance read goes through it | built and committed |
| `tools/snbrain/probe.js` | The eleven WP-A probes. This **is** the preflight stage | built and committed |
| `tools/snbrain/snbrain.js` | `init` / `next` / `ingest` / `status` / `claims` / `questions`. The state machine | contract, built by the CLI lane |
| `tools/snbrain/schemas/<stage>.json` | Per-stage artifact schema that `ingest` validates against | contract |
| `docs/rework-plan.md` | The design of record. Where every rule above is argued | built |
| `.brain/**` | Per-engagement durable memory. §8 | created by `init` |

If this file and any skill ever disagree, **this file wins.**
