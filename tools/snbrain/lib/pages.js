'use strict';
/*
 * pages.js — the deterministic pages the render worker used to write by hand.
 *
 * Every generator here exists because a finding measured what happens when it does not:
 *
 *   scaffoldWiki     — F8. The scaffold was copied verbatim and its `<fill at engagement>`
 *                      markers, DELETE-ME rows and dummy STRY ids reached terminal success on
 *                      the second engagement; the first run shipped CONTRACT.md's marker too.
 *                      Instantiation fills verification dates from run metadata, drops the
 *                      example rows in live pages, keeps them in _TEMPLATE files, and
 *                      parameterises the story template from naming.storySetFormat.
 *   buildIndexPage   — F7. Story pages must be linked from index.md; a hand-written index
 *                      links what the worker remembered to link.
 *   buildInterviewPage — F8. INTERVIEW.md reported a placeholder status after every queued
 *                      question had been answered. The questions ledger knows the answer.
 *   buildReadOnlyProof — F12. The request log lived at a non-default path, export named one
 *                      literal path, and the strongest artifact in the deliverable was omitted
 *                      with "absent, skipped". The log is resolved from run state, copied to a
 *                      stable name under the wiki, and summarised on a page.
 *   buildStoryPages  — F7. Five exact update sets and four work items were seeded; no story
 *                      page was generated and nothing consumed naming.storySetFormat. Pairing
 *                      is deterministic: the shared numeric work-item id in the set name, or the
 *                      induced story root. Sets that pair to nothing are a finding.
 *
 * Every page declares exactly the claim ids it prints (PRODUCT-95's rule), and its status is
 * computed from them like every other page.
 */

const fs = require('fs');
const path = require('path');
const render = require('../render.js');
const { countRequestLog } = require('./state.js');
const { decisionWikiNumbers } = require('./vocabulary.js');

const { esc, code, trunc, readJsonl, streamJsonl, latestById, pageStatus, claimIdsIn } = render;
const PRODUCT_ROOT = path.resolve(__dirname, '..', '..', '..');

