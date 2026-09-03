# Example Story Output (step 10 deliverable)

> **Example only.** Fictional story on the placeholder scope `x_acme_fm`
> (table `x_acme_fm_case`, instance `acmedev`). Write the real deliverable in the
> customer's deliverable language; this example uses English. Follow
> [confluence_formatting_rules.md](confluence_formatting_rules.md) — note the
> section starts at `##`, not `#`.

---

## STRY0000001 - Initial setup of the Facilities Management module

### Summary

- Facilities Management module set up as a standalone module on scope `x_acme_fm`.
- Assignment groups, workspace, and the case intake flow are operational.

### Overview of changes

| Theme | What changed | Why |
|-------|--------------|-----|
| Assignment groups | Groups created for coordinators, specialists, and managers | Correct authorization and division of work |
| Workspace | Configurable workspace set up with lists and filters | Efficient daily working environment for specialists |
| Case intake | Record producer created for reporting a facilities case (`x_acme_fm_case`) | Structured registration of incoming reports |
| Notifications | Confirmation email to the reporter on case creation | Reporter knows the case was received |

### Impact for administrators

- Maintain group membership when staffing changes.
- Adjust notification texts via the translated-text records when wording changes.

### Open items

| # | Item | Status |
|---|------|--------|
| 1 | Confirm final group structure with the administration team | Open |
| 2 | Connect the reporting tile to the management dashboard | Open |
