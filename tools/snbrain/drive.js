#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/drive.js — the harness-independent loop driver.
 *
 * WHY THIS EXISTS. The snbrain loop was driven by the model: an orchestrator skill TOLD
 * the agent "spawn a fresh stage worker, then ingest". The CLI sees files, not process
 * boundaries, so nothing could refuse an artifact produced inline by a 200k-token main
 * context that had read the brief and done the work itself. Fresh-context-per-stage was a
 * discipline, and a discipline is what a strict token budget cannot rely on.
 *
 * THIS MOVES THE DRIVER OUT OF THE MODEL. The loop is code:
 *
 *   snbrain next            -> the brief (text form = the ENTIRE prompt the worker sees)
 *   spawn ONE agent process on it, wait for it to exit
 *   snbrain status          -> did the stage record an iteration? did the cursor move?
 *   if the worker wrote the artifact and never ingested it, ingest it here
 *   repeat until `done`, a terminal state, a human gate, or the spawn ceiling
 *
 * The worker never sees conversation history, never sees this driver, never sees another
 * stage's context. Fresh context is the only path that exists — structural, not asked for.
 * Every spawn is logged with the brief's size, the elapsed time and the agent's exit code,
 * so a run's cost is measured per stage rather than guessed.
 *
 * HUMAN GATES ARE NOT SPAWNED BY DEFAULT. seed, orientation and interview hold a human,
 * and a non-interactive agent cannot hold one. The driver writes the brief, says what to
 * do, and exits 4; re-run it after the gate is ingested. `--gates spawn` overrides this
 * where the runner is interactive enough to carry a conversation.
 *
 * RUNNERS. The exact command line for each agent CLI lives in a preset table below and is
 * overridable per repo in drive.config.json (`runners.<name>`: an argv array; `{prompt}` is
 * replaced by the one-line worker prompt, `{brief}` by the brief file path, `{root}` by the
 * engagement root). Flags for third-party CLIs drift between releases — if a preset stops
 * working, fix it in the config, not here.
 *
 * Usage:
 *   node tools/snbrain/drive.js run     --runner <copilot|codex|claude|custom> [--root <dir>]
 *                                      [--max-spawns <n>] [--gates pause|spawn] [--config <file>]
 *   node tools/snbrain/drive.js dry-run [--root <dir>]          brief sizes per stage, no spawn
 *   node tools/snbrain/drive.js once    --runner <name> ...     exactly one spawn, then stop
 *
 * Exit: 0 done/success · 1 rejected or work remains (max-spawns hit) · 2 usage · 3 terminal
 *       non-success (human required) · 4 stopped at a human gate
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SNBRAIN = path.join(__dirname, 'snbrain.js');
const EXIT_OK = 0, EXIT_WORK_REMAINS = 1, EXIT_USAGE = 2, EXIT_TERMINAL = 3, EXIT_GATE = 4;

/*
 * RUNNER PRESETS. `{prompt}`, `{brief}`, `{root}` are substituted always; `{model}` is
 * substituted when a model resolves for the stage (config.models / --model) and the arg
 * carrying it — plus its preceding flag — is DROPPED when none does, so every preset works
 * with or without a model choice. Verified against the vendors' programmatic docs on
 * 2026-08-28; flags drift, fix them in drive.config.json.
 *
 *   copilot  -p, --allow-all-tools, --no-ask-user (never pause for a human that is not
 *            there), --model=. No documented usage output; Copilot bills AI credits = tokens at API rates (USD 0.01 per credit), so the
 *            dashboard is the bill and the
 *            driver logs brief size and elapsed time as the local proxy.
 *   codex    exec --full-auto --json, model via --config model=. `turn.completed` carries
 *            cumulative session usage.
 *   claude   -p --output-format json: one result object with usage and total_cost_usd.
 */
const PRESETS = {
  copilot: ['copilot', '-p', '{prompt}', '--allow-all-tools', '--no-ask-user', '--model', '{model}'],
  codex: ['codex', 'exec', '--full-auto', '--skip-git-repo-check', '--json', '--config', 'model={model}', '{prompt}'],
  claude: ['claude', '-p', '{prompt}', '--dangerously-skip-permissions', '--output-format', 'json', '--model', '{model}'],
};