function fwd(p) { return String(p).replace(/\\/g, '/'); }
function today() { return new Date().toISOString().slice(0, 10); }
function readJson(abs, dflt) {
  try { return JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')); } catch (e) { return dflt; }
}
function readConfig(root) { return readJson(path.join(root, 'product.config.json'), {}); }
function readState(root) { return readJson(path.join(root, '.brain', 'state.json'), null); }
function wikiOf(root, opts) {
  if (opts && opts.wiki) { return String(opts.wiki).replace(/\/+$/, ''); }
  const cfg = readConfig(root);
  return (cfg.paths && typeof cfg.paths.wikiRoot === 'string' ? cfg.paths.wikiRoot : 'docs/wiki').replace(/\/+$/, '');
}
function frontTitle(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  const m = /^title:\s*"?([^"\n]+?)"?\s*$/m.exec(text);
  if (m) { return m[1].trim(); }
  const h = /^#\s+(.+)$/m.exec(text);
  return h ? h[1].trim() : path.basename(abs, '.md');
}
function listMd(dir) {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir).filter((n) => /\.md$/i.test(n) && !/^_TEMPLATE\.md$/i.test(n)).sort();
}
/** Declare what the file prints: the only way the three counts agree by construction. */
function finish(rel, lines, claimsById, extraFront) {
  const bodyText = lines.join('\n');
  const ids = [...claimIdsIn(bodyText)];
  const status = ids.length ? pageStatus(ids, claimsById || new Map()) : 'draft';
  const front = ['---'].concat(extraFront || []).concat([`status: "${status}"`, `claims-rendered: ${ids.length}`, '---', '']).join('\n');
  return { path: rel, body: `${front}${bodyText}\n`, claimIds: ids, status };
}
function claimsMap(root) {
  return new Map(latestById(readJsonl(path.join(root, '.brain', 'claims.jsonl'))).map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// scaffold
// ---------------------------------------------------------------------------

function languageLine(config) {
  const lang = (config && config.language) || {};
  const src = String(lang.source || 'en');
  const targets = Array.isArray(lang.targets) ? lang.targets.filter(Boolean) : [];
  return targets.length
    ? `wiki pages in English; customer-facing text bilingual ${src.toUpperCase()}+${targets.map((t) => String(t).toUpperCase()).join('+')} (product.config.json language.*)`
    : `wiki pages in English; customer-facing text single-language ${src.toUpperCase()} (product.config.json language.*)`;
}

function scaffoldTransform(text, rel, ctx) {
  const isTemplate = /(^|\/)_TEMPLATE\.md$/i.test(rel);
  let out = text.replace(/\r\n/g, '\n');
  out = out.replace(/last-verified:\s*<fill at engagement>/g, `last-verified: ${ctx.date} (installed scaffold — not instance-verified)`);
  out = out.replace(/<path to your architecture\/design doc — fill at engagement>/g, "none recorded — processes/ and decisions.md are this brain's architecture source");
  out = out.replace(/<project documentation language — set at engagement>/g, languageLine(ctx.config));
  out = out.replace(/\{\{storySetFormat\}\}/g, ctx.storySetFormat);
  if (isTemplate) { return out; }
  out = out.replace(/<Project>/g, ctx.processName).replace(/<owner>/g, 'the project owner');
  out = out.replace(/^## Status: <open \/ .*$/m, '## Status: not yet generated — run `node tools/snbrain/render.js --root . --interview`');
  const kept = [];
  // A DELETE-ME HEADING starts an example block: everything up to the next heading or rule
  // is the example's body (the interview scaffold's "Context / Why / Answer: *(pending)*").
  let skippingLevel = 0;
  for (const line of out.split('\n')) {
    const heading = /^(#{1,6})\s/.exec(line);
    if (skippingLevel) {
      if ((heading && heading[1].length <= skippingLevel) || /^---\s*$/.test(line)) { skippingLevel = 0; } else { continue; }
    }
    if (heading && /\bDELETE-ME\b/.test(line)) { skippingLevel = heading[1].length; continue; }
    if (/\bDELETE-ME\b/.test(line) || /\bSTRY000000\d\b/.test(line)) { continue; }
    if (/^\s*\|(\s*\|){2,}\s*$/.test(line)) {
      const cells = line.split('|').length - 2;
      kept.push(`| _(none recorded by this run)_ |${' |'.repeat(Math.max(0, cells - 1))}`);
      continue;
    }
    kept.push(line);
  }
  // A DELETE-ME example's body line (the DEC-000 paragraph) follows its dropped heading; drop
  // the orphaned "(This dummy row shows the format …)" too. Both carried the dummy story id, so
  // the STRY000000 rule above already took them; this is the belt to that brace.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * A page a generator wrote. `claims-rendered:` is the accounting key every rendered page
 * carries (PRODUCT-95) and `generated-by:` is the appendix's; the scaffold carries neither.
 * Measured while replaying the fix on pilot-run-8: `--scaffold --force`, run to clear the
 * governance page's `<fill at engagement>`, overwrote the GENERATED glossary with the empty
 * scaffold — reintroducing the exact finding the glossary generator exists to close. `--force`
 * means "re-instantiate the scaffold", never "discard what the run produced".
 */
function isGenerated(abs) {
  if (!fs.existsSync(abs)) { return false; }
  const head = fs.readFileSync(abs, 'utf8').slice(0, 600);
  return /^claims-rendered:\s*\d+/m.test(head) || /^generated-by:/m.test(head) || /^page-kind:/m.test(head);
}

/**
 * Copy wiki-scaffold/ into the wiki root, transformed. An existing file is kept unless
 * `force`; a GENERATED page is kept even then, so a re-run after render never clobbers what
 * the run produced.
 */
function scaffoldWiki(root, opts) {
  const o = opts || {};
  const src = o.src || path.join(PRODUCT_ROOT, 'wiki-scaffold');
  if (!fs.existsSync(src)) { throw new Error(`no wiki scaffold at ${fwd(src)}`); }
  const wiki = wikiOf(root, o);
  const config = readConfig(root);
  const state = readState(root);
  const ctx = {
    date: o.date || today(),
    config,
    processName: (state && state.stamps && state.stamps.processName) || (config.customer && !/^REQUIRED/.test(String(config.customer.name)) && config.customer.name) || (state && state.instance) || 'Project',
    storySetFormat: (config.naming && typeof config.naming.storySetFormat === 'string' && config.naming.storySetFormat)
      || '(not established — set naming.storySetFormat in product.config.json)',
  };
  const written = [], skipped = [], kept = [];
  const walk = (dir, relDir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), rel); continue; }
      if (rel === 'README.md') { continue; }
      const destAbs = path.resolve(root, wiki, rel);
      if (fs.existsSync(destAbs) && o.force && isGenerated(destAbs)) { kept.push(`${wiki}/${rel}`); continue; }
      if (fs.existsSync(destAbs) && !o.force) { skipped.push(`${wiki}/${rel}`); continue; }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, scaffoldTransform(fs.readFileSync(path.join(dir, e.name), 'utf8'), rel, ctx), 'utf8');
      written.push(`${wiki}/${rel}`);
    }
  };
  walk(src, '');
  return { wiki, written, skipped, kept, date: ctx.date };
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

function buildIndexPage(root, opts) {
  const wiki = wikiOf(root, opts);
  const abs = (rel) => path.resolve(root, wiki, rel);
  const state = readState(root) || {};
  const stamps = state.stamps || {};
  const processName = stamps.processName || (state.facts && state.facts.seed && state.facts.seed.process && state.facts.seed.process.name) || state.instance || 'Project';
  const lines = [`# ${esc(processName)} — wiki index`, '', '> One line per page, plus a link. No prose here: this page is generated.', ''];
  const section = (title, rows) => { if (rows.length) { lines.push(`## ${title}`, '', ...rows, ''); } };
  const link = (rel, hook) => `- [${esc(frontTitle(abs(rel)))}](${rel})${hook ? ` — ${hook}` : ''}`;
  section('Processes', listMd(abs('processes')).map((n) => link(`processes/${n}`)));
  section('Stories', listMd(abs('stories')).map((n) => link(`stories/${n}`)));
  section('Ledgers', ['decisions.md', 'tbd.md', 'INTERVIEW.md'].filter((r) => fs.existsSync(abs(r))).map((r) => link(r)));
  section('Registries & references', ['registry-sys-ids.md', 'deployment-matrix.md', 'glossary.md', 'conventions.md', 'gotchas.md', 'gotchas-platform-catalogue.md', 'hard-rules.md', 'agent-api.md', 'CONTRACT.md']
    .filter((r) => fs.existsSync(abs(r))).map((r) => link(r)));
  section('Evidence (generated)', [['evidence/index.md', 'every claim, by table'], ['evidence/source/index.md', 'full script bodies'], ['evidence/read-only-proof.md', 'the run only ever read']]
    .filter(([r]) => fs.existsSync(abs(r))).map(([r, hook]) => link(r, hook)));
  const counters = state.counters || {};
  lines.push('## Run record — read before trusting any page', '',
    `- Built by snbrain run \`${state.runId || '?'}\` against **${state.instance || '?'}**, ${String(state.createdAt || '').slice(0, 10) || '?'}, read-only.`,
    `- Ledger: **${counters.claims || 0} claims**, **${counters.decisions || 0} decisions**, ${counters.findings || 0} findings.`,
    `- Entry: ${stamps.seed === 'provided' ? `seeded (input envelope \`${stamps.inputEnvelope || '?'}\`, anchor expansion \`${stamps.anchorExpansion || '?'}\`, seed adequacy \`${stamps.seedAdequacy || '?'}\`)` : `census path (seed ${stamps.seed || 'unknown'}${stamps.blind ? ', blind run' : ''})`}; provenance envelope \`${stamps.provenance || '?'}\`.`,
    `- Terminal state: ${state.terminal ? `\`${state.terminal}\`${state.terminalBy ? ` by ${state.terminalBy}` : ''}` : 'open — not yet finished'}.`,
    '- The evidence appendix renders every claim; curated pages select. When they disagree, the claim ledger wins — pages are a view.');
  return { page: finish(`${wiki}/index.md`, lines, claimsMap(root), ['title: "Wiki index"']) };
}

// ---------------------------------------------------------------------------
// interview
// ---------------------------------------------------------------------------

function buildInterviewPage(root, opts) {
  const wiki = wikiOf(root, opts);
  const questions = latestById(readJsonl(path.join(root, '.brain', 'questions.jsonl')));
  const decisions = latestById(readJsonl(path.join(root, '.brain', 'decisions.jsonl')));
  const numbers = decisionWikiNumbers(decisions);
  const decsByQ = new Map();
  for (const d of decisions) {
    const q = d.answerProvenance && d.answerProvenance.fromQuestion;
    if (!q) { continue; }
    if (!decsByQ.has(q)) { decsByQ.set(q, []); }
    decsByQ.get(q).push(numbers.get(d.id));
  }
  const by = (s) => questions.filter((q) => q.status === s);
  const answered = by('answered'), queued = by('queued'), deferred = by('deferred'), shadow = by('shadow'), suppressed = by('suppressed');
  const respondents = [...new Set(answered.map((q) => q.answer && q.answer.by).filter(Boolean))];
  const state = readState(root) || {};
  const status = queued.length
    ? `${queued.length} question(s) open for the next session`
    : (answered.length ? `every question put to the human was answered (${answered.length})` : 'no question has been put to a human yet');
  const qline = (q) => `- \`${q.id}\` (${q.gate}) — ${esc(trunc(String(q.question || '').replace(/C-[0-9a-f]{12}/g, 'C-…'), 160))}`;
  const lines = [
    '# Interview — questions for the project owner', '',
    '> Generated from `.brain/questions.jsonl` and `.brain/decisions.jsonl`. New questions are minted by the',
    '> question engine; answers are recorded through the interview stage so they land in the decision ledger.',
    '> Do not add free-form entries here.', '',
    `## Status: ${status}`, '',
    `Run \`${state.runId || '?'}\`${respondents.length ? ` · respondent(s): ${respondents.map(esc).join(', ')}` : ''} · ${questions.length} question(s) minted: ${answered.length} answered, ${queued.length} open, ${deferred.length} deferred, ${shadow.length} shadow (operator-graded controls, never asked), ${suppressed.length} suppressed.`, '',
  ];
  if (answered.length) {
    lines.push('## Answered', '');
    for (const q of answered) {
      const decs = decsByQ.get(q.id) || [];
      const a = q.answer || {};
      lines.push(`${qline(q)}\n  - ${a.kind === 'debt' ? `recorded as debt, owner ${esc(a.owner || '?')}${a.dueBy ? `, due ${a.dueBy}` : ''}` : (decs.length ? `→ ${decs.map((n) => `[${n}](decisions.md)`).join(', ')}` : `answered (${a.kind || 'decision'})`)}${a.by ? ` · ${esc(a.by)} ${a.at || ''}` : ''}`);
    }
    lines.push('');
  }
  if (queued.length) { lines.push('## Open — for the next session', '', ...queued.map(qline), ''); }
  if (deferred.length) { lines.push('## Deferred by the cap (recorded, not asked)', '', ...deferred.map(qline), ''); }
  if (shadow.length) { lines.push('## Shadow — raised by the evidence, held back as controls', '', `${shadow.length} question(s); see [tbd.md](tbd.md) where the render carried them.`, ''); }
  return { page: finish(`${wiki}/INTERVIEW.md`, lines, claimsMap(root), ['title: "Interview — open questions for the owner"']), totals: { answered: answered.length, queued: queued.length, deferred: deferred.length, shadow: shadow.length } };
}

// ---------------------------------------------------------------------------
// read-only proof
// ---------------------------------------------------------------------------

const WRITE_COMMAND_RE = /create_artifact|update_record|create_application|create_table|add_column|run_background_script|switch_context|delete_record|sync_now/i;

/** The authoritative request log, from run state first, conventional paths last. */
function resolveRequestLog(root, state) {
  const s = state || readState(root) || {};
  const cands = [];
  if (s.facts && s.facts.requestLog && s.facts.requestLog.path) { cands.push(s.facts.requestLog.path); }
  if (s.facts && s.facts.probe && s.facts.probe.path) {
    const doc = readJson(path.resolve(root, s.facts.probe.path), null);
    if (doc && doc.meta && doc.meta.logPath) { cands.push(doc.meta.logPath); }
  }
  if (s.syncRoot) { cands.push(path.join(s.syncRoot, 'spikes', 'scriptsync-read', 'snbrain-requests.ndjson')); }
  cands.push(path.join(root, 'spikes', 'scriptsync-read', 'snbrain-requests.ndjson'));
  for (const c of cands) { const abs = path.resolve(root, c); if (fs.existsSync(abs)) { return { path: abs, source: c === cands[0] && s.facts && s.facts.requestLog ? 'state.facts.requestLog' : 'resolved' }; } }
  return null;
}

function buildReadOnlyProof(root, opts) {
  const o = opts || {};
  const wiki = wikiOf(root, o);
  const state = readState(root) || {};
  const log = resolveRequestLog(root, state);
  const rejections = [];
  if (!log) {
    rejections.push('no request log could be resolved from run state (facts.requestLog, the probe results\' meta.logPath, <syncRoot>/spikes/scriptsync-read/, <root>/spikes/scriptsync-read/). ' +
      'The read-only proof is required evidence: every stage artifact names usage.requestLog, and lib/api.js appends to it before each request leaves.');
    return { page: null, copies: [], rejections, totals: null };
  }
  const rows = readJsonl(log.path);
  const sent = rows.filter((r) => r.phase === 'sent');
  const done = rows.filter((r) => r.phase === 'done');
  const commands = new Map(), methods = new Map(), endpoints = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const writeShaped = [];
  for (const r of sent) {
    bump(commands, r.command || '(none)');
    const p = r.params || {};
    if (r.command === 'rest_request') {
      bump(methods, String(p.method || 'GET').toUpperCase());
      bump(endpoints, String(p.endpoint || '?').replace(/\/[0-9a-f]{32}$/, '/<sys_id>'));
    }
    if (WRITE_COMMAND_RE.test(String(r.command || '')) || (r.command === 'rest_request' && String(p.method || 'GET').toUpperCase() !== 'GET')) {
      writeShaped.push(r);
    }
  }
  const counted = countRequestLog(log.path);
  const instances = [...new Set(sent.map((r) => r.instance).filter(Boolean))];
  const probeRel = state.facts && state.facts.probe && state.facts.probe.path ? path.resolve(root, state.facts.probe.path) : null;
  const probe = probeRel && fs.existsSync(probeRel) ? readJson(probeRel, null) : null;
  const p8 = probe && Array.isArray(probe.results) ? probe.results.find((r) => r.id === 8) : null;
  const gates = p8 && p8.data ? { gates: p8.data.gates, license: p8.data.license, tier: p8.data.raw && p8.data.raw.tier, capabilities: p8.data.raw && p8.data.raw.capabilities } : null;
  const dir = `${wiki}/evidence/read-only-proof`;
  const copies = [{ from: log.path, to: `${dir}/snbrain-requests.ndjson` }];
  if (probe) { copies.push({ from: probeRel, to: `${dir}/probe-results.json` }); }
  const first = sent.length ? sent[0].at : null, last = done.length ? done[done.length - 1].at : (sent.length ? sent[sent.length - 1].at : null);
  const lines = [
    '# Read-only proof — the run only ever read', '',
    '> Generated from the append-before-send request log that `tools/snbrain/lib/api.js` writes. The log is the',
    '> artifact you hand the instance owner: every command that left this machine, in order, before it left.',
    '> Copied here to a stable name from its operating path so the proof travels with the brain.', '',
    '| Measure | Value |', '|---|---|',
    `| Calls sent | **${sent.length}** (${done.length} completions logged; \`countRequestLog\` agrees: ${counted === null ? 'n/a' : counted}) |`,
    `| Instance(s) | ${instances.map(code).join(', ') || '—'} |`,
    `| Window | ${first || '?'} → ${last || '?'} |`,
    `| Write-shaped calls | **${writeShaped.length}**${writeShaped.length ? ' — LISTED BELOW; this brain must not claim read-only' : ' — none: every command is a read'} |`,
    // Repo-relative when the log is inside the root, absolute when it is not: a `../..` chain
    // out of the repo is not a path a reader can act on, and the whole point of F12 is that the
    // log may legitimately live anywhere the run put it.
    `| Operating log path | \`${(() => { const r = fwd(path.relative(root, log.path)); return !r || r.startsWith('..') ? fwd(log.path) : r; })()}\` (resolved from ${log.source === 'state.facts.requestLog' ? 'run state: facts.requestLog' : 'the probe results / conventional paths'}) |`,
    `| Stable copy | [snbrain-requests.ndjson](read-only-proof/snbrain-requests.ndjson) |`,
    probe ? `| Closing capability snapshot | [probe-results.json](read-only-proof/probe-results.json) (probe run ${probe.meta && probe.meta.date ? probe.meta.date : '?'}, ${probe.meta && probe.meta.callsUsed !== undefined ? probe.meta.callsUsed : '?'} calls) |` : '| Closing capability snapshot | not recorded — no probe results path in run state |',
    '',
    '## Commands', '', '| Command | Calls |', '|---|---|',
    ...[...commands.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${code(k)} | ${v} |`), '',
  ];
  if (methods.size) {
    lines.push('## REST methods', '', '| Method | Calls |', '|---|---|', ...[...methods.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '');
    lines.push('## Endpoints (top 15)', '', '| Endpoint | Calls |', '|---|---|', ...[...endpoints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `| ${code(k)} | ${v} |`), '');
  }
  if (writeShaped.length) {
    lines.push('## Write-shaped calls — MUST be explained', '', ...writeShaped.slice(0, 20).map((r) => `- ${r.at} ${code(r.command)} ${esc(JSON.stringify(r.params || {}).slice(0, 120))}`), '');
  }
  if (gates) {
    lines.push('## Closing capability gates (probe 8, verbatim keys)', '', '```json', JSON.stringify(gates, null, 1).slice(0, 1500), '```', '');
  }
  lines.push('## Re-verify', '', 'Count the `"phase":"sent"` lines in the stable copy; the number above must match. Every `rest_request` must carry `"method":"GET"`; every other command must be a read (`check_connection`, `get_capabilities`, `query_records`, `dictionary` reads).', '');
  const page = finish(`${wiki}/evidence/read-only-proof.md`, lines, new Map(), ['title: "Read-only proof"', 'page-kind: "generated-proof"']);
  page.status = 'probe-backed';
  page.body = page.body.replace(/^status: "draft"$/m, 'status: "probe-backed"');
  return { page, copies, rejections, totals: { calls: sent.length, commands: commands.size, writeShaped: writeShaped.length, counted, instances } };
}

function writeReadOnlyProof(root, opts) {
  const built = buildReadOnlyProof(root, opts);
  if (built.rejections.length) { return built; }
  for (const c of built.copies) {
    const to = path.resolve(root, c.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(c.from, to);
  }
  const abs = path.resolve(root, built.page.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, built.page.body, 'utf8');
  built.written = true;
  return built;
}

// ---------------------------------------------------------------------------
// stories
// ---------------------------------------------------------------------------

function storyRegex(state) {
  try { return state && state.stamps && state.stamps.storyPattern ? new RegExp(state.stamps.storyPattern) : null; } catch (e) { return null; }
}
/** The numeric work-item id embedded in a pointer or a set name: the first run of 5+ digits. */
function workItemOf(value) {
  const m = /(?:^|\D)(\d{5,})(?:\D|$)/.exec(String(value || ''));
  return m ? m[1] : null;
}
function rootOf(value, re) {
  if (!re) { return null; }
  const m = re.exec(String(value || ''));
  return m ? (m[1] || m[0]) : null;
}
function hasToken(text, token) { return new RegExp(`(^|[^0-9A-Za-z])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9A-Za-z]|$)`).test(String(text || '')); }
/** File-safe, case-preserving: a story id is a name the customer types, and STRY0100001.md is what they look for. */
function slug(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'story'; }

/** The anchor's sets: from facts (new runs), else the raw anchor-set rows, else the stage artifact. */
function anchorSets(root, state) {
  const norm = (s) => ({ sysId: s.sysId, name: String(s.name || ''), members: Number(s.members) || 0, role: s.role, via: s.via || null, story: s.story || null });
  if (state && state.facts && state.facts.anchor && Array.isArray(state.facts.anchor.sets)) { return state.facts.anchor.sets.map(norm); }
  const raw = path.join(root, '.brain', 'raw', 'anchor.ndjson');
  if (fs.existsSync(raw)) {
    const rows = readJsonl(raw).filter((r) => r.kind === 'anchor-set');
    if (rows.length) { return latestById(rows.map((r) => Object.assign({ id: r.sysId }, r))).map(norm); }
  }
  const art = readJson(path.join(root, '.brain', 'in', 'anchor.json'), null);
  return art && Array.isArray(art.sets) ? art.sets.map(norm) : [];
}

function buildStoryPages(root, opts) {
  const o = opts || {};
  const wiki = wikiOf(root, o);
  const state = readState(root) || {};
  const re = storyRegex(state);
  const pointers = ((state.queue || {}).seedPointers || []).filter((p) => p && (p.kind === 'story' || p.kind === 'epic'));
  const sets = anchorSets(root, state).filter((s) => s.role !== 'excluded');
  const tracker = (state.facts || {}).tracker || {};
  const claimsById = claimsMap(root);
  const decisions = latestById(readJsonl(path.join(root, '.brain', 'decisions.jsonl')));
  const numbers = decisionWikiNumbers(decisions);

  // One story unit per pointer (keyed by work item id, else its story root), then one per
  // story root the anchor found that no pointer named — the induced-pattern route.
  const stories = new Map();
  const unit = (key, title, kind, pointer) => {
    if (!stories.has(key)) { stories.set(key, { key, title, kind, pointers: [], sets: [], roots: new Set(), workItems: new Set() }); }
    return stories.get(key);
  };
  for (const p of pointers) {
    const id = workItemOf(p.value);
    const root_ = rootOf(p.value, re);
    const key = id || root_ || slug(p.value);
    const u = unit(key, String(p.value).replace(/^\s*\d{5,}\s*[-—:]?\s*/, '').trim() || String(p.value), p.kind, p);
    u.pointers.push(p);
    if (id) { u.workItems.add(id); }
    if (root_) { u.roots.add(root_); }
  }
  const paired = new Set();
  for (const s of sets) {
    for (const u of stories.values()) {
      const byId = [...u.workItems].some((id) => hasToken(s.name, id));
      const byRoot = [...u.roots].some((r) => rootOf(s.name, re) === r || (s.story && rootOf(s.story, re) === r));
      if (byId || byRoot) { u.sets.push(s); paired.add(s.sysId); }
    }
  }
  /*
   * The induced route pages SEEDED sets only. A recovered set is, by the anchor's own
   * definition, another story's history (a neighbour reached through a version chain); it
   * pairs into a seeded story when it shares the root and is otherwise neither a page nor a
   * finding. Measured on the first run: paging every recovered root produced 17 pages for a
   * three-story process, 11 of them the H&S form-design neighbours.
   */
  const setTitle = (name) => String(name).replace(/^\S+\s+-\s+/, '').replace(/\s+-\s+Batch (Parent|Child)\s*$/i, '').trim() || String(name);
  for (const s of sets) {
    if (paired.has(s.sysId) || s.role !== 'seeded') { continue; }
    const r = rootOf(s.name, re) || (s.story ? rootOf(s.story, re) : null);
    if (!r) { continue; }
    const u = unit(r, setTitle(s.name), 'induced', null);
    u.roots.add(r);
    u.sets.push(s);
    paired.add(s.sysId);
    // Sibling seeded sets and recovered sets sharing this root join the same page.
    for (const t of sets) {
      if (paired.has(t.sysId)) { continue; }
      if (rootOf(t.name, re) === r || (t.story && rootOf(t.story, re) === r)) { u.sets.push(t); paired.add(t.sysId); }
    }
  }
  const unpaired = sets.filter((s) => !paired.has(s.sysId) && s.role === 'seeded');

  // Claims per set, streamed: only provenance is needed.
  const setIds = new Set(sets.map((s) => s.sysId));
  const bySet = new Map();
  streamJsonl(path.join(root, '.brain', 'claims.jsonl'), (c) => {
    const us = (c && c.provenance && c.provenance.updateSets) || [];
    for (const u of us) {
      if (u && setIds.has(u.sysId)) {
        if (!bySet.has(u.sysId)) { bySet.set(u.sysId, new Map()); }
        const t = c.locus && c.locus.table ? c.locus.table : '(no table)';
        const m = bySet.get(u.sysId);
        if (!m.has(t)) { m.set(t, new Set()); }
        m.get(t).add(c.id);
      }
    }
    return null;
  });

  const instance = state.instance || '?';
  const pages = [];
  const summary = [];
  for (const u of [...stories.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const rel = `${wiki}/stories/${slug(u.key)}.md`;
    const byTable = new Map();
    for (const s of u.sets) {
      for (const [t, ids] of (bySet.get(s.sysId) || new Map())) {
        if (!byTable.has(t)) { byTable.set(t, new Set()); }
        for (const id of ids) { byTable.get(t).add(id); }
      }
    }
    const total = [...byTable.values()].reduce((n, s) => n + s.size, 0);
    const trackerLine = tracker.kind && tracker.kind !== 'unknown'
      ? `${tracker.kind}${tracker.org ? ` ${tracker.org}` : ''}${tracker.project ? `/${tracker.project}` : ''}` : 'not recorded';
    const links = u.pointers.filter((p) => p.url).map((p) => p.url);
    const decs = decisions.filter((d) => [...u.workItems, ...u.roots].some((k) => hasToken(d.statement, k) || hasToken(d.answerProvenance && d.answerProvenance.verbatim, k)));
    const lines = [
      '> Immutable build record (wiki story tier). For CURRENT behavior always consult the',
      '> process pages / live instance — never this page.', '',
      `# ${esc(u.key)} — ${esc(u.title)}`, '',
      `Generated by \`node tools/snbrain/render.js --stories\` from the seed pointers and the anchor's resolved update sets. ` +
      `Source: ${u.kind === 'induced' ? `the story root \`${u.key}\` induced from update-set names (pattern \`${state.stamps && state.stamps.storyPattern}\`); no seed pointer named it` : `seed pointer(s) of kind ${u.kind}${u.workItems.size ? `, work item ${[...u.workItems].join(', ')}` : ''}`}. ` +
      `Tracker: ${esc(trackerLine)}${links.length ? ` — ${links.map((l) => `<${l}>`).join(', ')}` : ''}.`, '',
      '## Update sets', '',
    ];
    if (u.sets.length) {
      lines.push('| Set | sys_id | Members | Role |', '|---|---|---|---|');
      for (const s of u.sets) { lines.push(`| ${esc(s.name)} | ${code(s.sysId)} | ${s.members} | ${s.role}${s.via ? ` (${s.via})` : ''} |`); }
    } else {
      lines.push(`**Unresolved link:** no update set resolved on ${instance} carries work item ${[...u.workItems].join(', ') || u.key} in its name` +
        `${re ? ' or matches its story root' : ''}. The story is recorded because a human pointed at it; what shipped it is not in this ledger.`);
    }
    lines.push('', '## Shipped records (from claim provenance)', '');
    if (total) {
      lines.push(`**${total} claim(s)** carry one of these sets in their provenance, across ${byTable.size} table(s). Representative claim ids per table (the full evidence is in the [appendix](../evidence/index.md)):`, '');
      let budget = 12;
      for (const [t, ids] of [...byTable.entries()].sort((a, b) => b[1].size - a[1].size)) {
        const sample = [...ids].slice(0, Math.max(1, Math.min(3, budget)));
        budget -= sample.length;
        lines.push(`- \`${t}\` — ${ids.size} claim(s): ${sample.map(code).join(', ')}${ids.size > sample.length ? ', …' : ''}`);
        if (budget <= 0) { lines.push('- …'); break; }
      }
    } else {
      lines.push('No harvested claim carries these sets in its provenance — the sets resolved, their members were not in the harvested surface, or the run never reached harvest.');
    }
    lines.push('', '## Decisions that name this story', '');
    if (decs.length) { for (const d of decs) { lines.push(`- [${numbers.get(d.id)}](../decisions.md) — ${esc(trunc(String(d.statement || ''), 140))}`); } }
    else { lines.push('None recorded: no decision statement names this work item or story root.'); }
    lines.push('', '## Deploy notes', '', `Environment state for these sets is recorded on [deployment-matrix.md](../deployment-matrix.md): built on ${esc(instance)} by resolution; every other environment is UNKNOWN until read there.`);
    const front = [
      `title: "${esc(u.key)} — ${esc(u.title).replace(/"/g, "'")}"`,
      `story: ${u.key}`,
      `tracker: "${esc(trackerLine).replace(/"/g, "'")}"`,
      `story-status: ${u.sets.length ? 'shipped — update sets resolved' : 'unresolved — no update set paired'}`,
      `updated-sets: [${u.sets.map((s) => `"${esc(s.name).replace(/"/g, "'")}"`).join(', ')}]`,
      `mentions: [${u.sets.map((s) => `"${esc(s.name).replace(/"/g, "'")}"`).join(', ')}]`,
    ];
    pages.push(finish(rel, lines, claimsById, front));
    summary.push({ key: u.key, title: u.title, kind: u.kind, sets: u.sets.map((s) => s.name), claims: total, path: rel });
  }
  return { pages, stories: summary, unpaired, wiki, instance, totals: { stories: pages.length, sets: sets.length, unpaired: unpaired.length, pointers: pointers.length } };
}

