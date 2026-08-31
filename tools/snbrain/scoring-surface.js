#!/usr/bin/env node
/*
 * scoring-surface.js — PLAN 6.11: the brain-surface manifest, machine-checked.
 *
 * The isolated re-score of run 3 moved +10 complete at 74% verdict agreement, and about 8 of
 * those 10 points were INCONSISTENT TREATMENT OF `.brain/raw/` — a directory that is
 * `.gitignore`d on purpose (PRODUCT-97) and will never ship. The scorers' brief named paths
 * without deciding what "the brain" MEANS: what the run produced, or what it hands over. This
 * file is that decision, stated once, with its rationale, and checkable against any engagement
 * repo — prose briefs drift, a checker does not.
 *
 * THE DECISION. Three tiers, and the scoring basis is the first:
 *
 *   wiki    — what a reader is handed: the wiki, the kernel (rendered + template + config),
 *             the skills, the hooks. THE LEADING BASIS: RUNS.md leads with wiki-only numbers,
 *             the only basis immune to all three recorded scoring flaws.
 *   ledger  — the committed .brain ledgers (claims/decisions/findings/questions + state.json).
 *             They ship, but a reader has to go DIGGING; a fact found only here scores in its
 *             own column (`foundIn: ledger`), never as wiki-complete.
 *   excluded — `.brain/raw/**` (gitignored, never ships), `.brain/in/**` (stage inbox),
 *             `.brain/index/**` and `.brain/history.ndjson` (machinery), framework build files.
 *             Evidence here PROVES NOTHING to a scorer: a verdict resting on it rests on a
 *             file the customer never receives.
 *
 * A path matching NO tier is UNDECLARED, and undeclared is an error by design: the manifest
 * must answer the question for every file class, not just list the ones someone thought of.
 *
 *   node tools/snbrain/scoring-surface.js --root <engagement repo>     check + report
 *   node tools/snbrain/scoring-surface.js --root <repo> --json         machine form
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Ordered: first match wins. `prefix` matches path segments from the repo root. */
const SURFACE = Object.freeze([
  { tier: 'excluded', prefix: '.brain/raw', why: 'gitignored whole-instance payloads (PRODUCT-97); never ships; 8 of 10 re-score points moved on inconsistent treatment of exactly this' },
  { tier: 'excluded', prefix: '.brain/in', why: 'the stage inbox — working files, not a deliverable' },
  { tier: 'excluded', prefix: '.brain/index', why: 'derived machinery, rebuilt on every write' },
  { tier: 'excluded', prefix: '.brain/history.ndjson', why: 'event log of the run, not knowledge about the customer' },
  { tier: 'ledger', prefix: '.brain', why: 'the committed ledgers: replayable evidence, citable, but a reader has to dig — foundIn: ledger, never wiki-complete' },
  { tier: 'wiki', prefix: 'docs/wiki', why: 'the deliverable a reader meets' },
  { tier: 'wiki', prefix: 'CLAUDE.md', why: 'the rendered kernel — the first thing an agent reads' },
  { tier: 'wiki', prefix: '.github/copilot-instructions.md', why: 'the kernel mirror' },
  { tier: 'wiki', prefix: 'kernel', why: 'the kernel template the rendered copy is generated from' },
  { tier: 'wiki', prefix: 'product.config.json', why: 'the slot registry the kernel renders from — landscape and naming live here' },
  { tier: 'wiki', prefix: '.claude/skills', why: 'build procedures — a quarter of both scored runs\' A/B hits came from installer-shipped doctrine' },
  { tier: 'wiki', prefix: '.claude/hooks', why: 'enforcement — minted convention gates cite their claims' },
  { tier: 'wiki', prefix: '.claude/settings.json', why: 'where the hooks are wired' },
  { tier: 'wiki', prefix: '.claude/workflows', why: 'shipped orchestration' },
  { tier: 'wiki', prefix: '.claude/commands', why: 'shipped commands' },
  { tier: 'excluded', prefix: 'docs/rework-plan.md', why: 'framework design of record, not customer knowledge' },
  { tier: 'excluded', prefix: 'tools', why: 'the loop\'s own machinery; knowing the pipeline is not knowing the customer' },
  { tier: 'excluded', prefix: '.claude/snbrain', why: 'the loop\'s own contract (LOOP.md); pipeline doctrine, not customer knowledge' },
  /*
   * Run 5's engagement directory doubled as the sn-scriptsync workspace, so the transport's
   * own files sit beside the deliverable: measured, 18 of its 20 undeclared paths were this
   * class. They are the TOOL's, not the brain's — a scorer crediting a fact found in
   * autocomplete/ or a request log is crediting the transport.
   */
  { tier: 'excluded', prefix: 'agentrules', why: 'sn-scriptsync\'s own skills, injected by the extension' },
  { tier: 'excluded', prefix: 'agentinstructions.md', why: 'sn-scriptsync generated instructions' },
  { tier: 'excluded', prefix: 'autocomplete', why: 'sn-scriptsync editor typings' },
  { tier: 'excluded', prefix: 'jsconfig.json', why: 'sn-scriptsync editor config' },
  { tier: 'excluded', prefix: 'audit.log', why: 'transport log' },
  { tier: 'excluded', prefix: 'debug.log', why: 'transport log' },
  { tier: 'excluded', prefix: 'spikes', why: 'request logs and probes — the transport\'s diary' },
  { tier: 'excluded', prefix: 'devinst02', why: 'scriptsync per-instance sync folder' },
  { tier: 'excluded', prefix: 'testinst01', why: 'scriptsync per-instance sync folder' },
  { tier: 'excluded', prefix: 'accinst01', why: 'scriptsync per-instance sync folder' },
  { tier: 'excluded', prefix: 'prodinst01', why: 'scriptsync per-instance sync folder' },
  { tier: 'excluded', prefix: 'package.json', why: 'workspace plumbing' },
  { tier: 'excluded', prefix: 'package-lock.json', why: 'workspace plumbing' },
  { tier: 'excluded', prefix: '.vscode', why: 'editor config' },
  { tier: 'excluded', prefix: '.gitignore', why: 'plumbing' },
  { tier: 'excluded', prefix: '.git', why: 'plumbing' },
  { tier: 'excluded', prefix: 'README.md', why: 'repo front door, duplicated by the wiki index' },
]);

