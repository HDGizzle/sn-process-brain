'use strict';
/*
 * quirks.js — FINDINGS ABOUT THE PRODUCT, kept strictly apart from findings about the instance.
 *
 * WHY A SECOND LEDGER, when `.brain/findings.jsonl` exists. That one holds findings about the
 * CUSTOMER'S INSTANCE — a retired artifact rendered as live, a table nothing rendered — and a
 * blocking one there stops terminal success. This one holds findings about THE LOOP: a brief
 * that contradicted the CLI, a rejection nobody could satisfy, a runner that could not be
 * installed, a page the run left thinner than its own evidence. Putting the second population
 * in the first ledger would do both jobs badly: it would gate a run on the product's defects,
 * and it would bury the product's defects inside a gate nobody reads afterwards. So: separate
 * file, separate lifecycle, never gates anything, pruned out of the deliverable, handed back to
 * whoever maintains the product.
 *
 * The second engagement's run produced exactly this document by hand — thirteen findings that
 * became a night's work. This makes it a run artifact instead of a favour.
 *
 * TWO HALVES, because two different things go wrong:
 *
 *   (A) EXECUTION QUIRKS — friction while the loop ran. Most of it is already recorded and
 *       merely unshaped: every rejection is the CLI telling a worker it did the wrong thing,
 *       and a cluster of them is a product defect wearing a stage's clothes. Derived from
 *       state.json, history.ndjson and drive.ndjson, plus anything a human or a worker logged
 *       with `snbrain quirk` at the moment it bit.
 *
 *   (B) COMPLETENESS — did the run actually FILL the wiki. Each page tier owns a population
 *       that the ledger can count: the registry owns the artifact identities, tbd.md owns the
 *       open debt, the matrix owns the resolved sets. Where a page carries materially less than
 *       its own evidence supports, that is a finding with two numbers in it. Measured against
 *       a mature hand-built engagement wiki, where the registry is an order of magnitude larger
 *       than anything this loop has yet produced, the gap is not subtle.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: judge whether a page is any GOOD. Fullness is countable;
 * usefulness is not, and a gate on usefulness is satisfied most cheaply by padding. Usefulness
 * belongs to the generated probe suite (docs/design.md), and until that exists this file counts
 * what it can count and says so.
 */

const fs = require('fs');
const path = require('path');
const { digest, readJsonl, appendJsonl } = require('./state.js');
const render = require('../render.js');

const { latestById } = render;

const QUIRK_KINDS = Object.freeze([
  'observed',            // a human or a worker logged it
  'stage-rejection',     // the CLI refused an artifact, repeatedly
  'stage-stalled',       // a stage burned its cap or its ceiling
  'run-terminal',        // the run ended anywhere but success
  'gate-refusal',        // export/finalize/render refused a handoff
  'runner',              // the transport or the agent CLI could not run
  'spend',               // the reported spend and the request log disagreed
  'override',            // a human had to raise a bound to keep going
  'page-thin',           // a page carries less than its evidence supports
  'page-empty',          // a page renders nothing while evidence exists
]);

const SEVERITIES = Object.freeze(['blocker', 'friction', 'gap', 'confusing', 'idea']);

