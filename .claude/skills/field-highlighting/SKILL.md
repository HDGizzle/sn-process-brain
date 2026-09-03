---
name: field-highlighting
description: Invoke when the user asks to "highlight field", "field color", "conditional styling", "overdue styling", "highlighted value", "sys_ui_style", "sys_highlighted_value", "color field based on condition", or when styling fields conditionally in classic UI or workspace.
---

# Field Highlighting / Conditional Field Styling

Conditionally coloring a field value is configured through **two entirely separate systems** — one for classic UI, one for workspace — and they share nothing. Deciding which UI(s) need the styling is step one of every request.

| Aspect | Classic UI | Workspace |
|---|---|---|
| Table(s) | `sys_ui_style` | `sys_highlighted_value` + `sys_highlighted_value_condition` |
| Styling model | Raw CSS (`color: red;`) | Semantic color names (`critical`, `high`, `warning`, …) |
| Where it renders | Classic lists and forms | Workspace lists and forms |
| Condition format | JavaScript expression over `current` | Encoded query (same syntax as list filters) |

Styling needed in **both** UIs means creating records in **both** systems — there is no sync between them.

## Classic UI: `sys_ui_style` (Field Styles)

Navigation: **System UI > Field Styles**.

### Key fields

| Field | API name | Meaning |
|---|---|---|
| Name | `name` | The **table** name (e.g. `x_acme_fm_case`) — yes, the field called "name" holds the table |
| Value | `value` | JavaScript condition evaluated against `current` |
| Style | `style` | CSS applied when the condition is true |
| Themed Style | `themed_style` | Same CSS, used by themed UI — populate both |

The dictionary field the style targets is chosen via the **element** on the form; the condition decides *when* it fires.

### Condition syntax (JavaScript over `current`)

```javascript
// Date field is in the past
javascript:new GlideDateTime(current.due_date) < new GlideDateTime();

// Choice equals a value
javascript:current.priority == 1;

// Field empty
javascript:current.due_date.nil();

// Combined
javascript:new GlideDateTime(current.due_date) < new GlideDateTime() && current.state != 3;
```

### Style syntax — plain CSS

```css
color: red;
color: red; font-weight: bold;
background-color: #ffcccc; color: red;
```

### Example: overdue `due_date` shown in red (example values)

| Field | Value |
|---|---|
| Name | `x_acme_fm_case` |
| Value | `javascript:new GlideDateTime(current.due_date) < new GlideDateTime();` |
| Style | `color: red;` |
| Themed Style | `color: red;` |

### Creating via the agent API (example payload)

Remember the dual switch_context (update set AND application) before the write, and read the record back afterwards.

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_ui_style",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "x_acme_fm_case",
      "value": "javascript:new GlideDateTime(current.due_date) < new GlideDateTime();",
      "style": "color: red;",
      "themed_style": "color: red;"
    }
  }
}
```

### Limitations

- Classic UI only — workspace ignores `sys_ui_style` completely.
- The style applies to the whole field cell in lists.
- Raw CSS only; no semantic color vocabulary.

---

## Workspace: UX Highlighted Values

Two tables cooperate:

```
sys_highlighted_value              (parent — names the table + field to style)
  └── sys_highlighted_value_condition   (child — when to fire + which color)
```

### `sys_highlighted_value` (parent)

| Field | API name | Meaning |
|---|---|---|
| Name | `name` | Display name — follow the project naming prefix, e.g. `ACME - Due Date Overdue` |
| Table | `table` | Target table (e.g. `x_acme_fm_case`) |
| Field | `field` | Target field (e.g. `due_date`) |
| Active | `active` | Boolean |

### `sys_highlighted_value_condition` (child)

| Field | API name | Meaning |
|---|---|---|
| Highlighted Value | `highlighted_value` | Reference to the parent record |
| Conditions | `conditions` | **Encoded query — NOT JavaScript** |
| Color | `color` | Semantic color name |
| Variant | `variant` | `primary`, `secondary`, or `tertiary` |
| Order | `order` | Evaluation order; lowest matching wins |
| Value Override | `value_override` | Optional replacement display text |
| Label | `form_label_description` | Optional label override when the condition matches |

### CRITICAL: the field is `conditions` — plural

The condition column's API name is **`conditions`**, not `condition`. Writing to `condition` fails **silently**: the record saves, the field stays empty, and an empty condition matches everything — so the highlight fires on **every** record unconditionally. If a workspace highlight colors all rows, this is the first thing to check.

### Condition syntax — encoded query

Identical to list-filter encoded queries:

```
# Overdue and not closed
due_date<javascript:gs.beginningOfToday()^due_dateISNOTEMPTY^state!=3

