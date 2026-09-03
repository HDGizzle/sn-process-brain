---
name: azure-story
description: Invoke when the user asks to "create azure story", "create story in azure", "write story in devops", "new story azure devops", "update work item", or when writing agile-format requirements stories in the customer's work tracker BEFORE or DURING development. NEVER for generating ServiceNow rm_story record content from update set XML — that is the "story-specs" skill.
---

# Work Tracker Story — Create / Update User Story

Create or update a user story in the customer's work tracker in proper agile format.

**Azure DevOps is the primary path** in this skill (`product.config.json` →
`git.host: "azure-devops"`). If the customer uses another host (GitHub Issues,
GitLab), keep the story format and workflow sections and adapt the API mechanics
to that host — only the sections under "Azure DevOps specifics" are host-bound.

## Required Inputs

Before writing anything, confirm these with the user if not provided:

| Field | Required | Notes |
|---|---|---|
| **Title** | Yes | Short, descriptive |
| **Parent feature** | Yes | Work item ID of the parent Feature — never create a story without a parent |
| **What was built / context** | Yes | Enough to write the user story card and AC |
| **Assigned to** | No | Defaults to unassigned |
| **Sprint / iteration** | No | Defaults to current sprint |

**Never create a story without a parent feature.** Ask for the parent ID if not given.

## Story Format (Agile)

Every story has three parts:

### 1. Title
Short, action-oriented. Write it in the story language (see Language below).

### 2. Description (HTML)
Three parts in one HTML field:

**User story card** (first line, always):
```
As a [user] I want [goal] so that [benefit].
```
(Render the card in the story language — use the equivalent of this pattern in
the project's working language when it is not English.)

**Background** (2-3 sentences):
- What triggered this story
- What the current situation is / what was wrong
- What is explicitly NOT in scope (if relevant)

**Format:** HTML — use `<br>` for line breaks between paragraphs.

### 3. Acceptance Criteria (HTML)
- Checklist format — specific, testable, binary (pass/fail)
- Each criterion is one `<li>` — no vague terms like "works correctly"
- Include a **Definition of Done** block at the end
- Azure DevOps field: `Microsoft.VSTS.Common.AcceptanceCriteria`

## Language

Story content language comes from `product.config.json` → `language`: if the
project has a non-English working language for internal stories, use it;
otherwise write in `language.source`. Follow the user's lead when they draft in
a specific language. Do not mix languages within a single field.

## Workflow

1. **Confirm inputs** — title, parent feature ID, context. Ask if missing.
2. **Draft the story** — show the full user story card + description + AC in chat first.
3. **Wait for user approval** before creating/updating.
4. **Create or update** via the REST API.
5. **Verify** — fetch the work item back and confirm description + AC are both present and not doubled.
6. **Report** — share the direct link to the work item.

---

## Azure DevOps specifics

### Environment

- **Tool:** Azure CLI (`az`), authenticated against the customer organization.
  If `az` is not on PATH, prepend its install directory to `$env:PATH` first.
- **Organization / project:** derive from `product.config.json` → `git.remote`
  (the org and project appear in the clone URL); confirm with the user on first use.
- **REST API over CLI for HTML fields:** the `az boards work-item update
  --description` CLI flag truncates at the first newline. Use the REST API via
  `Invoke-RestMethod` for any multi-line HTML field. Get a fresh token with:
  ```powershell
  az account get-access-token --resource "499b84ac-1321-427f-aa17-267ca6975798" --query accessToken -o tsv
  ```
  (That resource GUID is the fixed Azure DevOps application ID — same for every
  organization.) Then PATCH to:
  ```
  https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?api-version=7.1
  ```
  with `Content-Type: application/json-patch+json`.

### REST API pattern

```powershell
$token = az account get-access-token --resource "499b84ac-1321-427f-aa17-267ca6975798" --query accessToken -o tsv

$desc = "<html description as single string>"
$ac   = "<html acceptance criteria as single string>"

$body = "[
  {`"op`":`"add`",`"path`":`"/fields/System.Title`",`"value`":$(($title | ConvertTo-Json))},
  {`"op`":`"add`",`"path`":`"/fields/System.Description`",`"value`":$(($desc | ConvertTo-Json))},
  {`"op`":`"add`",`"path`":`"/fields/Microsoft.VSTS.Common.AcceptanceCriteria`",`"value`":$(($ac | ConvertTo-Json))},
  {`"op`":`"add`",`"path`":`"/relations/-`",`"value`":{`"rel`":`"System.LinkTypes.Hierarchy-Reverse`",`"url`":`"https://dev.azure.com/{org}/{project}/_apis/wit/workItems/{PARENT_ID}`"}}
]"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json-patch+json"
}

# CREATE new story
$url = "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/`$User Story?api-version=7.1"
$response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body

# UPDATE existing story (use replace, not add)
$url = "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{ID}?api-version=7.1"
$response = Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $body
```

**Key rules:**
- Use `op: add` when creating (POST)
- Use `op: replace` when updating existing fields (PATCH) to avoid double content
- Always build HTML as a single flat string — no PowerShell newlines inside the string or the REST call will truncate
- Parent link uses the `System.LinkTypes.Hierarchy-Reverse` relation type
- Direct link format for reporting back: `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`

### Field & UI gotchas

- **`Task` work items may have NO Acceptance Criteria field.** Typically only
  `User Story` carries `Microsoft.VSTS.Common.AcceptanceCriteria`; check with
  `GET .../_apis/wit/workitemtypes/Task/fields` — the field can be absent from
  Task's field list entirely (not just empty). For a Task's equivalent — a
  technical/dev checklist — put it in `System.Description` instead, and say so
  explicitly when reporting back so the user isn't left looking for a field
  that was never there.
- **The Acceptance Criteria section on the work item form is collapsed by
  default.** It renders as a header with a chevron and no visible content until
  clicked open. If a user says they "don't see" AC after you've verified via
  the API that the field has content, don't just re-assert the API value —
  look at the actual work item page (screenshot) first. The field can hold the
  full content server-side while the section is simply collapsed.
- **"Sprint <ProjectName>" usually means the root/unscheduled iteration**, not
  a sprint literally named that. The bare project root (no sprint number) is
  the backlog/unscheduled bucket, and it is often where the parent Feature
  already sits. Check `System.IterationPath` on the parent Feature or a
  sibling item before guessing what "sprint X" means.
- **Check existing sibling items before creating a new child Task.** Fetch the
  parent's children (`?$expand=all` → `relations` →
  `System.LinkTypes.Hierarchy-Forward`, then look up each title) to find the
  naming convention already in use, so the new item matches instead of
  inventing a different pattern.

## Example Output

(Example only — neutral content in English; write real stories in the project's story language.)

**Description:**
```html
As a case manager I want the priority choice labels to match the official definitions, so that I can classify cases correctly and unambiguously.<br><br>During the first test round two deviations from the official definition list were found: two choice descriptions did not match, and one field showed numeric ranges instead of descriptive names.<br><br>No changes to the underlying calculation — only the displayed labels are corrected, in all configured languages.
```

**Acceptance Criteria:**
```html
<ul>
  <li>Priority value 2 shows "High — response within one business day"</li>
  <li>Category field shows the descriptive name, not a numeric range</li>
  <li>Changes applied in all configured languages</li>
</ul>
<b>Definition of Done:</b>
<ul>
  <li>Verified on the dev instance (e.g. acmedev)</li>
  <li>Peer review completed</li>
  <li>Update set delivered</li>
</ul>
```

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
