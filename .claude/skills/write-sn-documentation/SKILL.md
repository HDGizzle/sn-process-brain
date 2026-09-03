---
name: write-sn-documentation
description: Invoke at STORY CLOSE or whenever the user asks to "document a story", "write documentation", "story docs", "process documentation", "update the wiki", or "changelog" for ServiceNow work. This is THE single documentation pipeline — it updates the wiki (story page, index, process deltas, ledgers, registry), runs the supersession sweep, and triages memory.
---

# Documentation Pipeline — story close → wiki

**One route.** All story-close documentation flows through this pipeline into the
project wiki (root: `paths.wikiRoot` in `product.config.json`, default `docs/wiki` —
written `<wikiRoot>` below). Never scatter story content across ad-hoc files, and never
update ledger copies outside the wiki — the ledgers (`decisions.md`, `tbd.md`) live in
the wiki and nowhere else.

**Principle:** this is a *conversation*, not a batch job. The developer owns the *why*;
checkpoint before interpreting. But the *what* is mechanized: the affected-pages list
comes from grep, not memory.

## Inputs

- Story ID (+ tracker/backlog work-item id, if the engagement uses one), update set
  name/sys_id — query `sys_update_set` if not given.
- The developer's one-paragraph "why" (ask for it at discovery — verbatim quotes beat
  paraphrase).
- Language slots from `product.config.json`: wiki pages are written in
  `language.source`; the optional human deliverable (step 10) is written in the
  customer's deliverable language (first of `language.targets`, or `language.source`
  for single-language projects).

## The pipeline (run in order; steps 2–8 are one commit)

1. **Discovery (checkpoint).** Query `sys_update_xml` for the update set → inventory
   (type, target_name, action). Use
   [references/technical_categories_reference.md](references/technical_categories_reference.md)
   for the per-table extraction schema. Show the inventory; ask: "anything not in the
   update set I should know about? (manual steps, scheduled jobs, dictionary flips,
   deactivations)" — the untracked-change classes from the wiki's hard-rules page.

2. **Story page.** Write `<wikiRoot>/stories/<STORY-ID>.md` per the wiki's CONTRACT
   page and the `stories/_TEMPLATE.md` scaffold: **immutable changelog tier** — what
   shipped (records + sys_ids as shipped-history), update sets, decisions taken, open
   items, deploy notes. NO current-state mechanics (those go to process pages).
   Frontmatter: `story, tracker-id, status, updated-sets, affects: [process pages],
   mentions: [artifact — sys_id]`.

3. **Index line.** One row in the Stories section of `<wikiRoot>/index.md`
   (link + one-line hook). Nothing more — the index stays scannable in one glance.

4. **Process deltas (mechanized affected-list).** Candidates = the story page's
   `affects:` frontmatter **plus** `grep -rl` over `<wikiRoot>/` for every touched
   sys_id and artifact name. Propose the mapping (checkpoint), then update each
   affected process page: adjust the changed mechanics, append the story to its
   `stories:` frontmatter. Process pages own current-state truth — this step is where
   truth moves.

5. **Ledgers.** New decisions → `<wikiRoot>/decisions.md` (DEC-NNN: decision + impact +
   story). New/resolved TBDs → `<wikiRoot>/tbd.md`. Update the header counters.

6. **Registry.** New/changed sys_ids → `<wikiRoot>/registry-sys-ids.md` (name, table,
   sys_id, story, note) and stamp the page (`last-verified: <today> <dev instance>`)
   for the entries you actually verified live on the instance.

7. **Supersession sweep (mechanized).** For every touched artifact: `grep -rn` its
   sys_id AND name over `<wikiRoot>/` and `.claude/skills/` — fix every stale claim in
   the same commit (deactivated things marked, replaced mechanics rewritten). The grep
   list IS the sweep scope; done = every hit reviewed.

8. **Memory triage.** Check the agent's persistent memory directory for this project
   for notes touching this story's artifacts/topics: promote durable content into the
   owning skill's Gotchas section or wiki page, then mark the memory note promoted
   (archive only after the landing is verified via the sweep — never delete
   unverified).

9. **Verify + commit.** Run the wiki link/frontmatter validator if the engagement
   ships one (git hooks / session-start checker). Commit message lists: story page,
   index line, process pages touched, DEC/TBD/registry updates, sweep hits fixed.

10. **Optional human deliverable (on request).** A Confluence-ready functional summary
    in the customer's deliverable language, for stakeholders who don't read the wiki.
    Format per [references/confluence_formatting_rules.md](references/confluence_formatting_rules.md);
    shape per [references/example_story_output.md](references/example_story_output.md).
    Where the engagement keeps a running changelog document for stakeholders, append
    the story's row there in the same pass.

## Rules

- Wiki pages in `language.source`; human deliverables in the customer's deliverable
  language.
- Confluence-safe markdown for anything Confluence-bound (no H1, no nested tables, no
  mermaid — full rules in the reference).
- Every artifact row/reference carries its sys_id.
- A fact lives in exactly ONE page — link, never copy (gotcha ownership: procedure →
  the owning skill's Gotchas; platform-wide silent-failure class → the wiki's gotchas
  page).
- Never resurrect struck-through wrong analyses; summarize outcomes.
- Story pages are immutable after close — corrections land on process pages and
  ledgers, with the story page left as shipped history.

## Checklist (paste in the closing summary)

- [ ] Story page written (immutable tier respected)
- [ ] index.md story row added
- [ ] Affected process pages updated (grep-derived list, all hits reviewed)
- [ ] DEC/TBD ledgers updated
- [ ] Registry updated + stamped for verified entries
- [ ] Supersession sweep: 0 unreviewed grep hits
- [ ] Memory triaged
- [ ] Link/frontmatter checker green (if present)

## Customer Project Rules

<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
