#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/selftest.js — the offline harness.
 *
 * WHY THIS EXISTS. Until it did, the only evidence that a change to the stage table worked
 * was that the file still parsed. That is not evidence, and the cost of finding out
 * otherwise was a real iteration against a live instance eight hours into a run.
 *
 * It runs with NO instance, NO network and NO sn-scriptsync. Everything happens in a
 * scratch directory under the OS temp dir, which is removed on exit.
 *
 * THE LOAD-BEARING INVARIANT is test B: every stage's own worked `example()` must pass
 * that same stage's envelope schema, payload schema AND validate() hook. The example is
 * what a fresh subagent copies. An example that its own validator rejects costs an
 * iteration to discover and teaches the agent the wrong shape — and `stages.js` already
 * carries a comment saying exactly that happened once for `render`.
 *
 * Usage:  node tools/snbrain/selftest.js [--verbose] [--only <pattern>]
 * Exit:   0 all passed · 1 one or more failed
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const stages = require('./lib/stages');
const stateLib = require('./lib/state');
const renderLib = require('./render.js');

const { STAGES, STAGE_BY_ID, STAGE_ORDER, ENVELOPE_SCHEMA } = stages;
const { validate, Brain, TERMINAL_STATES, OUTCOME_RESULTS, SEVERITIES, RUNGS } = stateLib;

const SELF = path.join(__dirname, 'snbrain.js');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

// ---------------------------------------------------------------------------
// a very small test runner. No dependencies: this repo has no package.json and
// adding one to run assertions would be a heavier change than the thing tested.
// ---------------------------------------------------------------------------

const results = [];
let currentGroup = '(none)';

function group(name) { currentGroup = name; }

function test(name, fn) {
  const full = `${currentGroup} › ${name}`;
  if (ONLY && !full.toLowerCase().includes(ONLY.toLowerCase())) { return; }
  try {
    fn();
    results.push({ full, ok: true });
    if (VERBOSE) { process.stdout.write(`  ok   ${full}\n`); }
  } catch (err) {
    results.push({ full, ok: false, err });
    process.stdout.write(`  FAIL ${full}\n       ${String(err && err.message || err).split('\n').join('\n       ')}\n`);
  }
}

function assert(cond, message) {
  if (!cond) { throw new Error(message || 'assertion failed'); }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'not equal'}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, message) {
  const s = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
  if (!s.toLowerCase().includes(String(needle).toLowerCase())) {
    throw new Error(`${message || 'missing substring'}\n  looked for: ${needle}\n  in:         ${s.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// scratch workspace
// ---------------------------------------------------------------------------

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'snbrain-selftest-'));
process.on('exit', () => {
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (ignored) { /* best effort */ }
});

/**
 * A fixture engagement repo.
 *
 * PRODUCT-97: it is a GIT repo by default, because a real one always is — the installer runs
 * `git init` — and `render.validate` now refuses to render into a directory nothing can hand over.
 * Pass `{ git: false }` for the fixture that tests exactly that refusal.
 */
function scratchRepo(name, opts) {
  const root = path.join(SCRATCH, name);
  fs.mkdirSync(path.join(root, 'docs', 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, 'product.config.json'), JSON.stringify({ paths: { wikiRoot: 'docs/wiki' } }, null, 2));
  if (!opts || opts.git !== false) { gitInit(root); }
  return root;
}

/** `git init` plus an identity, so a fixture can commit without inheriting the operator's. */
function gitInit(root) {
  const run = (args) => require('child_process').spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', windowsHide: true });
  run(['init', '-q']);
  run(['config', 'user.name', 'snbrain selftest']);
  run(['config', 'user.email', 'selftest@example.invalid']);
  run(['config', 'commit.gpgsign', 'false']);
  return root;
}

/** Commit everything currently in a fixture, so later assertions can talk about tracked vs dirty. */
function gitCommitAll(root, message) {
  const run = (args) => require('child_process').spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', windowsHide: true });
  run(['add', '-A']);
  return run(['commit', '-q', '-m', message || 'fixture']);
}

/** Run the real CLI. Returns {code, stdout, stderr} and never throws on a non-zero exit. */
function cli(args, opts) {
  try {
    const stdout = execFileSync(process.execPath, [SELF].concat(args), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: (opts && opts.cwd) || SCRATCH,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status === undefined ? -1 : err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function cliJson(args, opts) {
  const r = cli(args.concat(['--json']), opts);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (err) { /* leave null; caller asserts */ }
  return Object.assign({}, r, { json: parsed });
}

/**
 * A ctx good enough to call goal()/reads()/procedure()/example() outside a real run.
 * Deliberately minimal: if a stage needs more than this to compose a brief, that is worth
 * knowing, because `next` composes a brief from exactly this much state.
 */
function fakeCtx(overrides) {
  const root = (overrides && overrides.root) || scratchRepo('ctx-' + Math.abs(hashish(JSON.stringify(overrides || {}))));
  const base = {
    brain: {
      root,
      claims: () => new Map(),
      questionsLedger: () => new Map(),
      decisions: () => new Map(),
      findings: () => new Map(),
      openBlockingFindings: () => [],
    },
    state: {
      instance: 'selftest-instance',
      syncRoot: path.join(root, 'sync'),
      facts: {},
      stamps: {},
      queue: { harvestAreas: ['business-rules', 'client-scripts'], harvestDone: [], harvestAreaDetail: [{ id: 'business-rules', tables: ['sys_script'], bandARows: 412 }] },
      config: { questionCap: 10, staleAfterDays: 14, scopeFilter: null, blind: false },
    },
    stage: 'preflight',
  };
  return deepMerge(base, overrides || {});
}

function deepMerge(a, b) {
  const out = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else { out[k] = v; }
  }
  return out;
}

function hashish(s) { let h = 0; for (let i = 0; i < s.length; i += 1) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return h; }

/** A results.json shaped exactly as probe.js writes one, so preflight's validator accepts it. */
function writeProbeResults(file, opts) {
  const o = opts || {};
  const results_ = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id) => ({
    id,
    status: (o.unavailable || []).includes(id) ? 'unavailable' : 'conclusive',
    killFired: (o.kills || []).includes(id),
    killCriterion: (o.kills || []).includes(id) ? `probe ${id} kill` : null,
    note: `probe ${id}`,
    // D5(a): the membership-discrimination probe is identified by WHAT IT MEASURES (its data
    // carries the A3 verdict), so a fixture that fires it has to carry that key.
    data: id === 6 ? { reproduced: true, rows: 5 } : ((o.a3Dead || []).includes(id) ? { a3Dead: true } : {}),
  }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    meta: {
      instance: o.instance || 'selftest-instance',
      date: '2026-08-11T00:00:00Z',
      callsUsed: 120, extensionVersion: '4.7.6', apiVersion: '6',
    },
    results: results_,
  }, null, 2));
  return file;
}

// ===========================================================================
// J — orientation, the document rung, and the two guards that make them landable.
//
// Every fixture below is built from what run 6ef14f5562 actually shipped, so each test
// fails if that run's behaviour becomes possible again — not merely if the fix is absent.
// ===========================================================================

group('J. orientation and the document rung');

/* The nine stages run 6ef14f5562's `.brain/state.json` actually persisted. A brain created
 * before `orientation` was inserted has exactly these keys and no others. */
const LEGACY_STAGES_6ef14f5562 = Object.freeze([
  'preflight', 'census', 'provenance', 'harvest', 'explain', 'verify', 'questions', 'interview', 'render',
]);

/*
 * Q1 of `.brain/recall-sealed.md` — the 68-line, 3,940-byte markdown file run 6ef14f5562
 * hand-wrote OUTSIDE every governed ledger, and which 45 of its 160 wiki pages then cited as
 * an authority. Both spans used below occur in it verbatim. If orientation ever stops being
 * able to take this, the run's behaviour is possible again.
 */
const RECALL_Q1_VERBATIM_6ef14f5562 =
  'our stories are created in azure devops, and we create stories in prodinst01 as shadow IT, because ' +
  'the platform team has that as a mandatory requirement. Furthermore, we use JSdoc function ' +
  'conventions and prefix ACME for our artifacts. update sets in multiple scopes (i.e. global and ' +
  'sn_ohs_im) for single stories are batched when we migrate them.';

function orientationArtifact() {
  return {
    stage: 'orientation',
    instance: 'selftest-instance',
    usage: { apiCalls: 0, notes: 'zero instance reads' },
    available: true,
    respondent: 'a.developer',
    recordedAt: '2026-08-12',
    boundaryAsStated: stages.INSTANCE_WIDE_BOUNDARY,
    conventions: [
      { kind: 'artifact-naming', statement: 'All artifacts we build carry the ACME prefix in their name.', appliesTo: 'all customer-authored artifacts', testable: true, pattern: 'ACME*' },
      { kind: 'code-style', statement: 'Server scripts carry JSDoc function headers.', testable: false },
    ],
    documents: [
      { title: 'ACME way of working', url: 'https://confluence.example/x/1', kind: 'way-of-working', currency: 'current', judgedBy: 'a.developer' },
    ],
    tracker: { kind: 'azure-devops', org: 'ns', project: 'ACME', storiesLiveIn: 'both', shadowRecords: true, pairingExample: 'STRY0185200 / AzDO 1243263' },
    recall: {
      recordedAt: '2026-08-12', respondent: 'a.developer', blind: true, contamination: 'none',
      prompts: [{ prompt: 'Five things a new ACME consultant would get wrong', verbatim: RECALL_Q1_VERBATIM_6ef14f5562 }],
      topics: [
        { term: 'azure devops', statement: 'Stories are authored in Azure DevOps; the ServiceNow rows are shadow records.', span: 'our stories are created in azure devops' },
        { term: 'ACME', statement: 'Customer-authored artifacts carry the ACME name prefix.', span: 'prefix ACME for our artifacts' },
      ],
    },
    acceptance: [
      { id: 'AC-ORI-1', result: 'pass', evidence: 'no transport call was made' },
      { id: 'AC-ORI-2', result: 'pass', evidence: 'a named human judged each document' },
      { id: 'AC-ORI-3', result: 'pass', evidence: 'storiesLiveIn=both with a pairing example' },
      { id: 'AC-ORI-4', result: 'pass', evidence: 'spans are verbatim substrings' },
    ],
  };
}

/** Seed a doc-sourced claim exactly as orientation.apply mints one. Returns its id. */
function seedDocClaim(brain) {
  brain.upsertClaims([{
    locus: { table: 'stated-convention', sysId: stateLib.digest({ k: 'artifact-naming', s: 'All artifacts carry the ACME prefix.' }), field: 'artifact-naming' },
    assertion: 'artifact-naming: All artifacts carry the ACME prefix.',
    band: null, rung: 'DOC', status: 'documented',
  }], { stage: 'orientation' });
  return [...brain.claims().values()].filter((c) => c.status === 'documented').pop().id;
}

test('5.26: a stage added after a brain was created is inserted SKIPPED, never pending', () => {
  const root = scratchRepo('ori-migrate');
  const legacy = Brain.init({ root, instance: 'x', stageOrder: LEGACY_STAGES_6ef14f5562.slice() });
  assert(!legacy.state.stages.orientation, 'fixture is wrong: the legacy brain already knows orientation');
  // Finish it exactly as run 6ef14f5562 finished: every stage complete, cursor at done.
  for (const id of LEGACY_STAGES_6ef14f5562) {
    legacy.state.stages[id].status = 'complete';
    legacy.state.stages[id].completedAt = '2026-08-12T00:00:00Z';
  }
  legacy.state.stage = 'done';
  legacy.save('seed-legacy');

  const migrated = Brain.open(root, STAGE_ORDER);
  const st = migrated.state.stages.orientation;
  assert(st, 'Brain.open did not insert the stage the table gained, so every brain created before the insert is unadvanceable and the only escape is the hand edit invariant 6 forbids');
  assert(st.status !== 'pending',
    'the inserted stage is PENDING: successBlockers() lists every stage that is neither complete nor skipped, so this brain can never reach terminal success again');
  assertEqual(st.status, 'skipped', 'an absent stage must be inserted as skipped');
  assert(st.skipReason && st.skipReason.length > 20,
    'the insertion left no reason, so the projection claims a stage was skipped without saying that nothing it settles was measured');
  const blockers = migrated.successBlockers();
  assertEqual(blockers.filter((b) => /orientation/.test(b)).length, 0,
    `a stage added after the fact blocks a finished run: ${blockers.join(' | ')}`);
  // The migration is durable, not per-process.
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(onDisk.stages.orientation.status, 'skipped', 'the migration was in memory only, so every command re-derives it and status disagrees with the file');
});

test('5.26: advance() into a newly inserted stage does not throw "unknown next stage"', () => {
  const root = scratchRepo('ori-advance');
  Brain.init({ root, instance: 'x', stageOrder: LEGACY_STAGES_6ef14f5562.slice() });
  const migrated = Brain.open(root, STAGE_ORDER);
  let threw = null;
  try { migrated.advance('orientation'); } catch (err) { threw = err; }
  assertEqual(threw, null,
    `preflight.next() returning a stage the persisted brain has never heard of strands the run: ${threw && threw.message}`);
  assertEqual(migrated.state.stage, 'orientation');
  assertEqual(migrated.state.stages.orientation.status, 'active',
    'a stage inserted as skipped must still be enterable when the route legitimately reaches it');
});

test('5.26: --blind force-skips orientation and stamps why', () => {
  const { root, syncRoot } = startRun('ori-blind', ['--blind']);
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  assertEqual(r.json.accepted, true, `preflight rejected: ${JSON.stringify(r.json.rejected)}`);
  assertEqual(r.json.nextStage, 'census',
    'a blind run entered orientation — the stage whose entire content is asking a human what is already written down, which is the largest knowledge-bearing input in the loop and destroys the control on every blind run');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stamps.conventions, 'skipped-blind',
    'orientation was skipped with no stamp saying so; run 6ef14f5562 was a blind run and nothing downstream could have told a blind run from one that asked and got nothing');
  assertEqual(st.stages.orientation.status, 'skipped');
});

test('5.26: the human gate is no longer eighth of nine', () => {
  const gated = STAGE_ORDER.filter((id) => STAGE_BY_ID.get(id).humanGate);
  assert(gated.length >= 2, `only ${gated.length} stage(s) admit a human: ${gated.join(', ')}`);
  assertEqual(STAGE_ORDER.indexOf('orientation'), 1,
    'orientation must sit between preflight and census: everything it collects is a prior over where the budget goes, and a prior that arrives after the budget is spent is a footnote');
  assertEqual(STAGE_BY_ID.get('orientation').humanGate, true, 'the stage that exists to hold a human does not declare a human gate');
  const first = STAGE_ORDER.findIndex((id) => STAGE_BY_ID.get(id).humanGate);
  assert(first <= 1,
    `the first human gate is at position ${first + 1} of ${STAGE_ORDER.length}; on run 6ef14f5562 it was eighth of nine — after the boundary was frozen, the budget spent, 8,239 claims minted and the ranker had decided what the operator's ten minutes would be spent on`);
});

test('PRODUCT-73 recurrence, static: orientation is in STAGE_ORDER and convention-gap is in the gate enum', () => {
  const g = STAGE_BY_ID.get('questions').schema.props.questions.items.props.gate.enum;
  assert(STAGE_ORDER.includes('orientation'), `STAGE_ORDER=${STAGE_ORDER.join('>')}`);
  assert(g.includes('convention-gap'),
    `gates=${g.join(',')} — the closed vocabulary that decides what may be asked still cannot carry a convention, which is why the ACME-class rule was induced from 422 rows instead of asked about in one line`);
});

test('5.26: an orientation artifact that spent an API call is refused', () => {
  const { root, syncRoot } = startRun('ori-zero-read');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const art = orientationArtifact();
  art.usage.apiCalls = 4;
  const r = ingest(root, 'orientation', art);
  assertEqual(r.json.accepted, false, 'orientation read the instance, so the stage that exists to aim the budget now spends it');
  assertIncludes(JSON.stringify(r.json.rejected), 'reads NOTHING from the instance');
});

test('5.26: orientation refuses a respondent that is a name this loop gives itself', () => {
  const { root, syncRoot } = startRun('ori-fake-human');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const art = orientationArtifact();
  art.respondent = 'orchestrator (orientation pass)';
  const r = ingest(root, 'orientation', art);
  assertEqual(r.json.accepted, false,
    'the loop answered its own human gate; run 6ef14f5562 closed five of its six blocking findings the same way');
  assertIncludes(JSON.stringify(r.json.rejected), 'available:false');
});

test('PRODUCT-74: a recall topic that paraphrases the human is refused, character for character', () => {
  const { root, syncRoot } = startRun('ori-recall-span');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const art = orientationArtifact();
  // True, and NOT what he said. This is the shape a hand-written markdown recall permits.
  art.recall.topics[1].span = 'the team uses a ACME prefix on its artifacts';
  const r = ingest(root, 'orientation', art);
  assertEqual(r.json.accepted, false, 'a paraphrase entered the decision ledger under a named person\'s attribution');
  assertIncludes(JSON.stringify(r.json.rejected), 'character for character');
});

test('5.26/PRODUCT-73: orientation mints a documented claim and a stated decision per convention', () => {
  const { root, syncRoot } = startRun('ori-accept');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const r = ingest(root, 'orientation', orientationArtifact());
  assertEqual(r.json.accepted, true, `orientation rejected: ${JSON.stringify(r.json.rejected)}`);
  // The sighted route now runs orientation -> seed: the developer's pointers are the
  // second human door, and both precede any instance read.
  assertEqual(r.json.nextStage, 'seed');

  const brain = Brain.open(root, STAGE_ORDER);
  const docClaims = [...brain.claims().values()].filter((c) => c.status === 'documented');
  assertEqual(docClaims.length, 2,
    'a stated convention did not reach the claim ledger — which is why conventions.md rendered 0 of run 6ef14f5562\'s 8,239 claims and passed render.validate trivially');
  assert(docClaims.every((c) => c.rung === 'DOC'), 'a doc-sourced claim carries a verification-ladder rung it never earned');
  assert(docClaims.every((c) => c.band !== 'A' && c.band !== 'B'),
    'a stated convention was banded like an instance record, so explainCandidates() and vocabularyCandidates() will select it and the loop will "induce" next run what a human said this run');

  const derived = [...brain.decisions().values()].map((d) => d.derivedFrom);
  assert(derived.includes('stated'), `no decision was minted from a stated convention: ${derived.join(',')}`);
  assert(derived.includes('recall'), `no decision was minted from the sealed recall: ${derived.join(',')}`);
  assert(!derived.includes('interview'),
    'a stated convention was filed as an interview answer, which loses the ability to say which human statements were pressure-tested against evidence');

  const q = brain.state.queue;
  assertEqual(q.statedConventions.length, 2);
  assertEqual(q.statedConventions.filter((c) => c.testable).length, 1,
    'testability is what decides whether a convention becomes a reconciliation; an untestable one must not be counted as one');
  assert(q.statedConventions.every((c) => /^C-[0-9a-f]{12}$/.test(c.claimId)),
    'the queue does not carry the claim id the CLI allocated, so nothing downstream can bind a question or a page to a convention');
  assertEqual(q.recallTopics.length, 2, 'the recall stayed a markdown file the CLI has never heard of');
  assertEqual(q.statedDocuments.length, 1);
  assertEqual(brain.state.facts.tracker.kind, 'azure-devops', 'the external transport has nothing to configure itself from');
  assertEqual(brain.state.facts.tracker.storiesLiveIn, 'both');
});

test('5.48: orientation records where stories LIVE, distinctly from whether rm_story rows exist', () => {
  const { root, syncRoot } = startRun('ori-tracker');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));

  const art = orientationArtifact();
  art.tracker = { kind: 'azure-devops', org: 'ns', project: 'ACME', storiesLiveIn: 'unknown' };
  const r1 = ingest(root, 'orientation', art);
  assertEqual(r1.json.accepted, false,
    'a named tracker with an unknown home for the stories was accepted; run 6ef14f5562 rebuilt 64 story pages by update-set archaeology while holding 62 exact STRY identifiers in its own domain predicate and the real work items sat in Azure DevOps');
  assertIncludes(JSON.stringify(r1.json.rejected), 'shadow records');

  const art2 = orientationArtifact();
  art2.tracker = { kind: 'azure-devops', org: 'ns', storiesLiveIn: 'external' };
  const r2 = ingest(root, 'orientation', art2);
  assertEqual(r2.json.accepted, false,
    'a tracker with no project was accepted, and org+project is the whole of what the external read transport is configured from');
});

test('5.47: the corpus question is asked inside the boundary the run declared', () => {
  const { root, syncRoot } = startRun('ori-boundary', ['--domain', 'scope:sn_ohs_im; name:ACME*,OHS*,Routing-group*,NSTM*']);
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));

  const bad = ingest(root, 'orientation', orientationArtifact());   // still carries the instance-wide sentinel
  assertEqual(bad.json.accepted, false,
    'the boundary was never put in front of the human, so the documents collected are whichever project they thought of first — which is exactly what this run\'s process candidates turned out to be');

  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  const art = orientationArtifact();
  art.boundaryAsStated = st.stamps.domainBoundary;
  const good = ingest(root, 'orientation', art);
  assertEqual(good.json.accepted, true, `orientation rejected a correctly stated boundary: ${JSON.stringify(good.json.rejected)}`);
});

test('5.26: the corpus gate is stamped from the CONFIGURED wiki root and from what a human declared', () => {
  const root = scratchRepo('aw2a');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const ctx = { brain, state: brain.state, stage: 'census' };
  assert(fs.existsSync(path.join(root, 'docs', 'wiki')), 'fixture is wrong: the configured wiki root does not exist');
  assert(!fs.existsSync(path.join(root, 'wiki')), 'fixture is wrong: the path the old check looked at exists here');

  assert(stages.corpusGateStamp(ctx) !== 'no-structured-corpus',
    'gates.AW-2a is stamped no-structured-corpus while the configured wiki root exists on disk — run 6ef14f5562 stamped exactly this, on every run, because the check looked at <root>/wiki and the installer writes to paths.wikiRoot');

  ctx.state.queue = { statedDocuments: [{ title: 'way of working', currency: 'current' }] };
  assertEqual(stages.corpusGateStamp(ctx), 'available',
    'a corpus a named human pointed at and judged current does not open the gate that exists to check candidate questions against a corpus');

  ctx.state.queue = { statedDocuments: [{ title: 'a 2023 design note', currency: 'stale' }] };
  assertEqual(stages.corpusGateStamp(ctx), 'declared-all-stale',
    'a corpus the human judged entirely stale reports as available, so the gate suppresses questions against documents nobody stands behind');

  ctx.state.queue = { statedDocuments: [] };
  ctx.state.stamps.conventions = 'skipped-blind';
  assertEqual(stages.corpusGateStamp(ctx), 'not-asked-blind',
    'a blind run reports the same gate value as a run that asked a human and found nothing — two populations, one stamp');
});

test('5.26/PRODUCT-74: a testable stated convention with no reconciliation and no suppression is refused', () => {
  const ctx = fakeCtx({
    stage: 'questions',
    state: {
      stamps: { scopeFilter: 'pass', provenance: 'full' },
      queue: {
        statedConventions: [
          { kind: 'artifact-naming', statement: 'all artifacts carry the ACME prefix', pattern: 'ACME*', testable: true, claimId: 'C-000000000001' },
          { kind: 'code-style', statement: 'server scripts carry JSDoc headers', pattern: null, testable: false, claimId: 'C-000000000002' },
        ],
      },
    },
  });
  const art = { questions: [], counts: { candidates: 0, afterGates: 0 }, suppressed: [] };
  const rej = STAGE_BY_ID.get('questions').validate(ctx, art);
  assertIncludes(JSON.stringify(rej), 'artifact-naming',
    'a convention a human stated was never diffed against what the instance actually does; the gap IS the question and this run asked none of them');
  assert(!JSON.stringify(rej).includes('code-style'),
    'an UNTESTABLE convention was demanded as a reconciliation — that is the guessing this stage exists to replace, arriving one stage later');

  // The sanctioned exit. A guard whose only escape is a hand edit has created the defect it fixes.
  art.suppressed = [{ gate: 'AW-CONV', reason: 'artifact-naming: no captured response on this ledger carries a name field, so ACME* cannot be measured' }];
  art.counts = { candidates: 1, afterGates: 0, perGateKills: { 'AW-CONV': 1 } };
  assertEqual(STAGE_BY_ID.get('questions').validate(ctx, art).filter((r) => /artifact-naming/.test(r)).length, 0,
    'a recorded AW-CONV suppression naming the kind is the sanctioned exit; without one this guard has no door');
});

test('5.26: the convention reserve keeps a convention-gap question in the queue when WPM would drop it', () => {
  const ctx = fakeCtx({ stage: 'questions', state: { config: { questionCap: 2, vocabularyReserve: 0, conventionReserve: 1 } } });
  const mk = (gate, E) => ({
    signal: 'QS-01', signalState: 'admitted', gate,
    sources: { A: { kind: 'claim', ref: gate } },
    locus: [{ sysId: gate }],
    question: 'a question long enough to satisfy the schema minimum length',
    form: 'closed', branchMap: { a: 'deliberate', b: 'drift' },
    rank: { E, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 1 },
  });
  const out = STAGE_BY_ID.get('questions').apply(ctx, {
    questions: [mk('contradiction', 50), mk('contradiction', 40), mk('convention-gap', 0.1)],
    counts: { candidates: 3, afterGates: 3 },
  });
  const conv = out.questions.find((q) => q.gate === 'convention-gap');
  assertEqual(conv.status, 'queued',
    'a convention question scored to the floor by a ranker that measures blast radius was deferred out of the cap — which is precisely why --vocab-reserve exists; conventions have identical uninducibility and got nothing');
});

test('5.26: --vocab-reserve 0 means zero', () => {
  const ctx = fakeCtx({ stage: 'questions', state: { config: { questionCap: 1, vocabularyReserve: 0, conventionReserve: 0 } } });
  const mk = (gate, E) => ({
    signal: 'QS-01', signalState: 'admitted', gate,
    sources: { A: { kind: 'claim', ref: gate } }, locus: [{ sysId: gate }],
    question: 'a question long enough to satisfy the schema minimum length',
    form: 'closed', branchMap: { a: 'x', b: 'y' },
    rank: { E, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 1 },
  });
  const out = STAGE_BY_ID.get('questions').apply(ctx, {
    questions: [mk('contradiction', 50), mk('register-gap', 0.1)],
    counts: { candidates: 2, afterGates: 2 },
  });
  assertEqual(out.questions.find((q) => q.gate === 'contradiction').status, 'queued',
    'an operator who set a reserve to 0 got the default back, because `|| 3` reads 0 as absent — a switch that does not switch off');
});

test('5.50: a documented claim is SETTLED — it blocks nothing and verify never loops on it', () => {
  const root = scratchRepo('doc-settled');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  seedDocClaim(brain);
  brain.save('seed');
  assertEqual(brain.successBlockers().filter((b) => /claim\(s\) still in/.test(b)).length, 0,
    'a doc-sourced claim was treated as open work, so a lead a human handed us in minute one blocks handoff forever');
  const ctx = { brain, state: brain.state, stage: 'verify' };
  assertEqual(STAGE_BY_ID.get('verify').next(ctx), 'questions',
    'verify tried to re-query a claim that has no oracle by construction; a document is not replayable, which is the whole reason it needs its own rung');
});

test('5.50: doc-sourced claims are excluded from the domain yield, and the exclusion is reported', () => {
  const y = stateLib.domainYield([
    { admittedBy: ['scope'] },
    { admittedBy: [], status: 'documented', rung: 'DOC' },
  ]);
  assertEqual(y.unattributed, 0,
    'a stated convention was counted as an in-boundary claim that no leg admitted — two populations in one denominator, which is the shape of the three register entries that came back as different defects at full price');
  assertEqual(y.documented, 1, 'the excluded population is not reported, so it is invisible rather than named');
  assertEqual(y.legs.scope.admitted, 1, 'excluding the doc claims disturbed the instance-claim counts');
});

test('5.50: a page that renders a doc-sourced claim may not be marked verified', () => {
  const root = scratchRepo('doc-page');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const docId = seedDocClaim(brain);
  const ctx = { brain, state: brain.state, stage: 'render' };
  for (const rel of ['docs/wiki/conventions.md', 'CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // PRODUCT-95: the page PRINTS the id it declares. A fixture page that cites nothing is a page
    // no renderer may now produce, and testing against one proves the wrong thing.
    fs.writeFileSync(abs, `---\nclaims-rendered: 1\n---\n\n# seeded\n\nartifact-naming: All artifacts carry the ACME prefix. \`${docId}\`\n`);
  }
  const art = {
    pages: [{ path: 'docs/wiki/conventions.md', status: 'verified', rendersClaims: [docId], tier: 'conventions' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  assertIncludes(JSON.stringify(STAGE_BY_ID.get('render').validate(ctx, art)), 'doc-sourced',
    'a human-authored document satisfied a verified page status; the SME\'s own hand-built brain carried a wrong QRT expansion for five months and only the instance-driven interview corrected it');

  art.pages[0].status = 'doc-sourced';
  const clean = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(clean.length, 0, `a correctly marked doc-sourced page was rejected: ${JSON.stringify(clean)}`);
});

test('5.50: the all-doc-sourced rejection names the enum value, because prose satisfied its wording twice', () => {
  /*
   * pilot-run-5, render: "say so on the page's face" means status=doc-sourced — an enum the
   * validator compares against — and the render agent implemented it as a prose banner in the
   * page body TWICE, burned the 3-iteration cap on a rejection that was already deterministic,
   * and needed an operator override (3 -> 6) to land a one-word fix. A rejection that knows
   * the only legal answer must say it verbatim.
   */
  const root = scratchRepo('doc-page-enum');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const docId = seedDocClaim(brain);
  const ctx = { brain, state: brain.state, stage: 'render' };
  for (const rel of ['docs/wiki/conventions.md', 'CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `---\nclaims-rendered: 1\n---\n\n# seeded\n\nartifact-naming: All artifacts carry the ACME prefix. \`${docId}\`\n`);
  }
  const art = {
    pages: [{ path: 'docs/wiki/conventions.md', status: 'draft', rendersClaims: [docId], tier: 'conventions' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  const rej = STAGE_BY_ID.get('render').validate(ctx, art).join(' ');
  assert(rej.includes('status: "doc-sourced"'),
    `the rejection does not name the enum value it compares against, so it reads as a prose requirement:\n${rej}`);
  assert(/prose on the page body does not satisfy it/.test(rej),
    'the rejection does not rule out the exact wrong answer the render agent gave twice');
  art.pages[0].status = 'doc-sourced';
  const clean = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(clean.length, 0, `the answer the rejection names does not actually satisfy the validator: ${JSON.stringify(clean)}`);
});

test('6.3: a page may not disclaim what the run already read — blocked_on and unread lines both', () => {
  /*
   * PRODUCT-93: pilot-run-4 shipped `blocked_on: sys_user_group` on two pages while the raw sweep
   * in the same .brain/ held 21 groups and the exact five grants the empty slot wanted.
   * PRODUCT-94 (2): the same run declared `sys_choice` unread over 3,750 verified claims, and
   * pilot-run-5 recurred at scale (11 lines, worst sys_atf_step over 4,088 claims). Both checks
   * carry a measured false-positive carve-out: a prose blocker ("blocked_on: interview answer
   * needed") is not a table — the naive form raised 40 false hits on pilot-run-5 — and a line
   * quantifying ROWS declares rows, not the table (the register's own sys_security_acl case).
   */
  const root = scratchRepo('disclaim');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const sid = '00000000000000000000000000000abc';
  const up = brain.upsertClaims([{
    locus: { table: 'sys_choice', sysId: sid, field: 'label' },
    assertion: 'sys_choice row on incident.severity: label "100 - Multiple fatalities", value 100.',
    band: 'A', rung: 'L1', status: 'verified',
    evidence: { query: 'name=incident^element=severity', fields: 'sys_id,label,value', capturedAt: '2026-08-20T00:00:00Z', capturedResponse: { sys_id: sid, label: '100 - Multiple fatalities', value: '100' } },
  }], { stage: 'harvest' });
  const claimId = up.ids[0];
  fs.mkdirSync(path.join(root, '.brain', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brain', 'raw', 'sweep.ndjson'),
    JSON.stringify({ table: 'sys_user_group', name: 'ACME - BackOffice' }) + '\n' +
    JSON.stringify({ note: 'orientation interview pending' }) + '\n');
  for (const rel of ['CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'seeded');
  }
  const pagePath = path.join(root, 'docs', 'wiki', 'coverage.md');
  const pageText = [
    '---', 'claims-rendered: 1', '---', '',
    '# coverage', '', `\`${claimId}\``, '',
    '<!-- slot: personas.groups | source: LB | status: unfilled | blocked_on: sys_user_group is data, not metadata -->',
    '<!-- slot: x | source: LB | status: unfilled | blocked_on: interview answer needed -->',
    '- `sys_choice` via the dictionary child path — unprobed, not proven empty',
    '- `sys_choice`: 6 rows were suppressed and not read',
  ].join('\n');
  fs.writeFileSync(pagePath, pageText);
  const ctx = { brain, state: brain.state, stage: 'render' };
  const art = {
    pages: [{ path: 'docs/wiki/coverage.md', status: 'draft', rendersClaims: [claimId], tier: 'coverage' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  const rej = STAGE_BY_ID.get('render').validate(ctx, art);
  const blockedRej = rej.filter((m) => /blocked_on slot/.test(m));
  assertEqual(blockedRej.length, 1, `expected one aggregate blocked_on rejection:\n${rej.join('\n')}`);
  assert(/sys_user_group/.test(blockedRej[0]), 'the raw-refuted blocker was not caught');
  assert(!/interview/.test(blockedRej[0]),
    'a prose blocker was treated as a table — the naive form raised 40 false hits on pilot-run-5\'s own wiki');
  const unreadRej = rej.filter((m) => /declare a table unread/.test(m));
  assertEqual(unreadRej.length, 1, `expected one aggregate unread rejection:\n${rej.join('\n')}`);
  assert(/sys_choice/.test(unreadRej[0]), 'the ledger-falsified unread line was not caught');
  assert(/1 coverage line\(s\)/.test(unreadRej[0]),
    'the rows-quantified line was counted — the sys_security_acl false positive the register documented as the check\'s own defect');
  // The legal rewrites — the fact-form sentence and the truthful blocker — must actually pass.
  fs.writeFileSync(pagePath, pageText
    .replace('blocked_on: sys_user_group is data, not metadata',
      'blocked_on: the pipeline has no bank for this read; the evidence sits in .brain/raw/sweep.ndjson')
    .replace('- `sys_choice` via the dictionary child path — unprobed, not proven empty',
      '- `sys_choice` was read via the sys-choice-set area (1 claim) and NOT via the dictionary child path'));
  const rej2 = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(rej2.filter((m) => /blocked_on slot|declare a table unread/.test(m)).length, 0,
    `the legal rewrites do not satisfy the check, so it has no cheapest legal answer:\n${rej2.join('\n')}`);
});

test('PRODUCT-73: conventions.md may not ship rendering zero claims while a human stated some', () => {
  const root = scratchRepo('conv-page');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const docId = seedDocClaim(brain);
  brain.state.queue = {
    statedConventions: [{ kind: 'artifact-naming', statement: 'All artifacts carry the ACME prefix.', pattern: 'ACME*', testable: true, claimId: docId }],
  };
  const ctx = { brain, state: brain.state, stage: 'render' };
  for (const rel of ['docs/wiki/conventions.md', 'CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // The enforcement line is 7.5's contract: a stated convention is enforced, or the page
    // says why not — a compliant fixture now carries one or it proves the wrong thing.
    fs.writeFileSync(abs, `---\nclaims-rendered: 1\n---\n\n# seeded\n\nartifact-naming: All artifacts carry the ACME prefix. \`${docId}\`\n\n- **artifact-naming** — enforcement: none — measurement pending a live run (claim \`${docId}\`)\n`);
  }
  /*
   * The EXACT page record run 6ef14f5562 shipped, from `.brain/render-manifest.json`:
   *   {"path":"docs/wiki/conventions.md","tier":"conventions","status":"draft",
   *    "rendersClaims":[],"citesDecisions":["DEC-a871c6eccbbe"],"bytes":6883}
   * One of 12 of 160 pages with an empty rendersClaims array, and render.validate passed it
   * trivially because it only ever checked the ids that WERE there.
   */
  const art = {
    pages: [{ path: 'docs/wiki/conventions.md', status: 'draft', rendersClaims: [], tier: 'conventions' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  assertIncludes(JSON.stringify(STAGE_BY_ID.get('render').validate(ctx, art)), 'claimsRendered',
    'the one governance page the contract mandates shipped with an empty rendersClaims array, manufactured entirely out of band, and nothing objected');

  art.pages[0].rendersClaims = [docId];
  art.pages[0].status = 'doc-sourced';
  const clean = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(clean.length, 0, `a conventions page rendering the stated conventions was still rejected: ${JSON.stringify(clean)}`);
});

// ===========================================================================

// ===========================================================================

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');

group('A. stage table');

test('STAGE_ORDER has no duplicates and matches STAGES', () => {
  assertEqual(new Set(STAGE_ORDER).size, STAGE_ORDER.length, 'duplicate stage id in STAGE_ORDER');
  assertEqual(STAGE_ORDER.length, STAGES.length, 'STAGE_ORDER and STAGES disagree on length');
  for (const s of STAGES) { assert(STAGE_BY_ID.get(s.id) === s, `STAGE_BY_ID lookup failed for "${s.id}"`); }
});

test('every stage carries the keys the engine dereferences', () => {
  for (const s of STAGES) {
    for (const key of ['id', 'title', 'goal', 'schema', 'acceptance', 'next', 'validate', 'apply']) {
      assert(s[key] !== undefined, `stage "${s.id}" is missing "${key}", which snbrain.js dereferences unconditionally`);
    }
    assert(typeof s.next === 'function', `stage "${s.id}".next must be a function`);
    assert(Array.isArray(s.acceptance) && s.acceptance.length, `stage "${s.id}" has no acceptance criteria`);
  }
});

test('acceptance ids are unique within each stage', () => {
  for (const s of STAGES) {
    const ids = s.acceptance.map((x) => x.id);
    assertEqual(new Set(ids).size, ids.length, `stage "${s.id}" repeats an acceptance id: ${ids.join(', ')}`);
    for (const x of s.acceptance) {
      assert(x.statement && x.statement.length > 10, `stage "${s.id}" acceptance ${x.id} has no usable statement`);
    }
  }
});

test('stagnation modes are from the closed set the engine understands', () => {
  for (const s of STAGES) {
    const mode = s.stagnation || 'none';
    assert(['none', 'accepted', 'claims-added', 'resolutions'].includes(mode),
      `stage "${s.id}" declares stagnation "${mode}", which _stoppingRules() does not implement`);
  }
});

test('every schema uses a known validator type', () => {
  const known = new Set(['object', 'array', 'string', 'number', 'boolean', 'any']);
  const walk = (schema, where) => {
    if (!schema || typeof schema !== 'object') { return; }
    if (schema.type !== undefined) {
      assert(known.has(schema.type), `${where}: unknown schema type "${schema.type}"`);
    }
    if (schema.props) { for (const [k, v] of Object.entries(schema.props)) { walk(v, `${where}.${k}`); } }
    if (schema.items) { walk(schema.items, `${where}[]`); }
  };
  walk(ENVELOPE_SCHEMA, 'ENVELOPE_SCHEMA');
  for (const s of STAGES) { walk(s.schema, `${s.id}.schema`); }
});

test('a required key is never also listed as forbidden', () => {
  const walk = (schema, where) => {
    if (!schema || typeof schema !== 'object') { return; }
    const req = new Set(schema.required || []);
    for (const f of schema.forbidden || []) {
      assert(!req.has(f), `${where}: "${f}" is both required and forbidden — no artifact can ever be accepted`);
    }
    if (schema.props) { for (const [k, v] of Object.entries(schema.props)) { walk(v, `${where}.${k}`); } }
    if (schema.items) { walk(schema.items, `${where}[]`); }
  };
  for (const s of STAGES) { walk(s.schema, `${s.id}.schema`); }
});

test('goal, reads and procedure compose without throwing, for every stage', () => {
  for (const s of STAGES) {
    const ctx = fakeCtx({ stage: s.id });
    assert(typeof (typeof s.goal === 'function' ? s.goal(ctx) : s.goal) === 'string', `stage "${s.id}".goal did not yield a string`);
    if (s.reads) { assert(Array.isArray(s.reads(ctx)), `stage "${s.id}".reads did not yield an array`); }
    if (s.procedure) { assert(Array.isArray(s.procedure(ctx)), `stage "${s.id}".procedure did not yield an array`); }
  }
});

test('every declared read names a path and a reason', () => {
  for (const s of STAGES) {
    if (!s.reads) { continue; }
    for (const r of s.reads(fakeCtx({ stage: s.id }))) {
      assert(r && typeof r.path === 'string' && r.path.length > 2, `stage "${s.id}" declares a read with no path`);
      assert(r && typeof r.why === 'string' && r.why.length > 10, `stage "${s.id}" read "${r.path}" has no usable reason`);
    }
  }
});

test('no stage brief points at a framework path that does not exist in this repo', () => {
  /*
   * Only FRAMEWORK-side paths. A brief legitimately names engagement-side paths that do not
   * exist here — `docs/wiki/` is the installed wiki scaffold, `.brain/` artifacts are created
   * during a run, and `.claude/skills/snbrain-*` engagement procedures are optional. Checking
   * those would make this test fail on a correct repo, which trains people to ignore it.
   */
  const repoRoot = path.resolve(__dirname, '..', '..');
  const misses = [];
  for (const s of STAGES) {
    if (!s.reads) { continue; }
    for (const r of s.reads(fakeCtx({ stage: s.id }))) {
      const p = String(r.path).split('#')[0];
      const isFramework = /^(tools|kernel|probes|playbooks)\//.test(p) || /^docs\/[^/]+\.md$/.test(p);
      if (!isFramework) { continue; }
      if (!fs.existsSync(path.join(repoRoot, p))) { misses.push(`${s.id} -> ${p}`); }
    }
  }
  assertEqual(misses.length, 0, `stage briefs point at framework files that do not exist:\n  ${misses.join('\n  ')}`);
});

test('PRODUCT-1: every tools/snbrain/*.js path named in a contract doc exists', () => {
  /*
   * The recurrence check for PRODUCT-1, mechanised. Four documents named
   * `tools/snbrain/cli.js` — including map-instance.md, whose instruction on not finding it is
   * to HALT THE RUN. A stop-the-run instruction aimed at a filename that never existed cost a
   * full stop-and-verify at the start of the the pilot customer run.
   */
  const repoRoot = path.resolve(__dirname, '..', '..');
  const docs = [
    '.claude/commands/map-instance.md',
    '.claude/snbrain/LOOP.md',
    '.claude/skills/snbrain-map/SKILL.md',
    'tools/snbrain/README.md',
  ];
  const misses = [];
  for (const doc of docs) {
    const abs = path.join(repoRoot, doc);
    if (!fs.existsSync(abs)) { continue; }
    const text = fs.readFileSync(abs, 'utf8');
    const re = /tools\/snbrain\/[A-Za-z0-9_-]+\.js/g;
    let m;
    while ((m = re.exec(text))) {
      if (!fs.existsSync(path.join(repoRoot, m[0]))) { misses.push(`${doc} names ${m[0]}, which does not exist`); }
    }
  }
  assertEqual(misses.length, 0, `contract docs name CLI files that are not there:\n  ${misses.join('\n  ')}`);
});

// ===========================================================================
// B — THE LOAD-BEARING ONE. Every worked example must satisfy its own stage.
// ===========================================================================

test('every stage skill a brief names exists on disk', () => {
  /*
   * Nine stages shipped a skill and the tenth named one that was never written. The read is
   * declared optional so the agent degraded correctly to the brief's own procedure — but a
   * brief naming a file that does not exist is a promise the repo does not keep, and the
   * agent has to spend a turn discovering that.
   */
  const missing = [];
  for (const st of STAGES) {
    if (typeof st.reads !== 'function') { continue; }
    const ctx = { brain: { root: FRAMEWORK_ROOT }, state: { config: {}, stamps: {}, queue: {} } };
    for (const r of st.reads(ctx)) {
      if (r.path.indexOf('skills/snbrain-') < 0) { continue; }
      if (!fs.existsSync(path.join(FRAMEWORK_ROOT, r.path))) { missing.push(st.id + ' -> ' + r.path); }
    }
  }
  assertEqual(missing.length, 0, `a stage brief names a skill that is not on disk:\n  ${missing.join('\n  ')}`);
});

group('B. worked examples');

test('every example declares the stage it belongs to', () => {
  for (const s of STAGES) {
    if (!s.example) { continue; }
    const ex = s.example(fakeCtx({ stage: s.id }));
    assertEqual(ex.stage, s.id, `stage "${s.id}" example carries stage="${ex.stage}"`);
  }
});

test('every example satisfies the ENVELOPE schema', () => {
  for (const s of STAGES) {
    if (!s.example) { continue; }
    const errors = validate(ENVELOPE_SCHEMA, s.example(fakeCtx({ stage: s.id })), '$');
    assertEqual(errors.length, 0, `stage "${s.id}" example fails the envelope:\n  ${errors.join('\n  ')}`);
  }
});

test('every example satisfies its own PAYLOAD schema', () => {
  for (const s of STAGES) {
    if (!s.example) { continue; }
    const errors = validate(s.schema, s.example(fakeCtx({ stage: s.id })), '$');
    assertEqual(errors.length, 0,
      `stage "${s.id}" example fails its own payload schema — this is what a fresh subagent copies:\n  ${errors.join('\n  ')}`);
  }
});

test('every example declares a result for every acceptance id of its stage', () => {
  for (const s of STAGES) {
    if (!s.example) { continue; }
    const ex = s.example(fakeCtx({ stage: s.id }));
    const declared = new Set((ex.acceptance || []).map((x) => x.id));
    const known = new Set(s.acceptance.map((x) => x.id));
    for (const id of declared) {
      assert(known.has(id), `stage "${s.id}" example declares unknown acceptance id "${id}"`);
    }
    for (const x of ex.acceptance || []) {
      assert(OUTCOME_RESULTS.includes(x.result), `stage "${s.id}" example uses result "${x.result}", not in the three-valued vocabulary`);
    }
  }
});

/*
 * Every stage's example must survive its own VALIDATOR, not merely its schema. The schema
 * catches a missing key; the validator is where the semantic rules live — gate arithmetic,
 * verbatim grounding, ledger references, files that must exist — and it is where a wrong
 * example is expensive, because it looks right until a live run rejects it eight hours in.
 *
 * Each seed puts the world into the state the example presupposes, and nothing more. If a
 * stage needs a seed that is not obviously reasonable, that is itself worth knowing: it means
 * the example depends on context the brief does not hand a fresh subagent.
 */
const SEEDS = {
  preflight: (ctx, ex) => {
    writeProbeResults(path.resolve(ctx.brain.root, ex.probeResultsPath), { instance: ctx.state.instance });
  },
  harvest: (ctx, ex) => { ctx.state.queue = { harvestAreas: [ex.area], harvestDone: [] }; },
  explain: (ctx, ex) => {
    ctx.brain.upsertClaims(ex.claims.map((c) => ({
      locus: { table: c.locus.table, sysId: c.locus.sysId }, assertion: 'harvested', band: c.band, status: 'draft',
      evidence: { query: 'q', fields: 'f', capturedAt: '2026-08-11T00:00:00Z', capturedResponse: c.evidence.capturedResponse, guards: { fields: 'validated', identityCanary: 'pass' } },
    })), { stage: 'harvest' });
  },
  verify: (ctx, ex) => {
    // The verdicts name claim ids, and ids are content hashes — so seed loci that HASH to them.
    for (const v of ex.verdicts) {
      ctx.brain.upsertClaims([{ locus: { table: 't', sysId: v.claimId }, assertion: 'seeded', band: 'A', status: 'draft' }], { stage: 'harvest' });
      const seeded = [...ctx.brain.claims().values()].pop();
      v.claimId = seeded.id;
    }
  },
  questions: (ctx, ex) => {
    ctx.state.stamps.scopeFilter = 'pass';
    ctx.state.stamps.provenance = 'full';
    for (const q of ex.questions) {
      for (const l of q.locus || []) {
        if (!l.claim) { continue; }
        ctx.brain.upsertClaims([{ locus: { table: l.table || 't', sysId: l.sysId }, assertion: 'seeded', band: 'A', status: 'draft' }], { stage: 'harvest' });
        l.claim = [...ctx.brain.claims().values()].pop().id;
      }
    }
  },
  interview: (ctx, ex) => {
    for (const a of ex.answers) {
      ctx.brain.upsertQuestions([{ id: a.questionId, __cliAllocated: true, signal: 'QS-01', status: 'queued', locus: [{ sysId: 'x' }], question: 'seeded question text for the selftest' }]);
    }
  },
  render: (ctx, ex) => {
    for (const p of ex.pages) {
      for (const id of p.rendersClaims || []) {
        ctx.brain.upsertClaims([{ locus: { table: 't', sysId: id }, assertion: 'seeded', band: 'A', status: 'verified' }], { stage: 'verify' });
        p.rendersClaims = [[...ctx.brain.claims().values()].pop().id];
      }
    }
    const byPath = new Map(ex.pages.map((p) => [p.path, p]));
    for (const rel of ex.pages.map((p) => p.path).concat([ex.kernel.path, ex.settings.path], (ex.skills || []).map((s) => s.path))) {
      const abs = path.resolve(ctx.brain.root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, seededPage(byPath.get(rel)));
    }
  },
};

/**
 * A fixture page that satisfies PRODUCT-95's accounting: it PRINTS the ids its manifest declares
 * and declares the count it prints. A fixture that does not is testing a page no renderer may
 * now produce, which is how a suite drifts into proving the wrong thing.
 */
function seededPage(page) {
  const ids = (page && page.rendersClaims) || [];
  return [
    '---',
    'title: "seeded by the selftest"',
    `claims-rendered: ${new Set(ids).size}`,
    '---',
    '',
    '# seeded by the selftest',
    '',
  ].concat(ids.map((id) => `- something the instance says · \`${id}\``)).join('\n') + '\n';
}

test('every example survives its own VALIDATOR, not just its schema', () => {
  const failures = [];
  for (const s of STAGES) {
    if (!s.example || !s.validate) { continue; }
    const root = scratchRepo(`ex-validate-${s.id}`);
    const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
    const ctx = { brain, state: brain.state, stage: s.id };
    ctx.state.syncRoot = path.join(root, 'sync');
    const ex = s.example(ctx);
    if (SEEDS[s.id]) { SEEDS[s.id](ctx, ex); }
    let rej;
    try { rej = s.validate(ctx, ex); } catch (err) { failures.push(`${s.id}: validator THREW on its own example — ${err.message}`); continue; }
    if (rej.length) { failures.push(`${s.id}:\n      - ${rej.join('\n      - ')}`); }
  }
  assertEqual(failures.length, 0, `worked examples rejected by their own stage:\n  ${failures.join('\n  ')}`);
});

test('example findings use the immutable-severity vocabulary and a real rung', () => {
  for (const s of STAGES) {
    if (!s.example) { continue; }
    for (const f of s.example(fakeCtx({ stage: s.id })).findings || []) {
      assert(SEVERITIES.includes(f.severity), `stage "${s.id}" example finding severity "${f.severity}" is not one of ${SEVERITIES.join('|')}`);
      assert(RUNGS.includes(f.rung), `stage "${s.id}" example finding rung "${f.rung}" is not a ladder rung`);
    }
  }
});

// ===========================================================================
// C — end to end through the real CLI, with no instance anywhere.
// ===========================================================================

group('C. end to end');

/** Drive init + preflight, the shared prefix of most end-to-end cases. */
function startRun(name, initArgs) {
  const root = scratchRepo(name);
  const syncRoot = path.join(root, 'sync');
  fs.mkdirSync(path.join(syncRoot, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(syncRoot, '.vscode', 'sn-agent-port.json'), JSON.stringify({ port: 51925, pid: 1, apiVersion: 6 }));
  const init = cli(['init', '--instance', 'selftest-instance', '--root', root, '--sync-root', syncRoot].concat(initArgs || []));
  assertEqual(init.code, 0, `init failed:\n${init.stdout}${init.stderr}`);
  return { root, syncRoot };
}

function ingest(root, stage, artifact) {
  const file = path.join(root, '.brain', 'in', `${stage}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
  return cliJson(['ingest', '--stage', stage, '--file', file, '--root', root]);
}

function preflightArtifact(root, syncRoot, probeOpts) {
  const probeFile = writeProbeResults(path.join(syncRoot, 'spikes', 'scriptsync-read', 'results.json'), probeOpts);
  return {
    stage: 'preflight',
    instance: 'selftest-instance',
    usage: { apiCalls: 120 },
    probeResultsPath: path.relative(root, probeFile).split(path.sep).join('/'),
    transport: { restGet: 'ok', paging: 'ok', aggregates: 'ok', clauseDropReproduced: true, payloadCeilingRows: 25, sessionIsAdmin: true, customerUpdateAvailable: false },
    instanceIdentity: { name: 'selftest-instance', tier: 'vendor-dev' },
    acceptance: [
      { id: 'AC-PRE-1', result: 'pass', evidence: 'canary returned 1 row' },
      { id: 'AC-PRE-2', result: 'pass', evidence: 'probes 1,2,3 conclusive' },
      { id: 'AC-PRE-3', result: 'pass', evidence: 'probes 6 and 7 both ran' },
      { id: 'AC-PRE-4', result: 'pass', evidence: 'no kill fired' },
    ],
  };
}

test('init creates a brain sitting at the first stage', () => {
  const { root } = startRun('e2e-init');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stage, STAGE_ORDER[0], 'a fresh brain does not start at the first stage');
  assertEqual(st.terminal, null, 'a fresh brain is already terminal');
  assertEqual(st.instance, 'selftest-instance');
});

test('next is idempotent — it composes a brief and never advances', () => {
  const { root } = startRun('e2e-idempotent');
  const a = cliJson(['next', '--root', root]);
  assertEqual(a.code, 0, `next failed:\n${a.stderr}`);
  assert(a.json && a.json.stage === STAGE_ORDER[0], 'next did not return a brief for the current stage');
  const b = cliJson(['next', '--root', root]);
  assertEqual(b.json.stage, a.json.stage, 'next advanced the cursor, which it must never do');
  assertEqual(b.json.iteration, a.json.iteration, 'next incremented the iteration counter');
});

test('a brief carries the hard rules and a self-contained produce block', () => {
  const { root } = startRun('e2e-brief');
  const brief = cliJson(['next', '--root', root]).json;
  assert(Array.isArray(brief.hardRules) && brief.hardRules.length >= 5, 'brief lost the hard rules');
  assert(brief.produce && brief.produce.path && brief.produce.payloadSchema, 'brief has no produce block');
  assertIncludes(JSON.stringify(brief.hardRules), 'READ-ONLY', 'the read-only rule is not in the brief');
});

test('preflight accepts a well-formed artifact and routes to the human door', () => {
  const { root, syncRoot } = startRun('e2e-preflight');
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  assertEqual(r.code, 0, `preflight ingest failed:\n${r.stdout}${r.stderr}`);
  assertEqual(r.json.accepted, true, `preflight rejected: ${JSON.stringify(r.json.rejected)}`);
  // On a SIGHTED run the next stage is orientation, which precedes the census on purpose:
  // everything it collects is a prior over where the budget goes.
  assertEqual(r.json.nextStage, 'orientation', 'preflight did not route to orientation');
});

test('preflight refuses an artifact whose probe file is not on disk', () => {
  const { root, syncRoot } = startRun('e2e-preflight-missing');
  const art = preflightArtifact(root, syncRoot);
  art.probeResultsPath = 'spikes/scriptsync-read/does-not-exist.json';
  const r = ingest(root, 'preflight', art);
  assertEqual(r.json.accepted, false, 'preflight accepted a pointer to a file that does not exist');
  assertIncludes(JSON.stringify(r.json.rejected), 'no file at', 'rejection did not name the missing probe file');
});

test('PRODUCT-21: the old probeResults key is rejected by name, not by "required, but missing"', () => {
  const { root, syncRoot } = startRun('e2e-probe-rename');
  const art = preflightArtifact(root, syncRoot);
  art.probeResults = art.probeResultsPath;
  delete art.probeResultsPath;
  const r = ingest(root, 'preflight', art);
  assertEqual(r.json.accepted, false);
  assertIncludes(JSON.stringify(r.json.rejected), 'renamed to probeResultsPath',
    'the old key produced a generic schema error instead of naming its replacement');
});

test('a fired kill criterion terminates the run as blocked', () => {
  const { root, syncRoot } = startRun('e2e-kill');
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot, { kills: [2] }));
  assertEqual(r.json.terminal, 'blocked', `a fired kill criterion did not block the run: ${JSON.stringify(r.json)}`);
});

test('the envelope is enforced before any stage-specific rule', () => {
  const { root, syncRoot } = startRun('e2e-envelope');
  const art = preflightArtifact(root, syncRoot);
  delete art.usage;
  const r = ingest(root, 'preflight', art);
  assertEqual(r.json.accepted, false, 'an artifact with no usage block was accepted');
  assertIncludes(JSON.stringify(r.json.rejected), 'usage', 'rejection did not name the missing usage block');
});

test('ids supplied by the model are refused', () => {
  const { root, syncRoot } = startRun('e2e-forbidden-id');
  const art = preflightArtifact(root, syncRoot);
  art.findings = [{ id: 'F-deadbeef', check: 'made-up', severity: 'info', rung: 'L1', message: 'a model allocated this id' }];
  const r = ingest(root, 'preflight', art);
  assertEqual(r.json.accepted, false, 'a model-allocated finding id was accepted');
  assertIncludes(JSON.stringify(r.json.rejected), 'MUST NOT be supplied', 'rejection did not explain that the CLI allocates ids');
});

test('an unknown stage name is a usage error, not a crash', () => {
  const { root } = startRun('e2e-unknown-stage');
  const file = path.join(root, '.brain', 'in', 'nope.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}');
  const r = cli(['ingest', '--stage', 'not-a-stage', '--file', file, '--root', root]);
  assert(r.code !== 0, 'ingesting an unknown stage exited 0');
  assert(!/TypeError|ReferenceError|undefined is not/.test(r.stderr), `unknown stage crashed rather than reporting usage:\n${r.stderr}`);
});

test('PRODUCT-25: a failed acceptance is reported unreachable AT PREFLIGHT, not at done', () => {
  const { root, syncRoot } = startRun('e2e-reachable');
  const art = preflightArtifact(root, syncRoot);
  art.acceptance = art.acceptance.map((x) => (x.id === 'AC-PRE-3' ? { id: 'AC-PRE-3', result: 'fail', evidence: 'probe 7 did not reproduce' } : x));
  const r = ingest(root, 'preflight', art);
  assertEqual(r.json.accepted, true, 'the artifact itself should still be accepted — a failed acceptance is data, not a malformed file');
  assertEqual(r.json.successReachable, false,
    'a failed acceptance on iteration 1 did not report success as unreachable; the reference run spent eight more hours not knowing');
  assertIncludes(JSON.stringify(r.json.successBlockers), 'AC-PRE-3', 'the blocker was not named');
});

test('a healthy run in progress is NOT reported unreachable', () => {
  const { root, syncRoot } = startRun('e2e-reachable-ok');
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  assertEqual(r.json.successReachable, true,
    'a clean preflight reported success unreachable — incomplete stages and draft claims are the normal state of a run in progress, and flagging them trains the operator to ignore the field');
});

test('PRODUCT-18: a phantom subcommand fails LOUDLY instead of listing and exiting 0', () => {
  const { root } = startRun('e2e-phantom-verb');
  const r = cli(['questions', 'answer', 'Q-a1b2c3d4e5f6', '--by', 'someone', '--root', root]);
  assert(r.code !== 0,
    'PRODUCT-18: `questions answer` parsed as a bare listing and exited 0, so the caller believed an answer had been recorded');
  assertIncludes(r.stderr, 'Nothing was recorded', 'the failure did not say that nothing was recorded');
  assertIncludes(r.stderr, 'ingest --stage interview', 'the failure did not point at the seam that actually works');
});

test('no stage skill documents a CLI verb that does not exist', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const bad = [];
  for (const rel of ['.claude/skills/snbrain-interview/SKILL.md', '.claude/skills/snbrain-map/SKILL.md', '.claude/commands/map-instance.md']) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { continue; }
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:\$\s*)?snbrain\s+([a-z-]+)\s+([a-z][a-z-]*)/.exec(line);
      // A second bare word after the verb is a subcommand, and this CLI has none.
      if (m && !m[2].startsWith('--')) { bad.push(`${rel}: "snbrain ${m[1]} ${m[2]}"`); }
    }
  }
  assertEqual(bad.length, 0, `stage skills document subcommands this CLI does not have:\n  ${bad.join('\n  ')}`);
});

test('status runs against a fresh brain without throwing', () => {
  const { root } = startRun('e2e-status');
  const r = cli(['status', '--root', root]);
  assertEqual(r.code, 0, `status failed:\n${r.stderr}`);
  assertIncludes(r.stdout, 'selftest-instance', 'status did not name the instance');
});

// ===========================================================================
// D — control flow invariants that no model string may influence.
// ===========================================================================

group('D. control flow');

test('severity is immutable once a finding is recorded', () => {
  const root = scratchRepo('cf-severity');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertFindings([{ check: 'c', rung: 'L1', severity: 'blocking', message: 'the original severity' }], { stage: 'census' });
  const r = brain.upsertFindings([{ check: 'c', rung: 'L1', severity: 'info', message: 'a downgrade attempt' }], { stage: 'census' });
  assertEqual(r.rejections.length, 1, 'a severity downgrade was accepted');
  assertIncludes(r.rejections[0], 'IMMUTABLE', 'the rejection did not say severity is immutable');
  assertEqual([...brain.findings().values()][0].severity, 'blocking', 'the stored severity moved');
});

test('an open blocking finding blocks terminal success', () => {
  const root = scratchRepo('cf-blocking');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertFindings([{ check: 'c', rung: 'L1', severity: 'blocking', message: 'still open' }], { stage: 'census' });
  assert(brain.successBlockers().some((b) => /blocking/.test(b)), 'an open blocking finding did not block success');
});

test('an L4 finding cannot be dispositioned by L4', () => {
  const root = scratchRepo('cf-l4');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const seeded = brain.upsertFindings(
    [{ check: 'judged', rung: 'L4', severity: 'warning', message: 'a model judge raised this' }], { stage: 'verify' });
  // Drive the REAL door. Going through upsertFindings directly would now be refused by the
  // PRODUCT-64 guard, and this test would pass while saying nothing about the L4 rule.
  let msg = '';
  try {
    brain.dispositionFinding(seeded.ids[0], 'fixed', 'Ada Lovelace', 'a stated reason', 'L4');
  } catch (err) { msg = err.message; }
  assert(/L4 \(model judge\) finding cannot be dispositioned by L4/.test(msg),
    `a model judge closed its own finding — got: ${msg || '(no error)'}`);
});

test('PRODUCT-64: a stage artifact cannot close its own finding', () => {
  const root = scratchRepo('cf-selfclose');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertFindings([{ check: 'evidence-class-unread-sys_script', rung: 'L1', severity: 'blocking', message: 'no logic body was read' }], { stage: 'explain' });
  // Exactly the shape run 6ef14f5562 shipped: disposition set from the artifact, no reason.
  const r = brain.upsertFindings([{
    check: 'evidence-class-unread-sys_script', rung: 'L1', severity: 'blocking', message: 'no logic body was read',
    disposition: 'accepted', dispositionBy: 'snbrain-verify (checker)',
  }], { stage: 'verify' });
  assertEqual(r.rejections.length, 1, 'a stage closed its own blocking finding from its artifact');
  assert(/snbrain disposition --finding/.test(r.rejections[0]), 'the rejection does not name the one legal door');
  assert(/--rung/.test(r.rejections[0]), 'the rejection does not mention --rung, so the honest L1 route is undiscoverable');
  assertEqual(brain.openBlockingFindings().length, 1, 'the finding was closed anyway');
});

test('PRODUCT-64: a smuggled disposition is STRIPPED, and the finding is still recorded open', () => {
  /*
   * An earlier version did `continue` on the smuggle path, discarding the row entirely — so any
   * caller that ignores `rejections` would silently LOSE a blocking finding, which is the exact
   * failure class this guard exists to prevent, arriving through a different door.
   */
  const root = scratchRepo('cf-selfclose-keep');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const r = brain.upsertFindings([{
    check: 'domain-separation', rung: 'L1', severity: 'blocking', message: 'a permanent instance fact',
    disposition: 'accepted', dispositionBy: 'snbrain-verify (checker)',
  }], { stage: 'verify' });
  assertEqual(r.rejections.length, 1, 'the smuggled disposition was accepted');
  const all = [...brain.findings().values()];
  assertEqual(all.length, 1, 'the finding was dropped entirely rather than recorded open');
  assertEqual(all[0].disposition, 'open', 'the smuggled disposition survived the strip');
  assertEqual(all[0].dispositionBy, null, 'the smuggled attribution survived the strip');
  assertEqual(brain.openBlockingFindings().length, 1, 'a blocking finding vanished on the smuggle path');
});

test('PRODUCT-64: the finding schema forbids the four disposition keys', () => {
  const f = STAGE_BY_ID.get('census').schema.props.findings.items;
  for (const key of ['disposition', 'dispositionBy', 'dispositionRung', 'dispositionReason']) {
    assert((f.forbidden || []).includes(key), `FINDING_SCHEMA.forbidden is missing ${key}, so an artifact can still smuggle it`);
    assert(!(f.props || {})[key], `FINDING_SCHEMA still declares ${key} as a settable prop`);
  }
});

test('PRODUCT-65: a blocking finding may not be closed at L5 by the agent naming itself', () => {
  const root = scratchRepo('cf-selfsign');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const r = brain.upsertFindings([{ check: 'domain-separation', rung: 'L1', severity: 'blocking', message: 'a permanent fact about the instance' }], { stage: 'census' });
  // The five names this product actually signed with on run 6ef14f5562, plus its siblings.
  for (const by of ['orchestrator (explain retry, verified at ingest)', 'snbrain-verify (checker)', 'the agent', 'Claude', 'cli:explain']) {
    let msg = '';
    try { brain.dispositionFinding(r.ids[0], 'accepted', by, 'a stated reason'); } catch (err) { msg = err.message; }
    assert(/names the agent, not a person/.test(msg), `"${by}" closed a blocking finding at L5 — got: ${msg || '(no error)'}`);
  }
  assertEqual(brain.openBlockingFindings().length, 1, 'a self-signed closure went through');
  // A person closes it; and the same name at a lower rung is fine, because L1/L2/L3 asserts a
  // replayed read rather than a human's acceptance.
  brain.dispositionFinding(r.ids[0], 'accepted', 'the developer', 'instance property, accepted by the owner');
  assertEqual(brain.openBlockingFindings().length, 0, 'a named human could not close it');
});

test('PRODUCT-65: a warning may still be closed by the CLI, and blocking at a lower rung too', () => {
  const root = scratchRepo('cf-selfsign-ok');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const w = brain.upsertFindings([{ check: 'spend-discrepancy', rung: 'L1', severity: 'warning', message: 'the counts disagree' }], { stage: 'census' });
  brain.dispositionFinding(w.ids[0], 'fixed', 'cli:reconcileSpend', 'recomputed from the request log');
  const b = brain.upsertFindings([{ check: 'evidence-class-unread-sys_script', rung: 'L1', severity: 'blocking', message: 'no body was read' }], { stage: 'explain' });
  brain.dispositionFinding(b.ids[0], 'fixed', 'cli:explain', 'the class was read on the retry; 14 bodies now in the ledger', 'L1');
  assertEqual(brain.openBlockingFindings().length, 0, 'an L1 re-derivation could not close a blocking finding');
});

test('not-demonstrated blocks success exactly as fail does', () => {
  const root = scratchRepo('cf-outcome');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.recordOutcome({ stage: 'preflight', id: 'AC-PRE-3', result: 'not-demonstrated' });
  assert(brain.successBlockers().some((b) => /not-demonstrated|not passing/.test(b)),
    'not-demonstrated did not block success');
});

test('a claim id is a content hash, so re-ingesting the same fact is idempotent', () => {
  const root = scratchRepo('cf-claimid');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const claim = { locus: { table: 'sys_script', sysId: 'abc123' }, assertion: 'active = true', status: 'draft' };
  const a = brain.upsertClaims([claim], { stage: 'harvest' });
  const b = brain.upsertClaims([claim], { stage: 'harvest' });
  assertEqual(a.ids[0], b.ids[0], 'the same fact produced two different claim ids');
  assertEqual(brain.claims().size, 1, 're-ingesting one fact produced two ledger entries');
  assertEqual(b.added, 0, 'a re-ingest counted as an addition');
});

test('a claim leaving draft counts as exactly one resolution', () => {
  const root = scratchRepo('cf-resolution');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const locus = { table: 'sys_script', sysId: 'abc123' };
  brain.upsertClaims([{ locus, assertion: 'active = true', status: 'draft' }], { stage: 'harvest' });
  const r = brain.upsertClaims([{ locus, assertion: 'active = true', status: 'verified' }], { stage: 'verify' });
  assertEqual(r.resolutions.length, 1, 'draft -> verified did not count as a resolution');
  const again = brain.upsertClaims([{ locus, assertion: 'active = true', status: 'verified' }], { stage: 'verify' });
  assertEqual(again.resolutions.length, 0, 'verified -> verified counted as a resolution');
});

test('a draft claim blocks terminal success', () => {
  const root = scratchRepo('cf-draft');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's' }, assertion: 'a', status: 'draft' }], { stage: 'harvest' });
  assert(brain.successBlockers().some((b) => /draft/.test(b)), 'a draft claim did not block success');
});

test('the budget ceiling terminates the run as exhausted', () => {
  const root = scratchRepo('cf-budget');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, maxCalls: 10 });
  const v = brain.recordIteration('preflight', { accepted: true, progress: true, apiCalls: 11, spendSource: 'request-log' });
  assertEqual(v.terminal, 'exhausted', 'exceeding the budget did not exhaust the run');
});

test('two consecutive zero-resolution iterations stall the run', () => {
  const root = scratchRepo('cf-stall');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.recordIteration('verify', { accepted: true, progress: true, resolutions: 0, stagnationMode: 'resolutions', apiCalls: 1, spendSource: 'request-log' });
  const v = brain.recordIteration('verify', { accepted: true, progress: false, resolutions: 0, stagnationMode: 'resolutions', apiCalls: 1, spendSource: 'request-log' });
  assertEqual(v.terminal, 'stalled', 'two zero-resolution iterations did not stall the run');
});

test('PRODUCT-14: a per-stage bound does not fire on the iteration that LEAVES the stage', () => {
  /*
   * The exact shape that stranded the reference run: a stage sitting on its ceiling, finishing
   * correctly. The bound exists to catch going round in circles; the step that stops circling
   * is the one step it must not punish.
   */
  const root = scratchRepo('cf-leaving');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, runawayCeiling: 3 });
  brain.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: false });
  brain.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: false });
  const staying = brain.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: false });
  assertEqual(staying.terminal, 'exhausted', 'the ceiling did not fire for a stage that was staying put');

  const root2 = scratchRepo('cf-leaving-2');
  const brain2 = Brain.init({ root: root2, instance: 'x', stageOrder: STAGE_ORDER, runawayCeiling: 3 });
  brain2.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: false });
  brain2.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: false });
  const leaving = brain2.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 1, spendSource: 'request-log', leavingStage: true });
  assertEqual(leaving.terminal, null,
    'PRODUCT-14: the stage was stranded `exhausted` on the very iteration that finished it');
});

test('the budget ceiling still fires even on the iteration that leaves a stage', () => {
  const root = scratchRepo('cf-leaving-budget');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, maxCalls: 10 });
  const v = brain.recordIteration('harvest', { accepted: true, progress: true, apiCalls: 50, spendSource: 'request-log', leavingStage: true });
  assertEqual(v.terminal, 'exhausted', 'an external cost stopped applying because the cursor happened to be moving on');
});

test('PRODUCT-3: a queue-driven stage gets a ceiling that can count its own queue', () => {
  const ctx = fakeCtx({ state: { queue: { harvestAreas: new Array(19).fill(0).map((_, i) => `area-${i}`), harvestDone: [] } } });
  const ceiling = STAGE_BY_ID.get('harvest').ceiling(ctx);
  assert(ceiling >= 19, `19 areas against a ceiling of ${ceiling}: the stage cannot finish its own queue`);
  assertEqual(STAGE_BY_ID.get('harvest').ceiling(fakeCtx({ state: { queue: { harvestAreas: [] } } })), null,
    'with no queue the stage should defer to the run-wide default rather than inventing one');
});

test('2.4: the staleness horizon is READ, so a verified claim is not verified forever', () => {
  /*
   * `staleAfter` was written on every verified claim and consulted by nothing. Fine on a single
   * run where every claim is minutes old; wrong the moment a brain is updated incrementally,
   * because the second run inherits the first run's confidence about records that have had a
   * month to change underneath it.
   */
  const root = scratchRepo('cf-stale');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const mk = (sysId, staleAfter) => ({ locus: { table: 't', sysId }, assertion: 'a', band: 'A', status: 'verified', staleAfter });
  brain.upsertClaims([mk('fresh', '2099-01-01'), mk('stale', '2020-01-01'), mk('nohorizon', null)], { stage: 'verify' });
  brain.save('seed');

  const stale = stages.staleClaims(brain);
  assertEqual(stale.length, 1, 'the staleness horizon is still being written and never read');
  assertEqual(stale[0].locus.sysId, 'stale');

  // and it must actually keep the stage alive, or the horizon is advisory again
  const ctx = { brain, state: brain.state, stage: 'verify' };
  assertEqual(STAGE_BY_ID.get('verify').next(ctx), 'verify', 'a stale claim did not hold verify open');

  assertIncludes(cli(['status', '--root', root]).stdout, 'past their staleness horizon', 'status does not surface stale claims');
  assertEqual(cliJson(['status', '--root', root]).json.staleClaims, 1, 'the machine-readable status omits the stale count');
});

test('2.4: verify still has to settle EVERY claim — staleness does not license sampling', () => {
  const root = scratchRepo('cf-no-sampling');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 'd' }, assertion: 'a', band: 'A', status: 'draft' }], { stage: 'harvest' });
  assert(brain.successBlockers().some((b) => /draft/.test(b)),
    'an unsettled claim stopped blocking handoff — sampling would make the ledger a survey rather than a record');
});

test('an override is attributed or it is refused', () => {
  const root = scratchRepo('cf-override');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  let threw = false;
  try { brain.override('budget', 9999); } catch (err) { threw = true; }
  assert(threw, 'an unattributed override was accepted');
  const r = brain.override('budget', 9999, 'a named operator', 'a stated reason');
  assertEqual(r.to, 9999);
  assertEqual(brain.state.overrides.length, 1, 'the override was not recorded');
});

test('a disposition without a name and a reason is refused', () => {
  const root = scratchRepo('cf-disposition');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const r = brain.upsertFindings([{ check: 'permanent', rung: 'L1', severity: 'blocking', message: 'a fact about the instance' }], { stage: 'census' });
  let threw = false;
  try { brain.dispositionFinding(r.ids[0], 'accepted'); } catch (err) { threw = true; }
  assert(threw, 'an unattributed disposition closed a blocking finding');
  brain.dispositionFinding(r.ids[0], 'accepted', 'a named operator', 'a stated reason');
  assertEqual(brain.openBlockingFindings().length, 0, 'an attributed disposition did not close the finding');
});

test('PRODUCT-19: honesty about spend is not punished, but silence and contradiction are', () => {
  /*
   * The old rule counted `self-reported` as spend-unknown, so a stage that read the instance
   * and truthfully said "120 calls" with no log to hand blocked terminal success forever,
   * while a stage claiming zero was classed `not-applicable` and cost nothing. The incentive
   * pointed exactly the wrong way.
   */
  const mk = (name) => Brain.init({ root: scratchRepo(name), instance: 'x', stageOrder: STAGE_ORDER });
  const blocks = (brain) => brain.successBlockers().some((b) => /spend/.test(b));

  const honest = mk('cf-spend-honest');
  honest.recordIteration('census', { accepted: true, progress: true, apiCalls: 120, spendSource: 'self-reported' });
  assert(!blocks(honest), 'an honest self-reported number still blocks success — honesty is the penalised option again');

  const measured = mk('cf-spend-measured');
  measured.recordIteration('census', { accepted: true, progress: true, apiCalls: 120, spendSource: 'request-log' });
  assert(!blocks(measured), 'a log-reconciled spend blocked success');

  const silent = mk('cf-spend-silent');
  silent.recordIteration('census', { accepted: true, progress: true, apiCalls: null, spendSource: 'unknown' });
  assert(blocks(silent), 'a stage that could not say what it spent did NOT block success');

  const contradicted = mk('cf-spend-discrepancy');
  contradicted.recordIteration('census', { accepted: true, progress: true, apiCalls: 400, spendSource: 'discrepancy' });
  assert(blocks(contradicted), 'a self-report the request log contradicts did NOT block success');
});

test('the handoff chain is unbroken: a blocking finding stops finish, and no success stops export', () => {
  /*
   * The two halves have to hold together or the gate is theatre. `finish --terminal success`
   * refuses while a blocking finding is open, and `export` refuses anything that is not
   * terminal success — so there is no path from an open blocker to a shipped repo that does
   * not pass through an attributed --force.
   */
  const root = scratchRepo('cf-handoff-chain');
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.upsertFindings([{ check: 'evidence-class-unread-sys_script', rung: 'L1', severity: 'blocking', message: 'no logic body was read on sys_script' }], { stage: 'explain' });
  brain.save('seed');

  const finish = cli(['finish', '--terminal', 'success', '--by', 'a named operator', '--root', root]);
  assert(finish.code !== 0, 'finish marked a run successful with a blocking finding open');
  assertIncludes(finish.stderr, 'evidence-class-unread', 'the refusal did not name the blocker');

  const exported = cli(['export', '--to', path.join(SCRATCH, 'out-chain'), '--root', root]);
  assert(exported.code !== 0, 'export shipped a run that finish had refused to call successful');
});

test('every terminal state the engine can set is in the closed vocabulary', () => {
  const root = scratchRepo('cf-terminal');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  let threw = false;
  try { brain.setTerminal('mostly-working', 'not a real state'); } catch (err) { threw = true; }
  assert(threw, 'an invented terminal state was accepted');
  assert(TERMINAL_STATES.includes('success') && TERMINAL_STATES.includes('no-op'), 'the terminal vocabulary lost a member');
});

// ===========================================================================
// E — export policy. An allowlist entry silently cancelled by a deny pattern is
//     the worst shape this pair can take, because both lists read as correct.
// ===========================================================================

group('E. export policy');

/**
 * An engagement repo with one file per interesting policy case. Terminal defaults to
 * `success` because export now REFUSES anything else — the policy tests are about which
 * files travel, and they should not be silently passing for the wrong reason.
 */
function putFile(root, rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body === undefined ? '{}\n' : body);
}

/**
 * The SMALLEST tree that is fit for handoff under the 2026-09-02 rules: three identical kernel
 * mirrors carrying the `.claude/skills/` route, a wired hook that exists, one routable build
 * skill, the required wiki pages, the read-only proof at its stable name, and the ledgers.
 * Every handoff test starts here and breaks ONE thing.
 */
function fitTree(root) {
  const kernel = '# kernel\n\nBuild procedures live in `.claude/skills/` — their descriptions route themselves.\n\n| Need | Open |\n|---|---|\n| Entry point | `docs/wiki/index.md` |\n';
  putFile(root, 'CLAUDE.md', kernel);
  putFile(root, '.github/copilot-instructions.md', kernel);
  putFile(root, 'AGENTS.md', kernel);
  putFile(root, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/guard.js' }] }] } }, null, 2) + '\n');
  putFile(root, '.claude/hooks/guard.js', "'use strict';\nprocess.exit(0);\n");
  putFile(root, '.claude/skills/business-rule-patterns/SKILL.md', '---\nname: business-rule-patterns\ndescription: Invoke when the user asks to "create a business rule", "before insert" or "after update".\n---\n\n# a build skill — PAYLOAD\n');
  putFile(root, 'docs/wiki/index.md', '---\ntitle: "Wiki index"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# index\n');
  putFile(root, 'docs/wiki/registry-sys-ids.md', '---\ntitle: "sys_id Registry"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# the brain\n');
  putFile(root, 'docs/wiki/evidence/read-only-proof.md', '---\ntitle: "Read-only proof"\nstatus: "probe-backed"\nclaims-rendered: 0\n---\n\n# proof\n');
  putFile(root, 'docs/wiki/evidence/read-only-proof/snbrain-requests.ndjson', '{"phase":"sent","command":"check_connection","instance":"selftest-instance","params":{}}\n');
  putFile(root, 'kernel/CLAUDE.template.md', '# template\n');
  putFile(root, 'tools/render-kernel.js', '// stub — the real one is copied by the installer\n');
  putFile(root, '.brain/claims.jsonl', '{"id":"C-1"}\n');
  putFile(root, '.brain/decisions.jsonl', '{"id":"DEC-1"}\n');
  putFile(root, '.brain/index/claim-decisions.json', '{"index":{}}\n');
  return root;
}

function exportFixture(name, terminal) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  const t = terminal === undefined ? 'success' : terminal;
  if (t) { brain.state.terminal = t; brain.state.terminalBy = 'selftest'; brain.save('terminal'); }
  fitTree(root);
  const put = (rel, body) => putFile(root, rel, body);
  put('.claude/skills/snbrain-census/SKILL.md', '# a stage skill — THE MACHINE\n');
  put('.claude/skills/map-process/SKILL.md', '# the seeded orchestrator — THE MACHINE\n');
  put('.claude/commands/map-instance.md', '# drives the loop\n');
  put('docs/rework-plan.md', '# design of record\n');
  put('docs/build-log/ISSUES.md', '# the product defect register\n');
  put('.brain/in/harvest.json', '{"stage":"harvest"}\n');
  put('.brain/raw/harvest.ndjson', '{}\n');
  return { root, brain };
}

/** Parse `export --dry-run` output into the set of paths it says would ship. */
function dryRunShips(root) {
  const to = path.join(SCRATCH, 'never-written-' + path.basename(root));
  const r = cli(['export', '--to', to, '--root', root, '--dry-run']);
  assert(!fs.existsSync(to), 'a --dry-run export wrote files to disk');
  return { code: r.code, text: r.stdout + r.stderr };
}

test('.brain/index ships — the allowlist names it and no deny pattern may cancel it', () => {
  const { root } = exportFixture('exp-index');
  const to = path.join(SCRATCH, 'out-index');
  const r = cli(['export', '--to', to, '--root', root]);
  assertEqual(r.code, 0, `export failed:\n${r.stdout}${r.stderr}`);
  assert(fs.existsSync(path.join(to, '.brain', 'index', 'claim-decisions.json')),
    'PRODUCT-22: .brain/index was withheld. The deny alternation "in" matched the first two ' +
    'characters of "index" with no boundary, silently cancelling an explicit allowlist entry.');
});

test('the loop itself does not ship', () => {
  const { root } = exportFixture('exp-machine');
  const to = path.join(SCRATCH, 'out-machine');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  for (const rel of ['.claude/skills/snbrain-census/SKILL.md', '.claude/skills/map-process/SKILL.md', '.claude/commands/map-instance.md',
    'docs/rework-plan.md', 'docs/build-log/ISSUES.md', '.brain/state.json', '.brain/in/harvest.json',
    '.brain/raw/harvest.ndjson']) {
    assert(!fs.existsSync(path.join(to, rel)), `"${rel}" shipped to the customer and must not have`);
  }
});

test('the build skills — the actual payload — do ship', () => {
  const { root } = exportFixture('exp-payload');
  const to = path.join(SCRATCH, 'out-payload');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  for (const rel of ['CLAUDE.md', '.claude/settings.json', '.claude/skills/business-rule-patterns/SKILL.md',
    'docs/wiki/registry-sys-ids.md', '.brain/claims.jsonl', '.brain/decisions.jsonl']) {
    assert(fs.existsSync(path.join(to, rel)), `"${rel}" did not ship, and it is the deliverable`);
  }
});

test('PRODUCT-20/23: the exported ledger is compacted to one row per record, losslessly', () => {
  const { root } = exportFixture('exp-compact');
  // Append-only reality: the same claim written once by harvest and again by verify.
  const claims = path.join(root, '.brain', 'claims.jsonl');
  fs.writeFileSync(claims, [
    JSON.stringify({ id: 'C-aaa', status: 'draft', assertion: 'a', evidence: { capturedResponse: { x: 'a'.repeat(500) } } }),
    JSON.stringify({ id: 'C-bbb', status: 'draft', assertion: 'b', evidence: { capturedResponse: { x: 'b'.repeat(500) } } }),
    JSON.stringify({ id: 'C-aaa', status: 'verified', assertion: 'a', evidence: { capturedResponse: { x: 'a'.repeat(500) } } }),
    JSON.stringify({ id: 'C-bbb', status: 'verified', assertion: 'b', evidence: { capturedResponse: { x: 'b'.repeat(500) } } }),
  ].join('\n') + '\n');

  const to = path.join(SCRATCH, 'out-compact');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  const lines = fs.readFileSync(path.join(to, '.brain', 'claims.jsonl'), 'utf8').trim().split('\n');
  assertEqual(lines.length, 2, 'the exported ledger still carries one line per claim per stage');

  // Lossless for every consumer: the last row is the one _ledger() takes.
  const byId = new Map(lines.map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  assertEqual(byId.get('C-aaa').status, 'verified', 'compaction kept a superseded row instead of the current one');
  assertEqual(byId.get('C-bbb').status, 'verified');

  const manifest = JSON.parse(fs.readFileSync(path.join(to, 'EXPORT-MANIFEST.json'), 'utf8'));
  assertEqual(manifest.compaction['.brain/claims.jsonl'].linesBefore, 4, 'the manifest does not record what compaction did');
  assertEqual(manifest.compaction['.brain/claims.jsonl'].linesAfter, 2);
  assert(manifest.compaction['.brain/claims.jsonl'].bytesAfter < manifest.compaction['.brain/claims.jsonl'].bytesBefore,
    'compaction did not actually reduce the shipped size');
});

test('the compacted ledger keeps the path the wiki cites', () => {
  const { root } = exportFixture('exp-compact-path');
  const to = path.join(SCRATCH, 'out-compact-path');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  assert(fs.existsSync(path.join(to, '.brain', 'claims.jsonl')),
    'the ledger moved or was renamed — rendered pages cite this exact path, and evidence at a filename nothing links to is the defect being reduced, not a smaller version of it');
});

test('a dry run writes nothing and reports both sides of the screen', () => {
  const { root } = exportFixture('exp-dry');
  const r = dryRunShips(root);
  assertIncludes(r.text, 'would ship', 'dry run did not report what would ship');
  assertIncludes(r.text, 'withheld', 'dry run did not report what was withheld');
});

test('PRODUCT-24: export REFUSES a run that never reached a terminal state', () => {
  const { root } = exportFixture('exp-gate-null', null);
  const to = path.join(SCRATCH, 'out-gate-null');
  const r = cli(['export', '--to', to, '--root', root]);
  assert(r.code !== 0, 'export of a non-terminal run exited 0');
  assert(!fs.existsSync(path.join(to, 'CLAUDE.md')),
    'PRODUCT-24: a run whose own manifest would say handoffPermitted:false still shipped its files');
  assertIncludes(r.stderr, 'Only "success" permits handoff', 'the refusal did not cite the rule it enforces');
});

test('the refusal names what would clear it', () => {
  const { root, brain } = exportFixture('exp-gate-why', null);
  brain.recordOutcome({ stage: 'preflight', id: 'AC-PRE-3', result: 'fail' });
  brain.save('outcome');
  const r = cli(['export', '--to', path.join(SCRATCH, 'out-gate-why'), '--root', root]);
  assertIncludes(r.stderr, 'AC-PRE-3', 'the refusal did not name the failing acceptance id');
});

test('export refuses a terminal state that is not success, not merely a null one', () => {
  const { root } = exportFixture('exp-gate-blocked', 'blocked');
  const r = cli(['export', '--to', path.join(SCRATCH, 'out-gate-blocked'), '--root', root]);
  assert(r.code !== 0, 'export of a `blocked` run exited 0');
});

test('--force without attribution is refused', () => {
  const { root } = exportFixture('exp-force-anon', null);
  const r = cli(['export', '--to', path.join(SCRATCH, 'out-force-anon'), '--root', root, '--force']);
  assert(r.code !== 0, 'an unattributed forced export was allowed');
  assertIncludes(r.stderr, '--by', 'the refusal did not ask for attribution');
});

test('a forced export ships, and stamps the KERNEL so the next reader learns it from the repo', () => {
  const { root } = exportFixture('exp-force-ok', null);
  const to = path.join(SCRATCH, 'out-force-ok');
  const r = cli(['export', '--to', to, '--root', root, '--force', '--by', 'a named operator', '--reason', 'showing a partial repo to the customer']);
  assertEqual(r.code, 0, `a properly attributed forced export failed:\n${r.stdout}${r.stderr}`);
  const kernel = fs.readFileSync(path.join(to, 'CLAUDE.md'), 'utf8');
  assertIncludes(kernel, 'NOT FIT FOR HANDOFF', 'the forced export did not stamp the kernel');
  assertIncludes(kernel, 'a named operator', 'the kernel banner does not name who forced it');
  assertIncludes(kernel, 'showing a partial repo', 'the kernel banner does not carry the stated reason');
  const manifest = JSON.parse(fs.readFileSync(path.join(to, 'EXPORT-MANIFEST.json'), 'utf8'));
  assertEqual(manifest.handoffPermitted, false, 'a forced export claimed handoff was permitted');
  assert(manifest.forced && manifest.forced.by === 'a named operator', 'the manifest did not record the override');
});

test('a clean success export carries no banner', () => {
  const { root } = exportFixture('exp-clean');
  const to = path.join(SCRATCH, 'out-clean');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  const kernel = fs.readFileSync(path.join(to, 'CLAUDE.md'), 'utf8');
  assert(!/NOT FIT FOR HANDOFF/.test(kernel), 'a clean handoff was stamped as unfit');
  assertEqual(JSON.parse(fs.readFileSync(path.join(to, 'EXPORT-MANIFEST.json'), 'utf8')).handoffPermitted, true);
});

// ===========================================================================
// F — the explain stage. The one that decides whether the deliverable can say
//     what anything DOES, so its validator gets the most attention here.
// ===========================================================================

group('F. explain');

const RULE_BODY = "(function executeRule(current, previous) {\n  current.setValue('is_sensitive', true);\n})(current, previous);";

/** A brain whose ledger already holds harvested loci, as it would after harvest. */
function explainCtx(name, claims) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.upsertClaims(claims, { stage: 'harvest' });
  return { brain, state: brain.state, stage: 'explain', root };
}

function harvested(table, sysId, band, name) {
  return {
    locus: { table, sysId }, assertion: `active = true (${sysId})`, band: band || 'A', status: 'draft',
    evidence: { query: `sys_idIN${sysId}`, fields: 'sys_id,name,active', capturedAt: '2026-08-11T00:00:00Z',
      capturedResponse: { sys_id: sysId, name: name || 'A record', active: 'true' },
      guards: { fields: 'validated', identityCanary: 'pass' } },
  };
}

/** A well-formed behaviour claim, which individual tests then break in one specific way. */
function behaviourClaim(over) {
  return deepMerge({
    locus: { table: 'sys_script', sysId: 'aaaa1111', field: 'script' },
    assertion: 'Sets is_sensitive to true on incidents whose category is qrt and whose state is 0 or 6.',
    band: 'A',
    behaviour: { bodyField: 'script', bodyEmpty: false, bodyLength: RULE_BODY.length, excerpt: "current.setValue('is_sensitive', true);", trigger: 'category=qrt^stateIN0,6' },
    evidence: {
      query: 'sys_idINaaaa1111', fields: 'sys_id,name,script,condition', capturedAt: '2026-08-11T09:00:00Z',
      capturedResponse: { sys_id: 'aaaa1111', name: 'ACME QRT Set Sensitive', script: RULE_BODY, condition: 'category=qrt^stateIN0,6' },
      guards: { fields: 'validated', identityCanary: 'pass' },
    },
  }, over || {});
}

const EXPLAIN = STAGE_BY_ID.get('explain');

/** Run explain's validator over an artifact, against a ledger holding one sys_script locus. */
function explainReject(name, artifact, extraClaims) {
  const ctx = explainCtx(name, (extraClaims || []).concat([harvested('sys_script', 'aaaa1111', 'A', 'ACME QRT Set Sensitive')]));
  return EXPLAIN.validate(ctx, artifact);
}

const COV_OK = { candidatesRead: 1, bodiesReturned: 1, bodiesEmpty: 0, truncated: false };

test('harvest routes to explain once its areas are done', () => {
  const ctx = fakeCtx({ state: { queue: { harvestAreas: ['a'], harvestDone: ['a'] } } });
  assertEqual(STAGE_BY_ID.get('harvest').next(ctx), 'explain', 'harvest still routes straight to verify');
  assertEqual(STAGE_ORDER.indexOf('explain'), STAGE_ORDER.indexOf('harvest') + 1, 'explain is not between harvest and verify');
  assertEqual(STAGE_ORDER.indexOf('verify'), STAGE_ORDER.indexOf('explain') + 1, 'explain is not before verify');
});

test('candidates are ranked band A first, then by evidence density, and capped', () => {
  const ctx = explainCtx('exp-rank', [
    harvested('sys_script', 'bbbb2222', 'B', 'A modified OOTB rule'),
    harvested('sys_script', 'aaaa1111', 'A', 'A customer rule'),
    { locus: { table: 'sys_script', sysId: 'aaaa1111', field: 'order' }, assertion: 'order = 100', band: 'A', status: 'draft',
      evidence: { query: 'q', fields: 'f', capturedAt: '2026-08-11T00:00:00Z', capturedResponse: { sys_id: 'aaaa1111' }, guards: { fields: 'validated', identityCanary: 'pass' } } },
  ]);
  const c = stages.explainCandidates(ctx);
  assertEqual(c.ranked.length, 2, 'expected two distinct loci');
  assertEqual(c.ranked[0].sysId, 'aaaa1111', 'band A did not rank first');
  assertEqual(c.ranked[0].claims, 2, 'evidence density was not accumulated per locus');
  ctx.state.config.explainCap = 1;
  const capped = stages.explainCandidates(ctx);
  assertEqual(capped.ranked.length, 1, 'the cap was not applied');
  assertEqual(capped.overflow.length, 1, 'what the cap dropped was not reported as overflow');
});

test('a table with no readable body is separated out, never silently counted as read', () => {
  const ctx = explainCtx('exp-unreadable', [harvested('sys_hub_flow', 'ffff9999', 'A', 'A flow')]);
  const c = stages.explainCandidates(ctx);
  assertEqual(c.ranked.length, 0, 'a flow was ranked for a body read it cannot serve');
  assertEqual(c.unreadable.length, 1, 'the flow was dropped entirely instead of being reported unreadable');
});

test('a grounded behaviour claim is accepted', () => {
  const rej = explainReject('exp-ok', { claims: [behaviourClaim()], coverage: COV_OK });
  assertEqual(rej.length, 0, `a well-formed behaviour claim was rejected:\n  ${rej.join('\n  ')}`);
});

test('an excerpt that is not a verbatim substring of the captured body is refused', () => {
  const rej = explainReject('exp-ungrounded', {
    claims: [behaviourClaim({ behaviour: { excerpt: "current.setValue('is_confidential', true);" } })], coverage: COV_OK,
  });
  assertIncludes(rej.join(' '), 'verbatim substring', 'an ungrounded excerpt was accepted');
});

test('a claim asserting behaviour with no body in its evidence is refused', () => {
  const c = behaviourClaim();
  delete c.evidence.capturedResponse.script;
  const rej = explainReject('exp-nobody', { claims: [c], coverage: COV_OK });
  assertIncludes(rej.join(' '), 'carries no', 'behaviour was asserted without the body being in the evidence');
});

test('an assertion under eight words is refused as a label', () => {
  const rej = explainReject('exp-short', {
    claims: [behaviourClaim({ assertion: 'Business rule on the incident table.' })], coverage: COV_OK,
  });
  assertIncludes(rej.join(' '), 'under 8 words', 'a label passed as a behaviour');
});

test('an assertion that restates the record name is refused', () => {
  const rej = explainReject('exp-restate', {
    claims: [behaviourClaim({ assertion: 'This is the ACME QRT Set Sensitive business rule, ACME QRT set sensitive.' })], coverage: COV_OK,
  });
  assertIncludes(rej.join(' '), 'restates', 'an assertion that only echoes the name was accepted');
});

test('a disclaimer is not a behaviour', () => {
  const rej = explainReject('exp-disclaimer', {
    claims: [behaviourClaim({ assertion: 'Purpose implied by name and callers; no script body was read for this record.' })], coverage: COV_OK,
  });
  assertIncludes(rej.join(' '), 'disclaimer', 'a disclaimer was accepted in place of a reading');
});

test('bodyEmpty and an excerpt cannot both be true', () => {
  const rej = explainReject('exp-contradiction', {
    claims: [behaviourClaim({ behaviour: { bodyEmpty: true } })], coverage: { candidatesRead: 1, bodiesReturned: 0, bodiesEmpty: 1 },
  });
  assertIncludes(rej.join(' '), 'bodyEmpty', 'a claim marked empty while quoting a body was accepted');
});

test('a locus outside the ranked set is refused', () => {
  const rej = explainReject('exp-wander', {
    claims: [behaviourClaim({ locus: { table: 'sys_script', sysId: 'not-a-candidate' } })], coverage: COV_OK,
  });
  assertIncludes(rej.join(' '), 'not in the ranked candidate set', 'the stage wandered off its candidate list');
});

test('a candidate that is neither claimed nor dropped is refused', () => {
  const rej = explainReject('exp-unaccounted', { claims: [], coverage: { candidatesRead: 0, bodiesReturned: 0, bodiesEmpty: 0 } });
  assertIncludes(rej.join(' '), 'neither claimed nor dropped', 'a candidate vanished with no record');
});

test('reading candidates and getting nothing back at all is refused, not reported as empty', () => {
  const rej = explainReject('exp-silence', {
    claims: [], coverage: { candidatesRead: 5, bodiesReturned: 0, bodiesEmpty: 0 },
    dropped: [{ table: 'sys_script', sysId: 'aaaa1111', reason: 'nothing came back' }],
  });
  assertIncludes(rej.join(' '), 'broken session', 'total silence from the transport was accepted as a result');
});

test('a table whose bodies all went unread mints a BLOCKING finding', () => {
  const ctx = explainCtx('exp-blocking', [harvested('sys_script', 'aaaa1111', 'A', 'A rule')]);
  const result = EXPLAIN.apply(ctx, {
    claims: [], coverage: { candidatesRead: 1, bodiesReturned: 0, bodiesEmpty: 1 },
    dropped: [{ table: 'sys_script', sysId: 'aaaa1111', reason: 'body came back empty' }],
  });
  const blocking = (result.findings || []).filter((f) => f.severity === 'blocking');
  assertEqual(blocking.length, 1, 'no blocking finding was minted for a wholly unread evidence class');
  assertIncludes(blocking[0].check, 'evidence-class-unread', 'the finding is not the evidence-class-unread class');
  // and it must actually block, not merely exist
  ctx.brain.upsertFindings(result.findings, { stage: 'explain' });
  assert(ctx.brain.successBlockers().some((b) => /blocking/.test(b)),
    'the finding was minted but did not block terminal success — which is the whole point');
});

test('reading the bodies clears the blocking finding for that table', () => {
  const ctx = explainCtx('exp-nonblocking', [harvested('sys_script', 'aaaa1111', 'A', 'ACME QRT Set Sensitive')]);
  const result = EXPLAIN.apply(ctx, { claims: [behaviourClaim()], coverage: COV_OK });
  assertEqual((result.findings || []).filter((f) => f.severity === 'blocking').length, 0,
    'a table whose bodies WERE read still minted a blocking finding');
});

test('an unreadable table is a warning about the transport, not a blocking finding', () => {
  const ctx = explainCtx('exp-flow-warn', [harvested('sys_hub_flow', 'ffff9999', 'A', 'A flow')]);
  const result = EXPLAIN.apply(ctx, { claims: [], coverage: { candidatesRead: 0, bodiesReturned: 0, bodiesEmpty: 0 } });
  const warn = (result.findings || []).filter((f) => f.severity === 'warning');
  assertEqual(warn.length, 1, 'an unreadable-body table produced no finding at all, so silence reads as "no logic"');
  assertIncludes(warn[0].message, 'snapshot', 'the warning does not say why the body is unreadable');
});

test('the explain worked example survives its own VALIDATOR, not just its schema', () => {
  /*
   * Group B proves every example matches its schema. This proves the one example whose
   * validator is doing real semantic work — verbatim grounding, word count, name overlap,
   * candidate membership — is itself copyable. An example that passes the schema and fails
   * the validator is the expensive kind of wrong: it looks right until a live run rejects it.
   */
  const ex = EXPLAIN.example(fakeCtx({ stage: 'explain' }));
  const seeded = ex.claims.map((c) => harvested(c.locus.table, c.locus.sysId, c.band, c.evidence.capturedResponse.name));
  const ctx = explainCtx('exp-example', seeded);
  ctx.state.config.explainCap = 150;
  const rej = EXPLAIN.validate(ctx, ex);
  assertEqual(rej.length, 0, `the explain example fails its own validator:\n  ${rej.join('\n  ')}`);
});

test('behaviour claims enter the ledger as draft, so verify still has to settle them', () => {
  const ctx = explainCtx('exp-draft', [harvested('sys_script', 'aaaa1111', 'A', 'ACME QRT Set Sensitive')]);
  const result = EXPLAIN.apply(ctx, { claims: [behaviourClaim()], coverage: COV_OK });
  assertEqual(result.claims[0].status, 'draft', 'explain promoted its own claim');
  assertEqual(result.claims[0].kind, 'behaviour', 'the claim is not tagged as a behaviour claim');
});

test('6.7: an interpretation is minted at L3 — the rung that can actually close it', () => {
  const ctx = explainCtx('exp-rung', [harvested('sys_script', 'aaaa1111', 'A', 'ACME QRT Set Sensitive')]);
  const result = EXPLAIN.apply(ctx, { claims: [behaviourClaim()], coverage: COV_OK });
  assertEqual(result.claims[0].rung, 'L3',
    'a behaviour claim minted at L1 gets stamped verified by an L1 re-read of the bytes it interprets — run 93838afe87 did exactly that to all 150');
});

test('6.7: verify refuses to stamp an interpretation verified, and hashes the substrate instead', () => {
  /*
   * PRODUCT-89. Re-reading a script body confirms the body, never the sentence describing it:
   * lastVerdict.diff was null on all 19,353 of run 93838afe87's verdicts because a field always
   * equals itself, and a mis-read filter condition would have passed with the same green as
   * `label = Next scheduled`. The legal verdict re-reads the substrate and hands it over for
   * hashing, so a later run can see the script change underneath the sentence.
   */
  const ctx = explainCtx('ver-interp', [harvested('sys_script', 'aaaa1111', 'A', 'ACME QRT Set Sensitive')]);
  const minted = EXPLAIN.apply(ctx, { claims: [behaviourClaim()], coverage: COV_OK });
  const behaviourId = ctx.brain.upsertClaims(minted.claims, { stage: 'explain' }).ids[0];
  const VERIFY = STAGE_BY_ID.get('verify');
  const vctx = { brain: ctx.brain, state: ctx.brain.state, stage: 'verify' };
  const rej = VERIFY.validate(vctx, { verdicts: [{ claimId: behaviourId, status: 'verified', query: 'sys_idINaaaa1111', capturedAt: '2026-08-20T00:00:00Z' }] });
  assert(rej.some((m) => /BEHAVIOUR claim verified/.test(m) && /"interpretation"/.test(m)),
    `a behaviour claim was stamped verified by an L1 verb, and the rejection does not name the legal enum values:\n${rej.join('\n')}`);
  const rej2 = VERIFY.validate(vctx, { verdicts: [{ claimId: behaviourId, status: 'unverifiable', unverifiableReason: 'interpretation', query: 'sys_idINaaaa1111', capturedAt: '2026-08-20T00:00:00Z' }] });
  assert(rej2.some((m) => /no `observed` body/.test(m)),
    'an interpretation verdict without the re-read body was accepted — nothing to hash, so substrate drift is invisible forever');
  const verdict = { claimId: behaviourId, status: 'unverifiable', unverifiableReason: 'interpretation', query: 'sys_idINaaaa1111', capturedAt: '2026-08-20T00:00:00Z', observed: { script: RULE_BODY } };
  const rej3 = VERIFY.validate(vctx, { verdicts: [verdict] });
  assertEqual(rej3.filter((m) => /BEHAVIOUR claim verified|no `observed` body|plain field claim/.test(m)).length, 0,
    `the legal verdict is refused, so the guard has no cheapest legal answer:\n${rej3.join('\n')}`);
  const out = VERIFY.apply(vctx, { verdicts: [verdict] });
  assertEqual(out.claims[0].status, 'unverifiable');
  assert(out.claims[0].substrateHash && out.claims[0].substrateHash.length >= 12,
    `the substrate was not hashed, so a later run cannot detect the script changing under the sentence: ${JSON.stringify(out.claims[0].substrateHash)}`);
  // The cheapest dodge — skipping the re-query by calling a field claim an interpretation — is guarded.
  const plainId = ctx.brain.upsertClaims([harvested('sys_script', 'bbbb2222', 'A', 'plain record')], { stage: 'harvest' }).ids[0];
  const rej4 = VERIFY.validate(vctx, { verdicts: [{ claimId: plainId, status: 'unverifiable', unverifiableReason: 'interpretation', query: 'q', capturedAt: '2026-08-20T00:00:00Z' }] });
  assert(rej4.some((m) => /plain field claim/.test(m)),
    'an ordinary <field> = <value> claim took the interpretation reason, which is verification skipped at zero cost');
});

test('6.7: provenance survives the verdict, and identical evidence is not duplicated', () => {
  const root = scratchRepo('provenance');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const id = brain.upsertClaims([harvested('sys_script', 'cccc3333', 'A', 'a rule')], { stage: 'harvest' }).ids[0];
  brain.upsertClaims([Object.assign({}, brain.claims().get(id), { status: 'verified' })], { stage: 'verify' });
  const c = brain.claims().get(id);
  assertEqual(c.recordedByStage, 'harvest',
    'the verdict overwrote provenance — run 93838afe87 read `verify` on 19,353 of 19,360 rows and the ledger could not say which stage produced a single claim');
  assert(!c.priorEvidence,
    'unchanged evidence was duplicated into priorEvidence — a ledger reporting two observations while holding one, on all 60,922 verify-touched rows of run 5');
  const fresh = Object.assign({}, brain.claims().get(id));
  fresh.evidence = Object.assign({}, fresh.evidence, { capturedAt: '2026-08-21T00:00:00Z', capturedResponse: { sys_id: 'cccc3333', active: 'false' } });
  brain.upsertClaims([fresh], { stage: 'verify' });
  assert(brain.claims().get(id).priorEvidence,
    'a genuinely new capture no longer preserves the prior evidence — the immutability half was thrown out with the duplication');
});

// ===========================================================================
// G — the two accounting rules that let the reference run lose work silently.
// ===========================================================================

group('G. accounting');

function questionsCtx(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.stamps.scopeFilter = 'pass';
  brain.state.stamps.provenance = 'full';
  return { brain, state: brain.state, stage: 'questions' };
}

/** A minimal questions artifact whose gate arithmetic balances. */
function questionsArt(over) {
  const q = {
    signal: 'QS-02', signalState: 'admitted', gate: 'contradiction',
    sources: { A: { kind: 'claim', ref: 'x' }, B: { kind: 'cluster', ref: 'y' } },
    locus: [{ sysId: '7a029a06' }], form: 'closed', branchMap: { a: 'deliberate', b: 'unfinished' },
    question: 'This is a question long enough to satisfy the twenty-character minimum, is it (a) or (b)?',
    rank: { E: 1, C_guard: 1, C_signal: 0.5, A: 1, U: 1, M: 1 },
  };
  return deepMerge({
    questions: [q],
    suppressed: [{ gate: 'AW-1', reason: 'derivable from the platform default' }],
    counts: { candidates: 2, afterGates: 1, perGateKills: { 'AW-1': 1 } },
  }, over || {});
}

const QUESTIONS = STAGE_BY_ID.get('questions');

test('a balanced questions artifact is accepted', () => {
  const rej = QUESTIONS.validate(questionsCtx('acc-q-ok'), questionsArt());
  assertEqual(rej.length, 0, `a balanced artifact was rejected:\n  ${rej.join('\n  ')}`);
});

test('3.3: emitting fewer questions than survived the gates is refused', () => {
  // The reference run's exact shape: afterGates 16, ten emitted, six gone without trace.
  const rej = QUESTIONS.validate(questionsCtx('acc-q-short'), questionsArt({ counts: { candidates: 8, afterGates: 3, perGateKills: { 'AW-1': 5 } }, suppressed: new Array(5).fill({ gate: 'AW-1', reason: 'derivable' }) }));
  assertIncludes(rej.join(' '), 'Emit EVERY question that survived',
    'the model was allowed to apply the cap itself, so the surplus arrived with no id, no text and no reason');
});

test('3.3: gate kills that are not individually recorded are refused', () => {
  const rej = QUESTIONS.validate(questionsCtx('acc-q-sup'), questionsArt({ suppressed: [] }));
  assertIncludes(rej.join(' '), 'suppression(s) are recorded', 'a silent gate kill was accepted');
});

test('3.3: a per-gate distribution that does not add up is refused', () => {
  // 82 - 63 = 19 against a declared afterGates of 16 — three questions unaccounted for, and
  // nothing checked the arithmetic.
  const rej = QUESTIONS.validate(questionsCtx('acc-q-gates'), questionsArt({ counts: { candidates: 2, afterGates: 1, perGateKills: { 'AW-1': 0 } } }));
  assertIncludes(rej.join(' '), 'perGateKills sums to', 'the per-gate distribution was allowed not to account for every drop');
});

test('1.3: recurring domain words are mined, stopwords are not, and acronyms are flagged', () => {
  const root = scratchRepo('vocab-mine');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const named = (sysId, name) => ({
    locus: { table: 'sys_script', sysId }, assertion: `active = true (${sysId})`, band: 'A', status: 'draft',
    evidence: { query: 'q', fields: 'f', capturedAt: '2026-08-11T00:00:00Z', capturedResponse: { sys_id: sysId, name }, guards: { fields: 'validated', identityCanary: 'pass' } },
  });
  brain.upsertClaims([
    named('s1', 'ACME QRT Set Sensitive'),
    named('s2', 'QRT Cancel Guard'),
    named('s3', 'QRT Hoofdactie Prefill'),
    named('s4', 'Incident Business Rule for the User Task'),
  ], { stage: 'harvest' });
  const ctx = { brain, state: brain.state, stage: 'questions' };
  const vocab = stages.vocabularyCandidates(ctx);
  const tokens = vocab.map((v) => v.token);

  assertIncludes(tokens.join(','), 'qrt', 'the recurring domain acronym was not mined at all');
  assertEqual(vocab[0].token, 'qrt', `expected the broadest token first, got ${tokens.join(', ')}`);
  assertEqual(vocab[0].loci, 3, 'breadth is not counted as distinct records carrying the word');
  assert(vocab[0].looksLikeAcronym, 'an all-caps short recurring form was not flagged as an acronym');
  for (const stop of ['incident', 'business', 'rule', 'user', 'task', 'the', 'for']) {
    assert(!tokens.includes(stop), `"${stop}" is platform or ordinary English and must not be mined as domain vocabulary`);
  }
  assert(!tokens.includes('sensitive'), 'a token appearing in only one record should not reach the register');
});

test('1.3: a register-gap question may cite ONE source; every other gate may not', () => {
  const ctx = questionsCtx('vocab-one-source');
  const vocabQ = {
    signal: 'QS-VOCAB', signalState: 'admitted', gate: 'register-gap',
    sources: { A: { kind: 'claim', ref: 'x', says: 'name contains QRT' } },
    locus: [{ sysId: 's1' }], form: 'open',
    question: 'Three customer-authored records carry "QRT" in their names. What does QRT stand for, and what is the process?',
    rank: { E: 1, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 0.5 },
  };
  const okRej = QUESTIONS.validate(ctx, { questions: [vocabQ], suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} } });
  assertEqual(okRej.length, 0, `a one-source register-gap question was rejected:\n  ${okRej.join('\n  ')}`);

  const badRej = QUESTIONS.validate(ctx, {
    questions: [deepMerge(vocabQ, { gate: 'contradiction', form: 'closed', branchMap: { a: 'x', b: 'y' } })],
    suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} },
  });
  assertIncludes(badRej.join(' '), 'lone anomaly', 'a contradiction with one source was accepted');
});

test('1.3: a vocabulary question survives a cap full of higher-ranked questions', () => {
  /*
   * The failure being designed out: WPM scores a vocabulary gap near the floor, so it loses
   * every cap it meets. The one register-gap question the reference run emitted scored 1.07
   * and fell below the admission floor.
   */
  const ctx = questionsCtx('vocab-reserve');
  ctx.state.config.questionCap = 3;
  ctx.state.config.vocabularyReserve = 1;
  const big = (i) => ({
    signal: `QS-0${i}`, signalState: 'admitted', gate: 'contradiction',
    sources: { A: { kind: 'claim', ref: `a${i}` }, B: { kind: 'cluster', ref: `b${i}` } },
    locus: [{ sysId: `big${i}` }], form: 'closed', branchMap: { a: 'deliberate', b: 'unfinished' },
    question: `A high-consequence contradiction number ${i}, is it (a) deliberate or (b) unfinished?`,
    rank: { E: 900, C_guard: 1, C_signal: 1, A: 1, U: 3, M: 0.5 },
  });
  const vocabQ = {
    signal: 'QS-VOCAB', signalState: 'admitted', gate: 'register-gap',
    sources: { A: { kind: 'claim', ref: 'x' } }, locus: [{ sysId: 'vocab1' }], form: 'open',
    question: 'Three customer-authored records carry "QRT" in their names. What does QRT stand for?',
    rank: { E: 1, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 8 },
  };
  const art = { questions: [big(1), big(2), big(3), big(4), vocabQ], suppressed: [], counts: { candidates: 5, afterGates: 5, perGateKills: {} } };
  const applied = QUESTIONS.apply(ctx, art);
  const byGate = (g) => applied.questions.filter((q) => q.gate === g);
  const vocab = byGate('register-gap')[0];

  assertEqual(vocab.status, 'queued',
    'the vocabulary question was ranked out of the cap — which is exactly what happened on the reference run, where QRT, ACME, PER and STS were all recorded "expansion not stated" and none was asked');
  assertEqual(applied.questions.filter((q) => q.status === 'queued').length, 3, 'the cap itself was not honoured');
  assertEqual(byGate('contradiction').filter((q) => q.status === 'queued').length, 2, 'the reserve did not come out of the general cap');
  assertEqual(byGate('contradiction').filter((q) => q.status === 'deferred').length, 2, 'surplus was discarded rather than deferred');
});

const RENDER = STAGE_BY_ID.get('render');

/** A render ctx with one verified claim and the mandatory files on disk. */
function renderCtx(name, processPageBody) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's1' }, assertion: 'a', band: 'A', status: 'verified' }], { stage: 'verify' });
  const claimId = [...brain.claims().values()][0].id;
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  // PRODUCT-95: cite what you declare, and declare what you cite. See seededPage().
  put('docs/wiki/processes/case-behandelen.md',
    `---\nclaims-rendered: 1\n---\n\n${processPageBody}\n\n## Evidence\n\n- \`${claimId}\`\n`);
  const art = {
    pages: [{ path: 'docs/wiki/processes/case-behandelen.md', status: 'verified', rendersClaims: [claimId], tier: 'process' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  return { ctx: { brain, state: brain.state, stage: 'render' }, art };
}

const FULL_PERSONAS = [
  '# Case behandelen', '',
  '## Personas & Permissions', '',
  '### Who works this process', '',
  '| Persona | Group |', '|---|---|', '| Melder | acme_melder |', '',
  '### What each persona may DO', '',
  '| Action | Gate | May | May not |', '|---|---|---|---|',
  '| Cancel | canUserTransition | Behandelaar | Melder — deliberate, recorded so it is not "fixed" by mistake |', '',
  '### What each persona may SEE', '',
  'Ratified by a human; read ACLs do not filter for an admin session.', '',
  '### Where each rule is enforced', '',
  '| Mechanism | Owns |', '|---|---|', '| write ACL | the gate |', '',
].join('\n');

const INTERVIEW = STAGE_BY_ID.get('interview');

test('1.4: census carries process candidates into the queue, separate from harvest areas', () => {
  const ctx = fakeCtx({ stage: 'census' });
  const ex = STAGE_BY_ID.get('census').example(ctx);
  assert(Array.isArray(ex.processCandidates) && ex.processCandidates.length, 'the census example shows no process candidate');
  assertEqual(ex.processCandidates[0].signal, 'update-set-comembership', 'the strongest clustering signal is not the one demonstrated');
  const applied = STAGE_BY_ID.get('census').apply(Object.assign({}, ctx, { brain: Object.assign({}, ctx.brain, { decisions: () => new Map() }) }), ex);
  assert(Array.isArray(applied.queue.processCandidates) && applied.queue.processCandidates.length,
    'process candidates were computed and then dropped instead of reaching the queue');
  assert(Array.isArray(applied.queue.namedProcesses), 'no slot was opened for the names the human supplies at Gate 1');
});

test('1.4: a process-naming question needs one source and may be open form', () => {
  const ctx = questionsCtx('proc-gate');
  const q = {
    signal: 'QS-PROC', signalState: 'admitted', gate: 'process-naming',
    sources: { A: { kind: 'cluster', ref: 'us-fb060e8e', says: '34 records shipped in one update set' } },
    locus: [{ sysId: 'p1' }], form: 'open',
    question: 'These 34 records shipped together in update set STRY0185005 and touch sys_script, sys_ui_action and sysevent_email_action. Is that one process, and what do you call it?',
    rank: { E: 1, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 1 },
  };
  const rej = QUESTIONS.validate(ctx, { questions: [q], suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} } });
  assertEqual(rej.length, 0, `a process-naming question was rejected:\n  ${rej.join('\n  ')}`);
});

test('1.4: answering a process-naming question binds the customer word to the cluster', () => {
  const root = scratchRepo('proc-bind');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertQuestions([{ id: 'Q-aaaaaaaaaaaa', __cliAllocated: true, signal: 'QS-PROC', gate: 'process-naming', status: 'queued', locus: [{ sysId: 'p1' }], question: 'Is this one process, and what do you call it?' }]);
  const ctx = { brain, state: brain.state, stage: 'interview' };
  const applied = INTERVIEW.apply(ctx, {
    answers: [{ questionId: 'Q-aaaaaaaaaaaa', answeredBy: 'a named expert', answeredAt: '2026-08-12', kind: 'decision', rationale: 'yes, that is the cancel flow', processName: 'Case annuleren' }],
  });
  assertEqual(applied.queue.namedProcesses.length, 1, 'the name the human supplied was not recorded');
  assertEqual(applied.queue.namedProcesses[0].name, 'Case annuleren');
  assertEqual(applied.queue.namedProcesses[0].slug, 'case-annuleren', 'the slug the render stage matches on was not derived');
});

test('1.4: a cluster the human DISCARDS is recorded, and does not become a page', () => {
  const root = scratchRepo('proc-discard');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertQuestions([{ id: 'Q-bbbbbbbbbbbb', __cliAllocated: true, signal: 'QS-PROC', gate: 'process-naming', status: 'queued', locus: [{ sysId: 'p2' }], question: 'Is this one process?' }]);
  const ctx = { brain, state: brain.state, stage: 'interview' };
  const applied = INTERVIEW.apply(ctx, {
    answers: [{ questionId: 'Q-bbbbbbbbbbbb', answeredBy: 'a named expert', answeredAt: '2026-08-12', kind: 'decision', rationale: 'those are leftovers from a spike, not a process', processDiscarded: true }],
  });
  assertEqual(applied.queue.namedProcesses[0].discarded, true, 'a discard was not recorded, so the cluster returns as a candidate next run');
  assertEqual(applied.queue.namedProcesses[0].name, null);
});

test('1.4: render refuses to ship without a page for each NAMED process', () => {
  const { ctx, art } = renderCtx('ren-no-process-page', FULL_PERSONAS);
  ctx.state.queue = { namedProcesses: [{ name: 'Case annuleren', slug: 'case-annuleren', discarded: false }] };
  const rej = RENDER.validate(ctx, art);
  assertIncludes(rej.join(' '), 'have no page',
    'a process the human named at Gate 1 was silently not rendered');
  assertIncludes(rej.join(' '), 'case-annuleren', 'the rejection did not name the missing process');

  ctx.state.queue = { namedProcesses: [{ name: 'Case annuleren', slug: 'case-annuleren', discarded: true }] };
  assertEqual(RENDER.validate(ctx, art).length, 0, 'a DISCARDED cluster was required to have a page');
});

// ---------------------------------------------------------------------------
// PLAN 7.2 — the WHY ledger: tiers, anchors, principles, and the unbound escape
// ---------------------------------------------------------------------------

group('P. the WHY ledger (7.2)');

/** A brain holding one verified claim per requested key, returning { brain, root, ids }. */
function decisionsFixture(name, claimKeys) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims((claimKeys || ['k1']).map((k, i) => ({
    locus: { table: 'sys_script', sysId: `${i}`.padEnd(32, 'f'), key: `ACME ${k}` },
    assertion: `${k} = true`, band: 'A', rung: 'L1', status: 'verified',
    evidence: { query: 'q', fields: 'sys_id', capturedAt: '2026-08-20T00:00:00Z' },
  })), { stage: 'harvest' });
  return { brain, root, ids: [...brain.claims().values()].map((c) => c.id) };
}

const DEC_BASE = {
  rationaleStrength: 'stated', alternatives: [], scope: { instance: 'x', tables: [] },
  answeredBy: 'a named expert', answeredAt: '2026-08-20',
  answerProvenance: { fromQuestion: null, channel: 'orientation', verbatim: 'v', rationaleVolunteered: true, branch: null },
  confidence: 'medium', supersedes: null, supersededBy: null, confirmationStatus: 'current', reconfirmation: [],
};

test('7.2: the DEC generator renders tier + anchors + principle, refuses the undisclosed, routes unknown to tbd', () => {
  const { brain, root, ids } = decisionsFixture('dec-ledger', ['active', 'coalesce']);
  brain.upsertDecisions([
    Object.assign({}, DEC_BASE, {
      statement: 'The dedup key is u_external_reference.', rationale: 'the old key mis-matched employees',
      impact: 'every intake path must coalesce on it', principle: 'one external identity field per integration',
      derivedFrom: 'interview', tier: 'confirmed', anchorSource: 'interview', linkage: 'bound',
      witnessClaims: [ids[0]], explainsClaims: [ids[1]],
    }),
    Object.assign({}, DEC_BASE, {
      statement: 'Intake originates in VendorX.', rationale: null,
      derivedFrom: 'recall', tier: 'confirmed', anchorSource: 'interview', linkage: 'unbound',
      witnessClaims: [], explainsClaims: [],
    }),
    Object.assign({}, DEC_BASE, {
      statement: 'A recall row smuggled past the mint paths.', rationale: null,
      derivedFrom: 'recall', witnessClaims: [], explainsClaims: [],
    }),
    Object.assign({}, DEC_BASE, {
      statement: 'Whether the vendor engine skips or updates on coalesce match is unknown.',
      derivedFrom: 'interview', tier: 'unknown', witnessClaims: [ids[1]], explainsClaims: [],
    }),
  ]);
  const built = renderLib.buildDecisionLedger(root);
  assertEqual(built.rejections.length, 1, `expected exactly ONE aggregate refusal:\n${built.rejections.join('\n')}`);
  assertIncludes(built.rejections[0], 'zero anchors', 'the refusal does not say what it refuses');
  assertEqual(built.totals.rendered, 2, 'the anchored and the disclosed-unbound entries should render, the other two not');
  assertEqual(built.totals.unknowns, 1, 'the tier-unknown decision did not route to tbd');
  const body = built.page.body;
  assertIncludes(body, '`confirmed`', 'no tier badge rendered');
  assertIncludes(body, '**Principle:** one external identity field per integration', 'the forward-acting principle is not on the entry');
  assertIncludes(body, '**Impact:** every intake path must coalesce on it', 'impact is not on the entry');
  assertIncludes(body, 'linkage: unbound', 'the disclosed-unbound entry does not show its gap');
  assertIncludes(built.tbdBlock, 'must not improvise', 'the tbd block does not carry the the pilot customer rule');
  assertIncludes(built.tbdBlock, 'vendor engine', 'the unknown decision is not in the tbd block');
  /*
   * The id-collision guard: DEC-<12 hex> CONTAINS a CLAIM_ID_RE match, so raw decision ids on
   * the page would corrupt claims-rendered accounting — run 5's agent hit exactly this and
   * worked around it by hand. The generator must print wiki numbers and bare hashes only.
   */
  assertEqual(renderLib.claimIdsIn(body).size, built.totals.anchorsResolved,
    'the page prints claim-id-shaped tokens beyond its anchors — the DEC-hash collision run 5 documented');
  assertEqual(renderLib.frontmatterNumber(body, 'claims-rendered'), built.totals.anchorsResolved,
    'claims-rendered is not derived from the ids the page prints');

  // The cheapest legal fix is disclosure, and it must actually satisfy the guard.
  const smuggled = [...brain.decisions().values()].find((d) => d.statement.startsWith('A recall row smuggled'));
  brain.upsertDecisions([Object.assign({}, smuggled, { linkage: 'unbound' })]);
  const fixed = renderLib.writeDecisionLedger(root);
  assertEqual(fixed.rejections.length, 0, `disclosure does not satisfy the refusal:\n${fixed.rejections.join('\n')}`);
  assert(fixed.written, 'a clean ledger was not written');
  assert(fs.existsSync(path.join(root, 'docs', 'wiki', 'decisions.md')), 'decisions.md not on disk');
  const tbd = fs.readFileSync(path.join(root, 'docs', 'wiki', 'tbd.md'), 'utf8');
  assertIncludes(tbd, 'vendor engine', 'the unknown decision did not reach tbd.md');
  // Idempotence: a second write replaces the marker block, never appends a twin.
  renderLib.writeDecisionLedger(root);
  const tbd2 = fs.readFileSync(path.join(root, 'docs', 'wiki', 'tbd.md'), 'utf8');
  assertEqual(tbd2.split('must not improvise').length, 2, 'the unknowns block duplicated on rewrite');
});

test('7.2: a decision citing an anchor the ledger does not hold is refused, not rendered', () => {
  const { brain, root } = decisionsFixture('dec-dangling', ['k']);
  brain.upsertDecisions([Object.assign({}, DEC_BASE, {
    statement: 'Anchored to nothing real.', derivedFrom: 'interview', tier: 'confirmed',
    witnessClaims: ['C-000000000000'], explainsClaims: [],
  })]);
  const built = renderLib.buildDecisionLedger(root);
  assertEqual(built.rejections.filter((r) => /not in the ledger/.test(r)).length, 1,
    `a hallucinated anchor rendered as a citation:\n${built.rejections.join('\n')}`);
});

test('7.2: an induced WHY whose witness died is GONE — retired without a reconfirmation question', () => {
  const { brain, ids } = decisionsFixture('dec-induced-death', ['w1', 'w2']);
  brain.upsertDecisions([
    Object.assign({}, DEC_BASE, {
      statement: 'Induced: X was replaced by Y.', derivedFrom: 'interview', tier: 'induced',
      anchorSource: 'deletion', linkage: 'bound', witnessClaims: [ids[0]], explainsClaims: [],
    }),
    Object.assign({}, DEC_BASE, {
      statement: 'Confirmed: the key is Y.', derivedFrom: 'interview', tier: 'confirmed',
      linkage: 'bound', witnessClaims: [ids[1]], explainsClaims: [],
    }),
  ]);
  const sup = brain.applySupersession([
    { id: ids[0], from: 'verified', to: 'gone' },
    { id: ids[1], from: 'verified', to: 'drifted' },
  ]);
  const decs = [...brain.decisions().values()];
  const induced = decs.find((d) => d.tier === 'induced');
  const confirmed = decs.find((d) => d.tier === 'confirmed');
  assertEqual(induced.confirmationStatus, 'retired',
    'an induced decision survived the death of its only witness as a caveat — the tier\'s whole warrant is its evidence');
  assertEqual(confirmed.confirmationStatus, 'needs-reconfirmation', 'the confirmed path regressed');
  const reconfirmQs = [...brain.questionsLedger().values()].filter((q) => q.gate === 'decision-reconfirmation');
  assertEqual(reconfirmQs.length, 1,
    'a reconfirmation question was minted for the retired induced decision — SME minutes spent on a dead hypothesis');
  assertIncludes(reconfirmQs[0].question, confirmed.id, 'the one question is not about the confirmed decision');
  assert(sup.flagged.some((f) => f.retired), 'the retirement is not visible in the supersession report');
  // And the DEC ledger does not render it.
  const built = renderLib.buildDecisionLedger(brain.root);
  assertEqual(built.totals.retiredInduced, 1, 'the retired induced decision is not counted out of the ledger');
  assert(!/Induced: X was replaced/.test(built.page.body), 'a retired induced decision still renders');
});

test('7.2: interview.apply computes linkage and tier, and discloses the unbound in one warning', () => {
  const root = scratchRepo('dec-interview-linkage');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's1' }, assertion: 'a = 1', band: 'A', status: 'verified' }], { stage: 'verify' });
  const cid = [...brain.claims().values()][0].id;
  brain.upsertQuestions([
    { id: 'Q-aaaaaaaaaaa1', __cliAllocated: true, signal: 'S', gate: 'anomaly', status: 'queued', locus: [{ sysId: 'x', claim: cid }], sources: { A: { kind: 'claim', ref: cid, says: 's' } }, question: 'bound?' },
    { id: 'Q-aaaaaaaaaaa2', __cliAllocated: true, signal: 'S', gate: 'anomaly', status: 'queued', locus: [{ sysId: 'y' }], sources: { A: { kind: 'census', ref: 'census:rows', says: 's' } }, question: 'unbound?' },
  ]);
  const applied = INTERVIEW.apply({ brain, state: brain.state, stage: 'interview' }, {
    answers: [
      { questionId: 'Q-aaaaaaaaaaa1', answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', rationale: 'r', impact: 'i', principle: 'p' },
      { questionId: 'Q-aaaaaaaaaaa2', answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', rationale: 'r' },
    ],
  });
  const bound = applied.decisions.find((d) => d.linkage === 'bound');
  const unbound = applied.decisions.find((d) => d.linkage === 'unbound');
  assert(bound && bound.witnessClaims.includes(cid), 'the claim-sourced answer did not bind');
  assertEqual(bound.tier, 'confirmed', 'a human answer is tier confirmed');
  assertEqual(bound.impact, 'i', 'impact was not carried onto the decision');
  assertEqual(bound.principle, 'p', 'principle was not carried onto the decision');
  assert(unbound, 'the aggregate-sourced answer was not disclosed as unbound — PRODUCT-75\'s silence, back again');
  assertEqual((applied.findings || []).filter((f) => f.check === 'decision-unbound').length, 1,
    'no aggregate decision-unbound warning was minted at the interview door');
});

test('7.2: orientation recall decisions are unbound BY CONSTRUCTION and say so; stated ones bind to their DOC claim', () => {
  const ctx = fakeCtx({ stage: 'orientation' });
  const applied = STAGE_BY_ID.get('orientation').apply(ctx, orientationArtifact());
  const recall = applied.decisions.filter((d) => d.derivedFrom === 'recall');
  const stated = applied.decisions.filter((d) => d.derivedFrom === 'stated');
  assert(recall.length && recall.every((d) => d.linkage === 'unbound' && d.tier === 'confirmed'),
    'a sealed-recall decision minted without disclosing linkage: unbound');
  assert(stated.length && stated.every((d) => d.linkage === 'bound' && (d.witnessClaims || []).length),
    'a stated convention decision lost its DOC-claim witness');
  assertEqual((applied.findings || []).filter((f) => f.check === 'decision-unbound').length, 1,
    'the orientation door minted unbound decisions without the aggregate warning');
});

test('7.2: render.validate refuses a silent unanchored decision, in ONE aggregate rejection', () => {
  const { ctx, art } = renderCtx('dec-render-refusal', FULL_PERSONAS);
  ctx.brain.upsertDecisions([
    Object.assign({}, DEC_BASE, { statement: 'silent one', derivedFrom: 'recall', witnessClaims: [], explainsClaims: [] }),
    Object.assign({}, DEC_BASE, { statement: 'silent two', derivedFrom: 'recall', witnessClaims: [], explainsClaims: [] }),
  ]);
  const rej = RENDER.validate(ctx, art).filter((m) => /zero anchor/.test(m));
  assertEqual(rej.length, 1, `expected ONE aggregate rejection for two silent decisions:\n${rej.join('\n')}`);
  assertIncludes(rej[0], '2 decision(s)', 'the aggregate does not count its population');
  // Disclosure is the cheapest legal satisfaction, and it must pass.
  for (const d of [...ctx.brain.decisions().values()]) {
    ctx.brain.upsertDecisions([Object.assign({}, d, { linkage: 'unbound' })]);
  }
  assertEqual(RENDER.validate(ctx, art).filter((m) => /zero anchor/.test(m)).length, 0,
    'disclosed-unbound decisions are still refused, so the guard has no legal answer for a sealed recall');
});

test('7.2: snbrain status prints the unreachable-decision ratio', () => {
  const { brain, root, ids } = decisionsFixture('dec-status', ['k']);
  brain.upsertDecisions([
    Object.assign({}, DEC_BASE, { statement: 'bound', derivedFrom: 'interview', tier: 'confirmed', linkage: 'bound', witnessClaims: [ids[0]], explainsClaims: [] }),
    Object.assign({}, DEC_BASE, { statement: 'unbound', derivedFrom: 'recall', tier: 'confirmed', linkage: 'unbound', witnessClaims: [], explainsClaims: [] }),
  ]);
  const r = cli(['status', '--root', root]);
  assertIncludes(r.stdout, '1 of 2 rest on no claim — supersession cannot reach them',
    'PRODUCT-75 fix (3): the operator cannot see the unreachable-decision ratio');
  assertIncludes(r.stdout, '1 disclosed as linkage: unbound, 0 silent', 'the disclosure split is not printed');
});

// ---------------------------------------------------------------------------
// PLAN 7.3 — decision induction, including the negative space
// ---------------------------------------------------------------------------

group('Q. decision induction (7.3)');

/** Claim-row builders for the pure induction function. Ids are explicit; no Brain needed. */
let inductionSeq = 0;
function liveClaim(table, assertion, extra) {
  inductionSeq += 1;
  return Object.assign({
    id: `C-live${String(inductionSeq).padStart(8, '0')}`,
    locus: { table, sysId: `s${inductionSeq}`.padEnd(32, '0') },
    assertion, band: 'A', rung: 'L1', status: 'verified',
  }, extra || {});
}
function deleteRowClaims(delSysId, fields, opts) {
  const out = [];
  for (const [f, v] of Object.entries(fields)) {
    inductionSeq += 1;
    out.push({
      id: `C-del${String(inductionSeq).padStart(9, '0')}`,
      locus: { table: 'sys_metadata_delete', sysId: delSysId, field: f },
      assertion: `${f} = ${v}`, band: 'A', rung: 'L1', status: 'verified',
      evidence: (opts && opts.response) ? { capturedResponse: opts.response } : undefined,
    });
  }
  return out;
}

/** The PRODUCT-91 shape, as a fixture: the known-answer case the real replay must also find. */
function knownAnswerLedger() {
  return [].concat(
    deleteRowClaims('d1'.padEnd(32, 'a'), {
      sys_db_object: 'x_lsmcb_sca_field_map',
      sys_name: 'involved party_Personeelsnummer ➡ u_external_id (inbound)',
      sys_update_name: 'x_lsmcb_sca_field_map_6697281f1ba40b909e2aa934604bcba5',
    }),
    deleteRowClaims('d2'.padEnd(32, 'a'), {
      sys_db_object: 'x_lsmcb_sca_field_map',
      sys_name: 'involved party_Personeelsnummer ➡ u_external_id (inbound)',
    }),
    [
      liveClaim('x_lsmcb_sca_field_map', 'name = AR_Incidentnummer ➡ u_external_reference (inbound)'),
      liveClaim('x_lsmcb_sca_field_map', 'field = u_external_reference'),
      liveClaim('x_lsmcb_sca_field_map', 'coalesce = true'),
      liveClaim('x_lsmcb_sca_field_map', 'name = involved party_Personeelsnummer ➡ person (inbound)'),
      // One shared segment only ('u_') — must NOT count as kin of u_external_id.
      liveClaim('x_lsmcb_sca_field_map', 'field = u_platform'),
      /*
       * The fix script that mentions the dead token ON ANOTHER TABLE. Run 4's ledger holds
       * exactly this ("ACME relink VendorX employees post-pull … whose u_external_id matches"),
       * and it is why deadness is SURFACE-scoped: ledger-wide, the token is alive and the
       * known answer disappears.
       */
      liveClaim('sys_script_fix', 'description = walk every IP whose u_external_id matches a known employee'),
    ]);
}

test('7.3 KNOWN-ANSWER: the inducer finds the u_external_id -> u_external_reference reversal', () => {
  const res = stages.decisionCandidatesFromLedger(knownAnswerLedger(), []);
  const ka = res.candidates.find((c) => c.key === 'del|x_lsmcb_sca_field_map|u_external_id');
  assert(ka, `the one case we know is there was not found:\n${res.candidates.map((c) => c.key).join('\n')}`);
  assertEqual(ka.patternShape, 'removed-with-replacement', 'the live replacement was not paired');
  const repl = ka.replacements.map((r) => `${r.token}:${r.via}`);
  assert(repl.includes('u_external_reference:name-prefix'),
    `u_external_reference is not the name-prefix replacement: ${repl.join(', ')}`);
  assert(repl.includes('person:template-slot'),
    `the refilled "L ➡ R" slot was not paired: ${repl.join(', ')}`);
  assert(!repl.some((r) => r.startsWith('u_platform')),
    'a one-shared-segment token counted as kin — the prefix rule lost its floor');
  assertIncludes(ka.statement, 'deliberately removed', 'the drafted statement is not the negative-space sentence');
  assert(ka.principleDraft && /u_external_reference/.test(ka.principleDraft), 'no forward-acting principle drafted');
  assertEqual(res.counts.hallucinatedWitnesses, 0, 'the inducer minted witnesses the ledger does not hold');
  assert(ka.witnesses.length >= 3, 'the candidate does not carry its deletion and replacement witnesses');
});

test('7.3: sys_db_object fetched-but-never-claimed still clusters (run 5\'s delete-claim shape)', () => {
  const rows = [].concat(
    deleteRowClaims('d3'.padEnd(32, 'b'), {
      sys_update_name: 'x_lsmcb_sca_field_map_ffff281f1ba40b909e2aa934604bcbff',
      sys_name: 'involved party_Personeelsnummer ➡ u_external_id (inbound)',
    }, { response: { sys_db_object: 'x_lsmcb_sca_field_map' } }),
    [liveClaim('x_lsmcb_sca_field_map', 'field = u_external_reference')]);
  const res = stages.decisionCandidatesFromLedger(rows, []);
  assert(res.candidates.some((c) => c.table === 'x_lsmcb_sca_field_map' && /u_external_id/.test(c.key)
      && c.replacements.some((r) => r.token === 'u_external_reference')),
    'a delete row whose target table sits only in capturedResponse minted nothing — 988 of run 5\'s deleted records are in exactly this shape');
});

test('7.3: the three config-pattern shapes fire on their defining signal and on nothing else', () => {
  // feature-off-not-removed (both polarities), from run 5's measured case.
  const props = (sysId, name, value) => [
    liveClaim('sys_properties', `name = ${name}`, { locus: { table: 'sys_properties', sysId } }),
    liveClaim('sys_properties', `value = ${value}`, { locus: { table: 'sys_properties', sysId } }),
  ];
  const r1 = stages.decisionCandidatesFromLedger([].concat(
    props('p1'.padEnd(32, 'c'), 'sn_ohs_im.hide_generate_osha_forms', 'true'),
    props('p2'.padEnd(32, 'c'), 'sn_ohs_im.enable_playbook', 'false'),
    props('p3'.padEnd(32, 'c'), 'sn_ohs_im.enable_thing', 'true')), []);
  const off = r1.candidates.filter((c) => c.patternShape === 'feature-off-not-removed');
  assertEqual(off.length, 2, `expected the hide=true and enable=false properties only:\n${off.map((c) => c.key).join('\n')}`);
  assertIncludes(off[0].principleDraft, "Hide, don't delete", 'the shape lost its principle');

  // group-disjointness: fires without sibling-module roles, stays silent with one.
  const grant = (role) => liveClaim('sys_group_has_role', `role = ${role}`);
  const clean = [grant('sn_ohs_im.acme_backoffice'), grant('sn_ohs_im.acme_frontoffice'), grant('acme.ohs_team_manager')];
  assert(stages.decisionCandidatesFromLedger(clean, []).candidates.some((c) => c.patternShape === 'group-disjointness'),
    'three grants with no sibling-module role minted no disjointness candidate');
  assert(!stages.decisionCandidatesFromLedger(clean.concat([grant('sn_hr_core.basic')]), [])
    .candidates.some((c) => c.patternShape === 'group-disjointness'),
    'a sibling-module grant is present and the structure was still called disjoint');

  // single-source: one host across >=2 endpoints, and never with a second host.
  const ep = (url) => liveClaim('sys_rest_message', `rest_endpoint = ${url}`);
  const one = [ep('https://api.vendorx.nl/incidents'), ep('https://api.vendorx.nl/persons')];
  const single = stages.decisionCandidatesFromLedger(one, []).candidates.find((c) => c.patternShape === 'single-source');
  assert(single && /api\.vendorx\.nl/.test(single.statement), 'two endpoints on one host minted no single-source candidate');
  assert(!stages.decisionCandidatesFromLedger(one.concat([ep('https://other.example.com/x')]), [])
    .candidates.some((c) => c.patternShape === 'single-source'),
    'two distinct hosts and the surface was still called single-source');
});

test('7.3: a doc-vs-instance contradiction question is ROUTED into the candidate shape, never re-detected', () => {
  const doc = liveClaim('stated-convention', 'artifact-naming: everything carries the ACME prefix', { status: 'documented', rung: 'DOC' });
  const inst = liveClaim('sys_script', 'sys_name = SG Incident Cleanup');
  const qs = [
    { id: 'Q-ddddddddddd1', gate: 'contradiction', question: 'The stated naming convention says ACME-prefixed; 42 artifacts are not. Deliberate or drift?', sources: { A: { kind: 'claim', ref: doc.id }, B: { kind: 'claim', ref: inst.id } }, locus: [{ table: 'sys_script', sysId: 'x' }] },
    { id: 'Q-ddddddddddd2', gate: 'contradiction', question: 'Instance vs instance — not doc-shaped.', sources: { A: { kind: 'census', ref: 'census:rows' }, B: { kind: 'finding', ref: 'F-000000000000' } }, locus: [{ sysId: 'y' }] },
  ];
  const res = stages.decisionCandidatesFromLedger([doc, inst], qs);
  const routed = res.candidates.filter((c) => c.source === 'doc-contradiction');
  assertEqual(routed.length, 1, 'the doc-vs-instance contradiction was not routed (or the instance-only one was)');
  assertEqual(routed[0].fromQuestion, 'Q-ddddddddddd1');
  assert(routed[0].witnesses.includes(doc.id) && routed[0].witnesses.includes(inst.id),
    'the routed candidate does not carry both sides as witnesses');
});

test('7.3: the cap drops candidates AND REPORTS them — a silent cap reads as coverage', () => {
  const rows = [liveClaim('tgt_table', 'active = true')];
  for (let i = 0; i < stages.DECISION_CANDIDATES_MAX + 6; i += 1) {
    rows.push(...deleteRowClaims(`e${i}`.padEnd(32, 'd'), {
      sys_db_object: 'tgt_table', sys_name: `widget dead_token_${i} gone`,
    }));
  }
  const res = stages.decisionCandidatesFromLedger(rows, []);
  assertEqual(res.candidates.length, stages.DECISION_CANDIDATES_MAX, 'the cap is not applied');
  assertEqual(res.dropped.length, 6, 'the drop is not reported — the no-silent-caps rule');
  assert(res.dropped.every((d) => d.key && d.source), 'a dropped candidate is not identifiable');
});

test('7.3: a witness the ledger does not hold is dropped and counted, never rendered', () => {
  const byId = new Map([['C-000000000001', {}]]);
  const cands = [{ witnesses: ['C-000000000001', 'C-hallucinated0'] }];
  const dropped = stages.validateCandidateWitnesses(cands, byId);
  assertEqual(dropped, 1, 'the hallucinated witness was not counted');
  assertEqual(cands[0].witnesses.join(','), 'C-000000000001', 'the hallucinated witness survived into the candidate');
});

test('7.3: questions.apply persists the candidates in the queue for the interview leg', () => {
  const root = scratchRepo('induction-queue');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(knownAnswerLedger().map(({ id, ...c }) => c), { stage: 'harvest' });
  const ctx = { brain, state: brain.state, stage: 'questions' };
  const applied = STAGE_BY_ID.get('questions').apply(ctx, { questions: [], suppressed: [], counts: { candidates: 0, afterGates: 0 } });
  assert(applied.queue && Array.isArray(applied.queue.decisionCandidates) && applied.queue.decisionCandidates.length,
    'the induction leg ran and its candidates never reached the queue — the interview cannot ask what nothing stored');
  assertEqual(applied.facts.decisionInduction.minted, applied.queue.decisionCandidates.length,
    'the reported mint count disagrees with what was stored');
  assertEqual(applied.facts.decisionInduction.hallucinatedWitnesses, 0,
    'the CLI-checked witness pass reports hallucinations on a ledger-only fixture');
});

// ---------------------------------------------------------------------------
// PLAN 7.4 — the interview asks more, and asks WHY
// ---------------------------------------------------------------------------

group('R. the interview asks why (7.4)');

/** A brain whose questions stage has run over the known-answer ledger: candidates + why-questions in place. */
function whyFixture(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(knownAnswerLedger().map(({ id, ...c }) => c), { stage: 'harvest' });
  const ctx = { brain, state: brain.state, stage: 'questions' };
  const applied = STAGE_BY_ID.get('questions').apply(ctx, { questions: [], suppressed: [], counts: { candidates: 0, afterGates: 0 } });
  Object.assign(brain.state.queue, applied.queue || {});
  brain.upsertQuestions(applied.questions);
  return { root, brain, applied };
}

test('7.4: the question set grows ONLY in why-kind questions, one per candidate, each naming candidate + witnesses', () => {
  const { brain, applied } = whyFixture('why-mint');
  const whys = applied.questions.filter((q) => q.gate === 'why-decision');
  const others = applied.questions.filter((q) => q.gate !== 'why-decision');
  assertEqual(others.length, 0, 'the CLI minted non-why questions the artifact never carried — the set grew outside the why kind');
  const cands = brain.state.queue.decisionCandidates;
  assertEqual(whys.length, cands.length, 'not one why-question per candidate');
  for (const w of whys) {
    const cand = cands.find((c) => c.key === w.candidateKey);
    assert(cand, `why-question does not name a stored candidate: ${w.candidateKey}`);
    assertEqual(w.sources.A.ref, cand.key, 'sources.A does not name the candidate');
    assert(w.locus.length && w.locus.every((l) => cand.witnesses.includes(l.claim)),
      'a why-question cites loci outside its candidate\'s witnesses');
    assertEqual(w.status, 'queued', 'why-questions ride their own budget and arrive queued');
  }
  // Ledger round-trip: ids are content-hashed, so a second apply updates rather than duplicates.
  const ledgerWhys = [...brain.questionsLedger().values()].filter((q) => q.gate === 'why-decision');
  assertEqual(ledgerWhys.length, whys.length, 'the why-questions did not survive the ledger round-trip');
});

test('7.4: an agent may not author a why-decision question — the payload schema has no such gate', () => {
  const errors = validate(STAGE_BY_ID.get('questions').schema, {
    questions: [{
      signal: 'X', signalState: 'admitted', gate: 'why-decision',
      sources: { A: { kind: 'claim', ref: 'C-000000000000' } },
      locus: [{ sysId: 'x' }], question: 'why is this built the way it is, I wonder?', form: 'open',
      rank: { E: 1, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 1 },
    }],
    counts: { candidates: 1, afterGates: 1 },
  }, '$');
  assert(errors.some((e) => /gate/.test(e)),
    'an agent-authored why-decision question passed the schema — an invented candidate is exactly what the induction leg exists to prevent');
});

test('7.4: confirm / deny / correct — confirm mints a confirmed DEC on the candidate\'s witnesses', () => {
  const { brain } = whyFixture('why-confirm');
  const why = [...brain.questionsLedger().values()].find((q) => q.gate === 'why-decision' && /u_external_id/.test(q.candidateKey));
  const applied = INTERVIEW.apply({ brain, state: brain.state, stage: 'interview' }, {
    answers: [{ questionId: why.id, answeredBy: 'a named expert', answeredAt: '2026-08-20', kind: 'decision', whyVerdict: 'confirm', verbatim: 'Yes — the old key mis-matched contractors.' }],
  });
  assertEqual(applied.decisions.length, 1, 'confirm minted no decision');
  const dec = applied.decisions[0];
  assertEqual(dec.tier, 'confirmed', 'a human confirmation is tier confirmed');
  assertEqual(dec.anchorSource, 'deletion', 'the anchor source lost the candidate\'s provenance');
  const cand = brain.state.queue.decisionCandidates.find((c) => c.key === why.candidateKey);
  assert(dec.witnessClaims.length >= 3 && dec.witnessClaims.every((id) => cand.witnesses.includes(id)),
    'the DEC does not rest on the candidate\'s witnesses — the links are the CLI\'s, not the wording\'s');
  assert(dec.principle, 'the confirmed DEC carries no forward-acting principle');
  assertEqual(applied.queue.decisionCandidates.find((c) => c.key === why.candidateKey).disposed, 'confirmed',
    'the candidate was not disposed, so render would double-mint it as induced');
});

test('7.4: deny is recorded as refuted, kept, and never re-asked by the next induction pass', () => {
  const { brain } = whyFixture('why-deny');
  const why = [...brain.questionsLedger().values()].find((q) => q.gate === 'why-decision' && /u_external_id/.test(q.candidateKey));
  const applied = INTERVIEW.apply({ brain, state: brain.state, stage: 'interview' }, {
    answers: [{ questionId: why.id, answeredBy: 'a named expert', answeredAt: '2026-08-20', kind: 'decision', whyVerdict: 'deny', verbatim: 'No — that field was never the key.' }],
  });
  assertEqual(applied.decisions.length, 0, 'a denied hypothesis was minted as a decision anyway');
  const refs = applied.queue.refutedCandidates;
  assert(refs && refs.length === 1 && refs[0].key === why.candidateKey && refs[0].by === 'a named expert',
    'the refutation was not recorded with attribution');
  Object.assign(brain.state.queue, applied.queue);
  // The next induction pass must skip it.
  const again = stages.decisionCandidates({ brain, state: brain.state });
  assert(!again.candidates.some((c) => c.key === why.candidateKey),
    'a refuted candidate was re-minted — the same human gets asked the same hypothesis next run');
});

test('7.4: correct without the corrected sentence is refused; with it, the DEC carries the human\'s words', () => {
  const { brain } = whyFixture('why-correct');
  const why = [...brain.questionsLedger().values()].find((q) => q.gate === 'why-decision');
  const ctx = { brain, state: brain.state, stage: 'interview' };
  const rej = INTERVIEW.validate(ctx, {
    answers: [{ questionId: why.id, answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', whyVerdict: 'correct' }],
  });
  assertEqual(rej.filter((m) => /corrected sentence/.test(m)).length, 1, `correct-with-no-correction was accepted:\n${rej.join('\n')}`);
  const rej2 = INTERVIEW.validate(ctx, {
    answers: [{ questionId: why.id, answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', whyVerdict: 'correct', verbatim: 'It was removed because matching moved to employee number.', statement: 'Identity matching moved from u_external_id to employee number.' }],
  });
  assertEqual(rej2.length, 0, `a well-formed correction was refused:\n${rej2.join('\n')}`);
  const applied = INTERVIEW.apply(ctx, {
    answers: [{ questionId: why.id, answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', whyVerdict: 'correct', verbatim: 'It was removed because matching moved to employee number.', statement: 'Identity matching moved from u_external_id to employee number.' }],
  });
  assertEqual(applied.decisions[0].statement, 'Identity matching moved from u_external_id to employee number.',
    'the corrected statement did not replace the draft');
  assertEqual(applied.decisions[0].rationaleStrength, 'stated', 'a human-worded correction is a stated rationale');
  // And a why-answer with no verdict at all is refused.
  const rej3 = INTERVIEW.validate(ctx, {
    answers: [{ questionId: why.id, answeredBy: 'x', answeredAt: '2026-08-20', kind: 'decision', rationale: 'sure' }],
  });
  assertEqual(rej3.filter((m) => /whyVerdict/.test(m)).length, 1, 'a why-decision answer without a verdict slipped through');
});

test('7.4: an unanswered candidate ships as an INDUCED decision at render — confirmed and refuted do not', () => {
  const root = scratchRepo('why-induced');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(knownAnswerLedger().map(({ id, ...c }) => c)
    .concat(deleteRowClaims('d9'.padEnd(32, 'e'), { sys_db_object: 'tgt2', sys_name: 'obsolete dead_widget_x thing' }).map(({ id, ...c }) => c))
    .concat([(({ id, ...c }) => c)(liveClaim('tgt2', 'active = true'))])
    .concat([(({ id, ...c }) => c)(liveClaim('tgt3', 'active = true'))])
    .concat(deleteRowClaims('da'.padEnd(32, 'e'), { sys_db_object: 'tgt3', sys_name: 'retired dead_widget_y thing' }).map(({ id, ...c }) => c)), { stage: 'harvest' });
  const qApplied = STAGE_BY_ID.get('questions').apply({ brain, state: brain.state, stage: 'questions' },
    { questions: [], suppressed: [], counts: { candidates: 0, afterGates: 0 } });
  Object.assign(brain.state.queue, qApplied.queue || {});
  const cands = brain.state.queue.decisionCandidates;
  assert(cands.length >= 3, `fixture needs three candidates, has ${cands.length}`);
  // Dispose one as confirmed and refute a second; the rest stay unanswered.
  cands[0].disposed = 'confirmed';
  cands[1].disposed = 'refuted';
  brain.state.queue.refutedCandidates = [{ key: cands[1].key, by: 'x', at: '2026-08-20' }];
  for (const rel of ['CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'seeded');
  }
  const applied = STAGE_BY_ID.get('render').apply({ brain, state: brain.state, stage: 'render' }, {
    pages: [], kernel: { path: 'CLAUDE.md', routingEntries: 1 }, settings: { path: '.claude/settings.json', hooks: ['x'] },
  });
  const expected = cands.filter((c) => !c.disposed).length;
  assertEqual(applied.decisions.length, expected, 'render did not mint exactly the unanswered candidates as induced');
  assert(applied.decisions.every((d) => d.tier === 'induced' && d.derivedFrom === 'induced' && d.linkage === 'bound' && d.witnessClaims.length),
    'an induced decision shipped without its tier, provenance or witnesses');
  // The DEC ledger renders it with the caveat.
  brain.upsertDecisions(applied.decisions);
  const built = renderLib.buildDecisionLedger(root);
  assertEqual(built.totals.byTier.induced, expected, 'the induced tier did not reach the DEC ledger');
  assertIncludes(built.page.body, 'no human has confirmed', 'the induced caveat is not printed');
});

// ---------------------------------------------------------------------------
// PLAN 7.5 — enforcement minted from conventions
// ---------------------------------------------------------------------------

group('S. minted enforcement (7.5)');

/** An engagement repo whose .brain/ holds stated conventions + a measurable naming surface. */
function gatesFixture(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const rows = [];
  for (let k = 0; k < 6; k += 1) { rows.push({ locus: { table: 'sys_script', sysId: `s${k}`.padEnd(32, '0'), key: `ACME rule ${k}` }, assertion: 'active = true', band: 'A', status: 'verified' }); }
  rows.push({ locus: { table: 'sys_script', sysId: 's9'.padEnd(32, '0'), key: 'Rogue rule' }, assertion: 'active = true', band: 'A', status: 'verified' });
  for (let k = 0; k < 2; k += 1) { rows.push({ locus: { table: 'sys_script_client', sysId: `c${k}`.padEnd(32, '0'), key: `ACME cs ${k}` }, assertion: 'active = true', band: 'A', status: 'verified' }); }
  for (let k = 0; k < 4; k += 1) { rows.push({ locus: { table: 'sys_script_client', sysId: `d${k}`.padEnd(32, '0'), key: `plain cs ${k}` }, assertion: 'active = true', band: 'A', status: 'verified' }); }
  brain.upsertClaims(rows, { stage: 'harvest' });
  const namingClaim = seedDocClaim(brain);
  brain.upsertClaims([{
    locus: { table: 'stated-convention', sysId: 'set-naming'.padEnd(32, '0'), field: 'update-set-naming' },
    assertion: 'update-set-naming: Update sets are STRY-named.', band: null, rung: 'DOC', status: 'documented',
  }], { stage: 'orientation' });
  const setClaim = [...brain.claims().values()].find((c) => /STRY-named/.test(c.assertion)).id;
  brain.state.queue.statedConventions = [
    { kind: 'artifact-naming', statement: 'All artifacts carry the ACME prefix.', pattern: 'ACME*', testable: true, claimId: namingClaim },
    { kind: 'update-set-naming', statement: 'Update sets are STRY-named.', pattern: 'STRY*', testable: true, claimId: setClaim },
    { kind: 'logging', statement: 'Errors via gs.info.', pattern: null, testable: false, claimId: namingClaim },
  ];
  brain.save('fixture', {});
  return { root, brain, namingClaim, setClaim };
}

test('7.5: a check is measured against the run\'s own ledger before it is minted — the violated class is a finding, not a hook', () => {
  const { root } = gatesFixture('gates-measured');
  const built = renderLib.buildConventionGates(root);
  assertEqual(built.totals.minted, 2, `expected the naming and update-set gates:\n${JSON.stringify(built.totals)}`);
  const naming = built.gates.find((g) => g.kind === 'artifact-naming');
  assertEqual(naming.enforcedTables.join(','), 'sys_script',
    'sys_script_client is 2/6 compliant (33%) and was enforced anyway — the cheapest legal way to satisfy that hook is deleting it');
  assert(naming.measured.some((m) => m.table === 'sys_script_client'),
    'the excluded class is not in the measurement — the drop is silent');
  const none = built.prose.find((p) => p.kind === 'logging');
  assert(none && /enforcement/.test('enforcement: ' + none.enforcement) && /none — /.test(none.enforcement),
    'an unenforceable convention did not get its explicit enforcement: none — <why> line');
});

test('7.5: the minted hook refuses a fixture violation, passes compliant work, and skips updates', () => {
  const { root } = gatesFixture('gates-hook');
  const built = renderLib.writeConventionGates(root, { wiki: 'docs/wiki' });
  assert(built.written, 'gates were not written');
  const gate = path.resolve(root, built.gates.find((g) => g.kind === 'artifact-naming').path);
  const run = (payload) => require('child_process').spawnSync(process.execPath, [gate], { input: JSON.stringify(payload), encoding: 'utf8' });
  const bad = run({ tool_name: 'Bash', tool_input: { table: 'sys_script', name: 'Bad Rule' } });
  assertEqual(bad.status, 2, 'the violating create was not refused');
  assertIncludes(bad.stderr, 'claim', 'the refusal does not cite the convention claim');
  assertEqual(run({ tool_name: 'Bash', tool_input: { table: 'sys_script', name: 'ACME Good Rule' } }).status, 0, 'compliant work was refused');
  assertEqual(run({ tool_name: 'Bash', tool_input: { table: 'sys_script', sys_id: 'a'.repeat(32), name: 'Bad Rule' } }).status, 0,
    'an update to an existing record was refused — the gate constrains NEW work only, or agents delete it');
  assertEqual(run({ tool_name: 'Bash', tool_input: { table: 'sys_script_client', name: 'Bad CS' } }).status, 0,
    'the excluded (class-conditional) class was enforced anyway');
  const setGate = path.resolve(root, built.gates.find((g) => g.kind === 'update-set-naming').path);
  const runSet = (payload) => require('child_process').spawnSync(process.execPath, [setGate], { input: JSON.stringify(payload), encoding: 'utf8' });
  assertEqual(runSet({ tool_input: { table: 'sys_update_set', name: 'my scratch set' } }).status, 2, 'a non-STRY update set name passed');
  assertEqual(runSet({ tool_input: { table: 'sys_update_set', name: 'STRY0123456 - widget' } }).status, 0, 'a compliant set name was refused');
});

test('7.5: settings merge is idempotent and the conventions.md block carries pointer + none lines', () => {
  const { root } = gatesFixture('gates-settings');
  renderLib.writeConventionGates(root, { wiki: 'docs/wiki' });
  const first = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  renderLib.writeConventionGates(root, { wiki: 'docs/wiki' });
  const second = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assertEqual(first.hooks.PreToolUse.length, 2, 'the two gates did not reach settings.json');
  assertEqual(second.hooks.PreToolUse.length, 2, 'a second write duplicated the hook entries');
  const conv = fs.readFileSync(path.join(root, 'docs', 'wiki', 'conventions.md'), 'utf8');
  assertEqual((conv.match(/enforced by/g) || []).length, 2, 'the enforcement pointers are not on conventions.md');
  assertEqual((conv.match(/enforcement: none/g) || []).length, 1, 'the unenforceable convention has no none-line');
  assertEqual((conv.match(/snbrain:convention-enforcement:start/g) || []).length, 1, 'the block duplicated on rewrite');
});

test('7.5: render.validate refuses a check citing nothing, and a stated convention unaccounted on conventions.md', () => {
  const { root, brain, namingClaim, setClaim } = gatesFixture('gates-validate');
  // A proper conventions page first; the gate writer splices its enforcement block into it.
  fs.writeFileSync(path.join(root, 'docs', 'wiki', 'conventions.md'),
    `---\nclaims-rendered: 2\n---\n\n# Conventions\n\nartifact-naming: ACME prefix. \`${namingClaim}\`\nupdate-set-naming: STRY-named. \`${setClaim}\`\n`);
  renderLib.writeConventionGates(root, { wiki: 'docs/wiki' });
  for (const rel of ['CLAUDE.md']) {
    fs.writeFileSync(path.join(root, rel), 'seeded');
  }
  const art = {
    pages: [{ path: 'docs/wiki/conventions.md', status: 'doc-sourced', rendersClaims: [namingClaim, setClaim], tier: 'conventions' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 1 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:convention-gates'] },
  };
  const ctx = { brain, state: brain.state, stage: 'render' };
  assertEqual(STAGE_BY_ID.get('render').validate(ctx, art).filter((m) => /convention/.test(m)).length, 0,
    'a fully minted + accounted repo still fails the convention checks, so the guard has no legal answer');
  // (a) a gate citing a claim the ledger does not hold.
  const gatePath = path.join(root, '.claude', 'hooks', 'convention-rogue-000000.js');
  fs.writeFileSync(gatePath, '/* @enforces C-999999999999 */\nprocess.exit(0);\n');
  const rejA = STAGE_BY_ID.get('render').validate(ctx, art).filter((m) => /cite no live claim/.test(m));
  assertEqual(rejA.length, 1, 'a check citing nothing was accepted');
  fs.rmSync(gatePath);
  // (b) conventions.md loses the enforcement block.
  const convAbs = path.join(root, 'docs', 'wiki', 'conventions.md');
  fs.writeFileSync(convAbs, fs.readFileSync(convAbs, 'utf8').replace(/<!-- snbrain:convention-enforcement:start -->[\s\S]*<!-- snbrain:convention-enforcement:end -->/, ''));
  const rejB = STAGE_BY_ID.get('render').validate(ctx, art).filter((m) => /accounts for enforcement/.test(m));
  assertEqual(rejB.length, 1, `the silent enforcement gap was accepted, in ${STAGE_BY_ID.get('render').validate(ctx, art).length} rejection(s)`);
  assertIncludes(rejB[0], '0 of 3', 'the aggregate does not count its population');
});

// ---------------------------------------------------------------------------
// PLAN 7.6 — the persona kernel and the org map
// ---------------------------------------------------------------------------

group('T. persona kernel (7.6)');

const kernelfacts = require('./lib/kernelfacts.js');

/** Create every page the kernel template routes to, so a fixture kernel passes the F11 route check. */
function touchRoutes(root, wiki) {
  const w = wiki || 'docs/wiki';
  for (const rel of ['index.md', 'agent-api.md', 'hard-rules.md', 'registry-sys-ids.md', 'decisions.md', 'tbd.md', 'conventions.md', 'gotchas.md',
    'CONTRACT.md', 'deployment-matrix.md', 'glossary.md', 'INTERVIEW.md', 'evidence/index.md', 'evidence/source/index.md', 'evidence/read-only-proof.md']) {
    const abs = path.join(root, w, rel);
    if (!fs.existsSync(abs)) { putFile(root, `${w}/${rel}`, `---\ntitle: "${rel}"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# ${rel}\n`); }
  }
  fs.mkdirSync(path.join(root, w, 'stories'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
}

test('7.6: the instance landscape is counted from evidence — bare instance rows count, platform hosts never do', () => {
  const rows = [];
  for (let i = 0; i < 12; i += 1) { rows.push({ id: `C-a${i}`.padEnd(14, '0'), locus: { table: 'x_env', sysId: `e${i}` }, assertion: 'instance = devinst02' }); }
  for (let i = 0; i < 11; i += 1) { rows.push({ id: `C-b${i}`.padEnd(14, '0'), locus: { table: 'sys_rest_message', sysId: `r${i}` }, assertion: `rest_endpoint = https://prodinst01.service-now.com/api/x${i}` }); }
  rows.push({ id: 'C-doc'.padEnd(14, '0'), locus: { table: 'sys_ui_message', sysId: 'd1' }, assertion: 'message = see https://www.service-now.com/docs' });
  const m = renderLib.instanceMentions(rows);
  const by = Object.fromEntries(m.map((i) => [i.host, i.claims]));
  assertEqual(by.devinst02, 12, 'the bare `instance = <name>` rows did not count — PRODUCT-92\'s decisive evidence, missed again');
  assertEqual(by.prodinst01, 11, 'the URL leg is broken');
  assert(!('www' in by), 'a platform doc link counted as a customer instance');
});

test('7.6: a vocabulary expansion is a human\'s register-gap answer, never a substring match', () => {
  const root = scratchRepo('kf-vocab');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const claims = [];
  for (let i = 0; i < 3; i += 1) {
    claims.push({ locus: { table: 'sys_script', sysId: `v${i}`.padEnd(32, '0'), key: `QRT Selection ${i}` }, assertion: 'active = true', band: 'A', status: 'verified', evidence: { capturedResponse: { name: `QRT Selection ${i}` } } });
  }
  brain.upsertClaims(claims, { stage: 'harvest' });
  brain.upsertQuestions([
    { id: 'Q-eeeeeeeeeee1', __cliAllocated: true, signal: 'V', gate: 'register-gap', status: 'answered', locus: [{ sysId: 'v0' }], question: 'What does QRT stand for on this engagement?' },
    { id: 'Q-eeeeeeeeeee2', __cliAllocated: true, signal: 'V', gate: 'anomaly', status: 'answered', locus: [{ sysId: 'v1' }], question: 'Why is the QRT rule inactive?' },
  ]);
  brain.upsertDecisions([
    Object.assign({}, DEC_BASE, { statement: 'QRT is case bedrijfsongeval, the incident intake class.', derivedFrom: 'interview', answerProvenance: Object.assign({}, DEC_BASE.answerProvenance, { fromQuestion: 'Q-eeeeeeeeeee1' }) }),
  ]);
  const built = kernelfacts.buildKernelFacts(root);
  assertIncludes(built.facts.vocabulary.section, 'case bedrijfsongeval', 'the register-gap answer did not become the expansion');
  // Now the trap: only a NON-register-gap decision mentions the token -> unexpanded, honestly.
  const root2 = scratchRepo('kf-vocab2');
  const brain2 = Brain.init({ root: root2, instance: 'x', stageOrder: STAGE_ORDER });
  brain2.upsertClaims(claims, { stage: 'harvest' });
  brain2.upsertQuestions([{ id: 'Q-eeeeeeeeeee2', __cliAllocated: true, signal: 'V', gate: 'anomaly', status: 'answered', locus: [{ sysId: 'v1' }], question: 'Why is the QRT rule inactive?' }]);
  brain2.upsertDecisions([
    Object.assign({}, DEC_BASE, { statement: 'The QRT rule is inactive because the workspace form sets the value.', derivedFrom: 'interview', answerProvenance: Object.assign({}, DEC_BASE.answerProvenance, { fromQuestion: 'Q-eeeeeeeeeee2' }) }),
  ]);
  const built2 = kernelfacts.buildKernelFacts(root2);
  // The needle must sit on the QRT line itself: another token's honest "unexpanded" would
  // otherwise satisfy this while QRT carries a mention passed off as an expansion.
  const mboLine = built2.facts.vocabulary.section.split('\n').find((l) => /\*\*QRT\*\*/i.test(l)) || '';
  assertIncludes(mboLine, 'unexpanded', 'a decision that merely MENTIONS the token was passed off as its expansion — the substring trap');
});

test('7.6: the org map renders named groups, and renders raw-pair-only or empty ledgers as the DECLARED gap', () => {
  const named = scratchRepo('kf-org-named');
  const b1 = Brain.init({ root: named, instance: 'x', stageOrder: STAGE_ORDER });
  b1.upsertClaims([
    { locus: { table: 'sys_user_group', sysId: 'g1'.padEnd(32, '0'), key: 'ACME - BackOffice' }, assertion: 'name = ACME - BackOffice', band: 'A', status: 'verified' },
    { locus: { table: 'sys_group_has_role', sysId: 'h1'.padEnd(32, '0') }, assertion: 'role = sn_ohs_im.acme_backoffice', band: 'A', status: 'verified', evidence: { capturedResponse: { group: 'g1'.padEnd(32, '0') } } },
  ], { stage: 'harvest' });
  const org1 = kernelfacts.buildKernelFacts(named).facts.orgMap.section;
  assertIncludes(org1, 'ACME - BackOffice', 'a named group did not render');
  assertIncludes(org1, 'acme_backoffice', 'the group\'s role grant did not render');

  const pairs = scratchRepo('kf-org-pairs');
  const b2 = Brain.init({ root: pairs, instance: 'x', stageOrder: STAGE_ORDER });
  b2.upsertClaims([{ locus: { table: 'sys_user_role_contains', sysId: 'p1'.padEnd(32, '0') }, assertion: 'contains = 73a0e796a3372110fb32815026fcdabc', band: 'A', status: 'verified' }], { stage: 'harvest' });
  const org2 = kernelfacts.buildKernelFacts(pairs).facts.orgMap.section;
  assertIncludes(org2, 'raw sys_id pairs', 'a table of bare sys_ids would have rendered as an org map — worse than the declared gap');
  assertIncludes(org2, 'Do not invent', 'the gap does not carry the no-improvisation rule');

  const empty = scratchRepo('kf-org-empty');
  Brain.init({ root: empty, instance: 'x', stageOrder: STAGE_ORDER });
  const org3 = kernelfacts.buildKernelFacts(empty).facts.orgMap.section;
  assertIncludes(org3, 'zero', 'the empty ledger\'s org map is not honestly empty');
  assertIncludes(org3, 'Do not invent', 'the empty gap does not carry the no-improvisation rule');
});

test('7.6: render-kernel refuses a placeholder in a required slot, and renders the persona kernel once the facts are in', () => {
  const root = scratchRepo('kf-kernel');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(Array.from({ length: 11 }, (_, i) => (
    { locus: { table: 'x_env', sysId: `e${String(i).padStart(2, '0')}`.padEnd(32, 'f') }, assertion: 'instance = devinst02', band: 'A', status: 'verified' }
  )), { stage: 'harvest' });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'kernel'), { recursive: true });
  fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'tools', 'render-kernel.js'), path.join(root, 'tools', 'render-kernel.js'));
  fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'kernel', 'CLAUDE.template.md'), path.join(root, 'kernel', 'CLAUDE.template.md'));
  const config = {
    customer: { name: 'the pilot customer', identityLine: 'the ACME build' },
    scopes: { app: 'sn_ohs_im' },
    instances: { dev: 'devinst02' },
    paths: { wikiRoot: 'docs/wiki' },
    tooling: { docPipelineSkill: 'write-sn-documentation', agentPortFile: '.claude/agent-port' },
    naming: { storySetFormat: 'STRY<num> - <desc>' },
    ledger: { instanceLine: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts' },
    vocabulary: { section: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts' },
    orgMap: { section: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts' },
  };
  fs.writeFileSync(path.join(root, 'product.config.json'), JSON.stringify(config, null, 2));
  touchRoutes(root);   // F11: every route the template names must resolve, or render-kernel refuses
  const r1 = require('child_process').spawnSync(process.execPath, [path.join(root, 'tools', 'render-kernel.js')], { encoding: 'utf8' });
  assertEqual(r1.status, 1, 'render-kernel wrote a kernel with a hole in it — a required slot still held its placeholder');
  assertIncludes(r1.stderr, 'ledger.instanceLine', 'the refusal does not name the unfilled slot');

  kernelfacts.writeKernelFacts(root);
  const r2 = require('child_process').spawnSync(process.execPath, [path.join(root, 'tools', 'render-kernel.js')], { encoding: 'utf8' });
  assertEqual(r2.status, 0, `render-kernel still refuses after the facts were filled:\n${r2.stderr}`);
  const kernel = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assertIncludes(kernel, 'standing architect', 'the kernel does not open with the persona line');
  assertIncludes(kernel, 'devinst02 (11 claims)', 'the instance landscape is not the ledger\'s');
  assertIncludes(kernel, 'Domain vocabulary', 'the vocabulary section is missing');
  assertIncludes(kernel, 'Org map', 'the org-map section is missing');
  assertIncludes(kernel, 'Do not invent groups', 'the org map is not the declared gap');
});

test('7.6: render.validate refuses a shipped placeholder config and an unmentioned witnessed instance', () => {
  const { ctx, art } = renderCtx('kf-validate', FULL_PERSONAS);
  ctx.brain.upsertClaims(Array.from({ length: 11 }, (_, i) => (
    { locus: { table: 'x_env', sysId: `w${String(i).padStart(2, '0')}`.padEnd(32, 'f') }, assertion: 'instance = accinst01', band: 'A', status: 'verified' }
  )), { stage: 'harvest' });
  // (a) the delivered config ships its own prompt.
  fs.writeFileSync(path.join(ctx.brain.root, 'product.config.json'),
    JSON.stringify({ paths: { wikiRoot: 'docs/wiki' }, instances: { test: 'OPTIONAL — test instance name' } }, null, 2));
  const rej = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(rej.filter((m) => /placeholder-shaped value/.test(m)).length, 1,
    `the shipped placeholder was accepted:\n${rej.join('\n')}`);
  // (b) accinst01 is witnessed in 11 claims and rendered nowhere.
  const unm = rej.filter((m) => /appear\s+nowhere in the rendered deliverable/.test(m));
  assertEqual(unm.length, 1, `the unmentioned witnessed instance was accepted:\n${rej.join('\n')}`);
  assertIncludes(unm[0], 'accinst01 (11 claims)', 'the rejection does not name the instance and its evidence weight');
  // The legal fix: name it in the deliverable, drop the placeholder.
  fs.writeFileSync(path.join(ctx.brain.root, 'product.config.json'),
    JSON.stringify({ paths: { wikiRoot: 'docs/wiki' }, instances: { test: null } }, null, 2));
  fs.appendFileSync(path.resolve(ctx.brain.root, art.kernel.path), '\ninstances witnessed: accinst01 (11 claims)\n');
  const rej2 = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(rej2.filter((m) => /placeholder-shaped value|appear\s+nowhere in the rendered deliverable/.test(m)).length, 0,
    `the legal fixes do not satisfy the checks:\n${rej2.join('\n')}`);
});

// ---------------------------------------------------------------------------
// PLAN 7.7 — source and scar tissue at day zero
// ---------------------------------------------------------------------------

group('U. source and scar tissue (7.7)');

const gotchaLib = require('./gotcha.js');

test('7.7a: the source page prints the LONGEST body the brain holds, and says when the claim held a window', () => {
  /*
   * The fixture-coincidence rule, applied on purpose: the raw bodies are LARGER than the
   * claim's stored window, in BOTH raw shapes the field has produced (run 5's {rows:[…]},
   * run 4's {sysId, response}). A generator that reads only the claim window passes every
   * same-size fixture and ships 1.4KB of a 12KB script.
   */
  const root = scratchRepo('source-appendix');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const windowBody = '// window\n' + 'a'.repeat(400);
  const fullBody5 = '// full run5-shape body\n' + 'b'.repeat(3000) + '\n~~~~\nvar tildes = true;';
  const fullBody4 = '// full run4-shape body\n' + 'c'.repeat(2500);
  const hugeBody = '// huge\n' + 'd'.repeat(30000);
  const mk = (sysId, assertion) => ({
    locus: { table: 'sys_script', sysId, field: 'script' },
    assertion, band: 'A', rung: 'L3', status: 'verified', kind: 'behaviour',
    behaviour: { bodyField: 'script', bodyEmpty: false },
    evidence: { capturedResponse: { name: `ACME ${sysId.slice(0, 4)}`, script: windowBody } },
  });
  brain.upsertClaims([
    mk('s5'.padEnd(32, 'a'), 'Routes the case by region.'),
    mk('s4'.padEnd(32, 'b'), 'Validates the state transition.'),
    mk('s6'.padEnd(32, 'c'), 'Truncation case.'),
    Object.assign(mk('s7'.padEnd(32, 'd'), 'No body anywhere.'), { evidence: { capturedResponse: { name: 'bodiless' } } }),
  ], { stage: 'explain' });
  fs.mkdirSync(path.join(root, '.brain', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brain', 'raw', 'verify.ndjson'),
    `${JSON.stringify({ kind: 'batch', table: 'sys_script', rows: [{ sys_id: 's5'.padEnd(32, 'a'), script: fullBody5 }] })}\n` +
    `${JSON.stringify({ kind: 'row', table: 'sys_script', sysId: 's4'.padEnd(32, 'b'), response: { script: fullBody4 } })}\n` +
    `${JSON.stringify({ kind: 'row', table: 'sys_script', sysId: 's6'.padEnd(32, 'c'), response: { script: hugeBody } })}\n`);
  const built = renderLib.buildSourceAppendix(root);
  assertEqual(built.totals.fromRaw, 3, 'the raw full bodies did not win over the claim windows — a window is not the script');
  assertEqual(built.totals.bodiless, 1, 'the bodiless artifact is not counted');
  assertEqual(built.totals.truncated, 1, 'the page-cap truncation is not counted');
  const p5 = built.pages.find((p) => p.path.includes('s5aaaa'));
  assertIncludes(p5.body, 'b'.repeat(3000), 'the full run5-shape body is not quotable from the page');
  assertIncludes(p5.body, 'window holds ' + windowBody.length, 'the page does not say the claim held a shorter window');
  assert(/^~{5,}javascript$/m.test(p5.body), 'the fence does not outrun the body\'s own tilde run — the page un-fences itself');
  const p4 = built.pages.find((p) => p.path.includes('s4bbbb'));
  assertIncludes(p4.body, 'c'.repeat(2500), 'the run4-shape ({sysId, response}) raw body was not found — 0-from-raw on the run PRODUCT-100 was filed against');
  const p6 = built.pages.find((p) => p.path.includes('s6cccc'));
  assertIncludes(p6.body, 'TRUNCATED at', 'a silently truncated body reads as complete source');
  for (const p of built.pages.filter((x) => x.claimIds.length)) {
    assertEqual(renderLib.claimIdsIn(p.body).size, 1, 'a source page prints claim-id-shaped tokens beyond its behaviour claim');
    assertEqual(renderLib.frontmatterNumber(p.body, 'claims-rendered'), 1, 'claims-rendered is not derived');
  }
  const index = built.pages[built.pages.length - 1];
  assertIncludes(index.body, 'none captured', 'the bodiless artifact vanished from the index instead of being listed without a page');
});

test('7.7b: the corpus ships in the scaffold with its ownership rule, and a confirmed gotcha reaches the next install', () => {
  const shipped = path.join(FRAMEWORK_ROOT, 'wiki-scaffold', 'gotchas-platform-catalogue.md');
  assert(fs.existsSync(shipped), 'the catalogue is not in wiki-scaffold — nothing ships it at day zero');
  const text = fs.readFileSync(shipped, 'utf8');
  assertIncludes(text, 'Ownership rule', 'the catalogue does not commit its ownership rule');
  assertIncludes(text, gotchaLib.CORPUS_END, 'the catalogue has no corpus markers, so nothing can append to it');
  assert(gotchaLib.listEntries(shipped).length >= 5, 'the seed corpus is empty — day zero ships no scar tissue');

  // A confirmed gotcha travels: corpus copy -> append -> "fresh install" (scaffold copy) carries it.
  const corpus = path.join(SCRATCH, 'corpus.md');
  fs.copyFileSync(shipped, corpus);
  const entry = gotchaLib.entryText({ title: 'Selftest gotcha', body: 'Confirmed once, shipped forever.', by: 'a named expert', engagement: 'selftest', at: '2026-08-20' });
  const r1 = gotchaLib.appendToCatalogue(corpus, entry);
  assert(r1.ok && !r1.already, 'the append failed');
  const after = fs.readFileSync(corpus, 'utf8');
  assert(after.indexOf(entry.id) < after.indexOf(gotchaLib.CORPUS_END),
    'the entry landed outside the corpus markers, where the next append machinery cannot see it');
  const r2 = gotchaLib.appendToCatalogue(corpus, entry);
  assert(r2.ok && r2.already, 'a second append duplicated the entry instead of recognising it');
  assertEqual((fs.readFileSync(corpus, 'utf8').match(new RegExp(entry.id, 'g')) || []).length, 1, 'the entry is in the file twice');
  const freshInstallWiki = path.join(SCRATCH, 'fresh-install-wiki');
  fs.mkdirSync(freshInstallWiki, { recursive: true });
  fs.copyFileSync(corpus, path.join(freshInstallWiki, 'gotchas-platform-catalogue.md'));
  assert(gotchaLib.listEntries(path.join(freshInstallWiki, 'gotchas-platform-catalogue.md')).some((e) => e.id === entry.id),
    'a gotcha confirmed on one engagement is absent from the next install');
});

test('7.7b: the ownership rule is enforced — a skill-scoped gotcha is refused and told where it belongs', () => {
  const corpus = path.join(SCRATCH, 'corpus-refuse.md');
  fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'wiki-scaffold', 'gotchas-platform-catalogue.md'), corpus);
  const before = gotchaLib.listEntries(corpus).length;
  const r = require('child_process').spawnSync(process.execPath,
    [path.join(FRAMEWORK_ROOT, 'tools', 'snbrain', 'gotcha.js'), '--add', '--class', 'skill',
      '--title', 'x', '--body', 'y', '--by', 'z', '--engagement', 'w', '--corpus', corpus], { encoding: 'utf8' });
  assertEqual(r.status, 1, 'a skill-scoped gotcha entered the platform catalogue — the ownership rule is decorative');
  assertIncludes(r.stdout, 'owning skill', 'the refusal does not say where the entry belongs');
  assertEqual(gotchaLib.listEntries(corpus).length, before, 'the refused entry was appended anyway');
  // And engagement propagation via --root lands in that repo's configured wiki.
  const engagement = scratchRepo('gotcha-engagement');
  fs.copyFileSync(corpus, path.join(engagement, 'docs', 'wiki', 'gotchas-platform-catalogue.md'));
  const ok = require('child_process').spawnSync(process.execPath,
    [path.join(FRAMEWORK_ROOT, 'tools', 'snbrain', 'gotcha.js'), '--add',
      '--title', 'Engagement-confirmed', '--body', 'bit us on story X.', '--by', 'a named expert',
      '--engagement', 'selftest', '--corpus', corpus, '--root', engagement], { encoding: 'utf8' });
  assertEqual(ok.status, 0, `the platform add failed:\n${ok.stdout}${ok.stderr}`);
  assert(gotchaLib.listEntries(path.join(engagement, 'docs', 'wiki', 'gotchas-platform-catalogue.md'))
    .some((e) => /engagement-confirmed/.test(e.id)),
    'the engagement\'s own copy did not receive the entry it confirmed');
});

// ---------------------------------------------------------------------------
// PRODUCT-101 — elapsed time is a third axis, and something sizes it
// ---------------------------------------------------------------------------

group('V. the clock (PRODUCT-101)');

/** A harvest mid-run: entered `elapsedMin` ago, one 97-minute outlier among 7-minute iterations. */
function clockCtx(opts) {
  const o = opts || {};
  const iters = [{ n: 1, accepted: true, elapsedMs: 97 * 60000, apiCalls: 30, claimsAdded: 100 }];
  for (let n = 2; n <= (o.iterations || 6); n += 1) {
    iters.push({ n, accepted: true, elapsedMs: 7 * 60000, apiCalls: 30, claimsAdded: 100 });
  }
  const areas = Array.from({ length: o.areas === undefined ? 24 : o.areas }, (_, i) => `area-${String(i).padStart(2, '0')}`);
  return {
    brain: { claims: () => new Map() },
    state: {
      instance: 'x',
      config: { stageWallClockHours: o.hours === undefined ? 4 : o.hours },
      stages: { harvest: { status: 'active', enteredAt: new Date(Date.now() - (o.elapsedMin === undefined ? 210 : o.elapsedMin) * 60000).toISOString(), iterations: iters, total: iters.length } },
      queue: { harvestAreas: areas, harvestDone: areas.slice(0, o.done === undefined ? 6 : o.done), harvestAreaDetail: areas.map((id) => ({ id, tables: ['sys_script'], bandARows: 10 })) },
      budget: { maxCalls: 5000, usedCalls: 200 },
      stamps: {}, facts: {},
    },
    stage: 'harvest',
  };
}

test('PRODUCT-101: pacing prices the future on the MEDIAN — one 97-minute outlier must not halve the projection', () => {
  const ctx = clockCtx({});
  const pace = stages.stagePacing(ctx, { stage: 'harvest', remaining: 18 });
  assert(pace, 'six accepted iterations is a measurable rate');
  assert(Math.abs(pace.medianMs - 7 * 60000) < 60000,
    `the median was dragged by the outlier (got ${(pace.medianMs / 60000).toFixed(1)} min) — run 5's iteration 2 took 97 minutes against a 7-minute median, and a mean paced by it under-projects the whole rest of the run`);
  assertEqual(stages.stagePacing(clockCtx({ iterations: 1 }), { stage: 'harvest', remaining: 5 }), null,
    'one iteration is an anecdote, not a rate');
  // 210 of 240 min elapsed at ~7 min/iteration -> ~4 fit against 18 remaining.
  assert(!pace.fits && pace.shortfall >= 10, `the shortfall is not projected: ${JSON.stringify(pace)}`);
});

test('PRODUCT-101: the harvest brief carries the pace and NAMES the at-risk tail', () => {
  const goal = STAGE_BY_ID.get('harvest').goal(clockCtx({}));
  assertIncludes(goal, 'PACE:', 'the clock is not briefed — the agent finds out at the close, like run 5\'s operator did');
  assertIncludes(goal, 'DOES NOT FIT', 'a queue that cannot fit is briefed as if it could');
  assertIncludes(goal, 'area-23', 'the at-risk tail is not named — shedding load deliberately needs names');
  assertIncludes(goal, 'override --hours', 'the brief does not name the clock\'s own exit');
  const fitsGoal = STAGE_BY_ID.get('harvest').goal(clockCtx({ elapsedMin: 20, areas: 8, done: 6 }));
  assertIncludes(fitsGoal, 'The queue fits', 'a fitting queue should say so, not stay silent');
});

test('PRODUCT-101: the projected overrun is FILED as one warning finding the first time it appears', () => {
  const ctx = clockCtx({});
  const art = { area: 'area-06', claims: [], coverage: {}, findings: [] };
  const applied = STAGE_BY_ID.get('harvest').apply(ctx, art);
  const pacing = applied.findings.filter((f) => f.check === 'wall-clock-pacing');
  assertEqual(pacing.length, 1, 'the overrun was not filed — run 5\'s operator learned the clock had won from the close itself');
  assertEqual(pacing[0].severity, 'warning', 'pacing blocks nothing; it informs');
  assertIncludes(pacing[0].message, 'override --hours', 'the finding does not name the sanctioned exit');
  const fitsCtx = clockCtx({ elapsedMin: 20, areas: 8, done: 5 });
  const ok = STAGE_BY_ID.get('harvest').apply(fitsCtx, { area: 'area-05', claims: [], coverage: {}, findings: [] });
  assertEqual(ok.findings.filter((f) => f.check === 'wall-clock-pacing').length, 0,
    'a fitting queue was flagged anyway — a warning that always fires is one the operator learns to ignore');
});

test('PRODUCT-101: the clock has its own override verb, attributed like every other', () => {
  const root = scratchRepo('clock-override');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const r = cli(['override', '--hours', '6', '--by', 'a named operator', '--reason', 'the queue does not fit the default horizon', '--root', root]);
  assertEqual(r.code, 0, `override --hours failed: ${r.stdout}${r.stderr}`);
  const after = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(after.config.stageWallClockHours, 6, 'the horizon did not move');
  const ov = (after.overrides || []).find((x) => x.kind === 'hours');
  assert(ov && ov.by === 'a named operator' && ov.to === 6, 'the override is not attributed in the record');
  const r2 = cli(['override', '--hours', '6', '--root', root]);
  assert(r2.code !== 0, 'an unattributed hours override was accepted — that is how a schema drifts');
});

// ---------------------------------------------------------------------------
// PLAN 6.11 — the brain-surface manifest, machine-checked
// ---------------------------------------------------------------------------

group('W. scoring surface (6.11)');

const scoringSurface = require('./scoring-surface.js');

test('6.11: the manifest decides every file class — raw is excluded, ledgers are ledger, wiki is wiki, novelty is an ERROR', () => {
  assertEqual(scoringSurface.classify('.brain/raw/verify.ndjson').tier, 'excluded',
    'raw counted toward a score — the exact ambiguity that moved ~8 of 10 re-score points');
  assertEqual(scoringSurface.classify('.brain/claims.jsonl').tier, 'ledger',
    'the committed ledger lost its own column');
  assertEqual(scoringSurface.classify('docs/wiki/processes/vendorx-intake.md').tier, 'wiki', 'the deliverable is not the leading basis');
  assertEqual(scoringSurface.classify('CLAUDE.md').tier, 'wiki', 'the kernel is what an agent reads first');
  assertEqual(scoringSurface.classify('autocomplete/GlideQuery.js').tier, 'excluded',
    'a transport file counted — crediting a fact found there credits the tool, not the brain');
  assertEqual(scoringSurface.classify('some/novel/thing.xyz').tier, 'UNDECLARED',
    'an unknown file class got a default tier — the manifest must answer the question, not just list paths');
  // And the checker refuses a repo holding an undeclared class.
  const root = scratchRepo('surface-check');
  fs.writeFileSync(path.join(root, 'docs', 'wiki', 'index.md'), '# w');
  fs.mkdirSync(path.join(root, 'mystery'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mystery', 'blob.bin'), 'x');
  const r = require('child_process').spawnSync(process.execPath,
    [path.join(FRAMEWORK_ROOT, 'tools', 'snbrain', 'scoring-surface.js'), '--root', root], { encoding: 'utf8' });
  assertEqual(r.status, 1, 'a repo with an undeclared file class passed the surface check');
  assertIncludes(r.stdout, 'mystery/blob.bin', 'the checker does not name what it could not classify');
});

group('G. accounting');

/**
 * PRODUCT-79 / PRODUCT-80. Build a page rendering N claims, with control over what the page
 * actually SHOWS — which is the whole point: the ledger content and the page content are the two
 * things the previous run let drift apart, silently, across all 160 pages.
 */
function assertionCtx(name, assertions, pageBody) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(assertions.map((a, i) => ({
    locus: { table: 'sys_ui_action', sysId: `s${i}`.padEnd(32, '0'), key: `ACME button ${i}` },
    assertion: a, band: 'A', status: 'verified',
  })), { stage: 'verify' });
  const ids = [...brain.claims().values()].map((c) => c.id);
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  /*
   * PRODUCT-95's accounting is orthogonal to what these tests measure, and must be satisfied
   * anyway: the page cites every id it renders and declares the count it cites. Appended as a
   * footer so `pageBody` — which is the thing under test — is unchanged.
   */
  put('docs/wiki/registry/buttons.md',
    `---\nclaims-rendered: ${new Set(ids).size}\n---\n\n${pageBody}\n\n## Evidence\n\n${ids.map((id) => `- \`${id}\``).join('\n')}\n`);
  return {
    ctx: { brain, state: brain.state, stage: 'render' },
    art: {
      pages: [{ path: 'docs/wiki/registry/buttons.md', status: 'verified', rendersClaims: ids, tier: 'registry' }],
      kernel: { path: 'CLAUDE.md', routingEntries: 3 },
      settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
    },
  };
}

test('PRODUCT-79: an assertion-free page is a FINDING, and never a rejection', () => {
  const live = ['active = true', 'order = 100', 'form_button = true', 'when = before', 'condition is empty'];
  // The exact shape all 160 pages of run 6ef14f5562 shipped: identity columns, no assertion.
  const inventory = '# Buttons\n\n| Table | Name | sys_id | Story | Verify |\n|---|---|---|---|---|\n' +
    live.map((_, i) => `| sys_ui_action | ACME button ${i} | s${i} | STRY0001 | draft |`).join('\n') + '\n';
  const { ctx, art } = assertionCtx('rn-assert-missing', live, inventory);
  const rej = RENDER.validate(ctx, art);
  /*
   * NOT a rejection. Replayed against the real run this rule hit 136 of 148 pages in one artifact;
   * render's cap is 3, so three such artifacts terminate the run `exhausted`, and the cheapest
   * legal escape was trimming rendersClaims to four per page — deleting the evidence graph to
   * satisfy a guard about quality.
   */
  assertEqual(rej.length, 0, `a quality signal was raised as a rejection, which can terminate the run:\n${rej.join('\n')}`);
  const f = RENDER.apply(ctx, art).findings.filter((x) => x.check === 'pages-render-loci-not-assertions');
  assertEqual(f.length, 1, 'no finding was minted for a page that shows none of its assertions');
  assert(/citation graph/.test(f[0].message), 'the finding does not warn against trimming rendersClaims');
});

test('PRODUCT-79: distinct assertions are counted, and a truncated one still counts as shown', () => {
  // Assertions are heavily duplicated on a real ledger, so counting CLAIMS let one distinct string
  // satisfy a 174-claim page. And artifactTable() truncates at 90 chars, so the longest assertions
  // — the explain behaviour claims — could never count as shown by the framework's own renderer.
  const long = `script asserts ${'x'.repeat(200)}`;
  const claims = ['active = true', 'active = true', 'active = true', 'active = true', 'active = true', long];
  const page = `# P\n\n| Artifact | Asserts |\n|---|---|\n| a | active = true |\n| b | ${long.slice(0, 89)}… |\n`;
  const { ctx, art } = assertionCtx('rn-assert-distinct', claims, page);
  RENDER.validate(ctx, art);
  const q = ctx.renderQuality.pages[0];
  assertEqual(q.wanted, 2, 'duplicated assertions were counted as distinct demands');
  assertEqual(q.shown, 2, 'a truncated long assertion was not credited as shown');
  assertEqual(RENDER.apply(ctx, art).findings.filter((x) => x.check === 'pages-render-loci-not-assertions').length, 0,
    'an honest page was faulted');
});

test('PRODUCT-79: the same page WITH an asserts column passes', () => {
  const live = ['active = true', 'order = 100', 'form_button = true', 'when = before', 'condition is empty'];
  const withValues = '# Buttons\n\n| Table | Name | Asserts | sys_id |\n|---|---|---|---|\n' +
    live.map((a, i) => `| sys_ui_action | ACME button ${i} | ${a} | s${i} |`).join('\n') + '\n';
  const { ctx, art } = assertionCtx('rn-assert-present', live, withValues);
  const rej = RENDER.validate(ctx, art);
  assertEqual(rej.filter((m) => /shows the assertion of only/.test(m)).length, 0,
    `a page that shows its values was rejected:\n${rej.join('\n')}`);
});

test('PRODUCT-80: a dead artifact rendered as live is a BLOCKING finding, marked per row', () => {
  const mixed = ['active = true', 'active = false', 'order = 100', 'form_button = true', 'when = before'];
  const body = '# Buttons\n\n| Table | Name | Asserts |\n|---|---|---|\n' +
    mixed.map((a, i) => `| sys_ui_action | ACME button ${i} | ${a} |`).join('\n') + '\n';
  const { ctx, art } = assertionCtx('rn-dead-unmarked', mixed, body);
  assertEqual(RENDER.validate(ctx, art).length, 0, 'a quality signal was raised as a rejection');
  const f = RENDER.apply(ctx, art).findings.filter((x) => x.check === 'retired-artifacts-render-as-live');
  assertEqual(f.length, 1, 'a retired artifact rendered as live minted no finding');
  assertEqual(f[0].severity, 'blocking', 'rendering a dead artifact as live is not blocking');
  assert(/reads as live/.test(f[0].message), 'the finding does not say why this is worse than a gap');
});

test('PRODUCT-80: the marker must be on the artifact\'s own row, not anywhere on the page', () => {
  const mixed = ['active = true', 'active = false', 'order = 100', 'form_button = true', 'when = before'];
  const rows = (marker) => '# Buttons\n\n| Table | Name | Asserts |\n|---|---|---|\n' +
    mixed.map((a, i) => `| sys_ui_action | ${i === 1 ? marker : ''}ACME button ${i} | ${a} |`).join('\n') + '\n';
  // Marked on its own row: clean.
  const ok = assertionCtx('rn-dead-marked', mixed, rows('**RETIRED** '));
  RENDER.validate(ok.ctx, ok.art);
  assertEqual(RENDER.apply(ok.ctx, ok.art).findings.filter((x) => x.check === 'retired-artifacts-render-as-live').length, 0,
    'a page that marks the dead row was still faulted');
  /*
   * A page-wide search passed 15 real pages holding up to 24 unmarked retirements each, cleared by
   * one unrelated sentence — and `disabled` is a declared shape column, so a live policy action
   * rendering `disabled = false` self-cleared every retirement on its page.
   */
  const decoy = rows('') + '\n> The anonymous producer is deliberately **inactive**; see decisions.md.\n';
  const bad = assertionCtx('rn-dead-decoy', mixed, decoy);
  RENDER.validate(bad.ctx, bad.art);
  assertEqual(RENDER.apply(bad.ctx, bad.art).findings.filter((x) => x.check === 'retired-artifacts-render-as-live').length, 1,
    'an unrelated sentence elsewhere on the page disarmed the retirement check');
});

test('1.5: a process page without Personas & Permissions is refused', () => {
  const { ctx, art } = renderCtx('ren-no-personas', '# Case behandelen\n\n## Overview\n\nSome prose.\n');
  const rej = RENDER.validate(ctx, art);
  assertIncludes(rej.join(' '), 'no "## Personas & Permissions" section',
    'a process page shipped without the one section no instance read can produce');
});

test('1.5: a Personas section missing its mandated subsections is refused', () => {
  const { ctx, art } = renderCtx('ren-partial-personas', '# X\n\n## Personas & Permissions\n\n### Who works this process\n\n| Persona |\n|---|\n| Melder |\n');
  const rej = RENDER.validate(ctx, art);
  assertIncludes(rej.join(' '), 'mandated subsections', 'a partial personas section was accepted');
  assertIncludes(rej.join(' '), 'Where each rule is enforced', 'the rejection did not name which subsections are absent');
});

test('1.5: documenting what personas may DO with no denial column is refused', () => {
  const body = FULL_PERSONAS.replace('| Action | Gate | May | May not |', '| Action | Gate | May |').replace(/\| Melder — deliberate[^|]*\|/, '|');
  const { ctx, art } = renderCtx('ren-no-denial', body);
  const rej = RENDER.validate(ctx, art);
  assertIncludes(rej.join(' '), 'May not', 'a permissions table with no denial column was accepted — an absent denial and a deliberate prohibition are the same absence in the data');
});

test('1.5: a complete process page is accepted', () => {
  const { ctx, art } = renderCtx('ren-personas-ok', FULL_PERSONAS);
  const rej = RENDER.validate(ctx, art);
  assertEqual(rej.length, 0, `a complete process page was rejected:\n  ${rej.join('\n  ')}`);
});

/*
 * PRODUCT-86. The scaffold is installed AT THE ENGAGEMENT'S wiki root, not at `wiki-scaffold` —
 * `install.js` remaps it to `docs/wiki` by default. Resolving only the framework-repo path made
 * this test fail on every engagement copy of the suite for a file that is present under its real
 * name, which is noise in exactly the place a real missing-file failure has to be readable.
 */
function scaffoldRoot() {
  const repo = path.resolve(__dirname, '..', '..');
  for (const rel of ['wiki-scaffold', 'docs/wiki']) {
    if (fs.existsSync(path.join(repo, rel, 'processes', '_TEMPLATE.md'))) { return path.join(repo, rel); }
  }
  return path.join(repo, 'wiki-scaffold');
}

test('1.5: the shipped process template itself satisfies the contract it documents', () => {
  const tpl = fs.readFileSync(path.join(scaffoldRoot(), 'processes', '_TEMPLATE.md'), 'utf8');
  assert(/^##\s+Personas\s*&\s*Permissions\s*$/im.test(tpl), 'the shipped template has no Personas & Permissions section');
  for (const h of ['Who works this process', 'What each persona may DO', 'What each persona may SEE', 'Where each rule is enforced']) {
    assert(new RegExp(`^###\\s+${h}\\s*$`, 'im').test(tpl), `the shipped template is missing the mandated subsection "${h}"`);
  }
  assertIncludes(tpl, 'May not', 'the shipped template has no denial column');
  assertIncludes(tpl, 'What it does', 'the shipped template has no behaviour column, which is the whole point of the explain stage');
  const contract = fs.readFileSync(path.join(scaffoldRoot(), 'CONTRACT.md'), 'utf8');
  assertIncludes(contract, 'Personas & Permissions', 'CONTRACT.md lost the personas clause again');
});

test('PLATFORM-3: a field-to-field comparison is refused — it silently returns the wrong set', () => {
  /*
   * `sys_updated_on>sys_created_on` parses the right operand as a STRING LITERAL. Measured on
   * the reference instance it returned 2,557,188 rows — the table total minus the rows with an
   * empty left operand — with no error and a completely plausible-looking number. Two of the
   * four briefed change-detection signals were unusable because of it.
   */
  for (const q of ['sys_updated_on>sys_created_on', 'sys_updated_by!=sys_created_by', 'active=true^sys_updated_by!=sys_created_by']) {
    const out = stages.lintEncodedQuery(q);
    assert(out.length > 0, `"${q}" was not flagged as a field-to-field comparison`);
    assertIncludes(out[0], 'string literal', 'the explanation does not say why the query is wrong');
  }
});

test('PLATFORM-3: the lint does not fire on ordinary queries', () => {
  // A lint that fires on correct queries gets switched off, and then the trap is back.
  for (const q of ['sys_idIN9ec847db1b8a43909e2aa934604bcb42', 'active=true^ORDERBYname',
    'sys_mod_count>0', 'nameSTARTSWITHACME', 'sys_created_on>2024-01-01', 'sys_class_name=sys_script']) {
    assertEqual(stages.lintEncodedQuery(q).length, 0, `"${q}" is a legitimate query and was flagged`);
  }
});

test('PLATFORM-11: a clause trailing the last ^OR leg is refused', () => {
  // The exact shape our own dictionaryFields() shipped: the guard against the silent
  // clause-drop was itself mis-encoded, filtering only the second leg.
  const out = stages.lintEncodedQuery('name=sys_scope^ORname=sys_metadata^elementISNOTEMPTY');
  assertEqual(out.length, 1, 'a trailing clause after the last ^OR was not flagged');
  assertIncludes(out[0], 'binds to the LAST ^OR leg alone', 'the explanation does not say what actually happens');
  assertEqual(stages.lintEncodedQuery('name=a^ORname=b').length, 0, 'a plain two-leg OR was flagged');
  assertEqual(stages.lintEncodedQuery('name=a^elementISNOTEMPTY^NQname=b^elementISNOTEMPTY').length, 0,
    'the CORRECT form — each leg carrying its own clause, split by ^NQ — was flagged');
});

test('PLATFORM-3/11: the lint is enforced by the stages that issue filtered reads', () => {
  const rej = HARVEST_LINT_CTX();
  assertIncludes(rej.join(' '), 'string literal', 'harvest accepted a field-to-field comparison');
});

function HARVEST_LINT_CTX() {
  const root = scratchRepo('lint-harvest');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.queue = { harvestAreas: ['business-rules'], harvestDone: [] };
  return STAGE_BY_ID.get('harvest').validate({ brain, state: brain.state, stage: 'harvest' }, {
    area: 'business-rules',
    claims: [{
      locus: { table: 'sys_script', sysId: 'a1' }, assertion: 'changed after creation', band: 'A',
      evidence: { query: 'sys_updated_on>sys_created_on', fields: 'sys_id', capturedAt: '2026-08-12T00:00:00Z',
        capturedResponse: { sys_id: 'a1' }, guards: { fields: 'validated', identityCanary: 'pass' } },
    }],
    coverage: { rowsSeen: 1, truncated: false },
  });
}

const HARVEST = STAGE_BY_ID.get('harvest');

function harvestCtx(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.queue = { harvestAreas: ['business-rules'], harvestDone: [] };
  return { brain, state: brain.state, stage: 'harvest' };
}

test('PRODUCT-12: areas that do not account for Band A are refused, unless the residual is declared', () => {
  const CENSUS = STAGE_BY_ID.get('census');
  const ctx = fakeCtx({ stage: 'census' });
  const base = CENSUS.example(ctx);

  const gap = deepMerge({}, base);
  gap.areas = [{ id: 'business-rules', tables: ['sys_script'], bandARows: 412, why: 'the rule-shaped class' }];
  const rej = CENSUS.validate(ctx, gap);
  assertIncludes(rej.join(' '), 'in no area at all',
    'areas covering a fraction of Band A were accepted, so the rest is harvested by nobody and nothing downstream can tell "not there" from "never looked"');

  gap.areas = [
    { id: 'business-rules', tables: ['sys_script'], bandARows: 412, why: 'the rule-shaped class' },
    { id: 'remainder', tables: ['sys_ui_policy'], bandARows: 1852, why: 'RESIDUAL, deliberately deferred to a later pass — stated so it is not mistaken for coverage' },
  ];
  assertEqual(CENSUS.validate(ctx, gap).length, 0, 'a declared residual was refused; a deferred slice is a legitimate choice');

  const overlap = deepMerge({}, base);
  overlap.areas = base.areas.concat([{ id: 'dupe', tables: ['sys_script'], bandARows: 5000, why: 'overlapping' }]);
  assertIncludes(CENSUS.validate(ctx, overlap).join(' '), 'Areas overlap',
    'areas claiming more rows than Band A holds were accepted, so records are harvested and counted twice');
});

test('PRODUCT-9: a zero-row harvest is refused unless it says it was blocked', () => {
  const rej = HARVEST.validate(harvestCtx('acc-h-zero'), {
    area: 'business-rules', claims: [], coverage: { rowsSeen: 0, truncated: false },
  });
  assertIncludes(rej.join(' '), 'rowsSeen is 0',
    'a zero-row harvest was accepted, which burns the area for the rest of the run');
});

test('PRODUCT-9: a zero-row harvest WITH a blocking finding is accepted', () => {
  const rej = HARVEST.validate(harvestCtx('acc-h-zero-ok'), {
    area: 'business-rules', claims: [], coverage: { rowsSeen: 0, truncated: false },
    findings: [{ check: 'harvest-blocked-business-rules', severity: 'blocking', rung: 'L1', message: 'the batch canary returned nothing in this session; this is a dead session, not an empty area' }],
  });
  assertEqual(rej.length, 0, `an honestly blocked harvest was rejected:\n  ${rej.join('\n  ')}`);
});

// ===========================================================================
// H — the domain predicate. A scope is a deployment container, not a domain.
// ===========================================================================

/*
 * PRODUCT-78. These assert the DEFECT is gone, not that the fix is present. The shape below is
 * the artifact run 6ef14f5562 actually shipped for all 34 sf_state_flow rows — `table` and
 * `active`, nothing else — so if this stops rejecting, the run that produced an inventory
 * instead of a brain would pass again.
 */
function harvestArt(brain, table, fields, note) {
  const at = new Date().toISOString();
  const sysId = 'a'.repeat(32);
  brain.state.queue = {
    harvestAreas: ['an-area'], harvestDone: [],
    harvestAreaDetail: [{ id: 'an-area', tables: [table], bandARows: 34 }],
  };
  return {
    stage: 'harvest', instance: 'x',
    usage: { apiCalls: 4, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    area: 'an-area',
    claims: fields.map((f) => ({
      locus: { table, sysId, field: f },
      assertion: `${f} = something`, band: 'A', rung: 'L1',
      evidence: {
        query: `sys_idIN${sysId}`, fields: `sys_id,${f}`, capturedAt: at, transport: 'rest_request',
        completeness: 'complete', capturedResponse: { sys_id: sysId, [f]: 'x' },
        guards: { fields: 'validated', identityCanary: 'pass' },
      },
    })),
    coverage: Object.assign({ rowsSeen: 34, rowsTotal: 34, truncated: false }, note ? { note } : {}),
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  };
}

test('PRODUCT-78: a body-less table must have its whole declared shape claimed', () => {
  const root = scratchRepo('hv-shape-unreadable');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  // Exactly what the run shipped: `active` and nothing else, on the table whose shape IS its meaning.
  const bad = h.validate(ctx, harvestArt(brain, 'sf_state_flow', ['active']));
  const shapeHit = bad.filter((m) => /sf_state_flow.*meaning were not claimed/.test(m));
  assertEqual(shapeHit.length, 1, `the run's own sf_state_flow shape was accepted:\n${bad.join('\n')}`);
  assert(/start_text, end_text, starting_state, ending_state, roles, manual_roles, automatic_roles/.test(shapeHit[0]),
    'the rejection does not name the missing columns');
  assert(/every transition is offered to everyone/.test(shapeHit[0]),
    'the rejection does not explain why an EMPTY column is still a claim');
  /*
   * PRODUCT-96. The column names above are the REAL ones. The map declared `from_state`/`to_state`
   * from the day the explain stage landed and neither has ever been a column on this table — the
   * run's own dictionary-validated field list carries start_text/end_text/starting_state/
   * ending_state/manual_condition/automatic_condition and none of the three the register asked
   * for. A guard demanding a column that cannot exist has one legal satisfaction, forever: the
   * no-column escape.
   */
  assertEqual(bad.filter((m) => /from_state|to_state/.test(m)).length, 0,
    'the guard still demands from_state/to_state, which are not columns on sf_state_flow');
  // The whole shape claimed, and the two transition conditions with it: accepted.
  const good = h.validate(ctx, harvestArt(brain, 'sf_state_flow',
    ['active', 'start_text', 'end_text', 'starting_state', 'ending_state', 'roles', 'manual_roles', 'automatic_roles',
      'manual_condition', 'automatic_condition']));
  assertEqual(good.filter((m) => /sf_state_flow/.test(m)).length, 0, `a complete shape was rejected:\n${good.join('\n')}`);
});

test('PRODUCT-96: the column a class keeps its logic in is REQUIRED, not one-of-many', () => {
  const root = scratchRepo('hv-must');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  /*
   * Each of these is EXACTLY what run 93838afe87 claimed for that table, and each PASSES the
   * shape rule — a discriminating column was read every time. What was not read is the column
   * that carries the class's logic, and until now nothing said so.
   */
  const asShipped = {
    sys_ui_policy: ['active', 'order', 'on_load', 'reverse_if_false', 'short_description'],
    sysevent_email_action: ['active', 'subject', 'event_name', 'collection'],
    sysrule_assignment: ['active', 'order', 'table', 'match_conditions'],
    sys_ui_action: ['active', 'order', 'form_button', 'list_button', 'action_name', 'condition', 'script'],
    sys_dictionary: ['active', 'max_length', 'mandatory', 'read_only', 'display', 'choice', 'attributes'],
  };
  const missingPerTable = {
    // `ui_type` joined this list after a blind tester's column census: 0 of 64 policies assert it,
    // and on a configurable-workspace-only build a policy with the wrong one is silently inert.
    sys_ui_policy: ['conditions', 'script_true', 'script_false', 'ui_type'],
    sysevent_email_action: ['condition', 'advanced_condition'],
    sysrule_assignment: ['condition', 'script', 'group', 'user'],
    sys_ui_action: ['form_button_v2', 'client_script_v2'],
    // The table that defines every custom column, and it was absent from the map entirely.
    sys_dictionary: ['internal_type', 'sys_scope'],
  };
  for (const [table, fields] of Object.entries(asShipped)) {
    const rej = h.validate(ctx, harvestArt(brain, table, fields));
    const must = rej.filter((m) => new RegExp(`claims on ${table}: \\d+ REQUIRED`).test(m));
    assertEqual(must.length, 1, `${table}: the run's own claim set passed — the logic column is still optional:\n${rej.join('\n')}`);
    /*
     * ASSERT ON THE LIST, NOT THE MESSAGE. `must[0].includes('script')` passes on the rejection's
     * own explanatory prose — which names script, group and user while narrating the routing-group
     * routing rule — so the first version of this assertion was satisfied by a guard that had
     * forgotten three of its four required columns. Mutation caught it; nothing else could have.
     */
    const named = (must[0].match(/were not claimed — ([^.]+)\./) || [])[1] || '';
    assertEqual(named.split(',').map((s) => s.trim()).sort().join(','), missingPerTable[table].slice().sort().join(','),
      `${table}: the rejection names "${named}" where the unclaimed required columns are ${missingPerTable[table].join(', ')}`);
    // And the shape rule alone would have let it through, which is why this is a second rule.
    assertEqual(rej.filter((m) => new RegExp(`claims on ${table}: the columns that carry`).test(m)).length, 0,
      `${table}: the shape rule fired too, so this fixture does not prove the shape rule was insufficient`);
    const ok = h.validate(ctx, harvestArt(brain, table, fields.concat(missingPerTable[table])));
    assertEqual(ok.filter((m) => new RegExp(`claims on ${table}`).test(m)).length, 0,
      `${table}: a claim set carrying every required column was still rejected:\n${ok.join('\n')}`);
  }
});

test('PRODUCT-96: a required column is excused PER COLUMN, and one absence does not buy silence on the rest', () => {
  const root = scratchRepo('hv-must-escape');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  const shipped = ['active', 'order', 'form_button', 'list_button', 'action_name', 'condition', 'script'];
  /*
   * `form_button_v2` genuinely does not exist on older instances, and declaring so is a legitimate
   * answer. It must NOT also excuse `client_script_v2` — one true statement buying silence on an
   * unrelated column is how the table-wide escape below would behave if it were reused here.
   */
  const partial = h.validate(ctx, harvestArt(brain, 'sys_ui_action', shipped,
    'no-column: sys_ui_action.form_button_v2 — pre-Vancouver instance; dictionaryFields() confirms.'));
  const must = partial.filter((m) => /REQUIRED/.test(m));
  assertEqual(must.length, 1, 'a per-column declaration cleared every required column at once');
  assert(/client_script_v2/.test(must[0]) && !/form_button_v2/.test(must[0]),
    `the declared column was still demanded, or the undeclared one was excused: ${must[0]}`);
  const both = h.validate(ctx, harvestArt(brain, 'sys_ui_action', shipped,
    'no-column: sys_ui_action.form_button_v2 — pre-Vancouver. no-column: sys_ui_action.client_script_v2 — same.'));
  assertEqual(both.filter((m) => /claims on sys_ui_action/.test(m)).length, 0,
    `declaring both absences was still rejected, so the guard has no sanctioned exit:\n${both.join('\n')}`);
});

test('PRODUCT-78: `active` alone never satisfies the rule, on any table', () => {
  const root = scratchRepo('hv-shape-active');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  // `active` is in nearly every declared shape and is the cheapest column on the instance, so a
  // rule of "at least one declared column" is satisfied by the artifact it exists to reject.
  for (const table of ['sys_script', 'sys_security_acl', 'sys_ui_policy_action', 'sf_state_flow']) {
    const rej = h.validate(ctx, harvestArt(brain, table, ['active']));
    assert(rej.some((m) => new RegExp(table).test(m)), `${table}: "active" alone was accepted as a harvest`);
  }
  // One discriminating column is enough where a readable body carries the behaviour.
  const ok = h.validate(ctx, harvestArt(brain, 'sys_script', ['active', 'when']));
  assertEqual(ok.filter((m) => /sys_script/.test(m)).length, 0, `a discriminating column was rejected:\n${ok.join('\n')}`);
});

test('PRODUCT-78: an absent column is excused by an EXPLICIT declaration, not by a mention', () => {
  const root = scratchRepo('hv-shape-note');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  /*
   * The declared form: excused, so the guard always has a sanctioned exit (invariant 6).
   * `sys_hub_flow` rather than `sf_state_flow` since PRODUCT-96: the table-wide escape tested here
   * clears the SHAPE rule, and sf_state_flow now also carries a `must` list whose escape is per
   * column — testing both through one fixture would let a change to either pass unnoticed.
   */
  const ok = h.validate(ctx, harvestArt(brain, 'sys_hub_flow', ['active'],
    'no-column: sys_hub_flow.type — not on this instance version; dictionaryFields() confirms.'));
  assertEqual(ok.filter((m) => /sys_hub_flow/.test(m)).length, 0,
    'an explicitly declared absence was still rejected, so the only escape is to lie or to stall');
  /*
   * Prose must NOT disarm it. The old test was a bare substring match, which the run's real
   * coverage.note already satisfied for nine of fourteen shaped tables incidentally — and the new
   * brief instructs the agent to write table names into coverage.note, so the hole was about to be
   * walked through on purpose. `sys_script_client` also cleared `sys_script` under that rule.
   */
  const prose = h.validate(ctx, harvestArt(brain, 'sys_hub_flow', ['active'],
    'Read sys_hub_flow rows across the domain; see the sys_hub_flow notes above.'));
  assertEqual(prose.filter((m) => /sys_hub_flow/.test(m)).length, 1,
    'a passing mention of the table name disarmed the guard');
});

test('PRODUCT-78: the harvest worked example claims declared columns, not just `active`', () => {
  const root = scratchRepo('hv-shape-example');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ex = h.example({ brain, state: brain.state, stage: 'harvest' });
  const fields = new Set((ex.claims || []).map((c) => c.locus && c.locus.field).filter(Boolean));
  assert(fields.size >= 4, `the example teaches ${fields.size} column(s); the last run copied it and claimed 2`);
  assert([...fields].some((f) => f !== 'active'), 'the example still teaches `active` alone');
});

group('J. compiled boundary');

const { compileDomain, conjoinQuery, parseDomain } = require('./lib/state.js');
const { lintEncodedQuery } = require('./lib/stages.js');

test('PRODUCT-28: the boundary compiles to a query, and never to the three traps', () => {
  const d = parseDomain('scope:sn_ohs_im; author:a@acme.example; name:ACME*,OHS*');
  const q = compileDomain(d, 'sys_script').query;
  // PLATFORM-28: `sys_scope` is a REFERENCE. The bare form returned 0 rows on a 12,382-row scope.
  assert(!/(^|[^.])sys_scope=/.test(q), `compiled the bare reference form: ${q}`);
  assert(/sys_scope\.scope=/.test(q), `did not dot-walk the scope leg: ${q}`);
  // A trailing `*` is a PREFIX. `sys_nameLIKESTRY` returned 984 against a true 36 ("registry").
  assert(/STARTSWITH/.test(q) && !/LIKE/.test(q), `compiled a prefix as a substring: ${q}`);
  // PLATFORM-11: a trailing clause binds to the last ^OR leg alone.
  assert(!/\^OR/.test(q), `emitted ^OR, whose trailing clause binds to one leg: ${q}`);
  assertEqual(lintEncodedQuery(q).length, 0, `the compiler emitted a query its own lint rejects:\n${lintEncodedQuery(q).join('\n')}`);
});

test('PRODUCT-28: a leg the table cannot honour is REPORTED with a remedy, never guessed', () => {
  const d = parseDomain('scope:sn_ohs_im; author:a@acme.example; name:ACME*');
  // An unknown table must not get `sys_scope`/`sys_name` guessed onto it: an unknown field in an
  // encoded query returns UNFILTERED rows (PLATFORM-1), which is worse than an admitted gap.
  const c = compileDomain(d, 'cmn_department');
  assert(!/sys_scope|sys_name/.test(c.query || ''), `guessed a column onto an unclassified table: ${c.query}`);
  assert(/sys_created_by/.test(c.query || ''), 'dropped the author leg, which exists on every table');
  const legs = (c.unavailableLegs || []).map((u) => u.leg);
  assert(legs.includes('scope') && legs.includes('name'), `unavailable legs not reported: ${JSON.stringify(legs)}`);
  for (const u of c.unavailableLegs) {
    assert(u.remedy && u.remedy.length > 20, `${u.leg} is reported unavailable with no remedy`);
  }
});

test('PLATFORM-11: conjoinQuery ANDs onto every leg, not just the last', () => {
  const q = 'a=1^NQb=2^NQc=3';
  const joined = conjoinQuery(q, 'sys_mod_count>0');
  assertEqual(joined.split('sys_mod_count>0').length - 1, 3, `the clause bound to some legs only: ${joined}`);
  assertEqual(lintEncodedQuery(joined).length, 0, 'conjoinQuery produced a query the lint rejects');
});

test('PLATFORM-28: the lint catches a reference column filtered by a display name', () => {
  // The measured trap: sys_scope=<scope name> returned 0 rows against 12,382 for the dot-walk,
  // with no error, and two subagents paid full price to rediscover it in one run.
  for (const q of ['sys_scope=sn_ohs_im', 'update_set=STRY0178555', 'application=sn_ohs_im', 'cat_item=Case maken']) {
    assert(lintEncodedQuery(q).length === 1, `the reference trap passed the lint: ${q}`);
  }
  // A lint that fires on correct work gets switched off, and then the trap is back.
  for (const q of ['sys_scope.scope=sn_ohs_im', 'sys_scope=9df2c8611b1e8110a0a0a0a0a0a0a0a0', 'sys_scope=global',
    'sys_created_byINa.developer@acme.example', 'sys_nameSTARTSWITHACME', 'active=true^sys_class_name=sys_script']) {
    assertEqual(lintEncodedQuery(q).length, 0, `the lint fired on a correct query: ${q}`);
  }
});

/*
 * PRODUCT-29 · PRODUCT-12 (amended) — THE CENSUS CARRIES TWO POPULATIONS.
 *
 * These assert THE DEFECT IS ABSENT, not that the fix is present, and the fixture is the census
 * artifact run 6ef14f5562 actually shipped on pilot-run-3: `bands.A` = 97,436 instance-wide, 431
 * areas summing 97,258 (residual 178 = 0.18%, comfortably inside the 5% gate), sys_documentation
 * briefed at 32,328 rows against 1,631 in-domain, under the four-leg boundary that run refined to
 * at 08:13:15Z. If any of these stops failing on the old shape, the run that was handed an
 * ~86,200-call work queue against a budget of 800, harvested 1 of 431 areas and terminated
 * `blocked` becomes possible again.
 *
 * EVERY ASSERTION NAMES THE POPULATION IT COUNTS. Three fixed register entries recurred because
 * each asserted an invariant over an unnamed population — true while one population existed and
 * false the moment `--domain` introduced a second.
 */
const CENSUS_STAGE = STAGE_BY_ID.get('census');
const HARVEST_STAGE = STAGE_BY_ID.get('harvest');

/** The boundary run 6ef14f5562 was refined to, abbreviated to one update-set id. */
const RUN6EF_DOMAIN = 'scope:sn_ohs_im; author:b.developer@acme.example,a.developer@acme.example; name:ACME*,OHS*,Routing-group*,NSTM*; updateset:STRY0185005*';
const RUN6EF_BANDS = { A: 97436, B: 208364, C: 3619748 };

/**
 * The head of that run's own 431-area list: [id, instance-wide Band A, in-domain Band A].
 * The instance-wide figures are the run's; sys_documentation's 1,631 is the measured in-domain
 * count (quirks log Q7) and the rest are of that shape. Three areas measure ZERO in-domain and
 * are what `apply()` must record out-of-boundary rather than hand out or destroy.
 */
const RUN6EF_AREAS = [
  ['sys_documentation', 32328, 1631], ['sys_dictionary', 17392, 118], ['sys_metadata_delete', 4170, 0],
  ['sys_ui_list', 3461, 0], ['item_option_new', 3445, 96], ['sys_template', 3099, 0],
  ['sys_security_acl', 284, 23], ['sys_script', 190, 42], ['sys_script_include', 113, 5],
  ['sys_ui_policy', 82, 11],
];
const RUN6EF_A_IN_DOMAIN = RUN6EF_AREAS.reduce((n, a) => n + a[2], 0); // 1,926

function censusCtx(name, spec) {
  return fakeCtx({ root: scratchRepo(name), stage: 'census', state: { config: { domain: spec ? stateLib.parseDomain(spec) : null } } });
}

function censusArt(bands, areas, extra) {
  return Object.assign({}, CENSUS_STAGE.example(fakeCtx({ stage: 'census' })), { bands, areas }, extra || {});
}

/** The 431 areas as shipped, instance-wide sizes only, summing to exactly 97,258. */
function shippedAreas() {
  const areas = RUN6EF_AREAS.map(([id, wide]) => ({ id, tables: [id], bandARows: wide, why: `${id} carries authored rows` }));
  const head = areas.reduce((n, a) => n + a.bandARows, 0);
  const fillers = 431 - areas.length;
  const each = Math.floor((97258 - head) / fillers);
  const extra = (97258 - head) - (each * fillers);
  for (let i = 0; i < fillers; i += 1) {
    areas.push({ id: `tail_class_${i}`, tables: [`tail_class_${i}`], bandARows: each + (i < extra ? 1 : 0), why: 'one of the long tail of authored classes' });
  }
  return areas;
}

/**
 * The artifact that run SHOULD have shipped: both populations, ten areas, seven of them in-domain,
 * and — PRODUCT-83 — the DATA population accounted for. `sys_user_group` is not a Band A row and
 * deliberately does not appear in `areas[]`: it is counted in its own field, in its own unit, on
 * the only legs a data table has.
 */
function honestArt() {
  return censusArt(
    Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_A_IN_DOMAIN }),
    RUN6EF_AREAS.map(([id, wide, inDom]) => ({
      id, tables: [id], bandARows: wide, bandARowsInDomain: inDom, bandARowsInDomainMethod: 'exact',
      why: `${id} carries authored rows; the in-domain figure is the same predicate intersected with the compiled boundary`,
    })),
    { dataAreas: [{
      table: 'sys_user_group', rowsInDomain: 21, rowsTotal: 4312,
      query: 'nameSTARTSWITHACME^NQnameSTARTSWITHOHS',
      columnsValidated: ['name', 'description', 'parent', 'type'],
      why: 'the routing target the recall describes; sys_metadata holds zero rows of this class so no area can reach it',
    }] });
}

test('PRODUCT-29: the census artifact run 6ef14f5562 shipped is refused under that run\'s own boundary', () => {
  const ctx = censusCtx('cen-2pop-shipped', RUN6EF_DOMAIN);
  const art = censusArt(Object.assign({}, RUN6EF_BANDS), shippedAreas());
  assertEqual(art.areas.length, 431, 'the fixture is not the 431-area list the run shipped');
  assertEqual(art.areas.reduce((n, a) => n + a.bandARows, 0), 97258, 'the fixture does not reproduce the 97,258 instance-wide rows the run shipped');
  const rej = CENSUS_STAGE.validate(ctx, art).join(' ');
  assertIncludes(rej, 'bands.AInDomain: required',
    'population 2 (in-domain Band A) was never demanded, so the residual has nothing but the instance-wide denominator to reconcile against — which is what COMPELLED the 431-area queue');
  assertIncludes(rej, 'bandARowsInDomain',
    'a 431-area work queue sized only in instance-wide units was accepted: ~86,200 calls against a budget of 800, and ceiling() would return 434 so the runaway guard scales with the defect');
});

test('PRODUCT-12: the residual reconciles against the population the queue is actually cast in', () => {
  const ctx = censusCtx('cen-2pop-honest', RUN6EF_DOMAIN);
  const art = honestArt();
  assertEqual(validate(CENSUS_STAGE.schema, art, '$').length, 0,
    `a two-population census artifact does not fit the census schema:\n  ${validate(CENSUS_STAGE.schema, art, '$').join('\n  ')}`);
  const rej = CENSUS_STAGE.validate(ctx, art);
  assertEqual(rej.length, 0,
    `an honest domain-scoped census — 10 areas whose in-domain sizes account for all 1,926 in-domain Band A rows — was rejected:\n  ${rej.join('\n  ')}`);

  // The same area list under NO domain is a 33.7% residual against the instance-wide total. That
  // rejection is CORRECT and must survive: it is PRODUCT-12's original assertion, over population 1.
  const wide = censusArt(Object.assign({}, RUN6EF_BANDS), art.areas.map((a) => ({ id: a.id, tables: a.tables, bandARows: a.bandARows, why: a.why })));
  assertIncludes(CENSUS_STAGE.validate(censusCtx('cen-2pop-wide', null), wide).join(' '), 'INSTANCE-WIDE Band A (bands.A)',
    'the instance-wide reconciliation either stopped running or stopped naming the population it counts');
});

test('PRODUCT-29: apply() FILTERS the queue and carries the excluded areas forward at their instance-wide size', () => {
  const ctx = censusCtx('cen-2pop-apply', RUN6EF_DOMAIN);
  const applied = CENSUS_STAGE.apply(ctx, honestArt());
  const q = applied.queue;
  assertEqual(q.harvestAreas.length, 8, 'the work list is not the in-domain population plus the data population');
  assertEqual(q.harvestAreas[q.harvestAreas.length - 1], 'data-sys-user-group',
    'PRODUCT-83: the data area was not appended to the work queue, so nothing in the run can reach a group');
  const dataDetail = q.harvestAreaDetail.find((d) => d.id === 'data-sys-user-group');
  assertEqual(dataDetail.population, 'data',
    'the data area entered the queue without its population marked, so the harvest brief will size it in Band A units it is not measured in');
  assertEqual(dataDetail.bandARows, undefined,
    'the data area was given a Band A size — it has none, and a fabricated one would enter the residual reconciliation');
  // Both denominators survive into facts.census, or no later reader can tell which population
  // a residual, a coverage figure or an aShare was computed over.
  assertEqual(applied.facts.census.bands.A, 97436, 'the instance-wide denominator LOOP.md §6.5.2 requires was overwritten by the in-domain one');
  assertEqual(applied.facts.census.bands.AInDomain, RUN6EF_A_IN_DOMAIN, 'the in-domain denominator never reached facts.census');
  assertEqual(q.harvestAreas.includes('sys_metadata_delete'), false, 'an area measured at 0 in-domain rows was handed out anyway');
  assertEqual(q.harvestAreaDetail.length, 11,
    'apply() DROPPED areas instead of filtering — that destroys the per-area count the coverage number and the reasoned-zero rule both read');
  assertEqual(q.harvestAreasOutOfBoundary.length, 3, 'the out-of-boundary areas were discarded rather than recorded');
  assert(q.harvestAreasOutOfBoundary.every((a) => typeof a.bandARows === 'number' && a.bandARows > 0),
    'the out-of-boundary areas lost their instance-wide sizes, so nothing downstream can say how much was deliberately not read');
  assertEqual(q.harvestAreas.length + q.harvestAreasOutOfBoundary.length, q.harvestAreaDetail.length,
    'queued + out-of-boundary no longer accounts for every area the census emitted, so an area went missing between validate() and the queue');
});

test('PRODUCT-29: the runaway ceiling counts the work the run was given, not the instance', () => {
  const q = CENSUS_STAGE.apply(censusCtx('cen-2pop-ceiling', RUN6EF_DOMAIN), honestArt()).queue;
  const ceiling = HARVEST_STAGE.ceiling({ state: { queue: q } });
  assertEqual(ceiling, 11, 'the ceiling no longer tracks the in-domain queue it is bounding');
  assert(ceiling < 434,
    'the ceiling still scales with the instance-wide area list — run 6ef14f5562 got areas + 3 = 434, so the runaway guard grew with the defect it exists to bound');
});

test('PRODUCT-29: a denominator scoped to its own numerator is refused', () => {
  const ctx = censusCtx('cen-2pop-circular', RUN6EF_DOMAIN);
  const areas = shippedAreas().map((a) => Object.assign({}, a, { bandARowsInDomain: a.bandARows }));
  const art = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_BANDS.A }), areas);
  const rej = CENSUS_STAGE.validate(ctx, art).join(' ');
  assertIncludes(rej, 'Re-measure bands.A',
    'bands.A === bands.AInDomain under a four-leg predicate was accepted, so aShare, coverage and every per-leg ratio read 100% by construction and nothing says so');
  const inverted = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_BANDS.A + 1 }), areas);
  assertIncludes(CENSUS_STAGE.validate(ctx, inverted).join(' '), 'is a SUBSET',
    'an in-domain population larger than the instance-wide one it is drawn from was accepted');
});

test('PRODUCT-28/PLATFORM-28: zero in-domain rows everywhere is refused as a hand-encoded query, and has a sanctioned exit', () => {
  const ctx = censusCtx('cen-2pop-refcol', RUN6EF_DOMAIN);
  const art = censusArt(
    Object.assign({}, RUN6EF_BANDS, { AInDomain: 0 }),
    RUN6EF_AREAS.map(([id, wide]) => ({ id, tables: [id], bandARows: wide, bandARowsInDomain: 0, why: `${id} carries authored rows` })),
    { dataAreas: [{ table: 'sys_user_group', rowsInDomain: 0, query: 'nameSTARTSWITHACME' }] });
  assertIncludes(CENSUS_STAGE.validate(ctx, art).join(' '), 'sys_scope.scope=',
    '"nothing in this domain" was accepted as a clean, well-formed, terminal result — the reference-operand trap finishing a run wrongly instead of stranding it visibly');
  const declared = Object.assign({}, art, {
    findings: [{ check: 'census-domain-empty', severity: 'blocking', rung: 'L1', message: 'the compiled fragments were replayed verbatim and this boundary admits no Band A row on this instance' }],
  });
  assertEqual(CENSUS_STAGE.validate(ctx, declared).length, 0,
    'a measured-empty boundary declared in a blocking finding has no sanctioned exit, so the only way past this guard is a forbidden hand edit to .brain/');
});

test('PRODUCT-29: a run with no domain, and an area with no in-domain size, both still work', () => {
  const ctx = censusCtx('cen-2pop-replay', null);
  const art = censusArt(Object.assign({}, RUN6EF_BANDS), shippedAreas());
  assertEqual(CENSUS_STAGE.validate(ctx, art).length, 0,
    `an instance-wide census stopped validating — the fix broke the population that already worked:\n  ${CENSUS_STAGE.validate(ctx, art).join('\n  ')}`);
  const q = CENSUS_STAGE.apply(ctx, art).queue;
  assertEqual(q.harvestAreas.length, 431, 'an unbounded run lost areas it never asked to filter');
  assertEqual(q.harvestAreasOutOfBoundary.length, 0, 'an unbounded run recorded out-of-boundary areas it cannot have');

  const withInDomain = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: 1926 }), shippedAreas());
  assertIncludes(CENSUS_STAGE.validate(ctx, withInDomain).join(' '), 'no second population to report',
    'an in-domain figure was accepted on a run with no boundary for it to be in — a number nothing can check');

  // Replay: a brain written before `bandARowsInDomain` existed reads as instance-wide, never crashes.
  const goal = HARVEST_STAGE.goal({ state: { queue: { harvestAreas: ['sys_script'], harvestDone: [], harvestAreaDetail: [{ id: 'sys_script', tables: ['sys_script'], bandARows: 190 }] } } });
  assertIncludes(goal, '190 Band A rows, instance-wide', 'an area carrying no in-domain size stopped reading as an instance-wide one');
  assertEqual(/undefined/.test(goal), false, `the harvest brief handed the agent a missing in-domain size verbatim:\n${goal}`);
});

test('PRODUCT-29: end to end — a domain is constructed, a census artifact ingested, and harvest handed an in-domain area', () => {
  const root = scratchRepo('cen-2pop-e2e');
  const brain = Brain.init({ root, instance: 'pilot-run-3', stageOrder: STAGE_ORDER, domain: stateLib.parseDomain(RUN6EF_DOMAIN) });
  const ctx = { brain, state: brain.state, stage: 'census' };
  const art = honestArt();
  assertEqual(CENSUS_STAGE.validate(ctx, art).length, 0, `census.validate rejected the honest artifact:\n  ${CENSUS_STAGE.validate(ctx, art).join('\n  ')}`);
  brain.state.queue = CENSUS_STAGE.apply(ctx, art).queue;

  const hctx = { brain, state: brain.state, stage: 'harvest' };
  const goal = HARVEST_STAGE.goal(hctx);
  assertIncludes(goal, '1631 in-domain Band A rows (32328 instance-wide)',
    'the harvest brief quotes one population, so the agent budgets against a number 20x the work it was handed');
  assertIncludes(goal, 'OUT OF BOUNDARY', 'the brief does not say that areas were deliberately excluded, so a thin ledger looks like a complete one');

  const ok = HARVEST_STAGE.validate(hctx, {
    area: 'sys_documentation', claims: [], coverage: { rowsSeen: 0, truncated: false },
    findings: [{ check: 'harvest-blocked-sys_documentation', severity: 'blocking', rung: 'L1', message: 'the session canary failed in this session; this is a dead session, not an empty area' }],
  });
  assertEqual(ok.length, 0, `harvest refused the very area the CLI handed it:\n  ${ok.join('\n  ')}`);
  assertIncludes(HARVEST_STAGE.validate(hctx, { area: 'sys_metadata_delete', claims: [], coverage: { rowsSeen: 0, truncated: false } }).join(' '), 'sys_documentation',
    'harvest accepted an out-of-boundary area the CLI recorded and never handed out');
});

group('K. routing');

/** A brain parked mid-stage with an accepted iteration, the way a real run sits between briefs. */
function parkedAt(name, stage, queue, apiCalls) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.stage = stage;
  brain.state.stages[stage] = {
    status: 'active', enteredAt: new Date().toISOString(), completedAt: null, sinceProgress: 0,
    total: 1, iterations: [{ n: 1, at: new Date().toISOString(), accepted: true, progress: true, apiCalls: apiCalls || 0 }], lastRejections: [],
  };
  if (queue) { brain.state.queue = queue; }
  brain.save('seed', {});   // the CLI opens a FRESH brain from disk; in-memory state is invisible to it
  return brain;
}

function runCli(root, ...args) {
  const { execFileSync } = require('child_process');
  try {
    return execFileSync(process.execPath, [path.join(__dirname, 'snbrain.js'), ...args, '--root', root], { encoding: 'utf8' });
  } catch (err) { return String(err.stdout || '') + String(err.stderr || ''); }
}

test('PRODUCT-36: `next` closes a stage that cannot produce another artifact', () => {
  /*
   * The exact state that forced the second hand edit on run 6ef14f5562: harvest, queue drained,
   * next() routing to explain, and no artifact left to ingest — so routing, which lived only in
   * cmdIngest, could never fire. The operator wrote state.stage directly and left harvest
   * permanently `active`, which blocked success with a fourth blocker they never chose.
   */
  const brain = parkedAt('rt-empty-queue', 'harvest',
    { harvestAreas: ['a'], harvestDone: ['a'], harvestAreaDetail: [{ id: 'a', tables: ['sys_script'], bandARows: 10 }] });
  const outText = runCli(brain.root, 'next');
  assert(/advanced to explain/.test(outText), `next did not route:\n${outText.slice(0, 300)}`);
  const after = Brain.open(brain.root);
  assertEqual(after.state.stage, 'explain', 'the cursor did not move');
  assertEqual(after.state.stages.harvest.status, 'complete', 'the departed stage was left active — the hand-edit defect');
  // The hand edit's side effect was that the DEPARTED stage stayed `active` forever. Earlier
  // stages are pending here only because this fixture jumps straight to harvest.
  const notComplete = after.successBlockers().filter((b) => /stages not complete/.test(b)).join(' ');
  assert(!/\bharvest\b/.test(notComplete),
    `the CLI reproduced the hand edit's own side effect: ${notComplete}`);
});

test('PRODUCT-36: `next` does NOT route a stage that has produced nothing', () => {
  // Otherwise a stage whose queue starts empty is skipped before its artifact ever arrives.
  const root = scratchRepo('rt-unrun');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.stage = 'harvest';
  brain.state.queue = { harvestAreas: [], harvestDone: [], harvestAreaDetail: [] };
  brain.save('seed', {});
  runCli(root, 'next');
  assertEqual(Brain.open(root).state.stage, 'harvest', 'an unrun stage was routed past');
});

test('PRODUCT-35: a bound close routes to the table\'s closeTo, never to next()', () => {
  /*
   * next() returns the CURRENT stage precisely while the queue is non-empty — which is exactly
   * when a budget close fires. "Take next() anyway" is an infinite loop; the table declares
   * `closeTo` so the engine never names a stage itself (invariant 7).
   */
  const harvest = STAGE_BY_ID.get('harvest');
  assertEqual(typeof harvest.closeOn, 'function', 'harvest declares no closeOn');
  assertEqual(harvest.closeTo, 'explain', 'harvest declares no closeTo, so a close has nowhere to route');
  const brain = parkedAt('rt-close', 'harvest',
    { harvestAreas: ['a', 'b', 'c'], harvestDone: ['a'], harvestAreaDetail: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, 269);
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  assertEqual(harvest.next(ctx), 'harvest', 'next() no longer returns the current stage on a non-empty queue');
  brain.state.budget.usedCalls = brain.state.budget.maxCalls;   // nothing left for the remaining areas
  const close = harvest.closeOn(ctx, {});
  assert(close, 'an exhausted budget with two areas unread did not produce a close');
  assertEqual(close.unreached, 2, `the close miscounted the unread areas: ${JSON.stringify(close)}`);
  assert(close.populationName && /harvestAreas/.test(close.populationName),
    'the close does not name the population it counted');
});

test('PRODUCT-35: a close mints a warning naming the unreached count, and costs terminal success', () => {
  const brain = parkedAt('rt-close-finding', 'harvest',
    { harvestAreas: ['a', 'b', 'c'], harvestDone: ['a'], harvestAreaDetail: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, 269);
  brain.state.budget.usedCalls = brain.state.budget.maxCalls;
  brain.save('seed', {});
  const outText = runCli(brain.root, 'next');
  assert(/STAGE CLOSED: harvest -> explain/.test(outText), `no close was announced:\n${outText.slice(0, 300)}`);
  const after = Brain.open(brain.root);
  assertEqual(after.state.stage, 'explain', 'a close did not move the cursor');
  const f = [...after.findings().values()].filter((x) => /^stage-closed-/.test(x.check));
  assertEqual(f.length, 1, 'a close minted no finding, so it surfaces nowhere at ingest');
  assert(/2 of 3/.test(f[0].message), `the finding does not carry the unreached count: ${f[0].message}`);
  assert(after.state.closes && after.state.closes.length === 1, 'the close was not recorded in state.closes');
  assert(after.successBlockers().length > 0, 'a bounded close left terminal success reachable');
});

test('PRODUCT-90: a rejected iteration is judged against the stage\'s own ceiling, not the flat 12', () => {
  /*
   * pilot-run-5, 13:23:52Z: harvest, 29 census areas, REJECTED iteration n=14 — the two
   * rejection paths in cmdIngest omitted `runawayCeiling`, so a rejected iteration fell back
   * to the flat caps.runawayCeiling of 12. st.total counts rejections, so a queue-driven stage
   * whose lifetime exceeds 12 by arithmetic was terminated `exhausted` mid-queue by its first
   * rejection past that line, and the operator paid an override to clear a bound the stage's
   * own ceiling (areas + 3 = 32) never set.
   */
  const root = scratchRepo('rt-reject-ceiling');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.stage = 'harvest';
  const areas = new Array(20).fill(0).map((_, i) => `area-${i}`);
  brain.state.queue = {
    harvestAreas: areas, harvestDone: areas.slice(0, 13),
    harvestAreaDetail: areas.map((id) => ({ id, tables: ['sys_script'], bandARows: 5 })),
  };
  const now = new Date().toISOString();
  brain.state.stages.harvest = {
    status: 'active', enteredAt: now, completedAt: null, sinceProgress: 0,
    total: 13, iterations: new Array(13).fill(0).map((_, i) => ({ n: i + 1, at: now, accepted: true, progress: true, apiCalls: 5 })),
    lastRejections: [],
  };
  brain.save('seed', {});
  const artPath = path.join(root, 'reject-me.json');
  fs.writeFileSync(artPath, JSON.stringify({ stage: 'harvest', instance: 'x' }));   // fails the stage schema
  const outText = runCli(root, 'ingest', '--stage', 'harvest', '--file', artPath);
  assert(/REJECTED/.test(outText), `the fixture artifact was not rejected:\n${outText.slice(0, 300)}`);
  const after = Brain.open(root);
  assertEqual(after.state.stages.harvest.total, 14, 'the rejection did not record an iteration');
  assertEqual(after.state.terminal, null,
    `a rejection at lifetime iteration 14 terminated a 20-area harvest mid-queue: ${after.state.terminalNote}`);
});

// ===========================================================================
// J — `not-sampled`: a settled status for "the budget did not reach it".
//     PLAN 5.17 · PRODUCT-37 · run 6ef14f5562.
// ===========================================================================

group('J. not-sampled');

const VERIFY_J = STAGE_BY_ID.get('verify');

/*
 * THE FIXTURE IS RUN 6ef14f5562's OWN LEDGER, reduced to the only thing the arithmetic needs:
 * how many distinct loci each of its 93 tables held among the 8,179 claims it left `draft`.
 * Measured by streaming `.brain/claims.jsonl` (8,299 rows -> 8,239 claims by last-line-wins;
 * 8,179 draft, 60 verified). Sum = 3,807 loci. If these numbers ever change, the fixture has
 * drifted from the run it is built from and the first assertion below says so.
 */
const RUN_6EF_DRAFT_LOCI_PER_TABLE = [
  1633, 392, 298, 170, 162, 145, 65, 62, 50, 43, 41, 38, 34, 34, 33, 30, 29, 27, 25, 25, 24, 24,
  23, 22, 20, 19, 19, 17, 16, 16, 16, 14, 13, 12, 12, 12, 12, 11, 10, 10, 9, 9, 8, 8, 8, 6, 6, 5,
  5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

/** The 8,179 claims that run left draft, as claim-shaped objects over their real locus shape. */
function run6efDraftClaims() {
  const claims = [];
  RUN_6EF_DRAFT_LOCI_PER_TABLE.forEach((loci, t) => {
    for (let i = 0; i < loci; i += 1) {
      const locus = { table: `t${t}`, sysId: `s${t}-${i}` };
      claims.push({ id: `C-a${t}-${i}`, locus, status: 'draft' });
      claims.push({ id: `C-b${t}-${i}`, locus, status: 'draft' });
    }
  });
  // 8,179 claims over 3,807 loci is 2.148 per locus; the remainder rides on the widest table.
  const remainder = 8179 - claims.length;
  for (let i = 0; i < remainder; i += 1) {
    claims.push({ id: `C-c0-${i}`, locus: { table: 't0', sysId: `s0-${i}` }, status: 'draft' });
  }
  return claims;
}

/** A brain parked at verify with `n` open claims, one of which may be a census denominator. */
function verifyBrain(name, opts) {
  const o = opts || {};
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const rows = [];
  for (let i = 0; i < (o.open === undefined ? 4 : o.open); i += 1) {
    rows.push({ locus: { table: 'sys_script', sysId: `open-${i}` }, assertion: `active = true (${i})`, band: 'A', status: 'draft' });
  }
  if (o.aggregate) {
    rows.push({ locus: { table: 'sys_metadata', sysId: 'census-denominator' }, assertion: 'Band A holds 412 rows in this domain', band: 'A', status: 'draft', kind: 'aggregate' });
  }
  if (o.read) {
    rows.push({
      locus: { table: 'sys_script', sysId: 'read-0' }, assertion: 'active = false (read)', band: 'A', status: 'verified',
      lastVerdict: { status: 'verified', query: 'sys_idINread-0', at: '2026-08-12T09:30:13Z', observed: { active: 'false' }, diff: null, recordedAt: '2026-08-12T09:30:13Z' },
    });
  }
  brain.upsertClaims(rows, { stage: 'harvest' });
  brain.state.stage = 'verify';
  brain.state.stages.verify.status = 'active';
  brain.state.stamps.scopeFilter = 'pass';
  brain.save('test-setup');
  return { root, brain };
}

test('5.17: convergence on run 6ef14f5562 was 231 calls, not 8,179 re-queries', () => {
  const cost = stateLib.claimReadCost(run6efDraftClaims());
  assertEqual(cost.claims, 8179, 'the fixture has drifted from the ledger run 6ef14f5562 shipped');
  assertEqual(cost.loci, 3807, 'distinct loci moved; re-measure .brain/claims.jsonl before touching the assertions below');
  assertEqual(cost.tables, 93, 'distinct tables moved');
  assertEqual(cost.batchedReads, 138, 'batched reads at 60 ids per sys_idIN');
  assertEqual(cost.fieldValidations, 93, 'one dictionaryFields validation per table');
  assertEqual(cost.estimatedCalls, 231,
    'convergence was priced in CLAIMS wearing a call count\'s clothes. The quirks log recorded ' +
    '"~8,179 further re-queries; 93 calls remained" and the third hand edit to state.json was ' +
    'performed on that number. 138 batched locus reads + 93 field validations is 231 — the run ' +
    'was short by ~138 calls, not by 8,086, and the stopping rule was unreachable ON THAT RUN ' +
    'rather than in principle.');
});

test('5.17: a verify artifact may not submit not-sampled', () => {
  const rej = validate(VERIFY_J.schema, {
    verdicts: [{
      claimId: 'C-a1b2c3d4e5f6', status: 'unverifiable', unverifiableReason: 'not-sampled',
      query: 'sys_idINd85dec7e93387650bb0d38918bba1093', capturedAt: '2026-08-12T09:30:13Z',
    }],
  }, '$');
  assert(rej.length > 0, 'a checker that ran out of budget settled the unread ledger by typing a reason');
  assertIncludes(rej.join(' '), 'unverifiableReason', 'the rejection did not name the field');
  assertIncludes(rej.join(' '), 'not one of', 'the enum did not refuse the CLI-only reason');
});

test('5.17: the three agent reasons still pass the verdict schema', () => {
  for (const reason of stateLib.AGENT_UNVERIFIABLE_REASONS) {
    const rej = validate(VERIFY_J.schema, {
      verdicts: [{ claimId: 'C-a1b2c3d4e5f6', status: 'unverifiable', unverifiableReason: reason, query: 'q', capturedAt: '2026-08-12T09:30:13Z' }],
    }, '$');
    assertEqual(rej.length, 0, `closing the CLI-only reason also closed "${reason}", which is a real outcome:\n  ${rej.join('\n  ')}`);
  }
});

test('5.17: the ledger refuses not-sampled without the CLI token', () => {
  const { brain } = verifyBrain('ns-token');
  let threw = null;
  try {
    brain.upsertClaims([{
      locus: { table: 'sys_script', sysId: 'open-0' }, assertion: 'active = true (0)',
      status: 'unverifiable', unverifiableReason: 'not-sampled',
    }], { stage: 'verify' });
  } catch (e) { threw = e; }
  assert(threw, 'upsertClaims took the status verbatim, so "CLI-minted only" was a comment rather than a guard');
  assertIncludes(threw.message, 'minted by the CLI alone', 'the refusal did not say who may mint it');
  assertEqual(brain.claims().get([...brain.claims().keys()][0]).status, 'draft', 'the claim moved anyway');
});

test('5.17: the ledger refuses a status outside CLAIM_STATUSES', () => {
  const { brain } = verifyBrain('ns-enum');
  let threw = null;
  try {
    brain.upsertClaims([{ locus: { table: 'sys_script', sysId: 'open-0' }, assertion: 'active = true (0)', status: 'attested' }], { stage: 'verify' });
  } catch (e) { threw = e; }
  assert(threw, 'a status nobody defined entered the ledger, which is how four proposals edit one enum and none of them binds');
  assertIncludes(threw.message, 'is not one of', 'the refusal did not name the closed set');
});

test('5.17: settling unsampled counts ZERO resolutions', () => {
  const { brain } = verifyBrain('ns-res', { open: 6, read: true });
  const before = brain.state.counters.resolutions;
  const close = brain.settleUnsampled({ by: 'the developer', reason: 'budget exhausted at 93 calls remaining' });
  assertEqual(close.settled, 6, 'the close did not settle the open population');
  assertEqual(close.resolutions, 0,
    'the close reported resolutions. On run 6ef14f5562 that is 8,179 of them in one ingest: the ' +
    'stagnation counter resets, the payload reads as a stage converging, and the CLI declares the ' +
    'unread ledger closed. An unread claim is settled, never resolved.');
  assertEqual(brain.state.counters.resolutions, before, 'the run counter moved on claims nobody read');
});

test('5.17: a kind=aggregate claim is never settled not-sampled and keeps blocking', () => {
  const { brain } = verifyBrain('ns-agg', { open: 3, aggregate: true, read: true });
  const close = brain.settleUnsampled({ by: 'the developer', reason: 'budget exhausted' });
  assertEqual(close.settled, 3, 'the close settled the wrong population');
  assertEqual(close.aggregatesHeldOpen, 1, 'the census denominator was swept up with the rest');
  const agg = [...brain.claims().values()].filter((c) => c.kind === 'aggregate');
  assertEqual(agg.length, 1, 'fixture lost its aggregate claim');
  assertEqual(agg[0].status, 'draft',
    'a denominator settled unread. Every honesty ratio in the deliverable is computed over these ' +
    'claims and they are one /stats call each, so leaving them unread makes the run report success ' +
    'with its own denominators unverified.');
  assertIncludes(brain.successBlockers().join(' '), 'still in draft',
    'the held-open denominator stopped blocking handoff');
});

test('5.17: settleUnsampled refuses a name that is the loop', () => {
  const { brain } = verifyBrain('ns-by');
  for (const by of ['snbrain-verify (checker)', 'orchestrator', 'the loop']) {
    let threw = null;
    try { brain.settleUnsampled({ by, reason: 'budget exhausted' }); } catch (e) { threw = e; }
    assert(threw, `"${by}" signed off on abandoning the ledger; the agent is the only caller of this CLI, so a self-serve close is the defect with a tidier audit trail`);
    assertIncludes(threw.message, 'one-way door', 'the refusal did not say why a person is required');
  }
  assertEqual(brain.openClaims().length, 4, 'claims moved on a refused close');
});

test('5.17: verify.next() does not advance on a not-sampled claim with no recorded close', () => {
  const { brain } = verifyBrain('ns-orphan', { open: 2, read: true });
  brain.settleUnsampled({ by: 'the developer', reason: 'budget exhausted' });
  const ctx = { brain, state: brain.state, stage: 'verify' };
  assertEqual(VERIFY_J.next(ctx), 'questions', 'a recorded close did not let the stage take its declared forward route');
  // Now the hand-edit shape: the claims are unsampled and the queue leg has been emptied.
  brain.state.queue.unsampled = { closes: [] };
  assertEqual(VERIFY_J.next(ctx), 'verify',
    'the open set was empty because the CLI had settled it, so next() routed the run onward with ' +
    'the ledger unread and nothing in the payload looking wrong. Unsampled claims are held in ' +
    'their own queue leg precisely so a settlement can never be the reason this stage advances.');
});

test('5.17: the close is refused while the budget can still pay, and shows the arithmetic', () => {
  const { root, brain } = verifyBrain('ns-afford', { open: 4, read: true });
  brain.state.budget.usedCalls = 0;   // the whole budget is still there
  brain.save('test-budget');
  const r = cli(['close-unsampled', '--root', root, '--by', 'the developer', '--reason', 'ran short']);
  assertEqual(r.code, 1, 'the CLI agreed to abandon claims the budget could still reach');
  assertIncludes(r.stderr, 'The budget reaches them',
    'run 6ef14f5562 abandoned 8,179 claims to save about 138 calls because nothing computed the price');
  assertIncludes(r.stderr, 'batched read', 'the refusal did not show its arithmetic, so an operator cannot disbelieve it');
  assertEqual(brain.reopen ? 0 : Brain.open(root).notSampledClaims().length, 0, 'a refused close still wrote to the ledger');
});

test('5.17: an affordable-only close records population, person, price and route', () => {
  const { root } = verifyBrain('ns-close', { open: 5, aggregate: true, read: true });
  const pre = Brain.open(root);
  pre.state.budget.usedCalls = pre.state.budget.maxCalls;   // nothing left to spend
  pre.save('test-budget');
  const r = cliJson(['close-unsampled', '--root', root, '--by', 'the developer', '--reason', 'budget exhausted at 93 calls remaining']);
  assertEqual(r.code, 0, `the sanctioned exit failed:\n${r.stderr}`);
  assertEqual(r.json.settled, 5, 'wrong population settled');
  assertEqual(r.json.resolutions, 0, 'the close reported progress for reading nothing');
  assertEqual(r.json.aggregatesHeldOpen, 1, 'the denominator was settled unread');
  assertEqual(r.json.readClaims, 1, 'the close could not say what it HAD read, which is what names the population');
  assert(/^S-[0-9a-f]{12}$/.test(r.json.sampleId), `sampleId is not a digest of the read set: ${r.json.sampleId}`);
  assertEqual(r.json.nextStage, 'questions', 'the close did not take the route the stage table declares');
  const after = Brain.open(root);
  assertEqual(after.state.stage, 'questions',
    'the run is still parked at verify — which is the state the operator escaped on 2026-08-12T09:42:04Z ' +
    'by editing state.stage in a text editor, the third forbidden hand edit of that run');
  assertEqual(after.state.stages.verify.status, 'complete', 'the stage was left active behind the cursor');
  assertIncludes(after.successBlockers().join(' '), 'claims the CLI settled not-sampled',
    'the unread population stopped blocking success, so the run could hand off a ledger nobody read');
  const finding = [...after.findings().values()].filter((f) => /^ledger-unsampled-/.test(f.check));
  assertEqual(finding.length, 1, 'no finding was minted, and a finding is the only artefact guaranteed to surface at ingest and in status');
  assertIncludes(finding[0].message, 'POPULATION:', 'the finding did not name the population it counts');
  // The price of the road not taken, in the unit the transport bills in, against what was left.
  assert(/about \d+ call\(s\)/.test(finding[0].message),
    `the finding did not price what re-reading would have cost: ${finding[0].message}`);
  assert(/against \d+ call\(s\) remaining/.test(finding[0].message),
    `the finding did not say what the run had left to spend: ${finding[0].message}`);
});

test('5.17: the draft blocker keeps the wording PRODUCT-25\'s banner filters on', () => {
  const { brain } = verifyBrain('ns-banner', { open: 3 });
  const draftLeg = brain.successBlockers().filter((b) => /still in draft/.test(b));
  assertEqual(draftLeg.length, 1,
    'the draft blocker no longer matches /still in draft/, so snbrain.js\'s filter cannot exclude it ' +
    'and PRODUCT-25\'s success-unreachable banner now fires on the first harvest ingest of every run');
  const src = fs.readFileSync(SELF, 'utf8');
  assertIncludes(src, "!/still in draft/.test(b)",
    'the noise filter was dropped from the PRODUCT-25 signal. Harvest forces every claim to draft ' +
    'and only verify settles them, so draft is the normal condition of every healthy run between ' +
    'the two stages; dropping the clause lights the banner on every run and trains the operator to ' +
    'ignore it. Both coherence critics rejected this half.');
});

// ===========================================================================
// J — defining children (PLAN 5.43). A census area is a `sys_metadata`
//     `sys_class_name` stratum, so sys_choice, sys_translated_text,
//     sys_highlighted_value and sys_ux_m2m_action_layout_item can never be
//     handed to harvest as an area at any budget. Every test here asserts the
//     ABSENCE of what run 6ef14f5562 actually shipped — 65 sys_choice_set
//     headers claimed and zero sys_choice values — and the fixture is that
//     run's own claim, verbatim from its .brain/claims.jsonl.
// ===========================================================================

group('J. defining children');

const CHILDREN_HARVEST = STAGE_BY_ID.get('harvest');

/**
 * The sys_choice_set claims run 6ef14f5562 shipped (claim C-5e767a72abff and its sibling),
 * reduced to the fields the harvest schema requires. `n` repeats the locus so the parent count
 * the rejection prints is a real count and not a constant.
 */
function shippedChoiceSetClaims(n) {
  const rows = [];
  for (let i = 0; i < (n || 1); i += 1) {
    const sysId = '015d60be93387650bb0d38918bba10' + String(i).padStart(2, '0');
    for (const pair of [['name', 'sn_ohs_im_injury'], ['element', 'region']]) {
      const field = pair[0];
      const value = pair[1];
      const captured = { sys_id: sysId, sys_updated_on: '2025-10-28 16:09:33' };
      captured[field] = value;
      rows.push({
        locus: { table: 'sys_choice_set', sysId, field, key: 'sn_ohs_im_injury' },
        assertion: `${field} = ${value}`, band: 'B', scope: 'sn_ohs_im', rung: 'L1',
        evidence: {
          query: `sys_idIN${sysId}`, fields: `sys_id,${field},sys_updated_on,sys_scope,sys_update_name`,
          capturedAt: '2026-08-12T08:37:51.273Z', transport: 'rest_request', completeness: 'complete',
          capturedResponse: captured,
          guards: { fields: 'validated', identityCanary: 'pass' },
        },
      });
    }
  }
  return rows;
}

function childrenCtx(name, areaId, tables, bandARows) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.queue = {
    harvestAreas: [areaId || 'sys_choice_set'], harvestDone: [],
    harvestAreaDetail: [{ id: areaId || 'sys_choice_set', tables: tables || ['sys_choice_set'], bandARows: bandARows || 137 }],
  };
  return { brain, state: brain.state, stage: 'harvest' };
}

function choiceSetArtifact(over) {
  return deepMerge({
    stage: 'harvest', instance: 'x',
    usage: { apiCalls: 6, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    area: 'sys_choice_set',
    claims: shippedChoiceSetClaims(3),
    coverage: { rowsSeen: 65, rowsTotal: 65, truncated: false },
  }, over || {});
}

const dcHits = (rej) => rej.filter((m) => /^defining children:/.test(m));

test('5.43: the choice-set harvest run 6ef14f5562 shipped — headers, no values — is refused', () => {
  const ctx = childrenCtx('dc-choice-reject');
  const rej = CHILDREN_HARVEST.validate(ctx, choiceSetArtifact());
  const hit = rej.filter((m) => /sys_choice\b/.test(m));
  assertEqual(hit.length, 1, `the exact artifact the run shipped was accepted:\n${rej.join('\n')}`);
  assertIncludes(hit[0], 'claims 3 record(s) on "sys_choice_set"',
    'the rejection does not name and count the population it checked, so it is the unnamed-population defect again');
  assertIncludes(hit[0], 'name+element = name+element',
    'the rejection does not state the join, so it is a complaint rather than an instruction');
  assertIncludes(hit[0], 'cannot become one',
    'the rejection does not say why no amount of budget or no later area fixes this');
  assertIncludes(hit[0], 'rowsSeen:0',
    'the rejection does not name its own sanctioned exit, so the only way out is to stall or to lie');
});

test('5.43: the population is THIS artifact, never the ledger', () => {
  const ctx = childrenCtx('dc-population');
  ctx.brain.upsertClaims([{
    locus: { table: 'sys_choice', sysId: 'c'.repeat(32), field: 'value' },
    assertion: 'value = 10', band: 'A', status: 'draft',
    evidence: {
      query: 'sys_idIN' + 'c'.repeat(32), fields: 'sys_id,value', capturedAt: '2026-08-12T00:00:00Z',
      capturedResponse: { sys_id: 'c'.repeat(32), value: '10' },
      guards: { fields: 'validated', identityCanary: 'pass' },
    },
  }], { stage: 'harvest' });
  assertEqual(dcHits(CHILDREN_HARVEST.validate(ctx, choiceSetArtifact())).length, 1,
    'a sys_choice claim harvested in some OTHER area silently satisfied this one — the check is counting an unnamed population');
});

test('5.43: claiming the child satisfies the rule with no bookkeeping at all', () => {
  const ctx = childrenCtx('dc-claimed');
  const art = choiceSetArtifact();
  art.claims = art.claims.concat([{
    locus: { table: 'sys_choice', sysId: 'd'.repeat(32), field: 'value' },
    assertion: 'value = 10', band: 'B', scope: 'sn_ohs_im', rung: 'L1',
    evidence: {
      query: 'name=sn_ohs_im_injury^element=region', fields: 'sys_id,value,label',
      capturedAt: '2026-08-12T08:40:00.000Z', transport: 'rest_request', completeness: 'complete',
      capturedResponse: { sys_id: 'd'.repeat(32), value: '10', label: 'STS' },
      guards: { fields: 'validated', identityCanary: 'pass' },
    },
  }]);
  assertEqual(dcHits(CHILDREN_HARVEST.validate(ctx, art)).length, 0,
    `claiming the values did not satisfy the rule that asked for them:\n${CHILDREN_HARVEST.validate(ctx, art).join('\n')}`);
});

test('5.43: reading the child and finding nothing is a sanctioned exit that mints nothing', () => {
  const ctx = childrenCtx('dc-empty-ok');
  const art = choiceSetArtifact({
    coverage: {
      rowsSeen: 65, rowsTotal: 65, truncated: false,
      children: [{ parent: 'sys_choice_set', table: 'sys_choice', parentsFollowed: 3, rowsSeen: 0, note: 'one aggregate count over the 3 parents returned 0' }],
    },
  });
  assertEqual(dcHits(CHILDREN_HARVEST.validate(ctx, art)).length, 0,
    `an honest empty child read was rejected, which leaves hand-editing .brain as the only exit:\n${CHILDREN_HARVEST.validate(ctx, art).join('\n')}`);
  assertEqual((CHILDREN_HARVEST.apply(ctx, art).findings || []).filter((f) => /defining-children-deferred/.test(f.check)).length, 0,
    'a child that WAS queried and came back empty was reported as deferred');
});

test('5.43: a deferral is accepted AND mints a warning, so it is never free', () => {
  const ctx = childrenCtx('dc-deferred');
  const art = choiceSetArtifact({
    coverage: {
      rowsSeen: 65, rowsTotal: 65, truncated: false,
      children: [{ parent: 'sys_choice_set', table: 'sys_choice', parentsFollowed: 0, rowsSeen: 0, deferred: true, note: 'out of budget in this area' }],
    },
  });
  assertEqual(dcHits(CHILDREN_HARVEST.validate(ctx, art)).length, 0, 'a declared deferral was rejected, so the guard has no sanctioned exit');
  const f = (CHILDREN_HARVEST.apply(ctx, art).findings || []).filter((x) => /defining-children-deferred/.test(x.check));
  assertEqual(f.length, 1, 'a deferred child closed silently inside a coverage field');
  assertEqual(f[0].severity, 'warning', 'the deferral was minted at a severity the run can ignore or one it cannot pass');
  assertIncludes(f[0].message, 'No census area can reach',
    'the finding does not say why this deferral is terminal for the run rather than merely late');
});

test('5.43: sys_translated_text is demanded of the parents that carry it, and of no others', () => {
  const ctx = childrenCtx('dc-translated', 'sys_ux_macroponent', ['sys_ux_macroponent'], 30);
  const art = choiceSetArtifact({ area: 'sys_ux_macroponent' });
  art.claims = art.claims.map((c) => deepMerge(c, { locus: { table: 'sys_ux_macroponent' } }));
  assertIncludes(dcHits(CHILDREN_HARVEST.validate(ctx, art)).join(' '), 'sys_translated_text',
    'the run claimed 41 sys_translated rows and zero sys_translated_text while its own update sets said they held it, and that still passes');

  // A table with no declared children pays nothing: the stage's own worked example must stay clean.
  const plain = childrenCtx('dc-translated-none', 'business-rules', ['sys_script'], 412);
  const ex = CHILDREN_HARVEST.example(plain);
  assertEqual(dcHits(CHILDREN_HARVEST.validate(plain, ex)).length, 0,
    `a table with no declared children was made to pay for the rule:\n${CHILDREN_HARVEST.validate(plain, ex).join('\n')}`);
});

test('5.43: the follow reaches the record that makes a workspace button render, and stops there', () => {
  const plan = stages.definingChildrenFor(['sys_ux_form_action']);
  const tables = plan.map((p) => p.table);
  assert(tables.indexOf('sys_ux_form_action_layout_item') >= 0, 'the layout item is not reachable from the action');
  assert(tables.indexOf('sys_ux_m2m_action_layout_item') >= 0,
    'sys_ux_m2m_action_layout_item — the record that decides whether the button renders at all — is reachable at no depth');
  assert(plan.every((p) => p.level < stages.CHILD_DEPTH_CAP),
    `the depth cap is not enforced: ${JSON.stringify(plan.map((p) => [p.table, p.level]))}`);
  assertEqual(stages.definingChildrenFor(['sys_ux_form_action'], { depth: 1 }).length, 2,
    'depth 1 must be the DIRECT children only, because that is the set the artifact-level check counts');
});

test('5.43: the census cannot carry these tables as areas, in either direction', () => {
  const CENSUS = STAGE_BY_ID.get('census');
  const ctx = fakeCtx({ stage: 'census' });
  const base = CENSUS.example(ctx);

  const zero = JSON.parse(JSON.stringify(base));
  zero.areas.push({ id: 'sys_choice', tables: ['sys_choice'], bandARows: 0, why: 'the choice values' });
  assertIncludes(CENSUS.validate(ctx, zero).join(' '), 'bandARows<=0',
    'a non-metadata table was admitted as an area with no Band A rows, so option (b) looked free');

  const nonzero = JSON.parse(JSON.stringify(base));
  nonzero.areas.push({ id: 'sys_choice', tables: ['sys_choice'], bandARows: 300, why: 'the choice values' });
  assertIncludes(CENSUS.validate(ctx, nonzero).join(' '), 'Areas overlap',
    'an area whose rows are not IN Band A was admitted, which is PRODUCT-12 arithmetic broken to smuggle a stratum in');
});

test('5.43: every declared child names a join with the same arity on both sides', () => {
  for (const parent of Object.keys(stages.DEFINING_CHILDREN)) {
    for (const c of stages.DEFINING_CHILDREN[parent]) {
      assert(c.table && c.table !== parent, `${parent}: a defining child must be a different table`);
      assert(c.on && c.on.parent.length > 0 && c.on.parent.length === c.on.child.length,
        `${parent} -> ${c.table}: the join is ${JSON.stringify(c.on)}, which cannot be issued as an encoded query`);
      assert((c.shape || []).length >= 2,
        `${parent} -> ${c.table}: no meaning-bearing columns declared, so following it would inventory the child rather than harvest it`);
      assert(typeof c.why === 'string' && c.why.length > 30,
        `${parent} -> ${c.table}: no reason recorded, and an undocumented child is the next thing somebody deletes`);
    }
  }
});

group('I. renderer');

const RENDER_LIB = require('./render.js');

/** One artifact folded from claims, the way indexArtifacts() builds it. */
function artifactFrom(fields, key) {
  const claims = Object.entries(fields).map(([f, assertion], i) => ({
    id: `C-${i}`, locus: { table: 'sys_script', sysId: 'a'.repeat(32), field: f, key: key || undefined },
    assertion, status: 'draft',
  }));
  return RENDER_LIB.indexArtifacts(claims)[0];
}

test('PRODUCT-81: an artifact is never named after the table it acts on', () => {
  // The exact record the A/B found: a business rule rendering as its target table.
  const a = artifactFrom({ collection: 'collection = sn_ohs_im_incident', active: 'active = true' },
    'ACME - QRT Selection State Validation');
  assertEqual(a.display, 'ACME - QRT Selection State Validation', 'locus.key was not preferred');
  assertEqual(a.target, 'sn_ohs_im_incident', 'the target was not surfaced in its own column');
  // With no name claimed at all, say so — do not fall back to the target.
  const anon = artifactFrom({ collection: 'collection = sn_ohs_im_incident', active: 'active = true' });
  assert(/no name claimed/.test(anon.display), `fell back to a target table: "${anon.display}"`);
  for (const f of RENDER_LIB.TARGET_FIELDS) {
    assert(!RENDER_LIB.DISPLAY_NAME_FIELDS.includes(f), `${f} is both a name and a target field`);
  }
});

test('PRODUCT-81: a real name column is used when locus.key is absent', () => {
  const a = artifactFrom({ name: 'name = ACME guard', collection: 'collection = sn_ohs_im_incident' });
  assertEqual(a.display, 'ACME guard', 'a claimed name column was ignored');
});

test('PRODUCT-79/80: the artifact table shows values and marks the dead', () => {
  const live = artifactFrom({ active: 'active = true', when: 'when = before' }, 'ACME guard');
  const dead = artifactFrom({ active: 'active = false', when: 'when = after' }, 'ACME Case sluiten');
  const table = RENDER_LIB.artifactTable([live, dead]);
  assert(/\bAsserts\b/.test(table), 'the artifact table has no Asserts column');
  assert(/active = true/.test(table) && /when = before/.test(table), 'the values were dropped');
  assert(/\*\*RETIRED\*\* · ACME Case sluiten/.test(table), 'a dead artifact was rendered indistinguishably from a live one');
  assert(!/\*\*RETIRED\*\* · ACME guard/.test(table), 'a live artifact was marked retired');
});

test('PRODUCT-79: page status is computed from the ledger, never asserted', () => {
  const byId = new Map([['a', { id: 'a', status: 'verified' }], ['b', { id: 'b', status: 'draft' }]]);
  assertEqual(RENDER_LIB.pageStatus(['a'], byId), 'verified');
  assertEqual(RENDER_LIB.pageStatus(['a', 'b'], byId), 'mixed');
  assertEqual(RENDER_LIB.pageStatus(['b'], byId), 'draft');
  assertEqual(RENDER_LIB.pageStatus([], byId), 'draft', 'a page rendering nothing claimed to be verified');
});

test('PRODUCT-70: --check catches an over-cap page, a missing asserts column and an unmarked retirement', () => {
  const root = scratchRepo('rl-check');
  const wiki = path.join(root, 'docs', 'wiki');
  fs.mkdirSync(path.join(wiki, 'processes'), { recursive: true });
  fs.mkdirSync(path.join(wiki, 'stories'), { recursive: true });
  for (const g of RENDER_LIB.GOVERNANCE_FILES) {
    fs.mkdirSync(path.dirname(path.join(wiki, g)), { recursive: true });
    fs.writeFileSync(path.join(wiki, g), '# governance\n');
  }
  fs.writeFileSync(path.join(wiki, 'processes', 'huge.md'), `# Huge\n\n${'x'.repeat(21 * 1024)}\n`);
  fs.writeFileSync(path.join(wiki, 'processes', 'inventory.md'),
    '# Inventory\n\n| Table | Name | sys_id |\n|---|---|---|\n| sys_script | ACME guard | abc |\n');
  fs.writeFileSync(path.join(wiki, 'processes', 'dead.md'),
    '# Dead\n\n| Table | Name | Asserts |\n|---|---|---|\n| sys_ui_action | Case sluiten | active = false |\n');
  const problems = RENDER_LIB.checkWiki(root, 'docs/wiki');
  assert(problems.some((p) => /huge\.md.*exceeds the ~20KB page cap/.test(p)), 'the page cap is not enforced');
  assert(problems.some((p) => /inventory\.md.*no Asserts column/.test(p)), 'an assertion-free artifact table passed');
  assert(problems.some((p) => /dead\.md.*no retirement marker/.test(p)), 'an unmarked dead artifact passed');
  // A clean wiki is clean.
  fs.rmSync(path.join(wiki, 'processes', 'huge.md'));
  fs.rmSync(path.join(wiki, 'processes', 'inventory.md'));
  fs.writeFileSync(path.join(wiki, 'processes', 'dead.md'),
    '# Dead\n\n| Table | Name | Asserts |\n|---|---|---|\n| sys_ui_action | **RETIRED** Case sluiten | active = false |\n');
  assertEqual(RENDER_LIB.checkWiki(root, 'docs/wiki').length, 0, 'a conforming wiki was still rejected');
});

test('PRODUCT-81: --check audits the PAGES, not its own naming function', () => {
  /*
   * The first version of this check asked whether displayName() had returned a target column,
   * which it cannot do by construction: it reported 0 problems on a wiki holding 147 artifacts
   * rendered under the table they act on. A check that cannot fire reads as coverage.
   */
  const root = scratchRepo('rl-name-audit');
  const wiki = path.join(root, 'docs', 'wiki');
  fs.mkdirSync(path.join(wiki, 'registry'), { recursive: true });
  for (const g of RENDER_LIB.GOVERNANCE_FILES) {
    fs.mkdirSync(path.dirname(path.join(wiki, g)), { recursive: true });
    fs.writeFileSync(path.join(wiki, g), '# governance\n');
  }
  const sysId = 'b'.repeat(32);
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), [
    JSON.stringify({ id: 'C-1', locus: { table: 'sys_script', sysId, key: 'ACME - QRT Selection State Validation', field: 'active' }, assertion: 'active = true', status: 'draft' }),
    JSON.stringify({ id: 'C-2', locus: { table: 'sys_script', sysId, field: 'collection' }, assertion: 'collection = sn_ohs_im_incident', status: 'draft' }),
  ].join('\n'));

  // The delivered shape: cited by sys_id, rendered under the table it acts on.
  fs.writeFileSync(path.join(wiki, 'registry', 'rules.md'),
    `# Rules\n\n| Artifact | Asserts | sys_id |\n|---|---|---|\n| sn_ohs_im_incident | active = true | ${sysId} |\n`);
  assert(RENDER_LIB.checkWiki(root, 'docs/wiki').some((p) => /cited by sys_id/.test(p)),
    'an artifact rendered under its target table passed the name audit');

  // Named properly: clean.
  fs.writeFileSync(path.join(wiki, 'registry', 'rules.md'),
    `# Rules\n\n| Artifact | Acts on | Asserts | sys_id |\n|---|---|---|---|\n` +
    `| ACME - QRT Selection State Validation | sn_ohs_im_incident | active = true | ${sysId} |\n`);
  assertEqual(RENDER_LIB.checkWiki(root, 'docs/wiki').filter((p) => /cited by sys_id/.test(p)).length, 0,
    'a properly named artifact was faulted');
});

test('PRODUCT-69: --check refuses a wiki missing the shipped governance files', () => {
  const root = scratchRepo('rl-gov');
  fs.mkdirSync(path.join(root, 'docs', 'wiki'), { recursive: true });
  const problems = RENDER_LIB.checkWiki(root, 'docs/wiki');
  for (const g of RENDER_LIB.GOVERNANCE_FILES) {
    assert(problems.some((p) => p.startsWith(`${g}:`)), `${g} may go missing without complaint`);
  }
});

/*
 * PRODUCT-95, the three accounting rejections, one test each.
 *
 * FOUND BY MUTATION, not by design: the first version of these guards shipped with the
 * manifest-id direction covered by NOTHING. `mutate.js` broke it and the whole suite stayed green,
 * because every render fixture had been fixed to print the ids it declares — the fixtures made the
 * guard unreachable and the guard's own replay against `pilot-run-4` raises 0 rejections, so neither
 * signal could have told me. That is METHOD-4's headline arriving from the other side: replay says
 * what a guard does on real data, mutation says whether anything would notice it disappearing, and
 * a guard needs both.
 */
function accountingArt(name, opts) {
  const o = opts || {};
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims([
    { locus: { table: 't', sysId: 's1' }, assertion: 'a', band: 'A', status: 'verified' },
    { locus: { table: 't', sysId: 's2' }, assertion: 'b', band: 'A', status: 'verified' },
  ], { stage: 'verify' });
  const ids = [...brain.claims().values()].map((c) => c.id);
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  const printed = o.printed === undefined ? ids : o.printed(ids);
  const declared = o.declared === undefined ? printed.length : o.declared(ids, printed);
  put('docs/wiki/registry-sys-ids.md',
    `---\nclaims-rendered: ${declared}\n---\n\n# Registry\n\n${printed.map((id) => `- something \`${id}\``).join('\n')}\n`);
  return {
    ctx: { brain, state: brain.state, stage: 'render' },
    ids,
    art: {
      pages: [{ path: 'docs/wiki/registry-sys-ids.md', status: 'verified', rendersClaims: o.manifest === undefined ? printed : o.manifest(ids), tier: 'registry' }],
      kernel: { path: 'CLAUDE.md', routingEntries: 3 },
      settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
    },
  };
}

test('PRODUCT-95: a manifest id that appears nowhere in its page is rejected', () => {
  // The inflated manifest: the page declares two claims and prints one. This raises ZERO
  // rejections on pilot-run-4 — that run read rendersClaims off the files — and it ships anyway,
  // because it is the half that stops the manifest inflating. Nothing else can.
  const { ctx, art } = accountingArt('rn-acct-manifest', { printed: (ids) => [ids[0]], manifest: (ids) => ids });
  const rej = RENDER.validate(ctx, art);
  assert(rej.some((m) => /do not appear anywhere in the rendered file/.test(m)),
    `a page declared a claim it does not cite:\n${rej.join('\n')}`);
  assert(rej.some((m) => /citation graph/.test(m)),
    'the rejection does not warn against fixing it by shortening rendersClaims');
});

test('PRODUCT-95: a claim id the page prints but the manifest omits is rejected', () => {
  /*
   * The other direction, and the one run 93838afe87 actually shipped: decisions-sealed-recall.md
   * printed 35 claim ids under an EMPTY rendersClaims and was marked draft on the strength of it,
   * because page status is computed from the manifest and the manifest said the page rested on
   * nothing.
   */
  const { ctx, art } = accountingArt('rn-acct-uncited', { manifest: (ids) => [ids[0]] });
  const rej = RENDER.validate(ctx, art);
  assert(rej.some((m) => /print claim ids that rendersClaims does not list/.test(m)),
    `a page rested on evidence the manifest never declared:\n${rej.join('\n')}`);
});

test('PRODUCT-95: claims-rendered must equal the ids the page prints, and all three agree or none do', () => {
  const { ctx, art } = accountingArt('rn-acct-count', { declared: () => 582 });
  const rej = RENDER.validate(ctx, art);
  assert(rej.some((m) => /declares 582, prints 2/.test(m)),
    `the widest real case — 582 declared against 69 printed — passed:\n${rej.join('\n')}`);
  // Set equality in BOTH directions plus the derived count: the only cheap way to satisfy all
  // three at once is to compute them from the file, which is the point (METHOD-4's third rule).
  const ok = accountingArt('rn-acct-agree');
  assertEqual(RENDER.validate(ok.ctx, ok.art).filter((m) => /claims-rendered|rendersClaims/.test(m)).length, 0,
    'a page whose three counts agree was rejected');
});

/*
 * PRODUCT-95. The measured shape of run 93838afe87's wiki, reduced to a fixture: a page whose
 * `claims-rendered` frontmatter is a number nothing computed, and a ledger whose biggest tables
 * are named nowhere.
 */
function accountingWiki(name, opts) {
  const o = opts || {};
  const root = scratchRepo(name);
  const wiki = path.join(root, 'docs', 'wiki');
  fs.mkdirSync(wiki, { recursive: true });
  for (const g of RENDER_LIB.GOVERNANCE_FILES) {
    fs.mkdirSync(path.dirname(path.join(wiki, g)), { recursive: true });
    fs.writeFileSync(path.join(wiki, g), '# governance\n');
  }
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  const rows = [];
  for (let i = 0; i < (o.claims === undefined ? 12 : o.claims); i += 1) {
    rows.push(JSON.stringify({
      id: `C-${String(i).padStart(12, '0')}`,
      locus: { table: i < 6 ? 'question_choice' : 'sys_ui_action', sysId: String(i).padEnd(32, 'a'), key: `artifact ${i}`, field: 'active' },
      assertion: `active = ${i}`, status: 'verified',
    }));
  }
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), rows.join('\n') + (rows.length ? '\n' : ''));
  return { root, wiki };
}

test('PRODUCT-95: --check fails on a page whose claims-rendered is not what it prints', () => {
  const { root, wiki } = accountingWiki('rl-count', { claims: 0 });
  /*
   * The widest real case: docs/wiki/processes/acties-hoofd-en-sub.md declared 582 and printed 69,
   * and `render --check` reported CLEAN over that and 20 other pages like it. The one validator
   * the product had did not examine its own headline number.
   */
  fs.writeFileSync(path.join(wiki, 'wide.md'), '---\nclaims-rendered: 582\n---\n\n# Wide\n\n- `C-0123456789ab`\n');
  const problems = RENDER_LIB.checkWiki(root, 'docs/wiki');
  assert(problems.some((p) => /declares 582, prints 1/.test(p)), `a hand-written count passed:\n${problems.join('\n')}`);

  // The other direction is the same defect and must also fail: decisions.md declared 7 and printed 23.
  fs.writeFileSync(path.join(wiki, 'wide.md'), '---\nclaims-rendered: 1\n---\n\n# Wide\n\n- `C-0123456789ab`\n- `C-0123456789ac`\n');
  assert(RENDER_LIB.checkWiki(root, 'docs/wiki').some((p) => /declares 1, prints 2/.test(p)),
    'a page printing MORE ids than it declares passed');

  fs.writeFileSync(path.join(wiki, 'wide.md'), '---\nclaims-rendered: 2\n---\n\n# Wide\n\n- `C-0123456789ab`\n- `C-0123456789ac`\n');
  assertEqual(RENDER_LIB.checkWiki(root, 'docs/wiki').filter((p) => /claims-rendered/.test(p)).length, 0,
    'a page whose count is its own citation count was faulted');
});

test('PRODUCT-95: a table with real weight in the ledger that no page names is reported', () => {
  const { root, wiki } = accountingWiki('rl-unmentioned');
  const problems = RENDER_LIB.checkWiki(root, 'docs/wiki');
  assert(problems.some((p) => /named nowhere in the wiki/.test(p) && /question_choice/.test(p)),
    `a whole class of evidence was dropped silently:\n${problems.join('\n')}`);

  // Naming it anywhere is enough: the rule is that dropping a class is a DECISION, not that every
  // table earns a curated page.
  fs.writeFileSync(path.join(wiki, 'note.md'),
    '---\nclaims-rendered: 0\n---\n\n# Coverage\n\nquestion_choice and sys_ui_action are rendered in the evidence appendix.\n');
  assertEqual(RENDER_LIB.checkWiki(root, 'docs/wiki').filter((p) => /named nowhere/.test(p)).length, 0,
    'naming the tables did not clear the finding, so the only exit is a page per table');
});

test('PRODUCT-95: the population is tables at or above the threshold, and it is stated', () => {
  const claims = [];
  for (let i = 0; i < 5; i += 1) { claims.push({ id: `C-a${i}`, locus: { table: 'big', sysId: 'x' } }); }
  for (let i = 0; i < 4; i += 1) { claims.push({ id: `C-b${i}`, locus: { table: 'small', sysId: 'y' } }); }
  const u = RENDER_LIB.unmentionedTables(claims, 'nothing is named here');
  assertEqual(u.eligible, 1, 'the threshold counted a table with four claims');
  assertEqual(u.total, 2, 'the total does not count every table with claims');
  assertEqual(u.tables.map((t) => t.table).join(','), 'big');
  /*
   * METHOD-4's second rule, and the register's own: this check's headline was published as
   * "99 of 165" while 165 is every table with any claims and 99 counts only those at or above
   * five — two populations in one ratio, in the entry that adopted the rule against exactly that.
   * The eligible count is what the ratio is against.
   */
  assertEqual(RENDER_LIB.unmentionedTables(claims, 'big').tables.length, 0, 'a named table was still reported');
});

test('PRODUCT-95: the evidence appendix renders every claim, under the cap, dropping none', () => {
  const root = scratchRepo('rl-appendix');
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  const rows = [];
  const expect = new Set();
  for (let i = 0; i < 400; i += 1) {
    const id = `C-${String(i).padStart(12, '0')}`;
    expect.add(id);
    rows.push(JSON.stringify({
      id, status: 'verified',
      locus: { table: i % 7 === 0 ? 'sys_ui_policy' : 'sys_script', sysId: String(i % 40).padEnd(32, 'a'), key: `artifact ${i % 40}`, field: `col_${i}` },
      assertion: `col_${i} = ${'v'.repeat(i)}`,
    }));
  }
  // A record-level claim with no field at all: 8 of run 93838afe87's 19,360 look like this, and
  // the first version of the generator rendered none of them.
  rows.push(JSON.stringify({ id: 'C-ffffffffffff', status: 'verified', locus: { table: 'sys_script', sysId: 'a'.repeat(32), key: 'artifact 0' }, assertion: 'this record exists' }));
  expect.add('C-ffffffffffff');
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), rows.join('\n') + '\n');

  const built = RENDER_LIB.buildEvidenceAppendix(root, { minClaims: 5 });
  const rendered = new Set();
  for (const p of built.pages) { for (const id of RENDER_LIB.claimIdsIn(p.body)) { rendered.add(id); } }
  assertEqual(rendered.size, expect.size,
    `the appendix dropped ${expect.size - rendered.size} claim(s); an appendix that silently drops evidence is the defect it exists to answer`);
  assertEqual(built.totals.claimsRendered, expect.size, 'the totals disagree with the pages');

  for (const p of built.pages) {
    assert(Buffer.byteLength(p.body, 'utf8') <= RENDER_LIB.PAGE_BYTE_CAP,
      `${p.path} is ${Buffer.byteLength(p.body, 'utf8')} bytes, over the cap every other page obeys`);
    const declared = RENDER_LIB.frontmatterNumber(p.body, 'claims-rendered');
    assertEqual(declared, RENDER_LIB.claimIdsIn(p.body).size,
      `${p.path} declares a claims-rendered count it does not print — the generator broke the rule it was built to satisfy`);
  }
  // Deterministic: the same ledger must produce the same pages, or a re-render is a diff.
  const again = RENDER_LIB.buildEvidenceAppendix(root, { minClaims: 5 });
  assertEqual(again.pages.map((p) => p.path).join('|'), built.pages.map((p) => p.path).join('|'),
    'two runs over the same ledger produced different page sets');
});

test('PRODUCT-95: the appendix declares itself, so the accounting rule is satisfiable', () => {
  /*
   * METHOD-4's third rule, applied to my own guard. render.validate demands that a page's
   * rendersClaims equal the ids it prints; the appendix prints every claim in the ledger — 19,360
   * of them on pilot-run-4 — so a human or an agent retyping that into render.json will not do it
   * correctly, and the cheapest WRONG answer is to declare the appendix pages with empty arrays,
   * which is the exact evidence-graph deletion PRODUCT-79 warns about. The generator therefore
   * emits the declaration it just earned, and this asserts the two agree.
   */
  const root = scratchRepo('rl-appendix-manifest');
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    rows.push(JSON.stringify({
      id: `C-${String(i).padStart(12, '0')}`, status: i % 5 ? 'verified' : 'draft',
      locus: { table: 'sys_script', sysId: String(i % 4).padEnd(32, 'a'), key: `rule ${i % 4}`, field: `col_${i}` },
      assertion: `col_${i} = v`,
    }));
  }
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), rows.join('\n') + '\n');
  const built = RENDER_LIB.buildEvidenceAppendix(root, { minClaims: 5 });
  for (const p of built.pages) {
    const declared = new Set(p.claimIds);
    const printed = RENDER_LIB.claimIdsIn(p.body);
    assertEqual([...declared].sort().join(','), [...printed].sort().join(','),
      `${p.path}: the manifest the generator emits is not the set of ids the page it wrote prints`);
    assertEqual(RENDER_LIB.frontmatterNumber(p.body, 'claims-rendered'), printed.size,
      `${p.path}: the generated frontmatter count is not the count it prints`);
    // And `status` is computed, not invented: a page carrying a draft claim may not read verified.
    const status = RENDER_LIB.frontmatterValue(p.body, 'status');
    assert(['draft', 'mixed', 'verified'].includes(status), `${p.path}: status "${status}" is outside the computed vocabulary`);
  }
  const anyDraft = built.pages.filter((p) => p.claimIds.some((id) => /0$|5$/.test(id)));
  assert(anyDraft.length === 0 || anyDraft.every((p) => RENDER_LIB.frontmatterValue(p.body, 'status') !== 'verified'),
    'a generated page rendering a draft claim called itself verified');
});

test('PRODUCT-95: a column that was FETCHED and never claimed is rendered, and marked', () => {
  /*
   * The head-to-head measurement that produced this: a blind tester working PLAN 6.1's own
   * appendix lost task 3 on `allow_update = "false"`, which harvest fetched, received, and never
   * minted a claim from — so it sat in a tracked file, on no page, and decided a diagnosis in two
   * opposite directions. The appendix rendered claims; the run had paid for more than claims.
   */
  const root = scratchRepo('rl-appendix-fetched');
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  const sysId = 'e'.repeat(32);
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), [
    JSON.stringify({
      id: 'C-000000000001', status: 'verified',
      locus: { table: 'x_vendor_config', sysId, key: 'Process Incident', field: 'coalesce' },
      assertion: 'coalesce = true',
      evidence: { capturedResponse: { sys_id: sysId, coalesce: 'true', allow_update: 'false', create_if_no_coalesce: 'true', sys_updated_by: 'someone' } },
    }),
    JSON.stringify({
      id: 'C-000000000002', status: 'verified',
      locus: { table: 'x_vendor_config', sysId, key: 'Process Incident', field: 'active' },
      assertion: 'active = true',
      evidence: { capturedResponse: { sys_id: sysId, active: 'true', max_records: '100' } },
    }),
  ].join('\n') + '\n');

  const built = RENDER_LIB.buildEvidenceAppendix(root, { minClaims: 1 });
  const body = built.pages.map((p) => p.body).join('\n');
  assert(/allow_update/.test(body), 'a column the run fetched and never claimed is still invisible');
  assert(/create_if_no_coalesce/.test(body), 'the second unclaimed column was dropped');
  /*
   * ASSERT THE MARKER ON THE ROW THAT NEEDS IT. A bare search for the marker string is satisfied
   * by the compressed audit row, which carries it too — so deleting it from every per-column row
   * left this test green. Mutation caught that, and it is the second time in two rounds an
   * assertion has been satisfied by something adjacent to the thing under test.
   */
  assert(/\| `allow_update` \| false \| _fetched, never claimed_ \|/.test(body),
    'an unclaimed column is rendered without the marker on its own row, so it reads as a claim');
  assert(/\| `create_if_no_coalesce` \| true \| _fetched, never claimed_ \|/.test(body),
    'the marker is not on every unclaimed row');
  // A claimed column keeps its claim id and is NOT relabelled.
  assert(/`coalesce` \| coalesce = true \| `C-000000000001`/.test(body), 'a claimed column lost its claim id');
  // Platform audit columns are compressed, not dropped — compressing is about noise, not importance.
  assert(/platform audit columns/.test(body) && /sys_updated_by=someone/.test(body),
    'an audit column was dropped rather than compressed');
  assert(built.totals.unclaimedColumns >= 4, `the unclaimed tally is not reported: ${built.totals.unclaimedColumns}`);
  const index = built.pages[built.pages.length - 1].body;
  assert(/column\(s\) are marked `fetched, never claimed`/.test(index),
    'the index does not state how many columns were fetched and never claimed');
  /*
   * AND THE INDEX EXPLAINS THE MARKER WITHOUT NARRATING THE FRAMEWORK'S OWN TESTING. The first
   * version told the reader that "a blind head-to-head tester was stopped by exactly one of these"
   * — build-log commentary, in the customer's deliverable, about the framework that produced it. A
   * tester quoted it back as evidence that the repo knew the column mattered and published it
   * without its meaning. The engagement wiki is not the place the product keeps its own diary.
   */
  for (const leak of [/head-to-head/, /ground-truth/, /PRODUCT-\d/, /\btester\b/, /A\/B/]) {
    assert(!leak.test(index), `the generated index leaks framework build-log commentary: ${leak}`);
  }
});

test('PRODUCT-95: a table below the threshold is COLLECTED, never dropped', () => {
  const root = scratchRepo('rl-appendix-minor');
  fs.mkdirSync(path.join(root, '.brain'), { recursive: true });
  fs.writeFileSync(path.join(root, '.brain', 'claims.jsonl'), [
    JSON.stringify({ id: 'C-000000000001', locus: { table: 'rare_table', sysId: 'a'.repeat(32), key: 'r', field: 'active' }, assertion: 'active = true', status: 'verified' }),
    JSON.stringify({ id: 'C-000000000002', locus: { table: 'rare_table', sysId: 'a'.repeat(32), key: 'r', field: 'order' }, assertion: 'order = 100', status: 'verified' }),
  ].join('\n') + '\n');
  const built = RENDER_LIB.buildEvidenceAppendix(root, { minClaims: 5 });
  const all = built.pages.map((p) => p.body).join('\n');
  assert(/rare_table/.test(all), 'a table under the threshold vanished instead of being collected');
  assert(RENDER_LIB.claimIdsIn(all).has('C-000000000001'), 'a claim on a small table was silently dropped');
  assert(built.pages.some((p) => /\/minor\//.test(p.path)), 'the collected tables are not separated from the curated axis');
});

test('the render stage requires the shipped renderer and forbids a fourth one', () => {
  const ctx = { brain: { root: '/x' }, state: { config: {}, stamps: {}, queue: {} } };
  const reads = STAGE_BY_ID.get('render').reads(ctx).map((r) => r.path);
  assert(reads.includes('tools/snbrain/render.js'), 'render does not name the shipped renderer as required reading');
  const proc = STAGE_BY_ID.get('render').procedure(ctx).join(' ');
  assert(/may not re-implement/.test(proc), 'the brief does not forbid re-implementing the primitives');
  assert(/--check/.test(proc), 'the brief does not tell the agent to run --check');
});

// ===========================================================================
// M — the deliverable. PRODUCT-97: a run whose output is not in a commit has
//     not delivered it, and the .gitignore says otherwise in prose.
// ===========================================================================

group('M. the deliverable');

const DELIVERABLE = require('./lib/deliverable.js');

/** A repo with a committed scaffold and an uncommitted "run output" on top of it. */
function deliverableFixture(name) {
  const root = scratchRepo(name);
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# scaffold kernel\n');
  put('docs/wiki/index.md', '# scaffold index\n');
  put('.claude/settings.json', '{}');
  gitCommitAll(root, 'chore: engagement repo installed (the scaffold)');
  // Now the run happens: the scaffold pages are REWRITTEN and new ones appear.
  put('CLAUDE.md', '# the run\'s kernel\n');
  put('docs/wiki/index.md', '# the run\'s index\n');
  put('docs/wiki/processes/onderzoek.md', '# a page only the run wrote\n');
  for (const f of DELIVERABLE.BRAIN_DELIVERABLE) { put(f, '{}\n'); }
  const art = {
    pages: [{ path: 'docs/wiki/index.md' }, { path: 'docs/wiki/processes/onderzoek.md' }],
    kernel: { path: 'CLAUDE.md' },
    settings: { path: '.claude/settings.json' },
  };
  return { root, art };
}

test('PRODUCT-97: TRACKED is not DELIVERED — a stale tracked path fails the acceptance', () => {
  const { root, art } = deliverableFixture('dl-stale');
  const paths = DELIVERABLE.deliverablePaths(art);
  const s = DELIVERABLE.deliverableGitStatus(root, paths);
  /*
   * The measured shape of run 93838afe87: 26 of 39 declared paths untracked, and the 13 that
   * passed a PRESENCE check did so only because the installer's commit — dated two days before
   * the run — happened to have created a file at the same path. Their tracked content is the
   * scaffold; a presence check reports the deliverable as delivered while the deliverable is
   * exactly the thing that would be lost.
   */
  assert(s.untracked.includes('docs/wiki/processes/onderzoek.md'), 'a page only the run wrote was reported as tracked');
  assert(s.dirty.includes('CLAUDE.md') && s.dirty.includes('docs/wiki/index.md'),
    `two-day-stale tracked paths passed: ${JSON.stringify(s)}`);
  assert(!s.ok, 'a repo holding the scaffold and not the run was accepted as a deliverable');
  const lines = DELIVERABLE.describeDeliverableStatus(s).join(' ');
  assert(/tracked but MODIFIED/.test(lines), 'the report does not distinguish untracked from stale');
});

test('PRODUCT-97: the commit stages the DECLARED paths and nothing else', () => {
  const { root, art } = deliverableFixture('dl-commit');
  fs.writeFileSync(path.join(root, 'unrelated-operator-file.txt'), 'not mine to commit\n');
  const res = DELIVERABLE.commitDeliverable(root, { paths: DELIVERABLE.deliverablePaths(art), message: 'chore: the deliverable' });
  assert(res.committed, `the commit did not happen: ${res.reason}`);
  assert(res.status.ok, `the deliverable is still not tracked and clean: ${JSON.stringify(res.status)}`);
  const st = require('child_process').spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).stdout;
  assert(/unrelated-operator-file\.txt/.test(st),
    'an operator\'s unrelated working-tree change was swept into the deliverable commit');
});

test('PRODUCT-97: a repo with no HEAD is reported as the answer, not as a pass', () => {
  const root = scratchRepo('dl-no-head');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# kernel\n');
  const s = DELIVERABLE.deliverableGitStatus(root, ['CLAUDE.md']);
  // pilot-run-3, exactly: a git repo that has never committed anything. Every "is it tracked"
  // question is vacuous there, and the honest report is that there is nothing to hand over.
  assert(!s.hasHead && !s.ok, 'a repo with no commits passed the deliverable acceptance');
  assert(/no HEAD/.test(DELIVERABLE.describeDeliverableStatus(s).join(' ')), 'the report does not say the repo has never committed');
  /*
   * AND THE EMPTY DECLARATION, which is the only shape that reaches the `hasHead` term.
   *
   * Mutation found this: dropping `hasHead` from `ok` broke nothing, because in any repo with no
   * commits every real path is untracked and fails on that instead. The term looks redundant and
   * is not — a render declaring no pages at all would otherwise report a clean deliverable in a
   * repo that has never committed anything, which is `pilot-run-3` reporting success over an empty
   * `git clone`. A guard term nothing can reach is a guard term nothing is testing.
   */
  const empty = DELIVERABLE.deliverableGitStatus(root, []);
  assertEqual(empty.ok, false, 'a repo with no HEAD reported a clean deliverable because nothing was declared');
  gitCommitAll(root, 'chore: the scaffold');
  assertEqual(DELIVERABLE.deliverableGitStatus(root, ['CLAUDE.md']).ok, true,
    'a committed, clean deliverable was still refused, so the acceptance can never be satisfied');
});

test('PRODUCT-97: ingesting a render COMMITS the deliverable, through the real CLI', () => {
  const root = scratchRepo('dl-ingest');
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's1' }, assertion: 'a', band: 'A', status: 'verified' }], { stage: 'verify' });
  const claimId = [...brain.claims().values()][0].id;
  brain.state.stage = 'render';
  brain.state.stages.render.status = 'active';
  brain.save('seed-render');
  gitCommitAll(root, 'chore: engagement repo installed (the scaffold)');

  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  put('docs/wiki/registry-sys-ids.md', `---\nclaims-rendered: 1\n---\n\n# Registry\n\n- \`${claimId}\`\n`);
  const art = {
    stage: 'render', instance: 'selftest-instance', usage: { apiCalls: 0, notes: 'render reads the ledgers' },
    pages: [{ path: 'docs/wiki/registry-sys-ids.md', status: 'verified', rendersClaims: [claimId], tier: 'registry' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
    acceptance: STAGE_BY_ID.get('render').acceptance.map((a) => ({ id: a.id, result: 'pass', evidence: 'selftest' })),
  };
  put('.brain/in/render.json', JSON.stringify(art, null, 1));

  const r = cliJson(['ingest', '--stage', 'render', '--file', path.join(root, '.brain', 'in', 'render.json'), '--root', root]);
  assertEqual(r.code, 0, `the render ingest failed:\n${r.stdout}${r.stderr}`);
  assert((r.json.deliverable || []).some((l) => /committed as/.test(l)),
    `the CLI did not report a commit: ${JSON.stringify(r.json.deliverable)}`);
  /*
   * The assertion that matters is not "a commit happened" but "the deliverable is IN it, and
   * clean" — including state.json and the three ledgers, which is why the commit is the last act
   * of the ingest and not part of render.apply.
   */
  const status = DELIVERABLE.deliverableGitStatus(root, DELIVERABLE.deliverablePaths(art), { required: DELIVERABLE.declaredPaths(art) });
  assert(status.ok, `after an accepted render the deliverable is still not committed: ${JSON.stringify(status)}`);
  assertEqual(status.untracked.length + status.dirty.length, 0,
    'something the ingest wrote AFTER the commit left the deliverable dirty — the commit is not the last act');
  assertEqual((r.json.findings || []).filter((f) => f.check === 'deliverable-not-committed').length, 0,
    'a successful commit still raised the blocking finding');
});

test('PRODUCT-97: a render that cannot be committed raises a BLOCKING finding, not a rejection', () => {
  const root = scratchRepo('dl-ingest-fail');
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's1' }, assertion: 'a', band: 'A', status: 'verified' }], { stage: 'verify' });
  const claimId = [...brain.claims().values()][0].id;
  brain.state.stage = 'render';
  brain.state.stages.render.status = 'active';
  brain.save('seed-render');

  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  put('docs/wiki/registry-sys-ids.md', `---\nclaims-rendered: 1\n---\n\n# Registry\n\n- \`${claimId}\`\n`);
  // The deliverable is .gitignore'd, so `git add` refuses it and the commit cannot contain it.
  fs.writeFileSync(path.join(root, '.gitignore'), 'docs/wiki/registry-sys-ids.md\n');
  gitCommitAll(root, 'chore: scaffold with the page ignored');

  const art = {
    stage: 'render', instance: 'selftest-instance', usage: { apiCalls: 0, notes: 'render reads the ledgers' },
    pages: [{ path: 'docs/wiki/registry-sys-ids.md', status: 'verified', rendersClaims: [claimId], tier: 'registry' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
    acceptance: STAGE_BY_ID.get('render').acceptance.map((a) => ({ id: a.id, result: 'pass', evidence: 'selftest' })),
  };
  put('.brain/in/render.json', JSON.stringify(art, null, 1));
  const r = cliJson(['ingest', '--stage', 'render', '--file', path.join(root, '.brain', 'in', 'render.json'), '--root', root]);
  /*
   * ACCEPTED, and then blocked. A rejection here would burn a render iteration telling the agent
   * to fix something it did not do and cannot do — the commit is the CLI's act. A blocking finding
   * stops terminal success and travels into the deliverable with attribution, which is the weight
   * "there is no handoff artifact for either run" deserves.
   */
  assert(r.json && r.json.accepted, `an uncommittable deliverable was REJECTED rather than blocked:\n${r.stdout}${r.stderr}`);
  assert((r.json.findings || []).some((f) => f.check === 'deliverable-not-committed' && f.severity === 'blocking'),
    `no blocking finding was raised: ${JSON.stringify((r.json.findings || []).map((f) => f.check))}`);
  assertEqual(r.json.successReachable, false, 'a run that did not deliver anything could still reach terminal success');
  assert(r.json.terminal !== 'success', 'a run whose deliverable is not in a commit reported terminal success');
});

test('PRODUCT-97: an otherwise-perfect run does NOT report success when the commit failed', () => {
  /*
   * THE HOLE THE FIX ITSELF OPENED. render's next stage is `done`, so the routing block runs
   * successBlockers() and can stamp `terminal: success` BEFORE the commit it depends on has been
   * attempted — on the same iteration. Without the withdrawal, the defect PRODUCT-97 exists to
   * stop is reachable straight through its own remedy: a run marked success, handoff permitted,
   * deliverable untracked. This is the only fixture in the suite that reaches `success`, which is
   * why it is worth its cost.
   */
  const root = scratchRepo('dl-success-withdrawn');
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.upsertClaims([{ locus: { table: 't', sysId: 's1' }, assertion: 'a', band: 'A', status: 'verified' }], { stage: 'verify' });
  const claimId = [...brain.claims().values()][0].id;
  for (const id of STAGE_ORDER) {
    if (id === 'render') { brain.state.stages[id].status = 'active'; continue; }
    brain.state.stages[id].status = 'complete';
  }
  brain.state.stage = 'render';
  brain.state.budget.usedCalls = 0;
  brain.save('seed-render-complete');

  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  put('docs/wiki/registry-sys-ids.md', `---\nclaims-rendered: 1\n---\n\n# Registry\n\n- \`${claimId}\`\n`);
  // The page is ignored, so `git add` refuses it and the commit cannot contain the deliverable.
  fs.writeFileSync(path.join(root, '.gitignore'), 'docs/wiki/registry-sys-ids.md\n');
  gitCommitAll(root, 'chore: scaffold with the page ignored');

  const art = {
    stage: 'render', instance: 'selftest-instance', usage: { apiCalls: 0, notes: 'render reads the ledgers' },
    pages: [{ path: 'docs/wiki/registry-sys-ids.md', status: 'verified', rendersClaims: [claimId], tier: 'registry' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
    acceptance: STAGE_BY_ID.get('render').acceptance.map((a) => ({ id: a.id, result: 'pass', evidence: 'selftest' })),
  };
  put('.brain/in/render.json', JSON.stringify(art, null, 1));
  const r = cliJson(['ingest', '--stage', 'render', '--file', path.join(root, '.brain', 'in', 'render.json'), '--root', root]);
  assert(r.json && r.json.accepted, `the artifact was rejected:\n${r.stdout}${r.stderr}`);
  assertEqual(r.json.terminal, 'blocked',
    `a run with every stage complete and an UNTRACKED deliverable reported terminal "${r.json.terminal}" — ` +
    'only "success" permits handoff, and there is nothing here to hand over');
  const after = Brain.open(root);
  assertEqual(after.state.terminal, 'blocked', 'the withdrawal was reported but not persisted');
  assert(/withdrawn on this same iteration/.test(after.state.terminalNote || ''),
    'the terminal note does not say the stamp was taken back, so history reads as a run that was always blocked');
});

test('PRODUCT-99: a kernel that routes to a skill which does not exist is rejected', () => {
  /*
   * Run 93838afe87's kernel routed four artifact classes to four `acme-*` skills and ALL FOUR were
   * absent from .claude/skills/. A head-to-head tester went looking for `acme-vendorx-intake` by
   * name — because the kernel told them to — and its absence decided that task's verdict. A
   * routing entry is a promise that a procedure is there when an agent arrives.
   */
  const root = scratchRepo('kn-routing');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const ctx = { brain, state: brain.state, stage: 'render' };
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('.claude/settings.json', '{}');
  put('docs/wiki/index.md', '---\nclaims-rendered: 0\n---\n\n# Index\n');
  put('.claude/skills/data-policies/SKILL.md', '# a real skill\n');
  put('CLAUDE.md', [
    '# kernel', '',
    '| Class | Skill |', '|---|---|',
    '| `sys_dictionary`, `sys_choice` | `data-policies` |',
    '| `x_lsmcb_sca_*` (VendorX pipeline config) | **`acme-vendorx-intake`** |', '',
    'Prose mentioning a hyphenated non-skill like `read-only` must not be treated as a route.', '',
  ].join('\n'));
  const art = {
    pages: [{ path: 'docs/wiki/index.md', status: 'draft', rendersClaims: [] }],
    kernel: { path: 'CLAUDE.md', routingEntries: 2 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  const rej = STAGE_BY_ID.get('render').validate(ctx, art);
  const hit = rej.filter((m) => /routing map sends work to/.test(m));
  assertEqual(hit.length, 1, `a kernel routing to a non-existent skill was accepted:\n${rej.join('\n')}`);
  assert(/acme-vendorx-intake/.test(hit[0]), 'the rejection does not name the missing skill');
  assert(!/data-policies/.test(hit[0]), 'a skill that DOES exist was reported missing');
  /*
   * `read-only` is in the file and matches the slug shape — but it is in PROSE, not a table row.
   * Measured on the real kernel, the table-row scope gives 33 candidates, 29 resolving, and the
   * only 4 failures are the 4 real phantoms: no false positives.
   */
  assert(!/read-only/.test(hit[0]), 'a hyphenated word in prose was mistaken for a routing entry');

  // Declaring the skill in skills[] satisfies it — a skill this run WRITES is a skill that exists.
  art.skills = [{ path: '.claude/skills/acme-vendorx-intake/SKILL.md', covers: 'x_lsmcb_sca_*' }];
  put('.claude/skills/acme-vendorx-intake/SKILL.md', '# written by this run\n');
  assertEqual(STAGE_BY_ID.get('render').validate(ctx, art).filter((m) => /routing map sends work to/.test(m)).length, 0,
    'writing the skill did not clear the guard, so it has no honest exit');
});

test('PRODUCT-97: .brain/raw is not in the deliverable, and the exclusion is stated', () => {
  const paths = DELIVERABLE.deliverablePaths({ pages: [{ path: 'docs/wiki/a.md' }], kernel: { path: 'CLAUDE.md' } });
  assert(!paths.some((p) => /\.brain\/raw/.test(p)), '.brain/raw crept into the deliverable by default');
  for (const f of ['.brain/state.json', '.brain/claims.jsonl', '.brain/decisions.jsonl', '.brain/findings.jsonl']) {
    assert(paths.includes(f), `${f} is not in the deliverable, but the .gitignore says it is committed`);
  }
  assert(DELIVERABLE.NOT_DELIVERABLE.some((x) => /raw/.test(x.path) && x.why && x.why.length > 20),
    'the exclusion carries no stated reason, so it is inherited rather than decided');
});

test('PRODUCT-97: render refuses to render into a directory nothing can hand over', () => {
  const root = scratchRepo('dl-not-a-repo', { git: false });
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const ctx = { brain, state: brain.state, stage: 'render' };
  for (const rel of ['docs/wiki/index.md', 'CLAUDE.md', '.claude/settings.json']) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '---\nclaims-rendered: 0\n---\n\n# seeded\n');
  }
  const art = {
    pages: [{ path: 'docs/wiki/index.md', status: 'draft', rendersClaims: [] }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  const rej = STAGE_BY_ID.get('render').validate(ctx, art);
  assert(rej.some((m) => /not a git repository/.test(m)),
    `a deliverable was rendered into a directory with no way to hand it over:\n${rej.join('\n')}`);
  // And the cheapest legal satisfaction is `git init`, which is the right thing to do.
  gitInit(root);
  assertEqual(STAGE_BY_ID.get('render').validate(ctx, art).filter((m) => /git repository/.test(m)).length, 0,
    'git init did not satisfy the precondition, so the guard has no cheap honest exit');
});

// ===========================================================================
// N — PRODUCT-96, second half. An unread column and an empty column are the
//     same JSON, and the run rendered the difference as fact.
// ===========================================================================

group('N. asserting an absence');

const { emptyAssertionViolations } = stages;

/** A claim asserting `field` is empty, having requested `requested`. */
function absenceClaim(field, requested, assertion) {
  const at = new Date().toISOString();
  const sysId = 'c'.repeat(32);
  return {
    locus: { table: 'sys_ui_action', sysId, field: 'name' },
    assertion: assertion || `${field} is empty — this record carries no ${field} logic at all.`,
    band: 'A', rung: 'L1',
    evidence: {
      query: `sys_idIN${sysId}`, fields: requested, capturedAt: at, transport: 'rest_request',
      completeness: 'complete', capturedResponse: { sys_id: sysId, name: 'ACME button' },
      guards: { fields: 'validated', identityCanary: 'pass' },
    },
  };
}

test('PRODUCT-96: a claim may not assert a field is empty when it never requested that field', () => {
  const root = scratchRepo('ab-empty');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  brain.state.queue = { harvestAreas: ['an-area'], harvestDone: [], harvestAreaDetail: [{ id: 'an-area', tables: ['sys_ui_action'], bandARows: 1 }] };
  const art = (claims) => ({
    stage: 'harvest', instance: 'x',
    usage: { apiCalls: 4, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    area: 'an-area', claims,
    coverage: { rowsSeen: 1, rowsTotal: 1, truncated: false, note: 'no-column: sys_ui_action.client_script_v2 — n/a. no-column: sys_ui_action.form_button_v2 — n/a. no-column: sys_ui_action.script — n/a. no-column: sys_ui_action.condition — n/a.' },
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  });

  // The rendered sentence, in claim form: an absence asserted over a column never requested.
  const bad = h.validate(ctx, art([absenceClaim('client_script_v2', 'sys_id,name,script,condition')]));
  assert(bad.some((m) => /assert\(s\) that a field is empty or absent/.test(m) && /client_script_v2/.test(m)),
    `an unread column was rendered as an affirmative absence:\n${bad.join('\n')}`);

  // Requested and genuinely empty: a legitimate, load-bearing claim. It must pass.
  const good = h.validate(ctx, art([absenceClaim('client_script_v2', 'sys_id,name,script,condition,client_script_v2')]));
  assertEqual(good.filter((m) => /empty or absent/.test(m)).length, 0,
    `an honest negative claim was rejected, which would push the run toward saying nothing:\n${good.join('\n')}`);
});

test('PRODUCT-88: a declared column empty across a WHOLE stratum is a finding, not 37 quiet claims', () => {
  const resp = (extra) => ({ capturedResponse: Object.assign({ label: 'Routing-group: X', result_elements: '' }, extra) });
  const rows = [];
  for (let i = 0; i < 37; i += 1) {
    rows.push({ locus: { table: 'sys_decision_multi_result', sysId: String(i).padEnd(32, 'a'), field: 'label' }, evidence: resp() });
  }
  const strata = stages.emptyStrata(rows);
  assertEqual(strata.length, 1, `the uniformly-empty column was not reported: ${JSON.stringify(strata)}`);
  assertEqual(strata[0].field, 'result_elements');
  assertEqual(strata[0].loci, 37);

  /*
   * IT MUST SEE A COLUMN NOTHING CLAIMED. Every one of the 37 claims above is keyed on `label`;
   * not one is keyed on `result_elements`. The first version of this guard walked `locus.field`
   * and therefore could not see the exact column it was written for — caught by replay against
   * pilot-run-4, where it reported three strata and missed the one that cost a task verdict.
   */
  assert(!rows.some((r) => r.locus.field === 'result_elements'),
    'the fixture claims the column, so it no longer tests the case it exists for');

  // One non-empty row anywhere in the stratum settles it: that is a fact, not a transport problem.
  const mixed = rows.slice(0, 36).concat([{ locus: { table: 'sys_decision_multi_result', sysId: 'z'.repeat(32), field: 'label' }, evidence: resp({ result_elements: 'a-group-sys-id' }) }]);
  assertEqual(stages.emptyStrata(mixed).length, 0, 'a stratum with one populated row was still reported as entirely empty');

  // Below the threshold, "all of them" is not evidence of anything.
  assertEqual(stages.emptyStrata(rows.slice(0, stages.EMPTY_STRATUM_MIN - 1)).length, 0,
    'a stratum below the stated minimum was reported');
});

test('PRODUCT-88: harvest.validate actually RAISES the finding, not just computes it', () => {
  /*
   * Found by mutation, not by design: the three tests around this one exercise emptyStrata()
   * directly, so deleting the call that wires it into harvest.validate broke nothing and the suite
   * stayed green. A helper with tests and no caller is a guard that does not exist. This is the
   * second time in two rounds that mutation caught exactly this shape.
   */
  const root = scratchRepo('hv-empty-stratum');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const h = STAGE_BY_ID.get('harvest');
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  brain.state.queue = {
    harvestAreas: ['an-area'], harvestDone: [],
    harvestAreaDetail: [{ id: 'an-area', tables: ['sf_state_flow'], bandARows: 8 }],
  };
  const at = new Date().toISOString();
  const claims = [];
  for (let i = 0; i < 8; i += 1) {
    const sysId = String(i).padEnd(32, 'f');
    // `roles` is declared in BODY_FIELDS.sf_state_flow.shape, and empty on every locus.
    claims.push({
      locus: { table: 'sf_state_flow', sysId, field: 'roles' },
      assertion: 'roles is empty — every transition is offered to everyone', band: 'A', rung: 'L1',
      evidence: {
        query: `sys_idIN${sysId}`, fields: 'sys_id,roles', capturedAt: at, transport: 'rest_request',
        completeness: 'complete', capturedResponse: { sys_id: sysId, roles: '' },
        guards: { fields: 'validated', identityCanary: 'pass' },
      },
    });
  }
  const art = {
    stage: 'harvest', instance: 'x',
    usage: { apiCalls: 4, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    area: 'an-area', claims,
    coverage: { rowsSeen: 8, rowsTotal: 8, truncated: false, note: 'no-column: sf_state_flow.start_text — n/a. no-column: sf_state_flow.end_text — n/a. no-column: sf_state_flow.manual_condition — n/a. no-column: sf_state_flow.automatic_condition — n/a.' },
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  };
  h.validate(ctx, art);
  const f = (art.findings || []).filter((x) => x.check === 'requested-column-empty-across-a-whole-stratum');
  assertEqual(f.length, 1, `the stage computed the stratum and raised nothing: ${JSON.stringify((art.findings || []).map((x) => x.check))}`);
  assert(/sf_state_flow\.roles \(8 loci\)/.test(f[0].message), `the finding does not name the column and its size: ${f[0].message}`);
  assertEqual(f[0].severity, 'warning',
    'a uniformly empty column was raised as blocking — it can be a true fact about the build, and rejecting it pushes the run toward claiming fewer columns');
  // One populated row and the stage says nothing.
  art.claims[0].evidence.capturedResponse.roles = 'itil';
  art.findings = [];
  h.validate(ctx, art);
  assertEqual((art.findings || []).filter((x) => x.check === 'requested-column-empty-across-a-whole-stratum').length, 0,
    'a stratum with a populated row still raised the finding');
});

test('PRODUCT-88: the finding is scoped to columns this framework declares meaning-bearing', () => {
  /*
   * Unscoped, this guard reports 400 empty strata on pilot-run-4 — `sys_choice.hint`,
   * `sys_dictionary.defaultsort`, `item_option_new.macro` — which is a finding nobody reads.
   * Scoped to BODY_FIELDS plus the defining-child shapes it reports seven, every one a statement
   * about the customer's build. Measured before choosing, per METHOD-4.
   */
  const undeclared = [];
  for (let i = 0; i < 20; i += 1) {
    undeclared.push({ locus: { table: 'sys_choice', sysId: String(i).padEnd(32, 'b'), field: 'label' }, evidence: { capturedResponse: { label: 'x', hint: '' } } });
  }
  assertEqual(stages.emptyStrata(undeclared).length, 0,
    '`sys_choice.hint` was reported — the guard is not scoped and will bury its own signal');
  assert(stages.BODY_FIELDS.sys_decision_multi_result.shape.includes('result_elements'),
    'sys_decision_multi_result no longer declares result_elements, so the guard cannot see it');
  assert(!(stages.BODY_FIELDS.sys_decision_multi_result.must || []).length,
    'result_elements was made REQUIRED — a column this transport cannot return has one legal answer forever: the no-column escape');
});

test('PRODUCT-88: the form layout has a route — sys_ui_element is a defining child of its section', () => {
  /*
   * Head-to-head task 2's deciding fact, twice: five `sys_ui_section` rows for the case and
   * ZERO `sys_ui_element` rows in a 19,360-claim ledger, so the developer could build the column,
   * the Dutch label and the state-conditioned UI policy and not say where the field lands.
   * `sys_ui_element` is not a sys_metadata class — no census stratum reaches it and no domain leg
   * admits it — so the parent section is the only route there is.
   */
  const plan = stages.definingChildrenFor(['sys_ui_section']);
  const child = plan.find((p) => p.table === 'sys_ui_element');
  assert(child, `no route from a form section to its fields: ${JSON.stringify(plan.map((p) => p.table))}`);
  assertEqual(child.on.parent.join(','), 'sys_id');
  assertEqual(child.on.child.join(','), 'sys_ui_section');
  // A layout is an ORDERING, not a set: `element` alone cannot answer "where does my field go".
  assert(child.shape.includes('position') && child.shape.includes('element'),
    `the shape cannot express a layout: ${child.shape.join(', ')}`);
});

test('PRODUCT-96: the map covers sys_dictionary, and demands the column that decides which set ships it', () => {
  const d = stages.BODY_FIELDS.sys_dictionary;
  assert(d, 'sys_dictionary — the table that defines every custom column — is absent from the map');
  assert((d.must || []).includes('sys_scope'),
    'sys_scope is not required, so a new column\'s update set cannot be determined and the field ships to dev only');
  assert(!(d.body || []).length, 'sys_dictionary was given a body, which would queue 500 dictionary rows for explain');
  const p = stages.BODY_FIELDS.sys_ui_policy;
  assert((p.must || []).includes('ui_type'),
    'ui_type is not required — a UI policy with the wrong one is inert in the only UI this build uses');
  for (const optional of ['view', 'global']) {
    assert(p.shape.includes(optional) && !(p.must || []).includes(optional),
      `${optional} should be declared and NOT required: it qualifies the same behaviour and nothing measured shows it silently fatal`);
  }
});

test('PRODUCT-88: the binding has a route — sys_variable_value is a defining child of the answer row', () => {
  const plan = stages.definingChildrenFor(['sys_decision_multi_result']);
  const child = plan.find((p) => p.table === 'sys_variable_value');
  assert(child, `no route from a decision answer row to its binding: ${JSON.stringify(plan.map((p) => p.table))}`);
  assertEqual(child.on.parent.join(','), 'sys_id');
  assertEqual(child.on.child.join(','), 'document_key');
  assert(child.also && child.also.document === 'sys_decision_multi_result',
    'the join is unqualified, so it returns every variable-bearing class on the instance');
  assert(/glide_var|empty over this transport|result_elements/.test(child.why),
    'the reason does not say why the parent read cannot carry this');
});

test('PRODUCT-96: the field match is by TOKEN, so `condition` is not satisfied by `manual_condition`', () => {
  /*
   * The substring form of this check — String(evidence.fields).includes(field) — passes exactly
   * the claims most worth catching: a state flow asserting "condition is empty" off a field list
   * whose only condition column is `manual_condition`, and a business rule asserting the same off
   * `filter_condition`. Three of the five classes PRODUCT-96 names carry such a column.
   */
  const bad = emptyAssertionViolations([absenceClaim('condition', 'sys_id,name,manual_condition,automatic_condition')]);
  assertEqual(bad.length, 1, 'a substring of a longer column name was accepted as evidence the column was read');
  assertEqual(bad[0].field, 'condition');
  assertEqual(emptyAssertionViolations([absenceClaim('condition', 'sys_id,name,condition')]).length, 0,
    'an exactly-requested column was reported as unread');
  // A dot-walked request returns both halves, so a claim about either was evidenced.
  assertEqual(emptyAssertionViolations([absenceClaim('condition', 'sys_id,name,sys_ui_action.condition')]).length, 0,
    'a dot-walked field did not count for its own leaf');
  /*
   * And the rule is scoped to the claim's OWN table. "returns false when location '3' carries no
   * building_name" is a sentence about the record the script ACTS ON, and replay raised six such
   * findings before this scoping went in — all correct English, none of them the defect.
   */
  assertEqual(emptyAssertionViolations([absenceClaim('x', 'sys_id,name',
    "Submit gate that returns false when location '3' carries no building_name.")]).length, 0,
    'a column of the record the artifact acts on was faulted as an unread column of the artifact');
});

test('PRODUCT-96: the phrasings the run actually shipped are all caught', () => {
  const shipped = [
    ['The script column is empty; the only logic on the record is the condition.', ['script']],
    // The list form names BOTH columns, and reading it head-first would excuse the second.
    ['This action carries neither script nor condition.', ['script', 'condition']],
    ['condition is empty — this record carries no condition logic at all.', ['condition']],
    ['form_button_v2 was blank on every row in this stratum.', ['form_button_v2']],
  ];
  for (const [s, fields] of shipped) {
    const bad = emptyAssertionViolations([absenceClaim('x', 'sys_id,name', s)]);
    assertEqual(bad.map((b) => b.field).sort().join(','), fields.slice().sort().join(','),
      `a sentence the run actually rendered was not caught as stated: "${s}"`);
  }
  /*
   * And prose is left alone. "carries no logic of its own" names no column, and faulting it would
   * teach the run to stop writing the honest sentence rather than to read the column.
   */
  for (const s of [
    'Sets is_sensitive to true on QRT incidents before insert.',
    'A workspace-only action that carries no logic of its own; the button is declarative.',
  ]) {
    assertEqual(emptyAssertionViolations([absenceClaim('x', 'sys_id,name', s)]).length, 0,
      `a sentence naming no column was faulted as an absence: "${s}"`);
  }
});

test('PRODUCT-96: explain is held to it too — that is where the rendered sentences came from', () => {
  const EXPLAIN_STAGE = STAGE_BY_ID.get('explain');
  const ex = EXPLAIN_STAGE.example(fakeCtx({ stage: 'explain' }));
  const seeded = ex.claims.map((c) => harvested(c.locus.table, c.locus.sysId, c.band, c.evidence.capturedResponse.name));
  const ctx = explainCtx('ab-empty-explain', seeded);
  ctx.state.config.explainCap = 150;
  assertEqual(EXPLAIN_STAGE.validate(ctx, ex).length, 0, 'the explain example no longer passes its own validator');
  /*
   * The exact shape explain shipped: an absence asserted over a column the body read never
   * requested. `filter_condition` is declared for sys_script in BODY_FIELDS and is absent from
   * this claim's own evidence.fields, which is the whole test — explain read `condition` and said
   * something about a different gate.
   */
  ex.claims[0].assertion = 'Runs before insert and update on QRT incidents, and its filter_condition is empty, so nothing narrows it.';
  const rej = EXPLAIN_STAGE.validate(ctx, ex);
  assert(rej.some((m) => /behaviour claim\(s\) assert/.test(m) && /filter_condition/.test(m)),
    `explain asserted an absence over an unrequested column:\n${rej.join('\n')}`);
});

// ===========================================================================
// O — METHOD-6. The ledger's unit is a claim; the product's unit is a chain.
//     Until Phase B nothing in the loop had an object for the edge between two
//     artifacts, so no chain could be reported broken and 100%-verified said
//     nothing about whether an agent could follow one.
// ===========================================================================

group('O. chain coherence');

const ID = (n) => String(n).padStart(32, '0');

/** One artifact: a claim carrying `resp` as its captured response. */
function refClaim(table, sysId, resp, extra) {
  return Object.assign({
    id: `C-${sysId.slice(0, 12)}`,
    locus: { table, sysId, field: 'name' },
    assertion: 'seeded', band: 'A', rung: 'L1',
    evidence: { query: `sys_idIN${sysId}`, fields: 'sys_id', capturedAt: '2026-08-18T00:00:00Z', capturedResponse: Object.assign({ sys_id: sysId }, resp) },
  }, extra || {});
}

test('an edge to a record nobody mapped is dangling; an edge to a mapped one is not', () => {
  const g = stages.referenceGraph([
    refClaim('sysrule_assignment', ID(1), { script: `new Resolver().run('${ID(2)}');`, group: ID(9) }),
    refClaim('sys_script_include', ID(2), { name: 'Resolver' }),
  ]);
  assertEqual(g.artifacts, 2);
  assertEqual(g.mechanism, 2, `expected two mechanism edges, got ${g.mechanism}`);
  assertEqual(g.dangling, 1, 'the unmapped group should dangle and the mapped script include should not');
  assertEqual(g.targets, 1);
  /*
   * THE INLINE EDGE IS THE POINT, and this assertion is the regression guard for the bug that
   * nearly produced a wrong finding about a customer's build. The first version of the graph
   * matched whole-value sys_ids only, so it saw `group` and never saw the resolver call inside
   * the script — and reported the routing page as having ZERO edges when it had the load-bearing
   * one. If `inline` ever goes back to 0 here, the instrument has silently lost its subject.
   */
  assertEqual(g.inline, 1, 'the sys_id inside the script body was not seen as an edge');
  assertEqual(g.broken.length, 1);
  assertEqual(g.broken[0].column, 'group');
});

test('identity, provenance and deletion-log columns are not chains', () => {
  const g = stages.referenceGraph([
    refClaim('sys_ui_action', ID(1), { sys_created_by: ID(7), sys_package: ID(8), sys_domain: ID(9) }),
    refClaim('sys_metadata_delete', ID(2), { documentkey: ID(6) }),
    refClaim('sys_ui_policy', ID(3), { sys_update_version: ID(5) }),
  ]);
  assertEqual(g.mechanism, 0, `bookkeeping was counted as mechanism: ${JSON.stringify(g.broken)}`);
  assertEqual(g.bookkeeping, 2, 'the deletion log and the update-version pointer should be excluded, and counted');
  assertEqual(g.dangling, 0, 'a run whose only references are audit plumbing has no broken chain');
});

test('a class earns its own finding at the threshold, and the aggregate names the ones that do not', () => {
  const rows = [];
  // One class well over the threshold: five distinct unreachable targets.
  for (let i = 0; i < 5; i += 1) { rows.push(refClaim('sc_cat_item', ID(100 + i), { category: ID(200 + i) })); }
  // One class under it: a single unreachable target.
  rows.push(refClaim('sysevent_email_action', ID(300), { template: ID(301) }));
  const found = stages.danglingFindings(rows);
  const perClass = found.filter((f) => f.check === 'reference-target-never-mapped');
  const agg = found.filter((f) => f.check === 'chain-coherence');
  assertEqual(perClass.length, 1, `expected exactly the over-threshold class to be filed: ${perClass.map((f) => f.locus.table + '.' + f.locus.field)}`);
  assertEqual(perClass[0].locus.table, 'sc_cat_item');
  assertEqual(perClass[0].locus.field, 'category');
  assertEqual(agg.length, 1);
  /*
   * A CAPPED LIST MAY NOT READ AS A COMPLETE ONE. The aggregate has to state the whole population
   * — both broken classes — and say how many were filed individually, or the 32 findings a real run
   * raises would be read as "32 problems" when the true number is 134.
   */
  assert(/2 of 2 \(table, column\) class/.test(agg[0].message),
    `the aggregate did not name the full population of broken classes: ${agg[0].message}`);
  assert(/remaining 1 are counted here and nowhere else/.test(agg[0].message),
    `the aggregate did not admit what the per-class list leaves out: ${agg[0].message}`);
  assert(/FLOOR/.test(agg[0].message), 'the aggregate must say the percentage is a floor — a bounded script window hides edges past it');
});

test('a coherent brain raises nothing at all', () => {
  const found = stages.danglingFindings([
    refClaim('sysrule_assignment', ID(1), { script: `run('${ID(2)}')` }),
    refClaim('sys_script_include', ID(2), { name: 'Resolver' }),
  ]);
  assertEqual(found.length, 0, `a brain whose every reference resolves must be silent: ${JSON.stringify(found)}`);
});

test('the coherence findings are WARNINGS, because the cheapest way to satisfy a blocking one is to capture less', () => {
  const rows = [];
  for (let i = 0; i < 5; i += 1) { rows.push(refClaim('sc_cat_item', ID(100 + i), { category: ID(200 + i) })); }
  const found = stages.danglingFindings(rows);
  assert(found.length > 0);
  const blocking = found.filter((f) => f.severity !== 'warning');
  assertEqual(blocking.length, 0,
    `a blocking chain guard is satisfied by narrowing scope until nothing points outward, which makes the deliverable worse: ${JSON.stringify(blocking.map((f) => f.check + '=' + f.severity))}`);
});

test('verify raises the coherence findings over the WHOLE ledger, not over the artifact', () => {
  const root = scratchRepo('coherence');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const v = STAGE_BY_ID.get('verify');
  const ctx = { brain, state: brain.state, stage: 'verify' };
  const seeded = [];
  for (let i = 0; i < 5; i += 1) { seeded.push(refClaim('sc_cat_item', ID(100 + i), { category: ID(200 + i) })); }
  const up = brain.upsertClaims(seeded.map((c) => ({ locus: c.locus, assertion: c.assertion, band: 'A', status: 'draft', evidence: c.evidence })), { stage: 'harvest' });

  /*
   * The verdict names ONE claim. If the guard read the artifact instead of the ledger it would see
   * one artifact, no edges and nothing to say — which is the whole reason this lives at verify:
   * whether an edge dangles depends on what every OTHER area harvested.
   */
  const art = {
    stage: 'verify', instance: 'x',
    usage: { apiCalls: 2, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    canary: { result: 'pass', rows: 1 },
    verdicts: [{ claimId: up.ids[0], status: 'verified', query: `sys_idIN${ID(100)}`, capturedAt: '2026-08-18T00:00:00Z' }],
    acceptance: [{ id: 'AC-VER-1', result: 'pass', evidence: 'canary returned 1 row' }],
  };
  const rej = v.validate(ctx, art);
  assertEqual(rej.length, 0, `the coherence pass must not reject a sound verify artifact:\n${rej.join('\n')}`);
  assert(art.findings && art.findings.some((f) => f.check === 'chain-coherence'),
    `verify recorded no chain-coherence finding over a ledger with five dangling edges: ${JSON.stringify(art.findings || [])}`);
  const cls = (art.findings || []).filter((f) => f.check === 'reference-target-never-mapped');
  assertEqual(cls.length, 1, 'the over-threshold class was not filed from the verify stage');
  assert(/population: every sys_id/.test(cls[0].message), 'a finding that does not name its population is unactionable');
});

/*
 * METHOD-6 fix (2). A render ctx whose process page cites THREE artifacts, so a chain is
 * possible and therefore owed. `resp` decides whether the references resolve.
 */
function mechRenderCtx(name, opts) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const seeded = (opts.artifacts || []).map((a) => ({
    locus: { table: a.table, sysId: a.sysId, field: 'name' },
    assertion: `${a.sysId} is a thing`, band: 'A', status: 'verified',
    evidence: { query: `sys_idIN${a.sysId}`, fields: 'sys_id', capturedAt: '2026-08-18T00:00:00Z', capturedResponse: Object.assign({ sys_id: a.sysId }, a.resp || {}) },
  }));
  const up = brain.upsertClaims(seeded, { stage: 'verify' });
  const cited = up.ids.slice(0, opts.cite === undefined ? up.ids.length : opts.cite);
  const put = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('CLAUDE.md', '# kernel\n');
  put('.claude/settings.json', '{}');
  put('docs/wiki/processes/case-triage.md',
    `---\nclaims-rendered: ${cited.length}\n---\n\n${FULL_PERSONAS}\n\n${opts.extra || ''}\n\n## Evidence\n\n${cited.map((id) => `- \`${id}\``).join('\n')}\n`);
  const art = {
    pages: [{ path: 'docs/wiki/processes/case-triage.md', status: 'verified', rendersClaims: cited, tier: 'process' }],
    kernel: { path: 'CLAUDE.md', routingEntries: 3 },
    settings: { path: '.claude/settings.json', hooks: ['PreToolUse:scope-guard'] },
  };
  return { ctx: { brain, state: brain.state, stage: 'render' }, art };
}

const MECH_RE = /carries NO followable mechanism link/;

test('a process page nobody can traverse is refused, however well it reads', () => {
  /*
   * The shape of case-triage-and-routing.md on run 93838afe87: eleven artifacts cited,
   * every persona subsection present, and not one machine-followable link between any of them.
   */
  const { ctx, art } = mechRenderCtx('mech-none', {
    artifacts: [
      { table: 'sys_script', sysId: ID(1), resp: { name: 'Triage' } },
      { table: 'sys_script', sysId: ID(2), resp: { name: 'Route' } },
      { table: 'sys_script', sysId: ID(3), resp: { name: 'Notify' } },
    ],
  });
  const rej = RENDER.validate(ctx, art);
  assert(rej.some((m) => MECH_RE.test(m) && /none of those artifacts references another record at all/.test(m)),
    `a page with three artifacts and no links between them passed the contract:\n${rej.join('\n')}`);
});

test('a page whose every reference points at an unmapped record is refused too', () => {
  const { ctx, art } = mechRenderCtx('mech-dangling', {
    artifacts: [
      { table: 'sysrule_assignment', sysId: ID(1), resp: { script: `run('${ID(90)}')` } },
      { table: 'sys_script', sysId: ID(2), resp: { name: 'Route' } },
      { table: 'sys_script', sysId: ID(3), resp: { name: 'Notify' } },
    ],
  });
  const rej = RENDER.validate(ctx, art);
  assert(rej.some((m) => MECH_RE.test(m) && /point at records this brain never mapped/.test(m)),
    `a page whose only link leaves the brain passed as traversable:\n${rej.join('\n')}`);
});

test('one followable link is enough, and it may be inline in a script', () => {
  const { ctx, art } = mechRenderCtx('mech-ok', {
    artifacts: [
      { table: 'sysrule_assignment', sysId: ID(1), resp: { script: `new Resolver().run('${ID(2)}')` } },
      { table: 'sys_script_include', sysId: ID(2), resp: { name: 'Resolver' } },
      { table: 'sys_script', sysId: ID(3), resp: { name: 'Notify' } },
    ],
  });
  const rej = RENDER.validate(ctx, art);
  assertEqual(rej.filter((m) => MECH_RE.test(m)).length, 0,
    `a page carrying a real resolver chain was refused, which would push the render toward padding:\n${rej.join('\n')}`);
});

test('declaring the gap in the slot form satisfies it, because demanding a chain that does not exist is unsatisfiable', () => {
  /*
   * THE WHOLE DESIGN, IN ONE ASSERTION. The agent cannot invent a reference the instance does not
   * contain, so an unsatisfiable rejection is discharged by deleting the page or padding its
   * citations — both worse than the gap. What is demanded is a SENTENCE.
   */
  const { ctx, art } = mechRenderCtx('mech-declared', {
    artifacts: [
      { table: 'sys_script', sysId: ID(1), resp: { name: 'Triage' } },
      { table: 'sys_script', sysId: ID(2), resp: { name: 'Route' } },
      { table: 'sys_script', sysId: ID(3), resp: { name: 'Notify' } },
    ],
    extra: '<!-- slot: mechanism.chain | source: HV | status: unfilled | blocked_on: the routing target is chosen in a decision table nothing here references -->\n> The chain stops at the triage rule; where it goes next is not readable from what was harvested.',
  });
  const rej = RENDER.validate(ctx, art);
  assertEqual(rej.filter((m) => MECH_RE.test(m)).length, 0,
    `a page that honestly declared its broken chain was refused anyway:\n${rej.join('\n')}`);
});

test('a page citing fewer than three artifacts is owed no chain', () => {
  const { ctx, art } = mechRenderCtx('mech-small', {
    artifacts: [
      { table: 'sys_script', sysId: ID(1), resp: { name: 'Triage' } },
      { table: 'sys_script', sysId: ID(2), resp: { name: 'Route' } },
    ],
  });
  const rej = RENDER.validate(ctx, art);
  assertEqual(rej.filter((m) => MECH_RE.test(m)).length, 0,
    `a two-artifact page was asked for a chain it cannot have:\n${rej.join('\n')}`);
});

// --- METHOD-6 fix (3): the graph aims the harvest -------------------------

test('a dangling target whose table is known becomes an area; one whose table is unknown does not', () => {
  const r = stages.chainRepairAreas([
    // Resolves once, so sc_cat_item is a known target table for this column...
    refClaim('catalog_ui_policy', ID(1), { catalog_item: ID(50) }),
    refClaim('sc_cat_item', ID(50), { name: 'Case maken' }),
    /*
     * ...and these FIVE dangle into it. Five and not three, deliberately: `referenceGraph` keeps a
     * three-id `sample` for the finding text beside the whole set, and a fixture with exactly three
     * targets makes those two lists identical — so a work list built from the sample would repair
     * 3 of 53 on the real ledger and every test would still pass. That mutation was MISSED on the
     * first run for exactly this reason.
     */
    refClaim('catalog_ui_policy', ID(2), { catalog_item: ID(60) }),
    refClaim('catalog_ui_policy', ID(3), { catalog_item: ID(61) }),
    refClaim('catalog_ui_policy', ID(4), { catalog_item: ID(62) }),
    refClaim('catalog_ui_policy', ID(8), { catalog_item: ID(63) }),
    refClaim('catalog_ui_policy', ID(9), { catalog_item: ID(64) }),
    /*
     * A column that has NEVER resolved and is DECLARED nowhere: nothing in the ledger and
     * nothing in DATA_AREAS says what table this lives in. (This fixture used to be
     * sysrule_assignment.group — PLAN 6.6's remainder declared that pair, so it is now
     * correctly aimable and the 6.6 tests below own it.)
     */
    refClaim('x_acme_widget', ID(5), { part: ID(70) }),
    refClaim('x_acme_widget', ID(6), { part: ID(71) }),
    refClaim('x_acme_widget', ID(7), { part: ID(72) }),
  ]);
  assertEqual(r.areas.length, 1, `expected exactly the resolvable class to become an area: ${r.areas.map((a) => a.id)}`);
  assertEqual(r.areas[0].tables[0], 'sc_cat_item');
  assertEqual(r.areas[0].targets.length, 5,
    'the area must carry the WHOLE unreachable set, not the three-id sample the finding text prints');
  assertEqual(r.areas[0].targetsTotal, 5);
  assertEqual(r.areas[0].population, 'chain-repair');
  assert(!r.areas[0].targets.includes(ID(50)), 'a target that IS mapped was queued for re-reading');
  assertEqual(r.unaimable, 3,
    'the three targets of a never-resolving column were dropped instead of being reported as needing a dictionary read');
});

test('a polymorphic column is attributed to every table it resolves to, and the two counts say so', () => {
  /*
   * `sys_documentation.name` on the real ledger resolves into five different tables. Attributing
   * its targets to all of them costs an sys_idIN read that returns nothing; attributing them to
   * none loses the chain. The first is cheap and the second is not, so both numbers are reported
   * and the brief tells the agent an empty row is a fact.
   */
  const r = stages.chainRepairAreas([
    refClaim('sys_documentation', ID(1), { name: ID(50) }),
    refClaim('sys_decision', ID(50), { label: 'A' }),
    refClaim('sys_documentation', ID(2), { name: ID(51) }),
    refClaim('sys_hub_flow_block', ID(51), { name: 'B' }),
    refClaim('sys_documentation', ID(3), { name: ID(80) }),
    refClaim('sys_documentation', ID(4), { name: ID(81) }),
    refClaim('sys_documentation', ID(5), { name: ID(82) }),
  ], { minIds: 3 });
  assertEqual(r.areas.length, 2, `both resolve-targets should be probed: ${r.areas.map((a) => a.tables[0])}`);
  assertEqual(r.records, 3, 'distinct unmapped records');
  assertEqual(r.probes, 6, 'probes count (table, sys_id) pairs and must exceed records when a column is polymorphic');
});

test('nothing the round leaves behind is left unsaid — the cap and the floor both report', () => {
  const rows = [];
  const mk = (table, base, n) => {
    rows.push(refClaim('src_' + table, ID(base), { ref: ID(base + 1) }));
    rows.push(refClaim(table, ID(base + 1), { name: 'mapped' }));
    for (let i = 0; i < n; i += 1) { rows.push(refClaim('src_' + table, ID(base + 10 + i), { ref: ID(base + 500 + i) })); }
  };
  mk('t_a', 1000, 4); mk('t_b', 2000, 4); mk('t_c', 3000, 4);
  mk('t_small', 4000, 1);            // below the floor
  const r = stages.chainRepairAreas(rows, { maxAreas: 2 });
  assertEqual(r.areas.length, 2, 'the area cap was not applied');
  assertEqual(r.dropped.length, 1, `an eligible table was dropped at the cap and not reported: ${JSON.stringify(r.dropped)}`);
  assertEqual(r.belowThreshold, 1, 'a table under the target floor vanished instead of being counted');
  assertEqual(r.belowThresholdTargets, 1);
});

test('6.6: a declared data-area column aims the repair leg at configuration-in-data', () => {
  /*
   * sysrule_assignment.group never resolves in this ledger — a run holding ZERO groups cannot
   * resolve a group column by observation, however many group references it holds, which is
   * run 4's blocking fact for task 1 ("zero sys_user_group rows anywhere in the ledger").
   * DATA_AREAS declares the pair, so the class is aimed by declaration. FIVE targets, and the
   * whole set must be queued: referenceGraph keeps a three-id sample beside the full set, and
   * a three-target fixture passes with the sample wired in (the fixture-coincidence trap,
   * caught once already on this exact function).
   */
  const rows = [];
  for (let i = 0; i < 5; i += 1) { rows.push(refClaim('sysrule_assignment', ID(300 + i), { group: ID(400 + i) })); }
  const r = stages.chainRepairAreas(rows);
  const area = r.areas.find((a) => a.tables[0] === 'sys_user_group');
  assert(area, `no repair area was aimed at sys_user_group: ${JSON.stringify(r.areas.map((a) => a.tables[0]))}`);
  assertEqual(area.targets.length, 5, 'the area holds a sample, not the set');
  assertEqual(r.unaimable, 0, 'declared targets were still counted unaimable, so the report contradicts the queue');
});

test('6.6: a declared column that ALSO resolves probes both tables, on the cheap-wrong-answer doctrine', () => {
  // sys_variable_value.value binds whatever the variable holds: one row resolves to a catalog
  // item, three dangle. The dangling ids are probed against BOTH sc_cat_item (observed) and
  // sys_user_group (declared) — an empty sys_idIN row is a fact, a dropped target is a gap.
  const rows = [
    refClaim('sys_variable_value', ID(1), { value: ID(70) }),
    refClaim('sc_cat_item', ID(70), { name: 'mapped, so the class resolves to sc_cat_item' }),
    refClaim('sys_variable_value', ID(2), { value: ID(71) }),
    refClaim('sys_variable_value', ID(3), { value: ID(72) }),
    refClaim('sys_variable_value', ID(4), { value: ID(73) }),
  ];
  const r = stages.chainRepairAreas(rows);
  const tables = r.areas.map((a) => a.tables[0]);
  assert(tables.includes('sc_cat_item'), `the observed resolution was lost: ${JSON.stringify(tables)}`);
  assert(tables.includes('sys_user_group'), `the declared aim was lost: ${JSON.stringify(tables)}`);
  assert(r.probes > r.records, 'polymorphic attribution must count more probes than records');
});

test('6.6: an undeclared never-resolved class stays unaimable, counted and not queued', () => {
  const rows = [];
  for (let i = 0; i < 4; i += 1) { rows.push(refClaim('x_acme_mystery', ID(500 + i), { widget: ID(600 + i) })); }
  const r = stages.chainRepairAreas(rows);
  assertEqual(r.areas.length, 0, 'a class nothing resolves and nothing declares was queued at a guessed table');
  assertEqual(r.unaimable, 4, 'the targets nobody can aim were not counted, so the round reads as complete');
});

test('6.12(3): a never-resolved, undeclared class becomes a DICTIONARY question, whole set queued', () => {
  /*
   * Measured on pilot-run-5: 94 such classes hold 1,046 of the run's 1,249 dangling targets —
   * 84% of the whole problem sat behind "those need a dictionary read this round does not
   * make". The round now makes it. FIVE targets, whole set (the fixture-coincidence trap).
   */
  const rows = [];
  for (let i = 0; i < 5; i += 1) { rows.push(refClaim('sys_atf_step', ID(700 + i), { test: ID(800 + i) })); }
  const r = stages.chainRepairAreas(rows);
  assertEqual(r.areas.length, 0, 'a class nothing resolves and nothing declares was queued as a sys_idIN read at a guessed table');
  assertEqual(r.dictionaryAreas.length, 1, `expected exactly one dictionary area: ${JSON.stringify(r.dictionaryAreas.map((a) => a.id))}`);
  const d = r.dictionaryAreas[0];
  assertEqual(d.population, 'chain-repair-dictionary');
  assertEqual(d.tables[0], 'sys_atf_step');
  assertEqual(d.column, 'test');
  assertEqual(d.targets.length, 5, 'the dictionary area holds a sample, not the set');
  assertEqual(r.unaimable, 5,
    'queuing the question deleted the unaimable count — the targets stay unaimed until the read actually happens');
});

test('6.12(3): the dictionary-area cap reports what it drops', () => {
  const rows = [];
  const mk = (table, col, base, n) => {
    for (let i = 0; i < n; i += 1) { rows.push(refClaim(table, ID(base + i), { [col]: ID(base + 100 + i) })); }
  };
  for (let k = 0; k < 4; k += 1) { mk('t_' + k, 'ref_' + k, 1000 * (k + 1), 4); }
  const r = stages.chainRepairAreas(rows, { maxDictAreas: 2 });
  assertEqual(r.dictionaryAreas.length, 2, 'the dictionary-area cap was not applied');
  assertEqual(r.dictDropped.length, 2,
    `eligible classes dropped at the cap were not reported, which reads as "covered" when it is not: ${JSON.stringify(r.dictDropped)}`);
});

test('6.12(3): a dictionary area is briefed as a question, and both of its answers are claims', () => {
  const root = scratchRepo('dict-brief');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const detail = {
    id: 'chain-repair-dict-sys-atf-step-test', tables: ['sys_atf_step'], column: 'test',
    population: 'chain-repair-dictionary',
    targets: [ID(800), ID(801), ID(802)], targetsTotal: 3, rowsInDomain: 3,
    from: ['sys_atf_step.test'], why: 'seeded',
  };
  brain.state.queue = { harvestAreas: [detail.id], harvestDone: [], harvestAreaDetail: [detail] };
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  const HARVEST = STAGE_BY_ID.get('harvest');
  const goal = HARVEST.goal(ctx);
  assert(/TARGET TABLE IS UNKNOWN/.test(goal), `the goal does not brief the area as a question:\n${goal}`);
  assert(!/Band A rows/.test(goal), `a dictionary area was priced as a stratum:\n${goal}`);
  const proc = HARVEST.procedure(ctx).join('\n');
  assert(/WHAT TABLE DO THESE IDS LIVE IN/.test(proc), `the procedure gave no dictionary leg:\n${proc.slice(0, 400)}`);
  assert(/NOT a reference/.test(proc) && /SHUTS this class honestly/.test(proc),
    'the not-a-reference answer is missing, so an agent facing a conditions column has no legal move');
  assert(proc.includes(ID(800)), 'the ids the question is about are not in the brief');
  // Claimless is illegal here exactly as on a sys_idIN repair area: both answers are claims.
  const art = {
    stage: 'harvest', instance: 'x', area: detail.id, claims: [],
    usage: { apiCalls: 1, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    coverage: { rowsSeen: 0, rowsTotal: 0, truncated: false, note: 'dictionary row read' },
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  };
  const rej = HARVEST.validate(ctx, art);
  assert(rej.some((m) => /claims is empty on chain-repair area/.test(m)),
    `a claimless dictionary area was accepted, which walks the run into the stagnation breaker:\n${rej.join('\n')}`);
  // The class-shut escape must actually pass: one claim on the dictionary row saying the
  // column is not a reference, with the must-claim columns in its requested fields.
  art.claims = [{
    locus: { table: 'sys_dictionary', sysId: ID(900), field: 'internal_type' },
    assertion: 'sys_atf_step.test is conditions, not a reference; the sys_ids appearing in it are inline text and cannot be traversed.',
    band: 'A', rung: 'L1',
    evidence: {
      query: 'name=sys_atf_step^element=test', fields: 'name,element,internal_type,reference,sys_scope',
      capturedAt: '2026-08-20T00:00:00Z', transport: 'rest_request', completeness: 'complete',
      capturedResponse: { name: 'sys_atf_step', element: 'test', internal_type: 'conditions', reference: '', sys_scope: 'global' },
      guards: { fields: 'validated', identityCanary: 'pass' },
    },
  }];
  art.coverage.rowsSeen = 1;
  const ok = HARVEST.validate(ctx, art);
  assertEqual(ok.filter((m) => /claims is empty on chain-repair area/.test(m)).length, 0,
    `the class-shut escape is refused, so the guard has no legal answer:\n${ok.join('\n')}`);
});

test('6.3/PRODUCT-94: an area may not bank claims on tables it does not account for', () => {
  /*
   * Run 93838afe87: 3,750 sys_choice claims banked under tables: ["sys_choice_set"], invisible
   * because nothing asserted containment — and the deliverable then disclaimed 19.4% of its own
   * ledger. The legitimate routes are the declaration, its defining children, and the artifact's
   * own coverage.children rows; replayed over both scored ledgers those explain every historical
   * case, so this fires only on the NEXT mis-attribution.
   */
  const root = scratchRepo('containment');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.queue = {
    harvestAreas: ['sys-ui-section'], harvestDone: [],
    harvestAreaDetail: [{ id: 'sys-ui-section', tables: ['sys_ui_section'], bandARows: 5 }],
  };
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  const H = STAGE_BY_ID.get('harvest');
  const mkClaim = (table, n) => ({
    locus: { table, sysId: ID(n), field: 'name' },
    assertion: 'a seeded assertion that is long enough to pass the schema floor.',
    band: 'A', rung: 'L1',
    evidence: {
      query: 'sys_idIN' + ID(n), fields: 'sys_id,name', capturedAt: '2026-08-20T00:00:00Z', transport: 'rest_request',
      completeness: 'complete', capturedResponse: { sys_id: ID(n), name: 'seeded' }, guards: { fields: 'validated', identityCanary: 'pass' },
    },
  });
  const art = {
    stage: 'harvest', instance: 'x', area: 'sys-ui-section',
    claims: [mkClaim('sys_ui_section', 1), mkClaim('sys_ui_element', 2), mkClaim('x_acme_surprise', 3)],
    usage: { apiCalls: 3, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    coverage: { rowsSeen: 3, rowsTotal: 3, truncated: false },
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  };
  const hit = H.validate(ctx, art).filter((m) => /area-table containment/.test(m));
  assertEqual(hit.length, 1, `expected one aggregate containment rejection:\n${hit.join('\n')}`);
  assert(/x_acme_surprise \(1\)/.test(hit[0]), `the undeclared table is not named with its count:\n${hit[0]}`);
  assert(!/sys_ui_element/.test(hit[0]),
    'a defining child of the declared table was flagged — the legitimate route reads as a violation, which is a rejection a correct artifact cannot satisfy');
  // The escape is the wanted behaviour: declaring the route clears it.
  art.coverage.children = [{ parent: 'sys_ui_section', table: 'x_acme_surprise', parentsFollowed: 1, rowsSeen: 1 }];
  assertEqual(H.validate(ctx, art).filter((m) => /area-table containment/.test(m)).length, 0,
    'declaring the route in coverage.children does not satisfy the check, so the accounting has no legal answer');
});

test('6.6: a repair area aimed at a data table is briefed with the DATA_AREAS shape', () => {
  const root = scratchRepo('data-repair-brief');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.state.queue = {
    harvestAreas: ['chain-repair-sys-user-group'], harvestDone: [],
    harvestAreaDetail: [{
      id: 'chain-repair-sys-user-group', tables: ['sys_user_group'], population: 'chain-repair',
      targets: [ID(400), ID(401), ID(402)], targetsTotal: 3, rowsInDomain: 3,
      from: ['sysrule_assignment.group'], why: 'three groups are routed to and never mapped.',
    }],
  };
  const proc = STAGE_BY_ID.get('harvest').procedure({ brain, state: brain.state, stage: 'harvest' }).join('\n');
  assert(/name, description, manager/.test(proc),
    `sys_user_group is in no BODY_FIELDS entry, so without the DATA_AREAS shape the brief tells the agent no columns are declared:\n${proc.slice(0, 600)}`);
});

/** A harvest ctx whose census queue is one area away from drained. */
function repairCtx(name, opts) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims((opts.seed || []).map((c) => ({
    locus: c.locus, assertion: c.assertion, band: 'A', status: 'verified', evidence: c.evidence,
  })), { stage: 'harvest' });
  brain.state.queue = Object.assign({
    harvestAreas: ['area-1', 'area-2'], harvestDone: ['area-1'],
    harvestAreaDetail: [{ id: 'area-1', tables: ['t'] }, { id: 'area-2', tables: ['t'] }],
  }, opts.queue || {});
  return { brain, state: brain.state, stage: 'harvest' };
}

const repairArt = (area, claims) => ({
  stage: 'harvest', instance: 'x', area,
  claims: claims || [],
  coverage: { rowsSeen: 1, rowsTotal: 1, truncated: false },
});

test('the repair queue is minted by the artifact that DRAINS the census queue, and not before', () => {
  const seed = [
    refClaim('catalog_ui_policy', ID(1), { catalog_item: ID(50) }),
    refClaim('sc_cat_item', ID(50), { name: 'mapped' }),
    refClaim('catalog_ui_policy', ID(2), { catalog_item: ID(60) }),
    refClaim('catalog_ui_policy', ID(3), { catalog_item: ID(61) }),
    refClaim('catalog_ui_policy', ID(4), { catalog_item: ID(62) }),
  ];
  const HARVEST = STAGE_BY_ID.get('harvest');

  // Mid-queue: area-2 still unread, so nothing is minted.
  const early = repairCtx('repair-early', { seed, queue: { harvestAreas: ['area-1', 'area-2', 'area-3'], harvestDone: ['area-1'] } });
  const mid = HARVEST.apply(early, repairArt('area-2'));
  assertEqual(mid.queue.chainRepairRounds, undefined,
    'the repair round was consumed while census areas were still unread');
  assert(!mid.queue.harvestAreas, 'repair areas were appended before the census queue drained');

  // The draining artifact mints them.
  const last = repairCtx('repair-last', { seed });
  const out = HARVEST.apply(last, repairArt('area-2'));
  assertEqual(out.queue.chainRepairRounds, 0, 'the round counter did not decrement');
  assert((out.queue.harvestAreas || []).includes('chain-repair-sc-cat-item'),
    `the repair area was not queued: ${JSON.stringify(out.queue.harvestAreas)}`);
  const det = (out.queue.harvestAreaDetail || []).find((d) => d.id === 'chain-repair-sc-cat-item');
  assert(det && det.targets.length === 3, `the area carries no target list: ${JSON.stringify(det)}`);
  assert((out.findings || []).some((f) => f.check === 'chain-repair-round' && /population: every dangling reference/.test(f.message)),
    `the round reported nothing about what it queued or left behind: ${JSON.stringify((out.findings || []).map((f) => f.check))}`);
});

test('the repair leg is bounded by rounds, so a run cannot chase its own tail forever', () => {
  /*
   * CONVERGENCE IS THE WHOLE RISK. Repairing a chain harvests records whose own references dangle,
   * so an unbounded version never terminates. The counter shuts the leg whether or not it found
   * anything, which is why this asserts on a ledger that STILL has repairable chains.
   */
  const seed = [
    refClaim('catalog_ui_policy', ID(1), { catalog_item: ID(50) }),
    refClaim('sc_cat_item', ID(50), { name: 'mapped' }),
    refClaim('catalog_ui_policy', ID(2), { catalog_item: ID(60) }),
    refClaim('catalog_ui_policy', ID(3), { catalog_item: ID(61) }),
    refClaim('catalog_ui_policy', ID(4), { catalog_item: ID(62) }),
  ];
  const spent = repairCtx('repair-spent', { seed, queue: { chainRepairRounds: 0 } });
  const out = STAGE_BY_ID.get('harvest').apply(spent, repairArt('area-2'));
  assert(!out.queue.harvestAreas,
    `the leg minted areas with zero rounds left, which is a run that never finishes: ${JSON.stringify(out.queue.harvestAreas)}`);
  assertEqual((out.findings || []).filter((f) => f.check === 'chain-repair-round').length, 0);
});

test('a repair area that read nothing may not be accepted, or the run dies stalled with the budget spent', () => {
  /*
   * THE HOLE THIS CLOSES IS ONE I OPENED. Harvest's stagnation mode is `claims-added`: two
   * consecutive ACCEPTED iterations adding zero claims terminate the run `stalled`. Repair areas
   * are appended last and sorted descending, so the tail is three-target areas reached through
   * polymorphic columns whose probes come back empty BY DESIGN. Two of those in a row would end
   * the run at the very end of the queue, after every call had been paid for.
   */
  assertEqual(STAGE_BY_ID.get('harvest').stagnation, 'claims-added',
    'this guard exists because of the stagnation mode; if the mode changed, re-derive the guard rather than deleting it');
  const root = scratchRepo('repair-empty');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const detail = {
    id: 'chain-repair-sc-cat-item', tables: ['sc_cat_item'], population: 'chain-repair',
    targets: [ID(60), ID(61), ID(62)], targetsTotal: 3, rowsInDomain: 3,
    from: ['catalog_ui_policy.catalog_item'], why: 'three catalog items are referenced and never mapped.',
  };
  brain.state.queue = { harvestAreas: ['chain-repair-sc-cat-item'], harvestDone: [], harvestAreaDetail: [detail] };
  const ctx = { brain, state: brain.state, stage: 'harvest' };
  const h = STAGE_BY_ID.get('harvest');
  const art = {
    stage: 'harvest', instance: 'x', area: 'chain-repair-sc-cat-item', claims: [],
    usage: { apiCalls: 2, requestLog: 'spikes/scriptsync-read/snbrain-requests.ndjson' },
    coverage: { rowsSeen: 0, rowsTotal: 0, truncated: false, note: 'all three sys_ids returned no row' },
    acceptance: [{ id: 'AC-HARV-1', result: 'pass', evidence: 'dictionaryFields() first' }],
  };
  const rej = h.validate(ctx, art);
  assert(rej.some((m) => /claims is empty on chain-repair area/.test(m) && /ABSENCE claim/.test(m)),
    `a claimless repair area was accepted, which walks the run into the stagnation breaker:\n${rej.join('\n')}`);

  // The escape is free, improves the deliverable, and must actually pass.
  art.claims = detail.targets.map((id) => ({
    locus: { table: 'sc_cat_item', sysId: id, field: 'sys_id' },
    assertion: `no record with this sys_id exists in sc_cat_item; the reference from catalog_ui_policy.catalog_item is dangling.`,
    band: 'A', rung: 'L1',
    evidence: {
      query: `sys_idIN${id}`, fields: 'sys_id,name', capturedAt: '2026-08-19T00:00:00Z', transport: 'rest_request',
      completeness: 'complete', capturedResponse: {}, guards: { fields: 'validated', identityCanary: 'pass' },
    },
  }));
  const ok = h.validate(ctx, art);
  assertEqual(ok.filter((m) => /claims is empty on chain-repair area/.test(m)).length, 0);
  assertEqual(ok.filter((m) => /empty or absent/.test(m)).length, 0,
    `the absence-claim escape is refused by the empty-assertion rule, so the guard has no legal answer:\n${ok.join('\n')}`);
});

test('a boundary recast returns the repair round, because it discards the ledger the round was spent on', () => {
  const h = STAGE_BY_ID.get('harvest');
  assert((h.boundaryCast.queue || []).includes('chainRepairRounds'),
    'a spent round counter would survive a recast and shut the repair leg for a run that has just re-read everything under a new boundary');
  assert((h.boundaryCast.queue || []).includes('harvestDone'), 'the done-list must still cast');
});

test('a repair area is briefed in sys_ids, never as a Band A stratum', () => {
  const ctx = repairCtx('repair-brief', {
    seed: [],
    queue: {
      harvestAreas: ['chain-repair-sc-cat-item'], harvestDone: [],
      harvestAreaDetail: [{
        id: 'chain-repair-sc-cat-item', tables: ['sc_cat_item'], population: 'chain-repair',
        targets: [ID(60), ID(61), ID(62)], targetsTotal: 3, rowsInDomain: 3,
        from: ['catalog_ui_policy.catalog_item'], why: 'three catalog items are referenced and never mapped.',
      }],
    },
  });
  const HARVEST = STAGE_BY_ID.get('harvest');
  const goal = HARVEST.goal(ctx);
  assert(/ALREADY REFERENCES and never mapped/.test(goal),
    `a repair area was briefed in the wrong unit — "0 in-domain Band A rows" tells the agent there is nothing there:\n${goal}`);
  assert(!/Band A rows/.test(goal), `the brief still prices a named sys_id list as a stratum:\n${goal}`);
  const proc = HARVEST.procedure(ctx).join('\n');
  assert(/THE SYS_IDS ARE THE QUERY/.test(proc), `the procedure gave no repair leg:\n${proc}`);
  assert(proc.includes(ID(60)), 'the sys_ids the agent is meant to read are not in the brief');
  assert(/returns NO ROW is a load-bearing fact/.test(proc),
    'the brief does not say what an empty sys_idIN result means, which is the one outcome polymorphic attribution guarantees');
  assert(HARVEST.procedure(ctx).every((l) => typeof l === 'string' && l.length),
    'an inapplicable procedure leg leaked into the brief as null');
});

test('a class finding is one row however many verify iterations run', () => {
  const root = scratchRepo('coherence-dedupe');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const rows = [];
  for (let i = 0; i < 5; i += 1) { rows.push(refClaim('sc_cat_item', ID(100 + i), { category: ID(200 + i) })); }
  const found = stages.danglingFindings(rows);
  brain.upsertFindings(found, { stage: 'verify' });
  const first = brain.findings().size;
  brain.upsertFindings(stages.danglingFindings(rows), { stage: 'verify' });
  assertEqual(brain.findings().size, first,
    'a re-run of verify piled up duplicate coherence findings instead of updating them — the ledger would grow one wall of warnings per iteration');
});

/** Dangling-chain seed: three sc_cat_item targets referenced and never mapped. */
function danglingSeed() {
  return [
    refClaim('catalog_ui_policy', ID(1), { catalog_item: ID(50) }),
    refClaim('sc_cat_item', ID(50), { name: 'mapped' }),
    refClaim('catalog_ui_policy', ID(2), { catalog_item: ID(60) }),
    refClaim('catalog_ui_policy', ID(3), { catalog_item: ID(61) }),
    refClaim('catalog_ui_policy', ID(4), { catalog_item: ID(62) }),
  ].map((c) => ({ locus: c.locus, assertion: c.assertion, band: 'A', status: 'verified', evidence: c.evidence }));
}

/** A brain parked mid-harvest ON DISK, the way the CLI will reopen it. */
function parkedHarvest(name, opts) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  brain.upsertClaims(opts.seed || [], { stage: 'harvest' });
  brain.state.stage = 'harvest';
  const enteredAt = opts.enteredAt || new Date().toISOString();
  const its = opts.iterations || [{ n: 1, at: enteredAt, accepted: true, progress: true, apiCalls: 30 }];
  brain.state.stages.harvest = {
    status: 'active', enteredAt, completedAt: null, sinceProgress: 0,
    total: its.length, iterations: its, lastRejections: [],
  };
  brain.state.queue = opts.queue;
  if (opts.spendAll) { brain.state.budget.usedCalls = brain.state.budget.maxCalls; }
  brain.save('seed', {});
  return brain;
}

test('METHOD-6 fix (3): the repair leg is reachable from the CLOSE path, because a close never calls apply()', () => {
  /*
   * Measured on pilot-run-5: harvest closed `elapsed-capped` at 19 of 29 areas with 3,920 of
   * 5,000 calls unspent, `queue.chainRepairRounds` undefined and zero repair areas ever
   * minted. Repair areas were minted in apply() alone, and a close is a CLI action that never
   * calls apply() — so on any run that closes early, which is the normal case, the leg was
   * UNREACHABLE and the fix had never executed. The close path now mints the tail, records the
   * census remainder as closed, and HOLDS the cursor so the tail is actually read.
   */
  const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
  const brain = parkedHarvest('close-salvage', {
    seed: danglingSeed(),
    enteredAt: fiveHoursAgo,   // past the 4h horizon: the close that fires is elapsed-capped
    queue: {
      harvestAreas: ['read-1', 'unread-1', 'unread-2'], harvestDone: ['read-1'],
      harvestAreaDetail: [{ id: 'read-1' }, { id: 'unread-1' }, { id: 'unread-2' }],
    },
  });
  const outText = runCli(brain.root, 'next');
  assert(/STAGE CLOSED: harvest — /.test(outText), `the close did not announce the salvage stay:\n${outText.slice(0, 400)}`);
  const after = Brain.open(brain.root);
  assertEqual(after.state.stage, 'harvest',
    'the cursor left harvest, so the minted tail can never be read — the exact unreachability this door closes');
  const q = after.state.queue;
  assert((q.harvestAreas || []).includes('chain-repair-sc-cat-item'),
    `no repair area was minted at the close: ${JSON.stringify(q.harvestAreas)}`);
  assert(!(q.harvestAreas || []).includes('unread-1') && !(q.harvestAreas || []).includes('unread-2'),
    'a CLOSED census area is still in the live queue and would be handed straight back out');
  assertEqual((q.harvestAreasClosed || []).join(','), 'unread-1,unread-2', 'the closed remainder lost its names');
  assertEqual(q.chainRepairRounds, 0, 'the close-path mint spent no round — the unbounded loop with extra steps');
  assertEqual((after.state.closes || []).length, 1, 'the census close itself was not recorded');
  assert([...after.findings().values()].some((f) => f.check === 'chain-repair-round'),
    'the round reported nothing about what it queued and left behind');
  assert([...after.findings().values()].some((f) => /^stage-closed-/.test(f.check)),
    'the salvage swallowed the close warning, so the unread remainder surfaces nowhere');
  // The very next `next` must BRIEF the tail rather than close it on the elapsed bound it
  // was born past — the exemption is what makes the leg reachable rather than merely minted.
  const brief = runCli(brain.root, 'next');
  assert(!/STAGE CLOSED/.test(brief), `the tail was closed before its first iteration:\n${brief.slice(0, 400)}`);
  assert(/chain-repair-sc-cat-item/.test(brief), `the brief does not hand out the repair area:\n${brief.slice(0, 400)}`);
});

test('a budget-capped close mints nothing: the run cannot pay for the reads it would queue', () => {
  const brain = parkedHarvest('close-salvage-broke', {
    seed: danglingSeed(),   // a mint WOULD find areas here, so a pass is the guard and not the fixture
    iterations: [{ n: 1, at: new Date().toISOString(), accepted: true, progress: true, apiCalls: 269 }],
    queue: {
      harvestAreas: ['read-1', 'unread-1'], harvestDone: ['read-1'],
      harvestAreaDetail: [{ id: 'read-1' }, { id: 'unread-1' }],
    },
    spendAll: true,
  });
  const outText = runCli(brain.root, 'next');
  assert(/STAGE CLOSED: harvest -> explain/.test(outText), `a budget close did not route forward:\n${outText.slice(0, 300)}`);
  const after = Brain.open(brain.root);
  assertEqual(after.state.stage, 'explain', 'a budget-capped close held the cursor for a tail it cannot pay for');
  assertEqual((after.state.queue.harvestAreas || []).filter((a) => /^chain-repair-/.test(a)).length, 0,
    'repair areas were minted against an empty wallet');
  assertEqual(after.state.queue.chainRepairRounds, undefined, 'a round was spent on a mint that never happened');
});

test('the tail\'s own close advances — re-minting there is the unbounded loop with extra steps', () => {
  /*
   * Iteration-capped close on a queue that is ALL chain-repair areas, with a round still in
   * hand and a ledger that still has repairable chains: the one state where a re-mint door
   * would spin forever. onClose must decline and the close must route to explain.
   */
  const now = new Date().toISOString();
  const brain = parkedHarvest('close-tail-ends', {
    seed: danglingSeed(),
    // Five unpriced iterations against a 2-area queue: ceiling() = areas + 3 = 5, so the
    // iteration-capped close fires; no priced iteration means the money check stays quiet.
    iterations: new Array(5).fill(0).map((_, i) => ({ n: i + 1, at: now, accepted: true, progress: true, apiCalls: 0 })),
    queue: {
      harvestAreas: ['read-1', 'chain-repair-sc-cat-item'], harvestDone: ['read-1'],
      harvestAreaDetail: [{ id: 'read-1' }, {
        id: 'chain-repair-sc-cat-item', tables: ['sc_cat_item'], population: 'chain-repair',
        targets: [ID(60), ID(61), ID(62)], targetsTotal: 3, rowsInDomain: 3,
        from: ['catalog_ui_policy.catalog_item'], why: 'seeded',
      }],
      chainRepairRounds: 1,
    },
  });
  const outText = runCli(brain.root, 'next');
  assert(/STAGE CLOSED: harvest -> explain/.test(outText), `the tail's close did not route forward:\n${outText.slice(0, 300)}`);
  const after = Brain.open(brain.root);
  assertEqual(after.state.stage, 'explain', 'the tail held the cursor at its own close, which is the loop the round count exists to prevent');
  assertEqual((after.state.queue.harvestAreas || []).filter((a) => /^chain-repair-/.test(a)).length, 1,
    'the tail re-minted at its own close');
});

group('H. domain predicate');

test('a predicate parses into independently measurable legs', () => {
  const d = stateLib.parseDomain('scope:sn_ohs_im,x_acme_acme; author:jan.jansen; name:ACME*,QRT*; updateset:STRY01850*');
  assertEqual(d.scope.length, 2); assertEqual(d.author[0], 'jan.jansen');
  assertEqual(d.name.length, 2); assertEqual(d.updateSet[0], 'STRY01850*');
  assertEqual(stateLib.parseDomain('scopes:a; update-set:b').updateSet[0], 'b', 'documented aliases do not resolve');
});

test('a malformed predicate is refused rather than silently admitting nothing', () => {
  for (const bad of ['sn_ohs_im', 'nonsense:x', 'scope:']) {
    let threw = false;
    try { stateLib.parseDomain(bad); } catch (err) { threw = true; }
    assert(threw, `"${bad}" was accepted as a domain predicate`);
  }
  assertEqual(stateLib.parseDomain(null), null, 'no predicate should mean instance-wide, not an empty one');
});

test('--scope still means what it always meant, and folds into the same shape', () => {
  const root = scratchRepo('dom-compat');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, scopeFilter: ['sn_ohs_im', 'global'] });
  assertEqual(brain.state.config.scopeFilter.length, 2, 'the legacy field stopped being populated');
  assertEqual(brain.state.config.domain.scope.length, 2, '--scope did not fold into the predicate');
  assertEqual(brain.state.config.domain.author.length, 0, '--scope invented legs it was never given');
  assertIncludes(brain.state.stamps.domainBoundary, 'scope:sn_ohs_im,global', 'the boundary was not stamped for the rendered pages');
});

test('per-leg yield reports what each leg admitted, and what only it admitted', () => {
  const y = stateLib.domainYield([
    { admittedBy: ['scope'] },
    { admittedBy: ['scope', 'name'] },
    { admittedBy: ['name'] },
    { admittedBy: [] },
  ]);
  assertEqual(y.legs.scope.admitted, 2);
  assertEqual(y.legs.scope.soleAdmitter, 1, 'the sole-admitter count is the only one that says whether a leg earned its reads');
  assertEqual(y.legs.name.admitted, 2);
  assertEqual(y.legs.name.soleAdmitter, 1);
  assertEqual(y.legs.author.admitted, 0, 'a leg that admitted nothing must report zero, not be absent');
  assertEqual(y.unattributed, 1, 'a claim attributable to no leg was silently counted as in-domain');
});

test('status reports the predicate and its per-leg yield', () => {
  const root = scratchRepo('dom-status');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, domain: stateLib.parseDomain('scope:sn_ohs_im; name:ACME*') });
  brain.upsertClaims([
    { locus: { table: 't', sysId: 'a' }, assertion: 'x', band: 'A', status: 'draft', admittedBy: ['scope'] },
    { locus: { table: 't', sysId: 'b' }, assertion: 'y', band: 'A', status: 'draft', admittedBy: ['name'] },
  ], { stage: 'harvest' });
  brain.save('seed');
  const r = cli(['status', '--root', root]);
  assertEqual(r.code, 0, `status failed:\n${r.stderr}`);
  assertIncludes(r.stdout, 'scope:sn_ohs_im', 'status does not show the predicate the run was bounded by');
  assertIncludes(r.stdout, 'that no other leg would have', 'status does not report sole-admitter yield');
  const j = cliJson(['status', '--root', root]).json;
  assertEqual(j.domain.yield.legs.name.soleAdmitter, 1, 'per-leg yield is absent from the machine-readable status');
});

test('2.2: refine re-aims the boundary, attributed, and never retroactively', () => {
  const root = scratchRepo('dom-refine');
  const brain = Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, domain: stateLib.parseDomain('scope:sn_ohs_im') });
  brain.upsertClaims([{ locus: { table: 't', sysId: 'a' }, assertion: 'x', band: 'A', status: 'draft', admittedBy: ['scope'] }], { stage: 'harvest' });
  brain.save('seed');

  assert(cli(['refine', '--domain', 'scope:sn_ohs_im; name:ACME*', '--root', root]).code !== 0,
    'an unattributed refine changed the boundary the run\'s numbers are relative to');

  const r = cli(['refine', '--domain', 'scope:sn_ohs_im; name:ACME*', '--by', 'a named expert',
    '--reason', 'the interview established that ACME work also carries the prefix outside the scope', '--root', root]);
  assertEqual(r.code, 0, `refine failed:\n${r.stdout}${r.stderr}`);

  const after = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(after.config.domain.name[0], 'ACME*', 'the predicate did not move');
  assertIncludes(after.stamps.domainBoundary, 'name:ACME*', 'the stamp rendered pages carry was not updated');
  assertEqual(after.refinements.length, 1, 'the refinement was not recorded');
  assertEqual(after.refinements[0].by, 'a named expert');
  assertEqual(after.refinements[0].claimsAtRefinement, 1, 'the refinement does not record how much had already been harvested under the old boundary');

  const claim = [...Brain.open(root).claims().values()][0];
  assertEqual(claim.admittedBy.join(','), 'scope',
    'refine rewrote an already-harvested claim, erasing the evidence that the boundary moved');
});

test('refining to the same predicate records nothing', () => {
  const root = scratchRepo('dom-refine-noop');
  Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER, domain: stateLib.parseDomain('scope:a') });
  const r = cli(['refine', '--domain', 'scope:a', '--by', 'someone', '--reason', 'no change', '--root', root]);
  assertEqual(r.code, 0);
  assertEqual((JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8')).refinements || []).length, 0,
    'a no-op refine was recorded as a boundary change');
});

test('an instance-wide run reports no domain block at all', () => {
  const root = scratchRepo('dom-none');
  Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  assertEqual(cliJson(['status', '--root', root]).json.domain, null,
    'an unbounded run claimed a domain boundary it never had');
});

// ===========================================================================
// L — the boundary recast, and the population no area can reach.
// Run `pilot-run-4`: initialised instance-wide, census derived 475 areas over
// bands.A = 257,352, the operator refined to a 13,447-row boundary DURING
// harvest, and the queue stayed cast in the old population.
// ===========================================================================

group('L. boundary recast');

/** A run stopped exactly where pilot-run-4 stopped: census accepted instance-wide, harvest entered. */
function recastRepo(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'pilot-run-4', stageOrder: STAGE_ORDER });
  const st = brain.state;
  st.stage = 'harvest';
  st.stages.census.status = 'complete';
  st.stages.census.total = 1;
  st.stages.census.iterations = [{ n: 1, accepted: true, progress: true, apiCalls: 152, artifact: 'census.json' }];
  st.stages.harvest.status = 'active';
  st.queue = {
    harvestAreas: ['sys-documentation', 'sys-dictionary'],
    harvestAreaDetail: [{ id: 'sys-documentation', tables: ['sys_documentation'], bandARows: 147967 }],
    harvestAreasOutOfBoundary: [],
    harvestDone: [],
    processCandidates: [{ key: 'us-1' }],
    namedProcesses: [],
    statedConventions: [{ kind: 'code-style' }],
  };
  st.facts = { census: { bands: { A: 257352 } }, 'coverage.sys-documentation': { rowsSeen: 10 } };
  brain.save('fixture', {});
  return root;
}

test('PRODUCT-82: refining after a population was measured refuses, and names what it would discard', () => {
  const root = recastRepo('recast-refuse');
  const r = cli(['refine', '--domain', 'scope:sn_ohs_im; name:ACME*', '--by', 'the developer', '--reason', 'measured per-leg yield', '--root', root]);
  assertEqual(r.code, 2, 'a boundary change that invalidates a measured queue went through silently');
  assertIncludes(r.stderr, '--recast', 'the refusal does not name the one flag that resolves it');
  assertIncludes(r.stderr, 'harvestAreas', 'the refusal does not say which queue the change falsifies');
  const after = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assert(!after.stamps.domainBoundary, 'the boundary was written despite the refusal — a refusal that mutates state is not a refusal');
  assertEqual(after.queue.harvestAreas.length, 2, 'the queue was touched by a command that returned non-zero');
});

test('PRODUCT-82: --recast re-opens the boundary-cast stages, drops what they own, and keeps the claims', () => {
  const root = recastRepo('recast-apply');
  const brain0 = Brain.open(root);
  brain0.upsertClaims([{
    locus: { table: 'sys_script', sysId: 'a'.repeat(32), key: 'x' }, assertion: 'a claim harvested under the old boundary',
    band: 'A', status: 'draft', rung: 'L1', admittedBy: ['scope'],
    evidence: { query: 'sys_scope.scope=sn_ohs_im', capturedAt: new Date().toISOString(), fields: ['name'] },
  }], { stage: 'harvest', iteration: 1 });

  const r = cli(['refine', '--recast', '--domain', 'scope:sn_ohs_im; name:ACME*', '--by', 'the developer', '--reason', 'measured per-leg yield', '--root', root]);
  assertEqual(r.code, 0, `--recast was refused:\n${r.stderr}`);

  const after = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(after.stage, 'census', 'the run did not go back to the stage whose measurements were dropped');
  assertEqual(after.stages.census.status, 'active');
  assertEqual(after.stages.census.iterations.length, 0,
    'the superseded iteration was left in place, so cmdNext\'s `produced` test routes straight past the stage it was just sent back to');
  assertEqual(after.stages.census.superseded.length, 1,
    'the superseded iteration was DELETED — the run can no longer show that a census ran at all under the old boundary');
  assertEqual(after.stages.census.recasts[0].discarded, 1, 'the recast does not record what it cost');
  assertEqual(after.queue.harvestAreas, undefined, 'the work queue cast in the old population survived the recast');
  assertEqual(after.queue.harvestDone, undefined, 'the done-list naming areas that no longer exist survived the recast');
  assertEqual(after.queue.statedConventions.length, 1,
    'the recast dropped a queue key no boundary-cast stage owns — orientation is not boundary-cast and its output is a human\'s words, not a measurement');
  assertEqual('census' in after.facts, false, 'facts.census still holds numbers measured in the discarded population');
  assertEqual('coverage.sys-documentation' in after.facts, false, 'a per-area coverage denominator outlived the area it counted');

  assertEqual(Brain.open(root).claims().size, 1,
    'the recast destroyed claims — refine\'s own doctrine is that a claim keeps the admittedBy it was harvested under');
  const f = [...Brain.open(root).findings().values()].filter((x) => x.check === 'boundary-recast');
  assertEqual(f.length, 1, 'a boundary change big enough to re-open two stages left no finding, so the wiki cannot show that every earlier ratio is against a different boundary');
});

test('PRODUCT-82: a run already refined under the old CLI can recast without changing its predicate', () => {
  const root = recastRepo('recast-noop-predicate');
  // The state pilot-run-4 was actually left in: the new boundary is written, the old queue survives.
  const brain = Brain.open(root);
  brain.state.config.domain = stateLib.parseDomain('scope:sn_ohs_im; name:ACME*');
  brain.state.stamps.domainBoundary = stateLib.describeDomain(brain.state.config.domain);
  brain.save('fixture', {});

  const plain = cli(['refine', '--domain', 'scope:sn_ohs_im; name:ACME*', '--by', 'x', '--reason', 'y', '--root', root]);
  assertEqual(plain.code, 0);
  assertIncludes(plain.stdout, '--recast',
    'the no-op branch does not tell a run refined under the old CLI that a route back exists, and the only other one is the hand edit to .brain/ this product forbids');
  assertEqual(JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8')).queue.harvestAreas.length, 2,
    'a refine that reported "nothing recorded" recorded something');

  const r = cli(['refine', '--recast', '--domain', 'scope:sn_ohs_im; name:ACME*', '--by', 'the developer', '--reason', 'the queue was measured instance-wide before this boundary existed', '--root', root]);
  assertEqual(r.code, 0, `--recast on an unchanged predicate was refused:\n${r.stderr}`);
  const after = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(after.stage, 'census', 'the run was not sent back to re-measure');
  assertEqual(after.queue.harvestAreas, undefined, 'the stale queue survived a recast that reported success');
  assertEqual(after.stamps.domainBoundary, 'scope:sn_ohs_im ∪ name:ACME*', 'a recast-only refine altered the boundary it was told not to touch');
  assertEqual(after.refinements[0].predicateUnchanged, true, 'the recast-only refinement is indistinguishable from a boundary change in the audit trail');
});

test('PRODUCT-82: refining BEFORE anything is measured costs nothing and needs no flag', () => {
  const root = scratchRepo('recast-early');
  Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  const r = cli(['refine', '--domain', 'scope:a', '--by', 'someone', '--reason', 'the boundary decision the loop actually wants', '--root', root]);
  assertEqual(r.code, 0, `refining before census was refused, which makes the guard punish the correct order of operations:\n${r.stderr}`);
  assertEqual(JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8')).stage, 'preflight',
    'a refine with nothing to recast moved the run anyway');
});

test('PRODUCT-82: the engine names no stage — the recast set comes from the table', () => {
  assertEqual(/'census'|"census"|'harvest'|"harvest"/.test(String(stages.boundaryCastStages)), false,
    'boundaryCastStages() hardcodes a stage id, so adding a boundary-cast stage stops being a table edit');
  const cast = stages.boundaryCastStages({ stages: { census: { status: 'complete', iterations: [] }, harvest: { status: 'pending', iterations: [] } } });
  assertEqual(cast.map((c) => c.stage).join(','), 'census',
    'a stage that was never entered was recast anyway, so a refine before harvest discards work that does not exist');
});

group('L. configuration held in data');

test('PRODUCT-83: a data table with no metadata parent is demanded, allowlisted, and sized in its own unit', () => {
  const ctx = censusCtx('data-areas-demand', RUN6EF_DOMAIN);
  const bare = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_A_IN_DOMAIN }),
    RUN6EF_AREAS.map(([id, wide, inDom]) => ({ id, tables: [id], bandARows: wide, bandARowsInDomain: inDom })));
  const rej = CENSUS_STAGE.validate(ctx, bare).join(' ');
  assertIncludes(rej, 'sys_user_group',
    'a census that reached no group at all was accepted — run pilot-run-4 could not see the 21 ACME groups its own recall named as the routing mechanism');
  assertIncludes(rej, 'no scope leg',
    'the demand does not say which legs work here, so the agent will reach for sys_scope on a table that has none');

  // The allowlist is the point: a plausible table name is an unvalidated clause.
  const invented = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_A_IN_DOMAIN }),
    honestArt().areas, { dataAreas: [{ table: 'cmn_department', rowsInDomain: 900, query: 'nameSTARTSWITHACME' }] });
  assertIncludes(CENSUS_STAGE.validate(ctx, invented).join(' '), 'allowlist on purpose',
    'a data table this repo has never read was accepted into an encoded query');

  // A non-zero count with no dictionary read is indistinguishable from a full-table sweep.
  const unvalidated = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_A_IN_DOMAIN }),
    honestArt().areas, { dataAreas: [{ table: 'sys_user_group', rowsInDomain: 4312, query: 'nameSTARTSWITHACME' }] });
  assertIncludes(CENSUS_STAGE.validate(ctx, unvalidated).join(' '), 'columnsValidated',
    'PLATFORM-1: an unknown column drops the clause and returns the whole table, and 4,312 rows would have been reported as 4,312 ACME groups');

  // A measured ZERO is an accepted answer and mints no work.
  const zero = censusArt(Object.assign({}, RUN6EF_BANDS, { AInDomain: RUN6EF_A_IN_DOMAIN }),
    honestArt().areas, { dataAreas: [{ table: 'sys_user_group', rowsInDomain: 0, query: 'nameSTARTSWITHACME' }] });
  assertEqual(CENSUS_STAGE.validate(ctx, zero).length, 0, `a measured-empty data area was rejected:\n  ${CENSUS_STAGE.validate(ctx, zero).join('\n  ')}`);
  assertEqual(CENSUS_STAGE.apply(ctx, zero).queue.harvestAreas.includes('data-sys-user-group'), false,
    'an empty data area was handed out as work');
});

test('PRODUCT-83: an unbounded run is not asked for a population its boundary cannot reach', () => {
  const ctx = censusCtx('data-areas-unbounded', null);
  const art = censusArt(Object.assign({}, RUN6EF_BANDS), shippedAreas());
  assertEqual(CENSUS_STAGE.validate(ctx, art).join(' ').indexOf('sys_user_group'), -1,
    'a run with neither a name nor an author leg was asked to reach data rows it has no leg for — a rejection nothing can satisfy');
});

test('PRODUCT-83: the harvest brief sizes a data area in the data population, never in Band A', () => {
  const q = { harvestAreas: ['data-sys-user-group'], harvestDone: [], harvestAreaDetail: [{
    id: 'data-sys-user-group', tables: ['sys_user_group'], population: 'data', rowsInDomain: 21, query: 'nameSTARTSWITHACME',
  }] };
  const goal = HARVEST_STAGE.goal({ state: { queue: q } });
  assertIncludes(goal, 'NOT Band A', 'the brief sized a data area in Band A units, so "0 Band A rows" reads as "there is nothing there"');
  assertIncludes(goal, 'nameSTARTSWITHACME', 'the brief did not carry the query the census measured this area with, so the agent re-encodes it and gets a fresh chance at PLATFORM-1');
  assertEqual(/undefined/.test(goal), false, `the brief printed an undefined size:\n${goal}`);
});

test('PRODUCT-83: a group claimed without its role grants and its membership is refused', () => {
  const children = stages.definingChildrenFor(['sys_user_group'], { depth: 1 }).map((c) => c.table);
  assertEqual(children.join(','), 'sys_group_has_role,sys_user_grmember',
    'the group\'s defining children are gone — a group is then a name with no routing rule and no membership behind it');
});

test('PRODUCT-84: the remedy for an unreachable leg establishes the table kind before it hands over a query', () => {
  const compiled = stateLib.compileDomain({ name: ['ACME*'] }, 'sys_user_group');
  const leg = (compiled.unavailableLegs || []).find((l) => l.leg === 'name');
  assert(!!leg, 'the name leg on a data table is no longer reported unavailable, so a clause is being emitted for a column this product cannot prove exists');
  assertIncludes(leg.remedy, 'count(sys_metadata, sys_class_name=sys_user_group)',
    'the remedy still asserts "every application-file row IS a sys_metadata row" of a table it just said it cannot classify — on sys_user_group that query returns zero rows and reports it as an answer');
  assertIncludes(leg.remedy, 'If ZERO', 'the remedy has no branch for the case where the premise is false');
  assertIncludes(leg.remedy, 'dictionary-validate', 'the data branch hands over a column clause with no dictionary read in front of it');
});

test('PRODUCT-85: every schema key is reachable — no key is nested inside its own duplicate', () => {
  const walk = (node, path, out) => {
    if (!node || typeof node !== 'object') { return; }
    const props = node.props || (node.items && node.items.props);
    for (const k of Object.keys(props || {})) {
      if (path.includes(k)) { out.push(`${path.join('.')}.${k}`); }
      walk(props[k], path.concat([k]), out);
    }
  };
  const bad = [];
  for (const s of STAGES) {
    if (!s.schema) { continue; }
    walk(s.schema, [], bad);
  }
  assertEqual(bad.join(', '), '',
    'a schema key contains a key of the same name, which is valid JS and silent: census.areas shipped as `areas: {type:"array", min:1, areas:{…items…}}` for the whole of Phase 5, so no per-area field was ever validated');
});

// ===========================================================================
// S — seed and anchor: the seeded entry of the process-brain product.
//
// The invariant under test: a developer's pointers gate the surface BEFORE any read
// (seed, zero API calls, one hard requirement), the anchor turns them into a tiered
// queue with a citable edge per member, and the routes are recorded — census skipped
// on the seeded path, anchor skipped on the unseeded one — never implied.
// ===========================================================================

group('S. seed and anchor — the seeded entry');

const SEED_STAGE = STAGE_BY_ID.get('seed');
const ANCHOR_STAGE = STAGE_BY_ID.get('anchor');

function seedArtifact() {
  return {
    stage: 'seed', instance: 'selftest-instance',
    usage: { apiCalls: 0 },
    available: true, providedBy: 'a.developer', recordedAt: '2026-08-20',
    process: {
      name: 'Case cancellation',
      trigger: 'an operator cancels a case from the workspace',
      outcome: 'the case closes as cancelled and the assignment group is notified',
    },
    pointers: [
      { kind: 'update-set', value: 'STRY0185005 ACME cancel flow', confidence: 'certain' },
      { kind: 'document', value: 'ACME cancellation way-of-working', url: 'https://confluence.example.com/x/CCC', confidence: 'certain' },
    ],
    acceptance: [
      { id: 'AC-SEED-1', result: 'pass', evidence: 'usage.apiCalls = 0' },
      { id: 'AC-SEED-2', result: 'pass', evidence: 'pointers verbatim from a.developer with their confidence words' },
      { id: 'AC-SEED-3', result: 'pass', evidence: 'one update-set pointer recorded' },
    ],
  };
}

test('the seeded route: orientation -> seed -> provenance, census recorded skipped, envelope stamped', () => {
  const { root, syncRoot } = startRun('seed-route');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const o = ingest(root, 'orientation', orientationArtifact());
  assertEqual(o.json.nextStage, 'seed', 'orientation no longer routes to the seed door');
  const r = ingest(root, 'seed', seedArtifact());
  assertEqual(r.json.accepted, true, `seed rejected: ${JSON.stringify(r.json.rejected)}`);
  assertEqual(r.json.nextStage, 'provenance', 'a seeded run entered the census — the stage whose entire job the developer\'s pointers just did');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stages.census.status, 'skipped', 'the census was routed past without being recorded skipped, so the projection lies');
  assertEqual(st.stamps.inputEnvelope, 'sets+docs',
    'the input envelope was not stamped from what the developer actually provided — downstream stages will assume inputs that do not exist');
  assertEqual(st.stamps.processName, 'Case cancellation');
});

test('seed refuses an artifact that spent an API call', () => {
  const { root, syncRoot } = startRun('seed-zero-read');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  ingest(root, 'orientation', orientationArtifact());
  const art = seedArtifact();
  art.usage.apiCalls = 2;
  const r = ingest(root, 'seed', art);
  assertEqual(r.json.accepted, false, 'seed read the instance, so resolution failures now surface at the prior instead of at anchor\'s stop-and-ask');
  assertIncludes(JSON.stringify(r.json.rejected), 'reads NOTHING');
});

test('seed refuses a run with no update-set pointer — the one hard gate', () => {
  const { root, syncRoot } = startRun('seed-no-set');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  ingest(root, 'orientation', orientationArtifact());
  const art = seedArtifact();
  art.pointers = art.pointers.filter((p) => p.kind !== 'update-set');
  const r = ingest(root, 'seed', art);
  assertEqual(r.json.accepted, false, 'a "seeded" run with no update set is a census with a misleading name');
  assertIncludes(JSON.stringify(r.json.rejected), 'hard requirement');
});

test('seed unavailable degrades to the census path, stamped and recorded', () => {
  const { root, syncRoot } = startRun('seed-unavailable');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  ingest(root, 'orientation', orientationArtifact());
  const art = seedArtifact();
  art.available = false;
  art.unavailableReason = 'no developer reachable this week; the engagement starts brownfield';
  art.pointers = [];
  const r = ingest(root, 'seed', art);
  assertEqual(r.json.accepted, true, `an unavailable seed must be a legal, recorded outcome: ${JSON.stringify(r.json.rejected)}`);
  assertEqual(r.json.nextStage, 'census', 'a run with no seed did not degrade to the archaeology path');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stamps.inputEnvelope, 'none');
});

test('a blind run skips both human doors and stamps the seed skip', () => {
  const { root, syncRoot } = startRun('seed-blind', ['--blind']);
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  assertEqual(r.json.nextStage, 'census', 'a blind run entered a human door');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stages.seed.status, 'skipped', 'seed was routed past without being recorded skipped');
  assertEqual(st.stamps.seed, 'skipped-blind',
    'nothing downstream can tell a blind run from one where the developer was asked and had nothing');
});

test('anchor hard gate: no seeded set with members refuses, and names the honest exit', () => {
  const ctx = fakeCtx({ stage: 'anchor' });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  for (const s of art.sets) { if (s.role === 'seeded') { s.members = 0; } }
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assert(rej.some((x) => /resolutionFailed:true/.test(x)),
    `an anchor whose seed resolved empty was accepted, or the rejection does not name the stop-and-ask exit:\n${rej.join('\n')}`);
});

test('anchor refuses a T2 member with no citable edge — AC-ANC-1 is a check, not a wish', () => {
  const ctx = fakeCtx({ stage: 'anchor' });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  const t2 = art.surface.find((m) => m.tier === 'T2');
  delete t2.evidence.sets;
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assert(rej.some((x) => /citable co-change edge/.test(x)),
    `a T2 member entered the surface on vibes:\n${rej.join('\n')}`);
});

test('anchor holds the expansion to exactly one round when P2 is available', () => {
  const ctx = fakeCtx({ stage: 'anchor' });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  art.expansion.rounds = 0;
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assert(rej.some((x) => /One round exactly/.test(x)),
    `an expansion that never ran passed as a degraded truth without declaring viaP2:false:\n${rej.join('\n')}`);
});

test('anchor apply packs small tables into one area, demotes neighbour-only T2 members, and mints the process candidate', () => {
  const ctx = fakeCtx({ stage: 'anchor', state: { queue: {} } });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  const applied = ANCHOR_STAGE.apply(ctx, art);
  const q = applied.queue;
  // Every table in the example holds fewer than ANCHOR_AREA_MIN records: ONE packed area, not one per table.
  // Run pilot-run-6 cast 51 areas of which 30 held three records or fewer — a ~9k-token brief each.
  assertEqual(q.harvestAreas.length, 1, `small tables were not packed: ${JSON.stringify(q.harvestAreas)}`);
  const detail = q.harvestAreaDetail[0];
  assertEqual(detail.id, 'proc-pack-1');
  assertEqual(detail.population, 'anchor', 'anchor areas must declare their population so the harvest brief takes the sys_id leg');
  assertEqual(detail.tables.length, 4, `the pack does not carry every admitted table: ${detail.tables.join(',')}`);
  assert(detail.targetsByTable && Object.keys(detail.targetsByTable).length === 4, 'a packed area must say which ids belong to which table');
  assert(Array.isArray(detail.targets) && detail.targets.length === detail.targetsTotal, 'an anchor area\'s targets and targetsTotal disagree');
  // The sys_ui_section member is admitted ONLY through the overlap-1 set: demoted, recorded, not queued.
  assertEqual(detail.targets.includes('9ec847db1b8a43909e2aa934604bcb46'), false, 'a neighbour-only T2 member entered the harvest queue');
  assertEqual(applied.facts.anchor.neighbourGaps.length, 1, 'the demoted member was not recorded as a neighbour gap');
  assert(applied.findings.some((f) => f.check === 'anchor-neighbour-demoted'), 'demotion happened silently');
  assertEqual(applied.facts.anchor.surfaceCounts.setsDemoted, 1);
  assertEqual(q.processCandidates.length, 1, 'the seeded process did not become the Gate 1 candidate');
  assertEqual(q.processCandidates[0].signal, 'update-set-comembership');
  assert(!q.processCandidates[0].updateSets.some((n) => /Form \+ columns/.test(n)), 'a demoted set is still listed on the process candidate');
  assertEqual(applied.stamps.anchorExpansion, 'co-change');
});

test('anchor apply gives a large table its own area first, and packs the rest by size', () => {
  const ctx = fakeCtx({ stage: 'anchor', state: { queue: {} } });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  const big = art.sets.find((s) => s.role === 'seeded').sysId;
  for (let i = 0; i < stages.ANCHOR_AREA_MIN + 2; i += 1) {
    art.surface.push({ table: 'x_acme_field_map', sysId: `aa${String(i).padStart(30, '0')}`, name: `map ${i}`, tier: 'T1', evidence: { kind: 'named', sets: [big] } });
  }
  const q = ANCHOR_STAGE.apply(ctx, art).queue;
  assertEqual(q.harvestAreas[0], 'proc-x-acme-field-map', `the large table did not come first: ${q.harvestAreas.join(',')}`);
  assertEqual(q.harvestAreaDetail[0].tables.length, 1, 'a large table was packed with others');
  assertEqual(q.harvestAreas.length, 2, `expected one large area plus one pack: ${q.harvestAreas.join(',')}`);
});

test('anchor keeps a recovered set on story root even at low overlap, and demotes a large neighbour even at overlap >= 2', () => {
  const ctx = fakeCtx({ stage: 'anchor', state: { queue: {}, stamps: { storyPattern: '^(STRY\\d{7})(\\.\\d{2})?' } } });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  // pilot-run-7's "unsafe-situation catalog": 162 members, overlap 2 — absolute overlap passed it, ratio must not.
  art.sets.push({ sysId: 'fb060e8e1b2a43909e2aa934604bcb11', name: 'STRY0100004.00 - unsafe-situation catalog: gegevens verwerken', members: 162, role: 'recovered', via: 'version-chain', story: 'STRY0100004', seededOverlap: 2 });
  art.surface.push({ table: 'item_option_new', sysId: '9ec847db1b8a43909e2aa934604bcb99', name: 'locatie', tier: 'T2', evidence: { kind: 'co-shipped', sets: ['fb060e8e1b2a43909e2aa934604bcb11'], weight: 0.006 } });
  const applied = ANCHOR_STAGE.apply(ctx, art);
  const queued = new Set(applied.queue.harvestAreaDetail.flatMap((d) => d.targets));
  assertEqual(queued.has('9ec847db1b8a43909e2aa934604bcb99'), false, 'a 162-member neighbour with overlap 2 still reached the harvest queue — the absolute-overlap defect from pilot-run-7');
  assertEqual(queued.has('9ec847db1b8a43909e2aa934604bcb45'), true, 'a recovered set with 7 of 12 members seeded was demoted');
  const names = applied.queue.processCandidates[0].updateSets;
  assert(names.some((n) => /STRY0185005\.03/.test(n)), `the .03 sub-set sharing the seeded story root was demoted: ${names.join(', ')}`);
  assert(!names.some((n) => /Onveilige/.test(n)), 'the neighbour is listed on the process candidate');
  assertEqual(applied.facts.anchor.surfaceCounts.setsDemoted, 2, `expected the form-design set and the catalog set demoted: ${JSON.stringify(applied.facts.anchor.surfaceCounts)}`);
});

test('anchor refuses a recovered set that does not report its seeded overlap', () => {
  const ctx = fakeCtx({ stage: 'anchor' });
  const art = JSON.parse(JSON.stringify(ANCHOR_STAGE.example(ctx)));
  delete art.sets.find((s) => s.role === 'recovered').seededOverlap;
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assert(rej.some((x) => /seededOverlap/.test(x)), `a recovered set with no overlap count was accepted, so nothing can demote a neighbour:\n${rej.join('\n')}`);
});

test('the harvest brief sizes an anchor area in named sys_ids and carries the depth doctrine', () => {
  const q = { harvestAreas: ['proc-sys-script'], harvestDone: [], harvestAreaDetail: [{
    id: 'proc-sys-script', tables: ['sys_script'], population: 'anchor',
    targets: ['9ec847db1b8a43909e2aa934604bcb42'], targetsTotal: 1, t1: 1, t2: 0,
    why: 'the seeded process surface on sys_script',
  }] };
  const goal = HARVEST_STAGE.goal({ state: { queue: q } });
  assertIncludes(goal, 'SEEDED PROCESS SURFACE', 'the brief sized an anchor area as a census stratum');
  assertEqual(/undefined/.test(goal), false, `the brief printed an undefined size:\n${goal}`);
  const legs = HARVEST_STAGE.procedure({ state: { queue: q, config: {} } }).join('\n');
  assertIncludes(legs, 'THE SYS_IDS ARE THE QUERY', 'the anchor leg did not reach the procedure');
  assertIncludes(legs, 'ABSENCE CLAIM', 'a dangling update-set target would strand the stagnation breaker at the end of the queue');
});

test('anchor resolution failure is a recorded stop-and-ask, and next() blocks rather than widening', () => {
  const ctx = fakeCtx({ stage: 'anchor' });
  const art = {
    stage: 'anchor', instance: 'selftest-instance', usage: { apiCalls: 4 },
    resolutionFailed: true,
    resolution: [{ pointer: 'ACME cancel flow (as remembered)', kind: 'update-set', resolved: false, evidence: 'no sys_update_set row matches, exact or STARTSWITH; canary read returned rows in the same session' }],
    sets: [], expansion: { rounds: 0, viaP2: true, viaP4: true }, surface: [],
    adequacy: { verdict: 'barren', why: 'nothing resolved; there is nothing to judge' },
    findings: [{ check: 'anchor-resolution-failed', severity: 'blocking', rung: 'L1', message: 'no seeded pointer resolved to a non-empty update set; the developer must re-aim the seed' }],
    acceptance: [{ id: 'AC-ANC-1', result: 'fail', evidence: 'nothing resolved' }],
  };
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assertEqual(rej.join('\n'), '', `a legal stop-and-ask artifact was rejected:\n${rej.join('\n')}`);
  const applied = ANCHOR_STAGE.apply(ctx, art);
  assertEqual(applied.stamps.anchorExpansion, 'resolution-failed');
  const route = ANCHOR_STAGE.next({ state: { stamps: { anchorExpansion: 'resolution-failed' } } });
  assert(route && route.terminal === 'blocked',
    'a failed resolution routed onward — a seeded run that quietly widens is a census with extra steps');
});

// ---------------------------------------------------------------------------
// drive.js — the harness-independent driver. Fresh context per stage is structural
// because the worker's ENTIRE prompt is the brief file; these pin the seams.
// ---------------------------------------------------------------------------

const drive = require('./drive.js');

test('drive: the worker prompt is one line with no double quotes, so it survives a Windows shell', () => {
  const p = drive.workerPrompt('C:\\eng\\root', 'C:\\eng\\root\\.brain\\briefs\\seed-01.md', { stage: 'seed' });
  assertEqual(/[\n"]/.test(p), false, `prompt carries a newline or a double quote:\n${p}`);
  assertIncludes(p, '.brain/briefs/seed-01.md', 'the prompt does not name the brief file');
  assertIncludes(p, 'stage seed');
});

test('drive: presets resolve, and a repo config overrides or adds a runner', () => {
  assert(Array.isArray(drive.resolveRunner('copilot', {})), 'the copilot preset is gone');
  assert(Array.isArray(drive.resolveRunner('codex', {})), 'the codex preset is gone');
  assertEqual(drive.resolveRunner('nope', {}), null, 'an unknown runner resolved to something');
  assertEqual(drive.resolveRunner('copilot', { runners: { copilot: ['gh', 'copilot', '{prompt}'] } })[0], 'gh', 'a repo override did not win over the preset');
  assertEqual(drive.resolveRunner('mine', { runners: { mine: ['x', '{brief}'] } })[1], '{brief}');
});

test('drive: {model} is substituted per stage, and dropped WITH its flag when no model is set', () => {
  const s = { prompt: 'P', brief: 'B', root: 'R' };
  assertEqual(drive.buildArgs(drive.PRESETS.copilot, Object.assign({ model: null }, s)).join(' '), 'copilot -p P --allow-all-tools --no-ask-user',
    'a dangling --model flag with no value would make the CLI eat the next arg or error');
  assertEqual(drive.buildArgs(drive.PRESETS.copilot, Object.assign({ model: 'claude-opus-4.8' }, s)).slice(-2).join(' '), '--model claude-opus-4.8');
  assertEqual(drive.buildArgs(drive.PRESETS.codex, Object.assign({ model: null }, s)).includes('--config'), false, 'codex kept --config with nothing to configure');
  assertEqual(drive.buildArgs(drive.PRESETS.codex, Object.assign({ model: 'gpt-5.4' }, s)).includes('model=gpt-5.4'), true);
  const cfg = { models: { default: 'opus', stages: { harvest: 'sonnet' } } };
  assertEqual(drive.modelFor('harvest', cfg, null), 'sonnet');
  assertEqual(drive.modelFor('explain', cfg, null), 'opus');
  assertEqual(drive.modelFor('harvest', cfg, 'forced'), 'forced', '--model did not win over the per-stage map');
  assertEqual(drive.modelFor('harvest', {}, null), null);
});

test('drive: usage is parsed from claude JSON and codex JSONL, and is null (not a crash) for copilot text', () => {
  const c = drive.parseUsage(JSON.stringify({ type: 'result', usage: { input_tokens: 5, cache_creation_input_tokens: 6, cache_read_input_tokens: 7, output_tokens: 8 }, total_cost_usd: 0.42, num_turns: 3 }));
  assertEqual(JSON.stringify([c.input, c.cacheWrite, c.cacheRead, c.output, c.costUsd, c.turns]), '[5,6,7,8,0.42,3]');
  const x = drive.parseUsage('{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":90,"output_tokens":10}}\n');
  assertEqual(JSON.stringify([x.input, x.cacheRead, x.output]), '[100,90,10]');
  assertEqual(drive.parseUsage('plain text from copilot -s'), null);
  assertEqual(drive.parseUsage(''), null);
});

test('drive: dry-run composes every stage brief outside a run and prices it', () => {
  const root = scratchRepo('drive-dry');
  const r = spawnSyncNode([path.join(__dirname, 'drive.js'), 'dry-run', '--root', root]);
  assertEqual(r.status, 0, `dry-run failed:\n${r.stdout}${r.stderr}`);
  for (const id of STAGE_ORDER) { assertIncludes(r.stdout, `  ${id}`, `dry-run did not price stage "${id}"`); }
  assertEqual(/could not compose/.test(r.stdout), false, `a stage brief cannot be composed outside a run:\n${r.stdout}`);
  assertIncludes(r.stdout, 'tokens of BRIEF');
});

function spawnSyncNode(args) {
  const r = require('child_process').spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ===========================================================================
// X — the findings response of 2026-09-02. One test per finding, built from the
//     neutralised fixture of the second engagement's run (ACMEIT / PayVault /
//     CompliTool, work items 7067366 7166178 6713057 7218301) and from what the
//     first run (pilot-run-8) actually shipped.
// ===========================================================================

group('X. findings response 2026-09-02');

const handoffLib = require('./lib/handoff.js');
const pagesLib = require('./lib/pages.js');
const vocabLib = require('./lib/vocabulary.js');
const renderKernelJs = path.join(FRAMEWORK_ROOT, 'tools', 'render-kernel.js');

/** An orientation artifact with the given conventions and recall topics lifted from one verbatim answer. */
function orientationWith(conventions, topics, verbatim) {
  return {
    stage: 'orientation', instance: 'selftest-instance', usage: { apiCalls: 0 },
    available: true, respondent: 'a.developer', recordedAt: '2026-08-31',
    boundaryAsStated: stages.INSTANCE_WIDE_BOUNDARY,
    conventions, documents: [],
    tracker: { kind: 'azure-devops', org: 'acme', project: 'ACMEIT', storiesLiveIn: 'external' },
    recall: { recordedAt: '2026-08-31', respondent: 'a.developer', blind: true, contamination: 'none', prompts: [{ prompt: 'What is deliberate here?', verbatim }], topics },
    acceptance: [
      { id: 'AC-ORI-1', result: 'pass', evidence: 'apiCalls 0' }, { id: 'AC-ORI-2', result: 'pass', evidence: 'no documents' },
      { id: 'AC-ORI-3', result: 'pass', evidence: 'external' }, { id: 'AC-ORI-4', result: 'pass', evidence: 'spans verbatim' },
    ],
  };
}

test('F5: one answer through both mint paths yields its two atoms, never the umbrella as well', () => {
  const { root, syncRoot } = startRun('f5-dedup');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const verbatim = 'flow designer is deliberate, decision tables too';
  const r = ingest(root, 'orientation', orientationWith(
    [{ kind: 'prior-decisions', statement: verbatim, testable: false }],
    [{ term: 'flow designer', statement: 'Flow Designer was chosen deliberately.', span: 'flow designer is deliberate' },
      { term: 'decision tables', statement: 'Decision tables were chosen deliberately.', span: 'decision tables too' }],
    verbatim));
  assertEqual(r.json.accepted, true, `orientation rejected: ${JSON.stringify(r.json.rejected)}`);
  const decs = stateLib.readJsonl(path.join(root, '.brain', 'decisions.jsonl'));
  assertEqual(decs.length, 2, `one human sentence minted ${decs.length} decision(s): ${decs.map((d) => d.statement).join(' | ')} — the umbrella and its halves both counted on the second engagement`);
  assert(decs.every((d) => d.answerProvenance && d.answerProvenance.sourceAnswer), 'a decision carries no sourceAnswer id');
  assertEqual(new Set(decs.map((d) => d.answerProvenance.sourceAnswer)).size, 1, 'the two atoms do not share the source-answer id of the sentence they came from');
  assert(decs.every((d) => d.answerProvenance.splitFrom === verbatim), 'an atom does not record the verbatim umbrella it was split from');
  assert(decs.every((d) => d.linkage === 'bound' && d.witnessClaims.length), 'the atoms did not inherit the convention\'s witness claim');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.facts.orientation.decisionsCollapsed, 1, 'the split was not recorded in facts');
  assertEqual(st.facts.orientation.decisionSplits[0].kind, 'umbrella-convention');
  // The convention itself still stands as a stated convention and a DOC claim (conventions.md, the gates).
  assertEqual(st.queue.statedConventions.length, 1, 'suppressing the umbrella DECISION must not drop the stated convention');
});

test('F5: a convention alone mints one; a recall topic equal to the convention is a duplicate, not a second decision', () => {
  const { root, syncRoot } = startRun('f5-dup');
  ingest(root, 'preflight', preflightArtifact(root, syncRoot));
  const verbatim = 'we never use classic workspace';
  ingest(root, 'orientation', orientationWith(
    [{ kind: 'prior-decisions', statement: verbatim, testable: false }],
    [{ term: 'workspace', statement: 'Classic workspace is never used.', span: verbatim }],
    verbatim));
  const decs = stateLib.readJsonl(path.join(root, '.brain', 'decisions.jsonl'));
  assertEqual(decs.length, 1, `a topic quoting the whole convention minted a second decision: ${decs.map((d) => d.statement).join(' | ')}`);
  assertEqual(decs[0].derivedFrom, 'stated', 'the convention\'s decision (the one with a witness) should be the survivor');
});

test('F9: the kernel template has no HTML-comment slot, and the renderer refuses one', () => {
  const tpl = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'kernel', 'CLAUDE.template.md'), 'utf8');
  assert(!/<!--\s*SLOT:/.test(tpl), 'kernel/CLAUDE.template.md still carries a <!-- SLOT: --> comment');
  assert(!/\.\.\/INTERVIEW\.md/.test(tpl), 'F11: the template still routes to docs/wiki/../INTERVIEW.md');
  const rk = require(renderKernelJs);
  const d = rk.derivedSlots({ language: { source: 'en', targets: ['nl'] } });
  assertIncludes(d['policy.languageLine'], 'EN+NL', 'the configured targets did not render into the language policy');
  assertIncludes(d['policy.platformLine'], 'Not established', 'a missing platform policy is not rendered as an attributed "not established"');
  assertIncludes(d['policy.platformLine'], 'render-kernel.js', 'the "not established" statement is not attributed');
  const typed = rk.derivedSlots({ policy: { platform: ['configurable workspace only — classic Agent Workspace (sys_aw_*) is banned'] } });
  assertIncludes(typed['policy.platformLine'], 'sys_aw_*', 'a typed platform rule did not render');
  // A template that smuggles a SLOT comment back in is refused at render time.
  const root = scratchRepo('f9-slot');
  putFile(root, 'kernel/CLAUDE.template.md', '# k\n\n<!-- SLOT: language policy -->\n');
  putFile(root, 'product.config.json', '{}');
  putFile(root, 'tools/render-kernel.js', fs.readFileSync(renderKernelJs, 'utf8'));
  const r = spawnSyncNode([path.join(root, 'tools', 'render-kernel.js'), '--root', root]);
  assertEqual(r.status, 1, 'a SLOT comment in the rendered kernel was written');
  assertIncludes(r.stderr, 'HTML-comment slot', 'the refusal does not name the slot');
});

test('F11: render-kernel refuses a route to a missing page, writes three identical mirrors otherwise', () => {
  const root = scratchRepo('f11-routes');
  putFile(root, 'kernel/CLAUDE.template.md', '# k\n\n| Need | Open |\n|---|---|\n| Questions | `{{paths.wikiRoot}}/INTERVIEW.md` |\n| Stories | `{{paths.wikiRoot}}/stories/<story>.md` |\n');
  putFile(root, 'product.config.json', JSON.stringify({ paths: { wikiRoot: 'docs/wiki' } }));
  putFile(root, 'tools/render-kernel.js', fs.readFileSync(renderKernelJs, 'utf8'));
  const r1 = spawnSyncNode([path.join(root, 'tools', 'render-kernel.js'), '--root', root]);
  assertEqual(r1.status, 1, 'a kernel routing to a page that does not exist was written');
  assertIncludes(r1.stderr, 'docs/wiki/INTERVIEW.md', 'the refusal does not name the dangling route');
  putFile(root, 'docs/wiki/INTERVIEW.md', '# i\n');
  fs.mkdirSync(path.join(root, 'docs', 'wiki', 'stories'), { recursive: true });
  const r2 = spawnSyncNode([path.join(root, 'tools', 'render-kernel.js'), '--root', root]);
  assertEqual(r2.status, 0, `render-kernel still refuses with the routes present:\n${r2.stderr}`);
  const a = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assertEqual(fs.readFileSync(path.join(root, '.github', 'copilot-instructions.md'), 'utf8'), a, 'the Copilot mirror differs');
  assertEqual(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), a, 'F13: the Codex mirror AGENTS.md is missing or differs');
  // The export screen catches a route that dangles in the SHIPPED tree even when render passed.
  const problems = handoffLib.kernelRouteProblems(root, 'CLAUDE.md');
  assertEqual(problems.length, 0);
  fs.unlinkSync(path.join(root, 'docs', 'wiki', 'INTERVIEW.md'));
  assertEqual(handoffLib.kernelRouteProblems(root, 'CLAUDE.md').length, 1, 'deleting the routed page did not make the route check fail');
});

test('F8: placeholders are legal in _TEMPLATE.md and refused in a live page, by name and line', () => {
  const root = scratchRepo('f8-scan');
  const text = '---\ntitle: x\nlast-verified: <fill at engagement>\n---\n\n| Story / set | dev |\n|---|---|\n| STRY0000001.00 — DELETE-ME example | built |\n\n## Status: <open / interview scheduled <date> / answers being executed>\n';
  putFile(root, 'docs/wiki/stories/_TEMPLATE.md', text);
  putFile(root, 'docs/wiki/INTERVIEW.md', text);
  putFile(root, 'docs/wiki/deployment-matrix.md', text);
  const scan = handoffLib.scanPlaceholders(root, handoffLib.listFiles(root, 'docs/wiki'));
  assertEqual(scan.templatesExempt, 1, 'the template was not exempted');
  assert(scan.hits.every((h) => h.path !== 'docs/wiki/stories/_TEMPLATE.md'), 'a template placeholder was reported');
  assert(scan.hits.some((h) => h.path === 'docs/wiki/INTERVIEW.md' && h.what === 'unselected status alternatives'), 'the INTERVIEW status placeholder was not caught');
  assert(scan.hits.some((h) => h.path === 'docs/wiki/deployment-matrix.md' && h.what === 'scaffold example row'), 'the DELETE-ME row was not caught');
  assert(scan.hits.some((h) => h.what === 'scaffold fill marker' && h.line === 3), 'the fill marker was not caught at its line');
  const described = handoffLib.describePlaceholders(scan);
  assertIncludes(described, 'INTERVIEW.md', 'the rejection does not name the file');
  // The same scan is what render.validate runs: a live-page placeholder is a rejection there.
  const { ctx, art } = renderCtx('f8-validate', FULL_PERSONAS);
  putFile(ctx.brain.root, 'docs/wiki/tbd.md', '| TBD-000 | STRY0000001 | DELETE-ME example |\n');
  const rej = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(rej.filter((m) => /placeholder\(s\) survive/.test(m)).length, 1, `render.validate did not refuse the live-page placeholder:\n${rej.join('\n')}`);
});

test('F8: the instantiated scaffold carries no placeholder in a live page, and fills the dates from the run', () => {
  const root = scratchRepo('f8-scaffold');
  const brain = Brain.init({ root, instance: 'selftest-instance', stageOrder: STAGE_ORDER });
  brain.state.stamps.processName = 'ACMEIT - HR Onboarding Checklist'; brain.save('stamp');
  putFile(root, 'product.config.json', JSON.stringify({ paths: { wikiRoot: 'docs/wiki' }, language: { source: 'en', targets: ['nl'] }, naming: { storySetFormat: 'ACMEIT_IP<NN>_S<N>_<workitem>' } }));
  fs.rmSync(path.join(root, 'docs', 'wiki'), { recursive: true, force: true });
  const r = pagesLib.scaffoldWiki(root, { date: '2026-09-02' });
  assert(r.written.length >= 14, `only ${r.written.length} scaffold page(s) instantiated`);
  const scan = handoffLib.scanPlaceholders(root, handoffLib.listFiles(root, 'docs/wiki'));
  assertEqual(scan.hits.length, 0, `the instantiated scaffold still carries placeholders in live pages: ${JSON.stringify(scan.hits.slice(0, 5))}`);
  const contract = fs.readFileSync(path.join(root, 'docs', 'wiki', 'CONTRACT.md'), 'utf8');
  assertIncludes(contract, 'last-verified: 2026-09-02', 'the verification date was not filled from run metadata');
  assertIncludes(contract, 'EN+NL', 'the language policy line was not derived from the config');
  const tpl = fs.readFileSync(path.join(root, 'docs', 'wiki', 'stories', '_TEMPLATE.md'), 'utf8');
  assertIncludes(tpl, 'ACMEIT_IP<NN>_S<N>_<workitem>', 'F7: the story template is not parameterised from naming.storySetFormat');
  assert(!/STRY0000000/.test(tpl), 'F7: the story template still carries the generic STRY example');
  assertIncludes(fs.readFileSync(path.join(root, 'docs', 'wiki', 'index.md'), 'utf8'), 'ACMEIT - HR Onboarding Checklist', 'the index title is not the process name');
  // Idempotent: a second run keeps every rendered page.
  const again = pagesLib.scaffoldWiki(root, { date: '2026-09-03' });
  assertEqual(again.written.length, 0, 'a re-run overwrote rendered pages');
  /*
   * And --force keeps the GENERATED ones. Measured while replaying the fix on pilot-run-8:
   * `--scaffold --force`, run to clear CONTRACT.md's `<fill at engagement>`, overwrote the
   * generated glossary with the empty scaffold — reintroducing the very finding the glossary
   * generator closes. A page carrying the accounting key is the run's output, not scaffold.
   */
  putFile(root, 'docs/wiki/glossary.md', '---\ntitle: "Glossary"\nstatus: "verified"\nclaims-rendered: 3\n---\n\n| Term | Meaning |\n|---|---|\n| **PayVault** | the payslip environment |\n');
  const forced = pagesLib.scaffoldWiki(root, { date: '2026-09-03', force: true });
  assertIncludes(forced.kept.join(','), 'glossary.md', '--force did not keep the generated glossary');
  assertIncludes(fs.readFileSync(path.join(root, 'docs', 'wiki', 'glossary.md'), 'utf8'), 'PayVault', '--force overwrote a generated page with the scaffold');
  assert(forced.written.some((p) => /CONTRACT\.md$/.test(p)), '--force did not re-instantiate the ungenerated governance page');
});

/** The neutralised MyIT fixture as a brain: seed pointers, anchor sets, claims, vocabulary questions and decisions. */
function acmeitBrain(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'acmedev', stageOrder: STAGE_ORDER });
  const sets = [
    { sysId: 'a1'.padEnd(32, '1'), name: 'ACMEIT_IP19_S3_7067366', members: 12, role: 'seeded', via: 'pointer' },
    { sysId: 'a2'.padEnd(32, '2'), name: 'ACMEIT_IP19_S3_7067366 UI messages', members: 4, role: 'seeded', via: 'pointer' },
    { sysId: 'a3'.padEnd(32, '3'), name: 'ACMEIT_IP19_S3_7166178', members: 9, role: 'seeded', via: 'pointer' },
    { sysId: 'a4'.padEnd(32, '4'), name: 'ACMEIT_IP18_S5_6713057', members: 95, role: 'seeded', via: 'pointer' },
    { sysId: 'a5'.padEnd(32, '5'), name: 'ACMEIT_IP19_S3_7218301', members: 7, role: 'seeded', via: 'pointer' },
  ];
  brain.state.stamps.processName = 'ACMEIT - HR Onboarding Checklist';
  brain.state.stamps.seed = 'provided'; brain.state.stamps.inputEnvelope = 'sets+stories'; brain.state.stamps.storyPattern = null;
  brain.state.queue.seedPointers = [
    { kind: 'story', value: '7067366 Add extra tasks to the HR onboarding checklist', confidence: 'certain', url: 'https://dev.azure.com/acme/ACMEIT/_workitems/edit/7067366' },
    { kind: 'story', value: '7166178 HR Onboarding checklist fixes', confidence: 'certain' },
    { kind: 'story', value: '6713057 Follow-up HR Onboarding Hackweek', confidence: 'certain' },
    { kind: 'story', value: '7218301 Expand query onboarding checklist', confidence: 'certain' },
    { kind: 'update-set', value: 'ACMEIT_IP19_S3_7067366', confidence: 'certain' },
  ];
  brain.state.facts.anchor = { sets, resolution: [] };
  brain.state.facts.tracker = { kind: 'azure-devops', org: 'acme', project: 'ACMEIT', storiesLiveIn: 'external' };
  brain.save('fixture');
  const claim = (i, name, setIdx) => ({
    locus: { table: 'sys_script', sysId: `c${i}`.padEnd(32, '0'), key: name }, assertion: 'active = true', band: 'A', status: 'verified',
    evidence: { capturedResponse: { name } }, provenance: { updateSets: [{ sysId: sets[setIdx].sysId, name: sets[setIdx].name }] },
  });
  brain.upsertClaims([
    claim(1, 'HR Onboarding Tasks — PayVault link', 0), claim(2, 'HR Onboarding Tasks — CompliTool state', 0), claim(3, 'Onboarding checklist UI messages', 1),
    claim(4, 'Onboarding Tasks fix', 2), claim(5, 'Hackweek onboarding query', 3), claim(6, 'Expand onboarding query', 4), claim(7, 'PayVault Tasks reminder', 3),
  ], { stage: 'harvest' });
  const ids = [...brain.claims().values()].map((c) => c.id);
  brain.upsertQuestions([
    { id: 'Q-aaaaaaaaaaa1', __cliAllocated: true, signal: 'V', gate: 'register-gap', status: 'answered', locus: [{ sysId: 'c1' }], question: "The word 'ACMEIT' prefixes every set and 40 records — what does it stand for?" },
    { id: 'Q-aaaaaaaaaaa2', __cliAllocated: true, signal: 'V', gate: 'register-gap', status: 'answered', locus: [{ sysId: 'c1' }], question: "'PayVault' appears on the Onboarding Tasks records and in the reminder — what is it?" },
    { id: 'Q-aaaaaaaaaaa3', __cliAllocated: true, signal: 'V', gate: 'register-gap', status: 'answered', locus: [{ sysId: 'c2' }], question: "'CompliTool' is written to by the Tasks — what is it, and who owns it?", term: 'CompliTool' },
  ]);
  const dec = (q, statement, extra) => Object.assign({}, DEC_BASE, { statement, derivedFrom: 'interview', witnessClaims: [ids[0]], answeredBy: 'b.developer', answeredAt: '2026-08-31',
    answerProvenance: Object.assign({}, DEC_BASE.answerProvenance, { fromQuestion: q, verbatim: statement }), tier: 'confirmed', linkage: 'bound' }, extra || {});
  brain.upsertDecisions([
    dec('Q-aaaaaaaaaaa1', 'ACMEIT means Acme Information Technology: the team responsible for portal front-end/back-end activity and the HRSD scope.', { canonicalTerm: 'ACMEIT' }),
    dec('Q-aaaaaaaaaaa2', 'PayVault is a personal environment for payslips and other personal information that stays accessible after leaving the company.', { aliases: ['pay vault'] }),
    dec('Q-aaaaaaaaaaa3', 'CompliTool is the compliance tool where managers or HR record relevant states for new employees.'),
  ]);
  putFile(root, 'product.config.json', JSON.stringify({ paths: { wikiRoot: 'docs/wiki' }, naming: { storySetFormat: 'ACMEIT_IP<NN>_S<N>_<workitem>' } }));
  return { root, brain, sets, ids };
}

test('F6/F10: the vocabulary model keys every definition to its own term, and nothing else', () => {
  const { root } = acmeitBrain('f6-model');
  const model = vocabLib.buildVocabularyModel(root);
  assertEqual(model.terms.map((t) => t.canonicalTerm).join(','), 'ACMEIT,CompliTool,PayVault', 'the three confirmed terms are not the model');
  assertEqual(model.unresolvable.length, 0, 'a decision keyed by the question\'s quoted word was reported unkeyable');
  assertEqual(model.lookup('PayVault').decisionNum, 'DEC-002');
  assertEqual(model.lookup('pay vault').canonicalTerm, 'PayVault', 'a declared alias does not join');
  assertEqual(model.lookup('Onboarding'), null, 'F10: "Onboarding" borrowed a definition by co-occurrence');
  assertEqual(model.lookup('Tasks'), null, 'F10: "Tasks" borrowed a definition by co-occurrence');
  assert(model.unmatched.some((v) => v.token === 'onboarding'), 'the undefined frequent token is not listed as unexpanded');
  const facts = kernelfacts.buildKernelFacts(root);
  const lines = facts.facts.vocabulary.section.split('\n');
  const payLine = lines.find((l) => /\*\*PayVault\*\*/.test(l)) || '';
  assertIncludes(payLine, 'payslips', 'the PayVault definition did not reach the kernel');
  assertIncludes(payLine, 'DEC-002', 'the kernel line does not cite the DEC number');
  const onboardingLine = lines.find((l) => /\*\*Onboarding\*\*/i.test(l)) || '';
  assertIncludes(onboardingLine, 'unexpanded', 'F10: the kernel expanded "Onboarding" with someone else\'s definition');
  assert(!/payslips/.test(onboardingLine) && !/compliance tool/.test(onboardingLine), 'F10: a definition leaked onto the Onboarding line');
});

test('F6: glossary.md renders from the same model, cites the decisions, and render.validate demands it', () => {
  const { root } = acmeitBrain('f6-glossary');
  const built = renderLib.buildGlossaryPage(root, { wiki: 'docs/wiki' });
  assertEqual(built.rejections.length, 0, built.rejections.join('\n'));
  for (const term of ['ACMEIT', 'PayVault', 'CompliTool']) { assertIncludes(built.page.body, `**${term}**`, `${term} is not in the glossary`); }
  assertIncludes(built.page.body, 'DEC-003', 'the glossary does not cite the decision number');
  assertIncludes(built.page.body, 'b.developer', 'the glossary does not attribute the confirmation');
  assert(!/\|\s*\|\s*\|/.test(built.page.body), 'the glossary carries a blank table row');
  assert(!/fill at engagement/.test(built.page.body), 'the glossary carries the scaffold marker');
  assertIncludes(built.page.body, '*Onboarding*', 'the undefined frequent token is not listed as a gap');
  assertEqual(built.page.claimIds.length, 1, 'the glossary does not declare the anchor claim it prints');
  // render.validate: vocabulary exists and no glossary page is declared -> rejected; the empty scaffold -> rejected.
  const brain = Brain.open(root);
  const ctx = { brain, state: brain.state, stage: 'render' };
  putFile(root, 'CLAUDE.md', '# k\n'); putFile(root, '.claude/settings.json', '{}');
  const art = { pages: [], kernel: { path: 'CLAUDE.md', routingEntries: 1 }, settings: { path: '.claude/settings.json', hooks: ['x'] } };
  const rej1 = STAGE_BY_ID.get('render').validate(ctx, art);
  assert(rej1.some((m) => /no glossary\.md page is declared/.test(m)), `confirmed vocabulary with no glossary page was accepted:\n${rej1.join('\n')}`);
  putFile(root, 'docs/wiki/glossary.md', fs.readFileSync(path.join(FRAMEWORK_ROOT, 'wiki-scaffold', 'glossary.md'), 'utf8').replace(/<fill at engagement>/g, '2026-09-02'));
  art.pages.push({ path: 'docs/wiki/glossary.md', status: 'draft', rendersClaims: [] });
  const rej2 = STAGE_BY_ID.get('render').validate(ctx, art);
  assert(rej2.some((m) => /does not name 3 of the 3 confirmed term/.test(m)), `the empty scaffold glossary was accepted:\n${rej2.join('\n')}`);
  renderLib.writeGlossaryPage(root, { wiki: 'docs/wiki' });
  art.pages[0].rendersClaims = built.page.claimIds; art.pages[0].status = built.page.status;
  const rej3 = STAGE_BY_ID.get('render').validate(ctx, art);
  assertEqual(rej3.filter((m) => /glossary/.test(m)).length, 0, `the generated glossary was refused:\n${rej3.join('\n')}`);
});

test('F10: a register-gap question with no quotable word is refused; a quoted one is stamped as `term`', () => {
  const ctx = questionsCtx('f10-term');
  const q = { signal: 'QS-V', signalState: 'admitted', gate: 'register-gap', sources: { A: { kind: 'claim', ref: 'x' } }, locus: [{ sysId: 'v1' }], form: 'open',
    question: 'This word prefixes forty records and looks like an acronym; what does it stand for?', rank: { E: 1, C_guard: 1, C_signal: 1, A: 1, U: 1, M: 1 } };
  const rej = QUESTIONS.validate(ctx, { questions: [q], suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} } });
  assert(rej.some((m) => /name no term/.test(m)), `a termless register-gap question was accepted:\n${rej.join('\n')}`);
  const q2 = Object.assign({}, q, { question: "'PayVault' appears on twelve records and nothing explains it; what is it?" });
  const rej2 = QUESTIONS.validate(ctx, { questions: [q2], suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} } });
  assertEqual(rej2.filter((m) => /name no term/.test(m)).length, 0);
  const applied = QUESTIONS.apply(ctx, { questions: [q2], suppressed: [], counts: { candidates: 1, afterGates: 1, perGateKills: {} } });
  assertEqual(applied.questions[0].term, 'PayVault', 'the CLI did not stamp the term on the question row');
});

test('F7: seeded work items become story pages paired to their sets by the shared id, with multiple sets per story', () => {
  const { root } = acmeitBrain('f7-stories');
  const built = pagesLib.writeStoryPages(root, { wiki: 'docs/wiki' });
  assertEqual(built.pages.length, 4, `expected four story pages, got ${built.pages.map((p) => p.path).join(', ')}`);
  const s7067366 = built.stories.find((s) => s.key === '7067366');
  assertEqual(s7067366.sets.length, 2, 'the story with a descriptive-suffix set did not keep both sets');
  assertIncludes(s7067366.sets.join('|'), 'UI messages');
  const s6713057 = built.stories.find((s) => s.key === '6713057');
  assertEqual(s6713057.sets[0], 'ACMEIT_IP18_S5_6713057', 'D5(b): the 95-member seeded set was not kept on its story');
  assertEqual(built.unpaired.length, 0, 'a seeded set paired to no story');
  for (const p of built.pages) {
    const body = fs.readFileSync(path.join(root, p.path), 'utf8');
    assert(!/STRY000000|DELETE-ME/.test(body), `${p.path} carries a generic scaffold example`);
    assertIncludes(body, 'Immutable build record', `${p.path} lacks the story-tier header`);
    assertEqual(renderLib.claimIdsIn(body).size, p.claimIds.length, `${p.path} does not declare the claim ids it prints`);
  }
  const matrix = fs.readFileSync(path.join(root, 'docs', 'wiki', 'deployment-matrix.md'), 'utf8');
  assertIncludes(matrix, 'ACMEIT_IP19_S3_7218301', 'the deployment matrix does not carry the seeded set');
  assertIncludes(matrix, 'UNKNOWN', 'environment state was asserted instead of marked unknown');
  assert(!/DELETE-ME|STRY0000001/.test(matrix), 'the deployment matrix keeps the scaffold example row');
  const index = pagesLib.buildIndexPage(root, { wiki: 'docs/wiki' });
  for (const p of built.pages) { assertIncludes(index.page.body, path.posix.basename(p.path), `index.md does not link ${p.path}`); }
  // A seeded set that pairs to nothing is a warning finding, not a silent drop.
  const brain = Brain.open(root);
  brain.state.facts.anchor.sets.push({ sysId: 'a6'.padEnd(32, '6'), name: 'ACMEIT_IP19_S3_hotfix', members: 3, role: 'seeded', via: 'pointer' });
  brain.save('unpaired');
  const rebuilt = pagesLib.buildStoryPages(root, { wiki: 'docs/wiki' });
  assertEqual(rebuilt.unpaired.length, 1, 'the unpaired seeded set was not reported');
  const ctx = { brain, state: brain.state, stage: 'render' };
  const art = { pages: rebuilt.pages.map((p) => ({ path: p.path, status: p.status, rendersClaims: p.claimIds })), kernel: { path: 'CLAUDE.md', routingEntries: 1 }, settings: { path: '.claude/settings.json', hooks: ['x'] } };
  putFile(root, 'CLAUDE.md', '# k\n'); putFile(root, '.claude/settings.json', '{}');
  const applied = STAGE_BY_ID.get('render').apply(ctx, art);
  assert(applied.findings.some((f) => f.check === 'story-set-unpaired' && f.severity === 'warning'), 'render.apply minted no unresolved-link finding');
  // render.validate demands the pages be declared.
  const rej = STAGE_BY_ID.get('render').validate(ctx, { pages: [], kernel: art.kernel, settings: art.settings });
  assert(rej.some((m) => /story page\(s\) the seed and the anchor determine are not declared/.test(m)), `undeclared story pages were accepted:\n${rej.join('\n')}`);
});

test('F12: the read-only proof is resolved from run state at a non-default path and copied to a stable name', () => {
  const root = scratchRepo('f12-proof');
  const brain = Brain.init({ root, instance: 'acmedev', stageOrder: STAGE_ORDER });
  const log = path.join(root, 'spikes', 'scriptsync-read-corrected', 'requests.ndjson');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const rows = [];
  for (let i = 0; i < 375; i += 1) {
    rows.push(JSON.stringify({ phase: 'sent', at: `2026-08-31T10:00:${String(i % 60).padStart(2, '0')}Z`, id: `r${i}`, command: 'rest_request', instance: 'acmedev', params: { endpoint: '/api/now/table/sys_script', method: 'GET' } }));
    rows.push(JSON.stringify({ phase: 'done', at: `2026-08-31T10:00:${String(i % 60).padStart(2, '0')}Z`, id: `r${i}`, command: 'rest_request', ok: true }));
  }
  fs.writeFileSync(log, rows.join('\n') + '\n');
  brain.state.facts.requestLog = { path: log.replace(/\\/g, '/'), lastSeenStage: 'verify', lastCount: 375 };
  brain.save('log');
  const built = pagesLib.writeReadOnlyProof(root, { wiki: 'docs/wiki' });
  assertEqual(built.rejections.length, 0, built.rejections.join('\n'));
  assertEqual(built.totals.calls, 375, 'the call count is not the log\'s');
  assertEqual(built.totals.writeShaped, 0);
  assert(fs.existsSync(path.join(root, 'docs', 'wiki', 'evidence', 'read-only-proof', 'snbrain-requests.ndjson')), 'the log was not copied to its stable name');
  assertIncludes(fs.readFileSync(path.join(root, 'docs', 'wiki', 'evidence', 'read-only-proof.md'), 'utf8'), '**375**');
  // Export REQUIRES the proof: without it, refused by name; with it, shipped.
  const { root: r2 } = exportFixture('f12-export-required');
  fs.rmSync(path.join(r2, 'docs', 'wiki', 'evidence'), { recursive: true, force: true });
  const to = path.join(SCRATCH, 'out-f12');
  const r = cli(['export', '--to', to, '--root', r2]);
  assert(r.code !== 0, 'an export with no read-only proof succeeded');
  assertIncludes(r.stderr, 'read-only-proof.md', 'the refusal does not name the missing proof');
});

test('a FORCED export does not report its own banner as a hand-edited mirror', () => {
  /*
   * Measured while building the A/B on pilot-run-8's ledger: --force stamps the
   * NOT-FIT-FOR-HANDOFF banner onto CLAUDE.md alone, and the mirror comparison then declared
   * both mirrors hand-edited — a check crying wolf exactly when the operator is already being
   * told the export is unfit.
   */
  const { root } = exportFixture('force-banner', null);
  const to = path.join(SCRATCH, 'out-force-banner');
  const r = cli(['export', '--to', to, '--root', root, '--force', '--by', 'a named operator', '--reason', 'showing a partial repo']);
  assertEqual(r.code, 0, `forced export failed:\n${r.stdout}${r.stderr}`);
  assertIncludes(fs.readFileSync(path.join(to, 'CLAUDE.md'), 'utf8'), 'NOT FIT FOR HANDOFF', 'the banner was not stamped');
  assertEqual(/FORCED PAST: kernel mirror/.test(r.stdout), false, `the banner was reported as mirror drift:\n${r.stdout}`);
});

test('F13: the export manifest hashes every file and names the three mirrors; verify-export fails on any drift', () => {
  const { root } = exportFixture('f13-manifest');
  const to = path.join(SCRATCH, 'out-f13');
  const r = cli(['export', '--to', to, '--root', root]);
  assertEqual(r.code, 0, `export failed:\n${r.stdout}${r.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(to, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert(Array.isArray(manifest.files) && manifest.files.length > 5, 'the manifest carries no per-file list');
  assert(manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && typeof f.bytes === 'number'), 'a file row lacks a sha256 or size');
  assertEqual(manifest.kernels.join(','), 'CLAUDE.md,.github/copilot-instructions.md,AGENTS.md', 'the three kernel mirrors are not listed');
  assert(manifest.generator && manifest.generator.name, 'no generator identity');
  assertEqual(cli(['verify-export', '--dir', to]).code, 0, 'a clean export does not verify against its own manifest');
  fs.appendFileSync(path.join(to, 'CLAUDE.md'), '\nhand edit\n');
  const v1 = cli(['verify-export', '--dir', to]);
  assertEqual(v1.code, 1, 'a modified kernel verified clean');
  assertIncludes(v1.stdout, 'modified since export (1): CLAUDE.md', 'the drift is not named');
  fs.writeFileSync(path.join(to, 'EXTRA.md'), 'x');
  fs.unlinkSync(path.join(to, 'AGENTS.md'));
  const v2 = cli(['verify-export', '--dir', to]);
  assertIncludes(v2.stdout, 'added since export (1): EXTRA.md');
  assertIncludes(v2.stdout, 'deleted since export (1): AGENTS.md');
});

test('D5(a): the membership-discrimination kill is deferred on a seedable run, fatal under --blind and when the seed is unavailable', () => {
  const { root, syncRoot } = startRun('d5a-deferred');
  const r = ingest(root, 'preflight', preflightArtifact(root, syncRoot, { kills: [11], a3Dead: [11] }));
  assertEqual(r.json.accepted, true, `preflight rejected: ${JSON.stringify(r.json.rejected)}`);
  assertEqual(r.json.terminal, null, 'the deferrable kill blocked the run before the seed door — the second engagement\'s exact route');
  assertEqual(r.json.nextStage, 'orientation');
  const st = JSON.parse(fs.readFileSync(path.join(root, '.brain', 'state.json'), 'utf8'));
  assertEqual(st.stamps.authorshipRung, 'package-level-only', 'the deferred kill left no stamp');
  assert(r.json.findings.some((f) => f.check === 'wp-a-kill-11-deferred' && f.severity === 'warning'), 'no warning finding was minted');
  // Another kill is still fatal at preflight.
  const { root: r2, syncRoot: s2 } = startRun('d5a-fatal');
  assertEqual(ingest(r2, 'preflight', preflightArtifact(r2, s2, { kills: [2] })).json.terminal, 'blocked', 'a non-deferrable kill stopped being fatal');
  // --blind takes the census path: the deferrable kill is fatal there.
  const { root: r3, syncRoot: s3 } = startRun('d5a-blind', ['--blind']);
  assertEqual(ingest(r3, 'preflight', preflightArtifact(r3, s3, { kills: [11], a3Dead: [11] })).json.terminal, 'blocked', 'a blind run survived a kill the census cannot');
  // The seed turns out unavailable: the seed door re-raises it as blocking and the route terminates.
  ingest(root, 'orientation', orientationArtifact());
  const seed = { stage: 'seed', instance: 'selftest-instance', usage: { apiCalls: 0 }, available: false, unavailableReason: 'no developer reachable this week; the engagement starts brownfield',
    providedBy: 'a.developer', recordedAt: '2026-08-31', process: { name: 'n/a', trigger: 'nobody could name it', outcome: 'nobody could name it' }, pointers: [],
    acceptance: [{ id: 'AC-SEED-1', result: 'pass', evidence: 'apiCalls 0' }, { id: 'AC-SEED-2', result: 'pass', evidence: 'no pointers' }, { id: 'AC-SEED-3', result: 'pass', evidence: 'available:false' }] };
  const s = ingest(root, 'seed', seed);
  assertEqual(s.json.accepted, true, `seed rejected: ${JSON.stringify(s.json.rejected)}`);
  assertEqual(s.json.terminal, 'blocked', 'an unseeded run carried on to the census past a deferred authorship kill');
  assert(s.json.findings.some((f) => f.check === 'wp-a-kill-11' && f.severity === 'blocking'), 'the deferred kill was not re-raised as blocking');
});

test('D5(b): a seeded set is never size-excluded — the validator refuses it, apply mints a warning for a large one', () => {
  const ctx = fakeCtx({ stage: 'anchor', state: { stamps: { seed: 'provided', inputEnvelope: 'sets+stories' }, queue: { seedExclusions: [] } } });
  const ex = ANCHOR_STAGE.example(ctx);
  const big = { sysId: 'b1'.padEnd(32, 'b'), name: 'ACMEIT_IP18_S5_6713057', members: 95, role: 'excluded', via: 'pointer', excludedReason: 'batch set: 95 members is an order of magnitude above the seeded median of 9' };
  const art = deepMerge(ex, {});
  art.sets = ex.sets.concat([big]);
  art.resolution = ex.resolution.concat([{ pointer: 'ACMEIT_IP18_S5_6713057', kind: 'update-set', resolved: true, sysId: big.sysId, evidence: 'exact name match; 95 members' }]);
  const rej = ANCHOR_STAGE.validate(ctx, art);
  assert(rej.some((m) => /SEEDED set in role "excluded"/.test(m)), `a seeded set excluded by size was accepted:\n${rej.join('\n')}`);
  // The human's own exclusion at seed is the one legal route.
  const ctx2 = fakeCtx({ stage: 'anchor', state: { stamps: { seed: 'provided' }, queue: { seedExclusions: [{ value: 'ACMEIT_IP18_S5_6713057', why: 'a hackweek batch, not this process' }] } } });
  assertEqual(ANCHOR_STAGE.validate(ctx2, art).filter((m) => /SEEDED set in role/.test(m)).length, 0, 'the developer\'s own exclusion was refused');
  // Kept as seeded, a large set is a warning with its weight intact (the example's seeded
  // median is 34, so the order-of-magnitude line is 340 members here).
  const kept = deepMerge(ex, {});
  kept.sets = ex.sets.concat([Object.assign({}, big, { role: 'seeded', members: 400, excludedReason: undefined })]);
  assertEqual(ANCHOR_STAGE.validate(ctx, kept).length, 0, `a large seeded set kept as seeded was rejected:\n${ANCHOR_STAGE.validate(ctx, kept).join('\n')}`);
  const applied = ANCHOR_STAGE.apply(ctx, kept);
  const warn = applied.findings.find((f) => f.check === 'anchor-seeded-set-large');
  assert(warn && warn.severity === 'warning', 'no warning was minted for the large seeded set');
  assertIncludes(warn.message, 'ACMEIT_IP18_S5_6713057');
  assert(applied.facts.anchor.sets.some((s) => s.name === 'ACMEIT_IP18_S5_6713057' && s.role === 'seeded'), 'the set did not reach facts as seeded');
  assert(applied.queue.processCandidates[0].updateSets.includes('ACMEIT_IP18_S5_6713057'), 'the large seeded set left the process candidate');
});

test('D1: skills-audit passes a routable, reachable library and blocks an untriggerable skill', () => {
  const root = scratchRepo('d1-audit');
  fitTree(root);
  assertEqual(cli(['skills-audit', '--root', root]).code, 0, 'a routable, reachable skill failed the audit');
  putFile(root, '.claude/skills/widgets/SKILL.md', '---\nname: widgets\ndescription: Build widgets.\n---\n# widgets\n');
  const r = cli(['skills-audit', '--root', root]);
  assertEqual(r.code, 1, 'a skill with no quoted trigger phrase passed the audit');
  assertIncludes(r.stdout, 'widgets', 'the failing skill is not named');
  assertIncludes(r.stdout, 'quoted trigger phrase', 'the reason is not stated');
  // Inside a brain the failure is recorded as a BLOCKING finding.
  Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  cli(['skills-audit', '--root', root]);
  const findings = stateLib.readJsonl(path.join(root, '.brain', 'findings.jsonl'));
  assert(findings.some((f) => f.check === 'skills-audit' && f.severity === 'blocking'), 'the audit failure was not recorded as a blocking finding');
  // The synced OG layer in THIS repo passes: every build skill routes. No CLAUDE.md exists in
  // the product tree — the engagement renders it — so the audit falls back to the template,
  // which carries the same `.claude/skills/` route.
  const og = handoffLib.auditSkills(FRAMEWORK_ROOT);
  assertEqual(og.kernelPath, 'kernel/CLAUDE.template.md', 'the audit did not fall back to the kernel template in the product tree');
  assert(og.buildSkills >= 40, `the product tree carries ${og.buildSkills} build skill(s); the OG library is ~47`);
  assertEqual(og.failing.map((s) => s.name).join(','), '', `synced build skills fail the audit: ${og.failing.map((s) => `${s.name} (${s.problems.join('; ')})`).join(' · ')}`);
  assert(fs.existsSync(path.join(FRAMEWORK_ROOT, '.claude', 'hooks', 'skill-trigger.js')), 'the OG hooks are not in the product tree');
  assert(fs.existsSync(path.join(FRAMEWORK_ROOT, '.claude', 'og-layer.json')), 'no og-layer.json manifest');
});

test('D1/F4: export refuses a tree with no wired hook and a tree whose only skills are the machine', () => {
  const { root } = exportFixture('d1-nohooks');
  putFile(root, '.claude/settings.json', '{"hooks":{}}\n');
  const r = cli(['export', '--to', path.join(SCRATCH, 'out-d1-nohooks'), '--root', root]);
  assert(r.code !== 0, 'an export wiring no hook succeeded');
  assertIncludes(r.stderr, 'wires no hook', 'the refusal does not say why');
  const { root: r2 } = exportFixture('d1-noskills');
  fs.rmSync(path.join(r2, '.claude', 'skills', 'business-rule-patterns'), { recursive: true, force: true });
  const r2r = cli(['export', '--to', path.join(SCRATCH, 'out-d1-noskills'), '--root', r2]);
  assert(r2r.code !== 0, 'an export with no build skill succeeded');
  assert(/no build (procedure|skill)/.test(r2r.stderr), `the refusal does not say why:\n${r2r.stderr}`);
});

test('finalize: prunes the machine in place, writes the hashed manifest, restarts history, and --check detects drift', () => {
  const { root } = exportFixture('fin-ok');
  putFile(root, 'tools/snbrain/snbrain.js', '// the machine\n'); putFile(root, 'tools/snbrain/lib/state.js', '// the machine\n');
  putFile(root, '.claude/snbrain/LOOP.md', '# contract\n'); putFile(root, 'wiki-scaffold/index.md', '# scaffold\n');
  putFile(root, 'START-HERE.md', '# start\n'); putFile(root, 'drive.config.json', '{}\n'); putFile(root, 'docs/design.md', '# design\n');
  const brain = Brain.open(root);
  brain.state.stamps.processName = 'HR Onboarding Checklist';
  brain.state.facts.requestLog = { path: path.join(root, 'docs', 'wiki', 'evidence', 'read-only-proof', 'snbrain-requests.ndjson').replace(/\\/g, '/') };
  brain.save('fixture');
  gitCommitAll(root, 'operating history');
  const r = cli(['finalize', '--by', 'a named operator', '--root', root]);
  assertEqual(r.code, 0, `finalize failed:\n${r.stdout}${r.stderr}`);
  for (const rel of ['tools/snbrain', '.claude/skills/snbrain-census', '.claude/skills/map-process', '.claude/snbrain', 'wiki-scaffold', 'START-HERE.md', 'drive.config.json', '.brain/state.json', '.brain/in', 'docs/rework-plan.md']) {
    assert(!fs.existsSync(path.join(root, rel)), `the machine survived finalize: ${rel}`);
  }
  for (const rel of ['CLAUDE.md', 'AGENTS.md', '.claude/hooks/guard.js', '.claude/skills/business-rule-patterns/SKILL.md', '.brain/claims.jsonl', 'docs/wiki/index.md', 'EXPORT-MANIFEST.json', 'README.md', 'tools/render-kernel.js']) {
    assert(fs.existsSync(path.join(root, rel)), `the deliverable lost ${rel}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'EXPORT-MANIFEST.json'), 'utf8'));
  assertEqual(manifest.verb, 'finalize');
  assertEqual(manifest.process, 'HR Onboarding Checklist');
  assert(manifest.files.length > 5 && manifest.files.every((f) => f.sha256), 'the finalize manifest is not hashed');
  const log = require('child_process').spawnSync('git', ['-C', root, 'log', '--oneline'], { encoding: 'utf8' }).stdout.trim().split('\n');
  assertEqual(log.length, 1, `history did not restart: ${log.join(' / ')}`);
  assertIncludes(log[0], 'project brain selftest-instance / HR Onboarding Checklist', 'the first commit is not named as the prompt requires');
  assertEqual(cli(['finalize', '--check', '--root', root]).code, 0, 'a fresh finalize does not verify clean');
  fs.appendFileSync(path.join(root, 'docs', 'wiki', 'index.md'), '\nedited\n');
  const c = cli(['finalize', '--check', '--root', root]);
  assertEqual(c.code, 1, 'an edited page verified clean');
  assertIncludes(c.stdout, 'modified: docs/wiki/index.md');
});

test('finalize: the extension-owned paths it keeps do not make its own manifest report drift', () => {
  /*
   * Measured on the first finalize against a real engagement folder (the A/B's B-work, 2026-09-03):
   * finalize keeps .vscode, spikes/ and the sn-scriptsync instance folders on disk and leaves them
   * out of the manifest, the verifier walked the whole tree, and `--check` said DRIFTED the moment
   * the deliverable was created. An integrity check that cries wolf on its own output is one the
   * operator learns to ignore, which is worse than not having it.
   */
  const { root } = exportFixture('fin-ignored');
  brainWithLog(root);
  putFile(root, '.vscode/sn-agent-port.json', '{"port":1}');
  putFile(root, 'spikes/scriptsync-read/notes.md', 'operating scratch');
  putFile(root, 'acmedev/_settings.json', '{"instance":"acmedev"}');
  gitCommitAll(root, 'operating state');
  const r = cli(['finalize', '--by', 'a named operator', '--root', root]);
  assertEqual(r.code, 0, `finalize failed:\n${r.stdout}${r.stderr}`);
  assertIncludes(r.stdout, 'verify: CLEAN', `finalize reported drift on the tree it just wrote:\n${r.stdout}`);
  assertEqual(cli(['finalize', '--check', '--root', root]).code, 0, 'the freshly finalized tree does not verify clean');
  for (const kept of ['.vscode/sn-agent-port.json', 'spikes/scriptsync-read/notes.md', 'acmedev/_settings.json']) {
    assert(fs.existsSync(path.join(root, kept)), `finalize deleted an extension-owned path: ${kept}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert(!manifest.files.some((f) => /^(\.vscode|spikes|acmedev)\//.test(f.path)), 'an extension-owned path entered the manifest');
  assert((manifest.ignored || []).length >= 3, 'the manifest does not declare what it ignored, so no verifier can agree with it');
  // And a real edit inside the deliverable is still caught.
  fs.appendFileSync(path.join(root, 'docs', 'wiki', 'index.md'), '\nedited\n');
  assertEqual(cli(['finalize', '--check', '--root', root]).code, 1, 'an edit to a deliverable page was not caught');
});

test('finalize: refuses below terminal success unless forced, and refuses unknown files', () => {
  const { root } = exportFixture('fin-open', null);
  putFile(root, 'tools/snbrain/snbrain.js', '// machine\n');
  brainWithLog(root);
  const r = cli(['finalize', '--by', 'someone', '--root', root]);
  assertEqual(r.code, 3, 'finalize below success did not refuse');
  assertIncludes(r.stderr, 'Only "success" permits handoff');
  assert(fs.existsSync(path.join(root, 'tools', 'snbrain', 'snbrain.js')), 'a refused finalize deleted the machine');
  const { root: r2 } = exportFixture('fin-unknown');
  brainWithLog(r2);
  putFile(r2, 'my-notes.txt', 'stray');
  const u = cli(['finalize', '--by', 'someone', '--root', r2]);
  assertEqual(u.code, 1, 'an unknown file in the root was silently pruned or shipped');
  assertIncludes(u.stderr, 'my-notes.txt');
  assert(fs.existsSync(path.join(r2, 'my-notes.txt')), 'the unknown file was deleted');
});

function brainWithLog(root) {
  const brain = Brain.open(root);
  brain.state.facts.requestLog = { path: path.join(root, 'docs', 'wiki', 'evidence', 'read-only-proof', 'snbrain-requests.ndjson').replace(/\\/g, '/') };
  brain.save('fixture');
}

test('bootstrap-in-place: the product folder becomes the brain, a missing runner refuses before anything is written', () => {
  const product = path.join(SCRATCH, 'boot-product');
  const copy = (rel) => { const s = path.join(FRAMEWORK_ROOT, rel); const d = path.join(product, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.cpSync(s, d, { recursive: true }); };
  for (const rel of ['tools', 'kernel', 'wiki-scaffold', 'product.config.json', 'drive.config.json']) { copy(rel); }
  const boot = path.join(product, 'tools', 'snbrain', 'bootstrap.js');
  const r0 = spawnSyncNode([boot, '--instance', 'acmedev', '--process', 'HR onboarding', '--runner', 'definitely-not-installed', '--wait', '0']);
  assertEqual(r0.status, 3, `a missing runner did not refuse the bootstrap:\n${r0.stdout}${r0.stderr}`);
  assertIncludes(r0.stderr, 'not on PATH', 'the refusal does not say the runner is missing');
  assertIncludes(r0.stderr, 'VS Code adapter', 'the refusal does not offer the adapter option');
  assert(!fs.existsSync(path.join(product, '.brain')), 'a refused bootstrap wrote a brain');
  const r1 = spawnSyncNode([boot, '--instance', 'acmedev', '--process', 'HR onboarding', '--wait', '0']);
  assertEqual(r1.status, 1, `bootstrap without a port file should exit 1 (waiting):\n${r1.stdout}${r1.stderr}`);
  assert(fs.existsSync(path.join(product, '.brain', 'state.json')), 'the brain was not initialised IN the product folder');
  assert(!fs.existsSync(path.join(SCRATCH, 'acmedev-hr-onboarding-brain')), 'a sibling workspace was created — the in-place decision was not applied');
  assert(fs.existsSync(path.join(product, '.git')), 'bootstrap did not git-init the folder the render stage must commit into');
  assert(fs.existsSync(path.join(product, 'docs', 'wiki', 'index.md')), 'the wiki scaffold was not instantiated');
  const boot_ = JSON.parse(fs.readFileSync(path.join(product, '.brain', 'bootstrap.json'), 'utf8'));
  assertEqual(boot_.inPlace, true);
  assertEqual(JSON.parse(fs.readFileSync(path.join(product, 'product.config.json'), 'utf8')).instances.dev, 'acmedev', 'instances.dev was not set');
  const sync = path.join(SCRATCH, 'boot-sync');
  putFile(sync, '.vscode/sn-agent-port.json', JSON.stringify({ port: 1, pid: 1 }));
  const r2 = spawnSyncNode([boot, '--instance', 'acmedev', '--process', 'HR onboarding', '--wait', '0', '--sync-root', sync, '--force']);
  assertEqual(r2.status, 0, `bootstrap with a port file did not report ready:\n${r2.stdout}${r2.stderr}`);
  assertIncludes(r2.stdout, 'finalize --by', 'the next steps do not end with finalize');
});

test('F1: the runner contract — detection names the VS Code adapter, a missing runner is refused with options, before spend', () => {
  const detected = drive.detectRunners({});
  assert(detected.some((r) => r.name === 'vscode' && r.kind === 'vscode' && r.available === false), 'the VS Code adapter is not named as an unavailable runner');
  assert(detected.filter((r) => r.kind === 'cli').length >= 3, 'the CLI presets are not detected');
  const msg = drive.describeUnavailable('copilot', detected.map((r) => Object.assign({}, r, { available: r.name === 'claude' })));
  assertIncludes(msg, 'install that CLI');
  assertIncludes(msg, 'claude', 'an available alternative runner is not offered');
  assertIncludes(msg, 'Nothing was spent');
  const res = drive.runStage({ name: 'vscode', kind: 'vscode' }, { prompt: 'p', brief: { text: '', file: 'b', stage: 'seed', iteration: 1 }, root: '.', model: null, toolPolicy: { readOnly: true } });
  assertEqual(res.status, 'unavailable');
  const root = scratchRepo('f1-run');
  Brain.init({ root, instance: 'x', stageOrder: STAGE_ORDER });
  // A CONFIGURED runner whose executable is not installed — the second engagement's exact shape.
  putFile(root, 'drive.config.json', JSON.stringify({ runners: { ghost: ['definitely-not-installed-exe', '-p', '{prompt}'] } }));
  const r = spawnSyncNode([path.join(__dirname, 'drive.js'), 'run', '--root', root, '--runner', 'ghost']);
  assertEqual(r.status, 2, 'drive run did not refuse a missing runner before the first brief');
  assertIncludes(r.stderr, 'not on PATH');
  assert(!fs.existsSync(path.join(root, '.brain', 'briefs')), 'a brief was written for a runner that cannot run it');
});

// ===========================================================================
// Y — FINDINGS about the product. The second population, kept out of the first.
// ===========================================================================

group('Y. product findings (quirks)');

const quirksLib = require('./lib/quirks.js');

/** A brain with the friction a real run leaves behind: rejections, an override, a thin page. */
function quirkFixture(name) {
  const root = scratchRepo(name);
  const brain = Brain.init({ root, instance: 'acmedev', stageOrder: STAGE_ORDER });
  brain.upsertClaims([
    { locus: { table: 'sys_script', sysId: 'a'.repeat(32), key: 'One' }, assertion: 'active = true', band: 'A', status: 'verified' },
    { locus: { table: 'sys_script', sysId: 'b'.repeat(32), key: 'Two' }, assertion: 'active = true', band: 'A', status: 'verified' },
    { locus: { table: 'sys_script', sysId: 'c'.repeat(32), key: 'Three' }, assertion: 'active = true', band: 'A', status: 'verified' },
    { locus: { table: 'sys_script', sysId: 'd'.repeat(32), key: 'Four' }, assertion: 'active = true', band: 'A', status: 'verified' },
  ], { stage: 'harvest' });
  brain.recordIteration('explain', { accepted: false, progress: false, rejections: ['$.claims[2].assertion: an assertion under eight words is refused as a label, because a label is not behaviour'] });
  brain.state.overrides = [{ kind: 'cap', target: 'harvest', value: 6, by: 'a named operator', reason: 'the queue is legitimately longer than the default cap', at: '2026-09-04T10:00:00Z' }];
  brain.save('fixture');
  // The registry names ONE of the four artifacts: a page thinner than its own evidence.
  putFile(root, 'docs/wiki/registry-sys-ids.md', `---\ntitle: "sys_id Registry"\nstatus: "draft"\nclaims-rendered: 1\n---\n\n| Name | sys_id |\n|---|---|\n| One | \`${'a'.repeat(32)}\` |\n`);
  return { root, brain };
}

test('a quirk is recorded, is content-hashed, and never touches the findings ledger', () => {
  const { root, brain } = quirkFixture('quirk-record');
  const q = quirksLib.recordQuirk(root, { note: 'the anchor procedure told me to exclude a set the developer had named', stage: 'anchor', severity: 'blocker', by: 'a.developer' });
  assertEqual(q.id, quirksLib.recordQuirk(root, { note: 'the anchor procedure told me to exclude a set the developer had named', stage: 'anchor' }).id,
    'the same quirk logged twice minted two ids — a re-run would report it as two defects');
  assertEqual(quirksLib.recordedQuirks(root).length, 1, 'the ledger did not deduplicate by content');
  assertEqual(brain.findings().size, 0, 'a product quirk entered the INSTANCE findings ledger, where a blocking row gates terminal success');
  assertEqual(brain.successBlockers().filter((b) => /quirk/i.test(b)).length, 0, 'a quirk blocked terminal success; it must gate nothing');
  assert(fs.existsSync(path.join(root, '.brain', 'quirks.jsonl')), 'the quirks ledger is not where the report looks for it');
});

test('a quirk with no real note is refused, because an empty report is worse than none', () => {
  const { root } = quirkFixture('quirk-empty');
  let threw = false;
  try { quirksLib.recordQuirk(root, { note: 'broken' }); } catch (e) { threw = true; assertIncludes(e.message, 'at least 10 characters'); }
  assertEqual(threw, true, 'a one-word quirk was accepted');
});

test('the run\'s own friction is derived without anyone logging it', () => {
  const { root } = quirkFixture('quirk-derive');
  const derived = quirksLib.deriveExecutionQuirks(root);
  const rej = derived.find((q) => q.kind === 'stage-rejection');
  assert(rej, 'a rejected iteration produced no quirk — every rejection is the CLI telling a worker it got the loop wrong');
  assertEqual(rej.stage, 'explain');
  assertEqual(rej.severity, 'friction', 'one satisfied rejection was called a blocker; that buries the findings that end runs');
  assertIncludes(rej.detail, 'under eight words', 'the rejection text did not survive into the report, so nobody can act on it');
  const ov = derived.find((q) => q.kind === 'override');
  assert(ov, 'a raised bound produced no quirk — a bound a real run must raise is calibrated on the wrong thing');
  assertIncludes(ov.detail, 'the queue is legitimately longer');
});

test('a schema rejection keeps its message instead of collapsing to a JSON path', () => {
  assertIncludes(quirksLib.rejectionGist('$.answers[3].alternatives[0].rejectedBecause: required, but missing from the artifact entirely'),
    'required', 'the gist cut at the first dot and reported a bare JSON path');
  assertIncludes(quirksLib.rejectionGist('$.answers[3].alternatives[0].rejectedBecause: required, but missing'), '$.answers[3]', 'the path prefix was dropped');
});

test('completeness is measured per page against the evidence that page owns', () => {
  const { root } = quirkFixture('quirk-complete');
  const a = quirksLib.assessCompleteness(root);
  const reg = a.rows.find((r) => /registry-sys-ids/.test(r.page));
  assert(reg, 'the registry was not measured at all');
  assertEqual(reg.expected, 4, 'the population is the distinct artifact identities in the ledger');
  assertEqual(reg.present, 1, 'the page carries one');
  const { quirks: qs } = quirksLib.completenessQuirks(root);
  const thin = qs.find((q) => q.kind === 'page-thin');
  assert(thin, 'a page carrying a quarter of its evidence raised nothing');
  assertIncludes(thin.summary, '1 of the 4');
  assertIncludes(thin.detail, 'Population:', 'the finding does not name the population it counted, so nobody can argue with it');
});

test('a page that carries everything it owns raises nothing', () => {
  const { root } = quirkFixture('quirk-full');
  const ids = ['a', 'b', 'c', 'd'].map((c) => c.repeat(32));
  putFile(root, 'docs/wiki/registry-sys-ids.md', `---\ntitle: "sys_id Registry"\nstatus: "draft"\nclaims-rendered: 4\n---\n\n${ids.map((i) => `| \`${i}\` |`).join('\n')}\n`);
  const { quirks: qs } = quirksLib.completenessQuirks(root);
  assertEqual(qs.filter((q) => q.kind === 'page-thin' && /registry/.test(q.summary)).length, 0, 'a complete registry was still reported thin');
});

test('the report carries both populations, says it gates nothing, and warns it is unscrubbed', () => {
  const { root } = quirkFixture('quirk-report');
  quirksLib.recordQuirk(root, { note: 'the driver needed a CLI this laptop is not allowed to install', severity: 'blocker' });
  const built = quirksLib.writeReport(root, 'FINDINGS.md');
  const body = fs.readFileSync(path.join(root, 'FINDINGS.md'), 'utf8');
  assertIncludes(body, 'not allowed to install', 'the recorded quirk is missing from the report');
  assertIncludes(body, 'registry-sys-ids.md', 'the completeness half is missing');
  assertIncludes(body, 'Nothing here gates anything', 'the report does not say it gates nothing, which is what stops it being read as a blocker list');
  assertIncludes(body, 'Not scrubbed', 'the report does not warn that it carries the customer\'s own strings');
  assertIncludes(body, 'Completeness measures, including the ones that passed', 'passing measures are hidden, so a wrong threshold cannot be argued with');
  assert(/generated probe suite/.test(body), 'the report does not say what it cannot measure');
  assert(built.quirks.length >= 2 && built.counts.blocker >= 1, 'the summary counts are wrong');
});

test('the report is honest when a run was clean', () => {
  const root = scratchRepo('quirk-clean');
  Brain.init({ root, instance: 'acmedev', stageOrder: STAGE_ORDER });
  const built = quirksLib.buildReport(root);
  assertEqual(built.quirks.length, 0);
  assertIncludes(built.body, 'That is a real result', 'a clean run reads as a broken report rather than a clean one');
});

test('FINDINGS.md is written by finalize, kept on disk, and kept OUT of the deliverable', () => {
  const { root } = exportFixture('quirk-finalize');
  brainWithLog(root);
  quirksLib.recordQuirk(root, { note: 'the interview gate offered me shadow questions and the ingest then refused them', severity: 'blocker', stage: 'interview' });
  putFile(root, 'tools/snbrain/snbrain.js', '// machine\n');
  gitCommitAll(root, 'operating state');
  const r = cli(['finalize', '--by', 'a named operator', '--root', root, '--force', '--reason', 'testing the feedback path']);
  assertEqual(r.code, 0, `finalize failed:\n${r.stdout}${r.stderr}`);
  const findings = path.join(root, 'FINDINGS.md');
  assert(fs.existsSync(findings), 'finalize did not leave FINDINGS.md on disk — the feedback is destroyed by the prune it triggers');
  assertIncludes(fs.readFileSync(findings, 'utf8'), 'shadow questions', 'the recorded quirk did not reach the report finalize wrote');
  assert(!fs.existsSync(path.join(root, '.brain', 'quirks.jsonl')), 'the raw quirks ledger shipped in the deliverable');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert(!manifest.files.some((f) => f.path === 'FINDINGS.md'), 'product feedback entered the customer\'s manifest');
  assertEqual(cli(['finalize', '--check', '--root', root]).code, 0, 'FINDINGS.md on disk makes the integrity check fail');
  const tracked = require('child_process').spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout;
  assertEqual(/FINDINGS\.md/.test(tracked), false, 'product feedback was committed into the customer\'s repository');
  assertIncludes(r.stdout, 'FINDINGS.md', 'finalize did not tell the operator the report exists');
});

test('an export never carries the product feedback either', () => {
  const { root } = exportFixture('quirk-export');
  quirksLib.recordQuirk(root, { note: 'a quirk that must not reach the customer deliverable' });
  quirksLib.writeReport(root, 'FINDINGS.md');
  const to = path.join(SCRATCH, 'out-quirk-export');
  assertEqual(cli(['export', '--to', to, '--root', root]).code, 0);
  assert(!fs.existsSync(path.join(to, 'FINDINGS.md')), 'FINDINGS.md shipped to the customer');
  assert(!fs.existsSync(path.join(to, '.brain', 'quirks.jsonl')), 'the quirks ledger shipped to the customer');
});

test('every brief tells a worker how to report the loop itself', () => {
  assert(stages.HARD_RULES.some((r) => /snbrain\.js quirk/.test(r)),
    'the hard rules never mention the quirk verb, so a worker hitting a contradiction has nowhere to put it');
  const { root } = startRun('quirk-brief');
  const brief = cli(['next', '--root', root]);
  assertEqual(brief.code, 0, `next failed:\n${brief.stdout}${brief.stderr}`);
  assertEqual(/quirk --note/.test(brief.stdout), true, `the composed brief does not carry the quirk instruction:\n${brief.stdout.slice(0, 400)}`);
});

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed`);
process.stdout.write(failed.length ? `, ${failed.length} FAILED\n` : '\n');
process.exit(failed.length ? 1 : 0);