/*
 * THE RUNNER CONTRACT (F1, 2026-09-02). Stage orchestration is separated from runner
 * TRANSPORT. A runner is anything that can take one stage request —
 *
 *   { brief: { text, file, stage, iteration }, root, model, toolPolicy: { readOnly: true,
 *     allowlist: 'tools/snbrain/lib/api.js' }, prompt }
 *
 * — and return one normalised result —
 *
 *   { status: 'ok' | 'failed' | 'unavailable', exit, output, usage, error, seconds }
 *
 * with FRESH CONTEXT per request. The CLI adapter below achieves fresh context by process
 * isolation (one `copilot -p` / `codex exec` / `claude -p` per stage). That coupling is what
 * the second engagement hit: a company-managed laptop with Copilot Chat authenticated in VS
 * Code and no permission to install the standalone CLI could not run a single stage. The
 * contract lets a VS Code-native adapter (Language Model API extension, one fresh chat request
 * per stage, tool policy enforced by the adapter) implement the same request/result without a
 * process boundary — designed in docs/design.md, not built yet; `detectRunners` names it as
 * "not yet available" so the option is visible before any spend.
 */
const RUNNER_KINDS = Object.freeze({ cli: 'one OS process per stage (spawnSync); fresh context by process isolation', vscode: 'VS Code Language Model API adapter — one fresh chat request per stage (designed, not yet available)' });

/** Every runner this driver knows, with availability, before anything is spent. */
function detectRunners(config) {
  const table = Object.assign({}, PRESETS, (config && config.runners) || {});
  const which = (exe) => {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [exe], { encoding: 'utf8', windowsHide: true });
    const found = r.status === 0 ? String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] : null;
    return found || null;
  };
  const out = Object.keys(table).map((name) => {
    const argv = table[name];
    const exe = Array.isArray(argv) && argv.length ? String(argv[0]) : null;
    const resolved = exe ? which(exe) : null;
    return { name, kind: 'cli', executable: exe, available: !!resolved, resolvedPath: resolved };
  });
  out.push({ name: 'vscode', kind: 'vscode', executable: null, available: false, resolvedPath: null, note: RUNNER_KINDS.vscode });
  return out;
}

/** The sentence a missing runner gets, with every option a person actually has. */
function describeUnavailable(name, detected) {
  const others = detected.filter((r) => r.available && r.name !== name).map((r) => r.name);
  return `runner "${name}" is not on PATH${detected.some((r) => r.name === name && r.kind === 'cli') ? ` (executable "${(detected.find((r) => r.name === name) || {}).executable}")` : ''}. ` +
    'Nothing was spent. Options: (1) install that CLI and sign in; (2) use another runner that is on this machine' +
    `${others.length ? `: ${others.join(', ')}` : ' — none detected'}; (3) the VS Code adapter (Copilot Chat already authenticated in the editor, no standalone CLI) — designed in docs/design.md, not yet available.`;
}

/** Run one stage through a runner. Only the CLI kind exists; the shape is the contract. */
function runStage(runner, req, opts) {
  if (runner.kind === 'vscode') {
    return { status: 'unavailable', exit: null, output: '', usage: null, error: RUNNER_KINDS.vscode, seconds: 0 };
  }
  const res = spawnWorker(runner.argv, { prompt: req.prompt, brief: req.brief.file, root: req.root, model: req.model }, { cwd: req.root, outFile: opts && opts.outFile });
  return { status: res.error ? 'unavailable' : (res.code === 0 ? 'ok' : 'failed'), exit: res.code, output: '', usage: res.usage, error: res.error, seconds: res.seconds, stdoutBytes: res.stdoutBytes };
}

/** Substitute placeholders; drop a `{model}` arg (and the flag before it) when no model is set. */
function buildArgs(argv, subst) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.includes('{model}')) {
      if (!subst.model) {
        if (out.length && /^-/.test(out[out.length - 1]) && !out[out.length - 1].includes('=')) { out.pop(); }
        continue;
      }
      out.push(a.replace(/\{model\}/g, subst.model));
      continue;
    }
    out.push(a.replace(/\{prompt\}/g, subst.prompt).replace(/\{brief\}/g, subst.brief).replace(/\{root\}/g, subst.root));
  }
  return out;
}

/** The model for a stage: --model wins, then config.models.stages[stage], then config.models.default. */
function modelFor(stage, config, override) {
  if (override) { return override; }
  const m = (config && config.models) || {};
  return (m.stages && m.stages[stage]) || m.default || null;
}