function fwd(p) { return String(p).replace(/\\/g, '/'); }
function quirkId(kind, key) { return `Q-${digest({ k: kind, s: key })}`; }
function readJson(abs, dflt) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')); } catch (e) { return dflt; }
}
function wikiRootOf(root) {
  const cfg = readJson(path.join(root, 'product.config.json'), {});
  return String((cfg.paths && cfg.paths.wikiRoot) || 'docs/wiki').replace(/\/+$/, '');
}
function readPage(root, rel) {
  const abs = path.resolve(root, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}
function countMatches(text, re) { return ((text || '').match(re) || []).length; }
function distinct(arr) { return [...new Set(arr.filter(Boolean))]; }

// ---------------------------------------------------------------------------
// recording — one line, at the moment it bites
// ---------------------------------------------------------------------------

const QUIRKS_FILE = '.brain/quirks.jsonl';

function recordQuirk(root, entry) {
  const now = new Date().toISOString();
  const kind = QUIRK_KINDS.includes(entry.kind) ? entry.kind : 'observed';
  const severity = SEVERITIES.includes(entry.severity) ? entry.severity : 'friction';
  const note = String(entry.note || '').trim();
  if (note.length < 10) { throw new Error('a quirk needs a note of at least 10 characters: what happened, in your own words.'); }
  const row = {
    id: quirkId(kind, note.toLowerCase()),
    kind, severity,
    note,
    stage: entry.stage || null,
    by: entry.by || null,
    evidence: (entry.evidence || []).map(fwd),
    at: now,
    source: 'recorded',
  };
  appendJsonl(path.join(root, QUIRKS_FILE), [row]);
  return row;
}

function recordedQuirks(root) {
  return latestById(readJsonl(path.join(root, QUIRKS_FILE)));
}

// ---------------------------------------------------------------------------
// (A) execution quirks, derived from what the run already wrote down
// ---------------------------------------------------------------------------

/**
 * What the CLI actually objected to, without the essay that follows it.
 *
 * Cutting at the first `.` or `:` looked right until it met a schema rejection, where the
 * path IS dotted: `$.answers[3].alternatives[0].rejectedBecause: required` became
 * `$.answers[3]`, and a report full of bare JSON paths says nothing about what went wrong.
 * So a leading schema path is stripped and kept as a prefix, and the sentence boundary only
 * counts once there is enough text after it to be a sentence.
 */
function rejectionGist(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const schema = /^(\$[^\s:]*):\s*(.+)$/.exec(s);
  const head = schema ? `${schema[1]}: ` : '';
  const rest = schema ? schema[2] : s;
  const m = /^(.{40,200}?)(?:[.:]\s|$)/.exec(rest);
  return `${head}${(m ? m[1] : rest.slice(0, 200)).trim()}`;
}

function deriveExecutionQuirks(root) {
  const out = [];
  const state = readJson(path.join(root, '.brain', 'state.json'), null);
  if (!state) { return out; }
  const history = readJsonl(path.join(root, '.brain', 'history.ndjson'));
  const drive = readJsonl(path.join(root, '.brain', 'drive.ndjson'));
  const findings = latestById(readJsonl(path.join(root, '.brain', 'findings.jsonl')));

  // --- rejections, clustered per stage. One quirk per stage, however many rejections. ---
  for (const [stage, st] of Object.entries(state.stages || {})) {
    const rejected = (st.iterations || []).filter((it) => (it.rejections || []).length);
    if (!rejected.length) { continue; }
    const all = rejected.flatMap((it) => it.rejections || []);
    const gists = distinct(all.map(rejectionGist));
    /*
     * A rejection the worker then satisfied is FRICTION — it cost an iteration and taught us
     * the message was not clear enough first time. It becomes a BLOCKER only when the stage
     * stopped making progress or burned most of its cap, because those are the ones that end
     * runs. The first cut called one-rejection-in-two a blocker and reported six blockers on a
     * run that finished every stage, which buries the two findings that actually matter.
     */
    out.push({
      id: quirkId('stage-rejection', stage),
      kind: 'stage-rejection',
      severity: ((st.sinceProgress || 0) >= 2 || rejected.length >= 3) ? 'blocker' : 'friction',
      stage,
      summary: `${stage}: ${rejected.length} of ${st.total} iteration(s) were rejected, costing ${rejected.length} of the stage's cap`,
      detail: `The CLI refused this stage's artifact ${all.length} time(s) across ${rejected.length} iteration(s). Distinct objections:\n` +
        gists.map((g) => `  - ${g}`).join('\n') +
        '\n\nA rejection a competent worker cannot satisfy on the first read is a defect in the brief, the schema or the message — not in the worker.',
      evidence: ['.brain/state.json (stages.' + stage + '.iterations[].rejections)'],
      at: (rejected[rejected.length - 1] || {}).at || null,
      source: 'derived',
    });
  }

  // --- a stage that stopped making progress, and the run's own terminal state ---
  for (const [stage, st] of Object.entries(state.stages || {})) {
    if ((st.sinceProgress || 0) >= 2) {
      out.push({
        id: quirkId('stage-stalled', stage), kind: 'stage-stalled', severity: 'blocker', stage,
        summary: `${stage}: ${st.sinceProgress} consecutive iteration(s) with no progress`,
        detail: 'Two consecutive zero-resolution iterations is the loop\'s stall rule. Reaching it means the stage could not be satisfied by repetition, which is the shape of an unsatisfiable acceptance rather than a lazy worker.',
        evidence: ['.brain/state.json (stages.' + stage + '.sinceProgress)'], at: st.completedAt || null, source: 'derived',
      });
    }
  }
  if (state.terminal && state.terminal !== 'success') {
    out.push({
      id: quirkId('run-terminal', String(state.terminal)), kind: 'run-terminal', severity: 'blocker', stage: state.stage,
      summary: `the run ended \`${state.terminal}\`, not \`success\``,
      detail: `${state.terminalNote || '(no note recorded)'}\n\nOnly \`success\` permits handoff, so every run that ends elsewhere is either a real instance problem or a product one, and the note above is where to start.`,
      evidence: ['.brain/state.json (terminal, terminalNote)'], at: state.terminalAt || null, source: 'derived',
    });
  }

  // --- a human had to raise a bound to keep the run alive ---
  for (const ov of (state.overrides || [])) {
    out.push({
      id: quirkId('override', `${ov.kind}:${ov.target || ''}:${ov.reason || ''}`), kind: 'override',
      severity: 'friction', stage: ov.stage || null,
      summary: `a bound was overridden to keep the run going: ${ov.kind}${ov.target ? ` ${ov.target}` : ''} → ${ov.value}`,
      detail: `Attributed to ${ov.by || 'unknown'}: ${ov.reason || '(no reason recorded)'}\n\nA bound a real run has to raise is a bound calibrated on the wrong thing.`,
      evidence: ['.brain/state.json (overrides)'], at: ov.at || null, source: 'derived',
    });
  }

  // --- the reported spend and the append-before-send log disagreed ---
  for (const f of findings.filter((x) => /^spend-discrepancy/.test(String(x.check || '')))) {
    out.push({
      id: quirkId('spend', String(f.check)), kind: 'spend', severity: 'friction', stage: (f.check || '').split('-').pop(),
      summary: 'the stage\'s reported spend and the request log disagreed',
      detail: String(f.message || ''),
      evidence: ['.brain/findings.jsonl (' + f.id + ')'], at: f.recordedAt || null, source: 'derived',
    });
  }

  // --- the transport or the agent CLI could not run ---
  for (const row of drive.filter((r) => r && (r.event === 'runner-unavailable' || r.status === 'unavailable' || (r.error && r.exit === null)))) {
    out.push({
      id: quirkId('runner', String(row.runner || row.error || 'unknown')), kind: 'runner', severity: 'blocker', stage: row.stage || null,
      summary: `the runner "${row.runner || 'unknown'}" could not be used`,
      detail: `${row.error || 'reported unavailable by the driver'}\n\nA run that cannot spawn a worker has spent nothing and learned nothing; the machine it could not run on is the finding.`,
      evidence: ['.brain/drive.ndjson'], at: row.at || null, source: 'derived',
    });
  }

  // --- how often the loop stopped for a human, which is a cost even when correct ---
  const gates = drive.filter((r) => r && r.gate === true).length;
  if (gates) {
    out.push({
      id: quirkId('observed', 'human-gate-pauses'), kind: 'observed', severity: 'idea', stage: null,
      summary: `the driver paused for a human ${gates} time(s)`,
      detail: 'Recorded as a measure, not a complaint: the gates are deliberate. If a pause happened at a stage that did not need a human, that is worth saying.',
      evidence: ['.brain/drive.ndjson'], at: null, source: 'derived',
    });
  }
  return out.concat(history.filter((h) => h.event === 'skills-audit').map((h) => ({
    id: quirkId('gate-refusal', 'skills-audit'), kind: 'gate-refusal', severity: 'blocker', stage: h.stage,
    summary: 'the skills audit refused the handoff',
    detail: `Failing skills: ${JSON.stringify((h.detail || {}).failing || [])}. A shipped skill that cannot be triggered is a page that reads as coverage.`,
    evidence: ['.brain/history.ndjson'], at: h.at || null, source: 'derived',
  })));
}

// ---------------------------------------------------------------------------
// (B) completeness — did the run fill the wiki its own evidence supports
// ---------------------------------------------------------------------------

/**
 * Each tier page owns a population the ledger can count. `expected` is what the evidence
 * supports, `present` is what the page carries, and the finding is the difference — with both
 * numbers in it, because "the registry looks thin" is an opinion and "the ledger holds 284
 * artifact identities and the registry lists 47" is a fact somebody can act on.
 *
 * REPORT, NEVER BLOCK. A gate on fullness is satisfied most cheaply by padding, which makes the
 * deliverable worse — the same reasoning that made the render-quality signals findings rather
 * than rejections.
 */
function assessCompleteness(root) {
  const wiki = wikiRootOf(root);
  const state = readJson(path.join(root, '.brain', 'state.json'), null);
  const claims = latestById(readJsonl(path.join(root, '.brain', 'claims.jsonl')));
  const decisions = latestById(readJsonl(path.join(root, '.brain', 'decisions.jsonl')));
  const questions = latestById(readJsonl(path.join(root, '.brain', 'questions.jsonl')));
  const findings = latestById(readJsonl(path.join(root, '.brain', 'findings.jsonl')));
  const rows = [];

  const add = (page, owns, expected, present, note) => {
    rows.push({ page: `${wiki}/${page}`, owns, expected, present, ratio: expected ? present / expected : 1, note: note || null });
  };

  // registry: one row per artifact identity the run banked
  const artifacts = distinct(claims.filter((c) => c.locus && c.locus.sysId).map((c) => `${c.locus.table}|${c.locus.sysId}`));
  const registry = readPage(root, `${wiki}/registry-sys-ids.md`);
  if (registry !== null) {
    add('registry-sys-ids.md', 'every current sys_id, by artifact', artifacts.length,
      distinct((registry.match(/\b[0-9a-f]{32}\b/g) || [])).length,
      'The registry is the page a developer opens before every scoped write. A hand-curated selection of it is how an id gets re-invented wrongly.');
  }

  // decisions: the ledger, rendered
  const decPage = readPage(root, `${wiki}/decisions.md`);
  if (decPage !== null) {
    add('decisions.md', 'every decision in the ledger', decisions.filter((d) => d.confirmationStatus !== 'retired').length,
      countMatches(decPage, /^###\s+DEC-\d+/gm), null);
  }

  // tbd: the open debt — unanswered questions, open findings, unverifiable claims
  const tbdPage = readPage(root, `${wiki}/tbd.md`);
  if (tbdPage !== null) {
    const openQ = questions.filter((q) => ['queued', 'deferred', 'shadow'].includes(q.status)).length;
    const openF = findings.filter((f) => f.disposition === 'open' && f.severity !== 'info').length;
    const unverifiable = claims.filter((c) => c.status === 'unverifiable').length ? 1 : 0;
    add('tbd.md', 'open questions, open findings and declared gaps', openQ + openF + unverifiable,
      countMatches(tbdPage, /(^##\s+TBD-\d+|^\|\s*TBD-\d+)/gm),
      'Every unanswered question and every open finding is debt somebody inherits. A TBD register thinner than the run\'s own open items hands that debt over silently.');
  }

  // deployment matrix: one row per resolved set
  const sets = ((state && state.facts && state.facts.anchor && state.facts.anchor.sets) || []).filter((s) => s.role !== 'excluded');
  const matrix = readPage(root, `${wiki}/deployment-matrix.md`);
  if (matrix !== null && sets.length) {
    add('deployment-matrix.md', 'one row per resolved update set', sets.length,
      sets.filter((s) => matrix.includes(s.name)).length, null);
  }

  // glossary: confirmed terms plus the recurring words nobody defined
  const glossary = readPage(root, `${wiki}/glossary.md`);
  if (glossary !== null) {
    let model = null;
    try { model = require('./vocabulary.js').buildVocabularyModel(root); } catch (e) { model = null; }
    if (model) {
      add('glossary.md', 'confirmed vocabulary terms', model.terms.length,
        model.terms.filter((t) => glossary.includes(t.canonicalTerm)).length,
        model.terms.length ? null : 'No vocabulary was confirmed at the interview, so the glossary has nothing to carry — that is a question the interview did not ask, not a render defect.');
    }
  }

  // evidence appendix: one page per table with real weight in the ledger
  const perTable = new Map();
  for (const c of claims) { const t = c.locus && c.locus.table; if (t) { perTable.set(t, (perTable.get(t) || 0) + 1); } }
  const eligible = [...perTable.entries()].filter(([, n]) => n >= 5);
  const evidenceDir = path.resolve(root, wiki, 'evidence');
  if (fs.existsSync(evidenceDir)) {
    const corpus = fs.readdirSync(evidenceDir).filter((f) => /\.md$/.test(f)).map((f) => fs.readFileSync(path.join(evidenceDir, f), 'utf8')).join('\n');
    add('evidence/', 'a page per table carrying five or more claims', eligible.length,
      eligible.filter(([t]) => corpus.includes(t)).length, null);
  }

  // conventions: an enforcement line per stated convention
  const stated = ((state && state.queue && state.queue.statedConventions) || []);
  const conventions = readPage(root, `${wiki}/conventions.md`);
  if (conventions !== null && stated.length) {
    add('conventions.md', 'an enforcement line per stated convention', stated.length,
      stated.filter((c) => conventions.includes(String(c.claimId))).length, null);
  }

  // process pages: one per named process; stories: one per seeded work item or induced root
  const named = ((state && state.queue && state.queue.namedProcesses) || []).filter((n) => n && !n.discarded);
  const processDir = path.resolve(root, wiki, 'processes');
  if (named.length && fs.existsSync(processDir)) {
    const pages = fs.readdirSync(processDir).filter((f) => /\.md$/.test(f) && !/_TEMPLATE/.test(f));
    add('processes/', 'a page per process the human named', named.length,
      named.filter((n) => pages.some((p) => p.includes(n.slug))).length, null);
  }
  let stories = null;
  try { stories = require('./pages.js').buildStoryPages(root, { wiki }); } catch (e) { stories = null; }
  const storyDir = path.resolve(root, wiki, 'stories');
  if (stories && stories.pages.length && fs.existsSync(storyDir)) {
    const onDisk = fs.readdirSync(storyDir).filter((f) => /\.md$/.test(f) && !/_TEMPLATE/.test(f));
    add('stories/', 'a page per seeded work item or induced story root', stories.pages.length,
      stories.pages.filter((p) => onDisk.includes(path.posix.basename(p.path))).length, null);
  }

  // pages that render nothing at all while the ledger holds evidence
  const empty = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) { return; }
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.md$/i.test(e.name) || /_TEMPLATE/.test(e.name)) { continue; }
      const body = fs.readFileSync(abs, 'utf8');
      const declared = render.frontmatterNumber(body, 'claims-rendered');
      if (declared === 0 && !/^(index|CONTRACT|INTERVIEW|gotchas-platform-catalogue|hard-rules|agent-api|read-only-proof)\.md$/i.test(e.name)) {
        empty.push(fwd(path.relative(root, abs)));
      }
    }
  };
  walk(path.resolve(root, wiki));
  return { rows, emptyPages: empty, artifacts: artifacts.length, claims: claims.length };
}

/** The completeness rows that are worth reporting, as quirks. */
const THIN_RATIO = 0.75;

function completenessQuirks(root) {
  const a = assessCompleteness(root);
  const out = [];
  for (const r of a.rows) {
    if (r.expected === 0 || r.ratio >= THIN_RATIO) { continue; }
    out.push({
      id: quirkId('page-thin', r.page), kind: 'page-thin',
      severity: r.ratio < 0.34 ? 'blocker' : 'gap',
      stage: 'render',
      summary: `${r.page} carries ${r.present} of the ${r.expected} it owns (${Math.round(r.ratio * 100)}%)`,
      detail: `Population: ${r.owns}. The ledger supports ${r.expected}; the page carries ${r.present}.` +
        (r.note ? `\n\n${r.note}` : '') +
        '\n\nThis is a count, not a judgement of the prose. It says evidence the run paid for did not reach the page that owns it.',
      evidence: [r.page, '.brain/claims.jsonl'], at: null, source: 'derived',
    });
  }
  if (a.emptyPages.length) {
    out.push({
      id: quirkId('page-empty', 'zero-claims'), kind: 'page-empty', severity: 'gap', stage: 'render',
      summary: `${a.emptyPages.length} page(s) declare \`claims-rendered: 0\` while the ledger holds ${a.claims} claim(s)`,
      detail: `Pages: ${a.emptyPages.slice(0, 8).join(', ')}${a.emptyPages.length > 8 ? `, and ${a.emptyPages.length - 8} more` : ''}.\n\n` +
        'A page in the deliverable that rests on no claim is either scaffolding that survived, or a page whose evidence exists and never reached it.',
      evidence: a.emptyPages.slice(0, 8), at: null, source: 'derived',
    });
  }
  return { quirks: out, assessment: a };
}

// ---------------------------------------------------------------------------
// the report — the shape a human can hand back to whoever maintains the product
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { blocker: 0, gap: 1, friction: 2, confusing: 3, idea: 4 };

function buildReport(root) {
  const state = readJson(path.join(root, '.brain', 'state.json'), null);
  const bootstrap = readJson(path.join(root, '.brain', 'bootstrap.json'), {});
  const recorded = recordedQuirks(root).map((q) => Object.assign({ summary: q.note, detail: '' }, q));
  const derived = deriveExecutionQuirks(root);
  const { quirks: completeness, assessment } = completenessQuirks(root);
  const all = recorded.concat(derived, completeness)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || String(a.kind).localeCompare(String(b.kind)));

  const counts = {};
  for (const q of all) { counts[q.severity] = (counts[q.severity] || 0) + 1; }
  const generator = (() => {
    try {
      const r = require('child_process').spawnSync('git', ['-C', path.resolve(__dirname, '..', '..', '..'), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
      return r.status === 0 ? r.stdout.trim() : null;
    } catch (e) { return null; }
  })();

  const L = [];
  L.push('# FINDINGS — what this run learned about the product');
  L.push('');
  L.push('> Generated by `snbrain quirks --report`. This file is about the MAPPING PRODUCT, not about');
  L.push('> the customer\'s instance: findings about the instance live in the wiki and gate the run.');
  L.push('> Nothing here gates anything. Send it to whoever maintains the product.');
  L.push('>');
  L.push('> **Not scrubbed.** It quotes this run\'s own update-set names, instance name and page paths.');
  L.push('> Fine to hand to the product team; do not post it anywhere public.');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Run | \`${(state && state.runId) || '?'}\` against \`${(state && state.instance) || '?'}\` |`);
  L.push(`| Process | ${(state && state.stamps && state.stamps.processName) || bootstrap.process || '(unnamed)'} |`);
  L.push(`| Terminal state | ${(state && state.terminal) ? `\`${state.terminal}\`` : 'open — the run has not finished'} |`);
  L.push(`| Product commit | ${generator || 'unknown'} |`);
  L.push(`| Reported | ${new Date().toISOString().slice(0, 10)} |`);
  L.push(`| Findings | ${all.length} (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}) |`);
  L.push('');

  if (!all.length) {
    L.push('No quirk was recorded and nothing derived from the run\'s own record. That is a real result:');
    L.push('every stage was accepted first time, no bound was raised, and every page carries what its');
    L.push('evidence supports. If something still felt wrong, `snbrain quirk --note "..."` is how it');
    L.push('gets here — an unrecorded quirk is one the next run repeats.');
    L.push('');
  }

  for (const q of all) {
    L.push(`## ${q.severity.toUpperCase()} · ${q.summary}`);
    L.push('');
    L.push(`*${q.kind}${q.stage ? ` · stage \`${q.stage}\`` : ''}${q.by ? ` · reported by ${q.by}` : ''}${q.at ? ` · ${String(q.at).slice(0, 19).replace('T', ' ')}` : ''} · \`${q.id}\` · ${q.source}*`);
    L.push('');
    if (q.detail) { L.push(q.detail); L.push(''); }
    if ((q.evidence || []).length) {
      L.push('Evidence:');
      for (const e of q.evidence) { L.push(`- \`${e}\``); }
      L.push('');
    }
  }

  L.push('## Completeness measures, including the ones that passed');
  L.push('');
  L.push('Each wiki tier owns a population the ledger can count. Reported in full so a page that is');
  L.push('healthy is visible as healthy, and so a threshold that is wrong can be argued with.');
  L.push('');
  L.push('| Page | Owns | Evidence supports | Page carries | |');
  L.push('|---|---|---|---|---|');
  for (const r of assessment.rows) {
    L.push(`| \`${r.page}\` | ${r.owns} | ${r.expected} | ${r.present} | ${r.expected === 0 ? '—' : (r.ratio >= THIN_RATIO ? 'ok' : `${Math.round(r.ratio * 100)}%`)} |`);
  }
  L.push('');
  L.push(`Ledger: ${assessment.claims} claim(s) over ${assessment.artifacts} distinct artifact identities.`);
  L.push('');
  L.push('**What this does not measure:** whether a page is any good. Fullness is countable, usefulness');
  L.push('is not, and a check on usefulness is satisfied most cheaply by padding. That judgement belongs');
  L.push('to the generated probe suite, which is a named build item and does not exist yet.');
  L.push('');
  return { body: `${L.join('\n')}\n`, quirks: all, assessment, counts };
}

function writeReport(root, outRel) {
  const built = buildReport(root);
  const rel = outRel || 'FINDINGS.md';
  const abs = path.resolve(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, built.body, 'utf8');
  built.path = fwd(rel);
  return built;
}

module.exports = {
  QUIRK_KINDS, SEVERITIES, QUIRKS_FILE, THIN_RATIO,
  recordQuirk, recordedQuirks, deriveExecutionQuirks,
  assessCompleteness, completenessQuirks, buildReport, writeReport, quirkId, rejectionGist,
};