# Priority critical
priority=1

# New or in progress
state=1^ORstate=2

# Unassigned
assigned_toISEMPTY
```

### Semantic colors

| Color | Renders as | Typical use |
|---|---|---|
| `critical` | Red | Overdue, blocked, P1 |
| `high` | Orange-red | High priority, deadline approaching |
| `warning` | Yellow/amber | Needs attention |
| `moderate` | Orange | Medium priority |
| `low` | Blue-gray | Low priority |
| `positive` | Green | Resolved, on track |
| `info` | Blue | Informational |

Also available: `blue`, `brown`, `gray`, `green`, `green-yellow`, `magenta`, `orange`, `pink`, `purple`, `teal`, `yellow`.

### Variants

| Variant | Effect |
|---|---|
| `primary` | Solid colored background |
| `secondary` | Light background + colored border |
| `tertiary` | Colored text only (most subtle) |

### Example: overdue `due_date` in red (example payloads)

Step 1 — parent:

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_highlighted_value",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "ACME - Due Date Overdue",
      "table": "x_acme_fm_case",
      "field": "due_date",
      "active": "true"
    }
  }
}
```

Step 2 — condition (use the sys_id returned by step 1):

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_highlighted_value_condition",
    "scope": "<scope sys_id>",
    "fields": {
      "name": "Overdue",
      "highlighted_value": "<sys_id_from_step_1>",
      "conditions": "due_date<javascript:gs.beginningOfToday()^due_dateISNOTEMPTY^state!=3",
      "color": "critical",
      "variant": "tertiary",
      "order": "100",
      "active": "true"
    }
  }
}
```

### Multiple conditions on one parent

One parent may carry several condition children; the first match by ascending `order` wins:

```
sys_highlighted_value: "Case Priority" → table: x_acme_fm_case, field: priority
  ├── priority=1 → critical, order 100
  ├── priority=2 → high,     order 200
  ├── priority=3 → moderate, order 300
  └── priority=4 → low,      order 400
```

### Limitations

- Workspace only — classic UI never reads these tables.
- Semantic colors only; no raw CSS.
- Conditions are encoded queries, never JavaScript expressions.

---

## Debugging

| Symptom | Likely cause | Fix |
|---|---|---|
| Every record highlighted (workspace) | `conditions` field empty — probably wrote to `condition` singular | Populate `conditions` (plural) and verify with a read-back |
| No highlight (workspace) | Condition child missing or not referencing the parent | Verify the `sys_highlighted_value_condition` record and its `highlighted_value` reference |
| No highlight (classic) | JavaScript error in the `value` expression | Test the expression in a background script |
| Classic works, workspace doesn't | Only `sys_ui_style` exists | Add the `sys_highlighted_value` pair |
| Workspace works, classic doesn't | Only highlighted-value records exist | Add a `sys_ui_style` record |
| Wrong color wins (workspace) | Order collision | Lower `order` evaluates first — reorder |

## Checklist

- [ ] Decide: classic UI, workspace, or both
- [ ] Classic: `sys_ui_style` with JavaScript condition + CSS in `style` AND `themed_style`
- [ ] Workspace: `sys_highlighted_value` parent, then `sys_highlighted_value_condition` child
- [ ] Confirm `conditions` (plural) is actually populated — read the record back
- [ ] Test against one matching and one non-matching record
- [ ] Verify all records landed in the intended scope and update set

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
