---
name: flow-designer
description: Invoke when the user asks to "create flow", "Flow Designer", "sys_hub_flow", "workflow automation", "subflow", "flow action", "flow trigger", "scheduled flow", or any ServiceNow Flow Designer development. NOT for classic State Flows (sf_state_flow) — use the "state-flows" skill.
---

> ⚠️ Rebuilt from unverified reference material — verify each pattern on your instance before relying on it.

# Flow Designer Patterns

Flow Designer (`sys_hub_flow`) is the platform's current automation engine — the default for new process automation, replacing legacy Workflow (`wf_workflow`) which should only be maintained, not extended.

Flows are built in the Flow Designer UI. Their internals (flow snapshots, logic blocks) are not practical to author record-by-record via API — build in the designer, then verify the flow and its actions were captured in the story update set (see the `update-set-workflow` skill).

## Components

| Component | Purpose | Reusable |
|---|---|---|
| **Flow** | The end-to-end automation, owns the trigger | No |
| **Subflow** | Callable flow logic with typed inputs/outputs | Yes |
| **Action** | Single operation (script, record op, REST, notification) | Yes |
| **Spoke** | Packaged collection of related actions | Yes |

## Triggers

- **Record-based**: Created / Updated / Created-or-Updated on a table, with a condition (e.g. `x_acme_fm_case`, condition `priority=1`). Prefer a tight trigger condition over an early If-step — the trigger filter is cheaper.
- **Scheduled**: daily/weekly/repeating at a fixed time and timezone — the Flow Designer equivalent of a scheduled job.
- **Service Catalog**: fires for a catalog item's requested items.
- **Application-specific triggers** (inbound email, SLA, etc.) exist per plugin — check the trigger picker on your instance.

## Flow data (`fd_data`)

| Scope | Access | Use |
|---|---|---|
| Trigger data | `fd_data.trigger.current.<field>` | The triggering record's values |
| Prior step outputs | `fd_data.<step>.<output>` (picked via the data pane) | Chain results between steps |
| Subflow inputs/outputs | defined on the subflow, mapped by the caller | The subflow contract |

Always bind data via the data-pill picker in the UI rather than typing paths by hand — hand-typed paths break silently when steps are renamed.

## Custom script actions

Script steps inside actions use the `execute` contract:

```javascript
(function execute(inputs, outputs) {
    var gr = new GlideRecord('x_acme_fm_case');
    if (gr.get(inputs.case_sys_id)) {
        gr.setValue('state', inputs.target_state);
        gr.update();
        outputs.success = true;
        outputs.case_number = gr.getValue('number');
    } else {
        outputs.success = false;
        outputs.error_message = 'Case not found';
    }
})(inputs, outputs);
```

- Define inputs/outputs in Action Designer; never reach around them to global state.
- To make a failure routable by the flow's error handling, `throw` after setting your error outputs — a swallowed `catch` makes the flow report success on a broken step.
- ES level: action scripts run in the action's scope — ES5 always works; scoped apps with ES12 mode enabled may use modern syntax. See the `es5-compliance` skill.
- Logging inside flow context: `fd_log.info/debug/warn/error(...)` writes to the flow execution log, which is where you will actually look when debugging.

## Error handling shape

Model integrations with explicit error paths:

```
Flow: Process integration
├── Try:      Call REST → Parse response → Update record
├── Catch:    Log error details → Create error task → Alert
└── Always:   Cleanup temp data
```

Use the flow's error-handling section (or an If on the action's success output) — never let a failed REST step fall through into record updates.

## REST actions

Configure via a Connection & Credential alias (never hardcode endpoints/tokens in the action). Map the request body from action inputs, parse the response as JSON, then branch on `status_code` in a follow-up script/If step and surface the response body's error on failure.

## Subflow patterns

Design subflows as contracts: typed inputs, typed outputs, no side-channel assumptions.

- **Notification subflow**: inputs recipient/subject/body → look up user → send → output `success`. Keeps notification logic in one reusable place.
- **Approval subflow**: inputs record + approver → create approval → *Wait for condition* on the approval state → output `approved` + rejection comments. Pair with the `approval-workflows` skill for the underlying tables.

## Flow Designer vs legacy Workflow

| Aspect | Flow Designer | Legacy Workflow |
|---|---|---|
| Reusability | Subflows, actions, spokes | Limited |
| Testing | Built-in test execution | Manual |
| Integration Hub | Yes | No |
| Recommendation | **All new development** | Maintain existing only |

## Debugging

- **Flow Designer → Executions**: per-run, step-by-step state, inputs/outputs per step — the primary debugging surface.
- `fd_log.*` output appears in the execution context.
- A flow that "didn't run": check trigger condition, flow activation state, and the application scope the trigger table lives in.
- A flow that ran but changed nothing: open the execution and inspect each step's actual inputs — data-pill mapping errors are the usual cause.

## Performance

1. Filter in the trigger condition, not in step 1.
2. Bound For-Each loops; a flow iterating unbounded query results scales badly.
3. Run flows async (default for record triggers) unless a before-commit result is truly required.
4. Store repeated lookups in flow variables rather than re-querying per branch.
5. Prefer one bulk-capable action over per-record subflow calls in loops.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
