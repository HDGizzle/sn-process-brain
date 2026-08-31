---
name: snbrain-render
description: Invoke to run the RENDER stage of a project-brain build, or when the user asks to "render the brain", "build the wiki", "generate the kernel", "make the repo usable", "turn the claims into pages", "finish the project brain", "hand over the engagement repo". Renders verified claims and decisions into the kernel and wiki that make the engagement repo usable for agentic ServiceNow development.
---

# RENDER: make the engagement repo usable

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

The brief names the stage, the inputs, the artifact, the acceptance conditions and the
budget. **The brief is the current state; this skill is the procedure. Where they
disagree, the brief wins.** If the stage is not `render`, stop and run the stage the CLI
named.

## This stage is the deliverable

Every other stage produces evidence. This one produces the thing the customer keeps: a
repo an agent can develop ServiceNow in. The build is not finished when the ledgers are
full. It is finished when a fresh agent, opened in that repo, can work.

**The test, stated before you start, so it can be run rather than asserted.** After this
stage, an agent opening the engagement repo must be able to:

| # | Capability | Where it comes from |
|---|---|---|
| 1 | know the customer, the instance and the scope without asking | kernel identity block |
| 2 | hit the hard rules **before** its first write, not after | kernel hard rules |
| 3 | resolve any registered artifact to a sys_id without guessing | registry page |
| 4 | route from a need to the page that answers it | kernel routing map |
| 5 | tell verified knowledge from draft knowledge, per page | computed `status` frontmatter |
| 6 | find the decision behind an artifact, or the debt record where none exists | decisions and TBD ledgers |
| 7 | hit the silent-failure traps **observed on this instance**, not the generic list | gotchas page |
| 8 | find the build procedure for the artifact type it is about to touch | the skills tree |

**Capability parity, not page-for-page parity.** The reference engagement's page
granularity is an unvalidated live experiment. Match what it lets an agent **do**. Do not
clone its tier structure as if it were correct, and do not manufacture pages to make a
count match.

## Inputs

The ledgers, not your memory of them: `.brain/claims.jsonl`, `.brain/decisions.jsonl`,
`.brain/questions.jsonl`, `.brain/state.json`, plus the census, provenance and verify
artifacts, plus the preflight probe results. The scaffold and the kernel template come
from the framework (`wiki-scaffold/`, `kernel/CLAUDE.template.md`) and the slot values
from `product.config.json`.

## What gets written

**The kernel, `CLAUDE.md`.** Rendered from `kernel/CLAUDE.template.md` with the config
slots filled from what the run measured. Never hand-edit the rendered copy: the
kernel-integrity check flags it the moment it drifts, and a hand-edited kernel is a rule
with no source. It carries **identity, hard rules and the routing map, and nothing else**.
Mechanics live in the wiki. Respect the kernel token budget in `product.config.json`; a
kernel that outgrows its budget stops being read.

The routing map is **need to page and artifact type to governing skill**, so a downstream
agent lands on the right procedure without being told which one it needs. An artifact type
present in the registry with no governing skill is **named as unrouted**, not omitted.

**Enforcement, `.claude/settings.json`.** Hooks actually referenced, not described: kernel
integrity on session start, skill triggering on prompt submit, the artifact-skill reminder
and the write guard before tool use, the capture verifier after it. A rule that lives only
in prose is a suggestion. Wire the hooks the framework ships; do not invent new ones here.

**Build-procedure skills.** The ones this instance's artifact types actually need, present
on disk and reachable from the routing map. This is capability 8 and it is an output, not
an assumption.

**The read-only proof.** The append-only request log written before each send, plus the
closing capability re-read showing the gates block unchanged since preflight. This is the
artifact you hand the instance owner, and it is what makes read-only **provable after the
fact** rather than merely asserted.

**The wiki**, at the configured `paths.wikiRoot`:

| Page | Rendered from | Owns |
|---|---|---|
| `index.md` | every ledger | one line per story, process, decision and TBD, plus a link. No prose |
| `registry-sys-ids.md` | verified claims whose locus is an artifact identity | current sys_ids: name, table, sys_id, owning story, verify stamp. **The scope sys_id is the single most load-bearing value in the repo** |
| `decisions.md` | `decisions.jsonl` | one entry per decision, ids never renumbered, `rationaleStrength` rendered **visibly** |
| `tbd.md` | unanswerable, deferred and debt outcomes | the open debt register, each with an owner and a date |
| `gotchas.md` | scaffold **plus this run's observations** | platform-wide silent-failure classes |
| `conventions.md` | induced patterns from provenance and census | naming shapes that are functional keys, the story-set format with its support count, the message-key namespace |
| `hard-rules.md`, `agent-api.md` | scaffold plus instance-specific corrections | mechanics behind the kernel's one-liners |
| `processes/<slug>.md` | current-state claims | how things work now |
| `stories/<story-id>.md` | claims grouped by a recovered story container | immutable build record of what shipped |
| `CONTRACT.md` | scaffold | the page rules, including the canonical slug list |
| `INTERVIEW.md` | open questions | the queue the customer still owes answers to |

## The gotchas page is where this run earns its keep

The scaffold's gotcha catalogue is inherited doctrine. **The probe results are
instance-specific silent-failure evidence, reproduced here, on this instance, in this
run.** That distinction is the difference between a page a developer skims and a page a
developer trusts. Write the observed ones **first**, each with the probe that produced it.

From the reference run, and every one of these must appear when the probes recorded it:

1. **The silent clause-drop reproduced here.** An unknown field in an encoded query returns
   **unfiltered rows** and a clean 200, not zero rows and not an error. Field-validate
   before every filtered query. This is not a warning inherited from a doc; the negative
   control fired on this instance.
2. **`sys_customer_update` is not a column on `sys_metadata`, here or anywhere.** It is the
   label of `sys_update_xml` ("Customer Update"), so any tooling that filters on it drops
   the clause and mis-bins the instance in silence. The record-level rung is update-set
   membership on `sys_metadata.sys_update_name` = `sys_update_xml.name`, and it does not
   survive a clone — a clone truncates `sys_update_xml` too, which leaves package level as
   the only rung that does.
3. **The session is admin, so read ACLs never filter and ACL blindness is untestable on
   this instance.** Say exactly that. A reader must not be able to assume the ACL class was
   tested and passed. Every ACL claim carries `unverifiable: blocked-by-access`.
4. **`rest_request` GET is ungated on the browser session.** The full REST read surface
   works, paging works, aggregate counts work. Record it, because the whole read strategy
   rests on it and the next engagement may not have it.
5. **Value encoding.** The non-REST path concatenates raw, so a value containing `&`, `=`
   or `#` re-parses as a parameter delimiter and returns a clean 200 on a different query.
   Route those through REST.
6. Whatever else the probes recorded: the payload ceiling that was measured, the truncation
   points, the tables that came back empty and the canary result that proves whether that
   emptiness was real.

## Rendering rules that make the repo usable rather than merely populated

1. **`status` is required frontmatter on every page**, with values `draft`, `mixed` or
   `verified`, **computed by the renderer from the claims the page renders**. Never written
   by hand, never argued about.
2. **A claim leaves `draft` only** with an L1 verification carrying a captured response, or
   a linked answered interview question with an attributed answerer and a date. There is no
   third route and no override that is not recorded.
3. **The validator refuses** to render a page as `verified` if any claim it renders is
   still `draft`. Exit non-zero. A page that says verified and is not is worse than no page,
   because it is read with more confidence.
4. **The kernel routing map states that a draft page must be quoted with its status.**
   Downstream agents read these pages with zero draft awareness unless the kernel tells
   them to. Without this line, rule 1 buys nothing.
5. **Single source per fact.** Every fact has exactly one owning page; everyone else links,
   never copies. A restated fact is a future contradiction, and the reference engagement's
   own measured failure rate on hand-maintained cross-references is roughly one in five.
6. **Current sys_ids live only in the registry.** Story pages may inline a sys_id solely as
   shipped-record history. Process pages link.
