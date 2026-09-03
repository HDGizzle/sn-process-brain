# Translation & Naming of Workspace Buttons and Modals

> Reference for the `workspace-modal-actions` skill. Applies when the project ships more than one language — the source language and target languages come from `product.config.json` (`language.source` / `language.targets`). See also the `translate-workspace-ui` and `translate-server-scripts` skills.

Examples below use source language `en` and a target-language placeholder `<target_lang>` (e.g. a two-letter language code). Substitute your project's languages.

## CRITICAL: Check System Language BEFORE Any Translation Work

**Before creating or debugging translations, ALWAYS check the user's current system language setting.** A non-source system language causes:
- API query results to return translated display values instead of stored source-language values
- Confusion about whether a field stores source-language or translated text
- False positives when testing translations (text appears translated but it's the raw stored value, not a translation)

**Pre-flight check:**
1. Ask the user: "What is your system language set to?"
2. If a target language → ask them to switch to the **source language** first
3. Only THEN inspect records and create translations
4. Test translations by switching BACK to the target language after creation

**Why this matters:** If the system language is a target language when you query `sys_ux_form_action.name` and get translated text back, you cannot tell if:
- (A) The stored name IS the translated text (wrong — should be the source language), or
- (B) The stored name is the source-language text and the API is returning the translated display value (correct)

Working in the source language eliminates this ambiguity.

---

## Two Translation Tables — `sys_translated` vs `sys_translated_text`

ServiceNow has **two completely different translation mechanisms**. Using the wrong one causes silent failures.

| Table | Mechanism | Targets | Use Case |
|-------|-----------|---------|----------|
| **`sys_translated`** | Global value match | ALL records where `table.field = value` | Layout item labels, UI action names/hints |
| **`sys_translated_text`** | Record-specific by sys_id | ONE specific record via `documentkey` | Form action names, DA assignment labels, any `translated_text` field type |

**How to know which to use:** Check the field type in the table dictionary:
- `string` type → `sys_translated` (global match)
- `translated_text` type → `sys_translated_text` (record-specific)

## Form Action Names (`sys_ux_form_action.name`) — `sys_translated_text`

The `name` field on `sys_ux_form_action` is a **`translated_text`** type. This means it translates via `sys_translated_text` — **NOT** `sys_translated`.

**This is the label shown on split button dropdowns and primary buttons.**

**Pattern:**
1. Set `sys_ux_form_action.name` to **source-language** base text
2. Create a `sys_translated_text` record targeting the specific form action:

| Field | Value |
|-------|-------|
| `documentkey` | sys_id of the `sys_ux_form_action` record |
| `fieldname` | `name` |
| `tablename` | `sys_ux_form_action` |
| `language` | `<target_lang>` |
| `value` | translated text |

**Example:** Form action "Save" → translated label

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_translated_text",
    "scope": "x_acme_fm",
    "fields": {
      "documentkey": "<form_action_sys_id>",
      "fieldname": "name",
      "tablename": "sys_ux_form_action",
      "language": "<target_lang>",
      "value": "<translated label for Save>"
    }
  }
}
```

**Example:** Form action "Save and Close" → translated label

```json
{
  "command": "create_artifact",
  "params": {
    "table": "sys_translated_text",
    "scope": "x_acme_fm",
    "fields": {
      "documentkey": "<form_action_sys_id>",
      "fieldname": "name",
      "tablename": "sys_ux_form_action",
      "language": "<target_lang>",
      "value": "<translated label for Save and Close>"
    }
  }
}
```

**Key points:**
- The form action `name` field MUST stay in the **source language** — it is the base text
- `sys_translated_text` targets a SPECIFIC record by sys_id (via `documentkey`)
- `sys_translated` on `sys_ux_form_action.name` does **NOT** work — wrong translation table entirely
- This applies to ALL form actions: standalone buttons, split button items, dropdown items
- `create_artifact` may refuse tables without a `name` field — create `sys_translated_text` records via a background script if so (keeps update-set capture with a plain `insert()`)

## Form Action Layout Item Labels (`sys_ux_form_action_layout_item.label`) — `sys_translated`

The `label` field on layout items is a `string` type. These translate via the `sys_translated` table with global value matching.

**Pattern:**
1. Set the `label` field on `sys_ux_form_action_layout_item` to **source-language** base text
2. Create a `sys_translated` record per target language:

| Field | Value |
|-------|-------|
| `name` (table) | `sys_ux_form_action_layout_item` |
| `element` | `label` |
| `value` | source-language base text (must match the label exactly) |
| `label` | translated text |
| `language` | `<target_lang>` |

**Example:** Button "Close case" → translated label

```
sys_translated record:
  name     = sys_ux_form_action_layout_item
  element  = label
  value    = Close case              (source — must match layout item label exactly)
  label    = <translated label>
  language = <target_lang>
```

This translates ALL `sys_ux_form_action_layout_item` records where `label = "Close case"`. No need to target individual records by sys_id.

## DA Assignment Labels (`sys_declarative_action_assignment`) — `sys_translated_text`

The `label` field on DA assignments is a `translated_text` type. These translate via the `sys_translated_text` table (not `sys_translated`).

Same pattern as form action names — target by `documentkey` (the DA assignment sys_id).

## UI Action Names and Hints (`sys_ui_action`) — `sys_translated`

The `name` and `hint` fields on `sys_ui_action` are `string` types. These translate via `sys_translated` with global value matching.

```
sys_translated record:
  name     = sys_ui_action
  element  = name
  value    = Save and Close          (source — must match sys_ui_action.name exactly)
  label    = <translated label>
  language = <target_lang>
