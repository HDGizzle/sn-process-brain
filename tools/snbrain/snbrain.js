#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/snbrain.js — the engagement-brain CLI.
 *
 * THE PRODUCT SHAPE: you add this to a repo, open Claude Code in that repo, point it at
 * an instance, and Claude Code builds the phased project brain. This CLI is the
 * DETERMINISTIC LAYER Claude Code calls. It is not a thing a human runs by hand, and it
 * is not an orchestrator that drives a model. It is the half of the loop that cannot be
 * talked out of its bounds.
 *
 * THE next/ingest SEAM, which is the whole coordination contract:
 *
 *   snbrain next            prints the brief for the CURRENT stage. Never advances.
 *                           Idempotent, so a killed session resumes on the same brief.
 *   <the agent works>       reads the named inputs, does the reasoning, writes ONE file.
 *   snbrain ingest          validates that file against the stage schema, merges it into
 *                           state and the ledgers, and DECIDES WHAT IS NEXT.
 *
 * The agent never decides what runs next, never allocates an id, never computes a score,
 * and never declares itself finished. It supplies reasoning; everything else is here.
 * That is what makes the loop portable to another harness later: the harness only has to
 * be able to read text and write a file.
 *
 * EXIT CODES, and 2 never means "passed":
 *   0  ok
 *   1  artifact rejected, or the run is not yet closeable (work remains)
 *   2  could not run: bad usage, no brain, unreadable file
 *   3  the run is in a terminal state other than success — a human is required
 */

const fs = require('fs');
const path = require('path');

const {
  Brain, BrainError, validate, countRequestLog, compactLedgerFile,
  parseDomain, describeDomain, domainYield, DOMAIN_LEGS,
  TERMINAL_STATES, UNRESOLVED_STATUSES, OUTCOME_RESULTS, DEFAULTS, claimReadCost,
} = require('./lib/state');
const stages = require('./lib/stages');
const { STAGE_BY_ID, STAGE_ORDER, HARD_RULES, ENVELOPE_SCHEMA, staleClaims, boundaryCastStages } = stages;
/** PRODUCT-97. The render stage's last act is a commit, and this is what a commit means here. */
const deliverable = require('./lib/deliverable');

const EXIT_OK = 0, EXIT_REJECTED = 1, EXIT_USAGE = 2, EXIT_TERMINAL = 3;

/*
 * How the brief spells this tool's own path. The engagement repo and the product repo are
 * separate folders on purpose, so a relative path from the engagement is usually a stack
 * of `..` that nobody can paste. Prefer relative only when it is genuinely short.
 */
const SELF = (() => {
  const rel = path.relative(process.cwd(), __filename).replace(/\\/g, '/');
  return (!rel || rel.startsWith('..')) ? __filename.replace(/\\/g, '/') : rel;
})();

// ---------------------------------------------------------------------------

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