7. **The renderer refuses a page whose claims mix instances.** `instance`, `instanceUrl`,
   `instanceTier` and `runId` are stamped on every claim. A map of a vendor dev instance
   gets read as a map of production within a week. Stamp
   `identity: corroborated-by-canary`, **never** `identity: proven`: the transport does not
   echo the instance, so identity is asserted by the caller and corroborated by the canary.
8. **Slugs are agreed in `CONTRACT.md` first, then linked.** Do not invent a variant of an
   existing slug. Duplicate slugs for one target table are an L2 contradiction, not a
   stylistic difference.
9. **Page cap about 5k tokens.** Design the split axes up front. Hub pages link only.
10. **Pages are a view. The ledgers are the artifact.** Never hand-edit a rendered page:
    edit the claim or the decision and re-render. A page edited by hand is a fact with no
    evidence and no owner, and it will be silently overwritten.
11. **The three counts must agree, per page** (`PRODUCT-95`): the distinct claim ids the
    file prints, the `rendersClaims` array you declare for it, and its `claims-rendered`
    frontmatter. Derive all three from the file you just wrote. On run `93838afe87` 21 of
    33 declaring pages declared a number nothing computed — the widest **582 against 69
    printed** — and `--check` called it clean. The validator now rejects all three
    disagreements, aggregated, so fixing them is one mechanical pass rather than 21.
12. **Generate the evidence appendix and declare its pages like any other**:

    ```bash
    node tools/snbrain/render.js --root . --appendix \
      --emit-manifest .brain/in/render-appendix.json
    ```

    Splice that fragment's `pages[]` into your own artifact rather than retyping it — rule
    11 is exact, and these pages cite every claim in the ledger.

    It renders **every** claim in `claims.jsonl`, one page per table under
    `docs/wiki/evidence/`, each under the same page cap, with the claim id on every row;
    tables under five claims are collected under `evidence/minor/` rather than dropped. It
    is the **floor under curation, not a replacement for it** — a process page says what the
    work IS, the appendix says what the instance HOLDS. Run 4 banked 19,360 claims, cited
    374 of them anywhere in the wiki, and left 107 present-and-complete ground-truth facts
    reachable only by opening the ledger. A table carrying five or more claims that no page
    names is a render finding; not every table earns a curated page, but every table earns a
    decision.
13. **The deliverable ends in a commit** (`PRODUCT-97`). On ingest the CLI commits exactly
    what you declared — `pages[]`, the kernel, the settings file, the build skills,
    `state.json` and the three ledgers — and nothing else, then asserts every one of them is
    tracked **and clean**. A page you wrote and did not declare stays uncommitted. Run 4's
    whole deliverable existed only as working-tree state over a commit dated two days before
    the run; `node tools/snbrain/render.js --root . --deliverable-check` is that assertion,
    runnable on its own.
14. **A process page must be traversable, not just readable** (`METHOD-6`). Among the
    artifacts a page cites, at least one must reference another artifact the brain actually
    mapped — a reference column, or a sys_id inside a script, condition or property value.
    **Print the link:** name the record that carries the reference and the record it
    reaches, both by sys_id, so the next step is a lookup rather than a search. The
    reference is already in a column you harvested, so this costs no instance read.

    > Run 4's `case-triage-and-routing.md` cited **eleven artifacts and carried zero
    > followable links** — the routing chain, the most-cited mechanism in the build,
    > described entirely in prose. Across the whole run **970 of 2,958 references point at
    > records nobody mapped**, and the per-page intact rate ordered three head-to-head
    > developer tasks correctly where the claim count ordered nothing.

    **What is demanded is a sentence, not a chain.** If the harvest genuinely contains no
    followable link for this process, say so in the slot form and the validator is
    satisfied: `<!-- slot: mechanism.chain | source: HV | status: unfilled | blocked_on:
    <what> -->` plus one line on where the chain stops. **Do not satisfy it by citing more
    artifacts** — an unrelated citation that happens to resolve is the exact reading the
    check exists to refuse. Pages citing fewer than three artifacts are owed nothing.

