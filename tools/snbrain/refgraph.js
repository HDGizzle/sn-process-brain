#!/usr/bin/env node
/*
 * METHOD-6 — the reference graph of a finished brain, as a report. Zero instance reads.
 *
 * The ledger's unit is a claim (one record, one field). The product's unit is a CHAIN: a sequence
 * of artifacts where each references the next. An edge is DANGLING when its target sys_id appears
 * as no claim's locus, and that is a chain the reader cannot follow.
 *
 * THE GRAPH ITSELF LIVES IN lib/stages.js, not here. This file is a viewer. The loop raises the
 * findings from `danglingFindings` at the verify stage, and if the number in a finding and the
 * number in this report could ever disagree, the measurement would be worth nothing — METHOD-5.
 * The two things this file adds are the per-class table and the per-process-page intact rate,
 * because the second is what ordered the head-to-head tasks correctly.
 *
 *   node tools/snbrain/refgraph.js [repo-root] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./render.js');
const S = require('./lib/stages.js');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ROOT = path.resolve(args.filter((a) => !a.startsWith('--'))[0] || process.cwd());

const claims = [];
const claimIds = new Map();
R.streamJsonl(path.join(ROOT, '.brain', 'claims.jsonl'), (c) => {
  if (!c || !c.locus || !c.locus.table || !c.locus.sysId) { return null; }
  claims.push(c);
  return null;
});

const g = S.referenceGraph(claims);
const findings = S.danglingFindings(claims);
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : '0.0');

/* Per process page: the outgoing edges of the artifacts the page actually cites. */
const pages = [];
const wiki = path.join(ROOT, 'docs', 'wiki', 'processes');
if (fs.existsSync(wiki)) {
  for (const f of fs.readdirSync(wiki).filter((x) => /\.md$/.test(x) && !/_TEMPLATE/.test(x)).sort()) {
    const body = fs.readFileSync(path.join(wiki, f), 'utf8');
    const arts = new Set();
    for (const id of R.claimIdsIn(body)) {
      const k = g.artifactOf.get(id);
      if (k) { arts.add(k.split('|')[1]); }
    }
    const out = g.mech.filter((e) => arts.has(e.from));
    const d = out.filter((e) => !g.known.has(e.to));
    pages.push({ page: f, cited: arts.size, edges: out.length, dangling: d.length, intact: out.length ? Number(pct(out.length - d.length, out.length)) : null });
  }
}

if (asJson) {
  console.log(JSON.stringify({
    root: ROOT,
    artifacts: g.artifacts, withResponse: g.withResponse,
    mechanism: g.mechanism, dangling: g.dangling, targets: g.targets,
    inline: g.inline, inlineDangling: g.inlineDangling, bookkeeping: g.bookkeeping,
    classes: g.classes, brokenClasses: g.broken.length,
    filedIndividually: findings.length - 1,
    broken: g.broken, pages,
  }, null, 2));
  process.exit(0);
}

console.log('# Reference graph — ' + ROOT);
console.log('artifacts (rows) ............... ' + g.artifacts + '  (' + g.withResponse + ' carry a captured response)');
console.log('mechanism reference edges ...... ' + g.mechanism);
console.log('  resolve to a mapped artifact . ' + (g.mechanism - g.dangling));
console.log('  DANGLING ..................... ' + g.dangling + '  (' + pct(g.dangling, g.mechanism) + '%)');
console.log('distinct unreachable targets ... ' + g.targets);
console.log('inline edges (sys_id in text) .. ' + g.inline + ', of which ' + g.inlineDangling + ' dangling');
console.log('bookkeeping excluded ........... ' + g.bookkeeping + ' edges');
console.log('broken classes ................. ' + g.broken.length + ' of ' + g.classes + ' (table.column)');
console.log('findings the loop would raise .. ' + findings.length
  + '  (' + (findings.length - 1) + ' per-class at >=' + S.DANGLING_CLASS_MIN_TARGETS + ' targets, plus 1 aggregate)');
console.log('');
console.log('## Broken classes, by distinct unreachable targets');
console.log('');
console.log('  targets  edges  inline  resolves-to          table.column');
for (const s of g.broken.slice(0, 26)) {
  const res = s.resolvesTo.slice(0, 2).join('/') || '(never)';
  console.log('  ' + String(s.targets).padStart(7) + '  ' + String(s.dangling).padStart(5)
    + '  ' + String(s.inline).padStart(6) + '  ' + res.padEnd(20) + ' ' + s.table + '.' + s.column);
}
console.log('');
console.log('## Per process page — outgoing edges of the artifacts it cites');
console.log('');
console.log('  cited  edges  dangling  intact%   page');
for (const p of pages) {
  console.log('  ' + String(p.cited).padStart(5) + '  ' + String(p.edges).padStart(5) + '  '
    + String(p.dangling).padStart(8) + '  ' + (p.intact === null ? '   —' : p.intact.toFixed(1) + '%').padStart(7)
    + '   ' + p.page);
}
