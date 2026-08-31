# Rework Plan: the SN Agent Contextualization Framework's loop layer

**Author:** architecture review, 2026-08-04. **Revision 4:** 2026-08-04, same day. Read the REVISION 4 block first: sections 4.9, 4.10 and 11 were placeholder text until this revision.
**Repos read:** `C:/Werk/sn-agent-contextualization-framework` (PRODUCT), `C:/Werk/ServiceNow/the pilot customer` (CUSTOMER)
**Status:** for operator review before any code changes.

Everything below was verified by reading and executing the repos, not by trusting the upstream audit briefs. Where a brief was wrong, the correction is marked and the brief loses.

## REVISION 2: what changed and why

Four operator corrections landed after revision 1 and two of them invalidate whole sections. Read this block before re-reading anything.

| # | Correction | What it kills | What replaces it |
|---|---|---|---|
| **C1** | **sn-scriptsync is the transport by design, not a legacy constraint.** The orchestrator is being built *for* the SN Utils product line. | All of old section 6: the ServiceNow REST Table API recommendation, the OAuth read-only integration user, the minimum-privilege ACL request list, the privilege-parity guard (which existed only because a restricted user sees less than the consultant), the adapter-equivalence spike, and the licence risk as a blocker (old 6.7 item 1, Q6). | A **two-rung sn-scriptsync-native read path** (new section 6). Every gap becomes a concise feature request to the developer, who is a collaborator on this PoC. The runner-side silent-failure guards survive intact and matter more, not less. |
| **C2** | **sn-scriptsync is not single-session-bound.** Many agents in one VS Code workspace share one connection. The limit is one connection per workspace. | The idea that HARVEST x N needs re-architecting. It does not. | The constraint is operational scheduling, not architecture. Now verified at source, not merely asserted: see 6.7. |
| **C3** | **The thesis inverts. MAP does not exist to produce the map. MAP exists to earn the right to ask the right questions.** Capturing WHY and HOW is where the brain's quality comes from. | INTERVIEW as leg three behind MAP and VERIFY. | Three loops with INTERVIEW promoted to first (section 4). The claim ledger is the **mechanism**; the decision ledger is the **product**. Section 9.2's "2 of 9" stops being an argument against the programme and becomes the argument for the new thesis. |
| **C4** | **The target is a PoC on `https://devinst01.service-now.com/`, the developer's own dev instance, with him as SME.** | Section 11's customer-mapping verification run, its OAuth prerequisites, its two-hours-of-SME-time checkbox, and claim precision as the headline metric. | A PoC design (new section 11) whose headline is **question precision**, measured by a five-step protocol of which four steps need none of his time. It proves the anomaly-detection leg at maximum-quality ground truth and deliberately does **not** prove the scale leg. |
| **C5** | **the pilot customer is out of scope for changes.** Two live defects already fixed (mirror re-synced, `kernel-integrity.js` given `--strict`). The `processes/` migration is deferred by operator decision. | Phase 0a in full, and every proposal to do work at the pilot customer. | the pilot customer is only (i) a source of platform-generic doctrine and check bodies, (ii) the host of a fact-recall regression, and (iii) the source of a free retrospective backtest that costs zero SME time and zero instance access. |
| **C6** | **Two revision-1 findings were overstated.** | B6's "the mirror rotted for a month and the detector was ignored", and B7's "the pilot customer's `processes/` tier is a void". | B6: the mirror was byte-identical to its last commit; the drift was one uncommitted working-tree edit and the hook detected it correctly. B7: the content exists under `engagement-docs/Docs/20-technical/` and `wiki/index.md:60-73` routes to all 12 pages honestly, labelled "legacy, pending wiki migration". Both corrected inline. |

**Also new in revision 2, and it is the single most consequential thing a red team found:** the guard layer was being sold for the wrong job, and the question-generation step has no mechanism at all. See 3.4 and 4.9. And the transport section is no longer a documentation read: the installed extension's compiled source is on disk at `<home>/.vscode/extensions/arnoudkooicom.sn-scriptsync-4.7.6/out/agent/`, it was read, and every load-bearing transport claim in section 6 is now cited to it.

## REVISION 3: an accuracy and completeness audit, and what it corrected

**Six claims about the two repos were wrong or overstated and are corrected inline.** In rough order of how badly they would have landed with a reader who checks: (1) 4.7 asserted that CONTRACT permits no `status:` key on any tier, but `CONTRACT.md:54` **requires** it on the Story tier. (2) 4.3 asserted that all 61 recorded the pilot customer test cases are `pass`, making the `finish success` guard "vacuous by construction"; re-measured there are **74 cases, 73 pass and 1 fail**, so the guard is live and only the narrower "NOT DEMONSTRATED recorded as pass" defect survives. (3) 4.10, 6.6 and 9.2b said archaeology "resolved TBD-038 with a full causal rationale"; the entry's causal clause is explicitly hedged "**likely**", so archaeology bought **intent and attribution, not WHY** (this is the third time a TBD-038 claim has been overstated in this document and it is now stated at its true strength). (4) 6.1 misquoted the vendor's method gate as `(method === 'POST' || 'PUT' || 'PATCH')`, a JS bug pattern that is **not** in his source. (5) Section 7's "8 checks are platform-generic, the rest are the pilot customer domain" undercounts: three more are generic and simply were not assessed. (6) A scatter of off-by-one citations: `state.js:29` not `:30`, `records.js:387-409` not `:388`, 73 not 74 lines of `render-kernel.js`, 48 skill directories not 47, two `PreToolUse` matcher blocks not one.

**One finding materially de-risks section 6 rather than damaging it.** `rest_request` and `readBackRecord` call the **same** `_shared.restRequest`, and `get_record` runs on `readBackRecord`, so the R2 browser-hop code path with arbitrary GET query parameters against `/api/now/table/*` is **already exercised in production** every time anything calls `get_record`. U11 drops from LOW risk to a residual fully covered by U12 to U14. See 6.1.

**Three structural additions.** (a) **A third leg the PoC cannot prove:** the session on a vendor instance is almost certainly `admin`, so the ACL-partial-read class is structurally out of reach, and the base-and-demo-data confound may make QG5's authorship filter fail in the *opposite* direction to the one 9.2b feared, flooding the queue with worthless-but-authored-looking records (11.1, U19, WP-A probes 9 and 10). (b) **The decoy control and the derivability oracle both had no decision rule**, which made the PoC's only falsification test ungradeable and let an L4 step wear an L3 label; both now have mechanical rules (11.3). (c) **The thesis's hidden dependency is now stated:** QG1 fires only on contradictions, contradictions come from L2 inside VERIFY, so VERIFY is a **prerequisite** of the product leg and not merely its protector, which is why section 10's construction order legitimately differs from section 4.1's importance order (3.4).

**Section 6.8 was rewritten as a deliverable.** Twelve items became **eight**, renumbered A1 to A8 with the FR8 hole and the item called "FR-NEW" gone, four cut because our own probes answer them or because they were the same request twice, and the licence question promoted out of the engineering list into Q14.

**Revision 1's completeness pass still stands.** Five things it found remain material: the **47-skill layer this plan never opened** (2.4), the fact that **every Copilot claim here is a documentation read while every ServiceNow claim is executed** (5.4), the **read-only law having no enforcement on either harness today** (B8), the **precision-without-recall overclaim** (9.6), and the enumeration of unverified claims (13).

## REVISION 4: two dead design lanes recovered, then corrected by a backtest

**Sections 4.9, 4.10 and 11 were placeholder text and nobody validated them.** Two design lanes died mid-run during revision 2, and those three sections were written from a briefing rather than from design work. Revision 4 replaces them with real design (4.9 the question engine, 4.10 the decision ledger, new 4.11 the provenance scaffold, 11 the PoC), and then corrects that design against a backtest run over the pilot customer's 15 recorded interview questions, 33 decisions, 44 TBD entries and the phase-0 audit. **Rule applied throughout: where the backtest refutes the design, the backtest wins, and a signal it says produces noise is deleted rather than softened.** Everything outside 3.3, 4.9, 4.10, 4.11, 10, 11 and 13 is unchanged from revision 3.

**Backtest verdict: ENGINE_VIABLE_WITH_CHANGES.** The headline number is the most honest evidence in this document: the question engine reproduces **5 of the pilot customer's 15 real interview questions (33%) with the the pilot customer repo corpus present, and 2 of 15 (13%) from a live instance alone**, which is the devinst01 condition. An independent check against a register the engine never saw agrees on the order of magnitude: roughly **7 of the pilot customer's 28 open TBD items (25%) are engine-reachable**. Nine of the ten misses have **no instance referent at all**. That is a permanent structural boundary, not a coverage gap that more signals would close, and it is now stated as one in 4.9.0.

| What the backtest changed | Where |
|---|---|
| **Nine signals or predicates deleted by name**, including all of QS-05b (simulated 1 genuine question in 28 emissions, a near-tautology on any ServiceNow instance) and QS-09b's 40-character name check. | 3.3, 4.9.4 |
| **`E(q)` was quadratic in cluster size**, which is a defect and not a weighting preference, and the pilot customer's own ledger says the value is in the *small* clusters: 17 of 33 decisions govern 1 to 3 artifacts and 4 govern none at all. Formula replaced and the three worked examples re-run. | 4.9.5 |
| **The 13 seed priors were optimistic by a factor of about 2.7**, and the bias was largest exactly where the design was most confident. Replaced with backtest-seeded priors, a hard **`C_signal >= 0.60` admission floor**, and a shadow queue for signals that have not yet earned admission. | 4.9.3, 4.9.5 |
| **The anti-waste filter is not the safety mechanism; the question cap is.** After every gate the queue is 89 to 155 deep against a cap of 10, so the ranking function carries the safety load. The pre-registered PoC suppression ratio measured the wrong step and is replaced. | 4.9.6, 11.4 |
| **Two of the six anti-waste gates are dark on run one of any engagement**, because they depend on artifacts the product exists to produce. devinst01 runs with both dark, and the plan now says so. | 4.9.6, 11.1 |
| **The scope filter passes cleanly on devinst01 while missing that instance's actual failure mode**, which is customer-authored *product scratch*. New terminal state `authored-but-undeliberate`, tested with one query. | 4.9.2, 11.2 |
| **The PoC removes the only signal that produced a genuinely novel finding at the pilot customer** (QS-08 needs a doc corpus; devinst01 has no repo) and keeps the signals that at the pilot customer mostly rediscovered the customer's own register. Stated as a sixth thing the PoC cannot prove. | 11.1 |
| **Instance questions for the developer cut from 8 to 5**, decoys held at 4, because padding to 8 means shipping questions from signals we do not believe in. | 11.3 |

**The one test that must run before any of `questions.js` is written, and it costs an afternoon of reading:** the whole design assumes **decisions are clusters**. `E(q)` makes cluster size the value term, the budget assumes it, and the four-questions-not-four-hundred promise depends on it. The evidence offered was four DEC sentences that were chosen *because* they cluster, and the counter-evidence is in the same file. Phase 0.1 now measures the distribution (10.1).

---

## 1. VERDICT

**MAP does not exist to produce the map. MAP exists to earn the right to ask the right questions.** That is the whole thesis and everything below is downstream of it.

The evidence for it was already in revision 1 and revision 1 drew the wrong conclusion from it. Section 9.2 measured that a perfectly executed MAP pass would score roughly **2 of 9** on the reference engagement's own acceptance suite. Revision 1 filed that as a reason to doubt the programme. It is not. It is the finding that tells you the value was never in the map. The map's job is to surface the anomalies, contradictions, orphans and provenance gaps that a human can explain in one line each. The single largest gap the the pilot customer audit found, an entire undocumented story that had deprecated the live SLA, was machine-detectable, and the human owner could not explain it: "dunno what's going on here tbf" (`_lab/INTERVIEW.md:68`). The machine found what the human had forgotten. **That** is the product, and the artifact it produces is a decision record, not a map row.

So the architecture is three loops and their order of importance is the reverse of revision 1's:

1. **INTERVIEW is the product.** Its output is a **decision ledger**: what was decided, why, which alternatives were rejected, by whom, when, and what supersedes it. the pilot customer's own ledger (`engagement-docs/Docs/wiki/decisions.md`, 33 entries) is the target artifact and it already exists, which proves the format is solved and the *capture* is not.
2. **MAP is the question generator.** Bounded, budgeted, resumable, one-shot. It emits a **claim ledger**, which is the mechanism that makes anomalies addressable, countable and diffable. It does not loop and it does not converge, because coverage has no signal (3.2).
3. **VERIFY is the loop.** Its corpus is the claim ledger, its signal is deterministic re-query, and its unique contribution to the decision ledger is the one thing no template can ever do: **when a claim drifts, every decision linked to that claim is automatically flagged for re-confirmation.** That is the strongest argument the decision ledger has and it should lead the pitch.

**Three verdicts that changed in revision 2.**

**The transport is decided, not benchmarked.** sn-scriptsync is the read path because the orchestrator is being built for the SN Utils product line (C1). The technical case turns out to be strong anyway: `rest_request` with `method: "GET"` is **ungated by design**, verified in the installed extension's own compiled source (`out/agent/commands/rest.js:29-33` gates DELETE and POST/PUT/PATCH only; GET falls through with no check, and `:20` validates the endpoint only as a string starting with `/`, so there is no path allowlist). That reaches the entire Table API read surface (paging, display-value pinning, aggregate counts, field allowlists) through an SN Utils command, on the consultant's own already-authenticated browser session, with no new credential. It deletes the OAuth account, deletes the privilege-parity guard that revision 1 called "the price of the 6.1 recommendation", and dissolves the licence question into a partnership item. Section 6.

**The guard layer was being sold for the wrong job.** Revision 2's first draft of section 6 argued that the silent-failure guards buy *question* precision, because a silently-unfiltered read manufactures a fabricated anomaly that wastes the SME's time. That argument is wrong on its own arithmetic: a fabricated anomaly and a true-but-trivial anomaly cost exactly the same one wasted question, and on a configuration platform trivial-true dominates by orders of magnitude (this plan's own 9.7 item 3: "on a brownfield instance, dead config is the norm, not the anomaly"). The guards buy **claim** precision, which is where they genuinely earn their 29% of the MAP budget. Question precision needs its own mechanisms and the design had none: every ranking and suppression step in the current chain is a model grading its own output, which is this plan's own definition of L4 (4.3) and can never close a loop alone. Three mechanical filters now gate question emission: **contradiction-gating, cluster-then-ask, and blast-radius ranking** (3.3, implemented in 4.9).

**Change provenance is not ARCHAEOLOGY's input. It is the question generator's scope filter.** This is the deepest structural finding in either revision and nothing in the product addresses it. On any ServiceNow instance the overwhelming majority of rows in `sys_script`, `sys_ui_policy` and `sys_security_acl` were shipped by ServiceNow, not authored by the customer. The only mechanical way to tell them apart is customization provenance, which is the same data the provenance layer collects. Remove it and the generator preferentially asks about ServiceNow's defaults: the maximally-derivable, maximally-worthless class. So provenance detection is a **go/no-go precondition on the interview leg**, not a scoping note, and it needs the fallback ladder in 6.9 because update sets alone will not carry it on a vendor dev instance.

**What survives revision 1 unchanged.** Discovery does not loop, verification does; drift is not coverage; the coverage ratio is a specification-gaming trap and stays killed; `unverifiable` is a first-class status; severity is not free text; the CLI allocates ids and captures responses; the model is a component and the CLI is the orchestrator. And two smaller ones: the current script is a fixed-path open loop, not an unbounded retry, so the fix is a feedback edge rather than a brake; and `sn-capture-verifier.js` is advisory and fail-silent (`process.exit(0)` on every path, `.claude/hooks/sn-capture-verifier.js:86,95,98,109,112,142,149`), so `docs/architecture.md:96` grading it "Deterministic" is wrong by the repo's own standards.

---

## 2. WHAT IS ACTUALLY WRONG TODAY

Ranked by cost to the engagement, not by how bad it looks in a code review. Three categories, kept separate on purpose.

### 2.1 BROKEN (ships wrong answers or silently loses work)

| # | Defect | Evidence | Cost |
|---|---|---|---|
| B1 | **Silent partial failure is designed in.** A run that loses three of four harvest agents still writes a confident `bootstrap-report.md` with no indication that 75% of the instance was never swept. | `.claude/workflows/bootstrap-project-brain.js:149` `harvest.filter(Boolean).flatMap(...)`. Archaeology total failure is indistinguishable from "found no questions" at `:148`. | Highest. The output is presented as a map and the customer cannot tell which parts were never visited. |
| B2 | **The interview queue truncates mid-JSON.** The consolidated question list is `JSON.stringify(allQuestions).slice(0, 30000)`, cutting inside a string literal on any large run. | `bootstrap-project-brain.js:153` | High. INTERVIEW.md is the artifact the entire "WHAT never WHY" doctrine depends on, and it silently loses its tail. |
| B3 | **Dead-config detection uses the exact technique the repo's own audit playbook forbids.** Harvest is told to flag business rules whose filters match 0 rows; the repo documents that an invalid field in an encoded query drops the clause and returns *unfiltered* rows. | Instruction at `bootstrap-project-brain.js:138-140`; countermeasure absent from LAWS at `:26-43`; the mandatory A/B rule is at `playbooks/01-audit.md:19-21`; the trap is live at the pilot customer, `engagement-docs/Docs/00-global/_lab/audit-phase0-findings.md:219` records that a dot-walk A/B read is inconclusive for exactly this reason. | High. Wrong in both directions: live config written up as dead, broken config written up as healthy. |
| B4 | **Four concurrent agents append to one file and read-before-write a shared directory.** No locking, no per-agent staging, no merge, and slug allocation is per-agent so two agents will mint different slugs for the same process. | `bootstrap-project-brain.js:127` (`parallel`), `:132-137`; the slug rule it violates is `wiki-scaffold/CONTRACT.md:93-98`, and the canonical slug list ships empty at `CONTRACT.md:100`. | High. Lost updates plus guaranteed `processes/` fragmentation on the first real instance. |
| B5 | **Not executable outside Claude Code.** Top-level `return` at `:66`, `:84`, `:167`; injected globals `args`, `phase`, `agent`, `parallel`, `log`; no `package.json`. | Verified by execution: `SyntaxError: Illegal return statement`. | High for the product, zero for the current user. Blocks any portability story. |
| B6 | ~~The Copilot kernel mirror at the pilot customer rotted.~~ **CORRECTED, revision 2 (C6). Overstated and withdrawn.** The mirror was byte-identical to its last commit; the observed drift was a single uncommitted working-tree edit, and `kernel-integrity.js` detected it correctly. The hook worked. | The surviving, narrower defect: the detector **reported and exited 0**, so drift was advisory. Already fixed at the pilot customer by operator decision (`--strict` gate mode added). | **Low, and closed.** What generalizes to the product is one line: a detector that exits 0 is not enforcement. Same class as B8. Do not cite this as evidence of rot. |
| B7 | ~~the pilot customer's `processes/` tier is a void.~~ **CORRECTED, revision 2 (C6). Overstated and withdrawn.** The content exists: 12 process areas under `engagement-docs/Docs/20-technical/`, and `engagement-docs/Docs/wiki/index.md:60-73` routes to every one of them, each labelled "legacy, pending wiki migration". | The roughly 105 `](processes/...)` links in `decisions.md` and `glossary.md` are **forward references to an unfinished migration**, not knowledge loss. Verified: `ls engagement-docs/Docs/20-technical/` returns all 12 areas; `wiki/index.md:60-73` lists all 12 with honest labels. | **Low. A navigation annoyance.** It is still a legitimate example of what a link validator catches (a link resolving is mechanical, a link being an intentional forward reference is not), but it is not an argument that a knowledge tier is missing, and per C5 nobody is fixing it. |

| B8 | **The read-only law has no enforcement on either harness, and the one hook that could enforce it is fail-open.** `sn-write-guard.js` returns `permissionDecision: "ask"` (`:66`), never `deny`, and calls `process.exit(0)` on an unparseable payload (`:54`, commented "fail-open"), on any non-write verb (`:59`), and on a non-matching file path (`:48`). It is wired at `PreToolUse` under two separate matcher blocks, `Bash|PowerShell` and `Write|Edit` (`.claude/settings.json`), which does not cover an agent-API call issued through any other tool surface. | `.claude/hooks/sn-write-guard.js:48,54,59,66,97`; wiring in `.claude/settings.json`. | High, and it compounds with 5.3: `ask` degrades to `deny` on Copilot Cloud Agent but to *nothing* on any harness without hooks. Same defect class as B6: a detector that reports and exits 0. |

### 2.2 MISSING (the thing does not exist at all)

| # | Gap | Evidence |
|---|---|---|
| M1 | **No state, no run id, no per-phase result.** A crash at Harvest loses everything; a rerun duplicates rather than repairs. | Zero filesystem writes anywhere in `bootstrap-project-brain.js`; the only output is an in-memory return at `:167-172`. Contrast `.claude/loop/state.js` (273 lines, verbs init/record/gate/test/finish/show at `:260`). |
| M2 | **No machine-readable claim representation.** Everything the run learns becomes prose in a markdown page. Nothing is individually addressable, re-checkable, or countable. | The only structured artifact is `Q_SCHEMA` at `:45-52`, which constrains the *return value*, not anything on disk. |
| M3 | **No coverage or correctness metric, despite collecting the denominator and discarding it.** | `artifactCount` required at `:79`, never referenced again; `scopes` used only at `:86,91,129`. |
| M4 | **The link and frontmatter validator that two design documents describe as existing does not exist.** | Claimed at `docs/architecture.md:102-105` and `wiki-scaffold/CONTRACT.md:10-11,49-50,90-91`. Reality: five hooks in `.claude/settings.json`, none reads the wiki; no `.githooks/`, no `.husky/`, no validator source. |
| M5 | **The probe suite has never run, cannot fail a build, and is not portable.** | `probes/answers/` contains only `RESULTS.md`, which is a header and an empty table with zero data rows. `probes/run-probes.sh:33` hardcodes `claude -p`; `:37` hands grading to a human; the script exits 0 regardless. |
| M6 | **No feedback edge from probe failure back to knowledge repair.** The closure exists as two sentences of English. | `playbooks/03-enforce.md:73-74`, `playbooks/04-operate.md:76-80`. The workflow never invokes probes (the word appears in `bootstrap-project-brain.js` only in the farewell log at `:166`). |
| M7 | **No `unanswerable` outcome.** The escalation path terminates in a human, and the human's measured failure rate is roughly 20%. | Of 15 interview questions at the pilot customer, Q7 answered "Doesn't recall the details ('dunno what's going on here tbf')" (`_lab/INTERVIEW.md:68`) and Q15 is still `_pending_` (`:133`) eleven days on. the pilot customer's six terminal states (`LOOP.md:110-123`) have no state for this. |

### 2.3 FINE BUT MISLABELLED (do not "fix" these, relabel them)

| # | Thing | Real status |
|---|---|---|
| F1 | "No verification of any kind." | Wrong. There is exactly one rung: DRAFT banner plus interview plus human de-DRAFT (`bootstrap-project-brain.js:34-41`, `.claude/skills/bootstrap-project-brain/SKILL.md:20-24`). In the pilot customer's own taxonomy that is **L5, "Final"** (`LOOP.md:69`). It demonstrably worked: the pre-wiki glossary carried a wrong expansion of accident report, the core domain term, for five months, and only the rewrite-plus-interview caught it (`engagement-docs/Docs/wiki/glossary.md:11-14,21`). The real defect is narrower: **no L1, L2 or L3 rung exists beneath it, and nothing mechanically records whether the L5 gate ever ran.** |
| F2 | "Unbounded retry." | Wrong failure mode. Five `phase()` calls, once, unconditionally. It terminates deterministically. It is a fixed-path open loop with no feedback edge. |
| F3 | Tiered archaeology (`metadata` / `bounded` / `full`, `:22,105-111`). | Correct effort scaling and the one design decision that survives review. Keep it; drive tier selection from census evidence instead of an operator flag. |
| F4 | Preflight (`:56-67`). | A genuine gate with a canary and a hard abort. Port it. One caveat: its verdict is the model's own `{ok:boolean}` self-report, so it must become a runner-side precondition. |
| F5 | `sn-capture-verifier.js`, graded "Deterministic" and called "the flagship". | Advisory and fail-silent. Emits `additionalContext`, exits 0 on every path (`:86,95,98,109,112,142,149`), and selects targets by grabbing the first three 32-hex strings out of command plus response (`:24,26,106`), which in a `create_artifact` call are often the scope and update-set ids. The **pattern** is right and must be preserved. The **grade** is wrong and the implementation must not be the L1 exemplar. |
| F6 | The wiki scaffold "conforms to CONTRACT.md". | It does not. `CONTRACT.md:48-49` requires `title:` plus `mentions:` on all pages and `verified:` on registry tier. All 12 scaffold pages carry `title:` plus `last-verified:`; `verified:` appears in zero files; `mentions:` appears in exactly one (`stories/_TEMPLATE.md:15`). A validator built tomorrow would fail the pristine scaffold. |
| F7 | Kernel routing for INTERVIEW.md. | Broken by one `../`. `kernel/CLAUDE.template.md:96` routes to `{{paths.wikiRoot}}/../INTERVIEW.md`, which with the default `docs/wiki` (`product.config.json:29`) resolves to `docs/INTERVIEW.md`, while the scaffold, CONTRACT and workflow all put it at `docs/wiki/INTERVIEW.md` (`bootstrap-project-brain.js:158`). |

### 2.4 REPO AREAS THIS REVIEW DID NOT EXAMINE (stated so nobody mistakes silence for a clean bill)

Completeness honesty. Everything above is verified. Everything below was not opened, and three of these are load-bearing for the rework.

| Area | Size | Why it matters to this plan | Owed before phase 1 closes |
|---|---|---|---|
| **`.claude/skills/` (48 skill directories plus a README)** | The largest single asset in the product repo by file count. **Counted for revision 3, because the repo's own README is off by one:** `ls -d */` returns **48** directories, while `README.md:1` says "47 build-procedure skills" and its composition block accounts for 41 engagement-hardened plus 6 rebuilt = 47. The 48th is `bootstrap-project-brain`, which is a discovery workflow rather than a build procedure, which is probably why the README's arithmetic excludes it. **It is also the skill phase 3 retires, and phase 3 as written only deletes the workflow file.** | **This is the biggest hole in the plan as written.** Sections 5, 7 and 8 never mention the skills layer. It is not in the T1 emitter scope, not in `validate.js` scope, not in the backport table, and not in the Copilot portability story, even though `probes/README.md` states the probe suite must be re-run after every change to "kernel, wiki, **skills**, hooks". The 6 rebuilt skills are unverified content shipping in a commercial product with a banner as the only control. | An inventory pass: which skills are the retrieval targets for MAP-produced claims, which carry unverified content, and what the Copilot rendering path for them is (see 5.4). |
| **3 of the 5 hooks: `skill-trigger.js`, `sn-artifact-skill-reminder.js`, `sn-write-guard.js`** | ~11 KB | `sn-write-guard.js` is now B8. `skill-trigger.js` harvests routing phrases out of skill frontmatter at runtime, which is a *dynamic* router and is the closest existing thing to section 7's "grow `table-gotchas.json` into a real router". Section 7 proposes building a router without noticing one already exists. | Read all three, reconcile 7's router proposal with `skill-trigger.js`, and grade each hook's fail-open behaviour the way B6 and B8 were graded. |
| **`playbooks/01` through `04` beyond the cited lines** | 5 files | They are the current canonical definition of "done" and they will contradict the CLI the moment phase 3 lands. Phase 3 says "reconcile the playbooks" with no file list and no section list. | A line-level diff plan per playbook file, produced in phase 1, not phase 3. |
| **`docs/research.md` beyond `:208-223`** | 1 file | It carries an explicit falsification record. If any claim in this plan is already falsified there, this plan loses. Nobody checked. | Read it in full and record agreements and conflicts. |
| **`product.config.json` slot changes** | 1 file, 45 lines | The new design needs slots that do not exist: `.brain` root, MAP and VERIFY budgets, read page sizes and concurrency, staleness horizon, instance identity for claim stamping. Today `budgets{}` holds only `kernelTokens` and `alwaysOnTokens` (`:41-44`). **Revision 2:** `tooling.agentPortFile` is at `:38`, not `:44`, and it is **promoted, not demoted**: it is the primary transport config (C1). | Slot list in 6.11, all with defaults. **Correction:** `render-kernel.js` only validates the nine slots `kernel/CLAUDE.template.md` actually interpolates, so a new `read.*` or `instanceIdentity.*` slot is invisible to it and cannot break it. Ship defaults anyway, because hooks and the adapter read the config at runtime and must fail open. |
| **The 41 the pilot customer story pages and the the pilot customer `.claude/skills/` tree** | not counted | Section 9.1's byte-versus-line correction was measured on the pilot customer story-page frontmatter and then extrapolated to the whole 385,818-byte wiki. The extrapolation itself is not shown. | Either show the whole-wiki measurement or downgrade 9.1's number to "measured on story pages, extrapolated". |

---

## 3. THE FEEDBACK SIGNAL

This is the section the rest of the plan hangs from. A loop needs a signal that (a) exists, (b) the model cannot manufacture, and (c) changes what happens next. Below is every candidate, graded honestly. Two of them are theatre and I kill them here.

**Revision 2 re-ranks this section without deleting anything from it.** The analysis in 3.1 and 3.2 survives intact and every grade stands. What changes is priority. Under the old thesis the question was "which signal tells us the map is right", so S1 (re-query) led. Under C3's thesis the question is "which signal produces an answerable question", so the new 3.3 leads and S1 through S6 become its supporting cast. The distinction is not cosmetic: **a signal that verifies a claim closes a loop about the ledger; a signal that generates a question closes a loop about the instance's history, which is the only place WHY lives.** Read 3.3 first, then 3.1 as the machinery underneath it.

### 3.1 The signals that are real

**S1. Value-level re-query of a written claim (claim ⟂ instance). L1. Cheap. Not gameable if the runner issues the query.**

This is the one signal with field evidence. the pilot customer ran it once: 26 claims, 18 API calls, read-only, producing 22 CONFIRMED, 3 DRIFTED, 1 GONE (`audit-phase0-findings.md:208`). It found an entire undocumented story (STRY0185005) that had deprecated the live main-action SLA with zero repo trace (`:46-50`). And the audit states precisely why nothing weaker works: "None of the live drift found would surface as API errors; deactivations, renames, deletions all return clean responses; only value-level comparison catches it" (`:119`).

It is cheap (roughly 0.7 API calls per claim at the pilot customer because claims batch by table), deterministic, and un-gameable **provided the CLI holds the query and performs the diff**. If the model performs the comparison it degrades to L4 immediately, and the METR reward-hacking evidence (39 of 128 runs, 30.4%, including patching the evaluator itself, https://metr.org/blog/2025-06-05-recent-reward-hacking/) says assume it will be gamed.

**It can close a loop.** Specifically it closes the loop on *this claim's truth as of now*. It closes nothing about coverage.

**S2. Query-validity control (A/B or dictionary validation). Rung L0, beneath L1, mandatory.**

Every negative result on this platform is unsound by default. An invalid field name in an encoded query drops the clause and returns unfiltered rows (`wiki-scaffold/gotchas.md` section 2.1; live-confirmed at the pilot customer, `audit-phase0-findings.md:219`). A dead helper tab returns `count: 0` while `check_connection` reports ready. So before any query whose emptiness or whose filtering would be interpreted, the runner must either validate every field in the encoded query against `sys_dictionary` (one cached query per table) or issue the negation control. This is not a rung that closes anything; it is the floor that makes L1 mean anything. the pilot customer does it by convention in agent prompts. The product must do it in code.

**S3. Referential integrity of the produced brain. L1. Near-free. Not gameable. Closes a real loop.**

Do links resolve, does frontmatter conform to CONTRACT, is every `processes/` slug in the canonical list, does every `mentions:` entry appear in the registry, does every registry row cite an evidence query. This is a 150-line Node script. It is the cheapest deterministic check available and both repos fail it today (2.1/B7, 2.3/F6). It cannot tell you whether the brain is *true*, but it closes the well-formedness loop completely and mechanically, and it retroactively makes about six existing CONTRACT rules enforceable rather than decorative.

**S4. Cross-source contradiction. L2. Moderate cost. Hard to game. Closes a loop on internal consistency.**

Two independent derivations of the same fact disagree: the deployment matrix says a story shipped to test, the update set state says loaded; the registry says a business rule is active, the process page describes it as retired; two harvest areas minted different slugs for the same target table. This is exactly the shape of the pilot customer's `checkCrossRow` in `.claude/loop/lib/checks.js` and it ports directly. It caught real defects at the pilot customer (the two-open-update-sets collision in `state/STRY0186518.json`).

**S5. Probe answerability, mechanically graded. L1 if the assertion is mechanical, L4 if a model grades it.**

the pilot customer's suite is the only measured statement anywhere of what the brain is *for*: nine probes, 8/8 recorded on 2026-07-24 (`_lab/probes/answers/RESULTS.md:3`). The product's four seed probes are the right shape for a platform fact-recall regression and nothing more. To become an L1 rung they need machine-checkable assertions (required substrings plus forbidden substrings, which is already what `probes/probes.md` demands when it says EXPECTED must be "concrete enough to grade mechanically") and an exit code. Today they are neither run nor graded nor portable.

**S6. Round-trip re-derivation. L3. Moderate cost. Gameable in one specific way.**

Hand a fresh agent only the wiki page, with no instance access, and ask it to emit the artifact definition; then diff against the real record. This is Allamanis et al., ICML 2024 (https://proceedings.mlr.press/v235/allamanis24a.html), and it is genuinely validated: the paper reports RTC correlates with model performance on existing narrow-domain benchmarks, so it is a measured method rather than a proposal. It needs no SME and no ground-truth wiki, which is exactly what operator decision 1 requires. The gameable path: if the checker sees the page's evidence line, it re-runs the maker's query and you get confirmation rather than verification. So the checker gets the **claim text only** and must derive its own query. A claim whose truth depends on which query you used is, by definition, a bad claim.

Recommendation: build S6 in phase 3, not phase 1. It is the highest-value *new* rung and the one with the most design risk.

### 3.2 The signals that are theatre. Killed here.

**T1. Coverage ratio as a convergence criterion. KILL.**

"Registry rows divided by `sys_metadata` artifacts in scope" fails three ways. First, it is trivially gamed: an agent maximizes it by dumping every row, and Gao et al. on reward-model overoptimization (https://arxiv.org/abs/2210.10760) predicts exactly this. Second, it targets the wrong thing: the pilot customer's registry is 297 lines for two scopes containing thousands of artifacts and it is the **right size**; a registry that enumerated everything would be a second instance, not a brain. Third, it is uncomputable under the current design anyway. The four harvest areas partition disjoint table families (`bootstrap-project-brain.js:121-126`), so every claim is found by exactly one pass, singletons equal total detections, and every capture-recapture estimator returns zero information by construction.

**T2. Good-Turing / Chao2 species estimation as a stopping rule. KILL for now, keep as a research option.**

The maths is sound (Böhme, TOSEM 2018, https://dl.acm.org/doi/10.1145/3210309) and it is the mathematically honest form of a coverage claim. But three things block it. It requires **redundant overlapping passes**, which the design does not have and which cost real money at Anthropic's measured ~15x multiplier for multi-agent work (https://www.anthropic.com/engineering/multi-agent-research-system). Adaptive sampling bias breaks naive estimators (Böhme et al., ESEC/FSE 2021, https://dl.acm.org/doi/10.1145/3468264.3468570) and an LLM explorer is maximally adaptively biased. And no published work has ever validated any of this on an enterprise configuration platform. Do not put a Chao2 number in front of a customer.

What survives, and what the pilot customer already did correctly: **report the sample honestly.** "26 claims re-verified out of an estimated N assertions; 4 disagreements; 15% drift; unsampled areas may hold comparable surprises" (`audit-phase0-findings.md:220`). That is a defensible number. It is a *floor on ignorance*, not a completeness certificate, and it is exactly what `playbooks/01-audit.md` already demands when it says to report the sample size and treat the drift rate as an estimate.

**T3. Held-out prediction. Not theatre, but not a loop rung.** Hide one scope from the MAP pass, then ask the brain to predict what is in it and score against reality. This is the only clean coverage signal I can construct. It is expensive, it runs once, and it belongs in the verification run (section 11) as a calibration measurement, not in the loop.

### 3.3 The question-generation signals. NEW IN REVISION 2, and these now outrank 3.1.

A signal here is not "is this claim true". It is **"does this observation buy a question a human can answer in one line, that we could not have answered ourselves"**. Four candidates. Three are mechanical and go in the CLI. One is model judgement and is capped, not trusted.

**QG1. Contradiction between two independent derivations. The strongest question signal there is.**

This is S4 wearing a different hat, and the re-hat matters. A single record that merely *looks* odd contradicts nothing and is almost always ServiceNow shipping something. Two derivations that disagree cannot both be right, and the disagreement itself is the question: "the deployment matrix says this shipped to test, the update set says loaded, which is it and why". Of the pilot customer's six instance-derived interview questions, **five were contradictions** (Q7 live change with no repo trace, Q10 a filter that matches zero rows against a story that says it works, Q13 an inactive member of an otherwise-live cluster, Q14a and Q14b registry rows contradicting live state). Q15 was a delta against a prior value. Not one of them was "here is an unusual record". **Rule: emit a question only on a contradiction, a delta, or a register-gap. Never on a lone anomaly.**

**Revision 4 adds the third gate, and without it the highest-yield question class in the design is unreachable.** Domain vocabulary produces no contradiction and no delta: `accident report` simply appears in labels and is absent from the glossary. Under the two-gate rule that question is never emitted, yet it is the class with the best measured evidence in either repo, because the pilot customer's pre-wiki glossary carried a **wrong expansion of accident report, the core domain object, for five months** (`wiki/glossary.md:13-15,21`) and the glossary rewrite plus interview is what took the probe suite to 8 of 9 (9.4 item 3). The discipline the two-gate rule enforced is preserved by requiring every gate to be a **named two-source disagreement with a support count**, never "a model found this odd", and by admitting a register-gap **only against a register that is complete by construction**. Two qualify today, `glossary.md` and `decisions.jsonl`, both closed by contract. A process page is not closed, so "this artifact has no process page" is explicitly refused. Full specification in 4.9.1.

**QG2. Cluster density. The filter that decides whether you ask 4 questions or 400.**

The unit of a good question is a **decision**, and decisions are clusters, not records. the pilot customer's own ledger proves it: DEC-006 ("OOTB ACLs on generic ServiceNow tables were deactivated wholesale"), DEC-008 (OOTB workspace landing pages hidden via screen applicability), DEC-009 (all H&S Now Mobile items deactivated), DEC-010 (all OOTB `category` choices on `sn_ohs_im_incident` deactivated). Four sentences explain what a per-record detector would surface as hundreds of findings. Mechanical implementation: group candidates by `(table, change-type, author, timestamp-window)`, emit one question per cluster with the member count attached. This is a group-by on data MAP already holds and it costs nothing. **The anomaly-to-question ratio is a first-class run metric**, because it is free and it is the only number that will tell you the filter works before the SME does.

**QG3. Blast radius. The ranking function, and it mechanizes a rule this plan already wrote.**

Rank candidate questions by the count of **active** artifacts that reference the anomalous one. This is 9.7 item 3's triage rule ("inactive artifacts are inventory rows, never findings, unless something active still references them") turned into a number instead of a paragraph. It is a graph computation over the claim ledger, it needs no model, and it converts "highest-stakes first" from a prompt instruction into an ordering.

**QG4. Model-judged salience. L4. Capped, never trusted, and this is where the residual judgement goes.**

After QG1 gates, QG2 clusters and QG3 ranks, a model picks the top N (default 10) and writes the one-line question. That is a far better-conditioned problem than "how many questions should there be", which is what the current design asks it. The cap is the control: `bootstrap-project-brain.js:45-52`'s `Q_SCHEMA` accepts free-text `whyItMatters` with nothing machine-checkable in it, and `:158` asks synthesis to "dedupe and prioritize, highest-stakes first". Both are the model grading its own output. Keep the model for the wording, take the arithmetic away from it.

**QG5. Provenance-scoped universe. A precondition, not a signal, and it gates all four above.**

The generator may only consider records with **positive customer-authorship evidence**: a `sys_update_version` row, a local update record, a human `sys_created_by`, or a `sys_mod_count` above a baseline established on a known-untouched control record. Without it the generator cannot separate a customer decision from a ServiceNow default and will preferentially ask about defaults. See 6.9 and 4.11 for the fallback ladder that keeps this alive when update sets are absent.

**Revision 4 moves QG5's go/no-go off provenance and onto the scope filter, and this materially de-risks section 11.** Revision 2 made update-set-shaped provenance a precondition for raising any question at all. That conflates two different jobs. *Deciding customer-authored versus ServiceNow default* is a precondition: get it wrong and every question is worthless. *Recovering who, when and inside-what* is a question-**quality** multiplier that converts expensive open questions into cheap closed ones, so its absence costs yield, not validity. Nine of the eleven surviving signals in 4.9.3 are pure current-state contradictions and need no prior-state source at all, and the scope filter has clone-resilient rungs that do not depend on update sets. Therefore: **`inventory-only` fires when the scope filter cannot discriminate, not when update sets are thin** (4.9.2). One exception, added by the backtest and binding on the PoC: on a **single-owner vendor instance** update-set membership is the only available proxy for *deliberateness*, so 11.2 reinstates it there as a go/no-go. See 11.1.

### 3.3b Reconciliation with the backtest's surviving catalogue. Killed signals, named.

QG1 to QG5 above are a shape, not a catalogue. 4.9.3 is the catalogue, and the backtest deleted nine of its entries or predicates outright. Named here so nobody re-proposes them from this section:

| Deleted | Simulated on the pilot customer | Why it dies |
|---|---|---|
| **QS-05b**, negative comparison (`field!=value`) against a live empty population | 28 emissions, 1 genuine (about 4%) | Nearly every active guard on this platform contains a `!=` and nearly every field has empty rows, so the predicate is close to a tautology. The design's defence was severity, not precision, and severity times 4% precision is a queue of 27 non-questions. DEC-031 is real but was learned from a production failure, not from a detector. |
| **QS-09b predicate 1**, `length(name) === 40` | dominates that signal's ~10% | A coincidence detector with no second source, so it fails QG1's own two-source rule. Even a true positive is cosmetic unless something keys on the name. Routed to `verify.js` as an L2 repair finding. Predicates 2 and 3 survive. |
| **QS-12 predicate 6**, script-body Jaccard >= 0.9 | ~12 pure-noise emissions | Fires systematically on the pilot customer's *deliberate* EN plus NL notification duplication (DEC-030, `wiki/decisions.md:99`), and costs script-body reads to do it. Any near-duplicate predicate must first subtract the customer's own detected duplication convention, and nothing does. |
| **QS-04 predicate 4**, update-set name deviates from the induced story pattern | 10 to 30 emissions, essentially all worthless | It is the naming-deviation signal this plan already rejects for display names, readmitted through a side door. Fires on Default, on batch records and on every ad-hoc fix set. Predicates 1 to 3 survive and are backed verbatim by TBD-039 and TBD-043. |
| **QS-07b and QS-06e**, roles with zero holders, on any instance stamped `tier=dev` | n/a | A dev instance is not provisioned. "This role has no holders" means "we have not built the prod user base yet". Valid only against production or a production clone, which is neither devinst01 nor devinst02. |
| **QS-11 under `provenance: metadata-only` or weaker** | 18 emissions, 3 genuine even with the qualifier active | The design said it "degrades to time-clustering". Time-clustering without the story-set qualifier is not a degraded signal, it is a change log, and on an actively developed instance it fires on all current work. Stamped **unavailable**, never shipped weakened. |
| **QS-10b**, near-synonym domain terms, as a standalone signal | 4 emissions, 1 genuine | The design concedes co-occurrence similarity has no semantic content. Its own the pilot customer example (`selecteren` versus `classificeren`, `wiki/glossary.md:35-36`) is already carried by the QS-10a vocabulary question, so folding it in costs nothing. |
| **QS-02 without the same-episode discriminator** | 25 emissions, 2 genuine (about 8%) | Eight of the pilot customer's 33 decisions are batch deactivations shipped alongside newly created active records (DEC-006, 008, 009, 010, 012, 027, 032), which manufactures a cluster dissent every time. Survives only with the free test in 4.9.3. |
| **"Artifact with no provenance at all"** | n/a | That is the definition of a platform record. It is a scope-filter input, not a question signal, and emitting it produces a queue of ServiceNow's own defaults, which is the exact failure 4.9.2 exists to prevent. |

**What this predicts, now measured rather than estimated.** Backtested against the pilot customer's 15 recorded interview questions, this engine reproduces **5 with the repo corpus present and 2 without it**. Revision 3's estimate of 2 was right for the instance-only case and wrong for the corpus case. Nine of the ten misses have no instance referent at all. Full per-question breakdown in 4.9.0.

### 3.4 The consequence

**Drift has a signal. Coverage does not. Questions have three mechanical signals and nobody had built any of them.** Therefore:

- **INTERVIEW is the product loop.** Its input is QG1 through QG5, its output is the decision ledger, its terminal states include `unanswerable` because the human oracle fails about one time in five, and its saturation rule is a ledger delta counted by the CLI.
- **MAP does not loop.** It is a bounded, budgeted, resumable one-shot fan-out whose *purpose* is to feed QG1 through QG3. Its stopping rule is a budget, not a convergence criterion, and it is honest about that.
- **VERIFY loops.** Its corpus is the claim ledger, its signal is S1 plus S2 plus S3 plus S4, its convergence is "no claim is stale and no claim is contradicted", and that condition is genuinely reachable because the ledger is finite and enumerable. Its **unique contribution to the product** is that a drifted claim automatically flags every decision linked to it for re-confirmation (4.10). That is the closure `decisions.md` currently asks humans to perform by hand, and no document template can ever do it.

**The dependency that "INTERVIEW first, MAP second, VERIFY third" hides, and it must be said out loud before anyone reads section 10 as a build order.** QG1 is the only gate that emits a question, and QG1 fires on a **contradiction or a delta**. Contradictions are produced by **S4 / L2 cross-source**, which lives inside VERIFY (4.4). Deltas are produced by **G4 watermarks and the R-a provenance rung**, which live inside the read adapter. So MAP on its own emits nothing: **the question engine consumes VERIFY's output, which makes VERIFY a prerequisite of the product leg and not merely its protector.** The three-loop ordering in 4.1 is an ordering of *importance*, and section 10's ordering is an ordering of *construction*, and they are deliberately different. The construction order that follows is: the L2 cross-source checker and the claim ledger, then the question engine on top of them, then MAP as the thing that fills the ledger at scale. That is what phases 2 and 3 do, and 4.4's diagram draws that dependency correctly even though 4.1's prose reads as if MAP feeds questions directly.

---

## 4. TARGET ARCHITECTURE

### 4.1 The three loops, in order of importance

Ordered by C3: INTERVIEW first because it produces the product, MAP second because it feeds INTERVIEW, VERIFY third because it protects both. Read the columns left to right and the dependency arrows run right to left.

| Leg | **INTERVIEW (the product)** | MAP (the question generator) | VERIFY (the protector) |
|---|---|---|---|
| **Produces** | **The decision ledger** (4.10): what was decided, why, alternatives rejected, by whom, when, superseded by what. This is the deliverable. | The claim ledger (4.2) plus DRAFT pages plus a **ranked question queue** (4.9). The claim ledger is a mechanism, not a deliverable. | Verdicts, and the one thing no template can do: **supersession flags** when a claim underneath a decision drifts. |
| **Trigger** | `snbrain interview --next 10`. Driven by the question queue, which QG1-QG3 rank mechanically. | Manual, once per engagement: `snbrain map --config product.config.json`. No cron. | `snbrain verify --stale-after 14d`. Mandatory after every MAP run and before every deliverable. |
| **Goal** | Every `blocking` question is answered, `unanswerable`, or deferred with an owner, **and every answer that carries a rationale becomes a DEC record linked to the claims it explains.** | A question queue whose top N are worth an expert's time, within a declared budget, with every gap named. | Every claim is `verified` with a timestamp, `drifted` with a diff, `gone`, or `unverifiable` with a reason. Zero contradictions. Zero broken references. |
| **Verification** | L5 human, recorded with attribution and date. **Plus L3 pre-check:** the derivability oracle (AW-5, 4.9.6) auto-kills any question our own ledger can already answer, before a human sees it. | L0 query validity, L1 preflight canary, the scope filter's four-part discrimination gate (4.9.2), L3 artifact manifest diff. | L0 to L1 to L2 to L3 ladder, section 4.3. |
| **Stopping rule** | Saturation: over the last 5 answered questions, fewer than 2 produced a **ledger delta** (a new claim id, a `draft` claim promoted, or a new DEC record). Counted by the CLI, not judged by a model. Or the queue is empty. Or the **question cap** (default 10 per run, 4.9) is spent. | Budget: query count, wall clock, page count, token spend. Terminal state per phase. Never "the model thinks it is done". | Convergence: zero open blocking findings **and** zero claims past their staleness horizon. Stagnation: two consecutive iterations with **zero resolutions**, where a resolution is a claim whose `status` moved out of `drifted`/`unverified`/`draft`, counted by the CLI from the ledger. Finding-id set equality is explicitly NOT the trigger (4.6 explains why). Cap per 4.6. |
| **Memory** | `.brain/decisions.jsonl` plus `INTERVIEW.md` plus answered-question records linked by claim id. | `.brain/state/<run-id>.json` plus `.brain/claims.jsonl` plus `.brain/questions.jsonl` plus per-phase `.brain/raw/<phase>.ndjson`. | Same claim ledger, with a verification history per claim, plus `.brain/findings/<iteration>.json`. |
| **Honest note** | **The rationale-bearing answers cluster in the half this engine cannot generate.** At the pilot customer, the four questions that produced real reasoning (Q1, Q8, Q9, Q11) were all repo governance. Of the six instance-derived questions, **zero produced a rationale from the human**; the closest case, TBD-038, was later narrowed by archaeology to intent plus attribution, with its causal sentence still hedged (4.10, phase 0.1). Do not oversell this leg; build it, measure it, and let the backtest set the expectation. | Yield, **measured in revision 4, not estimated: 5 of the pilot customer's 15 with the repo corpus, 2 of 15 without it** (4.9.0). Nine of the ten misses have no instance referent at all, which is a permanent boundary. | The only leg with measured field evidence: 26 claims, 22 confirmed, 3 drifted, 1 gone, 15% drift over six weeks (`audit-phase0-findings.md:15,208`). |

### 4.2 The claim ledger: the single most important new artifact

Everything else follows from this. One line per atomic claim, append-only, machine-readable.

```jsonc
// .brain/claims.jsonl
{
  "id": "C-0042",                       // content-hashed, allocated by the CLI, never by the model
  "scope": "x_acme_fm",
  "locus": { "table": "sys_script", "sysId": "9ec847db...", "field": "active" },
  "assertion": "active = true",
  "renderedIn": ["processes/case-lifecycle.md#guards", "registry-sys-ids.md"],
  "evidence": {
    "query": "sys_idIN9ec847db...",     // replayable, field-validated
    "fields": "active,name,sys_updated_on",
    "capturedAt": "2026-08-06T09:12:44Z",
    "capturedResponse": { "active": "true", "name": "...", "sys_updated_on": "..." }
  },
  "rung": "L1",
  "status": "verified",                 // draft | verified | drifted | gone | unverifiable
  "verifiedAt": "2026-08-06T09:12:44Z",
  "staleAfter": "2026-08-20",
  "interviewRefs": []                   // question ids that must answer before de-DRAFT
}
```

Four properties matter. **The CLI allocates the id** (content hash of locus plus assertion), which fixes the exact defect that killed the pilot customer's stagnation breaker: model-authored finding slugs never repeat, so `state.js:140-146` never fired once in 32 recorded iterations, while `gate.js` findings get content-hashed stable ids (`lib/checks.js:74-76,85`) and the test suite explicitly guards that property (`test/run-tests.js:311-322`). **The CLI captures the response**, so provenance is recorded rather than narrated: chain-of-thought is unfaithful roughly 25% of the time for Claude 3.7 Sonnet (https://www.anthropic.com/research/reasoning-models-dont-say-think), so a model-written evidence line is a post-hoc rationalization, not an audit trail. **Claims are individually addressable**, which matters because the bottleneck in self-correction is error *localization*, not correction (Tyen et al., ACL Findings 2024, https://arxiv.org/abs/2311.08516): never ask "review this page for errors", always say "claim C-0042 asserts X, the live query returned Y, reconcile". And **pages are rendered from claims**, so the wiki stops being the primary artifact and becomes a view.

### 4.3 The verification ladder, adapted for knowledge

the pilot customer's ladder (`LOOP.md:60-73`) is a trust ordering, not a ServiceNow concept, and it ports. But its L3 ("does the thing actually do the thing", browser) is a *build* rung and has a hard documented ceiling here: the configurable workspace sits behind closed shadow roots, screenshots time out at 60s and 90s, and the agent API exposes no client-side JS evaluation (`_lab`-adjacent design notes in `.claude/loop/state/STRY0100012-design.md:415,865`). Do not build the top rung on browser observation.

| Rung | Kind | For knowledge claims | Trust | Closes a loop? |
|---|---|---|---|---|
| **L0** | Query validity | Every field in an encoded query validated against `sys_dictionary`, or an A/B negation control issued. Canary read per batch. | Precondition | No. Makes everything above it meaningful. |
| **L1** | Deterministic re-query | CLI replays the claim's evidence query and diffs values. Also: referential integrity of the brain, frontmatter conformance, slug canonicality. | Absolute | **Yes** |
| **L2** | Cross-source contradiction | Two independent derivations disagree; registry contradicts a process page; duplicate slugs for one target table. | Absolute | **Yes** |
| **L3** | Round-trip re-derivation | Fresh agent gets the claim text only, derives its own query, result diffed against the recorded response. Or: gets the page, emits the artifact definition, structurally diffed. | High | **Yes**, for WHAT-claims |
| **L4** | Model judge | An assessor reading pages against CONTRACT as a rubric. | **Low, never closes a loop alone** | No |
| **L5** | Human | Interview answer, de-DRAFT approval, deliverable sign-off. | Final | **Yes**, and it is the only rung that can close a WHY-claim |

**Hard constraints, both carried from the pilot customer and both mechanized this time.** An L4 finding may not be dismissed by L4 (`LOOP.md:71`). And critically, the mechanism the pilot customer lacked: severity is not a free-text field any stage can rewrite. At the pilot customer, six findings were re-emitted in iteration 2 with severity downgraded blocking to info and the acceptance text pasted inline into the `message` field, taking the blocking count 2 to 0 (`state/STRY0186518.json`), because `state.js:100-110` closes on `findings.filter(f => f.severity === 'blocking')`. In the product, a finding carries `severity`, `disposition`, `dispositionBy` and `dispositionRung` as separate fields, and the closure predicate is **no finding with `severity=blocking` AND `disposition=open`**.

Also carried, and this is the one thing the reference engagement got right and its own tooling could not express: **`unverifiable` is a first-class status with three sub-reasons** (`blocked-by-access`, `no-oracle`, `requires-write`). the pilot customer's audit recorded UNVERIFIED as a real outcome (`audit-phase0-findings.md:15,217-222`) but `state.js`'s `tests[]` array is two-valued and the honest third value has nowhere to go. **Re-measured for revision 3, because revision 2's number was stale and its inference was too strong:** across the three state files there are now **74 recorded test cases, 73 `pass` and 1 `fail`**, so the `finish --terminal success` guard at `state.js:213-216` is live, not vacuous. The surviving and narrower defect is the one that matters: a test case explicitly titled **"T7 / AC7 - HSE adviseur review+close TRANSITIONS (NOT DEMONSTRATED)" is recorded `result: pass`**, because a binary schema forces an honest non-demonstration to be filed as a success. Three-valued outcomes, with `not-demonstrated` blocking `success` exactly as `fail` does.

### 4.4 Loop shape

```
                       product.config.json
                              │
                              ▼
                    ┌──── PREFLIGHT ────┐  L0: port/pid/apiVersion + gates + instance identity
                    │  fail ⇒ abort, 0 writes   + dictionary cache + domain check
                    ▼
              [ PROVENANCE PROBE ]  ── QG5 GO/NO-GO. How does this customer actually ship?
                    │                   update sets? sys_update_version? metadata authorship?
                    │                   NO authorship source ⇒ MAP emits INVENTORY ONLY
                    │                   and raises ZERO questions. Stamped, not silent.
                    ▼
   ══════════════ MAP  (ONE-SHOT, BUDGETED, RESUMABLE: NOT A LOOP) ══════════════
                    │              purpose: feed the question engine, not write a map
        ┌───────────┴───────────┐
        ▼                       ▼
   [ CENSUS ]              [ ARCHAEOLOGY ]     ── conditional on the provenance probe
        │                       │                 each writes .brain/raw/*.ndjson,
        └───────────┬───────────┘                 streamed by the CLI, not held in context
                    ▼
              [ HARVEST × N ]   ── N derived from census evidence, NOT a literal array
                    │              parallel reasoning, SERIALIZED I/O (6.7)
                    ▼
              [ MERGE ]         ── CLI-side: dedupe, allocate slugs centrally, detect collisions
                    │
                    ▼
              [ RENDER ]        ── claims.jsonl ⇒ DRAFT pages (a VIEW, not the deliverable)
                    │
        terminal: success | partial | blocked | budget-exhausted | inventory-only
                    │
   ══════════════ VERIFY  (THIS IS A LOOP; bounded by budget, 4.6) ══════════════
                    │
                    ▼
   ┌────────▶ [ SELECT ] stale ∪ unverified ∪ contradicted claims
   │                │
   │                ▼
   │          [ L0 VALIDATE ] ── dictionary check + canary; canary empty ⇒ terminal `blocked`
   │                │             (NEVER `absent`: the platform's signature failure)
   │                ▼
   │          [ L1 REPLAY ]   ── CLI issues query, diffs values, writes verdict
   │                │
   │                ▼
   │          [ L2 CROSS ]    ── contradictions, duplicate slugs, referential integrity
   │                │
   │                ▼
   │          [ L3 ROUND-TRIP ] (sampled, budgeted)
   │                │
   │                ▼
   │          [ FINDINGS ] ── content-hashed ids, severity + disposition separate
   │                │
   │                ├──────────▶ [ SUPERSESSION FLAG ] ── any DEC linked to a DRIFTED claim
   │                │                                     is auto-flagged for re-confirmation.
   │                │                                     THE thing no template can do (4.10).
   │        blocking > 0 ?
   │           yes │  no ──────────────▶ converged
   │                ▼
   │          [ REPAIR ]  ── maker fixes the CLAIM, never the finding
   │                │        checker never sees the maker's reasoning
   └────────────────┘
                    │
      stagnation: 2 consecutive iterations, zero resolutions ⇒ `stalled`
      spend ceiling, or runaway guard of 12 iterations, with blocking open ⇒ `exhausted`
                    │
   ═════════ QUESTION ENGINE (4.9) ── THE GATE THAT PROTECTS THE SME ═════════
                    │
       [ QG1 CONTRADICTION-GATE ]  a lone anomaly is DROPPED. contradiction or delta only.
                    ▼
       [ QG2 CLUSTER ]             group by (table, change-type, author, time-window).
                    │              one question per cluster, member count attached.
                    ▼
       [ QG3 WPM RANK ]            E·C·A·U / M. mechanical ordering, no model. (4.9.5)
                    ▼
       [ ADMISSION FLOOR ]         C_signal < 0.60 ⇒ SHADOW queue, operator-only, never sent.
                    ▼
       [ L3 DERIVABILITY ORACLE ]  AW-5. isolated agent, ledger-only, POST-RANK, top N only.
                    │              succeeds under the id-match rule ⇒ AUTO-KILLED as derivable.
                    ▼
       [ QG4 CAP ]                 model picks top N (default 10; 5 for the PoC, 11.3)
                    │              and writes the wording. bounded model judgement.
                    ▼
        candidates-after-gates / questions-asked recorded as a run metric (11.4)
                    │
   ══════ GATE: human reviews the evidence pack, not the transcript ══════
                    │
   ══════════════ INTERVIEW  (THE PRODUCT LOOP) ══════════════
                    │
              [ ASK ] ranked, batched, capped
                    │
              answered │ unanswerable │ deferred
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   [ DEC RECORD ]          [ TBD RECORD ]  ── the honest majority outcome (phase 0.1)
   rationale present       "dunno" / debt / owner+date
        │                       │
        └───────────┬───────────┘
                    ▼
              [ DE-DRAFT ] ── validator refuses promotion without a linked answer
                    │
              saturation: last 5 questions < 2 ledger deltas ⇒ done
                    │
                    ▼
              [ PROBE BASELINE ] ── mechanically graded, exit code, recorded
```

### 4.5 State and resume

Two files, and the split is deliberate. the pilot customer's single state file reached 354 KB (roughly 89k tokens) for `STRY0186470.json` because `state.js:125-133` writes the full findings array into every iteration entry, which means the "durable spine that survives context compaction" (`LOOP.md:127-129`) cannot actually be re-read into context. The projection is the real interface, and the pilot customer's projection is broken: `node .claude/loop/state.js show --story STRY0186470` prints `loop A: 4/3 iterations`, an internally impossible figure, because `state.js:240-246` iterates only `loop.iterations` and is blind to the six `priorIterations`. Sixteen real iterations, seven shown.

So: `.brain/state/<run-id>.json` holds counts, blocking id sets, per-phase terminal states, budgets consumed, and **pointers**; findings live in `.brain/findings/<iteration>.json`; claims live in `.brain/claims.jsonl`. And `snbrain resume` prints a token-budgeted projection that is correct by construction, tested by a fixture that asserts archived iterations are counted.

First-class CLI verbs for the three things that actually happen and that the pilot customer had to hand-edit JSON to record: `snbrain override --cap`, `snbrain accept --claim <id> --by <name> --rationale <text>`, `snbrain reset --phase <p> --authorised-by <name>`. the pilot customer invented three different undocumented schemas for these across three runs (`loopAResets[]`/`loopBResets[]`/`priorIterations[]` in one file, `riskAcceptances[]`/`resets[]`/`archivedIterations[]` in another, `overrides[]` in the third), none of which appears anywhere in `state.js`. A memory format that agents must hand-edit to record reality is not memory, it is a suggestion.

### 4.6 Stopping rules with actual numbers

- **MAP budget:** query count (default 2,000), wall clock (default 45 min), page count (default 60), spend ceiling (default USD 50 per MAP run, and the CLI must actually be able to compute spend: with the `next`/`ingest` protocol the CLI does not see token usage, so either the shim reports usage back on `ingest` or this ceiling is a *declared* budget the operator reconciles manually, and the plan must say which. Decision: shim reports usage on `ingest`, and a stage that reports none is recorded `spend-unknown`, which blocks terminal `success` the same way `not-demonstrated` does). All enforced by the CLI as preconditions the model cannot argue past. the pilot customer's `MAX_STORY_PAGES` and `RECENT_MONTHS` reach the model only as interpolated prose at `bootstrap-project-brain.js:108-109`, which is the anti-pattern the pilot customer's own spec names "Pretending L4 is L1" (`LOOP.md:178`).
- **VERIFY cap: 6, not 3.** the pilot customer's cap of 3 (`state.js:29`, `CAPS = { A: 3, B: 3, C: 2 }`) was hit five times across three runs and terminated zero of them; real convergence took 10 to 11 design assessments (`state/STRY0186470.json` gate note: "Approved after 11 design assessments"). Two of the five trips were legitimate re-labels under a pre-existing rule the schema could not express (`.claude/skills/acme-loop/SKILL.md:117-118`), so the honest count is 3 genuine overrides. A cap overridden 100% of the time is a speed bump that generates schema drift.

  **Correction, because 6 contradicts the evidence just cited.** If real convergence took 10 to 11 assessments, a cap of 6 is overridden every time exactly as 3 was, and the plan reproduces the defect it is diagnosing. The cap is not the control. The controls are: (i) **convergence and stagnation are the primary terminators**, and a cap only exists to bound spend; (ii) the cap is therefore expressed as a **budget**, not an iteration count, defaulting to the MAP spend ceiling for a VERIFY run; (iii) an **iteration ceiling of 12** exists solely as a runaway guard, which is above the highest observed real convergence so hitting it is genuinely abnormal; (iv) `override` is a first-class recorded verb with `--by` attribution, so the overrides that will happen are data rather than schema drift. Do not ship a number chosen to be "more than 3".
- **Convergence, not just a cap.** Encode the rule the pilot customer's own override rationale states: blocking counts falling with no repeated ids means converging, not stalled. Terminate `stalled` when two consecutive iterations produce no *resolutions* (a claim moving out of `drifted`/`unverified`), regardless of whether the finding ids match. Set equality on model-chosen strings is dead code.
- **Staleness horizon: 14 days by default.** Justified by measurement, not vibes: the pilot customer drifted 15% over roughly six weeks (`audit-phase0-findings.md:15`) and `OHSStateTransitionUtil` was modified *on the audit day* (`:119`). Make it configurable per claim class.

### 4.7 The DRAFT to VERIFIED promotion ritual, made machine-checkable

Today the banner is authored by prompt, removed by prompt, checked by nothing, sits astride CONTRACT rather than inside it, and its removal procedure is *generated at runtime* by the synthesis agent (`bootstrap-project-brain.js:161-162`). **Correction, revision 3:** an earlier draft said CONTRACT "does not permit a `status:` key for any tier". That is wrong and a domain expert would have caught it. `CONTRACT.md:54` requires `status` on the **Story** tier; what CONTRACT does not define is `status` on process, reference or registry pages, which is exactly the tier the DRAFT banner lands on. The narrower true statement: **`status` is a contract key on one tier and an undeclared free-text banner on every other tier, with no defined value set anywhere.** Replace with:

1. `status` is a required frontmatter key on every page, with values `draft | mixed | verified`, computed by the renderer from the claims the page renders. Not written by hand.
2. A claim leaves `draft` only when it has either an L1 verification with a captured response, or a linked answered interview question with an attributed answerer and date.
3. The validator **refuses** to render a page as `verified` if any claim it renders is still `draft`. Exit non-zero.
4. The kernel routing map states that a `draft` page must be quoted with its status; downstream agents currently read these pages with zero DRAFT awareness (`kernel/CLAUDE.template.md:82-96`).

### 4.8 Where humans sit

Two gates and one queue, and they are not decoration. Autonomy stays at the pilot customer's L2 ("assisted, human-gated", `LOOP.md:164-169`) with one asymmetry worth stating: the contextualization loop is **read-only against the instance**, so the blast radius that justifies gates in the build loop does not exist here. The gates that remain exist for a different reason: the machine cannot produce WHY, and the best frontier models reach F1 around 0.68 on *synthetic, fully-known* codebases when asked to externalize an architectural belief state (Theory of Code Space, arXiv 2603.00601v4). Gate 1 approves the MAP budget and scope list before any queries run. Gate 2 approves de-DRAFT promotion. The interview queue runs continuously and needs `unanswerable` as a real outcome.

### 4.9 THE QUESTION ENGINE. Rewritten from design in revision 4, then corrected by the backtest.

`tools/snbrain/questions.js`. Everything below is CLI-side and deterministic except one capped stage, named and bounded in 4.9.6. Revision 2's 4.9 was a schema and six rules written from a briefing; this is the engine.

Reading order is deliberate. **4.9.0 is the measured recall and it comes first**, because it is the most honest evidence in this document and a reader should hit it before the machinery. Then the gate corrections (4.9.1), then the scope filter (4.9.2) because it gates every signal, then the catalogue (4.9.3), the deletions (4.9.4), the ranker (4.9.5), the anti-waste gates (4.9.6), the schema and CLI (4.9.7), and what MAP stops doing (4.9.8).

#### 4.9.0 What this engine actually recalls, measured. And the boundary it will never cross.

**Method.** Simulated over the pilot customer's own record: 15 recorded interview questions (`_lab/INTERVIEW.md`), 33 decisions (`wiki/decisions.md`), 44 TBD entries (`wiki/tbd.md`), the phase-0 audit (`_lab/audit-phase0-findings.md`) and the registry (`wiki/registry-sys-ids.md`). No code was run: this is a hand simulation of each signal's predicate against artifacts on disk, and that limitation is recorded as U20.

**Recall: 5 of 15 (33%) with the the pilot customer repo corpus present. 2 of 15 (13%) instance-only, which is the devinst01 condition.**

| Hit | Signal | Needs a repo corpus? |
|---|---|---|
| **Q7** STRY0185005: live SLA deprecated with zero repo trace | QS-08 | **yes** |
| **Q10** three active BRs whose `ohs_task.category=mbo` filter matches zero rows | QS-05a | no |
| **Q13** prefill client script inactive inside an otherwise-live cluster | QS-02 | no |
| **Q14a and Q14b** SLA `abb58442` deactivated, audience `ddcf8096` renamed (counted as one) | QS-08 | **yes** |
| **Q15** six NL notification gates re-saved 2026-06-18 | QS-11 | needs `sys_update_version`, and a run inside the window |

**Q15's hit is one configuration knob from a miss.** The change was 2026-06-18, the audit ran 2026-07-24: 36 days against a `recentDays` default of 45. A run at day 50 misses it entirely, and the change is permanent while the window is not. Fixed in 4.9.3 by making QS-11's window run-relative (cluster against G4's prior-run watermark, fall back to `recentDays` only on a first run), so the signal's recall stops depending on scheduling.

**Misses: Q1, Q2, Q3, Q4, Q5, Q6, Q8, Q9, Q11, Q12. And what they have in common is the most important sentence in this section.**

**Nine of the ten misses have no instance referent at all.** Q1 who reads the docs, Q2 which tools consume `agentinstructions.md`, Q4 is the STS PoC alive or parked, Q5 what is `nssbx/` for, Q6 the Dutch versus English documentation policy, Q8 PII in git, Q9 two parallel scope-folder generations, Q11 binary weight in git, Q12 the scratch-layer policy. They are about the knowledge artifact, the tooling and the working practice. The tenth, Q3 (which stories are live on test, acc and prod), is instance-shaped but needs cross-instance truth the transport cannot reach and which 9.3 already declares out of scope.

> **This is a permanent structural boundary, not a coverage gap.** The engine reads a ServiceNow instance. A competent architect on a real engagement spends roughly two thirds of his questions on the repository, the documentation and the working practice. No additional signal closes that, because those questions are not about the instance. 9.4 already concedes that the four the pilot customer questions producing real reasoning (Q1, Q8, Q9, Q11) are all in this class; what this plan did not say, and now does, is that **the class is unreachable by design and must come from a separate repo-audit lane or from the human.**

**Independent corroboration, against a register the engine never saw.** Of the pilot customer's 28 open TBD items, roughly **7 are engine-reachable**: TBD-005 (QS-07c), TBD-029 (an orphaned `sys_ui_element`, QS-06 shaped), TBD-031 (QS-06d), TBD-034 (the negative-condition family), TBD-039 and TBD-043 (QS-04), TBD-040 (QS-05a), TBD-042 (QS-11). That is about **25%**, the same order as the interview number, and it is the better metric because it does not depend on who happened to be conducting the interview.

**The finding that hurts most, and it belongs in the customer conversation, not the appendix.** Of the roughly 12 best questions the engine would produce on the pilot customer, **six are already in the customer's own TBD register** (TBD-005, 031, 039, 040, 042, 043). AW-3's already-governed arm is exactly right to kill them, which means **on a mature engagement the structural signals largely rediscover what the customer already wrote down.** The one genuinely novel finding was Q7 / STRY0185005 and it came from QS-08, the only signal that needs a doc corpus. Consequence for the PoC, stated in 11.1: devinst01 has no repo, so the PoC removes the only signal that produced a novel finding and keeps the ones that mostly reproduced an existing register.

**One internal contradiction this exposes and which the operator must resolve.** 9.1 lists `deployment-matrix.md` among the two most derivable pages, while 9.3 declares cross-instance truth unproducible and Q3 is a recall miss for exactly that reason. One of those two statements has to give. Recommendation: 9.1's claim narrows to "derivable from *promotion records on one instance*", which is what the matrix actually holds.

#### 4.9.1 Three corrections to revision 2's gate design, all load-bearing

**C-a. QG1 admits three gates, not two.** `contradiction` (a live value versus another live value or a corpus statement), `delta` (a live value versus a prior value from `sys_update_version`, `sys_audit` or a prior-run watermark), and `register-gap` (a token or artifact observed in the instance versus its absence from a register **the product owns and that is complete by construction**). The guard rail on the third is the phrase "complete by construction": `glossary.md` is closed by contract (`CONTRACT.md` registry tier, plus the pilot customer's own usage rule "New term, add here in the same commit that first documents it") and `decisions.jsonl` is closed by contract (append-only, never renumbered). A process page is **not** closed, so "this artifact has no process page" is refused. The admissible register list is a config value, not a judgement, and adding one is a decision record. Rationale in 3.3/QG1.

**C-b. QG5's go/no-go moves to the scope filter.** Rationale in 3.3/QG5. The consequence for section 11 is that thin update-set provenance on devinst01 no longer threatens the run's existence, only its provenance-dependent quarter, and U18 narrows from "enough customer-authored surface to measure anything" to "enough *discriminable* surface".

**C-c, from the backtest, and it cuts the other way. C-b is right for customer engagements and wrong for the one instance the PoC runs on.** On a single-owner vendor dev instance, membership in a named completed non-default update set is the **only** available proxy for deliberateness, and 11.1 predicts it will be thin. Either update sets exist on devinst01, in which case 11.1's thin-provenance prediction was wrong, or they do not, in which case Band A is scratch-dominated and the nine current-state signals fire at full strength against half-built experiments. Section 11 therefore reinstates it locally and adds the terminal state `authored-but-undeliberate` (4.9.2).

#### 4.9.2 The scope filter, which is the actual go/no-go

**The failure it prevents.** On any ServiceNow instance the overwhelming majority of `sys_script`, `sys_ui_policy` and `sys_security_acl` rows were shipped by ServiceNow. A generator without this filter preferentially asks about defaults: maximally derivable, maximally worthless, and the SME has no decision history about them. That is worse than a false anomaly, because it teaches nothing and it is not even wrong.

**The trap that kills the naive design, with the pilot customer evidence.** The obvious filter is `sys_scope`, and at the pilot customer it fails in **both** directions. `sn_ohs_im` is a ServiceNow-shipped H&S application and the customer built inside it: DEC-007 places business rules in that scope deliberately (`wiki/decisions.md:29-30`), DEC-020 creates the custom table `sn_ohs_im_investigation` inside it (`:68-69`), and a dozen customer-authored `sys_script` rows sit there (`wiki/registry-sys-ids.md:67-80`). Meanwhile `global` holds both the base system and real customer work. **Scope is neither necessary nor sufficient. Authorship is decided per record.**

**Inputs.** All on `sys_metadata` or one join away, so most cost nothing beyond widening `sysparm_fields`.

| # | Source | What it proves | Clone-resilient |
|---|---|---|---|
| I1 | `sys_package` census (`sysparm_fields=sys_id,source,name,version,active,trackable,sys_class_name,sys_created_by,sys_created_on`, limit 1000) | which scopes are `sys_app` (custom), `sys_store_app` (vendor) or base | yes |
| I2 | install floor: `sys_upgrade_history` top 5 by `sys_created_on`, plus `min(sys_created_on)` over `sys_app` | the date below which everything is install | partly (clone resets) |
| I3 | author distribution: `/api/now/stats/sys_metadata?sysparm_count=true&sysparm_group_by=sys_created_by` (U12-dependent; fallback is a paged `sys_created_by` sweep with a client-side tally) | which accounts are install-shaped versus human | yes |
| I4 | `sys_customer_update` column | **the platform's own answer to "did a customer touch this"** | **yes** [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, so I4 is I6 restated and the "yes" is wrong: a clone truncates `sys_update_xml`.] |
| I5 | `sys_mod_count` column | was a vendor-shipped record edited | yes |
| I6 | `sys_update_xml` membership sweep, filtered `update_set.applicationIN<scopes>^ORupdate_set.is_default=true` and `sys_created_on>=<installFloor>` | shipped through the customer's own discipline | **no** |
| I7 | `sys_update_version` on demand per candidate | save history and prior values | often no |
| I8 | human-account test: one `sys_user` query with `user_nameIN<authors>` | is an author string a person | yes |

**The join key is `sys_update_name` and it is load-bearing.** Format is `<table>_<sys_id>` for the common classes, but composite-key classes differ: `sys_dictionary_<table>_<element>`, `sys_choice_<table>_<element>_<value>`, `sys_documentation_<table>_<element>_<language>`. An implementation that assumes the simple form silently loses dictionary, choice and label provenance, which is exactly the material QS-10a depends on. Build the key per class and unit-test the three composite forms.

**The classifier. Three bands, hard predicates, no scoring fudge.**

> **SUPERSEDED 2026-08-05 by the two-axis classifier below.** The A1-A4 disjunction is kept
> because the reasoning about each predicate is still sound, but as a *gate* it failed live
> on devinst01: all four admitted zero on an instance where 188,949 records carry
> `sys_mod_count > 0`. Two defects, and the second is the serious one. **(i)** A3 named
> `sys_customer_update`, which does not exist — it is the *label* of `sys_update_xml`, so A3
> was A2 restated at record level rather than a fourth independent predicate. **(ii)** Every
> one of A1-A4 terminates in "human author", and that was implemented as a hardcoded list of
> expected user names, which silently sets the run's recall to whatever the list happens to
> contain. On a developer instance the developer works as `admin`; on a customer instance
> the integration account may be the busiest author. **A name list cannot decide this and
> must never be the thing that does.**

**The two-axis classifier, which supersedes A1-A4 as the gate.**

- **Axis 1, CHANGE** — the only axis carrying signal. `sys_mod_count > 0`, OR more than one
  `sys_update_version` row (or one after the install floor), OR an entry in `sys_update_xml`
  joined `sys_metadata.sys_update_name` = `sys_update_xml.name`, OR `sys_updated_on >
  sys_created_on`, OR `sys_updated_by != sys_created_by`.
- **Axis 2, ACTOR** — decided by **rule**, never by a name list: does a `sys_user` row exist;
  is `last_login_time` non-empty (the strongest signal); is the email domain not
  `example.com`; was the account created at or after the install floor or has it logged in
  since; is it active. The deciding signal is recorded per account, from a closed vocabulary
  that does not include "name list".
- **PACKAGE IS A CLASSIFIER, NEVER A GATE.** A package says where a record *lives*, not who
  last *touched* it. Modifying an OOTB business rule leaves it in `com.snc.incident` forever,
  and on a real customer implementation modified-OOTB is the **main event**. Any predicate
  binning "vendor package" as "not customer" reports a fully customised ITSM implementation
  as having zero customer surface. Package separates Band A from Band B and names the owning
  app in a report. It never decides Band C.
- **Recall exposure is now a required output**, because it is the only recall-shaped number
  the stage can produce about itself and it is two aggregates: the changed population, and
  how many of it the actor test discarded. Reported even when zero. On the reference run it
  would have read 188,949 changed, 188,948 discarded — a two-record ledger built by throwing
  everything away, with nothing in the output saying so.

- **Band A, AUTHORED** (askable for existence and for change). **Changed ∧ human actor**,
  wherever it lives; a post-floor creation by a human actor qualifies on creation alone.
  Historical predicates, retained as reasoning: **A1** the package resolves to an `sys_app`
  created after the install floor by a non-install account; **A2** membership in a
  **completed, named, non-default** update set with a human `sys_created_by`; ~~**A3**
  `sys_customer_update = true`~~ *(retired: the field does not exist; it was A2 at record
  level)*; **A4** a `sys_update_version` row with `state=current`, recorded after the install
  floor, human author.
- **Band B, TOUCHED** (askable for change only). Changed ∧ human actor, but the record
  *arrived* in a vendor package — i.e. **an OOTB record the customer modified**. At the pilot customer this
  holds DEC-024's four modified OOTB ACLs (`78fe8077`, `4cafc0b7`, `329d1fd1`, `8e7fdb65`),
  which is precisely a change-question and not an existence-question — and which the
  package-as-gate reading would have discarded outright.
- **Band C, PLATFORM** (never askable). Everything else. Emitted to inventory, counted in the 9.6 denominator, never seen by the ranker.

**The discrimination gate. Presence is not the test.** An authorship column returning `admin` for 95% of rows has passed a presence test and failed the only test that matters (11.1's base-data confound). The run refuses to raise questions unless **all four** hold:

1. `|A| > 0`.
2. **`|A| / |A ∪ B ∪ C| <= 0.35`** (`questions.authorshipMaxShare`). On every brownfield instance observed, the customer-authored share of `sys_metadata` is a small minority; a filter admitting more than a third is not a filter. Violation is a *finding*, stamped, not a silent pass.
3. **Author discrimination.** The top Band A author must not also be the top Band C author with a share above 0.80 in both. If it is, authorship is an artefact of the install account and the run stamps `authorship: 'time-only'`, which disables author-keyed clustering and leaves the nine current-state signals untouched.
4. **Deliberateness (NEW, from the backtest, and it is thirty seconds of transport).** `GET /api/now/stats/sys_update_xml?sysparm_count=true&sysparm_group_by=update_set.is_default`, restricted to the install floor. If the Default-set share of authored change exceeds `questions.defaultSetMaxShare` (default 0.50), the run stamps **`authored-but-undeliberate`**.

**Three terminal states, and the third is new.** Failure of (1) is `inventory-only`. Failure of (2) or (3) is **`filter-non-discriminating`**: we could not separate your work from ServiceNow's, here are the numbers. Failure of (4) is **`authored-but-undeliberate`**: we can see what you built, we cannot see what you decided. All three are stamped in `.brain/state/<run-id>.json` with the measured shares.

**Why gate 4 exists, and it is the backtest's sharpest catch.** Gates 1 to 3 all pass cleanly on devinst01 and the filter reports success. But Band A on a vendor's personal dev instance is dominated by **product-development scratch**: half-built experiments, throwaway tests, demo records. That material is genuinely customer-authored, satisfies A1/A3/A4 cleanly, and is worthless to ask about because there was never a decision, only tinkering. **The bands separate customer-authored from ServiceNow-shipped. Nothing in them separates deliberate from scratch, and Band A membership is not evidence that a decision was taken.** Without gate 4, the run produces a confident queue of questions about half-built experiments and no state says so.

**Cost, and the one item that is a budget risk.**

| Item | Calls |
|---|---|
| I1, I2, I8 | 4 to 5, once per instance, disk-cached |
| I3 | 1 (stats) or about 40 (paged fallback) |
| I4, I5 | 0, columns already read |
| **I6 `sys_update_xml` sweep** | **`ceil(rows / 100)`, plausibly 100 to 2,000** |
| I7 | 1 per candidate, on demand, `widePageSize: 25` |

**I6 needs a pre-check, not an optimism.** Before sweeping, issue one `/api/now/stats/sys_update_xml?sysparm_count=true` with the scoped and dated filter. Above `read.updateXmlSweepMax` (default 25,000 rows, which is 250 pages at `pageSize` 100, about 12% of the 2,000-call MAP budget), **do not sweep**: drop to A1/A3/A4, stamp `authorship: 'metadata-only'`, and record which signals lost strength. Designed degradation with a number.

**How it fails, stated so nobody is surprised.**

| # | Failure | What survives |
|---|---|---|
| F1 | vendor scope holds customer work (the pilot customer `sn_ohs_im`) | A2/A3/A4 are record-level and carry it |
| F2 | customer scope holds vendor work (store app, demo data) | the 0.35 gate catches the gross case; the fine case leaks |
| F3 | **clone** truncates `sys_update_set` / `sys_update_xml` and commonly excludes `sys_update_version` | **A1 and A3 survive.** This is why `sys_customer_update` is in the ladder, and why 6.6's R-a to R-d is one rung short [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, so F3 truncates it too: **A1 alone survives**, and R-a to R-d was not one rung short.] |
| F4 | CI/CD or source-control-linked deploys, service-account author | A1 carries it; stamp `authorship: 'package-level-only'`, which downgrades `A` to 0.8 in the ranker |
| F5 | admin monoculture | time clustering survives; stamp `authorship: 'time-only'` |
| F6 | base and demo data pass the filter (11.1) | the 0.35 gate plus the non-base package requirement on A3/A4 |
| F7 | domain separation | already terminal `blocked` at preflight (6.5) |
| F8 | `sys_customer_update` semantics differ by release or class | **probe it**: new WP-A item 11 [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, and the real F8 is the composite `sys_update_name` key shapes of 4.9.2, not release-varying flag semantics.] |
| **F9** | **the author's own published app resolves to `sys_store_app` and bins as Band C by I1** | **nothing. On devinst01 this is the likelier direction of F2 and it discards his most decision-rich artifacts.** Detection: `sys_store_app` rows whose publisher matches a human account in the I3 distribution, one comparison over data probe 9 already collects |

**New WP-A probe item 11, twenty minutes, kill criterion written first, and it decides whether A3 exists at all.** Read 50 rows of `sys_metadata` from a known base package and 50 from a known customer scope with `sysparm_fields=sys_update_name,sys_customer_update,sys_mod_count,sys_package,sys_created_by`. If `sys_customer_update` is true across both populations indiscriminately, **A3 is dead** and the clone-resilient path is A1 only. [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, the probe reads it as such (WP-A item 11), and A1 is the clone-resilient path regardless of how the probe lands.]

**Explicitly rejected: delta from a pristine baseline.** No reference instance is obtainable through this transport and ServiceNow exposes no baseline-payload API. The **degraded proxy is real and cheap**: for edited records, the earliest `sys_update_version` with `state='previous'` and an install `source` carries the shipped payload. One read per candidate, and it is what makes Band B's change-questions answerable.

#### 4.9.3 The signal catalogue that survived

Every entry is a **named two-source disagreement with a support count**. `pB` is the backtest-simulated precision on the signal *as originally written*. `pB'` is the prior on the **surviving predicate set**, derived by removing the deleted predicates from the backtest's own emission decomposition; **`pB'` is derived arithmetic, not a measurement, and it is recorded as U24.** `Prov` is whether the signal needs a prior-state source.

**Admission rule, and it is the backtest's most important structural change.** `C_signal` enters `V` linearly while `E` has a 64x range, so reach dominates believability and a weak signal with plausible reach outranks a real question. Therefore:

- **`admitted`** when `pB' >= 0.60`. Emitted, ranked, sent to the SME.
- **`shadow`** when `0.35 <= pB' < 0.60`, or when `pB'` is unmeasured. Emitted, ranked, written to the queue and shown to the **operator**, but **never sent to the SME**. Shadow questions are graded by the operator at zero SME cost and that grading is `calibrate`'s input, so a shadow signal earns admission with data rather than argument.
- **`refused`** below 0.35, or on the 4.9.4 kill list. Not emitted at all.
- The operator may promote a shadow signal with `snbrain questions admit --signal <id> --by <name> --reason <text>`, recorded, never silent.

| ID | Signal | Gate | Prov | pB | pB' | State at run 1 | the pilot customer example on record |
|---|---|---|---|---|---|---|---|
| **QS-05a** | filter references a field that cannot resolve on the target table | contradiction | no | 0.60 to 0.80 | **0.70** | **admitted** | **Q10 / TBD-040** |
| **QS-10a** | unexpanded domain acronym, absent from the glossary | register-gap | no | 1.00 (n=1) | **0.85** | **admitted** | accident report, wrong for 5 months |
| **QS-04** preds 1 to 3 | update-set anomaly: duplicate names, empty in-progress batch, non-terminal for its age | contradiction | yes | 0.20 | 0.50 | shadow | **TBD-039, TBD-043** |
| **QS-08q** | repo contradicts instance, **question arm only** (see the split below) | contradiction | no | 0.24 ungated | **unmeasured** | shadow | **F-05 / Q7 / STRY0185005** |
| **QS-07c** | customer table with no ACL while its siblings have them | contradiction | no | 0.40 | 0.40 | shadow | **TBD-005** |
| **QS-09b** preds 2 and 3 | unbalanced condition syntax; `messages` field missing a `getMessage` key | contradiction | no | 0.10 (pred 1 dominated) | 0.40 | shadow | DEC-025 |
| **QS-12** preds 1 to 5 | two artifacts governing the same trigger, by set operations | contradiction | no | 0.15 | 0.38 | shadow | DEC-027 dual-match |
| **QS-02** + discriminator | cluster-mate dissent, **only where the dissenting record was created by the same change episode that dissented it** | contradiction | yes | 0.08 | 0.35 | shadow | **Q13 / TBD-038** |
| **QS-06d** | notification listening to an event nobody fires | contradiction | no | 0.33 | 0.33 | shadow | **TBD-031** |
| **QS-06a/b, QS-07a** | structural orphans, no-op ACLs | contradiction | no | 0.17 | 0.17 | shadow | DEC-006, DEC-024 |
| **QS-11** | recently changed, outside the promotion discipline. **Full provenance only** | delta | yes | 0.17 | 0.17 | shadow | **Q15 / TBD-042** |

**Run 1 sends questions from two signals. That is the honest output of applying the backtest's own floor, and it is the reason the shadow queue exists**: it collects calibration data on the other nine at zero cost to the SME, and phase 0.1 can move QS-08q on its own before the PoC runs.

**QS-05a, the strongest signal and the one to build first.** Near-zero false positive, zero cost beyond a cached dictionary, independent of any doc corpus and of any provenance. For each active condition-bearing artifact, parse the encoded query with G1's parser (split on `^`, `^OR`, `^NQ`, strip `ORDERBY*`, skip `javascript:` right-hand sides) and resolve each left operand against the dictionary hierarchy of the artifact's own table: `sys_script.filter_condition`/`.condition` keyed on `collection`, `sys_ui_policy.conditions` on `table`, `contract_sla.start_condition`/`.stop_condition`/`.pause_condition` on `collection`, `sysevent_email_action.condition` on `collection`, `sys_ui_action.condition` on `table`, `sys_security_acl.condition` on the table half of `name`. Two failures, and **the second is the one that bites: the final segment exists on a *child* of the referenced table but not on the referenced table itself** (`wiki-scaffold/gotchas.md` section 2.2). Zero further reads: resolution is against the cached dictionary.

> **Worked, real the pilot customer data.** `sn_ohs_im`, table `sn_ohs_im_action`, three active business rules `9ec847db…35b8`, `c75a1f57…35d4`, `d01a1f17…35f3`, all carrying `filter_condition: ohs_task.category=mbo`. `ohs_task` references base `sn_ohs_im_task`; `category` exists only on child `sn_ohs_im_incident`. ServiceNow drops the clause and returns unfiltered rows, so the rules match zero rows and have never fired. Cluster of 3, **one** question. Sources `wiki/conventions.md:60-82`, `audit-phase0-findings.md:39`, `_lab/INTERVIEW.md:85-90`. **Real outcome: answered in one line ("Sherwin is building the fix, 1267573"), logged as TBD-040 KNOWN-BROKEN.**

**QS-10a, and the stopword trick that makes it free.** Extract from primary label sources only (`sys_documentation`, `sys_choice`, `sys_db_object.label`, `sys_dictionary.column_label` plus custom column names, `sys_user_group.name`, `sys_ui_message`, `sys_ux_applicability.name`), never from model output. Build the stoplist mechanically from the **same band split the scope filter already computed**: keep a token only when `freq_A / freq_C >= 3` with add-one smoothing. That kills `SLA`, `ACL`, `UI`, `ATF`, `OSHA`, `HRSD` with no hand-written list and no model, and it adapts to the customer's plugin set for free. Predicate: matches `^[A-Z][A-Z0-9&]{1,5}$`, `freq_A >= 3`, passes the ratio test, and no string anywhere in the customer label corpus expands it. Emit **one** question per run carrying the top `k` (default 12) by frequency, with loci attached.

> **Worked.** Running that over the pilot customer's Band A labels yields `accident report`, `ACME`, `HSE`, `STS`, `SIO`, `BRF`, `NTA`, `AVG`, `ARBO`, `TM`, every one of which is in the glossary or the TBD register today. `accident report` alone spans the `sn_ohs_im_incident.category` choice, the `acme.mbo_selection.*` and `acme.mbo_actions.*` message keys, several business-rule names and DEC-005, DEC-010 and DEC-019. **The instance says `accident report` everywhere and says nothing about what it means, and the machine's own guess was wrong for five months** (`wiki/glossary.md:13-15,21`). Correct answer, one line: "Case Bedrijfsongeval".
>
> **Never ask for what is derivable.** Choice values and labels are derivable and must never be asked: `sys_choice` on `sn_ohs_im_incident.state` yields all seven case states with Dutch labels mechanically. The old the pilot customer glossary listed "Geselecteerd" and "Niet van toepassing" as states and **both were inventions** (`wiki/glossary.md:82`). A register built from `sys_choice` cannot invent a state. AW-1 kills that question class outright.

**QS-08 must be SPLIT, and this is the backtest's most valuable single fix.** the pilot customer's measured rate was **4 disagreements per 26 claims replayed, of which exactly 1 was a genuine question** (Q7) and 3 were doc maintenance (an arithmetic error, a rename, a deletion). Scaled to a real ledger that is about 45 emissions of which about 34 need no SME at all, and a simulated doc-repair item scored **10.6 WPM against the real Q13 at 7.8**. So:

> **QS-08q, the question arm.** Emit a question **only** when step-3 token re-extraction from the *drifted value* yields a token **absent from the corpus**, or when the drift has no provenance container at all. Everything else routes to `verify.js` as an L2 repair finding.

That is exactly the test that separates Q7 (the drifted value contained `STRY0185005`, absent from the repo) from Q14b (an audience rename traceable to STRY0181903). The five CLI stages, because the third is the hinge and nobody names it:

1. **Corpus extraction**, once, free. Every 32-hex sys_id, every 8-hex prefix, every quoted artifact name, every story-pattern token, into `.brain/index/corpus.jsonl` with `{token, kind, file, line}`.
2. **L1 replay.** `get_record` with a narrow field list, diff against the doc's *structured* assertion. the pilot customer did exactly this at 26 claims and 18 API calls.
3. **Token re-extraction from the drifted value.** The live value was `"ACME Action Resolve SLA - TM (deprecated - vervangen door Breach on Due Date, STRY0185005)"`. Run the story-id pattern over the **new** value. It yields `STRY0185005`.
4. **Corpus lookup of the new token.** `STRY0185005` appears nowhere in the repo. That is a register-gap against the story register.
5. **Provenance expansion and clustering.** `sys_update_set` where `nameLIKESTRY0185005` yields `fb060e8e1bc643909e2aa934604bcb41`, complete, 19 records, `sys_created_by` a.developer, 2026-07-14, then `sys_update_xml` yields the built list. **One question about a story, not 19 about records.**

Full path: `audit-phase0-findings.md:46-50`, `_lab/INTERVIEW.md:60-68`, `wiki/stories/STRY0185005.md:5-13,54-62`. **Honest outcome, and it is the point of the whole plan:** the question was asked and the human answered "Doesn't recall the details ('dunno what's going on here tbf')" (`INTERVIEW.md:68`). The machine found what the human had forgotten and then the human could not explain it. That is the argument for 4.11, not against it.

**QS-02 ships only with the same-episode discriminator, which costs nothing.** Dissent is interesting **only when the dissenting record was created by the same change episode that dissented it**. Q13's record was created 2026-07-14 and deactivated 2026-07-15 inside the same set, so it survives. the pilot customer's systematic false positives (DEC-006, 008, 009, 010, 012, 027, 032, all batch deactivations of pre-existing records shipped alongside newly created active ones) all fail it. Predicate otherwise: group Band A artifacts by change episode (same update set, or same `(sys_created_by, sys_created_on ± 40 min)`, or same `sys_update_version.source`); within a cluster of size >= 4, a minority of size <= 3 and fraction <= 0.20 differing on a binary state field emits one question carrying the majority as evidence.

> **Worked, and it is the plan's honest anchor.** Update set STRY0185005.00 (`fb060e8e…`), 19 records, 2026-07-14/15. The due-date sub-cluster ships live (guard BR `8bd11682…`, onChange CS `b11292c2…`, UI policy `1a325246…`); one member ships `active=false`, *ACME Subaction Prefill Due Date* `7a029a061b8a43909e2aa934604bcb42`. **The open form returned "Unknown/doesn't recall" and became TBD-038.** Four days later archaeology resolved it to "Deactivated deliberately by the developer on 2026-07-15 09:47:33 inside STRY0185005.00, confirmed via `sys_update_xml` plus `sys_audit`" with the causal clause still hedged "**Likely**" (`wiki/tbd.md:62`). Intent and attribution recovered, rationale inferred. 4.11.2 shows the closed form that should have been asked instead.

**QS-04, predicates 1 to 3.** Duplicate set names with different sys_ids; a batch or parent set `in progress` with zero `sys_update_xml` children while its named siblings are `complete`; a set whose state is non-terminal for its age (`questions.setStalenessDays`, default 30). Child counts via one `stats` group-by on `update_set`. **the pilot customer's own register contains this signal's outputs verbatim:** TBD-043 (`wiki/tbd.md:42`) records two sets sharing the name `STRY0185200.01` plus a batch record still `in progress` with 0 records while all three real sets are complete, with the consequence written down as **promote by sys_id, never by name**; TBD-039 (`:38`) records a previewed-not-committed set, a batch only loaded, and one stuck in `committing`.

**QS-07c, against the customer's own norm rather than best practice**, which is what keeps it out of the platitude bin. A Band A table `T` with zero ACLs named `T` or `T.*`, **and** whose sibling tables (same `super_class`, same scope) do have their own. At the pilot customer, `sn_ohs_im_incident` and `sn_ohs_im_investigation` both carry dedicated ACLs while `sn_ohs_im_action` does not: that is **TBD-005 verbatim** (`wiki/tbd.md:19`), open since STRY0171043, findable with no doc corpus at all. **Mandatory caveat on every QS-07 question:** `sys_security_acl` is itself ACL-protected so a partial read looks complete (6.5). Every QS-07 question carries `readCaveat: 'acl-recursive'` and every QS-07 claim is stamped `unverifiable: blocked-by-access` unless G8 count reconciliation passes.

**QS-06d, and its disambiguator is weak on exactly the instances we will run on first.** Take every distinct `event_name` on Band A notifications; a producer exists if there is a `sysevent_register` row, or the literal name appears in a `sysauto_script`, `sys_script` or `sys_script_include` body adjacent to `eventQueue`/`eventQueueScheduled`, **or a Flow Designer action or Service Connector process config fires it** (both named producers in the reference engagement, DEC-022, and both readable through the same table API). Disambiguator, one call: `/api/now/stats/sysevent?sysparm_count=true&sysparm_query=name=<E>^sys_created_on>=javascript:gs.daysAgoStart(90)`. **On `tier=dev` or on low total `sysevent` volume this returns zero for producers that genuinely exist**, so the gate suppresses nothing while the text scan over-emits. Stamp `readCaveat: 'producer-scan-only'` and drop `C_signal` by the same mechanism used for authorship modes. the pilot customer example: **TBD-031** (`wiki/tbd.md:31`), two active EN and NL reminder notifications listening to `acme.mbo.action_due_date_reminder` with the firing job still to build.

**QS-11's window is run-relative, not absolute.** Cluster against G4's prior-run watermark; fall back to `questions.recentDays` (default 45) only on a first run. See 4.9.0 for why. Worked example: the pilot customer Q15, six `sysevent_email_action` records on `sn_ohs_im_action` re-saved within 12 minutes on 2026-06-18, gate `!=en` moved to `=nl`, the sub-action pair narrowed to `short_term`, so third-language recipients get no mail at all (`_lab/INTERVIEW.md:127-133`, DEC-030, TBD-042). **Real outcome: `_pending_` for eleven days.** Even a good question with a real consequence can go unanswered, which is why `unanswerable` and `deferred` are first-class and why the ranker charges `M` for open questions.

#### 4.9.4 Deleted, and where the deletions went

The nine kills are tabulated by name in 3.3b and are not repeated. Four of them are *routed* rather than simply dropped, and that routing matters:

| Deleted from the question engine | Where it goes instead |
|---|---|
| QS-09b predicate 1 (40-character name) | `verify.js` as an L2 repair finding |
| QS-08's 34-of-45 doc-drift majority | `verify.js` as an L2 repair queue, per the QS-08q split |
| Hardcoded user-facing text against the customer's bilingual norm | `verify.js` L2. It is a repair, not a question: nobody needs an SME to say "yes, that should be a message key" |
| "Naming that breaks the pattern" for display names | refused for display names (FP guess 65%, and `E` is small so it never survives ranking); **kept only where the name is a functional key**: update-set names (folds into QS-04), message keys, `sys_script_include.api_name`, `sys_ui_message.key` |

Also refused, carried forward unchanged: **"inactive artifact" as a lone signal** (9.7 item 3: on a brownfield instance dead config is the norm; implemented as AW-4b suppression), **coverage-shaped signals of any kind** (killed at 3.2/T1 and T2, nothing here reintroduces them), and **runtime usage** (9.3 keeps execution evidence out of scope; the single exception is QS-06d's 90-day `sysevent` check, which is used only to *suppress* a question and never to make a claim).

#### 4.9.5 Ranking: why per minute

Computable by the CLI. No model anywhere in it. Every term is stored on the question record so a disagreement is debuggable.

```
WPM(q) = V(q) / M(q)
V(q)   = E(q) · C(q) · A(q) · U(q)          value, in explained-artifact-equivalents
M(q)   = estimated minutes to answer
```

**`E(q)`, reach. The revision-4 formula, because the first one was defective.**

```
E(q) = min( 64 ,  4·log2(1 + |cluster|)  +  max_{m ∈ cluster} log2(1 + reach(m)) )
```

The original summed `log2(1+reach(m))` over cluster members. When the cluster sits on one table every member has the **same** reach, so `E` collapsed to `|cluster| × (1 + log2(1+reach))`, quadratic in cluster size. The design's own worked examples display it (`3 + 3(3.70)` and `10 + 27`). Two fixes in one line: cluster members are counted once and only once (they are already counted by `|cluster|`, so summing reach double-counts), and cluster size now enters **logarithmically**, because one answer explaining twelve things is worth more than one explaining one, but not twelve times more.

**And the evidence says the value is in the small clusters.** Counting artifacts governed per decision across the pilot customer's 33 DECs: about 12 govern four or more, about 17 govern one to three, and **four govern none at all** (DEC-004, 005, 026, 029 are pure policy and risk acceptances with zero artifact footprint). DEC-021 (integration architecture), DEC-022 (no stored state), DEC-025 (the truncation lesson) and DEC-031 (the hoofdactie marker, arguably the most consequential decision in the ledger, whose footprint at decision time was **one dictionary field**) are all small and all high value. **Cluster-then-ask is right. Cluster-size-as-value is wrong.**

`reach(m)` keeps the split that makes it correct, because two classes radiate in opposite directions:
- **rule-shaped** artifacts (anything carrying a `collection` or `table` column: business rules, client scripts, UI policies, UI actions, ACLs, SLAs, notifications) radiate **downward onto their table**, so `reach` is the count of active Band A artifacts on the same table;
- **definition-shaped** artifacts (script includes, roles, groups, audiences, schedules, message keys, choices) radiate **upward from their referrers**, so `reach` is the count of active inbound references;
- everything else, `reach = 1`.

Whether a class is rule-shaped is decided mechanically from `sys_dictionary`. Without this split, blast radius is simply wrong: the three dead the pilot customer business rules have almost no inbound references and would rank near the bottom when they are the best question in the catalogue. Residual under-count from textual references invisible to a structural graph is accepted and recorded as `reach.method: 'structural-only'`; a second-pass textual scan runs only over post-gate survivors (roughly 30 to 60 records).

**`C(q) = C_guard · C_signal`.** `C_guard` is read from the `ReadResult` guards block in 6.3: **1.0** when every source read is `complete` with `guards.fields: validated` and `guards.identityCanary: pass`; **0.6** on `truncated` or `unfiltered-risk`; **0** on `blocked`, in which case the question is not emitted at all (a blocked read is not evidence of anything). `C_signal` is the **backtest-seeded** `pB'` from 4.9.3, replaced after each run by a Beta-Binomial posterior (4.9.7 `calibrate`). Every question record carries `rank.priorSource`, either `backtest-pilot-2026-08` or `calibrated-<runId>`, never `designer-estimate`.

**`A(q)`, authorship tier.** Band A with `authorship: 'full'` = **1.00**; Band A with `'package-level-only'` or `'time-only'` = **0.80**; Band B (change-questions only) = **0.60**; Band C never reaches the ranker. 0.60 for Band B because "why did you change this" is a genuinely weaker question than "why did you build this", but not a worthless one: DEC-024's four modified OOTB ACLs are Band B and carry a real decision.

**`U(q)`, unblocking, computed post-merge and over ledger dependencies only.**

```
U(q) = min( 3 , 1 + 0.5·|draft claims whose interviewRefs contains q|
                  + 0.5·|distinct DEC or TBD records depending on q's locus| )
```

The original counted "other open questions sharing a cluster member", which on run 1 (with no `interviewRefs` populated) meant **dense chaff mutually boosting itself to the 3.0 cap**, exactly inverting the intent. `U` is now computed only over questions that survived AW-3 merging and counts ledger dependencies, not sibling questions.

**`M(q)`, minutes, from observable fields only.** Base **1.0**; **+1.0** if the question is open rather than closed (no `branchMap`); **+0.5** per additional distinct table in the cluster beyond the first; **+1.5** if answering needs a script body of 40 lines or more; **+2.0** if it spans more than one instance or environment; **-0.5** when the provenance envelope supplies `(author, date, container)`. Floor 0.5, ceiling 8.0. The `-0.5` is deliberate incentive design: it makes the ranker reward the 4.11 scaffold, so a run that mines provenance surfaces its cheap questions first.

**Determinism.** Sort by WPM descending, ties broken by cluster size descending, then `capturedAt` descending, then content-hash id ascending. Deterministic by construction, which phase 4's two-runner comparison needs.

**Worked ranking, re-run under the corrected formula and the backtest priors.**

| | `|cluster|` | reach | E | C_signal | A | U | V | M | **WPM** |
|---|---|---|---|---|---|---|---|---|---|
| **Q-A** QS-05a, three dead BRs on `sn_ohs_im_action` | 3 | 12 | 4·log2(4)+log2(13) = **11.70** | 0.70 | 1.0 | 2.5 | 20.48 | 0.5 | **41.0** |
| **Q-C** QS-10a, the acronym register gap (10 tokens, one question) | 10 | 25 | 4·log2(11)+log2(26) = **18.54** | 0.85 | 1.0 | 3.0 | 47.28 | 2.5 | **18.9** |
| **Q-B** QS-02, the prefill dissent | 1 | 12 | 4·log2(2)+log2(13) = **7.70** | 0.35 | 1.0 | 1.5 | 4.04 | 0.5 | **8.1** |

**Order Q-A > Q-C > Q-B survives the fix**, which was the backtest's own test of it. Sanity check against what happened at the pilot customer: Q10 produced a one-line answer and an active defect fix (TBD-040); the glossary rewrite corrected a five-month-wrong core term and is credited with taking the probe suite to 8 of 9; Q13 produced "dunno" and a debt item. **The formula's ordering reproduces the measured value ordering.** State the caveat plainly: this is a consistency check fitted with the answers known, not a prediction. Note also that Q-B is `shadow` at run 1 and would not be sent, and that the QS-05b counter-example that used to outrank it at 8.0 no longer exists.

#### 4.9.6 The anti-waste filter, and what it actually suppresses

Six gates, ordered by cost. Every kill is written to the **suppressed-candidates list** with its gate and reason, because that list is the only free recall-shaped signal in the design (6.4/G3, 9.6).

| # | Gate | Cost | Mechanizable? |
|---|---|---|---|
| **AW-3** | duplicate of an open, answered or governed question | free | fully |
| **AW-4a/b/c** | the answer would change nothing (structural cases) | free | fully, for the structural subset |
| **AW-2a** | answerable from a **structured** field of a repo doc | free | fully |
| **AW-1** | answerable from the instance | <= 3 reads per question | fully |
| **AW-4d** | the "so what" residual | 1 model call, capped candidate set | **no. Capped, drop-only.** |
| **AW-5** | derivable from our own ledger (the L3 oracle) | 1 isolated agent run per **post-rank** survivor | mechanical under the id-match rule |

**AW-1, resolvers.** Each signal registers `resolver(question, session) -> {verdict: 'kill'|'narrow'|'keep', evidence, template}` with a hard budget of `read.resolverCallsPerQuestion` (default 3) and a run-level cap. QS-06d: event fired in 90 days, **kill**. QS-07c: a parent ACL covers the operation via `super_class` walk, **kill**. QS-02: `sys_update_version` shows an in-set deactivation, **narrow** to the closed template. QS-10a: any Band A string expands the acronym, **kill**. QS-10 choice values: always **kill**, values are derivable and must never be asked. QS-11: in a named completed set on a second pass, **kill**. `narrow` matters as much as `kill`: it is the 4.11 conversion and it is where `M`'s -0.5 is earned. **This is the best gate in the set and it is the one to build first after the catalogue.**

**AW-2 splits, and the split is a field finding rather than caution.** *AW-2a, structured, kills:* the locus keys are looked up in the QS-08 corpus index restricted to machine-readable locations (a frontmatter `mentions:` entry, a registry row, a `decisions.jsonl` `explainsClaims` array, a TBD row); a hit dies as `already-governed` citing the id. the pilot customer's story frontmatter is exactly this shape and is why the check is buildable at all (`wiki/stories/STRY0185005.md:12-31`, sixteen artifacts with table and sys_id). *AW-2b, prose, does NOT kill:* it attaches `possiblyAnsweredAt: [file#line]` and reduces nothing. **Killing on a prose hit would have killed the STRY0185005 question:** six repo files presented that dead SLA as live and every one was wrong (`audit-phase0-findings.md:48`), and F-15 measured 237 of 255 the pilot customer doc files (93%) with exactly one commit ever (`:104-107`). **A prose mention is as likely to be stale as to be an answer.** One exception: a `last-verified` stamp newer than the claim's `capturedAt`, and even then it downgrades rather than kills.

**AW-3.** Content-hash the **locus set**, never the wording: `sha256(sort(sysIds) ‖ signalId ‖ clusterKey)`. Exact match kills as `duplicate`; Jaccard of locus sys_id sets >= 0.6 **merges** (union the clusters, keep the higher WPM, record `mergedFrom`). If the locus is already governed by a DEC with `confirmationStatus: current` or by an open TBD, kill as `already-governed` and cite the id. Worked: TBD-040 governs the three dead business rules, so a second MAP run must not re-ask Q10, **and by 4.10.3 the day one of those three claims changes, TBD-040 re-opens by itself and the question returns with `gate: decision-reconfirmation`.**

**AW-4.** *(a)* every claim in the locus is already `verified`, no page renders any of them, no DEC references them, and `E(q) = |cluster|` (zero reach): nothing downstream consumes the answer, kill. *(b)* the artifact is inactive **and** has zero active inbound references **and** is not a cluster dissenter: this is 9.7 item 3's triage rule implemented as a suppression. *(c)* both branches map to the same `branchMap` entry: rarely fires, and saying so is more honest than implying it does work. *(d)* **the residual, and this genuinely cannot be mechanized.** A model, given **only** the question text, the cluster manifest and the branch map (never the evidence pack, never the transcript, never the rationale), emits for each branch one operation from a closed vocabulary: `promote-claim | mint-dec | mint-tbd | mark-known-broken | no-op`. Both branches `no-op` means the question drops. **Cap, five parts:** at most `3 × questionCap` candidates taken from the top of the WPM order; exactly one call each, no retries, temperature pinned, prompt hash and model id recorded; any output outside the vocabulary is a `no-verdict` and the question **survives**; **drop-only**, it may not resurrect a question another gate killed and may not alter a rank; every drop lands on the suppressed-candidates list. An L4 stage that can only shrink the queue cannot manufacture work for a human, which is the failure mode that matters here. **Flagged explicitly: this is the one place in the engine where a model grades output that feeds a human-facing decision, and it is bounded rather than trusted.**

**AW-5 moves to run AFTER ranking, on the top N by WPM only** (`questionCap` plus a small margin, so 12 to 15 runs rather than 150). As originally specified it ran on every survivor: about 150 isolated agent runs, budgeted nowhere in section 11's call plan or phase 2's effort estimate, and its strict id-match rule (kill only when **every** claim id in `question.sources.A/B` appears in `citedClaimIds`, compared as exact strings by the CLI) is satisfied so rarely that it killed under 5%. The rule is correct and loosening it destroys the mechanism, so the gate moves instead of softening. Recorded in the schema as `gates['AW-5'].scope: 'top-n-post-rank'`.

**What the gates actually suppress, measured, and it changes where the safety load sits.** Simulated over the pilot customer: **204 clustered candidates in**, realistic kills AW-4b about 18, AW-1 about 25, AW-3 about 12, **AW-2a about 45 on the pilot customer only**, AW-4a/c about 4, AW-4d about 8, AW-5 about 3. **Survivors: about 89 on the pilot customer, about 155 on a virgin engagement. Against a `questionCap` of 10.**

> **Therefore the anti-waste filter is not the safety mechanism. The top-N truncation is, and the ranking function carries the safety load.** The plan presented the gates as what protects the SME; arithmetic says otherwise, and that is why 4.9.5 matters more than this subsection.

**Two of the six gates are dark on run one of any new engagement, and the plan must stop reading as if they are instance-independent.** AW-3's already-governed arm needs `decisions.jsonl` with populated `explainsClaims`; the pilot customer's 33 DECs are prose and migrating them into claim-bound records is unfunded work anywhere in this plan. AW-2a's structured arm needs pilot-grade story frontmatter, which is the single most valuable and least common documentation artifact in the reference engagement. AW-2a alone is about 45 of about 115 kills on the pilot customer and **about 0 on a virgin instance**: that is the difference between an 89-deep queue and a 155-deep one. **Fix:** stamp gate availability per run exactly as provenance and authorship are stamped, `gates.AW-2a: 'available' | 'no-structured-corpus'` and `gates.AW-3.governed: 'available' | 'empty-ledger'`, and report the per-gate kill distribution with unavailable gates shown as **zero rather than absent**. **devinst01 runs with both dark** (11.1).

**Two gates cannot be mechanized in their general form and both get the same treatment:** AW-2 (does this prose answer the question) and AW-4 (would the answer change anything). Standing pattern: **mechanize the structured subset, downgrade rather than kill on the unstructured part, and cap the model to a drop-only role over a bounded candidate set with a closed output vocabulary.**

#### 4.9.7 Schema and CLI

```jsonc
// .brain/questions.jsonl   append-only; ids content-hashed by the CLI, never by the model
{
  "id": "Q-0007",
  "signal": "QS-02",
  "signalState": "shadow",                 // admitted | shadow | refused  (4.9.3)
  "gate": "contradiction",                 // contradiction | delta | register-gap | decision-reconfirmation
  "sources": {
    "A": { "kind": "claim",   "ref": "C-0042", "says": "active=false" },
    "B": { "kind": "cluster", "ref": "US:fb060e8e…", "says": "3 of 4 cluster members active=true" }
  },
  "locus":   [ { "table": "sys_script_client", "sysId": "7a029a06…", "claim": "C-0042",
                 "band": "A", "authorshipEvidence": ["A2","A4"] } ],
  "cluster": { "key": "sys_update_set|fb060e8e…", "size": 4,
               "members": ["…"], "dissenters": ["7a029a06…"],
               "sameEpisodeCreated": true },        // QS-02's discriminator, 4.9.3
  "evidence": [ { "query": "sys_idIN7a029a06…", "fields": "sys_id,name,active,sys_updated_on",
                  "capturedAt": "2026-08-11T09:12:44Z", "transport": "rest_request",
                  "completeness": "complete",
                  "guards": { "fields": "validated", "identityCanary": "pass" } } ],
  "provenance": { "rungs": ["P1","P2","P4","P5"], "author": "a.developer",
                  "at": "2026-07-15T09:47:33Z",
                  "container": { "type": "sys_update_set", "sysId": "fb060e8e…",
                                 "storyId": "STRY0185005", "trackerId": "1219475",
                                 "memberCount": 19 },
                  "priorValue": { "field": "active", "from": "true", "to": "false",
                                  "source": "sys_update_version" } },
  "branchMap": { "a": "deliberate → mint-dec", "b": "unfinished → mint-tbd" },
  "form": "closed",                        // closed ⇒ branchMap non-empty
  "question": "…",                         // the ONLY string a model writes
  "consequence": { "text": "…", "count": null, "countQuery": null },
  "rank": { "E": 7.70, "C_guard": 1.0, "C_signal": 0.35, "A": 1.0, "U": 1.5,
            "V": 4.04, "M": 0.5, "wpm": 8.08,
            "priorSource": "backtest-pilot-2026-08",   // never "designer-estimate"
            "reach": { "method": "structural-only", "value": 12 },
            "computedAt": "2026-08-11T09:20:00Z" },
  "gates": { "AW-3": "pass", "AW-4a": "pass", "AW-4b": "pass",
             "AW-2a": { "verdict": "pass", "availability": "no-structured-corpus" },
             "AW-2b": { "possiblyAnsweredAt": [] },
             "AW-1":  { "verdict": "narrow", "calls": 1, "evidence": "sys_update_version …" },
             "AW-4d": { "verdict": "mint-dec|mint-tbd", "model": "…", "promptHash": "…" },
             "AW-5":  { "scope": "top-n-post-rank", "verdict": "not-run" } },
  "status": "queued",     // queued | asked | answered | suppressed | deferred | merged | shadow
  "suppression": null, "askedIn": null,
  "outcome": null,        // answered-with-rationale | answered-attribution-only | unanswerable
                          // | deferred | decoy | already-governed
  "answer": null, "producedDec": null, "producedTbd": null,
  "readCaveat": null      // e.g. "acl-recursive", "producer-scan-only"
}
```

**CLI surface.** Node CommonJS, zero dependencies, documented exit codes (`0` ok, `1` questions pending or gates failed, `2` could not run, which is never equal to "passed").

| Verb | Contract |
|---|---|
| `snbrain questions emit --run <id>` | Runs the scope filter, then every **admitted or shadow** signal over `.brain/claims.jsonl` and `.brain/raw/*.ndjson`. **Refuses with exit 2 and terminal `inventory-only`, `filter-non-discriminating` or `authored-but-undeliberate` when 4.9.2's four-part gate fails.** Prints the anomaly-to-question ratio, the per-gate kill counts **with unavailable gates shown as zero**, and the per-signal admission state. |
| `snbrain questions rank` | Recomputes `rank.*` from the current ledger. Idempotent, pure, no reads. Re-runnable after a claim changes without re-running MAP. |
| `snbrain questions filter [--gate …]` | Runs AW-3, AW-4a/b/c, AW-2a, AW-1, AW-4d in cost order; **AW-5 runs after `rank`, on the top N only.** Writes the suppressed-candidates list. |
| `snbrain questions next --n 5 [--format brief\|json]` | The top n `queued` **`admitted`** questions by WPM, rendered as an interview brief: evidence pack, cluster size, blast number, two branches, provenance line. Shadow questions are never included. Surplus is written `status: deferred`, never discarded. Marks `asked` only on `--commit`. |
| `snbrain questions shadow --n 20` | The shadow queue, for the **operator**, with a grading prompt. Zero SME cost, and it is `calibrate`'s only input on unadmitted signals. |
| `snbrain questions admit --signal <id> --by <name> --reason <text>` | Attributed promotion of a shadow signal to admitted. Recorded, never silent. |
| `snbrain questions answer <id> --by <name> --at <date> [--branch a\|b] [--rationale <t>] [--kind decision\|debt\|unanswerable\|deferred] [--verbatim-file <p>]` | Records the answer, mints the DEC or TBD per 4.10, writes `explainsClaims` **CLI-side**, prints the ledger delta. |
| `snbrain questions explain <id>` | Prints every ranking term, every gate verdict and the exact queries. The debuggability contract. |
| `snbrain questions suppress <id> --gate manual --by <name> --reason <text>` | Attributed manual suppression. |
| `snbrain questions merge <id> <id>` | Explicit form of AW-3's near-duplicate merge. |
| `snbrain questions calibrate` | Replaces each prior with a Beta-Binomial posterior mean, `prior' = (n0·prior_seed + hits) / (n0 + graded)`, `n0 = 5`, where a hit is `{answered-with-rationale, answered-attribution-only}` or an operator-graded shadow hit, and a miss is `{decoy-equivalent, already-governed-late, no-op}`. Prints pre and post values and `priorSource`. `n0 = 5` so one run cannot swing a prior; **with a backtest-measured seed the slow update is a feature, not a liability.** |
| `snbrain questions export --to <path>` | Renders `INTERVIEW.md` from `status=asked`. Replaces the synthesis stage that writes it today. |

#### 4.9.8 What MAP stops doing

Every item names the line in `.claude/workflows/bootstrap-project-brain.js` that goes away.

| # | Stops | Line | Replaced by |
|---|---|---|---|
| 1 | **The model authoring questions.** `Q_SCHEMA` takes `{question, context, whyItMatters}` free text from every stage. Delete `questions` from every stage schema; stages return **observations** only, `{table, sysId, field, value, sourceQuery}`, streamed to `.brain/raw/<phase>.ndjson`. | `:45-52`, plus `schema: Q_SCHEMA` at `:79`, `:117`, `:141`, `:164` | `questions.js` computes questions from the ledger. The model never emits a question object again. |
| 2 | **Model-side dedupe and prioritization**, and `JSON.stringify(allQuestions).slice(0, 30000)`, which truncates mid-JSON (B2). | `:153`, `:158` | AW-3's locus hash for dedupe, WPM for order. The 30,000-character truncation disappears because the list is never a prompt payload. |
| 3 | **Writing `INTERVIEW.md` as a synthesis artifact.** | `:158` item (3) | `snbrain questions export`. |
| 4 | **Flagging dead or suspect config inside the harvest prompt** ("BR filters that match 0 rows, test them with the corresponding query when cheap"). | `:138-140` | Two separate failures: the row-count test is the technique B3 kills (`playbooks/01-audit.md:19-21`), and every item on that list is a per-record detector that QG1 drops anyway. Harvest reads `filter_condition` verbatim; QS-05a resolves it CLI-side; QS-06 does the orphans as set operations. |
| 5 | **Four hardcoded harvest areas.** | `:121-126` | Areas derived from census evidence **and aimed by the scope filter**: skip any table with zero Band A rows entirely. On a real instance most of 6.5's forty tables will have zero and nobody has costed that saving. Free budget. |
| 6 | **Harvesting in order to write pages** ("extend a page if a same-cluster page already exists, read before write"). | `:34-41`, `:132-137` | Pages are a render from claims (4.7). A stage's only writes are `.brain/raw/*.ndjson` plus its manifest. **This kills B4 at the root** rather than patching it with locks. |
| 7 | **"WHAT, never WHY" as a prompt law for observation stages.** The first half stays; the second half ("every gap, anomaly, ambiguity or guessed meaning becomes an interview question in your structured return") is what produces the flood. | `:39-41` | New law: "record what you read; you may not create a question." |
| 8 | **Archaeology as a fixed phase producing story pages.** | `:88-117`, `:105-111` | Archaeology's output is the **provenance envelope indexed by `sys_update_name`** (4.11), consumed by the ranker and the templates. Story pages are a render. F3's tiering survives, driven by census evidence rather than an operator flag. |
| 9 | **Collecting `artifactCount` and discarding it** (M3). | `:79` | The scope filter's denominator and 9.6 item 2's honest inventory. |
| 10 | **Harvesting glossary "candidates" from pages the model just wrote**, which is a model reading model output. | `:158` item (2) | QS-10a's frequency-discriminated extraction from **primary** label sources, with counts and loci attached, and choice values derived rather than asked. |
| 11 | **The preflight self-report `{ok: boolean}`** (F4) and the in-memory-only return (M1). | `:56-67`, `:167-172` | Runner-side precondition; `.brain/state/<run-id>.json`. Already in the plan; listed for completeness of the retirement surface. |

Retirement surface per phase 3: the workflow file, `.claude/skills/bootstrap-project-brain/` including the DRAFT doctrine at `SKILL.md:20-24`, `README.md` step 4, and a probe re-run.

### 4.10 THE DECISION LEDGER. Rewritten from design in revision 4.

#### 4.10.1 Schema

```jsonc
// .brain/decisions.jsonl  →  rendered to wiki/decisions.md
{
  "id": "DEC-0034",                        // CLI-allocated, append-only, never renumbered
  "statement": "…",                        // what was decided, one sentence
  "rationale": "…",                        // the WHY. Only a human supplies this.
  "rationaleStrength": "stated",           // stated | inferred | absent      ← 4.10.2
  "alternatives": [ { "label": "…", "rejectedBecause": "…" } ],
  "scope": { "instance": "devinst01", "instanceTier": "vendor-dev",
             "appScopes": ["x_acme_fm"], "tables": ["sn_ohs_im_action"] },
  "governs": "…",                          // optional forward rule
  "answeredBy": "a.developer",             // REQUIRED
  "answeredAt": "2026-08-11",
  "answerProvenance": { "fromQuestion": "Q-0007", "channel": "batch-email",
                        "verbatim": "…",   // the answer as given, unparaphrased
                        "rationaleVolunteered": true, "branch": "a" },
  "derivedFrom": "interview",              // interview | archaeology | build-time-doc | migration
  "witnessClaims":  ["C-0042"],            // claims that PROVE the decision was taken
  "explainsClaims": ["C-0042","C-0043"],   // claims the decision ACCOUNTS FOR   ← the binding
  "confidence": "high",
  "supersedes": null, "supersededBy": null,
  "confirmationStatus": "current",         // current | needs-reconfirmation | superseded | orphaned
  "reconfirmation": [                      // append-only, written only by VERIFY
    { "trigger": "claim-drift", "claim": "C-0042", "claimRole": "explains",
      "from": "active=true", "to": "active=false",
      "at": "2026-09-02T06:11:00Z", "openedQuestion": "Q-0119" } ]
}
```

**Two fields revision 2's sketch does not have, and both are demanded by the evidence.**

**`rationaleStrength`.** TBD-038's causal clause is explicitly hedged, "**Likely** disabled because the CS uses `g_form.setValue` on the workspace create form" (`wiki/tbd.md:62`). A ledger that cannot distinguish a rationale a human *stated* from one the machine *inferred* will, six months later, present an inference as a decision. the pilot customer already suffered that failure at a different layer: TBD-023 carries "Original (WRONG) analysis kept for history", 1,788 characters of a confident reconstruction that was retracted (`audit-phase0-findings.md:80`). `inferred` renders with a visible marker.

**`witnessClaims` versus `explainsClaims`.** Genuinely different sets, and collapsing them breaks supersession. A *witness* proves the decision was taken (the SLA is inactive, therefore a decision to deactivate it exists). An *explained* claim is one the decision accounts for (the new SLA's start condition, the guard BR's filter). Drift in a witness means the decision may not have been taken, or was reversed. Drift in an explained claim means the decision's consequences moved. Both open reconfirmation, with different text and different urgency.

#### 4.10.2 How an interview answer becomes a decision record

`snbrain questions answer` classifies **mechanically first**, then lets a model write two strings and nothing else.

| Input | Mechanical classification | Record |
|---|---|---|
| `--rationale` non-empty | rationale present | DEC, `rationaleStrength: stated` |
| `--branch` given, no rationale | intent and attribution only | DEC, `rationaleStrength: absent`, plus a TBD if a follow-up is owed |
| `--kind unanswerable` | the oracle failed | TBD with owner and date; question `outcome: unanswerable` |
| `--kind deferred` | not now | question `status: deferred`, no record |
| archaeology supplied the causal clause, the human did not | inference | DEC, `rationaleStrength: inferred`, `derivedFrom: archaeology` |

Then, and only then, a **capped model step** writes exactly two things from the verbatim answer: `statement`, and each `alternatives[].label`. It never writes `explainsClaims`, `witnessClaims`, ids, dates, attribution or `rationaleStrength`. Same discipline as QG4: the model gets the wording, the CLI keeps the arithmetic and the links.

`explainsClaims` is computed CLI-side as `union(question.locus[].claim, cluster.members[].claim)` plus any claim the AW-1 resolver touched. `witnessClaims` is the subset appearing in `question.sources.A/B`.

#### 4.10.3 The supersession link, and the argument for building any of this

**The mechanism.** VERIFY writes a verdict. The CLI maintains a reverse index `claim → decisions[]` at `.brain/index/claim-decisions.json`, rebuilt on every ledger write.

| Claim transition | Effect on every DEC referencing it |
|---|---|
| `verified → drifted`, **explained** claim | `confirmationStatus: needs-reconfirmation`, reconfirmation row, **question emitted with `gate: decision-reconfirmation`** |
| `verified → drifted`, **witness** claim | as above, plus `confidence` demoted one step, and the question text says the decision itself may have been reversed |
| `* → gone` | as above, plus the question is templated "this decision's subject no longer exists" |
| claim removed from the ledger | `confirmationStatus: orphaned`, flagged in the run summary, **no question** (there is nothing to ask about) |

The reconfirmation question ranks near the top by construction and with no special case: `C_guard = 1.0` and `C_signal = 1.0` (drift is an L1 fact, not an inference), `A = 1.0`, and `E` counts the DEC's entire `explainsClaims` set. **A decision whose foundation has moved is the highest-value thing you can put in front of a human, and the formula produces that ordering by itself.** It is also the only path by which a `refused` or `shadow` signal's locus can reach the SME, which is correct: the drift, not the signal, is the evidence.

**Now the argument, explicitly, because it is the whole justification for tooling over a markdown template.**

1. **The template is not the problem, and pretending otherwise loses the argument.** `wiki-scaffold/decisions.md` already mandates decision-plus-rejected-alternatives, append-only numbering and supersede-in-place. the pilot customer complies richly: 33 entries, every one story-attributed, several with rejected alternatives (DEC-020 rejects OOTB `sn_ohs_im_rca` with reasons; DEC-021 rejects External Processing; DEC-024 records four parallel custom ACLs built and then deleted after peer review). **That artifact exists and it was built with none of the proposed machinery.** Any pitch that starts "you need a tool to write decisions down" is refuted by the reference engagement in one click.
2. **What the pilot customer does by hand is exactly the link.** DEC-023 carries "REVERTED 2026-05-21", hand-typed. DEC-029 carries "SUPERSEDED by DEC-033", hand-typed. DEC-013 carries a "*Later evolution:*" paragraph, hand-typed. DEC-020 carries "Amended by STRY0186152 (2026-07-30)". DEC-032 carries three separate amendment blocks. **Every one is a human noticing that the world moved under a decision and going back to edit it.** That is precisely, and only, the operation the link automates.
3. **The manual mechanism has a measured failure rate, on this project, by an unusually disciplined author.** `CLAUDE.md:84` said "DEC-001 to DEC-021" while `MANIFEST.md:74` said "DEC-001 to DEC-031" while the same MANIFEST table contained DEC-032 (`audit-phase0-findings.md:72`). DEC-033's own numbering note records a **dual-ledger collision**, the same decision recorded as "DEC-032" in two places (`wiki/decisions.md:119`). F-11 records 7 or more unmarked-superseded rows. **Roughly one in five.**
4. **The specific case, with sys_ids, that the link would have caught the same second.** DEC-031 (`wiki/decisions.md:101-104`) records the migration that flipped the main-action SLA's `start_condition` onto `u_is_main_action=true`. Then STRY0185005 deactivated that SLA: `contract_sla a7b58042871f3e1020d362883cbb352d`, renamed "(deprecated - vervangen door Breach on Due Date, STRY0185005)", `active` 1 to 0, on 2026-07-14 (`wiki/registry-sys-ids.md:56-58`, `wiki/stories/STRY0185005.md:55`). DEC-031's impact clause is now partly about a dead record and **nothing flagged it.** It was found six days later, and only because a human ran a 26-claim sweep by hand. With `explainsClaims: ["C-active-of-a7b58042"]` on DEC-031, the L1 replay that returned `active=false` would have flipped DEC-031 to `needs-reconfirmation` **in the same call** and emitted a top-ranked question. **That is the product, in one worked case, with real ids.**
5. **The three additions that are real but must not lead.** Claim binding makes the WHY retrievable at the moment an agent touches the artifact (a wiki page is not retrievable by sys_id; a claim id is). Forced attribution and date, which the pilot customer has and most ADR practice loses. And a one-line prompt instead of a blank page, which is small and should be sold as small.
6. **Two counter-arguments, stated because a domain expert will raise them.** First, **the link only fires on claims the ledger contains**, so 9.6's recall problem applies to supersession too: decisions resting on facts we never wrote will never be flagged. The honest pitch is "every decision that rests on a fact we verified is re-opened automatically when that fact moves", never "your decision ledger stays current". Second, **all 33 the pilot customer decisions trace to build-time story documentation, not to discovery**, and of the six instance-derived interview questions **zero** produced a decision record at the time of asking. So the near-term deliverable is the debt register plus supersession, exactly as Q8 proposes, and the decision ledger is the long-run artifact that discovery can only partly exhume. **Sell the debt register, build toward the ledger, and let phase 0.1 set the number.**

### 4.11 THE PROVENANCE SCAFFOLD. New in revision 4.

**What it is for, stated as a rule.**

> An **open** question ("why does this exist", "why is this off") may be emitted **only** when the provenance envelope is empty. Whenever the envelope carries `(author, date, container)`, the CLI rewrites the question against the signal's registered **closed** template with two named branches.

This is the mechanism that converts a question the human already failed to answer into one narrow enough that he might, and it is the honest version of what 9.2b says archaeology buys: **intent and attribution, not rationale.**

#### 4.11.1 The envelope: ten rungs, and which survive what

| Rung | Source | Yields | Clone-resilient | Survives no update sets |
|---|---|---|---|---|
| **P1** | `sys_update_set` name, description, state, parent | story id, sub-set number, external tracker id, a human-written intent phrase | no | no |
| **P2** | `sys_update_xml` for the set | the built list, the co-shipped cluster, intra-set ordering | no | no |
| **P3** | **a story id embedded in a live artifact's `name`, `description`, `short_description` or condition** | artifact-to-story link **with no update sets at all** | **yes** | **yes** |
| **P4** | `sys_update_version` payload, on demand, `widePageSize: 25` | **prior field values, the delta** | often no | yes |
| **P5** | `sys_metadata` created/updated by and on, `sys_mod_count` | change episode by author and time window | **yes** | **yes** |
| **P6** | `sys_customer_update` | customer-touched flag | **yes** | **yes** [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, so P6 is P1/P2 under an alias and both "yes" cells are wrong.] |
| **P7** | `sys_metadata_delete` | the GONE class plus deleter and date | yes | yes |
| **P8** | **script comments and JSDoc** in `script`, `client_script`, `advanced_condition` | verbatim human WHY sentences, TODO/FIXME/HACK markers, story ids in comments | **yes** | **yes** |
| **P9** | `sys_audit` (probe availability once) | field-level before and after | depends on clone profile | yes |
| **P10** | journal and description fields on on-platform tracking records (`rm_story`) | acceptance criteria, discussion | yes | yes |

**P1 parsing yields four facts from one field with zero model calls.** the pilot customer set name `"STRY0185005.00 - User Story 1219475: Uitwerking streefdata acties en case"` gives story id, sub-set number, tracker id and a human-written intent phrase. The pattern is **induced, not hardcoded**: cluster all set names and extract the most frequent `^([A-Z]{2,6}\d{5,8})` shape with support >= 0.7 over >= 8 rows (the pilot customer yields `STRY\d{7}` plus an optional `\.\d{2}`). Deviations from it were QS-04 predicate 4, which the backtest deleted, so the induced pattern is used for **parsing only** and never as a question source.

**P3 is the rung that survives everything and the plan does not name it.** The STRY0185005 catch worked because the story id was in the SLA's renamed `name` field. Generalize: scan every Band A artifact's name and description for the induced story pattern. Free (the fields are already read), clone-resilient, and independent of update sets entirely.

**P8 is a real yield source and it partially corrects 9.3.** the pilot customer's own conventions mandate the WHY comment ("comment the *why* wherever a future reader would pause, deliberate rule inversions", `wiki/conventions.md:119-126`) and instruct "leave a short comment on the line so it isn't 'fixed' back into a silent break" (`:95-97`). So counter-knowledge is **sometimes sitting verbatim in the `script` field**. 9.3's claim that counter-knowledge is unproducible narrows to: *not derivable in general, but retrievable verbatim where the customer's convention mandates a comment, and unverified when retrieved.* Extraction: the top comment block, plus any comment matching the customer's detected `Why:` marker, plus any comment containing a story id, plus TODO/FIXME/HACK/XXX. **Cost: it needs script bodies, so it runs only on candidates that already passed the anti-waste gates**, roughly 30 to 60 records per run, never as a sweep. Data-egress consequence flagged under Q13.

#### 4.11.2 The conversion, worked on real the pilot customer data

**Q13, QS-02 cluster dissent.**

*Open form (envelope empty):* "The client script *ACME Subaction Prefill Due Date* (`sys_script_client 7a029a06…`) is inactive while the rest of the framework is live. Why?" **Measured the pilot customer answer: "Unknown/doesn't recall", became TBD-038.**

*Closed form (envelope P1+P2+P4+P5):*

> *ACME Subaction Prefill Due Date* (`sys_script_client 7a029a061b8a43909e2aa934604bcb42`) was created 2026-07-14 and set `active=false` on **2026-07-15 09:47:33 by a.developer**, and the deactivation was captured **inside** update set `STRY0185005.00` (`fb060e8e1bc643909e2aa934604bcb41`, 19 records) rather than applied afterwards, so it ships inactive by design of that set. Its three cluster-mates (guard BR `8bd11682…`, onChange CS `b11292c2…`, mandatory UI policy `1a325246…`) all ship active.
> **(a) deliberate, or (b) unfinished?** If (a), one line on why is enough.

Answerable in about twenty seconds, and it is almost exactly the evidence archaeology later produced (`wiki/tbd.md:62`) **after** the open form had already failed. **That is the field proof that the conversion is the mechanism, and it is n=1.**

**Q15, QS-11, with the computed consequence.**

*Open form (measured the pilot customer outcome: `_pending_`, eleven days):* "Who changed the notification language gates on 2026-06-18, and was the narrowing intended?"

*Closed form (envelope P4+P5 plus one stats call):*

> On 2026-06-18 within 12 minutes, `<sys_updated_by>` re-saved all six NL `sysevent_email_action` records on `sn_ohs_im_action`. `sys_update_version` shows `condition` moved from `ISEMPTY^OR!=en` to `ISEMPTY^OR=nl` on all six, and the two sub-action records additionally gained `type=short_term`. No named story set contains this change.
> **Computed consequence:** recipients whose `preferred_language` is neither `en` nor `nl` now match **no** notification (`count(sys_user where active=true^preferred_languageNOT INen,nl)` = **N**), and `long_term` sub-actions send no Dutch mail.
> **(a) intended narrowing, or (b) collateral from an edit?** Yes or no is enough.

**Hard emission rule extracted from this, not a nicety: any signal whose consequence is countable in one stats call must carry the count.** A question that carries the blast number gets answered.

#### 4.11.3 Degradation, honestly, and what it costs

| Envelope state | Signals lost | Signals at full strength | Stamp |
|---|---|---|---|
| Full, P1 to P9 | none | all 11 | `provenance: 'full'` |
| **No update sets** (P1, P2 gone) | **QS-04 entirely; QS-11 becomes `unavailable` and is not degraded (3.3b); QS-02 loses the set dimension and keeps author plus time, but its same-episode discriminator degrades to a timestamp comparison** | QS-05a, QS-06a/b/d, QS-07a/c, QS-09b, QS-10a, QS-12, and QS-08q where a corpus exists | `provenance: 'metadata-only'` |
| Cloned, versions excluded (P4 also gone) | all delta-gated questions | the same nine | `provenance: 'current-state-only'` |
| Nothing but `sys_metadata` columns | QS-02 and QS-11 both die | still nine | `provenance: 'columns-only'` |

**Nine of eleven signals survive the worst case.** That is the quantitative form of 4.9.1's correction C-b and why `inventory-only` belongs on the scope filter and not here. **And C-c's exception applies:** on a single-owner vendor instance, "nine signals survive" is not reassurance, because what they survive against is scratch. There, `provenance: 'metadata-only'` plus `authored-but-undeliberate` is a **stop**, not a degrade (11.2, gate S1).


---

## 5. PORTABILITY DESIGN

Operator decision 4 says the loop must run on GitHub Copilot as well as Claude Code, and treats that as fixed. I am not re-litigating it, but I am going to be precise about what it costs, because the red team is right that a full model-as-component rewrite would trade a working design for an unproven one.

**Revision 2: unchanged in substance, and the transport decision does not touch it.** Both harnesses call the same CLI, and the read adapter lives behind that CLI, so C1 changes nothing here. Two second-order notes. (i) The adapter needs a live VS Code extension host and a browser helper tab (`out/agent/dispatcher.js:49-54` enforces `requiresBrowser` on every read command), so **MAP and VERIFY are attended operations at a consultant's workstation on either harness**. That is a property of the substrate, not of the harness, and it applies equally to Claude Code and Copilot. (ii) It strengthens 5.1's conclusion rather than weakening it: with the read path pinned to a local CLI plus a local extension, the only thing that has to port is text in and text out, which is exactly what the T3 protocol already assumes.

### 5.1 The correction that changes the design

**Copilot has hooks.** The claim that it does not, which several of the input briefs built on, is refuted by official documentation: https://docs.github.com/en/copilot/reference/hooks-reference documents 14 lifecycle events including `preToolUse`, `postToolUse`, `permissionRequest`, `subagentStart`/`subagentStop` and `preCompact`, with `preToolUse` **fail-closed** (a crash or non-zero exit denies the tool call) and denial via exit code 2 or `"permissionDecision": "deny"`, configured at `.github/hooks/*.json` plus enterprise policy paths, working in both Copilot CLI and Copilot Cloud Agent. The product's five hooks are portable via a config emitter, not a write-off. Do not relocate all enforcement into the CLI on a false premise.

**The real portability blocker is structured output.** Claude Code supports `--output-format stream-json`. Copilot CLI's programmatic reference (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) documents `-p`, `--allow-tool`, `--deny-tool`, `--agent`, `--model` and `-s` (response text only), and no JSON output mode. Every stage of the current design returns against `Q_SCHEMA` (`bootstrap-project-brain.js:45-52`). **Therefore no stage may depend on harness-native structured output.** Each stage writes its result to a file at a path the CLI dictates, and the CLI reads that file. The harness is text in, text out.

### 5.2 The seam

Three tiers of portability. Be explicit about which the constraint actually requires, because they cost wildly different amounts.

| Tier | What | Mechanism | Cost | Verdict |
|---|---|---|---|---|
| **T1. Output portable** | The brain itself: kernel, wiki, claims, probes, **and the 48 skills plus their routing**. | `tools/render-kernel.js` generalized: one template plus config emits CLAUDE.md, `.github/copilot-instructions.md`, `.claude/settings.json` hook wiring, `.github/hooks/*.json` hook wiring, and the per-harness stage shims. | Near zero **for the kernel only** (`tools/render-kernel.js:67-71`). **Not near zero for skills**, and the earlier draft of this table hid that: 48 skills plus a runtime-harvested trigger mechanism (`.claude/hooks/skill-trigger.js`) have no assessed Copilot equivalent, so "the kernel mirrors to both" (README:49-50) is true of one file and unproven of the layer that carries the actual procedures. | **Mandatory for kernel, wiki, probes: already exists, currently broken at the pilot customer, fix the enforcement not the mechanism. UNRESOLVED for skills: scope it in phase 1 (see 2.4 and 5.4) before phase 4 is estimated.** |
| **T2. Verification portable** | L0/L1/L2/L3 checks, state, ledger, budgets, gates. | Plain Node CommonJS CLI, documented exit codes, no harness dependency. Precedent: `gate.js`, `state.js`, `lib/*`, `test/*` at the pilot customer are all already this. | Low. This is the bulk of the new code and it has to be written anyway. | **Mandatory and cheap. Do it.** |
| **T3. Orchestration portable** | Who decides what runs next. | A **spec plus state protocol**: `snbrain next` prints the next stage's brief plus the exact output path; the harness executes it; `snbrain ingest --stage <s> --file <p>` validates and records. The CLI holds the state machine, caps, terminal states and gates. The model holds judgment. | Medium. This is the real work. | **Do this, and NOT a Node-drives-the-model orchestrator.** |

The T3 protocol satisfies "the model is a component, not the orchestrator" literally: the CLI owns every control-flow decision, every bound, and every verdict. But it preserves the thing a hard-coded orchestrator would destroy, which is the dynamic frontier. Anthropic's own position is that you cannot hardcode a fixed path for exploring complex topics (https://www.anthropic.com/engineering/multi-agent-research-system), and the current design's worst structural flaw is precisely that it hardcodes four literal `AREAS` at `bootstrap-project-brain.js:121-126` for a genuinely unknown instance. Moving that branching from a prompt string (cheap to change, per engagement) into compiled CLI logic (a release) would make it *harder* to fix, not easier. Under the protocol, the brief text is composed by the CLI from state at runtime: the harvest areas come from the census, not from an array.

Concretely:

```
snbrain map --config product.config.json          # CLI: preflight, budget, state init
  └─ snbrain next            ⇒ prints brief + "write JSON to .brain/in/census.json"
     └─ harness runs it       (claude -p …   |   copilot -p --agent snbrain-census …)
        └─ snbrain ingest --stage census --file .brain/in/census.json
           ⇒ validates schema, records, derives the NEXT brief from what census found
```

`snbrain next` is idempotent and resumable. Kill the terminal mid-run and `snbrain next` picks up exactly where it stopped. That property alone fixes M1.

### 5.3 What is lost versus a Claude-native design

Say it plainly:

- **Subagent isolation as a primitive.** Claude Code's `.claude/agents/*.md` with `tools:` frontmatter gives genuinely starved contexts. Under `copilot -p --agent`, custom agents exist (`.github/agents/*.agent.md`) but the isolation guarantee is weaker and unverified by me. Maker/checker separation degrades from "structurally enforced" to "separate process, separate brief, artifacts-only input". That is still meaningfully better than nothing (Pombal et al. show self-preference bias persists at >50% even with entirely objective, programmatically verifiable rubrics, https://arxiv.org/abs/2604.06996, so a separate *process* is the floor), but it is not the same guarantee.
- **`permissionDecision: "ask"` routing to a real human prompt.** Copilot Cloud Agent treats `ask` as `deny` (no user present). For a read-only loop this is nearly free, which is a further argument for making read-only a capability boundary rather than a prompt law.
- **Parallel fan-out ergonomics.** `parallel()` is a Claude Code Workflow primitive. Under the protocol, MAP's harvest fan-out becomes N sequential `snbrain next` / `ingest` cycles, or N shell-parallel harness invocations that the operator or a wrapper script launches. Slower on Copilot. Acceptable for a once-per-engagement pass.
- **Latency and ceremony.** Every stage boundary becomes a file write plus a CLI call. On a 6-stage MAP that is noise; on a 6-iteration VERIFY loop it is also noise because the loop is dominated by API calls.

### 5.4 The Copilot evidence is doc-sourced, and this plan holds itself to a lower standard than it holds ServiceNow

This is the plan's own worst epistemic inconsistency and it must be fixed before the operator commits money to phase 4.

Section 5.1 corrects the input briefs using vendor documentation, and the correction is load-bearing: "Copilot has hooks" is the reason the plan keeps five hooks in scope rather than relocating enforcement into the CLI. But `playbooks/01-audit.md:9-27` is the product's own doctrine, and it says: query, never trust docs; API silence is not proof; unverified is a first-class status. `wiki-scaffold/agent-api.md` exists specifically because vendor documentation was wrong about this platform. Every ServiceNow claim in this plan is stamped "verified by reading or executing the file cited". **Every Copilot claim in this plan is a documentation read.** Not one line of Copilot was executed. That asymmetry is exactly the failure the framework was built to prevent, pointed at a different vendor.

Concretely unverified, all in section 5.1 and 5.3:

| Claim | Status | If it is wrong |
|---|---|---|
| 14 lifecycle hook events exist, configured at `.github/hooks/*.json` | Doc-read only | The hooks layer does not port and T1's cost is not near zero |
| `preToolUse` is fail-closed, denial via exit 2 or `permissionDecision: "deny"` | Doc-read only | B8's fix does not exist on Copilot. **Revision 2: there is no credential to fall back on** (C1 deleted it), so enforcement rests entirely on the adapter having no write verbs plus the four capability gates, and FR2 becomes load-bearing rather than nice-to-have (6.9) |
| Hooks work in both Copilot CLI and Copilot Cloud Agent | Doc-read only | Phase 4's deliverable is smaller or impossible |
| No JSON output mode on `copilot -p` | Doc-read only | The file-handoff protocol (5.1) may be unnecessary ceremony, though it is cheap insurance and should be kept regardless |
| `.github/agents/*.agent.md` isolation is "weaker and unverified by me" | Explicitly unverified, correctly flagged | Maker/checker separation on Copilot is unproven, which weakens the strongest guarantee in the whole design |
| Copilot Cloud Agent treats `ask` as `deny` | Doc-read only | Either safer or more permissive than assumed. Both matter. |

**Required work package, and it gates the phase-4 estimate, not phase 4 itself.** `spikes/copilot-capability/`, half a day, in phase 1: install Copilot CLI, run one `copilot -p` invocation, install one trivial `preToolUse` hook that exits 2, and record whether the tool call was actually denied; run one `--agent` invocation and record what it can see; record the exact CLI version and date in `spikes/copilot-capability/RESULTS.md`. **Kill criterion, written before the spike runs:** if `preToolUse` denial does not fire, hooks leave the portability scope entirely, enforcement moves entirely to the CLI and the adapter, and section 5.2's tier table is re-costed before phase 4 is scheduled. This is the same "positive and negative canary" procedure `playbooks/03-enforce.md:27-46` already demands of every new ServiceNow check. Apply it to Copilot.

### 5.5 Is the trade worth it?

For T1 and T2: unambiguously yes, and they are cheap. For T3: yes **conditionally**, and the condition is that we do not pretend it is free. My recommendation is to build T3 but to stage it: ship the protocol with a Claude Code shim first, prove the loop works, then add the Copilot shim and measure. The Copilot shim is one rendered file plus a hooks config, so it is a small increment once the protocol exists. What I would refuse to build is a Node process that owns model dispatch, retry, and prompt composition end to end: that is the design that destroys the dynamic frontier, and nothing in the evidence requires it.

---

## 6. READ PATH: sn-scriptsync-native, decided by product strategy

> **Replaces old section 6 in full** (the ServiceNow REST Table API recommendation, the OAuth read-only integration user, the minimum-privilege ACL request list, the privilege-parity guard, the adapter-equivalence spike, the licence blocker). Withdrawn per C1. What survives from old 6.4 unchanged: the canary rule, field validation, A/B negation, `sys_updated_on` watermarks, instance stamping, domain-separation detection, the rate budget, and the cold-path offline fallback. 6.10 names exactly what is deleted.

### 6.0 The frame, and one thing revision 2 got wrong before the red team caught it

The transport is **not benchmarked, it is decided**. The orchestrator is being built for the SN Utils product line, so sn-scriptsync is the substrate and every gap in it is a feature request to a collaborator rather than a reason to switch. That is a strategy decision and section 6 implements it.

The technical case is strong anyway, and it is no longer a documentation read. **The installed extension's compiled source is on disk and was read for this revision**, at `<home>/.vscode/extensions/arnoudkooicom.sn-scriptsync-4.7.6/out/agent/`. Every load-bearing claim below cites it. That moves most of this section from "the vendor doc says" to "the code the operator is running says", which is the standard `playbooks/01-audit.md:9-27` demands and which revision 1 failed to meet for Copilot (5.4).

**And the correction that matters most.** An earlier draft of this section argued that the silent-failure guards are a *question-precision* mechanism: a silently-unfiltered read manufactures a fabricated anomaly, which becomes a question, which wastes the SME's time. That argument is wrong on its own arithmetic. A fabricated anomaly and a true-but-trivial anomaly cost exactly the same one wasted question, and on a configuration platform trivial-true outnumbers fabricated by orders of magnitude (9.7 item 3: "on a brownfield instance, dead config is the norm, not the anomaly"). **The guard layer buys claim precision.** That is where its 29% of the MAP budget is genuinely earned and that is the argument to put in front of the operator. Question precision is bought by the question engine in 4.9, which is a different mechanism and did not exist in revision 1.

### 6.1 The verdict

**A two-rung sn-scriptsync-native read path. Both rungs are SN Utils commands. No new credential, no new network path, no new account for a security team to approve.**

| Rung | Command | Used for | Why |
|---|---|---|---|
| **R1, typed** | `query_records`, `get_record`, `get_table_metadata`, `list_instances`, `get_capabilities`, `check_connection` | Small known-shape reads: single records, canaries, watermarks, instance identity | Stable, documented, already exercised in production by `.claude/loop/lib/api.js:164-173` and `gate.js:125,128,151` |
| **R2, controlled sweep** | `rest_request` with `method: "GET"` | Every read where paging, row-count honesty, display-value pinning or a wide field allowlist is load-bearing | GET is **ungated by design**, verified in vendor source |

**The finding this rests on, and it is verified in code, not documentation.** `out/agent/commands/rest.js` contains exactly two gate checks: `:29` (`method === 'DELETE' && !getSetting('deleteRecords.enabled', false)`) and `:32` (`(method === 'POST' || method === 'PUT' || method === 'PATCH') && !getSetting('restRequest.enabled', false)`). GET falls through with no check whatsoever, and the command's own doc string says so in the vendor's words: "GET is always allowed; write methods are gated by settings" (`rest.js:12`). Endpoint validation at `:20` is only `typeof endpoint === 'string' && endpoint.startsWith('/')`, so there is **no path allowlist** and both `/api/now/table/*` and `/api/now/stats/*` are permitted. Corroborated in the vendor docs at `snu-agent-api/SKILL.md:1272-1275` and `agentinstructions.md:321-322`.

**And the load-bearing corroboration revision 2 missed, which materially de-risks U11.** `rest_request` does not have its own HTTP client: it calls `_shared.restRequest(ctx, instanceSettings, {endpoint, method, queryParams})` (`rest.js:36-42`). **That is the same function `readBackRecord` calls** (`_shared.js:112-117`), and `readBackRecord` is what `get_record` runs on (`records.js:306`), passing `sysparm_display_value` and `sysparm_fields` as `queryParams` against `/api/now/table/{table}/{sysId}`. So the exact browser-hop code path R2 depends on, **including arbitrary query-parameter passthrough on a GET to `/api/now/table/*`**, is already exercised in production every time any consumer calls `get_record`. What remains genuinely unproven for R2 is narrower than "does the passthrough work": it is whether the relay forwards `sysparm_offset` (U13), whether it accepts a non-`/api/now/table` prefix such as `/api/now/stats` (U12), and the response-size ceiling (U14). WP-A probes 1 to 3 and 5 test exactly those and nothing more.

**What that buys, all of which the withdrawn OAuth recommendation could only get from a separate client:**

- `sysparm_offset` plus `sysparm_limit`: real deterministic paging, which `query_records` does not have (FR1)
- `sysparm_display_value=false`: kills the non-English-session masking class (`gotchas.md:72-77`)
- `sysparm_exclude_reference_link=true`: reference fields as plain sys_ids instead of `{link,value}` objects, which is what `lib/api.js:151-162` currently flattens by hand
- `sysparm_fields`: a strict field allowlist, so a `sys_script` sweep never drags 400 KB of script bodies through the WebSocket relay
- `/api/now/stats/{table}?sysparm_count=true`: the honest denominator 9.6 item 2 demands, without enumerating rows

**And what it deletes.** The read runs as the consultant's own already-authenticated browser session. Same user, same roles, same ACLs, same domain as the browser the consultant is looking at. Therefore the **privilege-parity check** that old 6.4 called "the price of the 6.1 recommendation and the earlier draft did not name it" **has no referent and is deleted as a phase-2 deliverable.** It was a cost the OAuth recommendation introduced. Removing the recommendation removes the cost. This is the single strongest technical argument for the corrected position and it should be stated to the operator in exactly these terms.

**Two further arguments for R2 over R1 that emerged only from reading the source:**

- **R1 corrupts filters containing reserved characters.** `out/agent/commands/query.js:35,37` builds the request by raw string concatenation: `sysparm_fields=${fields}&sysparm_limit=${limit}` then `+= &sysparm_query=${encodedQuery}`. No encoding anywhere. Any `&`, `=`, `#`, `+` or `%` inside an encoded-query **value** is injected verbatim and re-parsed as a parameter delimiter, so `nameLIKEA&B` silently becomes `sysparm_query=nameLIKEA` plus a junk parameter, returning a clean 200 with the wrong filter. Field-name validation (G1) does not catch this because the field name is fine. R2 does not have the defect: `_shared.js` passes `queryParams` to the browser as a structured object.
- **R1 is not collision-hardened.** `query.js:46` builds its correlation id as a bare `agent_${ctx.request.id}`, while `_shared.js:34-37` uniquifies (`agent_${id}_${Date.now()}_${restSeq}`). See 6.7 item 3 for why that matters under fan-out.

**Keep from old 6.2, unchanged in substance:** ServiceNow's official MCP Server is still the wrong tool for discovery. It is licence-gated into Now Assist and AI Native SKUs, and its console exposes only Now Assist Skills, Knowledge Graph, Scripted REST APIs and synchronous Subflows/Actions, with no generic table read. Discovering `sys_script`, `sys_ui_policy` and `sys_security_acl` through it would require **building Scripted REST APIs on the customer instance first**, which violates the read-only law on day zero. Expect it to be pitched, have the answer ready.

### 6.2 What the API exposes, read path only

Three evidence tiers, because they carry different weight and revision 1's single "verified" label hid the difference:

- **[SRC]** verified in the installed extension's compiled source, build 4.7.6, protocol 6. The operator can re-check every one of these on his own machine.
- **[DOC]** asserted only by `agentinstructions.md` or `snu-agent-api/SKILL.md`.
- **[OPAQUE]** everything after `ctx.sendToBrowser(...)`. That runs in the SN Utils Chrome extension, whose source is not public. **Unverifiable by inspection at any effort level.** Only measurement or the developer can settle it.

| Capability | Status | Evidence |
|---|---|---|
| Ungated GET passthrough, arbitrary query params, no endpoint allowlist | **[SRC] CONFIRMED** | `commands/rest.js:20,29,32` |
| Arbitrary encoded query on any table | [SRC] + production use | `commands/query.js` has no table restriction; `gate.js:125,151` calls it live |
| Single record by sys_id, **display-value pinned already** | **[SRC] CONFIRMED** | `commands/records.js` `get_record` is built on `_shared.js` `readBackRecord`, which sets `sysparm_display_value: 'false'` unconditionally at `_shared.js:108`. **So `get_record` needs no R2 re-verification.** Vendor precedent for G6. |
| Capability and gate preflight | [DOC] | `SKILL.md:339-400`; `gates` block at `:357-364` |
| Instance roster, URLs, freshness | [DOC] | `SKILL.md:402-438`. The vendor's own example roster at `:428-430` lists `ven08329` and `devinst01`, corroborating C4's instance identification. |
| Live command discovery | [DOC] | `health.commands[]`. **Do not hard-code the command list.** |
| Browser helper tab mandatory for every read | **[SRC] CONFIRMED** | `dispatcher.js:49-54` enforces `requiresBrowser` and returns `E_SERVER_NOT_RUNNING` or `E_BROWSER_DISCONNECTED`. Only `list_instances`, `check_connection`, `get_sync_status` and the filesystem helpers are browser-free. **Headless and CI operation are architecturally out of reach.** |
| Round-trip deadline | **[SRC] 60 seconds** | `runtime.js:24` `DEFAULT_BROWSER_TIMEOUT_MS = 60000`; reads call `waitForBrowserResponse` with no override |
| Request body cap | **[SRC] 10 MB** | `transport/http.js:11` `MAX_BODY_BYTES = 10 * 1024 * 1024`. This is the **request** cap. There is no response cap in the HTTP layer. |
| **Paging / cursor on `query_records`** | **[SRC] KNOWN-MISSING** | `query.js` emits only `sysparm_fields`, `sysparm_limit`, `sysparm_query`. `sysparm_offset` appears nowhere. `gate.js:146-156` says so in a code comment: "The agent API has no cursor; page by widening the limit and de-duplicating." FR1. |
| **`query_records` limit ceiling** | **[SRC] RESOLVED: none imposed by the extension** | `query.js:35` computes `limit = params?.limit || 10`. Only ServiceNow imposes a ceiling. **Trap: `limit: 0` coerces to 10.** Revision 1 left this open; it is now closed. |
| **Truncation signal** | **[SRC] KNOWN-MISSING, and worse than documented** | The returned `count` is `response?.count ?? (response?.records?.length || 0)`. It is the **returned-row count**, never a table total, and it silently degrades to `records.length`. Never source a count or absence claim from it. FR4. |
| **Response headers** | **[SRC] STRUCTURALLY UNREACHABLE** | `_shared.js:62` returns `{ status: response.status, data: response.data }` and nothing else. There is no headers field anywhere in the chain. **So `X-Total-Count` and ServiceNow's `Link: rel="next"` paging headers cannot be read through this transport at all.** New FR. |
| **HTTP status arrives as data, not as an error** | **[SRC] CONFIRMED** | `_shared.js` throws only when `!response || response.success === false`. A non-2xx that the browser reports as a successful round trip returns as a normal result. **The adapter must assert `status === 200` itself.** |
| **Error codes are partly inferred from message text** | **[SRC] CONFIRMED** | `codeForRest` maps 404/409/401/403 then falls through to `inferCodeFromMessage`, which substring-sniffs for 'acl', 'auth', 'token', 'browser', 'timeout' and defaults to `E_INTERNAL`. **Treat E_ codes as hints, not contracts.** Also: `E_SECURITY` exists in `errors.js` and is **undocumented** in `SKILL.md:109-121`. |
| **Aggregate count as a typed command** | **[SRC] KNOWN-MISSING** | No `count_records` in the command set. `run_background_script` (the only GlideAggregate path) is gated off by default. Reachable via R2 `/api/now/stats`, which the extension does not block. FR7. |
| **Encoded-query validity feedback** | KNOWN-MISSING | Nothing in the error table covers a dropped clause; the platform returns clean unfiltered rows. `the pilot customer/engagement-docs/Docs/wiki/agent-api.md:47-49`. FR5. |
| **Instance echo on the response** | KNOWN-MISSING | The instance is an input, never an output. FR3. |
| Display-value / reference-link control on `query_records` | **[SRC] KNOWN-MISSING on R1**, available on R2 | `query.js` sets none of them; `lib/api.js:151-162` exists purely to clean up the resulting `{link,value}` objects. FR6. |
| Inherited columns in `get_table_metadata` | **[OPAQUE]** | `records.js:387-409` does no computation: it sends `requestTableStructure` to the browser and returns `{ columns: response?.result?.columns \|\| response?.result }` (`:408`). Note the fallback: when the browser omits `columns`, the caller silently receives the whole result object instead of a column list, so a shape check is mandatory on any consumer. The logic is closed source. G1 sidesteps it entirely. |
| Relay response payload ceiling | **[OPAQUE]** | The one genuine unknown on payload size. FR9. |
| Concurrency below the HTTP hop | **[OPAQUE]** | 6.7. The VS Code side is now [SRC]-resolved; the browser hop is not. |

**Two version numbers, and the vendor labels both `apiVersion`.** Agent API **protocol** version is **6** (`portFile.js:18` `AGENT_API_VERSION = 6`, matching `.vscode/sn-agent-port.json`). Agent-instructions and skills **doc** version is **17** (emitted as `<!-- SN-SCRIPTSYNC:SKILL apiVersion=17 -->`). Both are current for build 4.7.6. Name them explicitly in every artifact or a reader will conclude the install is eleven versions behind. Record `extension 4.7.6 / protocol 6 / skills 17` in every run's state. And **do not cite `snutils.com/docs/guide/scriptsync/ai-agent-support`**: it was last updated 2026-01-24, which predates `code_search` (protocol 5) and `get_capabilities` (protocol 6), and it is stale.

**Vendor-versus-project disagreement, corrected in revision 2.** Revision 1 and the first revision-2 draft both claimed `check_connection` "lies", citing `wiki/agent-api.md:47-49`. **That citation does not support the claim** (it is about reads returning empty, and never mentions `check_connection`), and `audit-phase0-findings.md:217` records the opposite: `check_connection -> ready:true` while the reads worked. Withdraw the claim as stated. **The provable version is stronger.** `commands/connection.js:15` declares `check_connection` with `noInstance: true`, and `:23` computes `browserConnected = serverRunning && ctx.hasBrowserClient()`. It **discards the instance parameter entirely** and reports whether *any* WebSocket client is attached, saying nothing about whether the target instance has an authenticated session. The vendor documents the same twice (`SKILL.md:415-416,444-446`: "connected is bridge-level, not per-instance"). **Consequence for the port:** `assertInstanceReady` at `lib/api.js:127-137` does not do what its name and its own comment claim. Rename it **`assertBridgeLive`**, and G2a becomes mandatory rather than defensive.

### 6.3 The transport adapter

**Path: `C:/Werk/sn-agent-contextualization-framework/tools/snbrain/read/scriptsync.js`.** The product `tools/` directory today holds only `render-kernel.js`.

Two interface laws, both derived from the failure classes above:

- **`read()` never returns a bare array.** It returns a `ReadResult` whose zero-row case carries a *verdict*, and the verdict is never `absent` unless a guard proved connectivity at that table in the same batch.
- **The adapter has no write verbs.** Not disabled, absent. `create_artifact`, `update_record*`, `delete_*`, `add_column`, `create_table`, `create_application`, `run_background_script`, `switch_context` and non-GET `rest_request` are not importable from this module.

```js
// tools/snbrain/read/scriptsync.js  (CommonJS, zero dependencies, Node >= 18)
// Every call in this module is a READ and is therefore idempotent.
// That is the ONLY reason the retry layer is safe. Do not add a write verb behind it.

/**
 * @typedef {Object} ReadResult
 * @property {Array<Object>} rows          flattened, reference fields as plain sys_ids
 * @property {number} rowCount
 * @property {'complete'|'truncated'|'budget-capped'} completeness
 * @property {number} pages
 * @property {'absent'|'blocked'|'unfiltered-risk'|null} zeroRowVerdict   null when rowCount > 0
 * @property {Object} provenance
 * @property {string} provenance.instance          // 'devinst01'
 * @property {string} provenance.instanceUrl
 * @property {string} provenance.instanceTier      // 'vendor-dev' | 'dev' | 'test' | 'prod'
 * @property {number} provenance.httpStatus        // R2 only. MUST be 200 or the read is rejected.
 * @property {string} provenance.table
 * @property {string} provenance.queryIssued       // exact encoded query AFTER validation
 * @property {string} provenance.fieldsIssued
 * @property {'rest_request'|'query_records'} provenance.transport
 * @property {string} provenance.capturedAt        // ISO 8601 UTC
 * @property {string} provenance.tableWatermark    // max sys_updated_on at run start, UTC
 * @property {string} provenance.runId
 * @property {string} provenance.extensionBuild    // '4.7.6', protocol 6, skills 17
 * @property {Object} guards
 * @property {'validated'|'skipped-no-filter'|'dot-walk-flagged'|'rerouted-to-R2'} guards.fields
 * @property {string[]} guards.dotWalkRisks
 * @property {'pass'|'not-run'} guards.identityCanary
 * @property {'pass'|'fail'|'not-needed'} guards.tableCanary
 * @property {'issued'|'not-derivable'|'budget-suppressed'|'not-needed'} guards.negationControl
 * @property {boolean} guards.displayValuePinned
 * @property {Object} cost   // { apiCalls, ms, bytesIn }
 */

/**
 * @typedef {Object} Session
 * @property {(table, opts: QueryOpts)              => Promise<ReadResult>} read
 * @property {(table, sysIds: string[], fields)     => Promise<ReadResult>} batchRead
 * @property {(table)                               => Promise<FieldSet>}   dictionary
 * @property {(table, encodedQuery)                 => Promise<Validation>} validateQuery
 * @property {(table)                               => Promise<number>}     count
 * @property {(table)                               => Promise<string>}     watermark
 * @property {()                                    => Promise<void>}       assertLive
 * @property {()                                    => BudgetState}         budget
 * @property {()                                    => Promise<CostLedger>} close
 * @property {Object} identity      // { instance, instanceUrl, instanceTier, user, roles, domain, scope }
 * @property {Object} capabilities  // get_capabilities result + health.commands[]
 */

/**
 * @typedef {Object} QueryOpts
 * @property {string}   [query]     encoded query; validated before issue
 * @property {string[]}  fields     REQUIRED. No implicit SELECT *.
 * @property {number}   [limit]
 * @property {string}   [orderBy]   default 'ORDERBYsys_id'; deterministic paging needs it
 * @property {number}   [pageSize]
 * @property {boolean}  [absenceIsAClaim=false]   true ⇒ zero rows will be written as a claim,
 *                                                so the negation control is mandatory (G3)
 * @property {'R1'|'R2'|'auto'} [rung='auto']
 */

async function connect(opts) {}
// opts: { instance, instanceTier, repoRoot, runId, concurrency, budget, config }
// Sequence. Every failure throws with an actionable message and ZERO reads issued:
//   1. loadPort(repoRoot)                    [PORTED verbatim]
//   2. health(portInfo)                      [PORTED + apiVersion allowlist + commands[] capture]
//   3. assertReadOnly(portInfo)              [NEW]
//   4. acquireWorkspaceLock()                [NEW, 6.7]
//   5. list_instances → resolve url          [NEW]
//   6. assertInstanceIdentity()              [NEW]
//   7. assertBridgeLive()                    [PORTED, RENAMED from assertInstanceReady]
//   8. prime dictionary cache for config.read.canaryTable   [NEW]

async function assertReadOnly(portInfo) {}
// get_capabilities. Hard-fails the run unless ALL FOUR permission gates are false:
//   restRequest, deleteRecords, backgroundScripts, AND createArtifacts.
// createArtifacts is a settable boolean (sn-scriptsync.createArtifacts.enabled), so it can be
// REQUIRED false, not merely recorded. Revision 1 and the first revision-2 draft both got this wrong.
// Even with all four off, update_record and update_record_batch remain reachable (6.9). The run
// therefore stamps state.readOnlyEnforcement = 'partial' until FR2 lands, and the report says so.

async function assertInstanceIdentity(portInfo, expectedInstance, expectedUrl) {}
// R2: GET /api/now/table/sys_properties
//     ?sysparm_query=name=instance_name&sysparm_fields=value&sysparm_limit=1
// Mismatch ⇒ throw. Fallback when sys_properties is ACL-restricted: read sys_user for the
// current user, which proves a live authenticated session but NOT which instance. In that case
// identity degrades to 'asserted-not-proven' and every claim is stamped accordingly. FR3.
```

**What ports from `.claude/loop/lib/api.js`: roughly 60% of the module's 191 lines,** and it is the hard-won 60%. (An earlier draft said 40%; the seven functions below total about 118 lines. Correcting downward-biased numbers matters in a document a domain expert spot-checks.)

| Function | Source | Note |
|---|---|---|
| `ApiError` | `lib/api.js:20-26` | Extend: promote `detail.code` to a first-class `err.code`. Today the E_ code is reachable only via `err.detail.code` (`:145`) and **nothing branches on it**, so `E_BROWSER_DISCONNECTED` (terminal) is handled identically to `E_NOT_FOUND` (a real answer). Add `E_SECURITY`. Remember the codes are partly message-sniffed (6.2), so nothing load-bearing may branch on the code alone. |
| `loadPort` | `:29-62` | The stale-PID check at `:53-59` is the best line of defence in the file. Keep the error text. |
| `isPidAlive` | `:64-71` | Verbatim, including the `EPERM` case. |
| `request` | `:73-102` | Verbatim shape. **Add explicit `id` plus correlation assertion, with the collision fix in 6.7 item 3.** |
| `health` | `:105-120` | Verbatim, plus an `apiVersion` allowlist from config rather than only comparing to the port file. |
| `assertInstanceReady` → **`assertBridgeLive`** | `:127-137` | Verbatim body, corrected name and corrected doc comment (6.2). It is a bridge-liveness precondition, never a canary. |
| `flattenRefs` | `:151-162` | Keep for R1. Unnecessary on R2. |

**Must be new:** the R2 GET client with `sysparm_offset` paging; the dictionary cache with parent-hierarchy walk (G1); the encoded-query field validator including dot-walk and reserved-character analysis (G1, G1b); identity and table canaries (G2); the A/B negation control with an explicit negation-derivability test (G3); per-table watermarks (G4); instance identity stamping (G5); the concurrency limiter and cross-process workspace lock (6.7); retry with jittered backoff on a corrected error subset (6.11); budget accounting; and the cost ledger persisted on `close()`.

**Explicitly not ported:** `gate.js:146-156` `fetchRows`. It is honest about its own limitation and carries dead locals (`void offset; void PAGE`). R2 paging replaces it. The `sys_update_xml` corpus-loader **shape** still ports; only the paging mechanism changes.

### 6.4 The guard layer

Each guard states its implementation and its **marginal API cost**, because guards consume the same budget as the reads. **They are justified on claim precision** (6.0).

**G1. Dictionary validation before every filtered query.** Prevents: an invalid field in an encoded query drops the clause and returns *unfiltered* rows (`gotchas.md:56-63`, section 2.1; live-confirmed at the pilot customer, `audit-phase0-findings.md:219`, which is the **2.1 mechanism applied to a dot-walked path**, not the 2.2 mechanism revision 2's first draft attributed it to). Do **not** use `get_table_metadata`: it is the one metadata path that is entirely browser-side and therefore both undocumented on inheritance and unauditable (`records.js:387-409`, return at `:408`). And `snu-reference/SKILL.md:34-41` tells agents to read a cached `structure.json` instead of calling the API at all, which is a staleness trap SN Utils will keep writing into the workspace regardless. Build the field set from primary sources instead: walk `sys_db_object.super_class` to the root, then union columns via one R2 read of `sys_dictionary` with `nameIN<t1..tn>`. Cache per instance plus apiVersion, in memory for the run and on disk at `.brain/cache/dict/`. Validator splits on `^`, `^OR`, `^NQ`, extracts left operands, strips `ORDERBY*`, skips `javascript:` right-hand sides, and for a dotted path resolves each segment's reference table in turn. **Additionally flag** the case where the final segment exists on a *child* of the referenced table but not on the referenced table itself: that is `gotchas.md:64-71` (section 2.2) exactly, and a flagged clause downgrades any zero-row result to `unfiltered-risk` and forces G3. Invalid field means **throw before issuing**, with a Levenshtein `nearest` in the message. **Cost: 2 to 4 calls per hierarchy, once per run, disk-cached across runs. Amortised 0 per query. About 120 calls of 2,000 on a 40-table sweep, 6%.**

**G1b. Value sanitisation. NEW, and it is source-evidenced.** R1 concatenates raw (`query.js:35,37`). Refuse any R1 encoded query whose *values* contain `& = # + %` and route it to R2 instead. G1 validates names; only G1b covers values. **Cost: 0 calls.**

**G2. Two canaries, answering different questions.** Prevents: a dead helper tab, an expired session or a wrong-instance read returning `count: 0` as success. **Zero rows must never be read as `absent` on an unproven connection.** *G2a, identity canary, once per batch:* re-issue `assertInstanceIdentity`. One call proves three things at once (transport live, session authenticated, right instance), which is why it costs 1 and not 2. Failure means terminal `blocked` for the batch, never `absent`. Given 6.2's correction that `check_connection` is bridge-level, **G2a is the only thing that proves instance reachability at all**. *G2b, table canary, only on a zero-row result:* re-issue with no filter and `limit: 1`. Rows means the zero is about the filter; zero again means compare with G8's count, because a genuinely empty table is a legitimate finding on a vendor dev instance while an unreachable one is `blocked`. **Cost: 1 per batch (about 5%), plus 1 per zero-row result, which is self-limiting.**

**G3. A/B negation control, with the construction specified.** Prevents a filter that appears to work but is semantically dead, and `gotchas.md:174-190` (5.7): every `!=` silently includes the empty-value population, so `type!=special` matches records where `type` is empty. **The framework already mandates this procedure:** `playbooks/01-audit.md:17-19` says "A/B-test every filter you rely on (run it, then run its negation; if both return everything, the field is bogus)". G3 mechanizes an existing law rather than inventing one, which is the easier sell for its budget.

The first draft of this guard specified `rows(Q) + rows(¬Q) === count(table_scoped)` and **never said how ¬Q is constructed**. That is a real hole with a one-directional failure: negation across `^` / `^OR` / `^NQ` needs De Morgan, `^NQ` makes it non-obvious, a malformed ¬Q drops a clause and returns unfiltered rows, reconciliation fails, and the claim is emitted `unverifiable: no-oracle`, which **discards the anomaly**. That fails safe for claim precision and fails dangerous for question precision, because the suppressed class is exactly Q10's (a filter matching zero rows) which is one of only two question classes this engine can generate on a doc-less instance. So: **restrict G3 to queries whose negation is mechanically derivable** (single clause, or conjunctions of equality predicates). For anything else use G8 count reconciliation instead of a constructed negation. Reconcile against **counts** (G8), never enumerated rows, or a budget-capped read silently fails reconciliation and emits a false `unverifiable`. For a negative predicate, additionally issue the explicit empty-population variant (`type!=special^typeISNOTEMPTY`), because the difference between the two counts *is* the finding. **Every G3-suppressed and budget-suppressed candidate is written to `.brain/state/<run-id>.json` as a named `suppressed-candidates` array and its count reported in the run summary.** That array is the only free recall-shaped signal in the design and revision 1 threw it away. **Cost: 1 to 2 extra calls on qualifying queries. Budget 15% of MAP calls and cap it; at the cap, remaining absence claims are emitted `unverifiable`, not guessed.**

**G4. `sys_updated_on` watermark at run start.** Revision 1 called this "the hardest unsolved problem in the rework and nobody named it". Without it, a finding present in iteration 2 and absent in iteration 1 is indistinguishable from someone deploying mid-run. Not hypothetical: `OHSStateTransitionUtil` was modified on the the pilot customer audit day (`audit-phase0-findings.md:119`), and on devinst01 the risk is **higher**, because the developer actively develops on it. Implementation: one R2 read per table at run start with `ORDERBYDESCsys_updated_on`, `limit 1`, `sysparm_display_value=false`. Every captured row carries its own `sys_updated_on`. At VERIFY, a row updated after the run-start watermark is `changed-in-flight`, not `drifted`. Two watermarks bracket the run and the delta is the run's own uncertainty band. **Timezone is load-bearing:** `sys_updated_on` returns in the session's display timezone unless display values are off, so the adapter refuses to compare two timestamps whose `displayValuePinned` flags differ. **Cost: 1 per table per run (about 2%), plus 1 per table at close.**

**G5. Instance identity stamped on every claim.** Cross-instance reads fail silently (`audit-phase0-findings.md:222`) and a map of a vendor dev instance will be read as a map of something else within a week. `instance`, `instanceUrl`, `instanceTier` and `runId` are required on every `ReadResult` and copied into every claim. The renderer refuses a page whose claims mix instances. On this PoC `instanceTier` is the literal string `vendor-dev` and the deliverable's front page says what that means. Honest limitation: the API does not echo the instance (FR3), so identity is **asserted by the caller and corroborated by G2a**, never returned by the transport. Stamp claims `identity: corroborated-by-canary`, not `identity: proven`. **Cost: 0, fused into G2a.**

**G6. Display-value and reference-link pinning.** `sysparm_display_value=false` and `sysparm_exclude_reference_link=true` on every R2 read. **Refined in revision 2:** `get_record` is already pinned by the vendor (`_shared.js:108`) and needs no R2 re-verification; only `query_records` results need it. That removes an entire class of round-trips from the per-claim read path. The vendor pinning display values explicitly everywhere he controls the call is itself strong corroboration that the default is not trustworthy. **Cost: 0 calls. Two query parameters, and it closes `gotchas.md:72-77` permanently.**

**G7. Deterministic paging with a truncation verdict.** R2 only. `sysparm_offset` stepping by `pageSize`, always with `ORDERBYsys_id` appended (any other order can shift rows between pages under concurrent writes). Stop when a page returns fewer than `pageSize`. `completeness` is `complete` only then; `budget-capped` if the row budget binds first; `truncated` if R1 was used and returned exactly `limit`. **A `truncated` result may not back a claim about a count or an absence.** Never source completeness from `result.count`, which is the returned-row count and degrades to `records.length` (6.2). **Cost: ceil(rows / pageSize), which is the irreducible cost of reading the rows.** Default `pageSize` 100; `widePageSize` 25 for `sys_script`, `sys_update_xml`, `sp_widget`, `sys_ui_page`, because the relay's response ceiling is [OPAQUE].

**G8. Inventory counts.** `/api/now/stats/{table}?sysparm_count=true&sysparm_query=<validated>` via R2, 1 call, no rows transferred. This is 9.6 item 2's denominator ("4,000 `sys_ui_policy` rows produced 12 claims") and it is what makes G2b's "genuinely empty table" verdict possible. The extension imposes no endpoint restriction, so only the browser hop could block it. **Fallback if it does: enumerate-and-count with a row budget, stamped "counted only what we enumerated". There is no third rung.** The `X-Total-Count` header fallback that an earlier draft proposed is **structurally impossible** and is deleted: `_shared.js:62` returns `{status, data}` and no headers exist anywhere in the chain. **Cost: 1 per table per scope.**

**Guard budget, stated twice on purpose.**

- **For this PoC: irrelevant. Run every guard, always.** devinst01 has no brownfield scale (C4b) and the binding constraint is the developer's attention, not API calls. Presenting a 29% trade-off here would import a cost model from the scenario the PoC explicitly excludes, and invite trading away guards to buy calls nobody needs. **The PoC's real budget is the number of questions put to the developer, capped at N, with the anomaly-to-question ratio reported alongside.**
- **As an untested brownfield projection:** on a 40-table, 2,000-call sweep, G1 about 120, G2a about 100, G2b about 40, G3 about 200 (capped), G4 about 80, G8 about 40. **Total about 580 calls, 29%.** Labelled a projection because nothing has measured it.

### 6.5 Read coverage

R1 accepts any table and R2 is a generic Table API passthrough, so coverage is not gated per table by the transport. The real constraints are the browser user's ACLs, whether the data exists on a vendor dev instance, and guard cost. Old 6.3's table list survives as the **scope** list; the confidence column is what changes.

| Family | Tables | Honest confidence |
|---|---|---|
| Core and scope | `sys_scope`, `sys_app`, `sys_metadata`, `sys_db_object`, `sys_dictionary`, `sys_choice` | **CONFIRMED-mechanism.** `sys_dictionary` is read by G1 on every run, so it is self-testing. Vendor's own `sys_scope` read example is at `SKILL.md:1893` (and `:1119`); an earlier draft cited `:254`, which is a bash comment in a polling example and is wrong. |
| Provenance | `sys_update_set`, `sys_update_xml`, `sys_remote_update_set`, **plus the 6.9 ladder** | CONFIRMED-mechanism: `gate.js:151` reads `sys_update_xml` in production today. **Expect thin or empty data on devinst01** per C4b. `payload` is large; page at 25. |
| Server logic | `sys_script`, `sys_script_include`, `sysauto_script`, `sys_script_fix`, `sys_processor` | CONFIRMED-mechanism. Never read `script` in a sweep; read it per claim via `get_record`. |
| Flow and process automation | `sys_hub_flow`, `sys_hub_action_instance`, `sys_hub_flow_logic`, `sys_hub_sub_flow`, `sys_pd_*` | PROBABLE, and **untested by this project**. Flow definitions store logic in related records rather than a script field, so a naive row read under-represents behaviour. That is a modelling gap, not a transport gap. |
| Client and UX | `sys_script_client`, `sys_ui_policy(_action)`, `sys_ui_action`, `sys_ui_page`, `sp_widget`, `sys_ux_*` | CONFIRMED-mechanism for the classic tables, PROBABLE for `sys_ux_*`. Note `sys_ui_action.condition` truncates silently and still parses (`gotchas.md:91-99`), so a read of that field can look complete and be wrong. |
| Catalog | `sc_cat_item`, `item_option_new`, `io_set_item`, `sc_category` | PROBABLE. |
| Security | `sys_security_acl(_role)`, `sys_user_role`, `sys_user_group`, `sys_data_policy2` | PROBABLE, **with an ACL recursion caveat**: `sys_security_acl` is itself ACL-protected, so a partial read looks complete. G2b plus G8 detect a count mismatch; nothing detects field-level redaction. Mark every ACL claim `unverifiable: blocked-by-access` unless G8 reconciles. |
| Integration and comms | `sysevent_email_action`, `sys_rest_message*`, `sys_ws_operation/definition`, `sys_transform_map` | CONFIRMED-mechanism. `sysevent_email_action.name` truncates at 40 (`gotchas.md:85-90`), so do not key claims on the name. |
| SLA and testing | `contract_sla`, `task_sla` (definition side), `sys_atf_test(_step)` | PROBABLE. |
| Properties | `sys_properties` | **UNKNOWN-by-ACL.** Used by G5. On a vendor dev instance the session is almost certainly admin, so this is a portability concern, not a PoC concern. |
| Domain separation | `domain`, `sys_domain_path` | PROBABLE. **Old 6.4's domain guard survives unchanged:** a session in the wrong domain sees a silent subset. Detect at preflight; `count(domain) > 1` with no explicit domain decision is terminal `blocked`. |
| **Execution evidence** | flow contexts, `syslog`, transaction logs | **DELIBERATELY OUT OF SCOPE.** Different volumes, different privacy exposure, and 9.3 already says configuration state is not runtime behaviour. Do not let "map of your configuration" be heard as "map of what your instance does". |

**What was not confirmed, stated plainly:** nothing above was executed. No query has been issued against devinst01 from this environment. "CONFIRMED-mechanism" means the vendor doc describes it and, where marked, the pilot customer code calls it in production. The distinction between that and executed evidence is exactly the one 5.4 says this plan must stop blurring.

### 6.6 Provenance is a precondition, not a phase. The fallback ladder.

This is the finding that unifies the guard layer, the archaeology phase and the question engine, and neither repo addresses it. **Provenance data is what separates customer-authored configuration from ServiceNow's shipped defaults** (QG5, 3.3). Without it the question generator's universe defaults to OOTB records: maximally derivable, maximally worthless, and no SME has any decision history about them.

An earlier draft proposed a binary: update sets exist, or ARCHAEOLOGY is declared out of scope. That is a collapse honestly reported, not graceful degradation, and it costs 3 of the 5 instance-derived the pilot customer question classes (Q7, Q14b and Q15 all need a prior state). Every provenance table named anywhere in revision 1 was update-set-shaped. Replace with a **ladder, probed in full in WP-A for the cost of three extra queries**:

| Rung | Source | Recovers | Note |
|---|---|---|---|
| **R-a** | `sys_update_version` | **Prior values.** Per-save version snapshots carrying payload; this is what backs the platform's Versions related list and "Compare to Current". | The rung that recovers the Q15 and Q14b classes **without a doc corpus**. This project has already touched it: `the pilot customer/.claude/skills/workspace-activity-stream/SKILL.md:208` cites a specific `sys_update_version` sys_id as "the update version capturing the macroponent structure". Whether devinst01 holds multi-version history rather than single rows is a probe item, not an assertion. |
| **R-b** | `sys_metadata` `created_by` / `created_on` / `updated_by` / `updated_on` plus `sys_mod_count` | **Change episodes by author and time window.** "These 14 artifacts were created by one user inside 40 minutes." | Present on every metadata record on every instance. A complete mechanical substitute for update-set clustering, and it is exactly what QG2 needs. |
| **R-c** | `sys_metadata_delete` | **The GONE class.** | the pilot customer's audit finding f-20 was a flow documented as deactivated that had actually been deleted. Nothing else catches that. |
| **R-d** | `sys_app` / store-app version and upgrade history | Plugin and store provenance, clone recency. | Also answers 9.7 item 1's "how does this customer actually ship". |
| **R-e** | ~~`sys_customer_update`~~ **retired 2026-08-04** | — | **This rung never existed.** Added in revision 4 as "customer-authored versus shipped, independent of update sets", clone-resilient, and the scope filter's primary authorship source. `sys_customer_update` is not a table and not a column on `sys_metadata` on any release: it is the **label** of `sys_update_xml` ("Customer Update"), read off the UI and recorded as a name. So "independent of update sets" is exactly inverted — it **is** the update-set membership table, and a clone truncates it with `sys_update_set` (9.7 item 1) rather than surviving one. What revision 4 added here is 4.11's P1/P2 under an alias. **The real record-level rung is update-set membership, joined on the key the platform already provides: `sys_metadata.sys_update_name` IS `sys_update_xml.name`, with `sys_update_set` grouping those rows into the co-shipped cluster.** Clone-resilience therefore rests on R-d/A1 (package-level) alone. |

**This ladder is the same one as 4.11's P1 to P10, stated at transport level rather than signal level; 4.11 is authoritative where they differ.** **Only when R-a through R-e are all empty is archaeology genuinely dead,** and an instance where all four are empty has no customer-authored surface at all, which is itself the most important finding the PoC could produce. **Field evidence that this ladder pays, stated at its true strength:** TBD-038 at the pilot customer was moved from "doesn't recall" to "deliberate, by the developer, 2026-07-15 09:47:33, inside STRY0185005.00" by `sys_update_xml` plus `sys_audit`, after the human oracle had already failed. The rationale in that entry remains an explicit inference ("likely"), so the ladder buys **intent and attribution, not WHY** (4.10).

### 6.7 Concurrency

**Known, and now [SRC]-verified rather than operator-asserted.** C2 said many agents in one workspace share one connection and the limit is one connection per workspace. The VS Code layer supports it: `pendingRegistry.js` is a `Map<string, PendingEntry>` keyed by correlation id with per-entry timeouts and **no queue, no semaphore, no throttle and no serialization anywhere in `out/agent/`**. Requests are handled concurrently by Node's HTTP server and responses are matched by id. The one-connection-per-workspace limit also has a mechanical cause worth citing: the WebSocket helper-tab server binds a **fixed port 1978** while the HTTP agent server binds ephemerally, and `changelog.md` for 4.6.2 records the old failure mode in the vendor's own words ("kept port 1978 bound and made the next start silently fail; a port-in-use error is surfaced instead of failing quietly"). **So HARVEST x N stands, the constraint is operational scheduling, and a second workspace fails at bind time.**

**[OPAQUE], and not assumed:** everything after `ctx.sendToBrowser(...)`. Every ServiceNow-touching command funnels through **one browser helper tab over WebSocket**, and that tab's source is not public. Note also that the "parallel requests, multiple requests in-flight simultaneously" line at `SKILL.md:236-239` sits in the **file-transport benefits list**, not the HTTP section. It is not an HTTP concurrency guarantee and must not be quoted as one. The [SRC] evidence above is what supports C2; that line is not.

**Design, defensive by default.**

1. **Adapter-level limiter.** One in-process semaphore, `config.read.maxConcurrency`, **default 1** until measured, config-raisable to 3. Every read goes through it. The CLI never issues raw HTTP.
2. **Cross-process workspace mutex.** N agents means N Node processes. A lockfile at `.brain/locks/<instance>.lock` holding pid, startedAt and runId, with the same stale-PID rule as `lib/api.js:53-59`. Contention waits with jittered backoff to a bounded deadline, then terminal `blocked` naming the holding pid. **Never proceed unserialized.**
3. **Correlation ids: the design's own recommendation was the hazard, and `res.id === req.id` does not catch it.** `query.js:46` (and `get_table_metadata`, `check_name_exists_remote`, `get_parent_options`) use a **bare `agent_${ctx.request.id}`**, while `_shared.js:34-37` uniquifies. `pendingRegistry.js:20` does `pending.set(opts.id, ...)`, so **a duplicate id silently overwrites the earlier entry**, orphaning the first promise and delivering the browser's reply to whichever entry survived. This never bites today only because `lib/api.js` sends no id and `transport/http.js` generates a random one. Telling the adapter to start sending explicit ids from N parallel processes is what *introduces* the collision. And id equality cannot detect it, because a collision produces a matching id with the wrong body. **Therefore:** ids must be globally unique across processes (pid plus monotonic counter plus random suffix), **must match `[a-zA-Z0-9_-]+`** (`dispatcher.js:8` `VALID_ID`, returning the undocumented `E_SECURITY` at `:30-31`, so `runId.seq` or UUIDs with colons fail outright), and the id assertion must be **paired with a payload sanity check** that the right table came back.
4. **Batch abort is instance-wide.** `pendingRegistry.js:56` `rejectForInstance` fails **every** pending request for an instance at once. Under HARVEST x N, one transient fault aborts the whole batch, not one read. Retry logic must handle a whole-batch rejection, and the budget arithmetic must assume it.
5. **`switch_context` is forbidden.** It mutates global browser-tab state (update set and application scope), so under concurrency one agent's switch changes another's context. The adapter never calls it, and because cross-scope read ACLs can depend on the tab's current scope, the adapter **records** the scope reported at connect and stamps it on the run.
6. **Where the parallelism actually goes.** Not in concurrent HTTP calls, in the **model**. N harvest agents reason in parallel and their reads queue through the limiter. Reads are 100 to 400 ms; reasoning is seconds. Serializing the transport costs almost nothing and removes an entire class of unknown.

### 6.8 Feature requests for the developer

**Rewritten and cut down in revision 3.** The list stood at twelve items, which is a dump, not a deliverable, and C4a says his time is the scarcest input. Read as him, four of the twelve failed: two were answerable by our own WP-A probes, one was really two questions, and one is not a feature request at all. **Nine go out. Each is one sentence of ask plus one line of why, and each names the file and line in his own source so it costs him a reply rather than research.** Numbering restarted as A1 to A9 because the old FR set had a hole at FR8 and an item literally called "FR-NEW". A9 is new in revision 4 and was found by reading the installed 4.7.6 source directly.

**Send-order rule: A1 and A9 first, and they stand alone if you send nothing else.** They are the two items that are findings about his own product rather than requests for ours, and A9 is the one he can act on without any design discussion, because the fix already exists in his own codebase.

| # | Ask | Why, in one line |
|---|---|---|
| **A1** | **`update_record` and `update_record_batch` are not covered by any of the four Agent API permission gates.** `records.js:219` gates `create_artifact` and `:321` gates `delete_record` with `E_DISABLED`; `update_record` (`:94`) and `update_record_batch` (`:144`) check only `reviewWritesEnabled()`. **With all four permission settings off, an agent can still PATCH any field on any record.** Is that intended? | We want to run an autonomous read-only mapping pass and cannot currently close write capability at the capability boundary. |
| **A2** | **A read-only master switch that refuses rather than stages:** `sn-scriptsync.agentApi.readOnly`, `E_DISABLED` on every mutating command, visible in `get_capabilities.gates`. | `reviewWrites` stages for approval, which is right for a coding agent and wrong for an unattended read pass where nobody is there to approve. |
| **A3** | **Paging on `query_records`:** `offset` (or an opaque cursor) plus `hasMore`. | A contextualization sweep enumerates every `sys_metadata` / `sys_script` / `sys_ui_policy` row in a scope; today the only option is widening `limit` and hoping, and a result of exactly `limit` is indistinguishable from a complete one, which makes every count and absence claim unsound. |
| **A4** | **Return the response headers on `rest_request`**, not just `{status, data}` (`_shared.js:62`). | `X-Total-Count` and `Link: rel="next"` would give honest totals and native paging for free, and it is one line. |
| **A5** | **Pass `display_value` and `exclude_reference_link` through on `query_records`.** Two booleans. | You already pin `display_value: false` inside `readBackRecord` (`_shared.js:108`), which is why `get_record` is safe and `query_records` is not: a non-English session returns display values instead of stored values and corrupts every downstream comparison. |
| **A6** | **Is the raw concatenation of the encoded query in `query.js:35,37` intentional?** A value containing `&`, `=` or `#` re-parses as a parameter delimiter and silently changes the filter, returning a clean 200 on the wrong query. | We route such queries to `rest_request` instead, so this is a heads-up rather than a blocker; we would rather you knew than that we worked around it quietly. |
| **A7** | **Warn (or reject) when an encoded-query clause references an unknown field:** `result.warnings: ["unknown field 'u_typo' on sys_script, clause dropped"]`. Lowest priority on this list, and only if it is cheap. | ServiceNow drops the clause and returns **unfiltered** rows, so a typo produces confident wrong output. We are about to build the client-side `sys_dictionary` check that every consumer builds; a warning would let the next one skip it. |
| **A8** | **Concurrency below the HTTP hop.** *"We read `pendingRegistry` and `dispatcher`, so we know the VS Code side interleaves rather than queues and correlates by id. The hop we cannot inspect is the helper tab: with six reads in flight from one workspace, does it fetch concurrently or serialize, and could two replies cross-wire? We serialize at our adapter by default, so the answer only decides whether we can open it up."* | The one genuinely opaque question in the whole transport (C2, 6.7, U16), and it is scoped so a one-word answer is a complete answer. |
| **A9** | **Ten correlation-id call sites do not use your own uniquifier, and `pendingRegistry` overwrites silently on a collision.** `_shared.js:34-37` already solves this: `nextCorrelationId()` returns `agent_${id}_${Date.now()}_${restSeq}` with a monotonic counter, used at `:45` and `:86`. A middle tier appends only `Date.now()` (`browser.js:217,524`, `cdp.js:42`, `connection.js:265`). But ten sites use a bare, caller-supplied `agent_${ctx.request.id}`: `query.js:46,87`, `records.js:251,398,422`, `search.js:82`, `browser.js:344,374,416,494`. `pendingRegistry.js:25` then does a plain `pending.set(id, ...)`, so the second registration silently replaces the first: agent A's timer later deletes agent B's entry before rejecting A, and a reply for that id resolves whichever entry currently holds the key. **Two agents in one workspace both sending `"id": "q_1"` (the id shape in your own doc examples) can receive each other's rows.** | It bites exactly the command a mapping sweep hammers, `query_records`. **We are not blocked:** our adapter mints globally unique ids at a single choke point, so parallel harvest is safe today. Raising it because the fix is routing those ten sites through `nextCorrelationId`, and because any other agent fan-out on your API will hit this without knowing why. |

**Cut, and why. This list is the evidence for the discipline the PoC scores itself on.**

| Cut | Reason |
|---|---|
| *"Echo the resolved instance on every response"* (old FR3) | Real, but G2a already gives us `identity: corroborated-by-canary` and nothing in the design blocks on it. It is a nice-to-have and nice-to-haves are what make a list unreadable. **Hold it for a second round if he engages.** |
| *"Is there a ceiling on the relay response payload?"* (old FR9) | **WP-A probe 5 bisects it empirically.** Asking him for a number we can measure ourselves is exactly the wasted question C4c punishes. If the measured number surprises us, *then* it becomes a one-line question with our measurement attached, which is a far better question. |
| *"Aggregate count without row transfer"* (old FR7) | **WP-A probe 3 settles it with one call.** Same reason. |
| *"Truncation flag on `query_records`"* (old FR4) | Folded into A3. It was the same problem stated twice, and two items for one problem reads as padding. |
| *"How should the adapter be licensed and attributed?"* (old FR10) | Not a feature request and it does not belong in a technical list. It is an operator-to-the developer partnership conversation (C1c) and it is tracked as **Q14** in section 12. |
| *"Does `get_table_metadata` include inherited columns?"* | WP-A probe 4, thirty seconds. |

**Crosswalk, because sections 6.2, 6.9, 6.11, 11.4 and 13 still carry the old labels and renaming them in prose would break more than it fixes.** A1 = old FR2's concrete gap. A2 = old FR2's ask. A3 = old FR1 plus old FR4. A4 = old "FR-NEW". A5 = old FR6. A6 = old FR-Q2. A7 = old FR5. A8 = old FR-Q1. **Not sent:** old FR3, FR7, FR9, FR10. **Never existed:** FR8. Where a later section says "until FR2 lands", read "until A2 lands".

### 6.9 Fallbacks, per gap

| Gap | Today's workaround | Recommendation |
|---|---|---|
| No paging on `query_records` | R2 `sysparm_offset` | **Solved today via R2.** FR1 makes R1 self-sufficient; not blocking. |
| No truncation flag | R2 paging termination rule (G7) | **Solved today via R2.** For R1-only reads, treat `rowCount === limit` as `truncated` and forbid count and absence claims on it. |
| No query-validity feedback | G1, client-side | **Stays client-side permanently.** Even if FR5 lands, a runner-side guard that does not depend on a vendor version is worth its 6%. |
| No aggregate count | R2 `/api/now/stats` | **Probe in WP-A.** If unreachable, enumerate-and-count with a row budget, stamped "counted only what we enumerated". `X-Total-Count` is **not** a fallback: it is structurally unreachable. Do not fabricate a total. |
| No instance echo | G2a | **Sufficient, not proof.** Stamp `identity: corroborated-by-canary`. |
| Inherited columns unknown | `sys_dictionary` plus `sys_db_object` walk (G1) | **Do not use `get_table_metadata` for validation at all.** Keep it for label and type lookups where a miss is harmless. |
| **`update_record` reachable with every permission gate off** | Adapter has no write verbs; PreToolUse hook | **Four layers, and say so.** (i) the adapter cannot write, (ii) `assertReadOnly` hard-fails unless all four gates are false, (iii) `sn-write-guard.js` must return `deny`, not `ask` (B8), (iv) **turn `sn-scriptsync.agentApi.reviewWrites` ON for the PoC**, because it is the only existing control that touches `update_record`. Full structural enforcement needs **FR2**; until then the run stamps `readOnlyEnforcement: 'partial'`. |
| Concurrency semantics below the HTTP hop | Serialize at the adapter (6.7) | **Ship serialized.** Raise only on FR-Q1 plus a measured spike. |
| Response-size ceiling unknown | `widePageSize: 25`, strict field allowlists, never `SELECT *` | Bisect empirically in WP-A on `sys_update_xml` and record the number. |
| **Headless / CI operation** | Not possible: `dispatcher.js:49-54` enforces `requiresBrowser` on every read command | **Accept and scope it.** MAP and VERIFY are attended operations at a consultant's workstation. This is a genuine architectural boundary of the chosen substrate, it is now [SRC]-confirmed rather than doc-asserted, and **the plan should stop listing unattended operation as a goal.** If it ever becomes one it is a feature request, not a workaround. |
| A read genuinely impossible through the extension | Cold path | **Unchanged from old 6.5 tier 3.** Offline `sys_update_set` XML export plus a `sys_metadata` extract, reviewed offline. Every claim stamped `unverifiable: no-oracle`, VERIFY degrades to L2 and L3, and the deliverable is labelled "we mapped your documentation, not your instance". Price it as such. |

Note what is **not** on this list: a scoped read-only REST call as a documented supplement. It is not needed. R2 **is** the REST read path, reached through an SN Utils command, on the consultant's existing session, with no new credential. That is the point of the corrected design.

### 6.10 What this deletes from the plan

| Deleted | Where | Why |
|---|---|---|
| The OAuth read-only integration user and the `oauth_entity` recommendation | old 6.1, 6.3 | Superseded by C1. R2 needs no credential. |
| The minimum-privilege ACL request list (the "two-week problem" table) | old 6.3 | No integration user means no ACL request. The table list survives as a **scope** list in 6.5, not as something a security team approves. |
| **The privilege-parity check** | old 6.4 | It existed only because a restricted integration user sees fewer rows and fields than the consultant. The transport **is** the consultant's session. The guard has no referent. Phase-2 deliverable removed. |
| The sn-scriptsync licence risk as a blocker | old 6.2, 6.7 item 1, Q6 | C1(c). Becomes FR10, a partnership item with a collaborator. Phase 2 is no longer gated on it. |
| Adapter-equivalence spike (Table API vs scriptsync on the same 26 claims) | old 6.6 | There is no second adapter to compare against. Replaced by the WP-A preflight probe. |
| `tooling.agentPortFile` described as "the path section 6 demotes" | 2.4 | It is promoted. `product.config.json:38` is the primary transport config. |
| The `X-Total-Count` fallback | revision-2 draft only | Structurally impossible (`_shared.js:62`). Never shipped; recorded here so it is not re-proposed. |

**Survives unchanged and is now more important:** the canary rule, field validation, A/B negation, watermarks, instance stamping, domain-separation detection, the rate budget (re-aimed at the single helper tab rather than an instance-wide integration quota), and the cold-path fallback.

### 6.11 Config slots

`product.config.json` additions, **every one with a working default.** The mechanism revision 1 gave for this rule was wrong and a domain expert would have checked it: `render-kernel.js` only validates the slots `kernel/CLAUDE.template.md` actually interpolates as `{{...}}`, which is nine (`customer.identityLine`, `customer.name`, `dotted.path`, `instances.dev`, `naming.storySetFormat`, `paths.wikiRoot`, `scopes.app`, `tooling.agentPortFile`, `tooling.docPipelineSkill`). A new `read.*` or `instanceIdentity.*` slot is invisible to it. **The real reason to ship defaults is that hooks and the adapter read the config at runtime and must fail open.**

```jsonc
"tooling": {
  "agentPortFile": ".vscode/sn-agent-port.json",
  "docPipelineSkill": "write-sn-documentation",
  "readAdapter": "scriptsync",
  "supportedApiVersions": [4, 5, 6],       // PROTOCOL version, not the skills doc version
  "restRequestReads": "auto"                // auto | force | off  (off ⇒ R1-only degraded mode)
},
"read": {
  "pageSize": 100,
  "widePageSize": 25,
  "wideFieldTables": ["sys_update_xml", "sys_script", "sys_script_include", "sp_widget", "sys_ui_page"],
  "maxConcurrency": 1,
  "requestTimeoutMs": 75000,               // MUST exceed the server's 60 s browser deadline.
                                           // lib/api.js:17 uses 30000, which abandons live requests
                                           // and discards the eventual reply. Do not inherit it.
  "retry": { "maxAttempts": 2, "baseMs": 500, "jitter": true,
             "retryOn": ["E_TIMEOUT", "E_INTERNAL"] },
  "identityProperty": "instance_name",
  "guardBudgetPct": { "negation": 15 }
},
"budgets": {
  "kernelTokens": 6000, "alwaysOnTokens": 14000,
  "mapApiCalls": 2000, "verifyApiCalls": 600, "mapWallClockMin": 45,
  "questionsPerRun": 10                    // the PoC's REAL budget (6.4)
},
"instanceIdentity": { "name": "devinst01", "url": "https://devinst01.service-now.com", "tier": "vendor-dev" }
```

**`retryOn` corrections.** `E_SERVER_NOT_RUNNING` is **terminal, not transient**: `dispatcher.js:51` returns it when the VS Code WebSocket server is stopped, which requires a human to click the status bar. Retrying it three times with backoff reports a transient failure for a condition that will never clear. It belongs with `E_BROWSER_DISCONNECTED` and `E_ACL` in the terminal set. And `maxAttempts` is **2, not 3**, because each `E_TIMEOUT` attempt costs 60 seconds, so three attempts is a three-minute stall per read and the budget arithmetic breaks under any real fault.

### 6.12 Work packages

**WP-A. Transport preflight probe. Eleven items, half a day, before any adapter code. Output to `<sync-root>/spikes/scriptsync-read/RESULTS.md`.** Against devinst01, kill criteria written before it runs, exactly as `playbooks/03-enforce.md:27-46` demands of every new check.

> **Corrected after the first build attempt.** Earlier revisions wrote that path repo-relative, which would have put instance data (probe 9's author distribution, probe 10's role read, probe 11's 100 `sys_metadata` rows) inside the commercial product repo, and `.gitignore` carried no rule that would have caught it. The output root is the **scriptsync sync folder**, never this repo. The tool defaults there and `.gitignore` now defends the boundary as well. Tooling graduates into the product; instance data never does.

1. `rest_request` GET on `/api/now/table/sys_scope?sysparm_limit=1` with `restRequest.enabled` **off**. *Kill criterion retained but downgraded:* the gating is now [SRC]-verified in the build the operator is running, so this tests **the browser hop and this specific instance**, not the design premise. If it returns `E_DISABLED`, R2 collapses to R1-only (no paging, no display-value control, no counts) and FR1/FR4/FR6/FR7 become blocking prerequisites.
2. `sysparm_offset` paging over `sys_dictionary`: does offset work, and does page 2 differ from page 1.
3. `/api/now/stats/sys_script?sysparm_count=true`: reachable or not (G8 fallback).
4. `get_table_metadata` on a table extending `task`: inherited columns present or not, **and whether the response carries a `columns` key at all** (`records.js:408` silently falls back to returning the whole result object). One call, and it removes a question from the list to the developer rather than adding one. *(An earlier draft referred to this as "FR8". There is no FR8 in 6.8: the question was cut precisely because this probe answers it. The label is retired here so nobody hunts for it.)*
5. Page-size bisection on `sys_update_xml` including `payload`: find the relay ceiling (FR9).
6. **Negative control:** a deliberately invalid field in an encoded query. Confirm on **this** instance and **this** protocol version that unfiltered rows come back and nothing errors. Without this, G1 defends against a documented failure rather than an observed one.
7. **Value-encoding control:** an encoded query whose value contains `&`, through R1. Confirm the corruption predicted by `query.js:35,37`, then confirm R2 handles it. This is G1b's canary.
8. `get_capabilities`: record the `gates` block verbatim, including whether `createArtifacts` is on.
9. **Provenance ladder counts (four queries now, twenty minutes, and this is the highest-information item on the list).** Count `sys_update_xml` rows across all update sets including Default; count `sys_update_version` rows; count `sys_metadata` rows whose `sys_created_by` is a human account. **Extended in revision 3, because the original three tested only one direction of failure:** add a fourth, a **group-by of `sys_metadata` on `sys_created_by` and on `sys_package` / `sys_scope`**, reported as a distribution rather than a total. The three original counts detect "too few authored records"; the fourth detects the confound 11.1 now names, which is **base and demo records that pass an authorship filter**. **Both outcomes change the PoC before the adapter is written: a small count means it measures nothing, and a large count dominated by `admin` inside base packages means it measures the wrong thing.** Whichever it is, it is a finding and it is worth more than a run.
10. **Session privilege, one call, and it is the cheapest honesty item on the list.** Read the current user's roles. If the session holds `admin`, stamp the run `aclExposure: 'none'` and state in the report that the ACL-blindness class (11.1) was **structurally out of reach**, rather than untested by oversight.
11. **Update-set membership as a record-level authorship rung. NEW in revision 4, two calls, twenty minutes, and it decides whether the scope filter has a record-level rung at all.** [CORRECTED 2026-08-04: this item read "`sys_customer_update` reliability". See R-e — there is no such table and no such column on any release; the string is the label of `sys_update_xml`, so the probe as written fired its kill on every instance in existence, for a fact about our own vocabulary rather than about the instance. A3 is update-set membership, and it is **not** clone-resilient: a clone truncates `sys_update_xml`, so the clone-resilience story rests on A1 alone.] The rung is membership joined on the key the platform already provides, `sys_metadata.sys_update_name` IS `sys_update_xml.name`, and A3 has never been verified against this release or through this transport. Read 50 rows of `sys_metadata` from a known base package and 50 from a known customer scope with `sysparm_fields=sys_update_name,sys_mod_count,sys_package,sys_created_by`, and **validate `sys_update_xml.name` against `sys_dictionary` before filtering on it**, because the clause-drop returns unfiltered rows and would read here as total coverage of both populations. **Kill criterion, written first: if membership covers both populations indiscriminately, or covers neither, A3 is dead, the surviving path is A1 (package-level) only, and the run stamps `authorship: 'package-level-only'`.** Also compute F9 here from the same data: does any `sys_store_app` publisher match a human account in the probe-9 author distribution, which is the case where the instance owner's own published app bins as Band C and takes his most decision-rich artifacts with it.

Record extension version, protocol version, skills version, date and instance. Every [DOC] and [OPAQUE] row in 6.2 is a candidate for conversion here.

**WP-B. `tools/snbrain/read/scriptsync.js` plus `guards.js`.** Sized after WP-A reports. Port the seven functions from `lib/api.js`, build the new ones, unit-test against recorded fixtures using the `test/run-tests.js` structure this plan already backports, including a fixture per guard and a `testEveryGuardIsExercised` in the shape of `testEveryCheckIsExercised`.

**WP-C. Send the A1 to A8 list to the developer** (6.8). Operator-owned, can go the day WP-A reports, and **A1 alone is worth sending even if nothing else is ready.** Probes 3, 4, 5 and 7 exist partly to shorten this list before it is sent.

---

## 7. WHAT TO BACKPORT FROM the pilot customer

The boundary in the last column is contractual, not stylistic. Customer domain knowledge stays in the customer repo.

| the pilot customer asset | Becomes in the product | Must be parameterized | Must NOT leak |
|---|---|---|---|
| `LOOP.md` sections 3, 4, 5, 6, 7 (ladder, maker/checker, stopping rules, terminal states, memory) | `docs/LOOP.md`, a peer to `architecture.md`, rewritten for knowledge claims per section 4.3 | Caps (6 not 3), staleness horizon, budgets | Nothing. This is doctrine. **But cite arXiv 2607.00038 for the five-part definition and the terminal-state list: five of the pilot customer's six states appear there verbatim and in order, in a paper submitted a month before the pilot customer's LOOP.md. Do not market the vocabulary as original.** The differentiator is the deterministic implementation. |
| `gate.js` plus `lib/report.js` plus `lib/checks.js` **architecture** (pure `(ctx, findings) => void` checks, injected parse, crashing check becomes a BLOCKING finding, exit 0/1/2 with "could not run" never equal to "passed") | `tools/snbrain/verify.js` framework: corpus loader, ctx builder, check registry, severity contract, evidence-pack renderer | Corpus loader swaps `sys_update_xml` rows for claim ledger rows | The 14 check *bodies* (`lib/checks.js:663-677`, exactly 14 entries in `CHECKS`). **8 graduate now**, named exactly so the count can be audited: `checkCapture`, `checkBannedTables`, `checkEs5` with the `js_level` arbitration, `checkScopedDateApis`, `checkJournalSetValue`, `checkCurrentUpdateInBr`, `checkM2mUpdate`, `checkSandboxFields`. **Correction, revision 3: "the rest are the pilot customer domain" was wrong and an auditor greppping `CHECKS` would catch it in a minute.** Three more are platform-generic and were simply not assessed: `checkCaptureSuppression`, `checkScopedSiPrefix` (GlideAjax script-include scope prefix) and `checkDebugLeftovers`. Assess those three in phase 2 and the graduating set is 8 to 11, not 8. Genuinely pilot-domain: `checkHardcodedUserText` and the Dutch half of `checkCrossRow` and `checkMetadata`. |
| `lib/report.js` evidence-pack renderer (verdict first, blocking next, everything else in `<details>`, explicitly engineered against approval fatigue) | Verbatim. Becomes the gate pack and the interview brief. | Nothing | Nothing |
| `test/run-tests.js`, especially `testEveryCheckIsExercised` (greps check slugs out of the source and fails if any lacks a fixture) and `testStableIds` | Verbatim structure. This is the strongest quality artefact in either repo, and it runs green today: `All 51 checks passed`, exit 0. | Fixture corpus | the pilot customer fixtures |
| `state.js` verbs plus the `finish --terminal success` guard | `tools/snbrain/state.js` with the four fixes: index-plus-pointers (not 354 KB), a `show` projection that counts archived iterations, `finish` refusing to transition out of `stalled`/`exhausted` without a recorded override, and first-class `reset`/`accept`/`override` verbs | Cap values, terminal vocabulary | Story ids, AzDO ids |
| `lib/api.js` silent-empty defences (stale-PID check, health cross-check, and the liveness assertion before any query whose emptiness would be interpreted) | **`tools/snbrain/read/scriptsync.js`, one adapter, not two** (C1). Roughly **60%** of the module's 191 lines port; see 6.3 for the function-by-function table. Plus **mandatory canary-per-batch, field validation and value sanitisation, which the pilot customer does only by convention in prompts**. | Port file path, instance name, protocol-version allowlist | Instance names |
| `router.json` table-to-skill routing, with its deliberate refusal to embed rubrics | Grow `.claude/hooks/table-gotchas.json` into a real router. **First reconcile with what already exists:** `.claude/hooks/skill-trigger.js` already routes dynamically by harvesting trigger phrases out of the 48 skills' frontmatter at runtime, so the product has *phrase to skill* routing and lacks *table to skill* routing. Do not build a second router; state which of the two owns which key, and decide whether a claim's `locus.table` routes to a skill at all | The whole `tables{}`, `prefixes{}`, `scopes{}` map | `scopes{}` sys_ids, `sn_ohs_*` tables, ACME naming |
| `.claude/agents/acme-design-assessor.md` (already a knowledge verifier: it assesses a *document* against the live instance) | `.claude/agents/brain-claim-verifier.md` plus a rendered `.github/agents/brain-claim-verifier.agent.md` | Rubric source path | ACME rubric, Dutch vocabulary |
| The 9-probe suite *shape* (prompt, EXPECTED, "failure it guards against") | Extend `probes/probes.md` with mechanical assertions and a real scorer | Customer probe rows | **All nine the pilot customer prompts and expectations. These are customer IP.** The product ships 4 platform-generic seeds only. |
| Update-set ownership (`LOOP.md` section 8) | Generalized: the run declares a bounded **write surface** (a path list) at init; any write outside it is terminal `blocked` | The path list | The literal update-set concept, which has no analogue here |

**Explicitly do NOT backport:** the stagnation breaker as written (set equality on model-authored ids, dead code in 32 iterations), cap 3 (overridden every time it fired), `ENGLISH_ONLY_FIELDS` and the Dutch `DOMAIN`/`NL_WORDS` regexes at `lib/checks.js:366-376,512-513`, the `ACME ` naming check at `:479-486`, the `ohs_task.category` dot-walk check at `:470-477` (its *generalized* form already exists in `table-gotchas.json` and that is the model to follow), and the `STRY0\d{6}` set-name regex at `:135`.

---

## 8. WHAT TO PRESERVE

The rework must not destroy working design. Specifically:

1. **`tools/render-kernel.js`.** 73 lines of plain Node, no harness dependency, resolves `{{dotted.path}}` slots, and **refuses to write** on any unresolved slot or surviving `REQUIRED`/`OPTIONAL` placeholder (`:44-65`) on the stated grounds that a kernel with a hole in it is worse than no kernel. It writes both kernels from one source (`:67-71`). The field evidence that this matters is section 2.1/B6: the pilot customer maintains its two kernels by hand and they have drifted by exactly the newest hard rule. Do not rebuild this. **Generalize it** into the emitter for every per-harness artifact (hooks configs, agent files, stage shims).
2. **The knowledge corpus:** `wiki-scaffold/gotchas.md` (266 lines, 7 failure classes, each entry carrying an explicit owner pointer), `hard-rules.md`, `agent-api.md` with its vendor-doc interposition, `table-gotchas.json`. I diffed this against the pilot customer's originals: the structure is identical, the product's version is *better* (it adds owner pointers the pilot customer lacks), and a case-insensitive grep for the pilot customer, devinst02, ACME, case, hoofdactie and `sn_ohs` across `wiki-scaffold/`, `kernel/` and `docs/` returns zero hits. The de-customerization was done properly. This is the commercial moat and the rework must wire more machinery to it, not touch its content.
3. **The doctrine documents.** `docs/architecture.md:9-26` (place knowledge by loading mechanism, not topic), `:94-100` (the honest grading table), `:107-111` (four evaluated-and-rejected designs, kept so they are not re-proposed), `docs/research.md:208-223` (an explicit falsification record). Extend these. Add the loop spec as a peer, add "prompt-orchestrated fan-out with no state" to the rejected list with this review as its evidence, and give the honest grading table the pilot customer's L0-L5 vocabulary. Then **fix the two wrong grades**: `sn-capture-verifier.js` is Advisory, not Deterministic, and the link/frontmatter validator described at `:102-105` does not exist and must not be described as though it does.
4. **The tiered archaeology reasoning** (`SKILL.md:67-80`) and the evidence-only audit doctrine (`playbooks/01-audit.md:9-27`: query never trust docs, API silence is not proof, every finding carries a pointer, unverified is a first-class status, sample honestly and report the sample size). This is exactly the right cost model and the right epistemics. Keep the reasoning, move the enforcement into code.
5. **Preflight and the LAWS block** (`bootstrap-project-brain.js:26-43,56-67`). The read-only law, the zero-row-means-disconnected rule, the DRAFT stamp, and WHAT-never-WHY are all correct. They become runner-enforced instead of prompt-asserted.
6. **The DRAFT plus INTERVIEW mechanism itself.** It is the one leg of the current design with field evidence behind it and the rework must make it *enforceable*, not replace it with machinery. See section 9.
7. **`playbooks/03-enforce.md:27-46`**, the positive-and-negative canary procedure for the capture verifier. That is correct verification doctrine, written down, and it should be the template for how every new check is validated.

---

## 9. THE HONEST CEILING

This section is written to be shown to a customer.

### 9.1 By volume: roughly 20 to 25% of the wiki is machine-derivable, not 40%

The 40% figure in the input audit is a line-counting artifact. Measured across the pilot customer's 41 story pages, frontmatter is 28.1% of *lines* but only 13.8% of *bytes*, because the derivable material (`updated-sets:`, `mentions:`, `affects:`) is one item per line, while the non-derivable material (delta narrative, decisions taken, superseded-by reasoning) is dense prose. Token-weighted, the derivable share across the whole 4,586-line, 385,818-byte wiki is roughly 20 to 25%. **Always use bytes or tokens as the denominator when quoting this number.**

Within the load-bearing reference layer (1,277 non-story lines) the picture is worse. `registry-sys-ids.md` (297 lines) and `deployment-matrix.md` are largely derivable. `hard-rules.md` (93 lines, 13 rules) and `agent-api.md` (65 lines) are close to zero: I read all 13 hard rules and every one is a Rule / Why / Verify-recover triplet where the Why is a named incident. `decisions.md` (119 lines, 33 decisions) is close to zero: DEC-007's scope placement is observable, its causal reason is not.

### 9.2 By what the brain is FOR: roughly 2 of 9. **And in revision 2 this number changes sides.**

Volume is the wrong metric anyway. Rank by the acceptance suite, which is the only measured statement of purpose in either repo. the pilot customer's nine probes (`_lab/probes/probes.md`): probes 4, 5, 7 and 8 are pure platform knowledge answered by the shipped kernel, so a MAP pass adds nothing. Probes 2, 6 and 9 require experiential knowledge (the counter-knowledge that a dot-walk filter silently matches zero rows, DEC-031's hoofdactie definition, and the accident report expansion the machine got wrong for five months). Only 1 to 2 are cleanly machine-derived. **A perfectly executed MAP pass would score roughly 2 of 9 on the reference engagement's own acceptance suite.**

**Revision 2: make the turn explicit, because revision 1 read this number backwards.** Revision 1 filed 2-of-9 as the discipline on the plan, the number that should make you doubt the programme. Under C3's thesis it is the **argument for** the programme, and the inference runs like this:

1. Seven of the nine probes are answered by knowledge the MAP pass **cannot** produce. That is not MAP failing. That is a measurement of where the value actually is.
2. Look at what those seven need: counter-knowledge (a documented pattern that silently matches zero rows), domain vocabulary (what accident report expands to), and decision rationale (why hoofdactie is defined the way DEC-031 defines it). **Every one of them is a WHY or a HOW, and every one of them came from a human.**
3. So a design that treats MAP's output as the deliverable is optimising a leg worth 2 of 9. A design that treats MAP as the mechanism that **surfaces the questions whose answers are the other 7** is optimising the right thing.
4. And the same the pilot customer record shows the mechanism working, up to a point that must be stated exactly: the largest gap the audit found was machine-detectable, the human could not explain it, and archaeology later recovered **who did it, when, inside which story, and that it was deliberate**, while the rationale in that entry remains an explicit inference (4.10). Machine finds, human explains, and when the human fails, provenance narrows the question instead of answering it.

**The number to quote is therefore not "MAP scores 2 of 9". It is "MAP scores 2 of 9 on its own and is the only cheap way to find out which 7 questions to ask."** Phase 0's ablation still measures the first half. Nothing has ever measured the second half, which is why phase 0.1 exists.

### 9.2b The provenance scaffold's honest yield

Stated separately because it is the leg with the least evidence and the most leverage (6.6).

- **What it must produce to be worth funding:** a *customer-authored* subset of the instance. Without that the question generator's universe is ServiceNow's shipped defaults (3.3/QG5), and the whole interview leg is aimed at the wrong records.
- **What revision 1 assumed:** committed update sets are the change record. 9.7 item 1 already knew that was shaky on brownfield (source-control-linked Studio apps, CI/CD app pushes, store and plugin installs, and clones that truncate `sys_update_set` history).
- **What C4b now makes near-certain for the PoC target:** thin or absent update-set history on a vendor's own dev instance.
- **The honest yield estimate, and it is a range not a number:** on the R-a rung (`sys_update_version`) the yield is **unknown and probeable in one query**. On R-b (`sys_metadata` authorship plus `sys_mod_count`) the yield is **structurally guaranteed to be non-empty**, because those columns exist on every metadata record on every instance; what is unknown is whether they *discriminate*, that is whether the authors are humans or an install process. On R-c and R-d the yield is small but the records are high-value (deletions and plugin provenance).
- **The failure mode to refuse:** running archaeology against an instance that never used update sets and reporting "no changes found". That is the same silent-empty failure the guard layer exists to prevent, one level up the stack, and it is exactly what a binary "update sets or nothing" design produces.
- **Field evidence that the ladder pays, once, and at its true strength:** TBD-038 at the pilot customer went from "doesn't recall" to "deliberate, attributed, timestamped, inside a named story" via `sys_update_xml` plus `sys_audit`, **after** the human had failed. The causal sentence in that entry is still flagged "likely", so what the ladder bought was **intent and attribution, not rationale** (4.10). n=1, and it is the only n we have. n=1, and it is the only n we have.

### 9.3 What the loop can never produce

- **WHY.** Every decision rationale, every rejected alternative, every constraint that came from a meeting.
- **Counter-knowledge.** "This documented pattern silently matches zero rows" is a post-mortem of a failure, not an observation of state.
- **Domain vocabulary.** accident report expands to Case Bedrijfsongeval. Nothing on the instance says so. The pre-wiki glossary carried the wrong expansion for five months (`engagement-docs/Docs/wiki/glossary.md:11-14`).
- **Cross-instance truth.** Deployment reality lives across dev, test, acc and prod, and cross-instance reads fail silently (`audit-phase0-findings.md:222`).
- **Intent versus accident.** An inactive business rule may be deliberately retired or accidentally broken. The instance looks identical either way.
- **Usage.** Configuration state is not runtime behaviour. An active business rule that no transaction has triggered in two years and one that fires 40,000 times a day are indistinguishable in `sys_script`. Execution evidence exists on the platform (flow contexts, event logs, transaction logs) but it is a different read path with different volumes and different privacy exposure, and this plan does not include it. Say so rather than letting "map of your configuration" be heard as "map of what your instance does".
- **Anything outside the instance.** The far side of every integration, MID server topology, the ERP that actually owns the data, the spreadsheet three people maintain. A brownfield implementation's hardest facts usually live there.
- **Whether the customer's own documentation is wrong.** The loop verifies claims against the instance. It cannot verify the customer's Confluence against anything, and a confident wrong document is the most common thing handed to a new consultant on day one.
- **Retrievability.** A true claim sitting in a page no agent ever loads is worth zero. The probe suite is the only thing that measures the claim-to-answer link, and it measures 9 questions. Section 11 measures claim precision and never measures whether a verified claim reaches the model at the moment it is needed. That gap is real and unowned.

### 9.4 How the design compensates, and why this is still worth building

Three arguments, all from the pilot customer's own record:

1. **The cheap half is the half that rots.** DEC-001, from February, is still true. The registry drifted 15% in about six weeks. Low value density, high maintenance demand: that is the exact profile where automation pays. Reframe the product claim honestly: **the loop's job is not to build the brain better than a human, it is to stop the derivable half from rotting and to prove, with citations, which parts are still true.**
2. **The cheap half generates the questions the expensive half answers.** The single largest contextual gap the the pilot customer audit found, an entire undocumented story that deprecated the live SLA, was in the cheap half, was machine-detectable, and the human owner could not explain it: "Doesn't recall the details ('dunno what's going on here tbf')" (`_lab/INTERVIEW.md:68`). The machine found what the human had forgotten. That is the product.
3. **The interview is the mechanism, and it has field evidence, but the evidence is for a different engine and revision 1 borrowed credibility across that gap.** Of the pilot customer's 15 interview questions, the answers produced the glossary rewrite, the language policy, and the corrections that made 8 of 9 probes pass. **That is true and it is evidence for a REPO-AUDIT-driven interview.** The four questions that produced real reasoning (Q1 doc audience, Q8 PII in git, Q9 two parallel scope-folder generations, Q11 binary weight in git) have **no instance referent at all**: an instance-reading engine generates none of them, and on devinst01 there is no repo for them to arise from. The MAP-generated engine is a different mechanism and its evidence is phase 0.1's backtest, not this sentence. Two caveats that must be costed: **the human oracle fails about one time in five** (Q7 "don't recall", Q15 `_pending_` eleven days on), hence `unanswerable` as a first-class terminal state; and the instance-derived half produced debt items rather than decisions (4.10), hence the relabelling.

### 9.5 What the provenance of the pilot customer's own wiki proves, and does not

Nobody checked this and it inverts a conclusion. the pilot customer's registry, the most derivable-looking page in the wiki, was **not built from an instance sweep**. Its frontmatter reads `harvested: 2026-07-20` with `sources: [.planning/codebase/SYS_IDS.md, engagement-docs/Docs/00-global/MANIFEST.md, ...]` and its header states it was harvested from docs and live-verified on a 30-row sample four days later, with unmarked rows unverified (`engagement-docs/Docs/wiki/registry-sys-ids.md:1-11`). Many rows still carry 8-character prefixes because that is what the source documents held.

**the pilot customer is evidence that document migration plus interview plus sampled live verification produces this wiki. It is not evidence that a read-only sweep can.** The sweep would beat the pilot customer on exactly one axis: full 32-character sys_ids instead of doc-copied prefixes. State this to the customer. It strengthens operator decision 1 (verify against a genuinely unknown instance) rather than weakening it, because it means the verification run will produce genuinely new evidence rather than reproducing a known result.

### 9.6 The one dishonest thing left in this design: precision with no recall

Section 3.3 concludes that coverage has no signal, and kills the coverage metric. Section 11 then makes **claim precision the headline number** and says it "is the one to quote". Both are individually defensible and together they produce the exact overclaim this section exists to prevent.

The VERIFY loop converges when every claim in the ledger is verified and uncontradicted. **That condition is reachable on a ledger covering 5% of the instance, and the loop cannot tell the difference.** Convergence was deliberately defined over a finite enumerable ledger precisely so it would be reachable, which means convergence is a statement about the ledger and never a statement about the instance. A customer shown "94% claim precision, loop converged, zero contradictions" will hear "the map is 94% right". The honest statement is: **94% of what we wrote is right, and we cannot tell you what fraction of your instance we wrote.**

Therefore, and this is a hard rule on the deliverable, not a preference:

1. **A precision number is never reported without the recall disclaimer in the same visual block.** Not a footnote, not an appendix.
2. **Every report carries the denominator that does exist:** artifacts counted by the census per table and per scope, versus claims written per table and per scope. That is not a coverage *rate* (3.2/T1 killed the rate for good reasons) but it is an honest inventory, and it lets a reader see that 4,000 `sys_ui_policy` rows produced 12 claims.
3. **The held-out-scope calibration (3.2/T3) is the only recall-shaped evidence in the whole design.** If the operator declines it, the product ships with a precision number and literally no recall evidence, and Q5's customer-facing claim must be weakened accordingly. Make that consequence explicit in the decision, so declining the calibration is a priced choice rather than a saved afternoon.

**Revision 2 extension: the same defect reproduces one layer up, in the PoC's own headline metric, and it must not.** C4c defines question precision as "of the questions put to the developer, how many bought real WHY". That is **precision with no recall**: the questions we should have asked and did not are invisible. Section 9.6 declares that pattern "the one dishonest thing left in this design" and bans it for claims. Banning it for claims and then adopting it as the PoC's headline is not defensible. Three consequences, all binding on section 11:

- **A blind recall elicitation runs first** (11.2 stage S7 step 1, scored as 11.4/M1), before the developer sees any of our questions. It is the only recall-shaped evidence obtainable from an SME and it costs less than one question. **Revision 4 adds the machine-side half:** the engine's recall against the pilot customer's own written interview record is now measured at 5 of 15 with the corpus and 2 of 15 without it (4.9.0), which is the first recall number this design has ever had.
- **The suppressed-candidates list is reported** (4.9, 6.4/G3). Free, mechanical, and it is the only recall signal the machine can produce about itself.
- **The n problem is stated, not hidden, and revision 4 makes it worse rather than better.** A concise question list for a scarce SME was n of about 10; the backtest cuts it to **5 or fewer** (11.3), and at n=5 with 3 successes the 95% Wilson interval runs roughly 23% to 88%. **That is not a metric, it is a mood.** Report it as a count with the interval, never as a rate with a threshold. **Shrinking n was still correct:** padding to 8 or 10 buys interval width by sending questions from signals below the admission floor, which inflates the denominator with known waste.

### 9.7 Not for the customer: what an experienced brownfield onboarder would call naive

Ten onboardings' worth of objections, ordered by how early they bite. These are not ceiling statements, they are things that will go wrong in the verification run if nobody plans for them.

1. **Update sets are not the change history any more.** The whole ARCHAEOLOGY phase, inherited unchanged from `bootstrap-project-brain.js:88-117`, assumes committed update sets are the record of what happened. On a real brownfield instance a large share of configuration arrives another way: Studio linked to a source-control repo, CI/CD pipelines pushing app versions, store and plugin installs, and instance clones. **Clones are the killer:** a sub-prod clone routinely wipes or truncates `sys_update_set` and `sys_update_xml` history, so an instance cloned from prod six weeks ago has six weeks of archaeology and looks pristine. Required, and currently absent: a **provenance-detection step in CENSUS** that determines how this customer actually ships (check for source-control-linked apps, check `sys_app` version and update history, check the clone date), and a terminal state or an explicit downgrade when the answer is "not update sets". Archaeology should be *conditional on the answer*, not a fixed phase.
2. **Dev is not prod, and the map will be read as prod.** The PoC target is a vendor DEV instance (C4). Dev instances carry half-built experiments, personal scratch artifacts, and config that was never promoted. A map of dev handed to a customer becomes a map of "what we do" in their heads within a week. Mitigated by G5 (6.4) stamping instance, tier and date on every claim, but the deliverable also needs a front-page statement of which instance and which tier, and the deployment matrix needs to be honest that it maps *promotion records*, not the state of prod.
3. **On a brownfield instance, dead config is the norm, not the anomaly.** B3 correctly kills the current dead-detection technique. What replaces it needs a volume plan: thousands of inactive artifacts is normal, and a findings list containing all of them is a findings list nobody reads. Triage rule needed before phase 3: inactive artifacts are inventory rows, never findings, unless something active still references them.
4. **The SME who can answer WHY is the scarcest resource in the engagement.** Revision 1 treated two hours of their time as a checkbox; revision 2 makes it the PoC budget (11.3) and caps the question count (4.9). the pilot customer's own data says one in five questions comes back unanswerable even with a willing owner. Needed: a defined degradation path for "no SME available", because that is the modal case in month one, and because section 9 says the interview is where the actual value is. Without it the plan's value story has a single point of failure with no fallback.
5. **Nobody has costed the instance's other tenants.** 6.4 budgets the relay, which is right, but a brownfield customer's shared sub-prod instance also has nightly clones, scheduled jobs, integration test runs and other consultants. A 45-minute 2,000-query sweep needs a *window*, agreed by whoever owns the instance, and it must be a gate, not a courtesy. It is one in 11.5.
6. **`sys_metadata` is not a complete denominator.** Some configuration is not in `sys_metadata` at all (data-driven config, property values, records in configuration-carrying data tables). Section 2.2/M3 mourns the discarded `artifactCount` denominator; 9.6 item 2 now reuses it. It is a useful inventory and a bad universe. Say which.
7. **Effort estimates have no team model.** Phase 2 is "2 weeks", phase 3 is "2 to 3 weeks", phase 0 is "36 headless sessions" with no cost attached in a document that elsewhere cites a 15x multi-agent cost multiplier. One person or three? Consecutive weeks or elapsed weeks alongside billable engagement work? Estimated by whom? An operator reading "2 to 3 weeks" and getting eight will not remember that the number had no basis. State the assumption or drop the numbers.

---

## 10. THE PLAN

Re-phased in revision 2 around C3: **the question engine and the decision ledger are the product, so they are built early, not last.** Ordered by risk retired per unit of effort. Every work package keeps a file path, a number and a falsifiable success test.

**Phase 0a is deleted.** Its two live the pilot customer defects are fixed (mirror re-synced, `kernel-integrity.js` given a `--strict` gate mode) and the `processes/` migration is deferred by operator decision. Per C5, no the pilot customer work is proposed anywhere below.

**The ablation is a prior, not a gate** (Q1, already decided): build phases 1 and 2 in parallel with it, do not start phase 3 until it reports.

### Phase 0.1: the the pilot customer retrospective backtest. **Run this first. It can invalidate the framing that phases 2 and 3 are scoped around.**

- **Goal.** Measure the conversion the entire thesis rests on and that nothing has ever measured: **does an anomaly a machine can see become a question a human answers with a rationale?**
- **Why first.** Every other link in the chain (guards, claims, transport, ranking) is designed, budgeted and probed. That last conversion is *asserted*. The only measurement that exists contradicts it.
- **Method.** Pure reading of artifacts already on disk. **Zero SME time, zero instance access, zero the pilot customer changes, C5-safe.** Inputs: `engagement-docs/Docs/00-global/_lab/INTERVIEW.md` (15 questions with recorded answers), `_lab/audit-phase0-findings.md` (27 findings, 26 verified claims), `wiki/decisions.md` (33 DECs), `wiki/tbd.md`.
- **Deliverables.** `C:/Werk/sn-agent-contextualization-framework/docs/backtest-ns-interview.md`. No product code.
- **Effort.** Half a day for items 1 to 3, plus **half a day for items 4 and 5, which revision 4 adds.** One person.
- **How we know it worked.** Five counted numbers, each with the classification shown per question or per row so the operator can disagree with a specific line:
  1. **Generatable from a live snapshot alone.** **Revision 4 replaces the estimate with a measurement: 5 of 15 with the the pilot customer repo corpus present, 2 of 15 instance-only** (4.9.0). Phase 0.1 re-derives this against the catalogue as actually implemented, per question, and the prior estimate of 2 was right only for the instance-only case.
  2. **Anomaly to rationale conversion.** Prior estimate **0 of 6 from the human.** The nearest case, TBD-038, was narrowed by archaeology to intent plus attribution and its causal clause is still flagged "likely" (4.10). Classify each of the six as `rationale` / `intent-and-attribution-only` / `debt-item` / `unanswerable`.
  3. **Anomaly to debt-item conversion.** Prior estimate **3 of 6**.
  4. **NEW, and it is the highest-risk assumption in the whole design: are decisions clusters?** Everything downstream rests on it: the anomaly-to-question ratio, the four-questions-not-four-hundred promise, the budget, and above all `E(q)`, where cluster size **is** the value term. The evidence offered for it was four DEC sentences chosen *because* they cluster, and the counter-evidence is in the same file. **Method:** take `wiki/registry-sys-ids.md` (193 table rows, about 130 sys_id-bearing artifacts) plus the 33 DECs and count, per DEC, the artifacts it governs. Plot the distribution. **Kill criterion, written first: if the median is 1 to 2, cluster-size-as-value is measuring the wrong thing and the top-N systematically buries the decisions that matter.** The hand count in 4.9.5 already suggests roughly 12 govern four or more, 17 govern one to three, and 4 govern none; phase 0.1 makes that a measurement rather than a reading.
  5. **NEW: score QS-08q's gated yield directly against the pilot customer's repo.** QS-08q is `shadow` at run 1 because its precision after the doc-repair split (4.9.3) has never been measured, and **devinst01 has no repo, so the PoC structurally cannot measure it.** the pilot customer is the only place it can be evaluated before a customer engagement, and it produced the only genuinely novel finding in the whole record. Replay the five-stage trace over the 26 audited claims and count how many pass the token-absence test. **This is the cheapest path to admitting the engine's best signal.**
- **The decision it forces.** If (2) is at or near zero, **relabel the near-term deliverable as a debt register before writing code** (4.10) and re-scope phase 3. If (4)'s median is 1 to 2, **`E(q)` is re-derived before `questions.js` is written**, because the ranker carries the safety load (4.9.6) and a defective ranker is not a tuning problem. If (5) clears 0.60, QS-08q is `admitted` and the PoC's question count may rise above 5. **All three are cheaper to learn now than in week eight, and (4) must run before any of `questions.js` exists.**

### Phase 0.2: the ablation. A prior that sizes phase 3, not a kill gate.

- **Goal.** Measure how much of the probe suite's pass rate is attributable to the machine-derivable tiers.
- **Method.** the pilot customer's 9-probe suite in four repo configurations, roughly 36 headless sessions. A: kernel only. B: kernel plus hand-written tiers. C: kernel plus machine-derivable tiers. D: full wiki (known baseline 8/8).
- **Deliverables.** `_lab/probes/answers/RESULTS-ablation.md` (a read-only measurement at the pilot customer, not a change). Effort 1 day.
- **How we know it worked.** **C minus A is the entire measurable value of everything `bootstrap-project-brain.js` produces.** Note what it does **not** measure: the question leg. Under C3 that is the product, so a low C minus A no longer authorises cancelling the programme, it authorises shrinking MAP's rendering ambitions and spending the saving on 4.9.

### Phase 0.3: re-run the drift check. Size VERIFY's target.

- **Goal.** Confirm the one feedback signal ever measured, and get a current rate.
- **Method.** Re-query the 26 claims from `audit-phase0-findings.md:208` plus the registry rows stamped `verified 2026-07-24`. Roughly 26 queries, half a day.
- **Deliverables.** A drift table with per-claim verdicts, plus a first-cut `claims.jsonl` hand-built from those 26 claims. This is phase 2's regression fixture.
- **How we know it worked.** Drift near 0 means no maintenance loop is justified. Drift above 10% again means the drift loop is real, and by 4.10 it is also the supersession engine underneath the decision ledger.

### Phase 1: the deterministic floor plus the transport probe. Cheap, decisive, useful regardless.

- **Deliverables.**
  - **`spikes/scriptsync-read/RESULTS.md`** per 6.12/WP-A, **eleven** probe items with kill criteria written first. **Half a day, and items 10, 9 and 11 run before anything else in the phase**: the session-privilege read, the provenance distribution, and (new in revision 4) the `sys_customer_update` reliability probe. A near-empty customer-authored surface, a surface dominated by base and demo records, and a dead A3 rung each invalidate the PoC design rather than just a work package. [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, which is what item 11 actually probes.]
  - `tools/snbrain/validate.js`: links resolve, frontmatter conforms to CONTRACT per tier, slugs canonical, `mentions:` reverse index builds, `instance` plus `capturedOn` present and non-mixed, per-page token cap. **Cap: 4,000 tokens per page, warning at 3,000**, derived from `budgets.alwaysOnTokens` of 14,000 and the routing map's habit of loading two to three pages at once. Exit non-zero on failure.
  - Fix the scaffold so it passes its own contract (`verified:` on registry tier, `mentions:` on every page) and populate the canonical slug list.
  - Fix `kernel/CLAUDE.template.md:96` (remove the `../`).
  - Generalize `render-kernel.js` to emit `.claude/settings.json` and `.github/hooks/*.json` from one spec.
  - `probes/run-probes.sh` rewritten as `tools/snbrain/probe.js`: mechanical assertions, `--runner` flag, exit code, `RESULTS.md` appended automatically.
  - **`sn-write-guard.js` returns `deny`, not `ask`** (B8), and stops exiting 0 on unparseable payloads.
  - **`spikes/copilot-capability/RESULTS.md`** per 5.4, kill criterion written first. Gates the phase-4 estimate.
  - `docs/config-slots-v2.md`: the slot list from 6.11, **all with defaults**, plus the corrected note that `render-kernel.js` only validates the nine slots the kernel template interpolates.
  - A skills-layer decision record (2.4) and `docs/playbook-reconciliation.md`.
- **Effort.** 3 to 4 days build plus 1 day for the two spikes and two decision records. **One person.** If that assumption is wrong, every estimate here is wrong.
- **How we know it worked.** `validate.js` reproduces the known the pilot customer contract violations on a fixture copy and reports zero on a corrected one. The probe runner reproduces 8/8 unattended with **zero human grading steps**, which is the property `run-probes.sh:37` lacks. WP-A converts at least six [DOC] or [OPAQUE] rows in 6.2 to [SRC] or measured.

### Phase 2: the question engine, the claim ledger and the L1 verifier. **The core, and the ordering changed.**

- **Goal.** Build the thing that produces questions, the substrate that makes anomalies addressable, and the one rung that can close a loop. Revision 1 put the question engine nowhere; it is now first in this phase.
- **Deliverables.**
  - **`tools/snbrain/questions.js`** per 4.9, and **revision 4 changes what it contains.** The scope filter with its four-part discrimination gate and three terminal states including `authored-but-undeliberate` (4.9.2); the eleven surviving signals only, with the nine deletions in 3.3b **not implemented at all**; **backtest-seeded priors with `priorSource` stamped on every question**; the **`C_signal >= 0.60` admission floor plus the shadow queue** and `questions shadow` / `questions admit`; `E(q)` in its corrected non-quadratic form (4.9.5); `U(q)` computed post-merge over ledger dependencies, not sibling questions; the six anti-waste gates **with per-run availability stamps** and **AW-5 relocated to post-rank top-N**; `.brain/questions.jsonl`; the suppressed-candidates list; the per-gate kill distribution with unavailable gates reported as zero.
  - **`tools/snbrain/decisions.js`** per 4.10: `.brain/decisions.jsonl`, `rationaleStrength`, the `witnessClaims` versus `explainsClaims` split, and **the supersession flag fired from a drifted claim.** That last one is the product's unique argument and it must exist before anyone pitches it.
  - **`tools/snbrain/provenance.js`** per 4.11: the P1 to P10 envelope indexed by `sys_update_name` (**with the three composite-key forms unit-tested**, or dictionary, choice and label provenance is silently lost), the induced story pattern used for parsing only, the open-to-closed question conversion, and the `provenance:` stamp.
  - `tools/snbrain/read/scriptsync.js` plus `read/guards.js` per 6.3 and 6.4, sized after WP-A.
  - `tools/snbrain/claims.js`: ledger read/write, content-hashed ids, staleness computation.
  - `tools/snbrain/verify.js`: the check framework (architecture ported from `gate.js`), L1 replay, L2 cross-source, evidence-pack output, exit 0/1/2.
  - `tools/snbrain/state.js`: index-plus-pointers state, correct `show`, `reset`/`accept`/`override` verbs, `finish` guard.
  - `tools/snbrain/test/run-tests.js` with `testEveryCheckIsExercised` ported verbatim, plus **`testEveryGuardIsExercised`** in the same shape.
  - `docs/LOOP.md`.
  - **Moved into this phase in revision 3, from phase 3: the provenance ladder R-a to R-d** (6.6). It is read-adapter work, the read adapter is built here, and QG2's clustering key `(table, change-type, author, time-window)` is **derived from R-b and cannot be built without it**. Leaving it in phase 3 meant shipping a question engine whose primary clustering input did not exist yet. The go/no-go *policy* stays in phase 3 where MAP lives; the *reads* come here.
- **Dependencies.** Phase 1. Phase 0.3 supplies the first real ledger. **Not blocked on any licence question** (C1c deleted it).
- **The honest constraint on this phase, stated because section 10's ordering invites the wrong assumption.** Everything here is built and tested **against fixtures**, not end to end. QG3's blast radius needs a reference graph that 26 hand-built claims do not have; QG1 needs L2 contradictions at a volume only MAP produces; QG5 needs a provenance sweep that phase 3 schedules. **Phase 2 proves the engine's arithmetic. Phase 3 is the first time the engine sees a real universe.** That is the correct order under C3, and it is not the same as the engine working after phase 2.
- **Effort.** 2 weeks, one person. **Revision 4 adds roughly 2 days** for the shadow queue, the availability stamps, `provenance.js` and the composite-key tests, and **removes** the nine deleted signals plus AW-5's 150-run cost, so the net is close to flat.
- **How we know it worked.** Seven falsifiable tests. (i) Re-run phase 0.3's 26 claims through `verify.js` and reproduce the hand-derived verdicts exactly. (ii) `verify.js` returns 2, not 0, when the instance is unreachable. (iii) **Replay the pilot customer's DEC-006/008/009/010 fixture through `questions.js` and get 4 questions, not hundreds.** The cluster-then-ask acceptance test, and the best test in the plan because the ground truth is written down. (iv) Mark a claim drifted and confirm every DEC linked to it flips to `needs-reconfirmation` unprompted. (v) **NEW: replay the the pilot customer fixture and reproduce the backtest's recall, 5 hits with the corpus mounted and 2 with it dismounted**, per question. A different number means the implementation is not the design that was backtested. (vi) **NEW: assert `E(q)` is sub-linear in cluster size** on a synthetic fixture (a 12-member same-table cluster must not score above 4.5x a comparable singleton), which is the regression test for the quadratic defect. (vii) **NEW: run with the corpus dismounted and assert AW-2a reports `availability: 'no-structured-corpus'` and exactly 0 kills**, rather than being absent from the report.

### Phase 3: MAP reworked as a question generator, and the VERIFY loop closed.

- **Deliverables.**
  - `tools/snbrain/map.js` with the `next`/`ingest` protocol, per-agent staging files, CLI-side merge with central slug allocation, streamed retrieval to `.brain/raw/*.ndjson`, per-phase terminal states, budgets in code, and the terminal state **`inventory-only`**.
  - **The scope filter as the preflight go/no-go** (3.3/QG5 as corrected by 4.9.1/C-b, 4.9.2, 6.6). **The R-a to R-d reads moved to phase 2** with the rest of the adapter; what lands here is the *policy*, run before harvest. **Discriminates, not merely exists:** an authorship column returning `admin` for 95% of rows has passed a presence test and failed the only test that matters (11.1's base-data confound, WP-A probe 9). **Three terminal states, not one:** `inventory-only` (no authored surface), `filter-non-discriminating` (we cannot separate your work from ServiceNow's), and **`authored-but-undeliberate`** (we can see what you built, we cannot see what you decided), the last driven by one `stats` group-by on `update_set.is_default` at a default threshold of 0.50.
  - Harvest areas derived from census evidence, not a literal array.
  - The triage rule for inactive artifacts (9.7 item 3), now implemented as QG3's blast-radius count rather than a paragraph.
  - `.claude/agents/brain-claim-verifier.md` plus the rendered Copilot mirror; maker/checker with claim-text-only briefs.
  - `tools/snbrain/render.js`: claims to DRAFT pages, `status:` computed not written. The de-DRAFT validator (4.7). L3 round-trip, sampled and budgeted.
  - **Retire the whole `bootstrap-project-brain` surface, not just the file.** Revision 2 said "delete `.claude/workflows/bootstrap-project-brain.js`" and stopped there. Three other things point at it and would be left dangling: **`.claude/skills/bootstrap-project-brain/`** (the 48th skill, whose SKILL.md carries the DRAFT doctrine at `:20-24` that 4.7 is replacing), **`README.md` step 4**, which is the customer-facing instantiation instruction and names the skill and workflow by name, and the `probes/README.md` rule that the suite re-runs after any skill change. Migrate the doctrine, delete the workflow, rewrite README step 4 to name `snbrain map`, and re-run the probes.
  - Reconcile the playbooks against one canonical definition of done.
- **Dependencies.** Phase 2, and phase 0.2 must have reported.
- **Effort.** 2 to 3 weeks, one person.
- **How we know it worked.** A killed and resumed MAP run completes correctly. **Two runs against the same instance produce an identical ledger, except for claims whose `sys_updated_on` moved past the run-start watermark, which must be reported as `changed-in-flight` and not as a diff** (G4). Bit-identical was never achievable on an instance its owner is actively developing on, and demanding it would have made the test fail for the right reason and be read as the wrong one. A deliberately failed harvest agent produces terminal `partial`, not a confident report. **A run against an instance with no authorship evidence produces `inventory-only` and zero questions, not "no changes found".** **NEW: a run against a fixture whose authored change is >50% Default-set produces `authored-but-undeliberate` and admits only A2-evidenced loci**, which is the devinst01 branch and the one the PoC is most likely to hit (11.2, S1).

### Phase 4: the Copilot shim, then the PoC.

- **Deliverables.** `.github/agents/*.agent.md` rendered from the same spec, `.github/hooks/*.json`, a documented `--runner` matrix, and the PoC per section 11.
- **Dependencies.** Phase 3, and the 5.4 spike must have reported before this phase is estimated.
- **Effort.** 1 week plus the run, conditional on the spike.
- **How we know it worked.** Agreed in advance and falsifiable: (1) claim-id Jaccard between the two runners >= 0.90, mechanical because ids are content hashes; (2) verdict agreement on the intersection 100%, because L1 is CLI-side and one divergence is a defect, not a tolerance; (3) identical census scope list and per-table artifact counts; (4) terminal states match or the difference is an operator-set budget; (5) the probe suite passes identically under both runners. Below (1), the honest answer is "the output is portable, the loop is not", which is acceptable **provided it is written down rather than quietly shipped**.

---

## 11. THE devinst01 PoC

Replaces revision 3's section 11 in full. Revision 3's version was placeholder text written from a briefing; this is the run design, corrected by the backtest. This is not a customer mapping. It is a proof of concept on `https://devinst01.service-now.com/`, the developer's own dev instance, with him as the SME. He is the creator of SN Utils and sn-scriptsync, the transport this product is built on, he is doing us a favour, and **his time is the scarcest input in the whole programme.**

One structural fact governs every design choice below. **He is two oracles, not one.** He is the instance oracle (every decision on devinst01 is his) and he is the transport oracle (every question about sn-scriptsync is his). Those roles have different value, different half-lives and different failure modes, so they get two strictly separated question sets, two metrics and two messages. Mixing them is the easiest way to waste the evening.

### 11.1 What this PoC proves, and what it cannot

#### The four legs it does prove

**P1. Transport viability under real load. Fully proven, and it transfers 1:1 to a customer.** Nothing in section 6 has ever been executed and no query has been issued against devinst01 from this environment. This is the first time the read adapter, the R1/R2 rung selection, the paging rule, the timeout model and the retry model meet a live instance at sweep volume: roughly 700 reads, not the 18 the the pilot customer audit used (`audit-phase0-findings.md:208`). Every `[OPAQUE]` row in 6.2 either converts to measured or comes back with a stated reason it could not be. Instance-agnostic: a pass here is a pass everywhere the extension runs.

**P2. Guard correctness. Fully proven, also instance-agnostic.** G1's negative control (an invalid field returns *unfiltered* rows with no error) and G1b's value-encoding control (`query.js:35,37` concatenates raw) are platform behaviours, not customer behaviours. G2a/G2b, G7's truncation verdict, G8's count reconciliation and G4's watermarks are exercised by the harvest itself. **A guard that never trips across 700 reads is either decoration or unwired**, so probes 6 and 7 exist precisely to make at least two guards trip by construction and remove the ambiguity from a zero-trips result.

**P3. Question precision at the ceiling.** He can give fast, certain verdicts on every anomaly the engine surfaces: deliberate, bug, or stock ServiceNow. No customer SME can do that as reliably or as fast. **It yields an upper bound and nothing else.**

**P4. Decision capture at maximum quality, as a ceiling, with a domain caveat that cuts hard.** His WHY is available at a quality no customer offers. But most of it is *product-design* rationale for SN Utils, much of which is publicly documented in his own repos, which makes it maximally derivable and therefore scores as a **wasted** question under this PoC's own metric (11.4/M3). The class the product exists to capture, why this SLA, why this approval chain, why this scope placement, is business-domain reasoning, and those artifacts largely do not exist here for the engine to fire on. **P4 proves the interview mechanics and the ledger plumbing at the ceiling, not the yield.**

#### The one thing this instance has that no customer has

The person who made every decision on the instance also wrote the tooling we read it with, and he is available. That is why the run is worth doing at all, and it is why Set B (11.3) is not a side dish. **Set B is arguably worth more than Set A: instance answers are worth one PoC, transport answers are worth every engagement thereafter.**

#### The six legs it does not prove, and cannot

| Leg | Why it is out of reach here | Consequence for the report |
|---|---|---|
| **Brownfield scale** | A vendor's dev instance is not a 4,000-row-per-table implementation. 11.2's budget is a courtesy budget, not a scale test. | Never quote this run's wall clock, call count or cost as a customer estimate. 6.4's projection stays labelled a projection. |
| **Archaeology depth** | Expect thin or absent update-set provenance (9.7 item 1, predicted before the target was known). The R-a to R-d ladder may bottom out at R-b. | If it bottoms out, that *is* the finding, and `inventory-only` or `authored-but-undeliberate` gets exercised for real. |
| **Multi-scope reality** | One owner, no scope politics, no competing teams. | The scope-filter numbers in 11.4/M8 are measured on the easy case. |
| **Business-domain vocabulary** | There is no accident report-expands-to-Case-Bedrijfsongeval class fact here. 9.3's domain-vocabulary gap is untouched, and **QS-10a, one of only two admitted signals (4.9.3), is therefore dead or degenerate on this target.** | Do not report domain-vocabulary capture as tested. It was not. |
| **ACL-restricted reads** | The session is almost certainly `admin` (U19, WP-A probe 10). Every read returns everything, so **a partial read caused by row- or field-level ACLs is indistinguishable from a complete one**, and G8 catches only the row-count case, never field-level redaction. | Stamp `aclExposure: 'none'` and say the class was **structurally out of reach**, not untested by oversight. The first non-admin engagement is a spike, not a rollout. Price it that way. |
| **NEW, from the backtest: the engine's highest-yield signal.** | **QS-08q needs a doc corpus and devinst01 has no repo.** At the pilot customer, QS-08 produced the only genuinely novel finding in the whole record (Q7 / STRY0185005). The signals that remain are the structural ones, and the pilot customer's data says those largely rediscover what the customer already wrote down: **six of the engine's roughly 12 best the pilot customer questions are already in the pilot customer's own TBD register.** | Say in the report that the run measured the structural signals only, and that those are the ones with the weakest novelty evidence. **The positive claim for QS-08q is measurable elsewhere at zero cost: phase 0.1 scores it against the pilot customer's repo directly.** |

#### Two modality caveats that go in the report, not the appendix

**He is the best-case oracle in existence**, having built the platform and maintained it as a product with recall continuously refreshed by users. The modal customer SME is the the pilot customer case: a busy architect who could not explain his own change from ten days earlier (`_lab/INTERVIEW.md:68`, "dunno what's going on here tbf"), with a measured unanswerable rate near 20%. **A good result predicts nothing about a customer. A bad result is decisive.** He is also a **socially compromised** oracle: a collaborator doing us a favour has every incentive to be generous, and a generous respondent answers weak questions as readily as strong ones. That is what the decoy control (11.4/M4) detects, and if the decoys draw substantive answers, question precision this run is **void** and we report it as void.

#### Two run-shaping facts about this instance, both from the backtest

**The scope filter passes cleanly here while missing this instance's actual failure mode.** Gates 1 to 3 all pass: Band A is non-empty, one owner's work against a base install is far below the 0.35 share, and the top Band A author is a person while the top Band C author is an install account. But Band A on a vendor's personal dev instance is dominated by **product-development scratch**, genuinely customer-authored and worthless to ask about because there was never a decision, only tinkering. That is why gate 4 exists (4.9.2) and why S1 below is a hard stop.

**The run starts with two of six anti-waste gates dark.** AW-2a has no structured corpus (no repo) and AW-3's already-governed arm has an empty ledger (run one). Both are stamped and both report **zero kills rather than absent**, so the operator can see it.

#### The base-data confound, unresolved and owned by the operator

`ven*` is the vendor and technology-partner instance pattern, not the customer pattern, and the vendor's own roster example pairs `ven08329` with `devinst01` (`snu-agent-api/SKILL.md:428-430`). An instance of that class is a base release install plus demo data plus whatever its owner built, and demo records frequently carry `sys_created_by = admin` or an install account. That produces the failure **opposite** to the one 9.2b worries about: not too few authored-looking records, but a flood of base and demo records that pass a naive authorship filter. Recorded as U19; measured by S1's distribution, not asserted here.

**The decision-capture evidence this instance structurally cannot provide comes from phase 0.1's the pilot customer retrospective backtest, and costs nothing.**

### 11.2 The run protocol

Seven stages, each with a **numeric** go/no-go gate. No stage begins until the previous gate is evaluated and the verdict is written to `.brain/state/<runId>.json`. Every gate has a defined stop-and-report branch, because a stopped run that reports a real finding is worth more than a completed run that measures nothing.

#### Query budget

| Stage | Purpose | Expected | Hard cap |
|---|---|---:|---:|
| **S0** | Preflight, canary, capability capture (WP-A's now eleven probes) | 28 | 44 |
| **S1** | Provenance and deliberateness detection | 15 | 27 |
| **S2** | Census (counts per table per scope) | 70 | 120 |
| **S3** | Scope-filter calibration (machine only) | 24 | 40 |
| **S4** | Harvest | 420 | 700 |
| **S5** | Claim ledger, guards, stratified re-verification | 130 | 200 |
| **S6** | Watermark close, reconciliation, read-only proof | 36 | 60 |
| | Reserve (retries, canary re-issues, batch-abort recovery) | | 109 |
| **Total** | | **723** | **1,300** |

Wall clock is the real constraint, not calls: `maxConcurrency: 1`, sustained 1 read per second, burst 3, so 1,300 reads is about 22 minutes of pure transport and the model's reasoning dominates. Budget **two connected sessions of 60 minutes or less** inside the agreed window. `requestTimeoutMs: 75000` (must exceed the server's 60 s browser deadline; do **not** inherit `lib/api.js:17`'s 30000, which abandons live requests and discards the eventual reply). `maxAttempts: 2`. `E_SERVER_NOT_RUNNING`, `E_BROWSER_DISCONNECTED` and `E_ACL` are terminal, never retried.

#### S0, preflight and canary (28 calls)

WP-A's probes (6.12) **with items 10 and 9 first**, then 1, 8, 2, 3, 6, 7, 4, 5, 11.

- **Probe 10** (1 call): read the session user's roles. If `admin`, stamp `aclExposure: 'none'` immediately. Cheapest honesty item in the run.
- **Probe 8** (1): `get_capabilities`, record the `gates` block **verbatim**. Assert `createArtifacts:false` (it defaults **true**, so it must be explicitly turned off), `restRequest:false`, `deleteRecords:false`, `backgroundScripts:false`, `browserDebugger:false`.
- **Probe 1** (1): `rest_request` GET `/api/now/table/sys_scope?sysparm_limit=1` with `restRequest.enabled` off. Confirms the browser hop passes an ungated GET on **this** instance.
- **Probe 2** (3): `sysparm_offset` over `sys_dictionary`, page 1, page 2, page 2 repeated. Success requires page 2 differing from page 1 **by row-identity diff**, not by row count.
- **Probe 3** (1): `/api/now/stats/sys_script?sysparm_count=true`.
- **Probe 6** (2): negative control, a deliberately invalid field in an encoded query.
- **Probe 7** (2): value-encoding control, a value containing `&` through R1 then through R2.
- **Probe 4** (1): `get_table_metadata` on a table extending `task`; record whether a `columns` key exists at all (`records.js:408`).
- **Probe 5** (about 10): page-size bisection on `sys_update_xml` including `payload`.
- **Probe 11, NEW** (2): the `sys_customer_update` reliability probe (4.9.2/F8). 50 rows from a known base package and 50 from a known customer scope with `sysparm_fields=sys_update_name,sys_customer_update,sys_mod_count,sys_package,sys_created_by`. **Kill criterion, written first: if `sys_customer_update` is true across both populations indiscriminately, A3 is dead and the clone-resilient path is A1 only.** [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, the two calls read that instead, and A1 is the clone-resilient path either way.]
- G2a identity canary (1) and the run-start watermark seed (3).

**Gate S0 to S1.** All of: probe 1 returns 200; probe 2's page 2 differs; probes 6 and 7 confirm the predicted corruption; the gates block matches the required state; the identity canary passes. **A probe 1 failure collapses R2 and is a stop-and-report, not a degrade-and-continue**, because a count-less, absence-less run cannot support the claim ledger.

#### S1, provenance and deliberateness (15 calls). The highest-information stage on the list.

1. `sys_update_xml` row count across all update sets **including Default** (1).
2. `sys_update_set` count by state, and whether names follow any convention (2).
3. `sys_update_version` row count, plus the count of records holding **more than one** version (2). Multi-version history recovers prior values; single rows recover nothing.
4. `sys_metadata` count where `sys_created_by` is not an install account (1).
5. **The distribution, four calls, and it detects the confound:** group `sys_metadata` by `sys_created_by`, by `sys_package`, by `sys_scope`, and count rows with `sys_mod_count > 0` inside non-base packages. Reported as distributions, never as totals.
6. `sys_metadata_delete` count (1), the GONE class.
7. `sys_app` and store-app version plus upgrade history (2): how this instance ships, and clone recency. **Also computes F9**, whether a `sys_store_app` publisher matches a human account in the author distribution, which is the case where his most decision-rich artifacts land in Band C.
8. **The deliberateness test, NEW, one call, thirty seconds:** `/api/now/stats/sys_update_xml?sysparm_count=true&sysparm_group_by=update_set.is_default`, restricted to the install floor.
9. Reserve (1).

**Gate S1 to S2, and it decides which PoC we are running.**

| Condition | Verdict | Action |
|---|---|---|
| >= 200 authored `sys_metadata` rows **and** >= 25 distinct R-b change episodes **and** top author < 80% of authored rows **and** Default-set share of authored change <= 0.50 | **GO** | Full protocol. |
| 50 to 199 authored rows, or 10 to 24 episodes | **GO, DERATED** | Pre-register now that Set A may come back under 5 questions; the shortfall is the result, not something to pad. |
| < 50 authored rows, or < 10 episodes, or >= 95% of "authored" rows are `admin` inside base `sys_package` | **BRANCH B-EMPTY** | below |
| **Default-set share of authored change > 0.50** | **BRANCH B-SCRATCH, NEW** | below |
| > 12,000 authored rows, or > 60 scopes | **BRANCH B-LARGE** | below |

**Branch B-EMPTY, the instance is nearly empty (or is demo data wearing an author's name).** Do **not** run harvest, and do **not** run archaeology and report "no changes found", which is the same silent-empty failure the guard layer exists to prevent, one level up the stack. Emit terminal **`inventory-only`** with the reason stamped and **zero instance questions**. This is not a wasted run: it is **phase 3's stated acceptance test passing on a real instance**, and P1 plus P2 are fully preserved because S0, S2 and S6 still run. Set B goes to the developer unchanged. Report it as the headline: *a vendor dev instance has no customer-authored surface, and here is the number.*

**Branch B-SCRATCH, the instance is authored but undeliberate.** This is the branch the backtest added and the one 11.1 says is most likely. Emit terminal **`authored-but-undeliberate`**, run the harvest for P1/P2/M8 (the transport and guard legs are unaffected), and **raise instance questions only from loci that carry A2 evidence**, that is membership in a named completed non-default update set. Concretely, **4.9.1/C-c applies: A2 is reinstated locally as a go/no-go for the provenance-dependent signals *and* as an admission requirement for the current-state ones.** If that leaves fewer than 5 candidates, send fewer (11.3). Report line: *we can see what you built, we cannot see what you decided, and here is the ratio.*

**Branch B-LARGE, unexpectedly large.** Do **not** widen the budget. Freeze it and stratify: rank scopes by authored-row count, take the top 3 plus `global`; switch S4 from enumerate to **sample**, 200 rows per (table, scope) stratum, `ORDERBYsys_id`, stamped `completeness: 'budget-capped'`; **forbid every count and absence claim outside a fully-enumerated stratum** (G7's rule at stratum level); report S2's census counts as the honest denominator (9.6 rule 2).

#### S2, census (70 calls)

One `/api/now/stats` count per (table, scope) pair across 6.5's scope list, restricted to scopes S1 found non-trivial. If probe 3 showed `/api/now/stats` blocked at the browser hop, fall back to enumerate-and-count with a row budget and stamp every total "counted only what we enumerated". There is no third rung: `X-Total-Count` is structurally unreachable (`_shared.js:62` returns `{status, data}`). Also here: **domain-separation detection.** `count(domain) > 1` with no explicit domain decision is terminal `blocked`.

**Gate S2 to S3.** Census completed for every in-scope table, or the missing tables are named and marked `unverifiable: blocked-by-access`. Zero tables silently absent.

#### S3, scope-filter calibration (24 calls). Machine only.

1. Assemble a **negative control set**: 3 records per table family that are certainly base (`sys_mod_count = 0`, base `sys_package`, `sys_created_on` in the install date cluster).
2. Assemble a **positive control set**: 3 per family with an R-a version history, or an R-b episode with a human author outside base packages.
3. Evaluate the A1 to A4 predicates plus the three composite candidates against both sets, recording all scores, not only the winner's.
4. Choose the predicate with **zero false admits on the negative control** and the highest true admits on the positive control.

**Gate S3 to S4.** The chosen predicate admits **0 of the negative control set**. If none does, the authorship signal does not discriminate here, and the run **falls through to B-EMPTY**. Presence of an authorship column is not discrimination and this gate is where the distinction is enforced.

#### S4, harvest (420 calls)

Budgeted, guarded, **serialized** transport, provenance-scoped universe, per-phase terminal states, streamed to `.brain/raw/*.ndjson`. Field allowlists always; never `SELECT *`; never read `script` in a sweep (read it per claim via `get_record`, and per 4.11's P8 only on post-gate survivors). `pageSize: 100`, `widePageSize: 25`, both replaced by probe 5's measured ceiling the moment it exists.

**Gate S4 to S5.** Terminal state is `complete` or `budget-capped` with the capped strata named. A `partial` from a failed harvest agent is honest and allowed; a confident report from a failed agent stops the run.

#### S5, claim ledger, guards, stratified re-verification (130 calls)

Write claims with content-hashed ids. Run G3 negation controls where the negation is mechanically derivable; use G8 count reconciliation for everything else; write every G3-suppressed and budget-suppressed candidate to the named `suppressed-candidates` array. Then the **stratified precision sample**: 5 strata by 12 claims = 60, re-verified by an **independent path** (R2 if originally R1 and vice versa, plus `get_record` on the sys_id).

**Gate S5 to S6.** Sample precision **>= 85% (51 of 60)**. Below that the run does not proceed to question generation: a ledger that is 15% wrong generates questions that are 15% wrong-premise, and **wrong-premise questions are the single most expensive way to spend his goodwill.**

#### S6, close, reconciliation and the read-only proof (36 calls)

Closing watermark per table (the two watermarks bracket the run and the delta is its own uncertainty band); G8 recount on a 10-table sample to catch in-flight change; the `sys_audit` and `sys_update_xml` delta read that is the independent half of the read-only proof (11.5); `get_capabilities` re-read to confirm the gates block is unchanged since S0.

#### S7, the interview (no instance calls)

1. **Blind recall elicitation. Ten minutes, before he sees anything of ours.** "Name five things about this instance a new consultant would get wrong." Recorded verbatim, sealed, timestamped. **Highest-value ten minutes in the run and it must happen first.**
2. **Question generation** per 4.9: scope filter, catalogue, ranking, gates.
3. **Admission floor applied**: `C_signal >= 0.60`. Shadow questions go to the operator, never to him.
4. **Operator pre-rating**, pre-registered and committed to git before sending.
5. **Decoy injection**: 4 noise decoys shuffled in.
6. **Send** Set A as one batch, plus the 60-record adjudication grid, plus Set B as a **separate message**.
7. **Score** per 11.4. **Disclose the decoys immediately and explicitly** after he answers.

### 11.3 The two question sets, kept strictly separate

#### Set A: instance questions, generated by the loop

**Target: 9 items = 5 engine-generated + 4 noise decoys.** Revision 3 said 10 and the recovered design said 8 plus 4. The backtest cuts it to 5.

**Why 5 and not 8, and it is arithmetic rather than modesty.** On devinst01 only QS-05a, QS-06a/b/c/d, QS-07a/c, QS-09b predicates 2 and 3, and QS-12 predicates 1 to 5 survive at strength. **QS-08q is dead with no repo. QS-10a is dead or degenerate with no business-domain vocabulary, and those two are the only signals `admitted` at run 1 (4.9.3).** QS-07b and QS-06e are structurally wrong on an unprovisioned dev instance and are refused. QS-04, QS-11 and QS-02 are dead or pure noise depending on whether update sets exist. After AW-1 you will not have eight candidates you believe in, and **padding to eight means shipping `C_signal` 0.40 items, which is exactly the waste this PoC's own headline metric punishes.**

> **Pre-registered, before the run: a hard admission floor of `C_signal >= 0.60`, and the rule that if fewer than five candidates clear it we send fewer and report the shortfall as the result.** On this target that may well mean two or three questions, or zero. That is the finding, not a failure to be padded, and the recovered minutes go to Set B, which is worth more per minute.

**Time budget.** At one line of context plus a question answerable in one or two sentences, about 90 seconds per item including reading: 9 items is about 14 minutes. Set B needs real thought and gets 25 to 30. Blind recall is 10, the adjudication grid is 4, the debrief and decoy disclosure is 15. **Total about 70 minutes, one evening, once.** Nothing is added to that envelope later.

**Why exactly 4 decoys, and this is arithmetic, not taste.** The decoy is the only falsification test in the PoC. Under the null that he cannot tell our noise from our signal better than a coin, observing **zero** substantive answers has probability 0.5^4 = **6.25%**. At 3 decoys it is 12.5%, too weak to call a falsification test. At 5 it is 3.1%, better, but 5 of 10 is half his instance-question time spent on our control and it reads as disrespect when disclosed. **4 is the smallest number that buys a sub-10% false-pass rate, and cutting the real questions to 5 does not change that arithmetic.**

**Decoy composition: 4 noise decoys and nothing else.** Revision 3 proposed "3 corrupted plus 2 whose answers we already hold". The second class is **cut**: it duplicates the L3 derivability oracle, which does the same job mechanically at zero SME cost under a specified id-match rule. Spending his time on a control we can run for free is exactly the waste this PoC scores itself on. All 4 are generated from **deliberately corrupted reads**, a fabricated contradiction between two real records, constructed locally with **no write of any kind** to his instance.

**Strict format. A contract, not a style note.**

```
A3.  [sys_ui_policy · cluster 14 · 2026-06-18 09:02-09:41 · akooi]
     Fourteen UI policies on <table> were deactivated inside forty minutes;
     one in the same cluster was left active.
     Was the one left active deliberate, or missed?
```

CLI-enforced before send: header line carries locus, cluster size, time window and author, and is skippable; context is **2 lines or fewer, 40 words or fewer**; exactly **one** question mark per item; answerable with yes/no plus one clause, or one or two sentences at most; cluster size visible, because "these 14, one answer" is a different question from "this one" and it is the difference between 5 questions and 500. **Ban list, enforced by regex before send:** anything opening "Why did you", anything asking him to recall a date or a number, anything open-ended, anything whose answer appears in the ledger (killed by AW-5 first), anything that is really two questions.

**The actual text of Set A is not draftable in advance and drafting it now would be fabricating the result.** The block above is a format specimen with placeholder content.

#### Set B: product questions about sn-scriptsync, drafted in full

**Checked against his own sources first**: `agentinstructions.md`, `agentrules/skills/**` (all seven SKILL.md files), and the compiled extension at `<home>/.vscode/extensions/arnoudkooicom.sn-scriptsync-4.7.6/out/agent/`. **Six candidate questions were killed because his docs already answer them.** Asking him something his own documentation answers is the worst possible opener, and the kill list is itself evidence of the discipline this PoC scores itself on. Show it to him.

| Killed question | Answered where |
|---|---|
| Is `rest_request` GET gated? | `snu-agent-api/SKILL.md` rest_request Gating block: "GET, always allowed"; and `package.json:321-326`. |
| How do I preflight `E_DISABLED`? | `agentinstructions.md:319-326` and `SKILL.md:340`: `get_capabilities` gives `gates`, all six named with defaults. |
| Does `reviewWrites` refuse or stage? | `SKILL.md:612`, `:661`, `:777`, three times: "parked in the Pending Saves queue, treat `staged:true` as queued for human approval, not applied." |
| Do reads need a browser tab? | `agentinstructions.md:348-350`, `E_BROWSER_DISCONNECTED` otherwise. |
| How do I discover port and token, and can I cache them? | `agentinstructions.md:352-363`: never cache; validate `pid` and `apiVersion` live each session; discover commands from `health.commands[]`. |
| Is `connected` per-instance? | `SKILL.md` `list_instances` notes: "`connected` is bridge-level (the one helper tab relays for every instance), not per-instance." |

**Also killed because our own probes answer them**, and asking for a number we can measure is the wasted question this PoC punishes: the relay response-payload ceiling (probe 5 bisects it), `/api/now/stats` reachability (probe 3, one call), `get_table_metadata` inheritance (probe 4, thirty seconds), and instance echo on responses (G2a already gives `identity: corroborated-by-canary`; hold it for a second round if he engages).

**Send-order rule: B1 and B2 first, and they stand alone if nothing else is sent.** They are findings about his product, not requests for ours. **Do not put the licence and attribution conversation in this message.** That is Q14, it goes in a different message, after B1 has landed and been received well.

**Crosswalk to 6.8, so nothing reads as a contradiction.** B1 = A1, B3 = A8, B4 = A2, B5 = A3, B6 = A4, B7 = A5, B8 = A6, B9 = A7. **B2 is new**: 6.7 item 3 diagnosed the correlation-id hazard for our own adapter but never proposed telling him, so 6.8's list becomes nine items when this ships.

---

**B1, finding. `update_record` and `update_record_batch` are covered by none of the four Agent API permission gates.**

> In 4.7.6, `create_artifact` throws `E_DISABLED` at `records.js:219` and `delete_record` at `records.js:321`. `update_record` (`records.js:110`) and `update_record_batch` (`records.js:164`) check only `ctx.reviewWritesEnabled()`, which stages rather than refuses and defaults to off. So with all four "Agent API permission (n/4)" settings off, an agent can still PATCH any field on any record. Intended, or a gap?
>
> Why we care: we want to run an autonomous read-only mapping pass and today we cannot close write capability at the capability boundary, so we have to enforce it in our own runner and say so in the report.

**B2, finding. Bare correlation ids collide when two agents share one workspace.**

> `_shared.js:34-37` builds a unique correlation id (`agent_<reqId>_<Date.now()>_<seq>`), so `rest_request` and `get_record` are safe. But `query_records` (`query.js:46`), `get_parent_options` (`query.js:87`), `get_table_metadata` (`records.js:398`), `check_name_exists_remote` (`records.js:422`), `code_search` (`search.js:82`) and four browser commands use a bare `agent_${ctx.request.id}`, the caller's own id.
>
> `pendingRegistry.register` does `pending.set(opts.id, ...)` (`pendingRegistry.js:20`), so a duplicate id silently overwrites the earlier entry. Two agents in one workspace both sending `"id": "q_1"` (the id in your own doc examples) get: the first promise rejected by the *second* entry's timeout, and the second promise never resolved at all. `transport/http.js:96` only auto-generates an id when the caller omits one, so this bites exactly the agents that follow the documented examples.
>
> We have made our own ids globally unique (pid plus counter plus random, matching `[a-zA-Z0-9_-]+` for `dispatcher.js` `VALID_ID`) and we pair the id check with a payload sanity check, because id equality cannot detect a cross-wire: it produces a matching id with the wrong body. Flagging it because the next multi-agent user will not know to.

**B3, question. Concurrency below the browser hop.** (The one genuinely opaque question in the whole transport.)

> We have read `pendingRegistry`, `dispatcher` and `runtime`, so we know the VS Code side interleaves rather than queues, has no semaphore or throttle, and correlates purely by id. The hop we cannot inspect is the helper tab.
>
> With six reads in flight from one workspace: does the tab fetch concurrently or serialize them? Is there an in-flight cap? And is there a read rate at which you would expect it to misbehave?
>
> We ship serialized (`maxConcurrency: 1`) by default, so the answer only decides whether we are allowed to open it up. A one-word answer is a complete answer.

**B4, feature request. A read-only master gate.**

> `sn-scriptsync.agentApi.readOnly`. When on, every mutating command returns `E_DISABLED`, and the flag appears in `get_capabilities.gates` alongside the existing six so an agent can preflight it.
>
> To be clear about the framing: **your current model is right for what sn-scriptsync is.** For a coding assistant, editing the script you are working on is the entire point, and `reviewWrites` staging a write for human approval is exactly the correct control, because a human is sitting there. The gap only shows up in a use case you never designed for: an autonomous read-only mapping run with nobody at the keyboard to approve or discard the queue. In that mode "staged" is neither applied nor refused, and a run that cannot refuse cannot claim read-only.
>
> We enforce it in our runner regardless, since the adapter has no write verbs at all. But runner-side enforcement is something we assert about our own code, and a gate in `get_capabilities` is something a customer's security reviewer can verify in ten seconds. That is the difference we would like to be able to offer. Happy to open a PR if it is useful.

**B5, feature request. Paging on `query_records`.**

> An `offset` param (or an opaque cursor) plus `hasMore` in the response. Today `query.js` builds only `sysparm_fields` and `sysparm_limit`, so a result of exactly `limit` is indistinguishable from a complete one, which makes every count and every absence claim unsound. We use `rest_request` GET with `sysparm_offset` instead, so this is not blocking us; it is the thing every sweep-shaped consumer will have to rediscover.

**B6, feature request. Return response headers on `rest_request`.**

> `_shared.js:62` returns `{status, data}` and drops the headers. `X-Total-Count` and `Link: rel="next"` would give honest totals and native paging for free. It looks like a one-line change and it would let us delete a whole fallback path.

**B7, feature request. Pass `display_value` and `exclude_reference_link` through on `query_records`.**

> Two booleans. You already pin `sysparm_display_value: 'false'` inside `readBackRecord` (`_shared.js`), which is why `get_record` is safe and `query_records` is not: on a non-English session `query_records` returns display values instead of stored values, and every downstream comparison silently corrupts. We route around it via `rest_request`, so again this is for the next consumer.

**B8, heads-up, not an ask. Raw query-string concatenation.**

> `query.js:35,37` concatenates the encoded query straight into the query string. A value containing `&`, `=` or `#` re-parses as a parameter delimiter and silently changes the filter, returning a clean 200 on the wrong query. We refuse those at our end and route them to `rest_request`, so this is a heads-up rather than a blocker. We would rather you knew than that we worked around it quietly.

**B9, lowest priority, and only if it is cheap. Warn on an unknown field in an encoded query.**

> `result.warnings: ["unknown field 'u_typo' on sys_script, clause dropped"]`. ServiceNow drops the clause and returns **unfiltered** rows, so a typo produces confident wrong output with no error. We are building the client-side `sys_dictionary` check that every consumer ends up building; a warning would let the next one skip it. Send only if WP-A probe 6 confirms the behaviour on 4.7.6, otherwise drop the item.

### 11.4 The metrics

#### The headline: question precision, defined so it is computable

"How many bought real WHY that could not have been derived" has three terms that are each unmeasurable as written: *bought real WHY* is judged by the respondent, who is generous; *could not have been derived* is a fact about **our ledger**, not his knowledge, so asking him is asking the wrong oracle; *wasted his time* is unobservable without a control. The operational version:

**Denominator: the number of engine-generated questions actually sent, which is 5 or fewer.** Decoys are excluded from numerator and denominator and have their own test. Questions killed at a gate are excluded but **counted and reported**.

| Outcome | Rule |
|---|---|
| `bought-why` | The answer carries a rationale a human supplied and the CLI can attach to a claim. Mints a DEC with `rationaleStrength: stated`. |
| `bought-intent` | Attribution and intent only, no rationale. Mints a DEC with `rationaleStrength: absent` plus a TBD if a follow-up is owed. This is the TBD-038 shape and it is a **partial success**, not a failure. |
| `already-derivable` | AW-5 should have killed it and did not. Counts as **waste** and is a gate defect, logged against the gate. |
| `unanswerable` | He cannot answer. Mints a TBD with owner and date. Not waste: it is the honest 20% and it is a first-class outcome. |
| `wasted` | Trivially true, stock ServiceNow, or product scratch. **This is the number the PoC exists to minimise.** |

**Report as counts with intervals, never as rates with thresholds.** At n=5 with 3 successes the 95% Wilson interval runs roughly 23% to 88%. **At any n he would tolerate this metric cannot reach significance**, and saying so is the condition for it meaning anything.

#### The full metric set

| # | Metric | SME cost | Type |
|---|---|---|---|
| **M1** | **Blind recall elicitation.** Of his five, how many our engine surfaced. Matched by the operator against the **full candidate list including suppressed and shadow candidates**, not against the sent 5, or it measures the cap rather than the engine. **The only recall-shaped evidence obtainable from an SME.** | 10 min | Counted |
| **M2** | **Operator pre-rating**, pre-registered and committed to git before sending. **Flagged, not hidden: this is the system's author grading his own system's output, unblinded.** Pre-registration stops post-hoc rationalisation and nothing more. Evidence about ranking order, never about question value, and it may not be quoted as the latter. | 0 | Counted, **self-graded** |
| **M3** | **Question precision**, the five outcomes above. | in the batch | Counted with a Wilson interval |
| **M4** | **Decoy control. The only falsification test in the PoC.** Count decoys drawing a substantive answer (any reply beyond "this is wrong", "not a thing", "no idea what this refers to"). **Pre-registered rule: 3 or more of 4 falsifies the run; 0 or 1 is a pass; 2 is inconclusive and is reported as inconclusive.** Response length reported as a ratio of medians with no threshold attached, because n=4 cannot support one. **Latency is dropped:** one emailed batch has no per-question latency and pretending otherwise would be the fabricated precision this document bans elsewhere. | in the batch | **Falsification** |
| **M5** | **Ledger delta.** Did the answer produce a new claim, promote a draft, or mint a DEC or TBD. | 0 | Mechanical |
| **M6** | **Claim precision** on the 60-record stratified sample, independent path. Gate at 51 of 60. | 0 | Mechanical, L1 |
| **M7** | **Guard trip counts**, per guard, across roughly 700 reads. **Zero trips on a guard whose control probe fired is a defect, not a pass.** | 0 | Mechanical |
| **M8** | **Scope-filter numbers**: band shares, author discrimination, Default-set share, and the three predicate scores from S3. | 0 | Mechanical |
| **M9** | **Per-gate kill distribution**, with unavailable gates shown as **zero rather than absent**, so the two dark gates are visible. | 0 | Mechanical |

#### The pre-registered ratios, corrected

Revision 3 pre-registered "two or more orders of magnitude of suppression, anomaly to question". **That measures the wrong step and it cannot fail.** Clustering alone already delivers two orders of magnitude before any gate fires: on the pilot customer, record-level detections in the low thousands become 204 clustered candidates, and the queue is still 89 to 155 deep afterwards. So pre-register instead:

1. **`candidates-after-gates / questions-asked`**, which is the truncation ratio and the number that actually describes what protects the SME. **Expected shape on devinst01: between 5 and 30. Above 30 means the ranker is carrying the entire load and the gates are decorative.**
2. **The fraction of asked questions whose `C_signal` is >= 0.60.** By the admission floor this must be **1.00**. Anything less is a rule violation, not a measurement.
3. **Per-gate kill counts with availability stamps** (M9).

**Deleted: "if AW-4d exceeds 20% of all kills the mechanical gates are underpowered".** That check cannot fail, because AW-4d only ever sees `3 × questionCap` candidates and can never account for a meaningful share of total kills. It was decoration.

**Where a model grades its own output, named in one place:** AW-4d (drop-only, closed vocabulary, capped, every drop logged) and M2 (operator pre-rating, unblinded, pre-registered, may not be quoted as evidence of question value). Nothing else in the run has a model in a grading position.

### 11.5 Safety and courtesy rails

- **Read-only, enforced at one runner-side choke point and PROVEN, not asserted.** Every read passes through a single `read()` in `tools/snbrain/read/scriptsync.js`; the adapter exports **no** write verb; `assertReadOnly` hard-fails unless `restRequest`, `deleteRecords`, `backgroundScripts` **and** `createArtifacts` are all false; `sn-write-guard.js` returns `deny`, not `ask` (B8); and `sn-scriptsync.agentApi.reviewWrites` is turned **ON** for the run because it is the only existing control that touches `update_record`. Stamped `readOnlyEnforcement: 'partial'` until B4/A2 lands.
- **The proof has two independent halves.** (i) A **pre-send request log**: every request is written to `.brain/raw/requests.ndjson` with method, endpoint and a payload hash **before** it is dispatched, so the log cannot be reconstructed after the fact. (ii) An **independent `sys_audit` and `sys_update_xml` delta** across the S0 to S6 watermarks. **This only works if he is not developing during the window**, because the transport rides his own browser session and our writes would be indistinguishable from his. That is a condition on the window, not a nice-to-have.
- **Blast radius:** writes only under the repo's `.brain/` and wiki root, declared at init; any write outside is terminal `blocked`.
- **His instance, his window.** Agreed in advance, and the window includes "no active development by him" for the reason above. He develops on devinst01 actively, which is also why G4's watermarks matter more here than at the pilot customer.
- **Serialized transport, one workspace, one lock** (6.7). No second VS Code workspace during the run: the WebSocket server binds a fixed port and a second one fails at bind.
- **No `switch_context`, no session mutation, no language switching.** `switch_context` mutates his browser tab's global update set and application scope.
- **Courtesy is a design constraint, not politeness.** One batch, not a trickle. Cluster sizes attached. Decoys disclosed **after** he answers, explicitly rather than quietly, because a collaborator who discovers unannounced decoys afterwards is a collaborator lost.
- **Rate and retry:** `maxAttempts` 2, `E_TIMEOUT` costs 60 s per attempt, `E_SERVER_NOT_RUNNING` and `E_BROWSER_DISCONNECTED` are terminal. `rejectForInstance` fails a whole batch at once, so retry logic and budget arithmetic must assume whole-batch rejection.
- **Data:** raw NDJSON stays local, `.brain/raw/` is not committed. His instance is his, and the same model-vendor egress question applies to it as to a customer's (Q13).

### 11.6 What he gets back

Five artifacts, all useful to him whether or not the PoC succeeds:

1. **Set B**, written against his own source with the line numbers named, so it costs him replies rather than research, plus the kill list showing what we answered ourselves.
2. **The two findings, B1 and B2**, delivered with file and line rather than as claims. B2 in particular is a real multi-agent hazard nobody has hit yet.
3. **The anomaly report on his own instance**: every candidate the engine surfaced, **including the shadow queue and the suppressed candidates**, with its evidence query, cluster, blast number and our verdict. On a dev instance he actively develops in, a cited list of "these 14 look co-deactivated, this one contradicts that one" has standalone value even where we judged it not worth asking.
4. **The read-only proof**: the pre-send request log plus the independent audit delta, which is a thing a security reviewer can check rather than a promise.
5. **The scorecard**, including the decoy result, the recall elicitation, the per-gate kill distribution with the two dark gates visible, and the explicit statement that this was a ceiling test on the wrong domain for the product's headline claim.

### 11.7 The the pilot customer fact-recall regression, unchanged

Per C5, the pilot customer remains the host of a platform fact-recall regression and nothing else. Four seed probes already in `probes/probes.md`, plus two additions, all platform-generic:

1. `create_artifact` scope takes the scope's sys_id, never the scope-name string.
2. Journal fields need direct assignment or `setJournalEntry`, never `setValue('work_notes', ...)`.
3. The workspace UI is `sys_ux_*`; `sys_aw_*` is banned.
4. A scoped write over the agent API requires **both** `switch_context` calls, the correct story-named set, then verification that `sys_updated_on` moved and a `sys_update_xml` capture exists.
5. A zero-row read of something that must exist means NOT CONNECTED, not absent.
6. An invalid field name in an encoded query drops the clause and returns unfiltered rows.

Target **6 of 6**, run before and after. Probe 3 depends on an unfilled kernel SLOT (`kernel/CLAUDE.template.md:18-20`) and therefore fails on a default render, which phase 1 fixes; until then the baseline is recorded as 5 of 6 with the reason, **never rounded up**. Grading is mechanical (required plus forbidden substrings) with an exit code.

### 11.8 What we need from the operator

1. **A read window on devinst01**, agreed with the developer, with confirmation that (a) no second VS Code workspace will hold a sn-scriptsync session during it and (b) **he is not developing on the instance during it**, which is what makes the read-only proof provable (11.5).
2. **`reviewWrites` turned on** for the duration, and confirmation that `restRequest`, `deleteRecords`, `backgroundScripts` and `createArtifacts` are all off.
3. **Ten minutes of his time before the run** for the blind recall elicitation. Highest-value ten minutes in the PoC and it must happen before he sees anything of ours.
4. **Agreement to the decoy protocol**, with disclosure after answering. If the operator judges this damages the relationship, say so now: the run loses its only falsification test and that consequence is recorded, not absorbed.
5. **Acceptance of `readOnlyEnforcement: 'partial'`** until B4/A2 lands.
6. **A decision on whether the held-out-scope calibration runs.** Only recall-shaped machine evidence available; declining it is a priced choice (9.6).
7. **Confirmation of the revised question count: 5 engine-generated plus 4 decoys, with a `C_signal >= 0.60` floor and permission to send fewer than 5** and report the shortfall as the result.
8. **One line on what class of instance devinst01 is** (U19): base and demo data, session privilege, refresh or reclaim cycles. **Only the operator can answer this and it changes WP-A probes 9, 10 and 11 and the whole of 11.1.**
9. **Pre-registration of the decoy decision rule** before the batch is sent: 3 or more of 4 decoys drawing substantive answers falsifies the run. Agreeing the threshold afterwards is not a falsification test.
10. **NEW: acceptance of the two revised pre-registered ratios** (11.4) in place of the anomaly-to-question ratio, which measures the wrong step and cannot fail.
11. **NEW: a decision on the four corrections the backtest forces** and which are live design questions rather than editorial ones: (a) the `register-gap` gate (4.9.1/C-a), without which the domain-vocabulary class is unreachable and the machine's one measured five-month error is unfindable; (b) QG5 moving to the scope filter (C-b) plus its devinst01 exception (C-c); (c) whether `glossary.md` counts as complete-by-construction for the register-gap gate, since without it QS-10a loses its gate; (d) whether P8 script-comment mining (30 to 60 records per run, post-gate) fits the data-egress posture in Q13, since it is the only rung that retrieves counter-knowledge verbatim and 9.3 currently says counter-knowledge is unproducible.

---

## 12. OPEN QUESTIONS FOR THE OPERATOR

**Deleted in revision 2, with the reason, so nobody re-opens them.** *Q1 (run the ablation first?)* answered by C7: build phases 1 and 2 in parallel with it, do not start phase 3 until it reports. *Q2 (does the `processes/` tier survive?)* dissolved: its premise was "the reference engagement never built it, 96 links into the void", and C6 refutes that (the content exists under `engagement-docs/Docs/20-technical/` and `wiki/index.md:60-73` routes to all 12 pages honestly). The residual design question is now smaller and lives in phase 3: pages are a **view rendered from claims** (4.7), so which tiers get rendered is a renderer config, not an architecture decision. *Q6 (who owns the sn-scriptsync licence question?)* dissolved by C1c: the author is a collaborator on this PoC, so it is FR10, a partnership item, and phase 2 is no longer gated on it.

**Q3. How far do we take T3 portability, and when?** Unchanged.
Options: (a) build the `next`/`ingest` protocol now with a Claude Code shim only, add Copilot in phase 4; (b) both shims from the start; (c) declare T1 plus T2 sufficient and revisit.
**Recommendation: (a).** It satisfies decision 4's architecture requirement at every stage, defers unmeasured Copilot risk to a point where the loop is proven, and keeps the increment small. Flagging honestly that (c) is what the pilot customer runs today and is defensible: Copilot does not need to *run* the loop, it needs to *benefit* from the output, which is plain markdown. If cost pressure appears, (c) is the fallback and it is not a failure.

**Q4. `unanswerable` and risk acceptance: who can invoke them, and does that get recorded in git?** Unchanged, and revision 2 adds a reason it matters more. the pilot customer's state files are gitignored, so the only durable record lives on one laptop.
**Recommendation:** ship `.brain/state/`, `.brain/claims.jsonl`, **`.brain/questions.jsonl` and `.brain/decisions.jsonl`** as **tracked** artifacts, keep `.brain/raw/` ignored, and require `--by` attribution on every `accept` and `override`. The two new files are the deliverable's audit trail under C3: a decision ledger with no provenance for its own entries is exactly the artifact this plan criticises elsewhere.

**Q5. What is the customer-facing claim? REWRITTEN for C3.**
The revision-1 wording promised a map ("for the parts of your instance we cover, every statement carries the query that proves it"). That is now the *supporting* claim, not the headline, because the map is the mechanism and the decision history is the product. Use:

> **"We find the things in your instance that nobody can explain, and we get them explained while the people who know are still here. Every statement we write carries the query that proves it and the date it was true. When one of those facts changes, every decision that depended on it is flagged for you automatically. We will tell you what we covered and what we did not. We will not tell you we covered everything, because no one can measure that."**

Three deliberate properties. It leads with the question and the WHY, which is where 9.2's other seven ninths live. Its middle clause is the supersession mechanism (4.10), which is the only thing here no markdown template can do and therefore the only durable moat. And it keeps the 9.6 coverage qualifier in the body rather than the fine print. **What it must not say near-term is "we build your decision ledger":** by 4.10 and 10.1 the demonstrated output is a prioritised, evidence-cited **debt register**, and the decision ledger is a build-time artifact discovery can only partially exhume. Sell the debt register, build toward the ledger.

**Q7. Does the pilot customer stay the reference engagement, and in what role?** Answered by C5, kept as a standing check.
the pilot customer is (i) the source of platform-generic doctrine and check bodies, (ii) the host of the fact-recall regression, (iii) **the source of phase 0.1's free retrospective backtest**, and (iv) **not** a target, not a shape and not a success criterion. Every use of the pilot customer in this document has been checked against that list in revision 2. Phase 0.2's ablation is a read-only measurement, not a change.

### New in revision 2

**Q8. Does the operator accept the relabelling of the near-term deliverable?** The evidence says the machine-plus-interview loop produces a **debt register** (TBD-038, TBD-040, TBD-042), not a decision ledger: all 33 the pilot customer DECs trace to build-time story documentation, and of the six instance-derived interview questions, zero produced a decision record at the time of asking. **This is the highest-stakes framing decision in the document and it must be settled before phase 3 is scoped**, because the two products have different pitches, different acceptance tests and different customers.
**Recommendation:** accept it, and let phase 0.1 set the number. C3's thesis survives the relabelling; the current framing does not survive contact with TBD-038.

**Q9. Does MAP have permission to raise zero questions? REWORDED in revision 4, because the trigger moved and there are now three of them.** The go/no-go is the **scope filter**, not provenance availability (4.9.1/C-b), and it has three terminal states: `inventory-only` (no authored surface at all), `filter-non-discriminating` (we cannot separate your work from ServiceNow's, with the measured shares), and **`authored-but-undeliberate`** (we can see what you built, we cannot see what you decided, which is the branch devinst01 is most likely to take).
**Recommendation:** yes, and make all three terminal states rather than judgement calls, because the three reports are genuinely different and collapsing them into one reason code loses the distinction the customer most needs. Reporting "no changes found" in any of the three is the same silent-empty failure the guard layer exists to prevent, one level up the stack.

**Q10. Does the decoy protocol run?** It is the only element of the whole PoC that can produce a negative result (11.3 step 4). It also means deliberately spending a small amount of a collaborator's goodwill, disclosed afterwards.
**Recommendation:** run it, disclose explicitly and immediately after he answers, and frame it to him as the control that makes the rest of the result mean something. If the operator judges the relationship cost too high, record that the run has no falsification test rather than absorbing it quietly.

**Q11. Does the framework accept that MAP and VERIFY are attended operations?** `dispatcher.js:49-54` enforces `requiresBrowser` on every read command, so a live VS Code extension host and a browser helper tab are mandatory and headless or CI operation is architecturally out of reach on this substrate.
**Recommendation:** accept it and **stop listing unattended operation as a goal anywhere in the product docs.** It is a genuine boundary of the chosen substrate, not a defect. If it ever becomes a requirement it is a feature request to the developer, not a workaround.

**Q12. Does the operator accept `readOnlyEnforcement: 'partial'`?** `update_record` and `update_record_batch` are gated by none of the four permission settings (`commands/records.js:95,145`), so write capability cannot be fully closed at the capability boundary today. Enforcement is the adapter's missing verbs, plus `assertReadOnly`, plus a hook that must be changed from `ask` to `deny`, plus `reviewWrites`.
**Recommendation:** yes for the PoC, stamped in state and stated in the report. Do not claim structural enforcement before FR2 exists.

**Q14. Licence and attribution for the adapter. NEW in revision 3, promoted out of the feature-request list.** It was carried as "FR10" among eight technical asks, where it did not belong: it is not a feature, it is not answerable by reading code, and putting a commercial question in a list of engineering favours changes the tone of the whole list. The question stands and it is the operator's, not the engine's: **how should a commercial framework that ships an adapter calling the Agent API be licensed and attributed, so the adapter ships inside the product rather than as a per-engagement side-load?** Not a legal risk (C1c), a partnership conversation, and it should happen in a different message from A1 to A8.
**Recommendation:** raise it only after A1 has landed and been received well. Leading with a commercial ask before delivering the security finding inverts the order of value.

**Q13. Where does the ledger live for a real engagement?** Carried forward from revision 1's 6.7 item 3 and still unowned. The ledger contains sys_ids, table names, script names and evidence responses. Tracked in the customer's repo or the consultancy's? Different data-location answers, different contractual consequences. **And the sibling question it now drags in:** the MAP pass streams configuration to a model vendor, which for an EU customer is a sub-processor and possibly a DPIA question. Not an issue for devinst01; blocking for the first real customer.

---

## 13. UNVERIFIED CLAIMS REGISTER

The product's own doctrine (`playbooks/01-audit.md:9-27`) makes `unverified` a first-class status and demands the sample be reported honestly. This plan holds itself to that. **Revision 2 retires five entries and adds seven**, most of them transport capabilities the source read could not settle.

| # | Claim | Where used | Verified by | Retires when |
|---|---|---|---|---|
| U1 | Copilot exposes 14 lifecycle hook events at `.github/hooks/*.json`, `preToolUse` fail-closed | 5.1, 5.2 T1, phase 4 | Vendor documentation only | 5.4 spike |
| U2 | `copilot -p` has no structured output mode | 5.1, the file-handoff protocol | Vendor documentation only | 5.4 spike |
| U3 | `.github/agents/*.agent.md` isolation is weaker than `.claude/agents/*.md` | 5.3, the maker/checker guarantee | Nothing. Explicitly flagged | 5.4 spike |
| U6 | The 20 to 25% derivable share generalizes beyond the pilot customer | 9.1 | Measured on the pilot customer story pages, extrapolated without showing the extrapolation | Whole-wiki measurement, or downgrade the claim |
| U7 | "Roughly 15% of the machinery the audits proposed" | Section 1 (revision 1) | A rhetorical estimate, no denominator | **Retired in revision 2: the sentence is gone.** |
| U8 | Effort estimates in section 10 | Every phase | One person assumed, stated, nothing else | State the assumption or drop the numbers (9.7 item 7) |
| U9 | 48 skills port to Copilot at near-zero cost | 5.2 T1 | Nothing. The layer was never opened (2.4) | Phase 1 skills decision record |
| **U11** | **`rest_request` GET works end to end against devinst01**, not merely ungated in the extension | All of section 6, both rungs | **Gating is [SRC]-verified** (`commands/rest.js:20,29,32`) **and the browser hop is now corroborated rather than unknown:** `rest_request` and `readBackRecord` call the same `_shared.restRequest`, so `get_record` already drives an arbitrary-query-param GET to `/api/now/table/*` through that hop in production (6.1). What is left unproven is `sysparm_offset` (U13), the `/api/now/stats` prefix (U12) and the payload ceiling (U14). | WP-A probe 1. **Risk downgraded again in revision 3, from LOW to RESIDUAL**, and the residual is now fully covered by U12 to U14 rather than being a separate unknown. |
| **U12** | `/api/now/stats` is reachable through `rest_request` GET | G8, the honest denominator, 9.6 item 2 | The extension imposes no endpoint allowlist (`rest.js:20`). The browser hop is [OPAQUE], **and every production exercise of that hop we can point to is against `/api/now/table/*` only** (6.1), so a non-table prefix is the specific thing unproven. | WP-A probe 3. Fallback is enumerate-and-count; **`X-Total-Count` is not a fallback**, it is structurally unreachable (`_shared.js:62`). |
| **U13** | `sysparm_offset` paging passes through the relay and page 2 differs from page 1 | G7, every sweep, every count claim | Nothing. Not in the extension's code path at all; it is a query param the browser forwards. | WP-A probe 2 |
| **U14** | The relay's maximum response payload, and whether a wide read fails cleanly or truncates silently | `widePageSize`, FR9 | [OPAQUE]. The 60 s deadline and the 10 MB **request** cap are [SRC]; the **response** ceiling is not, and there is no response cap in the HTTP layer. | WP-A probe 5, by bisection |
| **U15** | `get_table_metadata` inheritance behaviour | 6.2, and the reason G1 avoids it | [OPAQUE]: `records.js:388` delegates entirely to the closed-source browser extension | WP-A probe 4. **G1 is designed not to depend on the answer.** |
| **U16** | Concurrency behaviour of the shared helper tab under load | 6.7, FR-Q1, whether `maxConcurrency` can rise above 1 | The VS Code side is [SRC]-resolved (no queue, no throttle, id-correlated). The browser hop is [OPAQUE] and the SN-Utils repo contains no source. | FR-Q1 plus a measured spike. **The design does not depend on it: it ships serialized.** |
| **U17** | **That an anomaly a machine can see is a question a human answers with a rationale** | C3's entire thesis, 4.9, 4.10, section 11 | **Nothing.** Every other link in the chain is designed, budgeted and probed. This one is asserted, and the only measurement that exists (the pilot customer: 6 instance-derived questions, 1 rationale, and that one from archaeology) contradicts it. | **Phase 0.1, half a day, zero cost. This is the highest-risk unverified claim in the document and it is also the cheapest to test. Run it first.** |
| **U18** | That devinst01 has enough customer-authored surface to measure anything | Section 11 as a whole | Nothing. C4b predicts thin provenance on a vendor dev instance. | WP-A probe 9: four counts, twenty minutes. If they come back small, the PoC design changes before the adapter is written. |
| **U19** | **What class of instance `devinst01` is, and what that implies for base and demo data, session privilege and refresh cycles** | 11.1's unproven-legs statement, QG5's authorship precondition, G4's bracketing watermarks | **Nothing, and it is deliberately written as a question rather than a claim.** `ven*` is not the customer-instance naming pattern and the vendor's own roster example pairs `ven08329` with `devinst01` (`SKILL.md:428-430`), but this document does not assert what the class is or what its lifecycle rules are. | **One line from the operator, who is the ServiceNow architect.** Then WP-A probes 9, 10 and 11 measure the consequences rather than the label. |

**Added in revision 4. Every one is something the backtest could not verify, and the first is the one that qualifies all the others.**

| # | Claim | Where used | Verified by | Retires when |
|---|---|---|---|---|
| **U20** | **The backtest's precision numbers are a hand simulation, not a run.** No engine exists, so every "N emissions, M genuine" figure in 4.9.3 and 3.3b is a designer stepping each predicate through artifacts on disk by hand. | Every `pB`, the whole of 3.3b, the 204-candidate and 89-to-155-survivor arithmetic in 4.9.6 | **Nothing beyond the reading itself.** The **recall** number (5 of 15) is checkable against a written record and is the stronger half; the **precision** numbers are an informed simulation and the weaker half. | Phase 2 test (v): replay the the pilot customer fixture through the built `questions.js` and compare emission counts per signal. A large disagreement means the simulation was wrong, not that the engine is. |
| **U21** | **`pB'`, the prior on the surviving predicate set, is derived arithmetic and not a measurement.** It is `pB` with the deleted predicates' share of emissions subtracted, using the backtest's own decomposition. | The admission floor, every `C_signal` at run 1, which signals are `admitted` versus `shadow` | Derivation only. It is stamped `priorSource: 'backtest-pilot-2026-08'` on every question so a reader can see it is not `designer-estimate` and not `calibrated`. | The first `calibrate` run with real graded outcomes, and phase 0.1 item 5 for QS-08q specifically. |
| **U22** | **That decisions are clusters.** `E(q)` makes cluster size the value term, and the anomaly-to-question promise, the budget and the four-questions-not-four-hundred claim all rest on it. | 4.9.5, 4.9.6, 11.4, phase 2 test (iii) | **A hand count only:** roughly 12 of the pilot customer's 33 DECs govern four or more artifacts, 17 govern one to three, and 4 govern none. That count contradicts the assumption more than it supports it. | **Phase 0.1 item 4, half a day, pure reading, zero instance access. It must run before any of `questions.js` is written.** |
| **U23** | **The `sys_update_xml` name sweep (scope-filter input I6) fits the budget.** Plausibly 100 to 2,000 calls, the single largest read in the design. | 4.9.2, the S4 harvest budget | Nothing. The row count on any target instance is unknown. | The mandatory one-call `stats` pre-check. Above `read.updateXmlSweepMax` (25,000 rows) the sweep is **refused** and the run stamps `authorship: 'metadata-only'`. Designed degradation with a number, not a hope. |
| **U24** | **`sys_customer_update` discriminates customer-touched from vendor-shipped on this release and through this transport.** It is the A3 rung and the whole clone-resilience story rests on it. | 4.9.2 bands A3 and F3, 4.11's P6 | Platform knowledge only. Never read through this transport. | **WP-A probe 11, twenty minutes, kill criterion written first.** If it fails, A1 is the only clone-resilient rung. [CORRECTED 2026-08-04: see R-e — `sys_customer_update` does not exist; it is the label of `sys_update_xml`. A3 is update-set membership, so U24 was never a claim about this instance, and A1 is the only clone-resilient rung whether or not probe 11 passes.] |
| **U25** | **QS-08q's gated precision.** The split (emit a question only on a corpus-absent token or an absent provenance container) converts a 0.24 signal into something defensible, but the gated emission set has never been counted. | 4.9.3, why QS-08q is `shadow`, 11.1's sixth unprovable leg | Nothing. It is `unmeasured`, and the PoC target has no repo to measure it on. | **Phase 0.1 item 5.** the pilot customer is the only place this signal can be evaluated before a customer engagement, and it is the signal that produced the only novel finding on record. |
| **U26** | **That the `C_signal >= 0.60` floor is the right threshold.** It is a chosen number, not a calibrated one, and it is what reduces run 1 to two admitted signals. | 4.9.3, 11.3's question count, 11.4's ratio 2 | Nothing. It was chosen because `C_signal` has a 2.1x dynamic range against `E`'s 64x, so a lower floor lets reach dominate believability. | Two `calibrate` cycles, or an operator override recorded through `questions admit`. |
| **U27** | **That the shadow queue produces calibration data at zero SME cost.** The mechanism assumes the operator will actually grade shadow questions run after run. | 4.9.3's admission ladder, 4.9.7 `calibrate`, phase 2's effort estimate | Nothing. It is a process assumption about a human, and every process assumption in this document about a human has so far been optimistic. | The first two runs. If the shadow queue is not graded, nine of eleven signals never earn admission and the engine ships with two. |
| **U28** | **The correlation-id collision (B2) and the `update_record` gate gap (B1) as *lived* failures rather than source-derived ones.** Both are read out of the compiled extension; neither has been observed. | 11.3 Set B, 6.7 item 3, 6.9 | **[SRC] on the code path; nothing on the behaviour.** `pendingRegistry.js:20` overwrites on a duplicate key and `records.js:110,164` have no `E_DISABLED` check, but no two-agent workspace has been run to see it. | the developer's reply, or a deliberate two-process test in one workspace during WP-B. Send them as findings with the file and line, not as bug reports. |

**Retired in revision 2:** U4 (the Table API path as a restricted user) and U5 (the sn-scriptsync licence conflict), both dissolved by C1. U10 (instance rate limits "commonly around 5,000 per hour") is dissolved for this PoC because the transport is the consultant's own session rather than an integration account, and the relevant budget is the single helper tab; it returns as a live question the first time a customer's shared sub-prod instance is swept.

---

*Sources for research claims are inline. Every ServiceNow and repo claim above was verified by reading or executing the file cited, on 2026-08-04, with the exceptions listed in section 13. Every Copilot claim remains a documentation read and is listed in section 13; see 5.4 for why that asymmetry is a defect and not a footnote.*

*Revision 1 (2026-08-04) added sections 2.4, 5.4, 9.6, 9.7, 13 and the corrections marked inline.*

*Revision 2 (2026-08-04) applied operator corrections C1 through C6 plus two red-team passes. Changed: the header block; section 1 (rewritten around the inverted thesis); 2.1/B6 and 2.1/B7 (both withdrawn as overstated); 2.4's config-slot row; section 3 (re-ranked, new 3.4 question-generation signals, rewritten 3.3); section 4 (4.1 re-ordered around three loops, 4.4 diagram redrawn, new 4.9 question engine and 4.10 decision ledger); 5's preamble; **section 6 replaced in full** with an sn-scriptsync-native read path; 7's read-adapter row; 9.2 (the turn), new 9.2b, 9.4 item 3, 9.6's extension; **section 10 re-phased** with phase 0a deleted and phase 0.1 added first; **section 11 replaced in full** with the devinst01 PoC; section 12 (Q1, Q2 and Q6 deleted, Q5 rewritten, Q8 through Q13 added); section 13 (five entries retired, seven added). Per C5 no the pilot customer work is proposed anywhere in this document.*

*Revision 3 (2026-08-04) was an accuracy and completeness audit against both repos and the installed extension. Changed: a new REVISION 3 block in the header; 2.4's skills row (48 directories, and `bootstrap-project-brain` named as the one phase 3 forgets); 3.4 (the VERIFY-before-questions dependency); 4.1's honest note; 4.3 (test-case count re-measured, inference narrowed); 4.6 (`state.js:29`); 4.7 (the CONTRACT `status:` claim corrected); 4.10, 6.6 and 9.2b (TBD-038 restated as intent-and-attribution, not rationale); 6.1 (vendor gate quoted correctly, plus the `_shared.restRequest` shared-path finding); 6.2 and 6.4 (`records.js:387-409`); **6.8 rewritten as an eight-item A1 to A8 deliverable with a cut list and a crosswalk**; 6.12 (WP-A now ten probes, probe 9 extended to a distribution, probe 10 added); 7 (check-count corrected, three more generic checks named); 8 (73 lines); 9.2 item 4; phase 1, 2 and 3 (provenance reads moved into phase 2, the fixture-only constraint stated, the full `bootstrap-project-brain` retirement surface named, the identical-ledger test corrected for watermarks); 11.1 (two new unproven legs); 11.2 and 11.3 (decoy decision rule, oracle match rule, pre-rating flagged as self-graded, anomaly-to-question expectation pre-registered); 11.4 (set B); 11.8 (two new operator asks); 12 (Q14 added); 13 (U11, U12 and U18 updated, U19 added).*

*Revision 4 (2026-08-04) recovered the two design lanes that died in revision 2 and then corrected them against a backtest over the pilot customer's 15 interview questions, 33 decisions, 44 TBD entries and the phase-0 audit. **Sections 4.9, 4.10 and 11 were placeholder text before this revision and had never been validated.** Changed: a new REVISION 4 block in the header; 3.3 (QG1's third gate, QG5 moved to the scope filter) and a new 3.3b naming the nine deleted signals; **4.9 replaced in full** (measured recall, the scope filter, the surviving eleven-signal catalogue, the corrected ranker, the six anti-waste gates, the schema and CLI, the MAP retirement table); **4.10 replaced in full** (`rationaleStrength`, the witness versus explains split, the supersession link, the six-point argument); **new 4.11**, the provenance scaffold with its degradation table; 6.12 (WP-A probe 11 added, eleven items); phase 0.1 (items 4 and 5 added, and item 4 must run before `questions.js` exists), phase 1 (eleven probes), phase 2 (`provenance.js`, the shadow queue, three new acceptance tests), phase 3 (`authored-but-undeliberate`); **section 11 replaced in full** with a seven-stage protocol, a summed 723 expected / 1,300 cap query budget, 5 instance questions plus 4 decoys, Set B drafted in full as B1 to B9, nine metrics and two corrected pre-registered ratios; section 13 (U20 to U28 added). Verdict recorded: **ENGINE_VIABLE_WITH_CHANGES**.*

*Transport claims marked **[SRC]** in section 6 were verified against the compiled source of the extension the operator is running, at `<home>/.vscode/extensions/arnoudkooicom.sn-scriptsync-4.7.6/out/agent/`, build 4.7.6, Agent API protocol 6, skills doc 17. Claims marked **[OPAQUE]** run inside the SN Utils browser extension, whose source is not public, and are unverifiable by inspection at any effort level: only measurement or the author can settle them.*