function fwd(p) { return String(p).replace(/\\/g, '/'); }
function asNumber(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function out(s) { process.stdout.write(s + '\n'); }
function err(s) { process.stderr.write(s + '\n'); }
function json(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function usage() {
  return [
    'snbrain — build a ServiceNow engagement brain, phase by phase.',
    '',
    `  node ${SELF} init      --instance <name> [--root <dir>] [--sync-root <dir>]`,
    '                             [--budget <calls>] [--cap <n>] [--question-cap <n>] [--force]',
    '                             [--explain-cap <n>]  how many logic bodies the explain stage may read (default 150)',
    '                             [--vocab-reserve <n>] question-cap slots held for domain vocabulary (default 3)',
    '                             [--scope <a,b>]  confine HARVEST to these sys_scope names (census stays instance-wide)',
    '                             [--domain "scope:a,b; author:x; name:ACME*; updateset:STRY*"]',
    '                             a UNION of legs — a scope is a deployment container, not a domain.',
    '                             Each claim records which leg admitted it, so per-leg yield is measurable.',
    '                             [--blind]        withhold knowledge-bearing inputs; use when mapping an instance this product already documents',
    `  node ${SELF} next      [--root <dir>] [--json]`,
    `  node ${SELF} ingest    --stage <stage> --file <path> [--root <dir>] [--json]`,
    `  node ${SELF} status    [--root <dir>] [--json]`,
    `  node ${SELF} claims    [--status <s>] [--root <dir>] [--json] [--limit <n>]`,
    `  node ${SELF} questions [--status <s>] [--root <dir>] [--json] [--limit <n>]`,
    `  node ${SELF} decisions [--root <dir>] [--json]`,
    `  node ${SELF} findings  [--severity <s>] [--disposition <d>] [--root <dir>] [--json]`,
    `  node ${SELF} disposition --finding <id> --as <fixed|accepted|wontfix|superseded>`,
    '                             --by <name> --reason <text> [--rung L1..L5]',
    `  node ${SELF} refine    --domain "<predicate>" --by <name> --reason <text>`,
    '                             re-aim the domain boundary mid-run; recorded, never retroactive',
    `  node ${SELF} override  --cap <stage>=<n> | --budget <n>  --by <name> --reason <text>`,
    `  node ${SELF} finish    --terminal <state> --by <name> [--note <text>]`,
    `  node ${SELF} close-unsampled --by <person> --reason <text> [--force]`,
    '                             settle the open claims this run\'s sample never reached as',
    '                             unverifiable/not-sampled and take the stage\'s declared forward route.',
    '                             Refused while the budget can still pay for re-querying them, and the',
    '                             refusal shows the arithmetic. --by must be a person, not the loop.',
    `  node ${SELF} export    --to <dir> [--root <dir>] [--dry-run]`,
    '                             refuses unless the run is terminal "success";',
    '                             [--force --by <name> --reason <text>] exports anyway and stamps the kernel',
    `  node ${SELF} isolate   --port-from <repo> --to <clean-sync-root>`,
    '',
    'export ships the DELIVERABLE and withholds the MACHINE: kernel, hooks, wiki, build skills',
    'and the claim/decision ledgers go; tools/snbrain, the snbrain-* stage skills, LOOP.md and the',
    'stage artifacts do not. The list is an ALLOWLIST so a new framework file is absent until',
    'someone decides it ships, rather than leaking into the next customer repo by default.',
    '',
    `stages: ${STAGE_ORDER.join(' -> ')}`,
    `terminal states: ${TERMINAL_STATES.join(' | ')}   (only "success" permits handoff)`,
    '',
    'exit codes: 0 ok · 1 rejected or work remains · 2 could not run · 3 terminal, human required',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function cmdInit(a) {
  if (!a.instance || a.instance === true) {
    err('init requires --instance <name> (the sn-scriptsync instance folder name, e.g. devinst01).');
    return EXIT_USAGE;
  }
  const root = path.resolve(a.root === undefined || a.root === true ? process.cwd() : a.root);
  const brain = Brain.init({
    root,
    instance: a.instance,
    syncRoot: a['sync-root'] && a['sync-root'] !== true ? path.resolve(a['sync-root']) : null,
    stageOrder: STAGE_ORDER,
    maxCalls: asNumber(a.budget, DEFAULTS.maxCalls),
    cap: asNumber(a.cap, DEFAULTS.capPerStage),
    questionCap: asNumber(a['question-cap'], DEFAULTS.questionCap),
    explainCap: asNumber(a['explain-cap'], DEFAULTS.explainCap),
    vocabularyReserve: asNumber(a['vocab-reserve'], DEFAULTS.vocabularyReserve),
    // --scope x_foo,x_bar  confines HARVEST (never the census) to those sys_scope names.
    scopeFilter: (a.scope && a.scope !== true) ? String(a.scope).split(',').map((s) => s.trim()).filter(Boolean) : null,
    domain: (a.domain && a.domain !== true) ? parseDomain(String(a.domain)) : null,
    blind: !!a.blind,
    force: !!a.force,
  });
  out(`brain initialised at ${fwd(brain.dir)}`);
  out(`  instance   ${brain.state.instance}`);
  out(`  sync root  ${brain.state.syncRoot ? fwd(brain.state.syncRoot) : '(not set — pass --sync-root so preflight can find .vscode/sn-agent-port.json)'}`);
  out(`  stage      ${brain.state.stage} (iteration 0)`);
  out(`  budget     ${brain.state.budget.maxCalls} API calls · cap ${brain.state.caps.default} iterations per stage without progress`);
  out(brain.state.config.scopeFilter
    ? `  scope      HARVEST CONFINED TO ${brain.state.config.scopeFilter.join(', ')} — census stays instance-wide, and every page is stamped with this boundary`
    : '  scope      whole instance');
  if (brain.state.config.blind) {
    out('  blind      ON — knowledge-bearing inputs withheld from every brief, and the run is stamped blind');
  }
  out('');
  out(`Next: node ${SELF} next`);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// next — the brief. Self-contained, composed from state, never advances.
// ---------------------------------------------------------------------------

/*
 * BLIND MODE, and it exists for exactly one situation: mapping an instance the PRODUCT
 * already has knowledge about.
 *
 * `docs/rework-plan.md` is the design of record and it argues every rule from worked examples
 * taken from a real engagement: its application scopes, its custom tables, its decision
 * numbers, its glossary answers and literal record sys_ids. Six stage briefs cite ranges of it
 * as required reading. The specifics are deliberately NOT repeated in this comment, because
 * this file ships into every engagement repo and naming them here would reintroduce exactly
 * the leak the flag exists to close. On a customer instance the pointers are harmless and
 * genuinely useful: the pilot customer's examples say nothing about THEIR instance, and the reasoning is
 * why the rules are the rules. Cutting the pointers wholesale would gut the briefs to
 * defend against a leak that does not exist.
 *
 * On the pilot customer itself it is fatal. The agent is handed the answers and then "discovers" them, and
 * the run measures whether a model can copy from its own briefing rather than whether the
 * loop can reconstruct knowledge from a live instance.
 *
 * So: blind mode drops those pointers, says why in the brief, and — the part that matters —
 * is RECORDED IN STATE and stamped onto the render, so nobody can later mistake a
 * knowledge-assisted run for a blind one. An experiment control that is not recorded is not
 * a control.
 */
const KNOWLEDGE_BEARING = /rework-plan\.md/i;

function applyBlind(state, reads) {
  if (!state.config || !state.config.blind) { return reads; }
  const kept = reads.filter((r) => !KNOWLEDGE_BEARING.test(r.path));
  const dropped = reads.length - kept.length;
  if (dropped) {
    kept.push({
      path: '(withheld: blind run)',
      why: `BLIND RUN. ${dropped} knowledge-bearing input(s) were removed from this brief because the design of record argues its rules from worked examples taken from THIS instance, naming its scopes, tables and record sys_ids. You are reconstructing this instance from live evidence only. Do not read docs/rework-plan.md, do not read the target instance's own engagement repo, and if you find yourself recognising a fact rather than measuring it, say so in a finding instead of asserting it.`,
      required: false,
    });
  }
  return kept;
}

function buildBrief(brain) {
  const state = brain.state;
  const stage = STAGE_BY_ID.get(state.stage);
  const st = state.stages[state.stage];
  const ctx = { brain, state, stage: state.stage };
  const inbox = path.join(brain.paths.inbox, `${stage.id}.json`);

  return {
    run: {
      runId: state.runId,
      instance: state.instance,
      repoRoot: fwd(brain.root),
      brainDir: fwd(brain.dir),
      syncRoot: state.syncRoot ? fwd(state.syncRoot) : null,
    },
    stage: stage.id,
    title: stage.title,
    humanGate: !!stage.humanGate,
    iteration: st.total + 1,
    capWithoutProgress: brain.capFor(stage.id),
    iterationsSinceProgress: st.sinceProgress,
    totalIterations: st.total,
    budget: {
      maxCalls: state.budget.maxCalls,
      usedCalls: state.budget.usedCalls,
      remainingCalls: brain.budgetRemaining(),
    },
    goal: typeof stage.goal === 'function' ? stage.goal(ctx) : stage.goal,
    lastAttempt: st.iterations.length
      ? {
        n: st.iterations[st.iterations.length - 1].n,
        at: st.iterations[st.iterations.length - 1].at,
        accepted: st.iterations[st.iterations.length - 1].accepted,
        rejections: st.iterations[st.iterations.length - 1].rejections,
      }
      : null,
    hardRules: HARD_RULES,
    read: applyBlind(state, (stage.reads ? stage.reads(ctx) : [])),
    procedure: (stage.procedure ? stage.procedure(ctx) : []),
    knownFacts: state.facts,
    stamps: state.stamps,
    produce: {
      path: fwd(inbox),
      envelopeSchema: ENVELOPE_SCHEMA,
      payloadSchema: stage.schema,
      example: stage.example ? stage.example(ctx) : null,
    },
    acceptance: stage.acceptance,
    acceptanceVocabulary: OUTCOME_RESULTS,
    acceptanceRule:
      'Declare a result for EVERY acceptance id. "not-demonstrated" is a real value and it blocks ' +
      'terminal success exactly as "fail" does. Recording a non-demonstration as a pass is the single ' +
      'defect this vocabulary exists to prevent — do not do it to keep the loop moving.',
    onDone: `node ${SELF} ingest --stage ${stage.id} --file "${fwd(inbox)}"`,
    onRejection:
      'The CLI prints specific reasons, state does NOT advance, and the iteration counter increments. ' +
      `After ${brain.capFor(stage.id)} iterations with no progress the run terminates as "exhausted" and a human is required. ` +
      'You cannot progress by returning prose.',
    stoppingRules: {
      iterationCapWithoutProgress: brain.capFor(stage.id),
      runawayCeiling: state.caps.runawayCeiling,
      stagnation: stage.stagnation === 'none'
        ? 'not applicable to this stage (no ledger metric); the cap is the bound'
        : `two consecutive iterations with zero ${stage.stagnation === 'resolutions' ? 'claim resolutions' : 'new claims'} terminates the run as "stalled", counted by the CLI from the ledger`,
      budget: `${brain.budgetRemaining()} API calls remain of ${state.budget.maxCalls}`,
    },
  };
}

function renderBrief(b) {
  const L = [];
  const rule = '='.repeat(78);
  L.push(rule);
  L.push(`STAGE: ${b.stage}  —  ${b.title}`);
  L.push(`run ${b.run.runId} · instance ${b.run.instance} · iteration ${b.iteration} (cap ${b.capWithoutProgress} without progress)`);
  L.push(`budget: ${b.budget.remainingCalls} of ${b.budget.maxCalls} API calls remain`);
  if (b.humanGate) { L.push('THIS STAGE HAS A HUMAN IN IT. Do not simulate the human.'); }
  L.push(rule);
  L.push('');
  L.push('GOAL');
  L.push(wrap(b.goal, 2));
  L.push('');
  if (b.lastAttempt && !b.lastAttempt.accepted) {
    L.push(`PREVIOUS ATTEMPT (iteration ${b.lastAttempt.n}) WAS REJECTED. Fix these before re-submitting:`);
    for (const r of b.lastAttempt.rejections) { L.push(wrap('- ' + r, 2)); }
    L.push('');
  }
  L.push('HARD RULES — these apply on every iteration and are restated here because context');
  L.push('compaction silently drops standing constraints, and on this platform that fails silently.');
  for (const r of b.hardRules) { L.push(wrap('- ' + r, 2)); }
  L.push('');
  if (b.read.length) {
    L.push('READ FIRST');
    for (const r of b.read) { L.push(`  ${r.required ? '[required]' : '[optional]'} ${r.path}`); L.push(wrap('  ' + r.why, 6)); }
    L.push('');
  }
  if (b.procedure.length) {
    L.push('PROCEDURE');
    b.procedure.forEach((s, i) => { L.push(wrap(`${i + 1}. ${s}`, 2)); });
    L.push('');
  }
  if (Object.keys(b.stamps || {}).length) {
    L.push('WHAT THIS RUN HAS ALREADY ESTABLISHED (do not re-derive, do not contradict)');
    for (const [k, v] of Object.entries(b.stamps)) { L.push(`  ${k} = ${JSON.stringify(v)}`); }
    L.push('');
  }
  L.push('PRODUCE');
  L.push(`  Write exactly one JSON file to: ${b.produce.path}`);
  L.push('  It must satisfy the envelope (stage, instance, usage, acceptance) plus the stage payload schema.');
  L.push('  Worked example:');
  L.push(indent(JSON.stringify(b.produce.example, null, 2), 4));
  L.push('');
  L.push('  Payload schema:');
  L.push(indent(JSON.stringify(b.produce.payloadSchema, null, 2), 4));
  L.push('');
  L.push('ACCEPTANCE — declare a result for every id: ' + b.acceptanceVocabulary.join(' | '));
  for (const ac of b.acceptance) {
    L.push(`  ${ac.id}: ${ac.statement}`);
    if (ac.howToEvidence) { L.push(wrap(`    evidence: ${ac.howToEvidence}`, 4)); }
  }
  L.push(wrap('  ' + b.acceptanceRule, 2));
  L.push('');
  L.push('WHEN DONE');
  L.push(`  ${b.onDone}`);
  L.push('');
  L.push('IF REJECTED');
  L.push(wrap('  ' + b.onRejection, 2));
  L.push('');
  L.push('STOPPING RULES (enforced by the CLI, not by you)');
  L.push(`  cap without progress : ${b.stoppingRules.iterationCapWithoutProgress}`);
  L.push(`  runaway ceiling      : ${b.stoppingRules.runawayCeiling}`);
  L.push(`  budget               : ${b.stoppingRules.budget}`);
  L.push('  stagnation           :');
  L.push(wrap(b.stoppingRules.stagnation, 25));
  L.push(rule);
  return L.join('\n');
}

function wrap(text, indentBy) {
  const width = 96 - indentBy;
  const pad = ' '.repeat(indentBy);
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = w; } else { line = line ? line + ' ' + w : w; }
  }
  if (line) { lines.push(line); }
  return lines.map((l, i) => (i === 0 ? pad + l : pad + '  ' + l)).join('\n');
}
function indent(text, n) { const pad = ' '.repeat(n); return String(text).split('\n').map((l) => pad + l).join('\n'); }

function cmdNext(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const state = brain.state;

  if (state.terminal) {
    const payload = { terminal: state.terminal, note: state.terminalNote, by: state.terminalBy, at: state.terminalAt, handoffPermitted: state.terminal === 'success' };
    if (a.json) { json(payload); } else {
      out(`RUN IS TERMINAL: ${state.terminal}`);
      out(state.terminalNote || '');
      out(state.terminal === 'success'
        ? 'Handoff permitted. The engagement repo is the deliverable.'
        : 'Only "success" permits handoff. This state requires a human.');
    }
    return state.terminal === 'success' ? EXIT_OK : EXIT_TERMINAL;
  }
  if (state.stage === 'done') {
    const blockers = brain.successBlockers();
    if (a.json) { json({ stage: 'done', blockers }); } else {
      out('All stages complete.');
      if (blockers.length) { out('Blocking terminal success:'); blockers.forEach((b) => out(wrap('- ' + b, 2))); } else { out(`Run: node ${SELF} finish --terminal success --by <name>`); }
    }
    return blockers.length ? EXIT_REJECTED : EXIT_OK;
  }

  /*
   * PRODUCT-36. `next` ROUTES. It used not to, and that is the second forbidden hand edit.
   *
   * Routing existed in exactly one place — inside `cmdIngest` — so it could only ever happen as
   * a side effect of an artifact arriving. A stage with nothing left to ingest therefore could
   * not be closed by the CLI at all, and on run 6ef14f5562 the operator wrote `state.stage`
   * directly, twice (audit[1] 08:54:31Z harvest→explain, audit[2] 09:42:04Z verify→questions).
   * `advance()` does five things of which a cursor write does one, so both edits left the stage
   * they departed permanently `active` and `successBlockers()` reported "stages not complete"
   * forever — a fourth blocker the operator did not choose and could not have known about.
   *
   * NO CLUSTER IN THE TRIAGE RAISED THIS. It survives every other fix in the plan: fix the queue
   * units, fix the convergence predicate, and a stage that cannot produce another artifact STILL
   * cannot be closed. So `next` asks two questions before printing a brief.
   *
   * 1. Does the stage declare a bounded close (`closeOn`) that fires now? Route to the table's
   *    own `closeTo` — never to `next()`, which returns the CURRENT stage precisely while the
   *    queue is non-empty, i.e. exactly when a budget close fires. Taking `next()` "anyway" is an
   *    infinite loop, and it is the version the critics rejected.
   * 2. Otherwise, does `next()` already point somewhere else while this stage has an accepted
   *    iteration and nothing pending? Then the work is done and the CLI moves the cursor itself.
   *
   * A close is IRREVERSIBLE and costs the run terminal `success`, so it is announced in the
   * brief before it fires (see `closeForecast`) and recorded with the population it counted.
   */
  const stage = STAGE_BY_ID.get(state.stage);
  const ctx = { brain, state, stage: state.stage };
  const st = state.stages[state.stage] || {};

  const close = typeof stage.closeOn === 'function' ? stage.closeOn(ctx, {}) : null;
  if (close) {
    const to = stage.closeTo || (typeof stage.next === 'function' ? stage.next(ctx) : null);
    if (to && to !== state.stage) {
      const from = state.stage;   // live reference; advance() below mutates it
      /*
       * METHOD-6 fix (3) — THE CLOSE PATH GETS A DOOR. A close is a CLI action that never calls
       * apply(), so anything a stage's apply() mints when its queue DRAINS was unreachable on
       * every run that closed early — which is the normal case: pilot-run-5 closed elapsed-capped
       * at 19 of 29 areas with `queue.chainRepairRounds` undefined and zero repair areas ever
       * minted, so the repair leg had never once executed. `onClose` lets the table salvage
       * bounded work from a close: the close is still recorded with the population it counted,
       * the warning finding still lands, and terminal success is still lost — but with
       * `stay: true` the cursor holds so the salvage queue is actually read. The engine applies
       * the mutations blindly; what they are is the table's business (invariant 7).
       */
      const salvage = typeof stage.onClose === 'function' ? stage.onClose(ctx, close) : null;
      brain.recordClose(from, Object.assign({ to }, close));
      brain.upsertFindings([{
        check: `stage-closed-${from}`,
        severity: 'warning',
        rung: 'L1',
        message: `${from} was closed by the CLI before it finished its work: ${close.reason}. ` +
          `${close.unreached} of ${close.population} ${close.unit || 'item(s)'} were never read. ` +
          `Population: ${close.populationName || 'unnamed'}. Terminal "success" is now out of reach for this run — ` +
          `no coverage claim on any rendered page may read as complete.`,
      }].concat((salvage && salvage.findings) || []), ctx, { cliAllocated: false });
      if (salvage && salvage.queue) { Object.assign(state.queue, salvage.queue); }
      if (salvage && salvage.stay) {
        brain.save('close', { stage: from, to, reason: close.reason, unreached: close.unreached, stayed: true });
        if (a.json) { json({ closed: from, to, close, stayed: true }); } else {
          out(`STAGE CLOSED: ${from} — the remainder is recorded and routes to ${to} when the salvage queue drains.`);
          out(wrap(close.reason, 2));
          out(wrap(`${close.unreached} of ${close.population} ${close.unit || 'item(s)'} unreached. This is recorded and irreversible.`, 2));
          if (salvage.note) { out(wrap(salvage.note, 2)); }
          out(`Run "node ${SELF} next" for the ${from} brief.`);
        }
        return EXIT_OK;
      }
      brain.advance(to);
      brain.save('close', { stage: from, to, reason: close.reason, unreached: close.unreached });
      if (a.json) { json({ closed: state.stage, to, close }); } else {
        out(`STAGE CLOSED: ${from} -> ${to}`);
        out(wrap(close.reason, 2));
        out(wrap(`${close.unreached} of ${close.population} ${close.unit || 'item(s)'} unreached. This is recorded and irreversible.`, 2));
        out(`Run "node ${SELF} next" for the ${to} brief.`);
      }
      return EXIT_OK;
    }
  }

  /*
   * The stage must have PRODUCED something first. Routing on next() alone would advance past a
   * stage whose queue starts empty before its artifact ever arrives — `st.total > 0` is the
   * "this stage ran" condition, and it is why this is not simply `if (next() !== stage)`.
   */
  const routeTo = typeof stage.next === 'function' ? stage.next(ctx) : null;
  const produced = (st.iterations || []).some((it) => it.accepted);
  if (routeTo && routeTo !== state.stage && produced) {
    // `state` is live: advance() mutates state.stage, so the departing name is captured first.
    const from = state.stage;
    brain.advance(routeTo);   // advance() writes its own history event; a second save duplicates it
    if (a.json) { json({ advanced: { from, to: routeTo, why: 'queue-empty' } }); } else {
      out(`${from} has nothing left to produce; advanced to ${routeTo}.`);
      out(`Run "node ${SELF} next" for the ${routeTo} brief.`);
    }
    return EXIT_OK;
  }

  const brief = buildBrief(brain);
  if (a.json) { json(brief); } else { out(renderBrief(brief)); }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// ingest — validate, merge, decide. The only place the state machine moves.
// ---------------------------------------------------------------------------

function cmdIngest(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const state = brain.state;

  if (state.terminal) {
    err(`run is terminal (${state.terminal}); no further ingest is possible. ${state.terminalNote || ''}`);
    return EXIT_TERMINAL;
  }
  if (!a.stage || a.stage === true || !a.file || a.file === true) {
    err('ingest requires --stage <stage> and --file <path>.');
    return EXIT_USAGE;
  }
  if (a.stage !== state.stage) {
    // Not an agent failure worth an iteration: it is a mis-addressed envelope.
    err(`this brain is at stage "${state.stage}", not "${a.stage}". Run "node ${SELF} next" to get the current brief. State was not touched.`);
    return EXIT_USAGE;
  }

  const stage = STAGE_BY_ID.get(state.stage);
  const ctx = { brain, state, stage: state.stage };
  /*
   * PRODUCT-3 / PRODUCT-90 — the queue-aware ceiling applies to EVERY iteration this command
   * records, rejected ones included. The two rejection paths below used to omit it, so a
   * rejected iteration fell back to the flat `caps.runawayCeiling` of 12 — and `st.total`
   * counts rejections, so a queue-driven stage whose lifetime legitimately exceeds 12 was
   * terminated `exhausted` by its first rejection past that line. Measured on pilot-run-5:
   * harvest, 29 census areas, rejected iteration n=14, terminal `exhausted` at 13:23:52Z, one
   * operator override to clear a bound the stage's own ceiling (areas + 3 = 32) never set.
   * A closure rather than a value, because the accepted path prices the ceiling AFTER the
   * artifact's queue mutations land (a drain appends repair areas the ceiling must count).
   */
  const stageCeiling = () => (typeof stage.ceiling === 'function' ? stage.ceiling(ctx) : null);
  const filePath = path.resolve(a.file);
  const rejections = [];
  let artifact = null;

  if (!fs.existsSync(filePath)) {
    err(`no file at ${fwd(filePath)}. Write the artifact first; the brief names the exact path.`);
    return EXIT_USAGE;
  }
  try {
    artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (parseError) {
    rejections.push(`${fwd(filePath)} is not valid JSON: ${parseError.message}. The artifact is a JSON document, not prose and not a fenced code block.`);
  }

  if (artifact) {
    rejections.push(...validate(ENVELOPE_SCHEMA, artifact, '$'));
    if (artifact.stage && artifact.stage !== state.stage) {
      rejections.push(`$.stage says "${artifact.stage}" but this is the "${state.stage}" stage.`);
    }
    // Same reasoning as the stage check: an artifact addressed to another instance is
    // evidence about another instance, and merging it would silently poison the ledger
    // with facts that were never true here.
    if (artifact.instance && state.instance &&
        String(artifact.instance).toLowerCase() !== String(state.instance).toLowerCase()) {
      rejections.push(`$.instance says "${artifact.instance}" but this brain is for "${state.instance}". Evidence gathered against another instance may not enter this ledger.`);
    }
    rejections.push(...validate(stage.schema, artifact, '$'));

    // Every acceptance condition the stage declares must be answered, three-valued.
    if (Array.isArray(artifact.acceptance)) {
      const declared = new Map(artifact.acceptance.map((x) => [x.id, x]));
      for (const ac of stage.acceptance) {
        if (!declared.has(ac.id)) {
          rejections.push(`$.acceptance: ${ac.id} not declared. Every acceptance condition needs a result of ${OUTCOME_RESULTS.join(' | ')} — including the ones you could not demonstrate.`);
        }
      }
      const unknown = artifact.acceptance.filter((x) => !stage.acceptance.some((ac) => ac.id === x.id));
      if (unknown.length) { rejections.push(`$.acceptance: unknown id(s) ${unknown.map((u) => u.id).join(', ')}. Answer the conditions the stage declares; do not invent your own.`); }
    }
    // Stage-specific cross-field rules and the arithmetic the CLI re-derives.
    if (!rejections.length && stage.validate) {
      try { rejections.push(...(stage.validate(ctx, artifact) || [])); } catch (e) {
        rejections.push(`stage validator threw: ${e.message}`);
      }
    }
  }

  // --- spend, reconciled against the append-before-send request log -------
  const usage = (artifact && artifact.usage) || {};
  let apiCalls = typeof usage.apiCalls === 'number' ? usage.apiCalls : null;
  let reportedCalls = apiCalls;
  let spendSource = apiCalls === null ? 'unknown' : (apiCalls === 0 ? 'not-applicable' : 'self-reported');
  if (usage.requestLog && usage.requestLog !== true) {
    const logPath = path.resolve(brain.root, usage.requestLog);
    const total = countRequestLog(logPath);
    if (total !== null) {
      const attributed = state.budget.logCountedTotal || 0;
      apiCalls = Math.max(0, total - attributed);
      state.budget.logCountedTotal = total;
      spendSource = 'request-log';
      if (reportedCalls !== null && Math.abs(reportedCalls - apiCalls) > Math.max(3, apiCalls * 0.1)) {
        // The log is authoritative: lib/api.js appends before the request leaves, so it
        // captures calls that crashed. A discrepancy is recorded, never silently corrected —
        // and unlike an honest unreconciled self-report, it blocks terminal success, because
        // the two numbers disagreeing means one of them is not measuring what we think.
        spendSource = 'discrepancy';
        brain.upsertFindings([{
          check: `spend-discrepancy-${stage.id}`, severity: 'warning', rung: 'L1',
          message: `Stage "${stage.id}" reported ${reportedCalls} API calls; the request log shows ${apiCalls}. The log is authoritative.`,
        }], ctx);
      }
    }
  }

  // --- rejected: record the iteration, do not advance ---------------------
  if (rejections.length) {
    const verdict = brain.recordIteration(state.stage, {
      accepted: false, progress: false, rejections, resolutions: 0, claimsAdded: 0,
      apiCalls, reportedCalls, spendSource, artifact: fwd(filePath),
      stagnationMode: 'none',   // a rejection is never a ledger event
      runawayCeiling: stageCeiling(),
    });
    const payload = { accepted: false, rejected: rejections, findings: [], nextStage: state.stage, terminal: verdict.terminal };
    if (a.json) { json(payload); } else {
      err(`REJECTED — ${rejections.length} problem(s). State did not advance; this counts as iteration ${state.stages[state.stage].total}.`);
      rejections.forEach((r) => err(wrap('- ' + r, 2)));
      if (verdict.terminal) { err(''); err(`TERMINAL: ${verdict.terminal}`); err(wrap(verdict.reason, 2)); }
      else { err(''); err(`Fix and re-ingest. ${brain.capFor(state.stage) - state.stages[state.stage].sinceProgress} iteration(s) remain before this stage is exhausted.`); }
    }
    return verdict.terminal ? EXIT_TERMINAL : EXIT_REJECTED;
  }

  // --- accepted: merge -----------------------------------------------------
  const result = stage.apply(ctx, artifact) || {};
  const merged = { claims: 0, questions: 0, decisions: 0, findings: 0, raw: 0, resolutions: 0 };
  const findingRejections = [];

  if (result.claims && result.claims.length) {
    const r = brain.upsertClaims(result.claims, ctx);
    merged.claims = r.added + r.updated;
    merged.claimsAdded = r.added;
    merged.resolutions = r.resolutions.length;
    // Supersession: a drifted or gone claim re-opens every decision that rests on it.
    const sup = brain.applySupersession(r.transitions);
    merged.decisionsFlagged = sup.flagged.length;
    merged.reconfirmationQuestions = sup.questions.length;
  }
  if (result.findings && result.findings.length) {
    const r = brain.upsertFindings(result.findings, ctx);
    merged.findings = r.added + r.updated;
    findingRejections.push(...r.rejections);
  }
  if (result.questions && result.questions.length) { merged.questions = brain.upsertQuestions(result.questions).added; }
  if (result.decisions && result.decisions.length) { merged.decisions = brain.upsertDecisions(result.decisions).added; }
  if (result.raw && result.raw.length) { merged.raw = brain.appendRaw(stage.id, result.raw); }

  // A severity rewrite is a rejection even on an otherwise-valid artifact: it is the one
  // move that would let a stage close itself by relabelling its own blockers.
  if (findingRejections.length) {
    const verdict = brain.recordIteration(state.stage, {
      accepted: false, progress: false, rejections: findingRejections, resolutions: 0, claimsAdded: 0,
      apiCalls, reportedCalls, spendSource, artifact: fwd(filePath), stagnationMode: 'none',
      runawayCeiling: stageCeiling(),
    });
    const payload = { accepted: false, rejected: findingRejections, findings: [], nextStage: state.stage, terminal: verdict.terminal };
    if (a.json) { json(payload); } else {
      err('REJECTED — finding ledger refused the write:');
      findingRejections.forEach((r) => err(wrap('- ' + r, 2)));
    }
    return verdict.terminal ? EXIT_TERMINAL : EXIT_REJECTED;
  }

  // facts / stamps / queues
  Object.assign(state.facts, result.facts || {});
  Object.assign(state.stamps, result.stamps || {});
  Object.assign(state.queue, result.queue || {});
  for (const ac of artifact.acceptance) {
    brain.recordOutcome({ stage: stage.id, id: ac.id, result: ac.result, evidence: ac.evidence || null });
  }

  // Progress is what resets the cap. For ledger stages it is recomputed from the ledger,
  // never taken from the stage's own opinion of itself.
  const progress = result.progressFrom === 'resolutions' ? merged.resolutions > 0 : result.progress !== false;

  /*
   * PRODUCT-14 — ROUTE FIRST, THEN APPLY THE PER-STAGE BOUNDS.
   *
   * This used to record the iteration (which fires the stopping rules) and return on a
   * terminal BEFORE asking the stage where to go next. The per-stage bounds — the runaway
   * ceiling and the no-progress cap — therefore fired on the very iteration that FINISHED the
   * stage. A harvest with nineteen areas hit a ceiling of twelve while legitimately converging,
   * and the run was stranded `exhausted` on the iteration it should have advanced. It cost
   * eight attributed overrides to walk a correct run to its end.
   *
   * A bound on iterations WITHIN a stage has no business firing on the iteration that LEAVES
   * it: the thing it exists to catch — going round in circles — is precisely what did not
   * happen. So the route is computed here, and `leavingStage` tells the stopping rules to skip
   * the per-stage bounds. The budget ceiling is unaffected, because that is a real external
   * cost and it applies whatever the cursor is about to do.
   */
  const fromStage = state.stage;
  let nextStage = stage.next(ctx);
  const leavingStage = !(typeof nextStage === 'string' && nextStage === state.stage);

  const verdict = brain.recordIteration(state.stage, {
    accepted: true, progress,
    rejections: [], resolutions: merged.resolutions, claimsAdded: merged.claimsAdded || 0,
    apiCalls, reportedCalls, spendSource, artifact: fwd(filePath),
    stagnationMode: stage.stagnation || 'none',
    leavingStage,
    // PRODUCT-3: a queue-driven stage needs a ceiling that knows how long its queue is.
    // The stage table owns that arithmetic; state.js must not learn what a harvest area is.
    runawayCeiling: stageCeiling(),
  });

  if (verdict.terminal) {
    const payload = { accepted: true, rejected: [], findings: summariseFindings(brain), nextStage: null, terminal: verdict.terminal, counts: merged };
    if (a.json) { json(payload); } else {
      out(`accepted, but the run is now TERMINAL: ${verdict.terminal}`);
      out(wrap(verdict.reason, 2));
      out('Stop. Take the run state to a human — do not widen scope, do not "try another way".');
    }
    return EXIT_TERMINAL;
  }

  // --- apply the route. THE CLI DECIDES, never the agent. -----------------
  // brain.advance() mutates state.stage in place, which is why `fromStage` was captured
  // above: without it the summary below reports every advance as "stay in <the stage it
  // just moved to>".
  let terminal = null;
  if (nextStage && typeof nextStage === 'object' && nextStage.terminal) {
    brain.setTerminal(nextStage.terminal, nextStage.note);
    terminal = nextStage.terminal;
    nextStage = null;
  } else if (nextStage !== state.stage) {
    // Stages the route skipped are recorded as skipped with a reason, not left pending:
    // a pending stage that will never run makes the projection lie.
    const fromIdx = STAGE_ORDER.indexOf(state.stage);
    const toIdx = nextStage === 'done' ? STAGE_ORDER.length : STAGE_ORDER.indexOf(nextStage);
    for (let i = fromIdx + 1; i < toIdx; i += 1) {
      brain.skip(STAGE_ORDER[i], `routed past by ${state.stage}: scopeFilter=${state.stamps.scopeFilter || 'n/a'}`);
    }
    brain.advance(nextStage);
    if (nextStage === 'done') {
      const blockers = brain.successBlockers();
      if (!blockers.length) { brain.setTerminal('success', 'All stages complete, no blocking findings open, every acceptance outcome passing, spend reconciled.'); terminal = 'success'; }
    }
  } else {
    brain.save('stay', { stage: state.stage });
  }

  /*
   * PRODUCT-97 — `render.apply` FINISHES WITH A COMMIT, OR SAYS WHAT IS NOT IN IT.
   *
   * Here rather than in `stage.apply` because the deliverable includes `state.json` and the three
   * ledgers, and those are only final once the route above has run and `brain.save()` has written
   * them. A commit taken any earlier would commit a state file that is about to change, which is
   * the same class of error as the presence check that passed 13 paths holding two-day-stale bytes.
   *
   * The failure is a BLOCKING FINDING, not a rejection. By this point the artifact is accepted and
   * correct; what is missing is an action the CLI takes. A rejection would tell the agent to fix
   * something it did not do and cannot do, and would burn a render iteration doing it. A blocking
   * finding stops terminal success, is dispositionable with attribution, and travels into the
   * deliverable — which is exactly the weight "there is no handoff artifact" deserves.
   */
  /*
   * PRODUCT-25 — SAY IT WHEN IT HAPPENS, NOT AT `done`.
   *
   * On the reference run, preflight/AC-PRE-3 was recorded `fail` on iteration ONE, which made
   * terminal `success` impossible before a single claim existed. The run then completed the
   * census, provenance, nineteen harvest iterations, verify, questions, interview and render —
   * roughly eight hours and 3,397 calls — and said nothing, because successBlockers() was only
   * ever consulted once the cursor reached `done`.
   *
   * Two blocker classes are excluded from this signal because they are the NORMAL state of a
   * healthy run in progress and reporting them would train the operator to ignore the field:
   * stages not yet complete, and claims still in draft. What remains is the set that will not
   * clear itself by carrying on: a blocking finding, a failed acceptance outcome, an
   * unreconcilable spend.
   */
  const persistent = brain.successBlockers().filter((b) => !/^stages not complete/.test(b) && !/still in draft/.test(b));
  const wasReachable = state.successReachable !== false;
  const successReachable = persistent.length === 0;
  if (wasReachable !== successReachable) {
    state.successReachable = successReachable;
    brain.save('success-reachability', { reachable: successReachable, blockers: persistent });
  }

  const payload = {
    accepted: true,
    rejected: [],
    findings: summariseFindings(brain),
    nextStage: terminal ? null : (nextStage === state.stage ? state.stage : nextStage),
    terminal,
    successReachable,
    successBlockers: persistent,
    counts: merged,
  };
  /*
   * PRODUCT-97 — `render` FINISHES WITH A COMMIT, OR SAYS WHAT IS NOT IN IT.
   *
   * LAST, and that position is the whole point. The deliverable includes `state.json` and the three
   * ledgers, and everything above writes to them — `recordIteration`, the route, the reachability
   * save, and `summariseFindings`, which creates a ledger file lazily just by reading it. A commit
   * taken any earlier commits bytes that are about to change, which is the same class of error as
   * the presence check that passed 13 paths holding two-day-stale content.
   *
   * The failure is a BLOCKING FINDING, not a rejection. By here the artifact is accepted and
   * correct, and what is missing is an action the CLI takes: a rejection would burn a render
   * iteration telling the agent to fix something it neither did nor can. A blocking finding stops
   * terminal success, is dispositionable with attribution, and travels into the deliverable — which
   * is the weight "there is no handoff artifact for either run" deserves.
   */
  const commitReport = [];
  if (fromStage === 'render') {
    const paths = deliverable.deliverablePaths(artifact);
    const res = deliverable.commitDeliverable(brain.root, {
      paths, required: deliverable.declaredPaths(artifact),
      message: `chore(snbrain): render — the deliverable for run ${state.runId || state.instance}\n\n` +
        `${paths.length} declared path(s): the wiki pages render.json names, the kernel, the hooks, the build\n` +
        `skills, state.json and the three ledgers. Committed by tools/snbrain on ingest, because a\n` +
        `deliverable that exists only as working-tree state has not been delivered (PRODUCT-97).`,
    });
    const problems = deliverable.describeDeliverableStatus(res.status);
    commitReport.push(res.committed
      ? `deliverable committed as ${res.sha} — ${paths.length} declared path(s)`
      : `deliverable NOT committed: ${res.reason}`);
    if (problems.length) {
      const finding = {
        check: 'deliverable-not-committed', severity: 'blocking', rung: 'L1',
        message:
          `The rendered deliverable is not fully in a commit. Population: ${res.status.population} — ` +
          `${res.status.total} path(s), ${res.status.missing.length} missing, ${res.status.untracked.length} untracked, ` +
          `${res.status.dirty.length} tracked-but-modified. ${problems.join(' ')} ` +
          `The .gitignore this framework installs asserts in prose that the brain "is committed"; while this finding ` +
          `is open that sentence is false, and a git clone of this repo yields the installer's scaffold rather than ` +
          `the brain. Re-check with: node tools/snbrain/render.js --root . --deliverable-check`,
      };
      brain.upsertFindings([finding], ctx);
      commitReport.push(...problems.map((p) => `  ${p}`));
      // The payload was computed before the commit was attempted; a run that did not deliver
      // anything must not report that terminal success is still reachable.
      payload.findings = summariseFindings(brain);
      payload.successReachable = false;
      payload.successBlockers = brain.successBlockers().filter((b) => !/^stages not complete/.test(b) && !/still in draft/.test(b));
      if (state.successReachable !== false) { state.successReachable = false; brain.save('success-reachability', { reachable: false, blockers: payload.successBlockers }); }
      /*
       * AND WITHDRAW `success` IF THE ROUTE ALREADY STAMPED IT.
       *
       * render's next stage is `done`, so the block above this one may have run
       * `successBlockers()` and set `terminal: success` on this very iteration — before the commit
       * it depends on had been attempted. Without this, the exact defect PRODUCT-97 exists to stop
       * is reachable through the fix for it: a run marked `success`, permitted to hand off, whose
       * deliverable is 26 untracked files. The withdrawal is recorded in history.ndjson alongside
       * the stamp, because a state that was set and taken back in one iteration is worth seeing.
       */
      if (terminal === 'success') {
        brain.setTerminal('blocked',
          `All stages complete and every acceptance passing, but the rendered deliverable is not in a commit. ` +
          `${problems.join(' ')} Terminal "success" was set and withdrawn on this same iteration: only "success" ` +
          `permits handoff, and there is nothing here to hand over. Fix the tracking and re-ingest, or finish on ` +
          `a terminal state deliberately.`);
        terminal = 'blocked';
        payload.terminal = 'blocked';
        payload.nextStage = null;
      }
    }
  }

  if (commitReport.length) { payload.deliverable = commitReport; }
  if (a.json) { json(payload); return terminal && terminal !== 'success' ? EXIT_TERMINAL : EXIT_OK; }

  out(`ACCEPTED — stage "${stage.id}" iteration ${state.stages[stage.id].total}`);
  for (const line of commitReport) { out(`  ${line}`); }
  const bits = [];
  if (merged.claims) { bits.push(`${merged.claims} claim(s) merged (${merged.claimsAdded || 0} new, ${merged.resolutions} resolution(s))`); }
  if (merged.questions) { bits.push(`${merged.questions} question(s)`); }
  if (merged.decisions) { bits.push(`${merged.decisions} decision(s)`); }
  if (merged.findings) { bits.push(`${merged.findings} finding(s)`); }
  if (merged.decisionsFlagged) { bits.push(`${merged.decisionsFlagged} decision(s) flagged needs-reconfirmation by drift`); }
  if (bits.length) { bits.forEach((b) => out('  ' + b)); }
  out(`  spend: ${apiCalls === null ? 'unknown' : apiCalls} call(s) [${spendSource}] · ${brain.budgetRemaining()} of ${state.budget.maxCalls} remain`);
  const notPass = artifact.acceptance.filter((x) => x.result !== 'pass');
  if (notPass.length) {
    out(`  acceptance: ${notPass.map((x) => `${x.id}=${x.result}`).join(', ')} — recorded, and blocking terminal success until resolved.`);
  }
  const open = brain.openBlockingFindings();
  if (open.length) { out(`  ${open.length} blocking finding(s) still open.`); }
  if (!successReachable) {
    out('');
    out(`  TERMINAL "success" IS NOW UNREACHABLE${wasReachable ? ' — as of THIS iteration' : ''}.`);
    persistent.forEach((b) => out(wrap('  - ' + b, 4)));
    out('  Carrying on will not clear these. Fix them now or decide deliberately to finish on a');
    out('  different terminal state — the alternative is spending the rest of the run unable to succeed.');
  }
  out('');
  if (terminal) {
    out(`TERMINAL: ${terminal}`);
    out(wrap(brain.state.terminalNote || '', 2));
    if (terminal !== 'success') { out('Only "success" permits handoff. This state requires a human.'); }
  } else if (payload.nextStage === fromStage) {
    out(`Next: stay in "${fromStage}". Run: node ${SELF} next`);
  } else {
    out(`Next stage: ${payload.nextStage}. Run: node ${SELF} next`);
  }
  return terminal && terminal !== 'success' ? EXIT_TERMINAL : EXIT_OK;
}

function summariseFindings(brain) {
  return [...brain.findings().values()]
    .filter((f) => f.disposition === 'open')
    .map((f) => ({ id: f.id, check: f.check, severity: f.severity, disposition: f.disposition, message: f.message }));
}

// ---------------------------------------------------------------------------
// status / ledger readers
// ---------------------------------------------------------------------------

function cmdStatus(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const s = brain.state;
  const byStatus = brain.claimsByStatus();
  const questions = [...brain.questionsLedger().values()];
  const qByStatus = questions.reduce((m, q) => { m[q.status] = (m[q.status] || 0) + 1; return m; }, {});
  const blocking = brain.openBlockingFindings();
  const blockers = brain.successBlockers();

  const payload = {
    runId: s.runId, instance: s.instance, root: fwd(brain.root),
    stage: s.stage, terminal: s.terminal, terminalNote: s.terminalNote,
    stages: Object.fromEntries(Object.entries(s.stages).map(([id, st]) => [id, {
      status: st.status, iterations: st.total, sinceProgress: st.sinceProgress, cap: brain.capFor(id), skipReason: st.skipReason || null,
    }])),
    budget: Object.assign({}, s.budget, { remaining: brain.budgetRemaining() }),
    counts: { claims: brain.claims().size, questions: questions.length, decisions: brain.decisions().size, findings: brain.findings().size },
    claimsByStatus: byStatus,
    staleClaims: staleClaims(brain).length,
    // PLAN 5.17. The unread population, reported as a population rather than folded into
    // claimsByStatus's `unverifiable` bucket, where "we could not read it" and "we did not
    // look" would sum into one number that means neither.
    unsampled: {
      claims: brain.notSampledClaims().length,
      closes: (((s.queue || {}).unsampled || {}).closes || []).map((c) => ({
        sampleId: c.sampleId, stage: c.stage, by: c.by, at: c.at, settled: c.settled,
        aggregatesHeldOpen: c.aggregatesHeldOpen, readClaims: c.readClaims,
        estimatedCalls: c.cost && c.cost.estimatedCalls, budgetRemaining: c.budgetRemaining,
      })),
    },
    questionsByStatus: qByStatus,
    openBlockingFindings: blocking.length,
    outcomes: s.outcomes.reduce((m, o) => { m[o.result] = (m[o.result] || 0) + 1; return m; }, {}),
    stamps: s.stamps,
    domain: s.config && s.config.domain ? {
      predicate: describeDomain(s.config.domain),
      yield: domainYield([...brain.claims().values()]),
    } : null,
    successBlockers: blockers,
    handoffPermitted: s.terminal === 'success',
  };
  if (a.json) { json(payload); return s.terminal && s.terminal !== 'success' ? EXIT_TERMINAL : EXIT_OK; }

  const L = [];
  L.push(`# ${s.instance}  ·  run ${s.runId}`);
  L.push(`repo     : ${fwd(brain.root)}`);
  L.push(`stage    : ${s.stage}`);
  L.push(`terminal : ${s.terminal || '(open)'}${s.terminalNote ? ' — ' + s.terminalNote : ''}`);
  L.push('');
  L.push('stages');
  for (const [id, st] of Object.entries(s.stages)) {
    const mark = st.status === 'complete' ? 'x' : st.status === 'active' ? '>' : st.status === 'skipped' ? '-' : ' ';
    L.push(`  [${mark}] ${id.padEnd(11)} ${String(st.total).padStart(2)} iteration(s), ${st.sinceProgress}/${brain.capFor(id)} without progress${st.skipReason ? '  (skipped: ' + st.skipReason + ')' : ''}`);
  }
  L.push('');
  L.push(`budget   : ${s.budget.usedCalls}/${s.budget.maxCalls} calls used, ${brain.budgetRemaining()} remain` +
    (s.budget.spendUnknownIterations ? `  ·  ${s.budget.spendUnknownIterations} iteration(s) spend-unknown (blocks success)` : ''));
  /*
   * PRODUCT-101 — the clock beside the money, always. Run 5 spent 22% of its budget and 103%
   * of its horizon, and only the money had a line here.
   */
  {
    const active = Object.entries(s.stages).find(([, st]) => st.status === 'active');
    if (active) {
      const q = s.queue || {};
      const remaining = active[0] === 'harvest'
        ? (q.harvestAreas || []).filter((a) => !(q.harvestDone || []).includes(a)).length : 0;
      const pace = stages.stagePacing({ state: s, stage: active[0] }, { stage: active[0], remaining });
      const horizonH = (s.config && s.config.stageWallClockHours) || 4;
      const st = s.stages[active[0]];
      const elapsedMin = st.enteredAt ? Math.max(0, Math.round((Date.now() - Date.parse(st.enteredAt)) / 60000)) : 0;
      L.push(`clock    : ${active[0]} ${elapsedMin} min of ${horizonH}h horizon` +
        (pace ? `  ·  median ${(pace.medianMs / 60000).toFixed(1)} min/iteration  ·  ~${pace.fitIterations} more fit` +
          (remaining ? `, ${remaining} remain${pace.fits ? '' : ` — DOES NOT FIT (short ${pace.shortfall}); snbrain override --hours <h>`}` : '') : ''));
    }
  }
  const stale = staleClaims(brain);
  L.push(`claims   : ${brain.claims().size}` + (Object.keys(byStatus).length ? '  (' + Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : '') +
    (stale.length ? `  ·  ${stale.length} verified claim(s) past their staleness horizon` : ''));
  const unsampled = brain.notSampledClaims();
  if (unsampled.length) {
    const closes = ((s.queue || {}).unsampled || {}).closes || [];
    L.push(`unsampled: ${unsampled.length} claim(s) settled not-sampled — NOBODY READ THEM` +
      (closes.length ? '  (' + closes.map((c) => `${c.sampleId} by ${c.by}, ~${c.cost.estimatedCalls} call(s) not spent`).join('; ') + ')' : ''));
  }
  L.push(`questions: ${questions.length}` + (Object.keys(qByStatus).length ? '  (' + Object.entries(qByStatus).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''));
  L.push(`decisions: ${brain.decisions().size}`);
  /*
   * PLAN 7.2 / PRODUCT-75 fix (3): the ratio, printed where the operator looks. Supersession —
   * the one capability that separates this ledger from a markdown template — iterates the
   * claim-decision index, and an unanchored decision is simply not in it.
   */
  {
    const decs = [...brain.decisions().values()];
    const unanchored = decs.filter((d) => !(d.witnessClaims || []).length && !(d.explainsClaims || []).length);
    if (unanchored.length) {
      const disclosed = unanchored.filter((d) => d.linkage === 'unbound').length;
      L.push(`           ${unanchored.length} of ${decs.length} rest on no claim — supersession cannot reach them` +
        ` (${disclosed} disclosed as linkage: unbound, ${unanchored.length - disclosed} silent)`);
    }
  }
  L.push(`findings : ${brain.findings().size}  (${blocking.length} blocking and open)`);
  if (payload.domain) {
    /*
     * PER-LEG YIELD. The number that was missing from the reference run, where 96,606 claims
     * came back and nothing could say which part of the boundary admitted them. `alone` is the
     * column that decides anything: a leg that never admits what the others missed is pure
     * cost, and one admitting most of the ledger by itself is the boundary doing the work.
     */
    const y = payload.domain.yield;
    L.push('');
    L.push(`domain   : ${payload.domain.predicate}`);
    for (const leg of DOMAIN_LEGS) {
      const v = y.legs[leg];
      if (!v.admitted && !v.soleAdmitter) { continue; }
      L.push(`  ${leg.padEnd(10)} admitted ${String(v.admitted).padStart(6)}  ·  ${String(v.soleAdmitter).padStart(6)} that no other leg would have`);
    }
    if (y.unattributed) {
      L.push(`  ${'(none)'.padEnd(10)} ${y.unattributed} claim(s) name no leg — they cannot be attributed to the boundary this run declared.`);
    }
  }
  if (Object.keys(s.stamps).length) {
    L.push('');
    L.push('stamps   : ' + Object.entries(s.stamps).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  '));
  }
  if (blockers.length) {
    L.push('');
    L.push('blocking terminal success:');
    blockers.forEach((b) => L.push(wrap('  - ' + b, 2)));
  }
  out(L.join('\n'));
  return s.terminal && s.terminal !== 'success' ? EXIT_TERMINAL : EXIT_OK;
}

function readLedger(a, which) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const map = which === 'claims' ? brain.claims()
    : which === 'questions' ? brain.questionsLedger()
      : which === 'decisions' ? brain.decisions() : brain.findings();
  let rows = [...map.values()];
  if (a.status && a.status !== true) { rows = rows.filter((r) => r.status === a.status); }
  if (a.severity && a.severity !== true) { rows = rows.filter((r) => r.severity === a.severity); }
  if (a.disposition && a.disposition !== true) { rows = rows.filter((r) => r.disposition === a.disposition); }
  if (a.open) { rows = rows.filter((r) => UNRESOLVED_STATUSES.has(r.status)); }
  if (which === 'questions') { rows.sort((x, y) => ((y.rank && y.rank.wpm) || 0) - ((x.rank && x.rank.wpm) || 0)); }
  const limit = asNumber(a.limit, 0);
  if (limit > 0) { rows = rows.slice(0, limit); }

  if (a.json) { json(rows); return EXIT_OK; }
  if (!rows.length) { out(`(no ${which}${a.status && a.status !== true ? ' with status ' + a.status : ''})`); return EXIT_OK; }
  for (const r of rows) {
    if (which === 'claims') {
      const l = r.locus || {};
      out(`${r.id}  ${String(r.status).padEnd(12)} ${l.table || '?'}/${(l.sysId || '?').slice(0, 12)}${l.field ? '.' + l.field : ''}  ${r.assertion}` +
        (r.unverifiableReason ? `  [${r.unverifiableReason}]` : ''));
    } else if (which === 'questions') {
      out(`${r.id}  ${String(r.status).padEnd(10)} wpm ${String((r.rank && r.rank.wpm) || 0).padStart(6)}  ${r.signal}/${r.form}  ${String(r.question).slice(0, 90)}`);
    } else if (which === 'decisions') {
      out(`${r.id}  ${String(r.confirmationStatus || 'current').padEnd(20)} [${r.rationaleStrength}] ${r.answeredBy} ${r.answeredAt}  ${String(r.statement).slice(0, 80)}`);
      if ((r.explainsClaims || []).length) { out(`        explains ${r.explainsClaims.length} claim(s), witnesses ${(r.witnessClaims || []).length}`); }
    } else {
      out(`${r.id}  ${String(r.severity).padEnd(8)} ${String(r.disposition).padEnd(10)} ${r.rung}  ${r.check}: ${String(r.message).slice(0, 80)}`);
    }
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// override / finish — attributed, recorded, never silent
// ---------------------------------------------------------------------------

function cmdOverride(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  if (!a.by || a.by === true || !a.reason || a.reason === true) {
    err('override requires --by <name> and --reason <text>. An unattributed override is how a schema drifts.');
    return EXIT_USAGE;
  }
  let res;
  if (a.budget && a.budget !== true) {
    res = brain.override('budget', asNumber(a.budget, null), a.by, a.reason);
  } else if (a.hours && a.hours !== true) {
    // PRODUCT-101: the clock's own override verb. The pacing forecast names this as the
    // sanctioned exit, the same way the budget close names --budget.
    const h = asNumber(a.hours, null);
    if (!Number.isFinite(h) || h <= 0) { err('override --hours takes a positive number of hours, e.g. --hours 6'); return EXIT_USAGE; }
    res = brain.override('hours', h, a.by, a.reason);
  } else if (a.cap && a.cap !== true) {
    const [stageId, n] = String(a.cap).split('=');
    if (!STAGE_BY_ID.has(stageId) || !Number.isFinite(Number(n))) { err('override --cap takes <stage>=<n>, e.g. --cap verify=8'); return EXIT_USAGE; }
    res = brain.override(stageId, Number(n), a.by, a.reason);
  } else {
    err('override needs --budget <n>, --hours <h> or --cap <stage>=<n>.');
    return EXIT_USAGE;
  }
  out(`override recorded: ${res.kind} ${res.from} -> ${res.to}  by ${a.by}`);
  if (!brain.state.terminal) { out(`Run: node ${SELF} next`); }
  return EXIT_OK;
}

function cmdDisposition(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  if (!a.finding || a.finding === true || !a.as || a.as === true) {
    err('disposition requires --finding <id> --as <fixed|accepted|wontfix|superseded> --by <name> --reason <text> ' +
      '[--rung L1|L2|L3|L5]. Use --rung L1 when the CLI itself re-read the evidence and the finding is genuinely ' +
      'fixed — an agent may honestly sign that. L5 is the default and asserts that a named HUMAN accepted a ' +
      'blocking finding nobody can fix, so it refuses a --by that names the loop.');
    return EXIT_USAGE;
  }
  const f = brain.dispositionFinding(a.finding, a.as, a.by === true ? null : a.by, a.reason === true ? null : a.reason, a.rung === true ? null : a.rung);
  out(`${f.id} ${f.check}: severity ${f.severity} (unchanged) · disposition ${f.disposition} by ${f.dispositionBy} at ${f.dispositionRung}`);
  const still = brain.openBlockingFindings();
  out(still.length ? `${still.length} blocking finding(s) still open.` : 'No blocking findings remain open.');
  return EXIT_OK;
}

/* ==================================================== close-unsampled =========
 * PLAN 5.17 / PRODUCT-37 — the sanctioned exit from "the budget did not reach it".
 *
 * Run 6ef14f5562 took this exit in a text editor: `state.audit[2]`, 2026-08-12T09:42:04Z,
 * "state.stage advanced verify -> questions with 8,179 of 8,239 claims still draft". The
 * ledger had no way to say what had happened, so the operator said it to the filesystem. This
 * verb says it in the ledger: the claims settle `unverifiable/not-sampled`, the population is
 * named by the sample they fell outside, the person is named, the price of the alternative is
 * written down, and the route comes from the stage table rather than from here.
 *
 * IT IS DELIBERATELY NOT FREE. `--by` must be a person, because map-instance.md makes the
 * agent the only caller of this CLI and a self-serve close is the same defect with a tidier
 * audit trail. And the CLI refuses while the budget can still pay — which on the reference run
 * it very nearly could: 231 calls needed against 93 remaining, short by ~138, not by 8,086.
 */
function cmdCloseUnsampled(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const state = brain.state;
  if (state.terminal) {
    err(`run is terminal (${state.terminal}); there is nothing left to close. ${state.terminalNote || ''}`);
    return EXIT_TERMINAL;
  }
  const stage = STAGE_BY_ID.get(state.stage);
  if (!stage || !stage.allowsUnsampledClose || typeof stage.forwardRoute !== 'function') {
    err(`stage "${state.stage}" does not declare an unsampled close, so its claims may not be settled unread. ` +
      `Only a stage whose table entry sets allowsUnsampledClose and forwardRoute can take this exit — ` +
      `adding one is a table entry, never a special case here.`);
    return EXIT_USAGE;
  }
  if (!a.by || a.by === true || !a.reason || a.reason === true) {
    err('close-unsampled requires --by <person> and --reason <text>. Declaring part of the ledger unread is an accepted partial and it carries a name.');
    return EXIT_USAGE;
  }
  const open = brain.openClaims();
  if (!open.length) { err('nothing to settle: no claim is draft, unverified or drifted.'); return EXIT_REJECTED; }
  const cost = claimReadCost(open.filter((c) => c.kind !== 'aggregate'));
  const remaining = brain.budgetRemaining();
  if (remaining >= cost.estimatedCalls && a.force !== true) {
    err(`refusing: ${remaining} call(s) remain and re-querying the ${cost.claims} open claim(s) is ` +
      `${cost.loci} distinct locus/loci across ${cost.tables} table(s) — ${cost.batchedReads} batched read(s) at ` +
      `${cost.batchSize} ids each plus ${cost.fieldValidations} field validation(s) = ~${cost.estimatedCalls} call(s). ` +
      `The budget reaches them. Verify them.`);
    err(`This is the check run 6ef14f5562 did not have: it settled for "~8,179 further re-queries against 93 remaining" ` +
      `when the job was 231 calls, and abandoned 8,179 claims to save about 138.`);
    err(`If the estimate is wrong — sys_idIN limits vary by table width on this platform — re-run with --force and say so in --reason.`);
    return EXIT_REJECTED;
  }
  const close = brain.settleUnsampled({ stage: state.stage, by: a.by, reason: a.reason });
  const to = stage.forwardRoute({ brain, state, stage: state.stage });
  // Stages the route skips are recorded as skipped with a reason, exactly as cmdIngest does:
  // a pending stage that will never run makes the projection lie.
  const fromIdx = STAGE_ORDER.indexOf(state.stage);
  const toIdx = to === 'done' ? STAGE_ORDER.length : STAGE_ORDER.indexOf(to);
  for (let i = fromIdx + 1; i < toIdx; i += 1) {
    brain.skip(STAGE_ORDER[i], `routed past by ${state.stage}: scopeFilter=${state.stamps.scopeFilter || 'n/a'}`);
  }
  brain.advance(to);

  const payload = {
    sampleId: close.sampleId, stage: close.stage, by: close.by, settled: close.settled,
    aggregatesHeldOpen: close.aggregatesHeldOpen, readClaims: close.readClaims,
    resolutions: close.resolutions, cost: close.cost, budgetRemaining: close.budgetRemaining,
    nextStage: to, successBlockers: brain.successBlockers(),
  };
  if (a.json) { json(payload); return EXIT_OK; }
  out(`${close.settled} claim(s) settled not-sampled at ${close.stage}  ·  sample ${close.sampleId}  ·  by ${close.by}`);
  out(`  population: every open claim outside the ${close.readClaims} claim(s) that carry a verdict`);
  out(`  ${close.resolutions} resolution(s) counted — an unread claim is settled, never resolved, and never progress`);
  if (close.aggregatesHeldOpen) {
    out(`  ${close.aggregatesHeldOpen} kind=aggregate claim(s) HELD OPEN — a denominator may not settle unread. They are one /stats call each.`);
  }
  out(`  re-reading them was ${close.cost.batchedReads} batched read(s) + ${close.cost.fieldValidations} field validation(s) = ~${close.cost.estimatedCalls} call(s), against ${close.budgetRemaining} remaining`);
  out(`stage -> ${to}`);
  payload.successBlockers.forEach((b) => out(wrap('- ' + b, 2)));
  return EXIT_OK;
}

function cmdFinish(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  if (!a.terminal || a.terminal === true || !TERMINAL_STATES.includes(a.terminal)) {
    err(`finish requires --terminal <${TERMINAL_STATES.join('|')}>`);
    return EXIT_USAGE;
  }
  if (!a.by || a.by === true) { err('finish requires --by <name>. A terminal state is a claim about a run and it carries attribution.'); return EXIT_USAGE; }
  if (a.terminal === 'success') {
    const blockers = brain.successBlockers();
    if (blockers.length) {
      err('refusing to mark success:');
      blockers.forEach((b) => err(wrap('  - ' + b, 2)));
      return EXIT_REJECTED;
    }
  }
  brain.setTerminal(a.terminal, a.note && a.note !== true ? a.note : null, a.by);
  out(`run ${brain.state.runId} terminal: ${a.terminal}`);
  if (a.terminal !== 'success') { out('Only "success" permits handoff.'); }
  return a.terminal === 'success' ? EXIT_OK : EXIT_TERMINAL;
}

// ---------------------------------------------------------------------------

/* ============================================================ export ==========
 * `snbrain export` splits the OPERATING repo from the DELIVERABLE.
 *
 * They have been the same folder, and that is a commercial defect rather than an
 * untidiness: the operating repo necessarily contains `tools/snbrain/` and the nine
 * `snbrain-*` stage skills, because that is what runs the loop. Hand that folder to a
 * customer and you have handed over the discovery product itself — they can then map
 * their own instances, onboard their next one, and sell mapping to someone else.
 *
 * What SHIPS is the payload the engagement was for: the kernel, the enforcement hooks,
 * the wiki, the build-procedure skills, and the claim/decision ledgers so their brain
 * stays verifiable. What NEVER SHIPS is the machine that produced it.
 *
 * THE LIST IS AN ALLOWLIST, AND THAT IS THE WHOLE DESIGN. A denylist fails open: add a
 * file to the framework, forget to deny it, and it silently lands in the next customer's
 * repo. An allowlist fails closed — a new file is absent until someone decides it ships.
 * The DENY patterns below are a second, redundant assertion over the already-selected
 * set, so a mistake in the allowlist is caught rather than shipped.
 */
const EXPORT_ALLOW = [
  { path: 'CLAUDE.md', kind: 'file', why: 'the kernel' },
  { path: '.github/copilot-instructions.md', kind: 'file', why: 'the Copilot kernel mirror' },
  { path: '.claude/settings.json', kind: 'file', why: 'hook wiring — enforcement, not prose' },
  { path: '.claude/hooks', kind: 'dir', why: 'the enforcement hooks themselves' },
  // THE PAYLOAD. This is why the customer can develop agentically the moment they open the
  // repo, and it is the whole point of the deliverable. It necessarily overlaps the deny
  // screen — the nine snbrain-* stage skills live in this same directory — which is exactly
  // why the screen FILTERS rather than aborts, and reports every file it held back.
  { path: '.claude/skills', kind: 'dir', why: 'the build-procedure skills' },
  { path: '.claude/commands', kind: 'dir', why: 'slash commands, minus the ones that drive the loop' },
  { path: 'docs/wiki', kind: 'dir', why: 'the brain: registry, decisions, gotchas, conventions, TBDs, stories' },
  { path: 'product.config.json', kind: 'file', why: 'their slots, their instance' },
  { path: 'tools/render-kernel.js', kind: 'file', why: 'so they can re-render the kernel after editing config' },
  { path: 'kernel', kind: 'dir', why: 'the kernel template render-kernel.js needs' },
  { path: '.brain/claims.jsonl', kind: 'file', why: 'their evidence, and what makes the wiki re-verifiable' },
  { path: '.brain/decisions.jsonl', kind: 'file', why: 'the decision ledger — the actual product of the engagement' },
  { path: '.brain/index', kind: 'dir', why: 'claim-to-decision reverse index' },
  { path: 'probes', kind: 'dir', why: 'the acceptance probe suite, so they can measure their own brain' },
  /*
   * THE REQUEST LOG SHIPS, and it is the one entry where withholding would be worse than
   * shipping. read-only-proof.md exists to prove the run only ever read, and it cites this
   * file as its evidence. Ship the page without the log and the strongest artifact in the
   * deliverable becomes an assertion — precisely the substitution this framework refuses
   * everywhere else. It is append-only, it is about THEIR instance, and LOOP.md §9 calls it
   * the artifact you hand the instance owner. Note this is the log ALONE: the rest of
   * spikes/ (RESULTS.md, results.json) is probe design and stays behind.
   */
  { path: 'spikes/scriptsync-read/snbrain-requests.ndjson', kind: 'file', why: 'the append-only read-only proof, cited by read-only-proof.md' },
];

/*
 * Belt and braces. Anything matching these must NOT appear in the export, whatever the
 * allowlist says. `.brain/in/**` and `state.json` are here for a subtler reason than the
 * code: they carry every stage's artifact schema, the stage order, the caps and the
 * stamps — a readable blueprint of the loop even with no source shipped.
 */
const EXPORT_DENY = [
  /(^|[\\/])snbrain-[a-z]+([\\/]|$)/i,        // the nine stage skills
  /(^|[\\/])tools[\\/]snbrain([\\/]|$)/i,     // the CLI, the probes, the read-only client
  /(^|[\\/])bootstrap-project-brain([\\/]|$)/i,
  /*
   * ANCHORED, and it has to be. The previous form was
   *   /\.brain[\\/](in|raw|findings|locks|state\.json|history\.ndjson)/
   * where the alternation `in` matched the first two characters of `index` with nothing
   * requiring a boundary after it — so `.brain/index/claim-decisions.json` was withheld even
   * though EXPORT_ALLOW ships `.brain/index` by name. An allowlist entry silently cancelled
   * by a deny pattern is the worst shape this pair can take: both lists read as correct.
   * Directories therefore require a following separator, and files are pinned to end-of-path.
   */
  /(^|[\\/])\.brain[\\/](in|raw|locks)[\\/]/i,
  /(^|[\\/])\.brain[\\/](findings\.jsonl|state\.json|history\.ndjson)$/i,
  /(^|[\\/])rework-plan\.md$/i,               // the design of record
  /(^|[\\/])docs[\\/]build-log([\\/]|$)/i,    // the product's own defect register and run log
  /(^|[\\/])\.claude[\\/]snbrain([\\/]|$)/i,  // LOOP.md, the contract
  /(^|[\\/])\.claude[\\/]commands[\\/]map-instance\.md$/i,
];

function walkFiles(root, rel, acc) {
  const abs = path.join(root, rel);
  let st; try { st = fs.statSync(abs); } catch (e) { return acc; }
  if (st.isFile()) { acc.push(rel.replace(/\\/g, '/')); return acc; }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) { walkFiles(root, path.join(rel, name), acc); }
  }
  return acc;
}

/** Group withheld files so the operator reads intent, not 40 paths. */
function mb(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

function summariseWithheld(withheld) {
  const groups = new Map();
  withheld.forEach((f) => {
    const m = f.rel.match(/^\.claude\/skills\/([^/]+)\//) || f.rel.match(/^(tools\/snbrain)\//)
      || f.rel.match(/^\.brain\/([^/]+)/) || f.rel.match(/^(\.claude\/snbrain)\//);
    const key = m ? m[1] : f.rel;
    groups.set(key, (groups.get(key) || 0) + 1);
  });
  return [...groups.entries()].sort().map(([k, n]) => `${k}  (${n} file${n === 1 ? '' : 's'})`);
}

function cmdExport(a) {
  const brain = Brain.open(a.root || process.cwd());
  const state = brain.state;
  const dest = a.to;
  if (!dest) { err('export: --to <dir> is required (the deliverable repo to create).'); return EXIT_USAGE; }

  // Gather the allowlisted set, then re-screen ALL of it against the deny patterns.
  const src = brain.root;
  const selected = [];
  const missing = [];
  for (const entry of EXPORT_ALLOW) {
    const found = walkFiles(src, entry.path, []);
    if (!found.length) { missing.push(entry); continue; }
    found.forEach((f) => selected.push({ rel: f, why: entry.why }));
  }
  /*
   * The deny screen FILTERS, it does not abort. `.claude/skills` legitimately contains both
   * the payload and the machine, so an abort would make the payload unshippable. Everything
   * held back is named in the output: silent withholding and silent leaking are the same
   * class of bug, and the operator has to be able to see which files did not travel.
   */
  const withheld = selected.filter((f) => EXPORT_DENY.some((re) => re.test(f.rel)));
  const ship = selected.filter((f) => !EXPORT_DENY.some((re) => re.test(f.rel)));
  const shipped = new Set(ship.map((f) => f.rel));

  /*
   * The routing map must not dangle. The kernel names skills in backticks in a markdown
   * table, not as paths, so match on the name and then confirm against the source tree:
   * only flag a token that IS a real skill directory here but did not ship. That keeps the
   * check precise — it cannot fire on an ordinary backticked table name.
   */
  const kernelPath = path.join(src, 'CLAUDE.md');
  const dangling = [];
  if (fs.existsSync(kernelPath)) {
    const kernel = fs.readFileSync(kernelPath, 'utf8');
    const seen = new Set();
    let m;
    const re = /`([a-z][a-z0-9-]{3,})`/g;
    while ((m = re.exec(kernel))) {
      const skill = m[1];
      if (seen.has(skill)) { continue; }
      seen.add(skill);
      if (!fs.existsSync(path.join(src, '.claude', 'skills', skill, 'SKILL.md'))) { continue; }
      if ([...shipped].some((f) => f.startsWith(`.claude/skills/${skill}/`))) { continue; }
      const denied = EXPORT_DENY.some((rx) => rx.test(`.claude/skills/${skill}/SKILL.md`));
      dangling.push(skill + (denied ? '  (withheld by policy — remove it from the routing map)' : '  (present here but not selected by the allowlist)'));
    }
  }

  if (a['dry-run']) {
    out(`export DRY RUN  ${src}  ->  ${dest}`);
    out(`  ${ship.length} file(s) would ship · ${withheld.length} withheld by policy`);
    missing.forEach((e) => out(`  absent, skipped : ${e.path}  (${e.why})`));
    summariseWithheld(withheld).forEach((line) => out(`  withheld        : ${line}`));
    dangling.forEach((d) => out(`  DANGLING ROUTE  : ${d}`));
    return dangling.length ? EXIT_REJECTED : EXIT_OK;
  }

  /*
   * THE HANDOFF GATE. LOOP.md says "only `success` permits handoff"; `next` prints it, `ingest`
   * prints it, and the manifest records it. Until now the one verb that actually PERFORMS the
   * handoff read none of that: the reference deliverable's own EXPORT-MANIFEST.json says
   * `"terminal": null, "handoffPermitted": false` above 132 files that shipped regardless. The
   * old code printed a NOTE and returned EXIT_OK — a prompt, where this framework uses controls
   * everywhere else.
   *
   * --force is a real escape hatch because a partial repo is sometimes exactly what the
   * operator wants to show someone. It is attributed, recorded in the manifest, and stamped
   * into the kernel the downstream agent actually reads, so the next person to open the repo
   * learns it from the repo rather than from whether the sender remembered to say so.
   */
  const forced = !!a.force;
  if (state.terminal !== 'success') {
    const blockers = brain.successBlockers();
    if (!forced) {
      err(`export refused: this run's terminal state is "${state.terminal || 'open — it never reached one'}", not "success".`);
      err('Only "success" permits handoff. Exporting anyway ships a brain the machine itself has judged unfit.');
      if (blockers.length) {
        err('');
        err('What stands in the way:');
        blockers.forEach((b) => err(wrap('- ' + b, 2)));
      }
      err('');
      err('Clear those, or export deliberately:');
      err(`  node ${SELF} export --to <dir> --force --by <name> --reason <text>`);
      return EXIT_TERMINAL;
    }
    if (!a.by || a.by === true || !a.reason || a.reason === true) {
      err('export --force requires --by <name> and --reason <text>. An unattributed override of the handoff gate is exactly the silent failure this gate exists to stop.');
      return EXIT_USAGE;
    }
  }

  /*
   * PRODUCT-20 / PRODUCT-23. The ledgers are append-only, which is what makes status history
   * readable and transitions countable without a second store — but it means one line per claim
   * PER STAGE, each carrying its captured response verbatim. The reference run shipped a 494 MB
   * claims.jsonl to a customer.
   *
   * Compaction is lossless for every consumer: `_ledger()` already keys by id and keeps the last
   * row, so the superseded lines are only ever read by a human doing archaeology, and the full
   * ledger stays behind in the working repo.
   */
  const compaction = {};
  const COMPACT = new Set(['.brain/claims.jsonl', '.brain/questions.jsonl', '.brain/decisions.jsonl']);
  for (const f of ship) {
    const to = path.join(dest, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (COMPACT.has(fwd(f.rel))) {
      const stats = compactLedgerFile(path.join(src, f.rel), to);
      if (stats) { compaction[fwd(f.rel)] = stats; continue; }
    }
    fs.copyFileSync(path.join(src, f.rel), to);
  }

  /*
   * Stamp the KERNEL, not just the manifest. The kernel is what a downstream agent reads
   * first; a manifest is what nobody opens. The banner goes at the very top so it survives
   * the agent reading only the first screen of the file.
   */
  if (forced && state.terminal !== 'success') {
    const kernelOut = path.join(dest, 'CLAUDE.md');
    if (fs.existsSync(kernelOut)) {
      const banner = [
        '> [!WARNING]',
        `> **NOT FIT FOR HANDOFF.** This brain was exported by \`--force\` while the run's terminal`,
        `> state was \`${state.terminal || 'open — it never reached one'}\`, not \`success\`.`,
        `> Forced by **${a.by}** on ${new Date().toISOString().slice(0, 10)} — ${a.reason}`,
        '>',
        '> Treat every page here as unratified. The run did not clear its own acceptance gate,',
        '> so a page being present is not evidence that what it says was verified.',
        '',
        '',
      ].join('\n');
      fs.writeFileSync(kernelOut, banner + fs.readFileSync(kernelOut, 'utf8'));
    }
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    instance: state.instance,
    runId: state.runId,
    terminal: state.terminal,
    handoffPermitted: state.terminal === 'success',
    forced: (forced && state.terminal !== 'success')
      ? { by: a.by, reason: a.reason, at: new Date().toISOString(), blockers: brain.successBlockers() }
      : null,
    claims: state.counters.claims,
    decisions: state.counters.decisions,
    files: ship.length,
    compaction,
    withheldCount: withheld.length,
    withheld: 'The snbrain discovery loop (tools/snbrain, the snbrain-* stage skills, LOOP.md, the stage artifacts) is deliberately not part of this export.',
    dangling,
  };
  fs.writeFileSync(path.join(dest, 'EXPORT-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  out(`exported  ${src}  ->  ${dest}`);
  out(`  ${ship.length} file(s) · ${state.counters.claims} claim(s) · ${state.counters.decisions} decision(s)`);
  for (const [rel, c] of Object.entries(compaction)) {
    if (c.linesBefore === c.linesAfter) { continue; }
    out(`  compacted ${rel}: ${c.linesBefore} lines -> ${c.linesAfter} (${mb(c.bytesBefore)} -> ${mb(c.bytesAfter)}), one row per record instead of one per record per stage`);
  }
  missing.forEach((e) => out(`  absent, skipped : ${e.path}`));
  out('');
  out(`  WITHHELD BY POLICY (${withheld.length} file(s)) — the machine, not the payload:`);
  summariseWithheld(withheld).forEach((line) => out(`    ${line}`));
  if (dangling.length) {
    out('');
    out('  ROUTING MAP DANGLES — the kernel points at skills that are not in the export:');
    dangling.forEach((d) => out(`    ${d}`));
    out('  A downstream agent will follow those routes and find nothing.');
  }
  if (state.terminal !== 'success') {
    out('');
    out(`  FORCED EXPORT — terminal is "${state.terminal || 'open'}", not "success". This is NOT a clean handoff.`);
    out(`  Attributed to ${a.by}: ${a.reason}`);
    out('  CLAUDE.md carries a NOT FIT FOR HANDOFF banner, so the next reader learns it from the repo.');
  }
  return dangling.length ? EXIT_REJECTED : EXIT_OK;
}

/* ============================================================ isolate =========
 * `snbrain isolate` builds a sync root that contains NOTHING but the port file.
 *
 * The problem it solves is structural rather than procedural. sn-scriptsync writes its
 * `.vscode/sn-agent-port.json` INTO the engagement repo, so on an instance the product
 * already documents, `--sync-root <that repo>` hands every subagent a legitimate,
 * in-brief reason to be standing inside the knowledge repo — next to its CLAUDE.md, its
 * wiki and its decision ledger. "Please don't read those" is a prompt, and a prompt is not
 * a control.
 *
 * `lib/api.js` reads exactly one file from the sync root and talks to the extension over
 * localhost, so a directory holding only that file is a complete transport. Then there is
 * nothing to resist: the knowledge is not reachable from anywhere the agent was told to go.
 *
 * The copy goes stale whenever the extension restarts — the port file names a pid and a
 * port and both change — so this verifies liveness on every run and is meant to be re-run
 * at the start of each session rather than once.
 */
function cmdIsolate(a) {
  const from = a['port-from'];
  const to = a.to;
  if (!from || from === true || !to || to === true) {
    err('isolate requires --port-from <repo holding .vscode/sn-agent-port.json> and --to <clean sync root>');
    return EXIT_USAGE;
  }
  const srcPort = path.join(path.resolve(from), '.vscode', 'sn-agent-port.json');
  if (!fs.existsSync(srcPort)) {
    err(`isolate: no port file at ${fwd(srcPort)}. Is sn-scriptsync running and syncing into that folder?`);
    return EXIT_USAGE;
  }
  let info;
  try { info = JSON.parse(fs.readFileSync(srcPort, 'utf8')); } catch (e) {
    err(`isolate: port file at ${fwd(srcPort)} is not valid JSON (extension wrote it mid-restart?).`);
    return EXIT_USAGE;
  }
  // A stale port file looks exactly like a healthy one, which is the whole reason to check.
  let alive = false;
  try { process.kill(info.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
  if (info.pid && !alive) {
    err(`isolate: port file names pid ${info.pid}, which is not running — it is STALE. Restart sn-scriptsync, then re-run isolate.`);
    return EXIT_USAGE;
  }
  const destPort = path.join(path.resolve(to), '.vscode', 'sn-agent-port.json');
  fs.mkdirSync(path.dirname(destPort), { recursive: true });
  fs.copyFileSync(srcPort, destPort);

  // Anything else in here is a leak: the point is that there is nothing else to find.
  const strays = [];
  for (const name of fs.readdirSync(path.resolve(to))) { if (name !== '.vscode') { strays.push(name); } }

  out(`isolated sync root  ${fwd(path.resolve(to))}`);
  out(`  port ${info.port} · pid ${info.pid} · apiVersion ${info.apiVersion} · live`);
  out('  contains only .vscode/sn-agent-port.json — no kernel, no wiki, no ledgers, nothing to read');
  if (strays.length) {
    out('');
    out(`  WARNING: ${strays.length} other entr${strays.length === 1 ? 'y' : 'ies'} present, which defeats the isolation:`);
    strays.forEach((s) => out(`    ${s}`));
  }
  out('');
  out('  Re-run this at the start of every session: the port file names a pid and a port,');
  out('  and both change when the extension restarts. A stale copy reads as healthy.');
  return strays.length ? EXIT_REJECTED : EXIT_OK;
}

/*
 * REFINE — re-aim the domain predicate mid-run, attributed.
 *
 * The interview is where the knowledge that should have aimed the run arrives: the expert names
 * the process, expands the acronym, and says which application actually holds their work. On
 * the reference run that knowledge arrived AFTER 96,606 claims had already been harvested
 * against a boundary nobody could correct, and there was no way to act on it short of starting
 * again. A predicate you cannot change once you have learned something is a guess you are stuck
 * with.
 *
 * Attributed and recorded like `override`, and for the same reason: the boundary a run was
 * bounded by is the single most load-bearing fact about what its numbers mean, so a silent
 * change to it would invalidate every ratio reported before and after without saying so. It is
 * deliberately NOT retroactive — claims already harvested keep the `admittedBy` they were
 * harvested under, because rewriting them would erase the evidence that the boundary moved.
 */
function cmdRefine(a) {
  const brain = Brain.open(a.root === true ? undefined : a.root);
  const s = brain.state;
  if (!a.domain || a.domain === true) {
    err('refine requires --domain "<predicate>", e.g. --domain "scope:sn_ohs_im; name:ACME*,accident report*".');
    err(`current: ${describeDomain(s.config.domain) || '(none — this run is instance-wide)'}`);
    return EXIT_USAGE;
  }
  if (!a.by || a.by === true || !a.reason || a.reason === true) {
    err('refine requires --by <name> and --reason <text>. The boundary a run was bounded by is what its numbers MEAN; changing it silently invalidates every ratio on both sides of the change.');
    return EXIT_USAGE;
  }
  const next = parseDomain(String(a.domain));
  const before = describeDomain(s.config.domain);
  const after = describeDomain(next);
  /*
   * PRODUCT-82. A NO-OP PREDICATE IS NOT A NO-OP COMMAND WHEN `--recast` IS GIVEN.
   *
   * Two runs need this door and neither can reach it through a predicate change. A run refined
   * under the pre-PRODUCT-82 CLI already carries the new boundary and the old queue, so every
   * later `refine` short-circuits here and there is no supported route back — the only remaining
   * one is the hand edit to `.brain/` this product forbids. And a run whose boundary is RIGHT but
   * whose measurements are stale for any other reason needs to say exactly that: the boundary
   * stands, the numbers taken under it do not.
   */
  if (before === after) {
    if (!a.recast) {
      out(`refine: the predicate is already ${after}. Nothing recorded.`);
      const stale = boundaryCastStages(s).filter((r) => r.accepted > 0);
      if (stale.length) {
        out('');
        out(`Note: ${stale.map((r) => `"${r.stage}"`).join(', ')} still hold measurements taken under this boundary.`);
        out('If they were taken under a DIFFERENT one — a run refined before the recast existed — re-issue');
        out('this same command with --recast to re-open them. The predicate will not change.');
      }
      return EXIT_OK;
    }
    const recastOnly = boundaryCastStages(s);
    if (!recastOnly.length) {
      out(`refine: the predicate is already ${after} and no stage has measured anything under it. Nothing recorded.`);
      return EXIT_OK;
    }
    const dropped = brain.recast(recastOnly, { by: a.by, reason: a.reason, from: after, to: after });
    brain.upsertFindings([{
      check: 'boundary-recast', severity: 'warning', rung: 'L1',
      message: `The boundary was NOT changed (${after}), but ${dropped.stages.join(', ')} were re-opened because ` +
        `their measurements were taken under a different one: ${a.reason}. ${dropped.discarded} accepted iteration(s) ` +
        `superseded, ${dropped.queue.length} queue key(s) and ${dropped.facts.length} fact key(s) dropped.`,
    }], { stage: s.stage, iteration: 0 }, { cliAllocated: true });
    s.refinements = (s.refinements || []).concat([{
      from: before, to: after, by: a.by, reason: a.reason, at: new Date().toISOString(),
      stage: s.stage, claimsAtRefinement: brain.claims().size, recast: dropped.stages, predicateUnchanged: true,
    }]);
    brain.save('refine', { from: before, to: after, by: a.by, recastOnly: true });
    out(`recast at boundary ${after} (the predicate did not change).`);
    out(`  ${dropped.stages.join(', ')} re-opened, ${dropped.discarded} accepted iteration(s) superseded.`);
    if (dropped.queue.length) { out(`  dropped queue keys: ${dropped.queue.join(', ')}`); }
    if (dropped.facts.length) { out(`  dropped fact keys : ${dropped.facts.slice(0, 8).join(', ')}${dropped.facts.length > 8 ? `, … (${dropped.facts.length})` : ''}`); }
    out(`  ${brain.claims().size} claim(s) kept. Resume at ${dropped.stages[0]} — run \`snbrain next\`.`);
    return EXIT_OK;
  }
  /*
   * PRODUCT-82. A BOUNDARY CHANGE INVALIDATES THE STAGES THAT MEASURED A POPULATION, and until
   * now this command changed the predicate and nothing else. Run `pilot-run-4` initialised
   * instance-wide, census correctly derived 475 areas over `bands.A` = 257,352, the operator
   * refined to a 13,447-row boundary during harvest — and was left running a queue cast in a
   * population 19x its own boundary, at a measured 269 calls per area against 4,795 remaining.
   * `refine` printed three reassuring paragraphs about claim attribution and said nothing about
   * the queue, which is the one thing it had just falsified.
   *
   * The recast is computed BEFORE the predicate is written, so a refusal leaves the run untouched.
   */
  const recast = boundaryCastStages(s);
  const discards = recast.reduce((n, r) => n + r.accepted, 0);
  if (discards > 0 && !a.recast) {
    err(`This run has already measured a population under ${before || 'the instance-wide default'}, and ${discards} accepted iteration(s) across ${recast.map((r) => `"${r.stage}"`).join(', ')} are cast in it.`);
    err('');
    for (const r of recast) {
      err(`  ${r.stage}: ${r.accepted} accepted iteration(s) — ${r.why}`);
      if (r.queue.length) { err(`    drops queue: ${r.queue.join(', ')}`); }
      if (r.facts.length) { err(`    drops facts: ${r.facts.join(', ')}`); }
    }
    err('');
    err(`Refining without re-running them leaves the run holding a work queue measured in a different population — which is not a stale number, it is a number about a different run. Claims already in the ledger are KEPT; only the measurements are dropped, and the run resumes at "${recast[0].stage}".`);
    err('');
    err('Re-issue with --recast to accept that. If the boundary is right and the measurements are');
    err('what you want to keep, the boundary is not what needs changing.');
    return EXIT_USAGE;
  }

  s.config.domain = next;
  s.config.scopeFilter = next.scope.length ? next.scope.slice() : null;
  s.stamps.domainBoundary = after;
  s.stamps.scopeBoundary = s.config.scopeFilter;
  s.refinements = (s.refinements || []).concat([{
    from: before, to: after, by: a.by, reason: a.reason, at: new Date().toISOString(),
    stage: s.stage, claimsAtRefinement: brain.claims().size,
    recast: recast.map((r) => r.stage),
  }]);
  brain.save('refine', { from: before, to: after, by: a.by });

  out(`domain refined at stage "${s.stage}", ${brain.claims().size} claim(s) already harvested`);
  out(`  from : ${before || '(none — instance-wide)'}`);
  out(`  to   : ${after}`);
  out(`  by   : ${a.by} — ${a.reason}`);
  out('');
  if (recast.length) {
    const dropped = brain.recast(recast, { by: a.by, reason: a.reason, from: before, to: after });
    brain.upsertFindings([{
      check: 'boundary-recast',
      severity: 'warning',
      rung: 'L1',
      message: `The boundary moved from ${before || '(instance-wide)'} to ${after} at stage "${s.stage}". ` +
        `${dropped.stages.join(', ')} were measured in the old population and have been re-opened ` +
        `(${dropped.discarded} accepted iteration(s) superseded, ${dropped.queue.length} queue key(s) and ` +
        `${dropped.facts.length} fact key(s) dropped). Every ratio quoted before this point is against the old ` +
        `boundary; the superseded iterations are retained under stages.<id>.superseded.`,
    }], { stage: s.stage, iteration: 0 }, { cliAllocated: true });
    out(`recast: ${dropped.stages.join(', ')} re-opened (${dropped.discarded} accepted iteration(s) superseded).`);
    if (dropped.queue.length) { out(`  dropped queue keys: ${dropped.queue.join(', ')}`); }
    if (dropped.facts.length) { out(`  dropped fact keys : ${dropped.facts.slice(0, 8).join(', ')}${dropped.facts.length > 8 ? `, … (${dropped.facts.length})` : ''}`); }
    out(`  resume at         : ${dropped.stages[0]} — run \`snbrain next\`.`);
    out('');
  }
  out('Claims already in the ledger keep the admittedBy they were harvested under. That is');
  out('deliberate: rewriting them would erase the evidence that the boundary moved, and the');
  out('per-leg yield in `status` is only readable if each claim records the boundary of its own day.');
  return EXIT_OK;
}

const COMMANDS = {
  init: cmdInit,
  refine: cmdRefine,
  export: cmdExport,
  isolate: cmdIsolate,
  next: cmdNext,
  ingest: cmdIngest,
  status: cmdStatus,
  claims: (a) => readLedger(a, 'claims'),
  questions: (a) => readLedger(a, 'questions'),
  decisions: (a) => readLedger(a, 'decisions'),
  findings: (a) => readLedger(a, 'findings'),
  disposition: cmdDisposition,
  override: cmdOverride,
  'close-unsampled': cmdCloseUnsampled,
  finish: cmdFinish,
};

function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd || a.help || !COMMANDS[cmd]) {
    out(usage());
    return cmd && !COMMANDS[cmd] ? EXIT_USAGE : EXIT_OK;
  }
  /*
   * PRODUCT-18. Every verb here takes flags and no positional arguments, so a stray positional
   * means the caller believes in a subcommand that does not exist. `snbrain questions answer
   * <id> --by ...` — which two stage skills documented — parsed as a bare `questions` LISTING,
   * printed a list, and exited 0. The agent came away believing it had recorded an answer.
   *
   * A wrong command that succeeds is far worse than one that fails, and on this platform that
   * is the whole design philosophy: the failures that cost are the silent ones.
   */
  if (a._.length > 1) {
    err(`snbrain ${cmd}: unexpected argument "${a._[1]}". This CLI has no subcommands — every verb takes flags only.`);
    err(`Nothing was recorded. If you meant to record an interview answer, write the interview artifact and run:`);
    err(`  node ${SELF} ingest --stage interview --file <path>`);
    return EXIT_USAGE;
  }
  try {
    return COMMANDS[cmd](a);
  } catch (e) {
    if (e instanceof BrainError) { err(`snbrain: ${e.message}`); return e.code; }
    err(`snbrain: unhandled: ${e && e.stack ? e.stack : e}`);
    return EXIT_USAGE;
  }
}

if (require.main === module) { process.exit(main()); }
module.exports = { main, parseArgs, buildBrief, renderBrief, COMMANDS };