## What honesty requires on the front page

- The census branch, in plain words. If it was `authored-but-undeliberate`, the deliverable
  says *we can see what you built, we cannot see what you decided*, with the ratio.
- The provenance stamp and what it cost, with the signals named.
- The instance tier, spelled out. If it is a vendor dev instance, the front page says what
  that means.
- The honest denominator, **in the same visual block as any precision figure**: census
  counts per table and per scope against claims written per table and per scope, plus the
  suppressed-candidate count. "4,000 rows produced 12 claims" is the sentence that keeps a
  reader calibrated. **Never a coverage rate**: a percentage implies a denominator we do
  not have, and precision without recall presented as a score is the one dishonest number
  this design can produce.
- What was not read at all, named. Silence is not a clean bill.

## Acceptance check: run it, do not assert it

Before ingest, verify mechanically:

- every internal link resolves; every frontmatter block conforms; every slug is canonical
- the registry carries the scope **sys_id**, and it is a sys_id and not an abbreviation
  string. The vendor docs teach names and names are wrong; this one value breaks every
  scoped write if it is wrong
- no page carries `status: verified` with a draft claim on it
- no page mixes instances
- the kernel matches the rendered template and has not drifted
- the routing map has an entry for every wiki tier that exists, and no entry for one that
  does not
- the skills tree resolves: the artifact types present in the registry have governing
  procedures, and the ones that do not are **named** as unrouted rather than skipped

- the hooks named in `.claude/settings.json` exist on disk and exit cleanly
- the request log is present and its last entries pair with the closing capability re-read

Then the real test, which the validator cannot do for you. **Ask a fresh agent, in the
engagement repo, with no context from this run**, to state the scope sys_id, the one hard
rule that would break its next write, and the draft status of the page it would consult
first. If it cannot, the render failed regardless of what the validator said.

Finally, run the probe suite against the freshly built brain and record the result as the
**baseline**. Day-zero failures are fine: they are the to-do list, and they are the only
measurement anywhere of whether a verified claim actually reaches a model at the moment it
is needed.

## The artifact and the terminal

- `pages[]`: path, tier, computed `status`, the claim ids rendered, the decision ids cited
- `kernel`: rendered path, template hash, slot values used, token count against budget
- `gotchasObserved[]`: each with the probe that produced it
- `validation`: every check above with a pass or fail and the evidence
- `parityCheck`: the eight capabilities, each with the artifact that satisfies it
- `unrendered[]`: claims not on any page, with the reason. This is the honest recall number
- `frontPageDisclosures[]`: branch, provenance stamp, tier, denominator, not-read list
- `enforcement`: the hooks wired, and the result of executing each one
- `readOnlyProof`: request-log path, request count, and the closing gates-block comparison
- `probeBaseline`: the day-zero probe result recorded as the baseline

Write it to the path the brief names, normally `.brain/in/render.json`, and report the
stage's spend with the ingest.

```bash
snbrain ingest --stage render --file .brain/in/render.json
```

Terminal `success` requires the acceptance check green **and** no finding with
`severity=blocking` and `disposition=open`. Terminal states are
`success | no-op | blocked | stalled | exhausted | abandoned`, and **only `success`
permits handoff**. Everything else requires a human.

## Never

- **Never write to the instance.** This stage makes no instance calls.
- **Never fabricate an evidence line**, and never write a page sentence from your own
  ServiceNow knowledge rather than from a claim. Platform knowledge that is true in general
  and unverified here belongs in the framework skills, flagged, not in the engagement wiki
  stated as fact.
- **Never report absence as a negative result without a canary.** "No ACLs on this table"
  and "the ACL table was not readable" are different pages.
- **Never hand-edit a rendered page**, including to fix a typo. Fix the source.
- **Never promote a page to `verified` to make the validator quiet.**
- **Never render a page whose claims mix instances.**
- **Never state a rationale the human did not state.** `inferred` renders with its marker.
- **Never ship the generic gotcha list without this run's observed ones.** The observed
  ones are why the page is believed.
- **Never decide the next stage.**
