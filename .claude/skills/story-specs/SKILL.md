---
name: story-specs
description: Invoke when the user asks to "write story description", "story specs", "fill in story", "update set to story", "story documentation from update set" — generating ServiceNow rm_story fields (description + technical-documentation field) from update set XML AFTER development is complete. NOT for authoring stories in an external ALM tool (Azure DevOps, Jira) — use that tool's own story skill if one is installed.
---

# Story Specs — Description + Technical Documentation

Generate a plain-text `description` and an HTML technical-documentation block for a ServiceNow story (`rm_story`), based on exported update set XML plus whatever context the developer gives about what was built and why.

## Platform Rules (rm_story)

- **`acceptance_criteria` is an HTML field, NOT markdown** (verify on your instance first). Use `<b>`, `<ul>`, `<li>`, `<br>` — markdown will not render.
- **`name` is required** when creating an `rm_story` record via the Agent API, even though the story's display field is `short_description`. Use the same value for both unless told otherwise.
- **State values are strings, not numbers** — pass `"-7"` not `-7` (verify the state choice list on your instance).
- **Language:** write the description and technical documentation in the source language from `product.config.json` (`language.source`) unless the developer explicitly asks for a target language. Do not infer the language from the parent story's language or from the customer's locale — ask or use the default. Keep ServiceNow status names, group names, and role names exactly as they appear on the instance, even when they are in another language. Any bilingual hard rule in the customer's kernel applies to *end-user-visible artifacts* (labels, buttons, messages), never to story narrative.

## The technical-documentation field (customer slot)

Many customers add a custom rich-text field on `rm_story` for technical documentation (e.g. `u_technical_documentation`). **This is a customer-specific field — verify it exists on `rm_story` on this instance before writing to it**, and record the actual field name in the Customer Project Rules section below. If no such field exists, deliver the HTML block in chat and let the developer decide where it lives (work notes, attached document, external wiki).

## What You Get From the Developer

1. **Update set XML** — one or more exported update sets (pasted or as a file path)
2. **Story context** — story number, ALM link, or a short explanation of what was built and why
3. **A reference to this skill**

## What You Produce

Two blocks of text the developer can copy-paste into the story record:

### 1. `description` (plain text)

- Short paragraphs separated by a **blank line** — each paragraph one coherent thought. Typical split: (1) what + key user flow, (2) technical approach or groundwork, (3) anything deferred / manual.
- Never output one giant blob — paragraph and line breaks are mandatory, not optional.
- **Enumerations get one item per line.** Whenever you list discrete things — personas, roles, deployment steps, validation rules — put each on its own line prefixed with `- ` (plain-text hyphen bullet), with a blank line before the list and a lead-in line ending in `:`. NEVER chain them into one semicolon-separated run-on sentence — that is the #1 readability failure of this field. The `description` field is plain text; hyphen bullets and line breaks read fine literally (no markdown rendering needed).
- Keep each sentence/bullet to one idea. A bullet may carry an "; otherwise X" clause, but don't pack three personas into one sentence.
- No markdown emphasis, no HTML — just plain text, `\n\n` between paragraphs, `\n- ` for list items.

### 2. Technical documentation (HTML)

- Grouped by logical theme (e.g. "Form behavior", "Server-side validation", "Translations"), NOT by table name
- Each group is a `<p><strong>` heading followed by a `<ul>` with `<li>` items
- Each item: `<strong>Name</strong> (table_label): one-line description of what it does`
- For items that are just data records (translations, messages, layout items), list them compactly — no need for one `<li>` per record if a summary suffices
- Keep descriptions short and factual — what, not why
- No sys_ids (this is a quick reference, not the full artifact catalog)
- No `<html>`, `<body>`, or `<head>` tags — just the content HTML that goes into the rich text field

### Example (minimal, placeholder scope `x_acme_fm`)

`description`:

```
Adds duplicate detection to facilities case intake. When an agent saves a new case, matching open cases on the same location are flagged before insert.

Two artifacts carry the logic:

- A before-insert business rule on x_acme_fm_case that calls the matcher and aborts with a message when a duplicate is found.
- A script include holding the matching query, so the rule stays a one-liner.

One manual deployment step, not update-set tracked: activate the "ACME - Duplicate check" system property on the target instance.
```

Technical documentation (HTML):

```html
<p><strong>Duplicate detection (x_acme_fm_case)</strong></p>
<ul>
<li><strong>ACME - Block duplicate case</strong> (Business Rule): before insert; aborts with a user message when the matcher returns an open case on the same location.</li>
<li><strong>ACMECaseMatcher</strong> (Script Include): server-side matching query used by the business rule.</li>
</ul>

<p><strong>Messages</strong></p>
<ul>
<li>acme.case.duplicate_found (UI Message) — source + target language per product.config.json.</li>
</ul>
```

## How to Parse the Update Set XML

Each `<sys_*>` element in the XML is one artifact. Key things to extract per artifact:

| What | Where |
|------|-------|
| Table | XML element name (e.g. `<sys_script>`, `<sys_ui_policy>`) |
| Name | `<name>` or `<short_description>` child element |
| What it does | Read `<script>`, `<operation_script>`, `<template>`, etc. and summarize in one line |
| Target table | `<collection>` or `<table>` child element |
| Scope | `<sys_scope display_value="...">` |

Ignore these XML elements — they're noise, not artifacts:
- `<sys_update_xml>` (update set wrapper records)
- `<sys_metadata_delete>` (deletion markers)
- `<sys_translated_text action="delete_multiple">` (translation cleanup)

## Grouping Strategy

Group artifacts by **what they accomplish together**, not by ServiceNow table. Good group names:
- "Button infrastructure" (declarative action assignments, payloads, action configs, layout items)
- "Modal flow" (routes, macroponents, screens, client scripts)
- "Server-side validation" (business rules)
- "Form configuration" (UI policies, client scripts, form layouts)
- "Translations & messages" (sys_ui_message, sys_translated, sys_translated_text)

Bad group names (too generic):
- "Business Rules" (unless they're truly independent of a larger flow)
- "Client Scripts" (group them by what flow they support)

Use your judgement. If the update set only has a few artifacts, flat grouping by table is fine.

## Rules

1. **No iterative checkpoints** — just read, parse, output. Ask only if something is genuinely ambiguous.
2. **No file creation** — output both blocks directly in the chat so the developer can copy them.
3. **No sys_ids in the technical doc** — this is a quick reference, not the full artifact catalog.
4. **Plain text for description, with paragraph breaks** — no markdown, no HTML. Split into 2-3 paragraphs with blank lines between. Never output a single blob.
5. **HTML for technical doc** — `<p><strong>`, `<ul>`, `<li>` only. No wrapper tags.
6. **Keep it concise** — if an artifact is self-explanatory from its name, don't over-describe it.
7. **Compact lists for data records** — translations, messages, choices can be listed comma-separated in a single `<li>` rather than one per line.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
