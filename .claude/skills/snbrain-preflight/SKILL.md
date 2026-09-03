---
name: snbrain-preflight
description: Invoke to run the PREFLIGHT stage of a project-brain build, or when the user asks to "check the connection", "run the probes", "is the transport working", "can we read this instance", "run WP-A", "verify the agent API before mapping". Runs the eleven transport probes, records what this instance's transport can and cannot do, and refuses to let the run continue on an unverified connection.
---

# PREFLIGHT: prove the transport before trusting anything it returns

You are a stage worker in the `snbrain` loop. The CLI owns the state machine, the caps,
the budget and the terminal states. You supply reasoning and nothing else.

```bash
snbrain next --json          # the brief for the current stage. Read it first, always.
```

**The brief is the current state; this skill is the procedure. Where they disagree, the
brief wins.** If the stage is not `preflight`, stop and run the stage the CLI named.

## Why this stage exists at all

Every later stage reads the instance and writes claims about it. A claim derived from a
broken session is not a weak claim, it is a confident false one, and on this platform it
is indistinguishable from a good one: an unauthenticated helper tab returns `200` with
zero rows, and a dropped query clause returns unfiltered rows with no error.

So preflight is not a formality. It is the stage that decides whether any later absence
claim is sound. **Nothing downstream may run on an unverified connection.**

## The artifact is a pointer, not a summary

This is the one stage whose output is deliberately thin. Run the probes, then hand the
CLI the **path to `results.json`**. The CLI reads it and derives the transport facts
itself.

Do not summarize the probe output into the artifact. A model's prose account of a probe
run is exactly the narration this loop exists to eliminate: it is unverifiable, it drops
the numbers, and it is where an optimistic reading creeps in. The probes already produced
a machine-readable result. Point at it.

## Procedure

**1. Locate the sync root.** The scriptsync sync folder is the one holding
`.vscode/sn-agent-port.json`. It is normally the engagement repo itself. The brief names
it; if it does not, ask rather than guess, because pointing `--root` at the wrong folder
produces a stale-port error that reads like a dead extension.

**2. Run the suite.**

```bash
node tools/snbrain/probe.js --instance <name> --root <sync-root>
```

Eleven probes, roughly 25 API calls. Exit `0` means every probe was conclusive, `1` means
a kill criterion fired, `2` means preflight itself could not run.

**3. Read the exit code as a decision, not as information.**

| Exit | Meaning | What you do |
|---|---|---|
| `2` | the connection could not be verified | **Stop.** Report the failure verbatim. Do not retry with different arguments hoping it passes. |
| `1` | a kill criterion fired | Ingest anyway. The CLI decides whether that criterion is fatal for this run, and some are survivable with a stamp. The update-set-membership-discrimination probe (the A3 authorship rung) is **deferred** on a run that can still be seeded: it kills only a blind census, and a seeded run's gate is the anchor's resolution. It is re-raised as blocking at the seed door if the seed turns out unavailable, and is fatal at once under `--blind`. |
| `0` | all conclusive | Ingest. |

**4. Never soften a probe result.** A probe that returns `unavailable` did not pass. A
negative control that failed to reproduce its failure did not pass either: probes 6 and 7
exist to confirm a known silent failure still happens here, so "nothing went wrong" is
itself the finding and must reach the CLI intact.

**5. Ingest the pointer.**

```bash
snbrain ingest --stage preflight --file .brain/in/preflight.json
```

## What the probes settle, and what each one changes downstream

| # | Settles | Consequence if it fails |
|---|---|---|
| 1 | REST GET reachable | the whole R2 read path is gone: no paging, no counts, no display-value control |
| 2 | `sysparm_offset` paging | tables cannot be enumerated, so every count and absence claim is unsound |
| 3 | aggregate counts | every census count costs a full row transfer, and the budget rises by roughly an order of magnitude |
| 4 | `get_table_metadata` shape | schema reads fall back to the dictionary path |
| 5 | relay payload ceiling | sets the harvest page size for every payload-bearing table |
| 6 | **negative control:** silent clause-drop | if it does not reproduce, field validation is defending a documented failure rather than an observed one, and that assumption needs revisiting |
| 7 | **negative control:** query-value corruption | tells you whether values containing reserved characters are safe on either path |
| 8 | the `gates` block | records which write gates are open, including `createArtifacts` which defaults ON |
| 9 | provenance counts plus the authorship distribution | a small authored count means the run measures nothing; a large one dominated by `admin` inside base packages means it measures the wrong thing |
| 10 | session privilege | an admin session means read ACLs never filter, so ACL blindness is **structurally untestable** and must be reported that way rather than as passed |
| 11 | record-level authorship rung | decides whether the scope filter has a clone-resilient path at all |

## What you must never do

- **Never write to the instance.** The probe suite is read-only by construction: a frozen
  nine-command allowlist, `rest_request` reachable only as GET, an endpoint allowlist, and
  an append-before-send request log. If you find yourself wanting a command outside it,
  that is a finding to report, never a change to make.
- **Never continue past a failed canary.** Zero rows from a table that must have rows means
  NOT CONNECTED, not empty.
- **Never report a probe as passed that recorded `unavailable`.**
- **Never edit `results.json`.** It is evidence, and it is the artifact you hand the
  instance owner alongside the request log.

## Handing the log to the instance owner

`snbrain-requests.ndjson` records every call before it was sent, so a crashed or timed-out
request still appears. On someone else's instance that file is the difference between
proving you stayed read-only and asserting it. Offer it unprompted.
