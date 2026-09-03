# Confluence Formatting Rules

## Purpose

This reference defines exactly what Markdown constructs survive a copy-paste into Confluence.
Use this when generating documentation to ensure 1-to-1 formatting fidelity.

---

## Supported Constructs (safe to use)

### Headings

```markdown
## Heading 2     → Confluence H2
### Heading 3    → Confluence H3
#### Heading 4   → Confluence H4
```

**Rules:**
- Never use `# H1` in story documents (reserved for the document title)
- Start story sections at `##`
- Sub-themes at `###`
- Detail sections at `####`

### Tables

```markdown
| Column A | Column B | Column C |
|----------|----------|----------|
| data     | data     | data     |
```

**Rules:**
- Always include the header separator row (`|---|---|`)
- Keep cell content short (< 80 chars per cell)
- No pipe `|` characters inside cell content (use "or" or reword)
- No multi-line content inside cells
- No merged cells (Confluence doesn't support via paste)
- Tables paste as native Confluence tables (editable, sortable)

### Lists

```markdown
Bullet list:
- Item 1
- Item 2
  - Sub-item (level 2)
    - Sub-sub-item (level 3 = MAX)

Numbered list:
1. First
2. Second
   1. Sub-first
```

**Rules:**
- Maximum 3 levels of nesting
- Beyond 3 levels: flatten or convert to a table
- Don't mix bullet and numbered in the same list
- Empty line before and after list blocks

### Text Formatting

```markdown
**Bold text**           → Bold
*Italic text*           → Italic
`inline code`           → Monospace
~~strikethrough~~       → Strikethrough (works in most Confluence versions)
```

**Rules:**
- No spaces inside markers: `**text**` not `** text **`
- Don't nest formatting: no `***bold italic***`
- Use `inline code` for field names, sys_ids, technical values

### Code Blocks

````markdown
```javascript
var gr = new GlideRecord('incident');
```
````

**Rules:**
- Language hints: `javascript`, `json`, `xml`, `html`, `plain`
- Confluence renders these as Code Macro blocks
- Keep code blocks short (< 30 lines) for readability
- For longer code, reference the file location instead

### Blockquotes

```markdown
> This is a note or callout.
> It can span multiple lines.
```

**Rules:**
- Use for important notes, warnings, context
- Confluence renders as indented block with left border
- Replacement for Confluence info/warning panels

### Horizontal Rules

```markdown
---
```

**Rules:**
- Use to separate major sections
- Confluence renders as a thin horizontal line

### Links

```markdown
[Link text](https://example.com)
```

**Rules:**
- Full URLs only (no relative paths)
- Use for ServiceNow record links, documentation references

---

## Unsupported Constructs (DO NOT use)

| Construct | What Happens | Alternative |
|-----------|-------------|-------------|
| `# H1` | Oversized heading, looks broken | Use `## H2` |
| `<div>` | Stripped or ignored | Use paragraphs |
| Custom CSS/styles | Completely ignored | Use Markdown formatting |
| `<section>`, `<article>` | Not recognized | Use headings for structure |
| HTML comments `<!-- -->` | Sometimes rendered as visible text | Remove them |
| Nested lists > 3 deep | Formatting collapses to flat | Flatten or use table |
| Images with local paths | Won't resolve | Upload to Confluence separately |
| Mermaid diagrams | Not rendered | Export as image, attach separately |
| Footnotes `[^1]` | Not rendered | Use inline parenthetical |
| Task lists `- [ ]` | Rendered as plain text | Use table with status column |
| Emoji shortcodes `:fire:` | Rendered as text | Spell it out or skip |

---

## Confluence-Specific Replacements

When you need a Confluence feature that doesn't exist in Markdown.
Write the callout labels in the deliverable's language (examples below are English;
translate the label word for a translated deliverable).

### Info Panel Replacement

```markdown
> **Note:** This is important information the administrator needs to know.
```

### Warning Panel Replacement

```markdown
> **Warning:** This change impacts existing configuration.
```

### Status Lozenge Replacement

```markdown
Status: **[Complete]** / **[Open]** / **[In progress]**
```

### Expand/Collapse Replacement

Don't try to replicate. Instead, use a clear heading structure:

```markdown
### 3.1 Theme Name

[Content that would have been in an expand section]
```

### Table of Contents Replacement

Include a manual TOC table at the top (example):

```markdown
| Story | Title | Status |
|-------|-------|--------|
| STRY0000001 | Initial module setup | Complete |
```

Confluence auto-generates TOC from headings anyway.

---

## Pandoc Export (Optional)

If you want to convert Markdown to clean HTML before pasting:

```bash
pandoc story.full.md -f markdown -t html --wrap=none -o story.html
```

Then open `story.html`, select all, copy, paste into Confluence.

**When to use Pandoc:**
- Tables with many columns (paste stability improves)
- Large documents (> 5 pages)
- When direct Markdown paste doesn't look right

**When NOT to use Pandoc:**
- Short documents (direct paste works fine)
- Simple structure (headings + bullets + 1-2 tables)
