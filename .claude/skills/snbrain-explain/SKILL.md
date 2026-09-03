---
name: snbrain-explain
description: Stage procedure for snbrain `explain` — read logic bodies and say what each artifact does. Invoked by the map-instance loop, never by hand.
---

# snbrain-explain

You have a ranked list of records. Your job is to read what each one **does** and write it
down in a sentence a developer can act on.

**The brief from `snbrain next` wins over this file.** It carries the actual candidate list,
the per-table field map and the cap for this run. This file is the procedure; the brief is the
work.

## Why this stage exists

A harvest records that a record exists, its name, its state, when it changed and who touched
it. None of that says what it does, because **what it does lives in a field the harvest never
requested.**

The reference run inventoried 49 tables and produced zero "what it does" columns. Its own
deliverable conceded: *"Any question of the form 'what does X do' is unanswerable from this
brain."* Five findings recorded that no logic body had been read — all filed as `warning`, so
none could stop anything. This stage exists so that never happens silently again, and the
`evidence-class-unread` finding it mints is **blocking**.

## The procedure

1. **Work the ranked list you were given.** The CLI computed it from the claim ledger so the
   budget stays bounded and the ranking stays deterministic. Do not widen it, do not re-rank
   it, do not substitute your judgement for it.

2. **Read narrow and often.** Batch by table: `sys_idIN<up to 20 ids>` with *only* that
   table's body, trigger and shape fields. Body columns are unbounded text and
   **PLATFORM-10** says a wide field list additively breaks pagination on this transport. Many
   thin requests, never one fat one.

3. **One claim per record.** The assertion says what it does:

   > Sets `is_sensitive=true` on incidents whose category is `qrt` and whose state is 0 or 6,
   > before insert and before update.

   not:

   > Business rule on `sn_ohs_im_incident`.

   The second is the record's name rearranged. A reader who can already see the name learns
   nothing from it, and the CLI rejects it on token overlap.

4. **Extract, do not interpret.** Everything in the assertion must be derivable from the body
   you captured — the trigger condition verbatim, one-line scripts quoted in full, every
   callee, every `gs.eventQueue` event name, every message key, every table touched. *What it
   does* is a **read**. *Why* it does it is the interview's job, and guessing at it here is the
   exact failure this loop is built to prevent.

5. **Ground every claim.** `behaviour.excerpt` must be a **verbatim substring** of the body in
   that claim's own `capturedResponse`. The CLI checks this character for character. This is
   what makes the output auditable rather than merely confident — you cannot satisfy it by
   writing a better sentence.

6. **An empty body is a fact.** Set `bodyEmpty: true`. Do not describe the record from its
   name, and do not write a disclaimer into the assertion — `purpose implied by name` and
   `no script body was read` are both rejected.

   And **`bodyEmpty` is the only way to record an absence**. An assertion that says a column
   is empty is rejected unless that column is in the claim's own `evidence.fields`: on run
   `93838afe87` this stage reported that three `Save and Close` actions *"carry neither
   script nor condition"*, having read the empty `script` column of a workspace action whose
   logic lives in `client_script_v2` — a column nothing requested. An unread column and an
   empty column are the same JSON, and this stage writes the sentences the wiki quotes.

7. **Account for every candidate.** Anything you did not read goes in `dropped` with a reason.
   The CLI reconciles your claims plus your drops against the list it handed you and rejects
   the artifact if anything is missing. The reference run's question stage silently lost six
   questions with no id, no text and no reason; that is the shape being designed out.

## Tables whose behaviour cannot be read as a body

Some tables carry real behaviour that this transport cannot fetch as a column — Flow Designer
keeps its logic in snapshot records, and a `sf_state_flow` row *is* its own definition. Those
are separated out for you and reported as a `warning`, not counted as read. Never let their
silence render as "no logic here."

For `sf_state_flow` in particular, the scalar columns carry the whole meaning, and **empty
role columns are a load-bearing negative fact** — "all 34 rows leave `roles`, `manual_roles`
and `automatic_roles` empty, so the dropdown offers every transition to everyone" is pure
claim-ledger arithmetic and one of the most valuable lines a brain can contain.

Its columns are `start_text` / `end_text` (the from/to state values), `starting_state` /
`ending_state` (the choice references `rebuildFlows()` resolves from them) and
`manual_condition` / `automatic_condition` (the gates). There is **no `from_state`, no
`to_state` and no bare `condition`** on this table, whatever a register entry says
(`PRODUCT-96`). It also has `manual_script` / `automatic_script`, which no run has ever
requested and which are therefore neither established nor excluded — `PRODUCT-98`.

## What the CLI will reject

- an excerpt that is not a literal substring of the captured body
- an assertion under 8 words, or one that restates the record's own name
- a disclaimer in place of a reading
- `bodyEmpty: true` alongside an excerpt
- a locus that was not in the ranked candidate set
- a candidate that is neither claimed nor dropped
- candidates read with **nothing** returned — not a body, not an empty one. On this platform
  that is a broken session far more often than a table of blank scripts, and the honest result
  is `blocked`.