const MATRIX_START = '<!-- snbrain:deployment-matrix:start -->';
const MATRIX_END = '<!-- snbrain:deployment-matrix:end -->';

/** Splice the story × environment rows into deployment-matrix.md, replacing the scaffold table. */
function spliceDeploymentMatrix(root, built) {
  const abs = path.resolve(root, built.wiki, 'deployment-matrix.md');
  let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8')
    : '---\ntitle: "Deployment matrix"\nstatus: "draft"\nclaims-rendered: 0\n---\n\n# Deployment Matrix — story × environment\n\n## Matrix\n';
  const rows = [];
  for (const s of built.stories) {
    for (const name of s.sets) { rows.push(`| ${esc(name)} (${esc(s.key)}) | built — resolved on ${esc(built.instance)} | UNKNOWN | UNKNOWN | UNKNOWN |`); }
    if (!s.sets.length) { rows.push(`| ${esc(s.key)} — no set paired | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |`); }
  }
  for (const s of built.unpaired) { rows.push(`| ${esc(s.name)} — pairs to no story | built — resolved on ${esc(built.instance)} | UNKNOWN | UNKNOWN | UNKNOWN |`); }
  const block = [MATRIX_START, '| Story / set | dev | test | acc | prod |', '|---|---|---|---|---|',
    ...(rows.length ? rows : ['| _(no seeded story or update set on this run)_ | | | | |']),
    '', `Generated by \`render.js --stories\` on ${today()}: "built" = the set resolved on the mapped instance with members > 0; every other environment is UNKNOWN until read there (an unauthenticated read returns silent-empty, not an error).`, MATRIX_END].join('\n');
  const s = text.indexOf(MATRIX_START), e = text.indexOf(MATRIX_END);
  if (s >= 0 && e > s) { text = text.slice(0, s) + block + text.slice(e + MATRIX_END.length); }
  else {
    // Replace the first markdown table after "## Matrix" (the scaffold's), else append.
    const m = /## Matrix[^\n]*\n([\s\S]*?)(\n## |$)/.exec(text);
    if (m) {
      const section = m[1];
      const tbl = /(\|[^\n]*\|\n)+/.exec(section);
      const newSection = tbl ? section.replace(tbl[0], `${block}\n`) : `${section.replace(/\s*$/, '')}\n\n${block}\n`;
      text = text.replace(section, newSection);
    } else { text = `${text.replace(/\s*$/, '')}\n\n## Matrix\n\n${block}\n`; }
  }
  fs.writeFileSync(abs, text, 'utf8');
  return `${built.wiki}/deployment-matrix.md`;
}

function writeStoryPages(root, opts) {
  const built = buildStoryPages(root, opts);
  for (const p of built.pages) {
    const abs = path.resolve(root, p.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.body, 'utf8');
  }
  built.matrixPath = spliceDeploymentMatrix(root, built);
  built.written = true;
  return built;
}

function writePage(root, built) {
  const abs = path.resolve(root, built.page.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, built.page.body, 'utf8');
  built.written = true;
  return built;
}

module.exports = {
  scaffoldWiki, scaffoldTransform, languageLine,
  buildIndexPage, buildInterviewPage, buildReadOnlyProof, writeReadOnlyProof, resolveRequestLog,
  buildStoryPages, writeStoryPages, spliceDeploymentMatrix, workItemOf, anchorSets,
  writePage, MATRIX_START, MATRIX_END, WRITE_COMMAND_RE,
};
