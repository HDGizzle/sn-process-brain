# snbrain tools

## WP-A: the transport preflight probe

Eleven probes that settle what the sn-scriptsync agent API can actually do against a
given instance, before any adapter code is written against assumptions. Specified in
[docs/rework-plan.md](../../docs/rework-plan.md) section 6.12.

```
node tools/snbrain/probe.js --instance <name> --root <sync-folder> [--probe N] [--budget N]
```

`--root` is the **scriptsync sync folder**, the one holding `.vscode/sn-agent-port.json`.
It is a separate folder from this repo on purpose: probe output is instance data and
belongs in the engagement, never in the product. The tool defaults its output to
`<root>/spikes/scriptsync-read/` and `.gitignore` here defends the boundary as well.

Exit codes: `0` all probes conclusive, `1` a kill criterion fired, `2` preflight failed.

## Kill criteria are written before the run

Every probe declares a `killCriterion` as prose AND as a predicate over its own result,
so it fires mechanically. A criterion invented after seeing the data is not a criterion,
it is a rationalization. This follows `playbooks/03-enforce.md:27-46`.

A probe that cannot run records `unavailable` with a reason. It never records a pass it
did not earn, and it never reports absence of rows as a negative result: on this platform
an empty read is more often a broken session than an empty table.

## The two negative controls

Probes 6 and 7 expect a failure and must reproduce it. A negative control that "passes"
because nothing went wrong has failed, and is reported that way. Without them the guard
layer defends against a documented failure rather than an observed one.

Probe 7 earned its design the hard way. The obvious version asked whether an impossible
query value containing `&` returned rows, which cannot discriminate: a URL split and a
correctly carried value both yield zero rows. It now smuggles `sysparm_limit=1` into the
query value while requesting five rows, so one row versus five is a real signal.

## The read-only guarantee, and how it is enforced

This runs against instances we do not own, so being careful is not enough. Four
mechanisms in [lib/api.js](lib/api.js), all structural:

1. **Command allowlist.** Nine commands out of the 43 the extension dispatches, in a
   frozen Set. `call()` rejects anything else before a socket opens, and before the query
   budget is spent. Note two exclusions that look harmless: `sync_now` flushes the
   pending-write queue TO the instance, and `switch_context` changes the session's update
   set and application scope.
2. **REST method is a literal.** `rest_request` is reachable only via `restGet()`, which
   hardcodes `method: 'GET'`. No caller supplies a method, so none can smuggle one.
3. **Endpoint allowlist.** GET is not universally safe on ServiceNow. Only
   `/api/now/{table,stats,attachment}/` is permitted, and action-shaped parameters are
   refused.
4. **Request log written before the send.** Append-only NDJSON at
   `<out>/snbrain-requests.ndjson`, written before each request leaves, so a crashed or
   timed-out call still appears. This is what makes read-only provable after the fact
   rather than merely asserted, and it is the artifact you hand the instance owner.

Verify the first two at any time:

```
node -e "const{READ_ONLY_COMMANDS}=require('./tools/snbrain/lib/api');console.log([...READ_ONLY_COMMANDS])"
grep -n "method:" tools/snbrain/lib/api.js
```

## Unique request ids are correctness, not hygiene

The extension builds its browser correlation id from the caller-supplied request id at
ten call sites, and `pendingRegistry.js:25` overwrites silently on a duplicate. Two
in-flight requests sharing an id cross-wire: one promise is rejected by the other's
timeout, and a reply resolves whichever entry holds the key. the pilot customer's client sends no id at
all, which is safe only because it never runs two calls at once. This client mints a
unique id per call at a single choke point, which is what makes parallel harvest safe.

## What the probes settle

| # | Settles |
|---|---|
| 1 | Whether the REST read path (R2) exists at all through the browser hop |
| 2 | Whether `sysparm_offset` paging works, so tables can be enumerated |
| 3 | Whether aggregate counts work, which sets the cost of every census query |
| 4 | Whether `get_table_metadata` returns inherited columns, and carries a `columns` key at all |
| 5 | The relay payload ceiling, by bounded bisection |
| 6 | **Negative control.** Does an unknown query field still silently return unfiltered rows |
| 7 | **Negative control.** Does a query value containing `&` corrupt the request |
| 8 | The `get_capabilities` gates block, verbatim, including `createArtifacts` which defaults ON |
| 9 | Whether this instance has usable change provenance, and whether its authorship is real or base content wearing a human name |
| 10 | Whether the session is admin, and therefore whether ACL blindness is testable at all |
| 11 | Whether update-set membership (`sys_metadata.sys_update_name` = `sys_update_xml.name`) gives the scope filter a record-level authorship rung. Not clone-resilient, and not `sys_customer_update`, which is that table's label rather than a column |