/**
 * Pull usage out of whatever the runner printed. claude: one JSON object (`usage`,
 * `total_cost_usd`, `num_turns`). codex: JSONL, the last `turn.completed` carries `usage`.
 * copilot: nothing machine-readable — null; credits are read off the usage dashboard.
 */
function parseUsage(text) {
  if (!text) { return null; }
  const norm = (u, extra) => Object.assign({
    input: u.input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || u.cached_input_tokens || 0,
    output: u.output_tokens || 0,
  }, extra || {});
  try {
    const j = JSON.parse(text);
    if (j && j.usage) { return norm(j.usage, { costUsd: j.total_cost_usd === undefined ? null : j.total_cost_usd, turns: j.num_turns === undefined ? null : j.num_turns, source: 'claude-json' }); }
  } catch (notOneObject) { /* fall through to JSONL */ }
  let last = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) { continue; }
    try { const j = JSON.parse(t); if (j && j.usage) { last = j; } else if (j && j.type === 'turn.completed' && j.usage) { last = j; } } catch (e) { /* not json */ }
  }
  return last ? norm(last.usage, { source: 'jsonl' }) : null;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) { out[key] = true; } else { out[key] = nxt; i += 1; }
    } else { out._.push(a); }
  }
  return out;
}

function out(s) { process.stdout.write(s + '\n'); }
function err(s) { process.stderr.write(s + '\n'); }
function fwd(p) { return String(p).replace(/\\/g, '/'); }

