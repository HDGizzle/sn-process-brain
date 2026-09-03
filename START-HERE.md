# START HERE — map one ServiceNow process into a development brain

You cloned or extracted this folder. **This folder is the engagement root**: the brain is
built in it, the wiki lands in it, sn-scriptsync connects to it, and at the end
`finalize` turns it into the deliverable in place. One process per clone.

## What you need

1. **Node.js** on this machine (`node -v`).
2. **VS Code + sn-scriptsync** with the agent API on, connected to your dev instance
   **from this folder** — the extension writes `.vscode/sn-agent-port.json` here, and that
   is the run's read-only transport.
3. **Your agent CLI** on PATH and signed in: `copilot` (GitHub Copilot — preconfigured),
   `codex` (OpenAI Codex) or `claude` (Claude Code). `node tools/snbrain/drive.js doctor`
   tells you which are found before anything is spent. A machine with Copilot Chat in VS
   Code but no standalone CLI cannot run the automated stages yet — the VS Code adapter is
   designed (`docs/design.md`), not built.
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
> ServiceNow process into a development brain with the snbrain loop, read-only, in THIS
> folder. Before doing anything, ask me — one question each, in this order — for: (1) the
> instance name as sn-scriptsync knows it, (2) the process in a few words, (3) which agent
> CLI I am using (copilot, codex or claude). Then run
> `node tools/snbrain/bootstrap.js --instance <instance> --process "<words>" --runner <cli>`
> here — it checks the runner is installed, initialises the brain and the wiki in this
> folder, and waits for sn-scriptsync's port file; when it tells me to, I connect the
> extension to the instance in this VS Code window, and you wait for it. Do not ask me to
> open or name another folder. Then: `node tools/snbrain/drive.js dry-run` and tell me the
> estimated cost, then `node tools/snbrain/drive.js run --runner <cli>`. Whenever the
> driver exits with code 4 (a human gate: orientation, seed or interview), run that stage
> HERE with me using `.claude/skills/snbrain-<stage>/SKILL.md` and the gate rule the driver
> printed — ask me the questions, record my answers verbatim, write the artifact, ingest it
> with `node tools/snbrain/snbrain.js ingest --stage <stage> --file .brain/in/<stage>.json`
> — then re-run the driver. Never simulate me, never widen scope, never issue a write to
> the instance. Stop and show me the state on exit code 3. When the loop reaches `done`
> and terminal success, run `node tools/snbrain/snbrain.js finalize --by <my name>` — it
> prunes the mapping machine out of this folder, writes the hashed manifest and restarts
> git history at the deliverable — then tell me what to review.

That is the whole thing. The agent asks three questions and does the rest.

## What happens

`preflight → orientation (you) → seed (you: the process + your update sets) → provenance
→ anchor (your sets expanded through version chains and co-change into a tiered surface)
→ harvest (deep reads of that surface) → explain → verify → questions → interview (you)
→ render → finalize`. Cost per spawn lands in `.brain/drive.ndjson` where the runner
reports it; for Copilot read the usage dashboard.

## What you get

A **full development brain** in this folder: the kernel in three identical mirrors
(`CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`), the enforcement hooks
wired in `.claude/settings.json`, the complete build-skill library under
`.claude/skills/` (audited: every skill routes), the wiki under `docs/wiki/` (process
pages, generated story pages, glossary, decisions, evidence appendix, the read-only
proof), the claim and decision ledgers, and `EXPORT-MANIFEST.json` with a sha256 per file.

More: `docs/first-run.md` (the procedure by hand, and what to watch for),
`docs/design.md` (why it is built this way).
