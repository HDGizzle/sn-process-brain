---
name: atf-testing
description: Invoke when the user asks to "create test", "ATF", "automated test", "test suite", "test step", "regression test", "sys_atf", "run tests", or any ServiceNow Automated Test Framework development or debugging.
---

> ⚠️ Rebuilt from unverified reference material — verify each pattern on your instance before relying on it.

# Automated Test Framework (ATF)

ATF is the platform's built-in automated testing engine: tests composed of ordered steps, grouped into suites, producing stored results — usable for regression protection before upgrades and update-set promotions.

## Structure

```
Test Suite: "ACME - Case Management Regression"
├── Test: Create case
│   ├── 100  Impersonate (role-holder user)
│   ├── 200  Open a New Form (x_acme_fm_case)
│   ├── 300  Set Field Values
│   ├── 400  Submit a Form
│   └── 500  Field Values Validation
├── Test: Assign case
└── Test: Close case
```

## Key tables

| Table | Purpose |
|---|---|
| `sys_atf_test` | Test definition |
| `sys_atf_step` | Ordered steps within a test |
| `sys_atf_step_config` | Catalog of available step types (referenced by each step) |
| `sys_atf_test_suite` | Suite grouping |
| `sys_atf_test_suite_test` | Suite ↔ test membership (with order) |
| `sys_atf_test_result` | Execution results |

## Common step types

| Step type | Purpose |
|---|---|
| Impersonate | Run subsequent steps as a specific user — test the persona, not admin |
| Open a New Form | Start a create-record scenario |
| Open an Existing Record | Edit scenario |
| Set Field Values | Populate form fields |
| Click a UI Action / Submit a Form | Trigger buttons / save |
| Field Values Validation | Assert field values after the action |
| Record Query / Record Validation | Server-side existence + value checks |
| Run Server Side Script | Arbitrary validation or data setup (see below) |
| Wait / timing steps | Let async processing (events, flows) finish before asserting |

Common assertion operators for validation steps: `equals`, `not equals`, `is empty`, `is not empty`, `contains`, `starts with`, `greater than`, `less than`.

## Building tests: UI first

Build tests in the ATF UI (or copy an existing test) rather than scripting the records. Two structural reasons:

- `sys_atf_step.step_config` is a **reference** to a `sys_atf_step_config` row — you must resolve the step type's sys_id, not write a name string.
- Step **inputs are not a simple field**: they are stored as variable values bound to the step (variable definitions live on the step config). Writing a JSON blob into the step record does not configure it.

If you generate tests programmatically anyway, insert `sys_atf_test` + `sys_atf_step` skeletons, then verify in the UI that every step's inputs actually populated — an ATF step with silently-empty inputs passes creation and fails only at run time. Keep step order in increments of 100 so steps can be inserted later without renumbering.

Scoped apps: set the test's application scope correctly so it travels with the app, and capture everything in the story update set (see the `update-set-workflow` skill — verify capture after writing).

## Run Server Side Script steps

Signature and result contract:

```javascript
(function(outputs, steps, params, stepResult) {
    // steps['<step sys_id>'] exposes prior step outputs, e.g. .record_id
    var caseId = steps['<create-step-sys_id>'].record_id;

    var gr = new GlideRecord('x_acme_fm_case');
    if (!gr.get(caseId)) {
        stepResult.setOutputMessage('Case not found');
        stepResult.setFailed();
        return;
    }
    if (gr.getValue('assignment_group') === '') {
        stepResult.setOutputMessage('Assignment rule did not fire');
        stepResult.setFailed();
        return;
    }
    outputs.case_number = gr.getValue('number');
    stepResult.setOutputMessage('Validations passed');
})(outputs, steps, params, stepResult);
```

- `stepResult.setFailed()` marks the step failed; always pair it with `setOutputMessage()` so the result explains itself.
- Pass data forward via `outputs.<name>`; read prior steps via `steps[...]`.
- ES level: script steps run server-side Rhino — write ES5 unless the owning scope has ES12 mode enabled; see the `es5-compliance` skill.

### Data setup and cleanup

- **Setup step**: query-or-create the fixture (test user, reference data) idempotently; export its sys_id via `outputs` for later steps.
- **Cleanup step**: delete records created during the test, keyed off earlier steps' `record_id` outputs. Note ATF's own rollback covers many data changes on tracked tables, but explicit cleanup is safer for anything it does not track.
- Use obviously-synthetic fixture data (e.g. user `atf_test_user`, email `atf-test@example.com`) so leftover records are recognizable.

## Suites

Group tests via `sys_atf_test_suite` + `sys_atf_test_suite_test` (with `order`). Run the full suite before committing an update set for promotion, and schedule the regression suite before platform upgrades.

## Practices

1. One scenario per test — atomic tests localize failures.
2. Impersonate the real persona; a test that runs as admin proves almost nothing about ACLs or UI policies.
3. Insert Wait steps before asserting on anything produced asynchronously (events, flows, async business rules).
4. Descriptive test and step names with a consistent prefix (e.g. "ACME - ...") so suites read as documentation.
5. Tests must be runnable repeatedly — idempotent setup, reliable cleanup.
6. Remember the platform disables ATF execution by default on production instances (a system property controls it) — plan where suites actually run *(verify on your instance first)*.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