function usage() {
  return [
    'drive — run the snbrain loop with ONE fresh agent process per stage iteration.',
    '',
    '  node tools/snbrain/drive.js run     --runner <copilot|codex|claude|custom> [--root <dir>] [--model <id>]',
    '                                     [--max-spawns <n>] [--gates pause|spawn] [--config <file>]',
    '  node tools/snbrain/drive.js once    --runner <name> [same flags]   one spawn, then stop',
    '  node tools/snbrain/drive.js dry-run [--root <dir>]                 brief sizes, no spawn',
    '  node tools/snbrain/drive.js doctor  [--root <dir>]                 which runners are on PATH, before any spend',
    '',
    `runners (presets): ${Object.keys(PRESETS).join(', ')} — override or add in drive.config.json`,
    'exit: 0 done · 1 work remains · 2 usage · 3 terminal non-success · 4 stopped at a human gate',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// the CLI, called as a subprocess so this driver holds no engine state of its own
// ---------------------------------------------------------------------------

function snbrain(args, root) {
  const r = spawnSync(process.execPath, [SNBRAIN].concat(args, ['--root', root]), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status === null ? 99 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function snbrainJson(args, root) {
  const r = snbrain(args.concat(['--json']), root);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return Object.assign(r, { json });
}

function loadConfig(root, file) {
  const candidates = [file, path.join(root, 'drive.config.json'), path.join(__dirname, 'drive.config.json')].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { return JSON.parse(fs.readFileSync(c, 'utf8').replace(/^﻿/, '')); } catch (e) { err(`drive.config.json unreadable at ${c}: ${e.message}`); return {}; }
    }
  }
  return {};
}

function resolveRunner(name, config) {
  const table = Object.assign({}, PRESETS, (config && config.runners) || {});
  const argv = table[name];
  if (!Array.isArray(argv) || !argv.length) { return null; }
  return argv.slice();
}

function appendLog(root, entry) {
  const dir = path.join(root, '.brain');
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.appendFileSync(path.join(dir, 'drive.ndjson'), JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + '\n');
}

/** ~4 bytes per token is the usual English/JSON ratio; a sizing aid, never a bill. */
function estTokens(bytes) { return Math.ceil(bytes / 4); }

// ---------------------------------------------------------------------------
// one iteration: brief -> spawn -> reconcile
// ---------------------------------------------------------------------------

function writeBrief(root, brief, text) {
  const dir = path.join(root, '.brain', 'briefs');
  fs.mkdirSync(dir, { recursive: true });
  const base = `${brief.stage}-${String(brief.iteration).padStart(2, '0')}`;
  const txt = path.join(dir, `${base}.md`);
  const jsn = path.join(dir, `${base}.json`);
  fs.writeFileSync(txt, text);
  fs.writeFileSync(jsn, JSON.stringify(brief, null, 2));
  return { txt, jsn };
}

function workerPrompt(root, briefFile, brief) {
  // ONE LINE, no double quotes, no newlines: it travels through a shell on Windows.
  return `You are a stage worker in the snbrain loop, working directory ${fwd(root)}. ` +
    `Read the file ${fwd(briefFile)} in full and execute it exactly: it is a self-contained brief for stage ${brief.stage}, ` +
    `it names every input to read, the one artifact to write, and the ingest command to run. ` +
    `Do not do anything the brief does not ask for, do not widen scope, and stop once the ingest command has reported its result.`;
}

function quoteForShell(s) {
  if (!/[\s"]/.test(s)) { return s; }
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function spawnWorker(argv, subst, opts) {
  const args = buildArgs(argv, subst);
  const cmd = args[0];
  const rest = args.slice(1);
  const started = Date.now();
  // stdout is CAPTURED (it may be the usage JSON) and mirrored to a per-spawn file; stderr
  // stays on the console so a wedged worker is visible while it runs.
  const spawnOpts = { stdio: ['ignore', 'pipe', 'inherit'], cwd: opts.cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 };
  let r;
  if (process.platform === 'win32') {
    // .cmd shims need a shell; quote every arg ourselves so a prompt with spaces survives.
    r = spawnSync([cmd].concat(rest.map(quoteForShell)).join(' '), Object.assign({ shell: true }, spawnOpts));
  } else {
    r = spawnSync(cmd, rest, spawnOpts);
  }
  const stdout = r.stdout || '';
  if (opts.outFile) { try { fs.writeFileSync(opts.outFile, stdout); } catch (e) { /* the log is a courtesy */ } }
  return {
    code: r.status === null ? 99 : r.status, error: r.error ? r.error.message : null,
    seconds: Math.round((Date.now() - started) / 10) / 100,
    usage: parseUsage(stdout), stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
  };
}

function stageIterations(root, stage) {
  const s = snbrainJson(['status'], root);
  if (!s.json) { return { iterations: null, stage: null, terminal: null }; }
  const st = (s.json.stages || {})[stage] || {};
  return { iterations: st.iterations || 0, stage: s.json.stage, terminal: s.json.terminal };
}

function iterate(root, runnerArgv, opts) {
  const nextJ = snbrainJson(['next'], root);
  if (!nextJ.json) {
    err(`snbrain next returned no JSON (exit ${nextJ.code}):\n${nextJ.stdout}${nextJ.stderr}`);
    return { stop: EXIT_USAGE };
  }
  const b = nextJ.json;
  if (b.terminal) {
    out(`RUN IS TERMINAL: ${b.terminal}${b.note ? ` — ${b.note}` : ''}`);
    return { stop: b.terminal === 'success' ? EXIT_OK : EXIT_TERMINAL };
  }
  if (b.stage === 'done') {
    out(`All stages complete.${(b.blockers || []).length ? ` Blocking terminal success: ${b.blockers.join(' | ')}` : ' Run `snbrain finish --terminal success --by <name>`.'}`);
    out('Then: `snbrain quirks --report` writes FINDINGS.md — what this run learned about the PRODUCT, including whether each wiki page carries what its evidence supports. Send it to whoever maintains the loop.');
    return { stop: (b.blockers || []).length ? EXIT_WORK_REMAINS : EXIT_OK };
  }

  const text = snbrain(['next'], root).stdout;
  const files = writeBrief(root, b, text);
  const bytes = Buffer.byteLength(text, 'utf8');
  out(`\n── ${b.stage} · iteration ${b.iteration} · brief ${bytes} bytes (~${estTokens(bytes)} tokens) · budget ${b.budget.usedCalls}/${b.budget.maxCalls} calls`);

  if (b.humanGate && opts.gates !== 'spawn') {
    out(`HUMAN GATE: "${b.stage}" holds a human, and a headless worker cannot. The brief is at ${fwd(files.txt)}.`);
    out(`Run this stage in an interactive agent session (skill: snbrain-${b.stage}), ingest its artifact, then re-run drive.`);
    /*
     * Run pilot-run-8: the gate presenter skimmed `questions --json` and put three SHADOW
     * questions (operator-graded controls) to the SME; the ingest refused them and burned two
     * of the stage's three iterations. The skill said so twice. The rule goes HERE too, because
     * this line is what the presenter actually reads at the moment it matters.
     */
    const gateRules = {
      interview: 'Put ONLY questions with status "queued" to the human (`snbrain questions --status queued --json`); status "shadow" questions are operator-graded controls and are NEVER asked. Declare every AC id; a condition that is vacuously satisfied is "pass" with the reason — "not-demonstrated" blocks terminal success exactly like "fail".',
      seed: 'Zero API calls. Record the developer\'s pointers and confidence words verbatim; at least one update-set pointer, everything else optional.',
      orientation: 'Zero API calls. Sealed recall first, verbatim; every topic span must be a character-for-character substring of a recorded answer.',
    };
    if (gateRules[b.stage]) { out(`Gate rule: ${gateRules[b.stage]}`); }
    /*
     * The gate is where a human is actually looking at the loop, which makes it the one moment
     * they will report a quirk in. Asked at the end of a run, nobody remembers.
     */
    out('If anything about the loop itself got in the way, record it now — it gates nothing:');
    out('  node tools/snbrain/snbrain.js quirk --note "<what happened>" [--severity blocker|friction|confusing|idea]');
    appendLog(root, { event: 'gate', gate: true, stage: b.stage, iteration: b.iteration, briefBytes: bytes });
    return { stop: EXIT_GATE };
  }

  const before = stageIterations(root, b.stage);
  const prompt = workerPrompt(root, files.txt, b);
  const model = modelFor(b.stage, opts.config, opts.modelOverride);
  const outDir = path.join(root, '.brain', 'workers');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${b.stage}-${String(b.iteration).padStart(2, '0')}.out`);
  if (model) { out(`model ${model}`); }
  const res = runStage({ name: runnerArgv[0], kind: 'cli', argv: runnerArgv },
    { prompt, brief: { text, file: fwd(files.txt), stage: b.stage, iteration: b.iteration }, root: fwd(root), model, toolPolicy: { readOnly: true, allowlist: 'tools/snbrain/lib/api.js' } },
    { outFile });
  const after = stageIterations(root, b.stage);

  let reconciled = null;
  const inbox = path.join(root, '.brain', 'in', `${b.stage}.json`);
  const recorded = after.iterations !== null && before.iterations !== null && after.iterations > before.iterations;
  const moved = after.stage && after.stage !== b.stage;
  if (!recorded && !moved && fs.existsSync(inbox)) {
    // The worker wrote the artifact and never ran ingest (killed, timed out, or stopped
    // early). Ingesting here keeps the loop deterministic: the artifact, not the worker's
    // last words, is what the run records.
    const ing = snbrainJson(['ingest', '--stage', b.stage, '--file', inbox], root);
    reconciled = ing.json ? { accepted: ing.json.accepted, rejected: (ing.json.rejected || []).length, nextStage: ing.json.nextStage, terminal: ing.json.terminal } : { accepted: false, raw: (ing.stdout + ing.stderr).slice(0, 500) };
    out(`worker exited without ingesting; ingested ${fwd(inbox)} here -> ${reconciled.accepted ? 'accepted' : 'REJECTED'}`);
  }

  const entry = {
    event: 'spawn', stage: b.stage, iteration: b.iteration, briefBytes: bytes, promptBytes: Buffer.byteLength(prompt, 'utf8'),
    runner: runnerArgv[0], runnerKind: 'cli', model, exit: res.exit, status: res.status, error: res.error, seconds: res.seconds,
    usage: res.usage, stdoutBytes: res.stdoutBytes,
    recordedIteration: recorded || !!(reconciled && reconciled.accepted), cursorMovedTo: moved ? after.stage : (reconciled && reconciled.nextStage !== b.stage ? reconciled.nextStage : null), reconciled,
  };
  appendLog(root, entry);
  const u = res.usage;
  out(`worker exit ${res.exit} after ${res.seconds}s · iteration recorded: ${entry.recordedIteration}${entry.cursorMovedTo ? ` · cursor -> ${entry.cursorMovedTo}` : ''}` +
    (u ? ` · usage in ${u.input} / cacheW ${u.cacheWrite} / cacheR ${u.cacheRead} / out ${u.output}${u.costUsd != null ? ` / $${Number(u.costUsd).toFixed(2)}` : ''}${u.turns != null ? ` / ${u.turns} turns` : ''}` : ' · usage: not reported by this runner (read credits off its dashboard)'));

  if (res.error) { err(`could not start runner "${runnerArgv[0]}": ${res.error}. Fix the preset in drive.config.json.`); return { stop: EXIT_USAGE }; }
  if (!recorded && !moved && !reconciled) {
    // Nothing happened: no iteration, no artifact. A second identical spawn would cost the
    // same and teach nothing, so the loop stops here rather than burning the ceiling.
    err(`the worker produced no artifact and no iteration for "${b.stage}". Read ${fwd(files.txt)} and the runner's output above; nothing was recorded, so the run can be resumed as-is.`);
    return { stop: EXIT_WORK_REMAINS };
  }
  return { stop: null };
}

// ---------------------------------------------------------------------------
// dry-run: what would each stage's brief cost, without a brain or a spawn
// ---------------------------------------------------------------------------

function cmdDryRun(a) {
  const root = path.resolve(a.root === undefined || a.root === true ? process.cwd() : a.root);
  const stages = require('./lib/stages');
  const { STAGES, HARD_RULES } = stages;
  const fake = {
    brain: { root, claims: () => new Map(), questionsLedger: () => new Map(), decisions: () => new Map(), findings: () => new Map(), openBlockingFindings: () => [] },
    state: {
      instance: 'dry-run', syncRoot: path.join(root, 'sync'), facts: {}, stamps: {},
      queue: { harvestAreas: ['proc-sys-script'], harvestDone: [], harvestAreaDetail: [{ id: 'proc-sys-script', tables: ['sys_script'], population: 'anchor', targets: ['0'.repeat(32)], targetsTotal: 1, t1: 1, t2: 0, why: 'dry-run' }] },
      config: { questionCap: 10, staleAfterDays: 14, scopeFilter: null, blind: false },
      budget: { maxCalls: 800, usedCalls: 0 },
    },
  };
  const hard = HARD_RULES.join('\n');
  const rows = [];
  let total = 0;
  for (const s of STAGES) {
    const ctx = Object.assign({}, fake, { stage: s.id });
    let parts;
    try {
      parts = {
        goal: typeof s.goal === 'function' ? s.goal(ctx) : String(s.goal || ''),
        procedure: (s.procedure ? s.procedure(ctx) : []).filter(Boolean).join('\n'),
        reads: JSON.stringify(s.reads ? s.reads(ctx) : []),
        schema: JSON.stringify(s.schema || {}),
        example: JSON.stringify(s.example ? s.example(ctx) : {}),
        acceptance: JSON.stringify(s.acceptance || []),
      };
    } catch (e) {
      rows.push({ stage: s.id, bytes: null, note: `could not compose outside a run: ${e.message.split('\n')[0]}` });
      continue;
    }
    const bytes = Buffer.byteLength(hard + Object.values(parts).join('\n'), 'utf8');
    total += bytes;
    rows.push({ stage: s.id, bytes, tokens: estTokens(bytes), humanGate: !!s.humanGate, repeats: s.stagnation === 'claims-added' || s.stagnation === 'resolutions' || s.id === 'harvest' || s.id === 'interview' || s.id === 'explain' });
  }
  out('brief cost per stage (the brief is the ENTIRE prompt a worker sees; ~4 bytes/token):');
  out('');
  for (const r of rows) {
    out(r.bytes === null
      ? `  ${r.stage.padEnd(12)} ${r.note}`
      : `  ${r.stage.padEnd(12)} ${String(r.bytes).padStart(7)} bytes  ~${String(r.tokens).padStart(6)} tokens${r.humanGate ? '  [human gate]' : ''}${r.repeats ? '  [iterates: one brief per iteration]' : ''}`);
  }
  out('');
  out(`  one pass over every stage: ${total} bytes ~${estTokens(total)} tokens of BRIEF, before the worker's own reads and reasoning.`);
  out('  Budget the iterating stages by their queue: harvest = one brief per area (anchor makes that one per table),');
  out('  explain = one per candidate batch, interview = one per answered round. A worker typically spends 2-6x its brief.');
  return EXIT_OK;
}

// ---------------------------------------------------------------------------

function cmdRun(a, onceOnly) {
  const root = path.resolve(a.root === undefined || a.root === true ? process.cwd() : a.root);
  if (!fs.existsSync(path.join(root, '.brain', 'state.json'))) {
    err(`no brain at ${fwd(root)}. Run: node tools/snbrain/snbrain.js init --instance <name> --sync-root <dir> --root ${fwd(root)}`);
    return EXIT_USAGE;
  }
  const config = loadConfig(root, a.config && a.config !== true ? path.resolve(a.config) : null);
  const runnerName = a.runner && a.runner !== true ? String(a.runner) : (config.defaultRunner || null);
  if (!runnerName) { err('run requires --runner <copilot|codex|claude|custom> (or defaultRunner in drive.config.json).'); return EXIT_USAGE; }
  const runnerArgv = resolveRunner(runnerName, config);
  if (!runnerArgv) { err(`unknown runner "${runnerName}". Presets: ${Object.keys(PRESETS).join(', ')}; add "${runnerName}" under runners in drive.config.json as an argv array.`); return EXIT_USAGE; }
  /*
   * F1: CAPABILITY DETECTION BEFORE SPEND. The second engagement learned the standalone CLI
   * was required here — after bootstrap, after the transport connected — from a launcher
   * prompt to install it. The driver now refuses with the options before the first brief.
   */
  const detected = detectRunners(config);
  const chosen = detected.find((r) => r.name === runnerName);
  if (!chosen || !chosen.available) { err(describeUnavailable(runnerName, detected)); appendLog(root, { event: 'runner-unavailable', runner: runnerName, detected }); return EXIT_USAGE; }
  const maxSpawns = onceOnly ? 1 : Number(a['max-spawns'] || config.maxSpawns || 60);
  const gates = (a.gates && a.gates !== true) ? String(a.gates) : (config.gates || 'pause');
  const modelOverride = (a.model && a.model !== true) ? String(a.model) : null;
  const models = Object.assign({}, (config.models || {}), modelOverride ? { default: modelOverride, stages: {} } : {});

  out(`drive: root ${fwd(root)} · runner ${runnerName} (${runnerArgv.join(' ')}) · max spawns ${maxSpawns} · gates ${gates}` +
    (models.default || Object.keys(models.stages || {}).length ? ` · models ${JSON.stringify(models)}` : ' · model: runner default'));
  appendLog(root, { event: 'start', runner: runnerName, argv: runnerArgv, maxSpawns, gates, models });
  let spawns = 0;
  for (;;) {
    if (spawns >= maxSpawns) {
      out(`spawn ceiling ${maxSpawns} reached; the run is resumable — re-run drive to continue.`);
      appendLog(root, { event: 'ceiling', spawns });
      return EXIT_WORK_REMAINS;
    }
    const r = iterate(root, runnerArgv, { gates, config, modelOverride });
    if (r.stop !== null) { appendLog(root, { event: 'stop', exit: r.stop, spawns }); return r.stop; }
    spawns += 1;
  }
}

function main(argv) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (!cmd || a.help) { out(usage()); return cmd ? EXIT_OK : EXIT_USAGE; }
  switch (cmd) {
    case 'run': return cmdRun(a, false);
    case 'once': return cmdRun(a, true);
    case 'dry-run': return cmdDryRun(a);
    case 'doctor': {
      const root = path.resolve(a.root === undefined || a.root === true ? process.cwd() : a.root);
      const detected = detectRunners(loadConfig(root, a.config && a.config !== true ? path.resolve(a.config) : null));
      out('runners (the contract: brief + stage metadata + root + model + tool policy -> {status, output, usage, error}):');
      for (const r of detected) { out(`  ${r.available ? 'ok      ' : 'MISSING '} ${r.name.padEnd(10)} ${r.kind === 'cli' ? `${r.executable}${r.resolvedPath ? ` -> ${fwd(r.resolvedPath)}` : ''}` : r.note}`); }
      return detected.some((r) => r.available) ? EXIT_OK : EXIT_USAGE;
    }
    default: err(`unknown command "${cmd}"\n\n${usage()}`); return EXIT_USAGE;
  }
}

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
module.exports = { PRESETS, RUNNER_KINDS, resolveRunner, workerPrompt, estTokens, buildArgs, modelFor, parseUsage, detectRunners, describeUnavailable, runStage, loadConfig };
