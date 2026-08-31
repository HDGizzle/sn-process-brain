# START HERE — map one ServiceNow process into an SME repo

You extracted this folder. It is the **product**; the brain is built in a separate
**workspace** the agent creates next to it (one workspace per process).

## What you need

1. **Node.js** on this machine (`node -v`).
2. **VS Code + sn-scriptsync** with the agent API on, able to connect to your dev
   instance. The agent will ask you to open the new workspace and connect the
   extension there — that is what gives the run its read-only transport.
3. **Your agent CLI** on PATH and signed in: `copilot` (GitHub Copilot — preconfigured),
   `codex` (OpenAI Codex) or `claude` (Claude Code).
4. **One process you know**, and at least **one update set name** that shipped it. Bring
   the epic / story ids and any documentation if they exist — optional, never required.

## Cost (GitHub Copilot, usage-based billing)

Copilot bills AI credits = tokens at the listed API rates (1 credit = $0.01). The shipped
`drive.config.json` uses a Sonnet-class model for the read-heavy stages and an Opus-class
model for explain/questions/render. Measured on the pilot: one process ≈ **6,500–7,500
credits** with that split, ≈ 8,500–11,000 all-Opus. Change `models` in
`drive.config.json` or pass `--model <id>` to `drive run`.

## The prompt to type into your agent session, opened in this folder

> Read START-HERE.md and .claude/skills/map-process/SKILL.md. We are going to map ONE
> ServiceNow process into a process brain with the snbrain loop, read-only. Before doing
> anything, ask me — one question each, in this order — for: (1) the instance name as
> sn-scriptsync knows it, (2) the process in a few words, (3) which agent CLI I am using
> (copilot, codex or claude). Then create the workspace yourself with
> `node tools/snbrain/bootstrap.js --instance <instance> --process "<words>" --runner <cli>`
> — it names the folder, copies the product in, initialises the brain and waits for the
> transport; when it tells me to, I will open that folder in VS Code and connect
> sn-scriptsync, and you wait for it. Do not ask me to name anything. Then, in that
> workspace: `node tools/snbrain/drive.js dry-run` and tell me the estimated cost, then
> `node tools/snbrain/drive.js run --runner <cli>`. Whenever the driver exits with code 4
> (a human gate: orientation, seed or interview), run that stage HERE with me using
> `.claude/skills/snbrain-<stage>/SKILL.md` and the gate rule the driver printed — ask me
> the questions, record my answers verbatim, write the artifact, ingest it with
> `node tools/snbrain/snbrain.js ingest --stage <stage> --file .brain/in/<stage>.json` —
> then re-run the driver. Never simulate me, never widen scope, never issue a write to
> the instance. Stop and show me the state on exit code 3. When the loop reaches `done`,
> tell me what to review.

That is the whole thing. The agent asks three questions and does the rest.

## What happens

`preflight → orientation (you) → seed (you: the process + your update sets) → provenance
→ anchor (your sets expanded through version chains and co-change into a tiered surface)
→ harvest (deep reads of that surface) → explain → verify → questions → interview (you)
→ render`. Cost per spawn lands in `<workspace>/.brain/drive.ndjson` where the runner
reports it; for Copilot read the usage dashboard.

More: `docs/first-run.md` (the procedure by hand, and what to watch for),
`docs/design.md` (why it is built this way).