```

## SOW Form Modal Params (`modalTitle`, `saveLabel`)

**These are NOT translatable via any standard mechanism.** (Finding from production i18n debugging — verify on your instance first.)

I18N debugging shows **NO PREFIX** on `modalTitle` and `saveLabel` — meaning no translation table is consulted. The SOW Form Modal v2 renders these as raw strings from the payload template.

**Confirmed NOT working:**
- `sys_ui_message` (getMessage is never called)
- `sys_translated` (no table/field to target)
- `translate('...')` syntax in payload
- `$[...]` syntax in payload

**The only option:** Hardcode the desired language in the `payload_template`:

```json
{
    "params": {
        "modalTitle": "<title in the language most users see>",
        "saveLabel": "<save label in the language most users see>"
    }
}
```

Users on the other language will see the hardcoded language on the modal title and save button. This is a known platform limitation — flag the trade-off to the customer.

**Note:** The Cancel button and the X (close) button tooltip ARE translated automatically by the platform — only `modalTitle` and `saveLabel` are affected.

## Translation Summary Table

| Element | Translation Table | Match Type | Translatable? |
|---------|------------------|------------|---------------|
| **Form action name** (`sys_ux_form_action.name`) | **`sys_translated_text`** | Record-specific (`documentkey`) | Yes |
| Layout item label (`sys_ux_form_action_layout_item.label`) | `sys_translated` | Global value match | Yes |
| UI action name (`sys_ui_action.name`) | `sys_translated` | Global value match | Yes |
| UI action hint (`sys_ui_action.hint`) | `sys_translated` | Global value match | Yes |
| DA assignment label (`sys_declarative_action_assignment.label`) | `sys_translated_text` | Record-specific (`documentkey`) | Yes |
| Modal title (`modalTitle`) | None — raw string from payload | N/A | No |
| Modal save button (`saveLabel`) | None — raw string from payload | N/A | No |
| Modal cancel button | Platform-translated | Automatic | Yes (automatic) |

## Translation Checklist for Workspace Buttons

**For every new workspace button, create translations for ALL layers (per target language):**

1. **`sys_ui_action.name`** — via `sys_translated` (global value match)
2. **`sys_ui_action.hint`** — via `sys_translated` (global value match)
3. **`sys_ux_form_action.name`** — via `sys_translated_text` (record-specific by sys_id)
4. **`sys_ux_form_action_layout_item.label`** — via `sys_translated` (global value match, for standalone buttons)

**For split button / dropdown groups:**
- Each form action in the group needs a `sys_translated_text` record for its `name` field
- The layout item label (group label) needs a `sys_translated` record if displayed

## Naming Conventions for Workspace Buttons

**UI action `name` is used as button label fallback in workspace.** When the layout item label is missing or falls back, the `sys_ui_action.name` value is what the user sees on the button. This means:

| Artifact Type | Naming Convention | Example | Why |
|---------------|-------------------|---------|-----|
| **UI Action** (`sys_ui_action`) | Clean source-language label, NO record prefix — this is the user-facing button label | `Save and Close`, `Create investigation` | Name shows on the button |
| **Form Action** (`sys_ux_form_action`) | Clean source-language label, NO record prefix — translated via `sys_translated_text` | `Save`, `Save and Close`, `Close case` | Name shows in dropdowns and split buttons |
| **Business Rule** (`sys_script`) | Source language with the project record prefix | `ACME - Require work notes on state change` | Internal, never shown to users |
| **Client Script** (`sys_script_client`) | Source language with the project record prefix | `ACME - Case - New Record Read-Only Field` | Internal, never shown to users |
| **UI Policy** (`sys_ui_policy`) | Source language with the project record prefix | `ACME - Work notes mandatory - Close case` | Internal, never shown to users |

(Prefix `ACME - ` is an example — use the `naming.recordPrefix` from `product.config.json`.)

**Button label sources (what the user sees):**
- Standalone button: `sys_ux_form_action_layout_item.label` (translated via `sys_translated`)
- Split button primary: `sys_ux_form_action.name` of the first action (translated via `sys_translated_text`)
- Split button dropdown items: `sys_ux_form_action.name` of each action (translated via `sys_translated_text`)
- Fallback: `sys_ui_action.name` (translated via `sys_translated`)

**Never put the record prefix on UI action or form action names** — it will show on the button (e.g. "ACME - Save and Close").

**Never hardcode a target language in `name` fields** — always store the source language and translate via the appropriate translation table. Hardcoding a target language breaks source-language users and makes the intent unclear when inspecting records.

## CRITICAL: Client Script `messages` Field for getMessage()

**Any client script that calls `getMessage('key')` MUST list every key in the `messages` field on the `sys_script_client` record.** Without this, the client-side i18n cache does not preload the translation and `getMessage()` silently returns the raw key string instead of the translated value.

```
messages field value (comma-separated, no spaces):
<namespace>.case_modal.select_status,<namespace>.case_modal.work_notes_label
```

(`<namespace>` = the `naming.messageKeyNamespace` from `product.config.json`.)

**Applies to:** All client script types (onLoad, onChange, onSubmit, onCellEdit)
**Does NOT apply to:** Server-side `gs.getMessage()` in BRs/script includes (reads directly from sys_ui_message at runtime)

**Checklist when using getMessage in client scripts:**
1. Replace hardcoded string with `getMessage('<namespace>.<feature>.descriptive_key')`
2. Create `sys_ui_message` records (source language + every target language)
3. Add every key to the `messages` field on the client script record

**Forgetting step 3 causes a silent failure** — no error, just the raw key displayed as text.
