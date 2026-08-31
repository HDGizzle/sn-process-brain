---
title: "<Process name>"
process: <canonical-slug>
scope: <app scope, e.g. x_acme_fm>
tables: [<primary tables this process runs on, e.g. x_acme_fm_case>]
stories: [<story ids that shaped this process>]
claims: [<claim ids this page renders>]
last-verified: <fill at engagement>
---

# <Process name>

> Verify sys_ids/states against the live instance before use.
> Ratified by <name> on <date> — or the literal token UNRATIFIED. Never silent.

<!-- CURRENT-STATE OWNER page. This page owns every current-state fact about this
     process: how it works NOW. Story pages describe deltas and link here; this page is
     updated at every story-close whose `affects:` list names it. One owning page per
     fact — other pages link, never copy. Register the slug in CONTRACT.md's canonical
     slug list BEFORE creating this page.

     THE PROCESS NAME IS THE CUSTOMER'S WORD, not a table family. "Case behandelen",
     not "incident-data-model". If this page is named after a ServiceNow object class,
     it is a registry page wearing a process page's clothes — and the reader already
     knows ServiceNow's object model. What they do not know is the engagement's work
     breakdown, which is the only thing this tier exists to carry. -->

## Overview

<What the process IS in business terms; the lifecycle in business terms — who hands what
to whom; then the scope/tables block; then a redirect callout to sibling processes.

State LABELS are readable off the instance. What the sequence MEANS, who performs each
hop, and what was retired and why are not: they come from the interview, and if they are
missing this section says so with a slot marker rather than reading as complete.>

**App Scope:** `<scope>`
**Primary Tables:** `<table>`, `<table>`

## <Artifact class — e.g. Business Rules>

<!-- One H3 per artifact class this process ACTUALLY uses; never a class with zero rows.
     H4 subdivides by table. The LAST column is the behaviour column and it is not
     optional — it is what makes this a page you can act on rather than a page that tells
     you to go and open the record. It comes from the `explain` stage reading the logic
     body, so it is a READ, not a judgement: quote the trigger condition verbatim, quote
     one-line scripts in full, name every callee, every event, every table touched. -->

#### On `<table>`

| Name | sys_id | Scope | When | What it does |
|---|---|---|---|---|
| <name> | `<32-char sys_id>` | <scope> | <before insert/update> | <what it does, from the body — never a restatement of the name> |

## <Mechanism name — e.g. Status transitions>

<!-- Insert wherever the catalogue above does not explain the BEHAVIOUR: the transition
     matrix, the guard call graph, the cascade rules, cross-story couplings.

     AT LEAST ONE LINK HERE MUST BE FOLLOWABLE — see CONTRACT.md, "A chain someone can
     follow". Name the record that carries the reference and the record it reaches, both
     by sys_id, so the next link is a lookup rather than a search. The reference already
     sits in a column of an artifact the run harvested; printing it costs no instance read.
     If this process genuinely has no followable link, emit the slot instead of omitting
     the section — a page that cannot be traversed and does not say so reads as complete. -->

This section is the mechanism; the artifact catalogue above lists the individual records.

`<rule name>` (`<32-char sys_id>`) calls `<callee>` (`<32-char sys_id>`) at <where in the
body>, which reads `<next artifact>` (`<32-char sys_id>`) to decide <what>.

<!-- If, and only if, no such link exists in what was harvested:
<!-- slot: mechanism.chain | source: HV | status: unfilled | blocked_on: <what> -->
> The chain stops at `<artifact>`; where it goes next is not readable from what was harvested.
-->


## Personas & Permissions

<!-- MANDATORY — see CONTRACT.md. All four subsections, this order, this wording.
     Extracted from ACLs, guard scripts and state flows, then RATIFIED by a human.
     Ratifying a derived table takes minutes; discovering it from a blank page takes a
     workshop, which is why the evidence goes first and the human goes second. -->

> Extracted from `<sources>` on `<date>`; ratified by `<name>`.

### Who works this process

| Persona | Group | Decisive roles | Sees <sensitive state>? |
|---|---|---|---|
| <named job> | <group> | <only the roles that change the access model> | <yes/no> |

### What each persona may DO

| Action | Gate | May | May not |
|---|---|---|---|
| <action> | <the function or ACL that decides> | <personas> | <personas — deliberate denials recorded so they are not "fixed" by mistake> |

### What each persona may SEE

<!-- Read ACLs never filter for an admin session, so state plainly whether this was
     demonstrated by impersonated reads or ratified by a human. -->

### Where each rule is enforced

| Mechanism | Owns |
|---|---|
| <ACL / guard BR / state flow / UI policy / dictionary> | <what it actually decides> |

## Known limitations

<!-- Scoped caveats at the point of use, never a page-level disclaimer. A disclaimer true
     of every page discriminates nothing, so the reader cannot tell which line to distrust
     and distrusts all of them. State what the instance does, the observation date and run
     id, that intent is unconfirmed, the numbered open questions, and what to do meanwhile. -->

## Superseded models

<!-- The OLD model as a short obituary: what it was, what replaced it (story + DEC link),
     and any leftovers still visible on the instance. This is the page's memory — it stops
     old mechanisms being "rediscovered" as current. -->

- *(none yet)*

## Changelog

<!-- Second-to-last, always. Reverse chronological. Two row types are purely human and
     carry the most value: what was built and then REMOVED, and what shipped UNDOCUMENTED
     (recording the as-built state so it stops being invisible — which does not ratify it). -->

| Date | Story | What changed |
|---|---|---|

## Open Technical Debt

<!-- Last, always. Resolved rows are struck through IN PLACE with the resolving story
     named, never deleted. -->

| # | Item | Severity | Notes |
|---|---|---|---|