function classify(rel) {
  const fwd = String(rel).split(path.sep).join('/');
  for (const rule of SURFACE) {
    if (fwd === rule.prefix || fwd.startsWith(`${rule.prefix}/`)) { return Object.assign({ path: fwd }, rule); }
  }
  return { path: fwd, tier: 'UNDECLARED', why: 'the manifest has not decided what this file class is — that is an error, not a default' };
}

function checkRepo(root) {
  const out = { wiki: [], ledger: [], excluded: [], UNDECLARED: [] };
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs);
      const top = rel.split(path.sep)[0];
      if (top === '.git') { continue; }
      if (e.isDirectory()) { walk(abs); continue; }
      const c = classify(rel);
      out[c.tier].push(c.path);
    }
  };
  walk(root);
  return out;
}

module.exports = { SURFACE, classify, checkRepo };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !/^--/.test(argv[i + 1]) ? argv[i + 1] : dflt;
  };
  const root = path.resolve(arg('--root', process.cwd()));
  const r = checkRepo(root);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ surface: SURFACE, counts: { wiki: r.wiki.length, ledger: r.ledger.length, excluded: r.excluded.length, undeclared: r.UNDECLARED.length }, undeclared: r.UNDECLARED }, null, 1)}\n`);
  } else {
    process.stdout.write(`scoring-surface: wiki ${r.wiki.length} · ledger ${r.ledger.length} · excluded ${r.excluded.length} · UNDECLARED ${r.UNDECLARED.length}\n`);
    for (const p of r.UNDECLARED.slice(0, 20)) { process.stdout.write(`  UNDECLARED ${p}\n`); }
    if (r.UNDECLARED.length > 20) { process.stdout.write(`  … and ${r.UNDECLARED.length - 20} more\n`); }
  }
  process.exit(r.UNDECLARED.length ? 1 : 0);
}
