#!/usr/bin/env node
/**
 * mutate.js — METHOD-4's repo-side companion. Break each guard on a COPY of this repo, run the
 * suite, and check the suite notices. A mutation the suite does not catch is a test that is not
 * testing, and a green suite over untested guards is the silence this whole register is about.
 *
 * WHY IT LIVES HERE. `METHOD-4`'s recurrence check named `scratchpad/mutate.js` — a file in a
 * per-session temp directory, which is to say a check with no runner. It had to be rewritten from
 * the entry's prose the next time anyone wanted to run it, and a rewritten harness measures a
 * rewritten thing. `METHOD-3` says a `fixed` entry needs a mechanism that EXISTS; so does a
 * recurrence check.
 *
 * WHAT IT DOES NOT DO. Mutation coverage is not correctness — that is `METHOD-4`'s own headline,
 * measured: five of six guards passed 7/7 mutation testing while being wrong on real data. A
 * mutation proves the suite notices a CHANGE. Whether the guard does the right thing on data the
 * tests do not contain is answered by replaying it against a finished run's `.brain/`, and nothing
 * here substitutes for that.
 *
 * An anchor that is not found prints `ANCHOR NOT FOUND` and is NEVER counted as caught: a guard
 * that moved would otherwise have its mutation silently skipped, which reads exactly like coverage
 * in a summary line. That output is part of the check.
 *
 *   node tools/snbrain/mutate.js                          all mutations, sequentially
 *   node tools/snbrain/mutate.js --shard 0 --shards 6     one worker of six, own copy
 *   node tools/snbrain/mutate.js --only <id>              one mutation
 *   node tools/snbrain/mutate.js --work <dir>             where copies go (default: os.tmpdir())
 *
 * Sharding exists because one suite run costs ~2m20s in a Windows temp directory and the list
 * below is 24 long. Each worker gets its OWN copy: two workers mutating one tree produce results
 * that are correct-looking and meaningless.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** The repo root, from this file's own location. Never a hardcoded path. */
const SRC = path.resolve(__dirname, '..', '..');

/**
 * Each mutation: the file (relative to tools/snbrain), an anchor that must appear EXACTLY once,
 * and what to put in its place. Anchors are whole lines or whole expressions on purpose — a
 * fragment that matches twice is reported rather than guessed at.
 */
const MUTATIONS = [
  // --- PLAN 6.1 · render.js -------------------------------------------------
  { id: 'check-frontmatter-count', file: 'render.js',
    from: 'if (declared !== null && declared !== printedHere) {',
    to: 'if (false) {' },
  { id: 'check-unmentioned-tables', file: 'render.js',
    from: '.filter(([t]) => !text.includes(t))',
    to: '.filter(() => false)' },
  { id: 'appendix-drops-record-claims', file: 'render.js',
    from: '    if (keyed.has(id)) { continue; }',
    to: '    if (true) { continue; }' },
  { id: 'appendix-ignores-the-page-cap', file: 'render.js',
    from: 'const cap = o.byteCap || PAGE_BYTE_CAP;',
    to: 'const cap = o.byteCap || (PAGE_BYTE_CAP * 1000);' },
  { id: 'appendix-count-not-derived', file: 'render.js',
    from: '      `claims-rendered: ${ids.size}`,',
    to: '      `claims-rendered: ${ids.size + 1}`,' },
  // --- PLAN 6.1 · render.validate -------------------------------------------
  { id: 'render-manifest-id-not-on-page', file: 'lib/stages.js',
    from: '        if (notPrinted.length) {',
    to: '        if (false) {' },
  { id: 'render-page-id-not-in-manifest', file: 'lib/stages.js',
    from: '        if (notCited.length) {',
    to: '        if (false) {' },
  { id: 'render-claims-rendered-miscount', file: 'lib/stages.js',
    from: '        if (miscounted.length) {',
    to: '        if (false) {' },
  // --- PLAN 6.2 · the required columns and the empty-assertion rule ----------
  { id: 'harvest-required-column', file: 'lib/stages.js',
    from: '          if (missingMust.length) {',
    to: '          if (false) {' },
  { id: 'harvest-must-escape-is-table-wide', file: 'lib/stages.js',
    from: '          const missingMust = missingMustAll.filter((f) => !new RegExp(`no-column:\\\\s*${esc(table)}\\\\.${esc(f)}\\\\b`, \'i\').test(note));',
    to: '          const missingMust = missingMustAll.filter(() => !new RegExp(`no-column:\\\\s*${esc(table)}\\\\.`, \'i\').test(note));' },
  { id: 'empty-assertion-guard-off', file: 'lib/stages.js',
    from: '      const emptyBad = emptyAssertionViolations(art.claims);\n      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, \'claim(s) in this harvest\')); }',
    to: '      const emptyBad = [];\n      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, \'claim(s) in this harvest\')); }' },
  { id: 'empty-assertion-explain-off', file: 'lib/stages.js',
    from: '      const emptyBad = emptyAssertionViolations(art.claims);\n      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, \'behaviour claim(s)\')); }',
    to: '      const emptyBad = [];\n      if (emptyBad.length) { rej.push(emptyAssertionRejection(emptyBad, \'behaviour claim(s)\')); }' },
  { id: 'empty-assertion-not-scoped-to-table', file: 'lib/stages.js',
    from: '      if (!looksLikeColumn(field, c)) { continue; }',
    to: '      if (!(field.includes(\'_\') || looksLikeColumn(field, c))) { continue; }' },
  { id: 'empty-assertion-substring-not-token', file: 'lib/stages.js',
    from: '      if (requested.has(field)) { continue; }',
    to: '      if (String((c.evidence || {}).fields || \'\').includes(field)) { continue; }' },
  { id: 'empty-assertion-head-of-list-only', file: 'lib/stages.js',
    from: '      for (const part of String(m[1] || m[2] || m[3] || \'\').split(/\\s+(?:nor|or|and)\\s+|,\\s*/)) {',
    to: '      for (const part of [String(m[1] || m[2] || m[3] || \'\')]) {' },
  { id: 'body-fields-loses-a-required-column', file: 'lib/stages.js',
    from: "must: ['condition', 'script', 'group', 'user'] }",
    to: "must: ['condition'] }" },
  { id: 'sf-state-flow-back-to-a-column-that-does-not-exist', file: 'lib/stages.js',
    from: "    shape: ['active', 'start_text', 'end_text', 'starting_state', 'ending_state', 'roles', 'manual_roles', 'automatic_roles'],",
    to: "    shape: ['active', 'from_state', 'to_state', 'roles', 'manual_roles', 'automatic_roles']," },
  // --- the head-to-head round · fetched-but-unclaimed, PRODUCT-88, PRODUCT-99 -
  { id: 'appendix-drops-fetched-unclaimed-columns', file: 'render.js',
    from: '    if (claimed.has(f)) { continue; }',
    to: '    if (true) { continue; }' },
  /*
   * Anchored on the whole per-column row, not on the marker string: the marker appears twice
   * (per-column and the compressed audit row) and a two-match anchor is reported ANCHOR NOT FOUND
   * and skipped — which reads exactly like coverage in a summary line. That is the failure this
   * harness prints rather than counts, and it caught itself here.
   */
  { id: 'appendix-unclaimed-columns-unmarked', file: 'render.js',
    from: "    lines.push(`| ${code(f)} | ${esc(cell(a.fetched[f])) || '_empty_'} | _fetched, never claimed_ |`);",
    to: "    lines.push(`| ${code(f)} | ${esc(cell(a.fetched[f])) || '_empty_'} | |`);" },
  { id: 'empty-stratum-finding-off', file: 'lib/stages.js',
    from: '        const strata = emptyStrata(art.claims);',
    to: '        const strata = [];' },
  { id: 'empty-stratum-walks-claimed-fields-only', file: 'lib/stages.js',
    from: '      if (!meaning.has(field)) { continue; }',
    to: '      if (!meaning.has(field) || field !== (c.locus && c.locus.field)) { continue; }' },
  { id: 'empty-stratum-unscoped', file: 'lib/stages.js',
    from: '    if (!meaning || !meaning.size) { continue; }',
    to: '    if (false) { continue; }' },
  { id: 'empty-stratum-no-minimum', file: 'lib/stages.js',
    from: '    .filter((s) => s.loci >= min && s.loci === s.empty)',
    to: '    .filter((s) => s.loci === s.empty)' },
  { id: 'decision-result-loses-its-defining-child', file: 'lib/stages.js',
    from: "      also: { document: 'sys_decision_multi_result' },",
    to: "      also: null," },
  { id: 'kernel-routing-integrity-off', file: 'lib/stages.js',
    from: "          const missing = [...named].filter((slug) => !declared.has(slug)",
    to: "          const missing = [].filter((slug) => !declared.has(slug)" },
  { id: 'kernel-routing-scans-prose-too', file: 'lib/stages.js',
    from: "            if (!/^\\s*\\|/.test(line)) { continue; }",
    to: '            if (false) { continue; }' },
  { id: 'ui-policy-loses-ui-type', file: 'lib/stages.js',
    from: "must: ['conditions', 'script_true', 'script_false', 'ui_type'] },",
    to: "must: ['conditions', 'script_true', 'script_false'] }," },
  { id: 'dictionary-loses-sys-scope', file: 'lib/stages.js',
    from: "    must: ['internal_type', 'sys_scope'],",
    to: "    must: ['internal_type'],", },
  { id: 'section-loses-its-elements', file: 'lib/stages.js',
    from: "    { table: 'sys_ui_element', on: { parent: ['sys_id'], child: ['sys_ui_section'] },",
    to: "    { table: 'sys_ui_element', on: { parent: ['sys_id'], child: ['nope'] },", },
  // --- PLAN 6.5b · the deliverable ------------------------------------------
  { id: 'deliverable-presence-only-not-clean', file: 'lib/deliverable.js',
    from: '    if (g.changed.has(p)) { dirty.push(p); }',
    to: '    if (false) { dirty.push(p); }' },
  { id: 'deliverable-commit-sweeps-everything', file: 'lib/deliverable.js',
    from: "    const add = git(root, ['add', '--'].concat(present));",
    to: "    const add = git(root, ['add', '-A']);" },
  { id: 'deliverable-no-head-passes', file: 'lib/deliverable.js',
    from: '    ok: g.isRepo && g.hasHead && !missing.length && !untracked.length && !dirty.length,',
    to: '    ok: g.isRepo && !missing.length && !untracked.length && !dirty.length,' },
  { id: 'render-into-a-non-repo-is-fine', file: 'lib/stages.js',
    from: '        if (!g.isRepo) {',
    to: '        if (false) {' },
  { id: 'ingest-does-not-commit', file: 'snbrain.js',
    from: "  if (fromStage === 'render') {",
    to: '  if (false) {' },
  { id: 'ingest-success-not-withdrawn', file: 'snbrain.js',
    from: "      if (terminal === 'success') {",
    to: '      if (false) {' },
  { id: 'ingest-commit-failure-is-silent', file: 'snbrain.js',
    from: "        check: 'deliverable-not-committed', severity: 'blocking', rung: 'L1',",
    to: "        check: 'deliverable-not-committed', severity: 'warning', rung: 'L1'," },

  /* METHOD-6 / Phase B — the edge as an object. */
  { id: 'refgraph-whole-values-only', file: 'lib/stages.js',
    from: '      const found = raw.match(REF_SYS_ID);',
    to: '      const found = REF_WHOLE.test(raw.trim()) ? [raw.trim()] : null;' },
  { id: 'refgraph-bookkeeping-swallows-mechanism', file: 'lib/stages.js',
    from: "  const mech = edges.filter((e) => !REF_BOOKKEEPING_TABLES.has(e.fromTable) && !REF_BOOKKEEPING_COLUMNS.test(e.col));",
    to: '  const mech = [];' },
  { id: 'refgraph-audit-columns-are-chains', file: 'lib/stages.js',
    from: '      if (REF_IGNORE_COLUMNS.has(col)) { continue; }',
    to: '      if (false) { continue; }' },
  { id: 'coherence-aggregate-hides-the-uncapped-total', file: 'lib/stages.js',
    from: '      `${g.dangling} of ${g.mechanism} mechanism reference edge(s) dangle (${pct}%), reaching ${g.targets} distinct ` +\n      `record(s) this brain never mapped, across ${g.broken.length} of ${g.classes} (table, column) class(es) ` +',
    to: '      `${g.dangling} of ${g.mechanism} mechanism reference edge(s) dangle (${pct}%), reaching ${g.targets} distinct ` +\n      `record(s) this brain never mapped, across ${big.length} of ${g.classes} (table, column) class(es) ` +' },
  { id: 'coherence-blocks-instead-of-warns', file: 'lib/stages.js',
    from: "    check: 'chain-coherence',\n    severity: 'warning',",
    to: "    check: 'chain-coherence',\n    severity: 'blocking'," },
  { id: 'verify-never-checks-the-chains', file: 'lib/stages.js',
    from: '        const coherence = danglingFindings([...ledger.values()]);',
    to: '        const coherence = [];' },
  { id: 'verify-checks-the-artifact-not-the-ledger', file: 'lib/stages.js',
    from: '        const coherence = danglingFindings([...ledger.values()]);\n        if (coherence.length) { (art.findings = art.findings || []).push(...coherence); }',
    to: '        const coherence = danglingFindings(art.verdicts);\n        if (coherence.length) { (art.findings = art.findings || []).push(...coherence); }' },
  { id: 'coherence-finding-loses-its-locus', file: 'lib/stages.js',
    from: '    locus: { table: s.table, field: s.column },',
    to: '    locus: null,' },
  { id: 'page-mechanism-unchecked', file: 'lib/stages.js',
    from: '          if (intact.length) { continue; }',
    to: '          if (true) { continue; }' },
  { id: 'page-mechanism-a-dangling-link-counts', file: 'lib/stages.js',
    from: '          const intact = out.filter((e) => graph.known.has(e.to));',
    to: '          const intact = out;' },
  { id: 'page-mechanism-threshold-unreachable', file: 'lib/stages.js',
    from: '        const MECH_MIN_ARTIFACTS = 3;',
    to: '        const MECH_MIN_ARTIFACTS = 99;' },
  { id: 'page-mechanism-slot-escape-removed', file: 'lib/stages.js',
    from: '          if (MECH_SLOT.test(fs.readFileSync(abs, \'utf8\'))) { continue; }',
    to: '          if (false) { continue; }' },

  /* METHOD-6 / fix (3) — the graph aims the harvest. */
  { id: 'chain-repair-never-mints', file: 'lib/stages.js',
    from: '      if (drained && roundsLeft > 0) {',
    to: '      if (false) {' },
  { id: 'chain-repair-unbounded', file: 'lib/stages.js',
    from: '        queue.chainRepairRounds = roundsLeft - 1;',
    to: '        queue.chainRepairRounds = roundsLeft;' },
  { id: 'chain-repair-mints-mid-queue', file: 'lib/stages.js',
    from: '      const drained = !(q.harvestAreas || []).filter((a) => !done.includes(a)).length;',
    to: '      const drained = true;' },
  { id: 'chain-repair-queues-the-sample-not-the-set', file: 'lib/stages.js',
    from: '      for (const id of s.allTargets) { seen.ids.add(id); }',
    to: '      for (const id of s.sample) { seen.ids.add(id); }' },
  { id: 'chain-repair-cap-drops-silently', file: 'lib/stages.js',
    from: '  const dropped = eligible.slice(maxAreas).map((s) => ({ table: s.table, targets: s.ids.length }));',
    to: '  const dropped = [];' },
  { id: 'chain-repair-floor-drops-silently', file: 'lib/stages.js',
    from: '  const belowThreshold = sized.filter((s) => s.ids.length && s.ids.length < minIds);',
    to: '  const belowThreshold = [];' },
  { id: 'chain-repair-hides-what-it-cannot-aim', file: 'lib/stages.js',
    from: '  const unaimable = unaimedClasses.reduce((n, s) => n + s.targets, 0);',
    to: '  const unaimable = 0;' },
  { id: 'chain-repair-briefed-as-a-stratum', file: 'lib/stages.js',
    from: "        : detail.population === 'chain-repair'\n        ? `${detail.targetsTotal} record(s) this run ALREADY REFERENCES",
    to: "        : false\n        ? `${detail.targetsTotal} record(s) this run ALREADY REFERENCES" },
  { id: 'chain-repair-has-no-procedure', file: 'lib/stages.js',
    from: "        if (det.population !== 'chain-repair') { return null; }",
    to: '        return null;' },
  { id: 'chain-repair-empty-area-accepted', file: 'lib/stages.js',
    from: "        if (String(det.population || '').startsWith('chain-repair') && art.claims.length === 0) {",
    to: '        if (false) {' },

  /* METHOD-6 fix (3), the close-path door — the leg must be reachable when harvest CLOSES. */
  { id: 'close-path-never-salvages', file: 'snbrain.js',
    from: "      const salvage = typeof stage.onClose === 'function' ? stage.onClose(ctx, close) : null;",
    to: '      const salvage = null;' },
  { id: 'close-salvage-does-not-stay', file: 'snbrain.js',
    from: '      if (salvage && salvage.stay) {',
    to: '      if (false) {' },
  { id: 'close-salvage-spends-no-round', file: 'lib/stages.js',
    from: '          chainRepairRounds: roundsLeft - 1,',
    to: '          chainRepairRounds: roundsLeft,' },
  { id: 'close-salvage-hands-a-closed-area-back-out', file: 'lib/stages.js',
    from: '          harvestAreas: (q.harvestAreas || []).filter((a) => !unreached.includes(a)).concat(minted.map((a) => a.id)),',
    to: '          harvestAreas: (q.harvestAreas || []).concat(minted.map((a) => a.id)),' },
  { id: 'tail-loses-its-elapsed-exemption', file: 'lib/stages.js',
    from: '        exemptElapsed: tailOnly,',
    to: '        exemptElapsed: false,' },
  { id: 'elapsed-close-off', file: 'lib/stages.js',
    from: '  if (!o.exemptElapsed && elapsedMs > horizonHours * 3600000) {',
    to: '  if (false) {' },
  { id: 'tail-close-re-mints', file: 'lib/stages.js',
    from: '      if (!unreached.length || unreached.some((a) => repairIds.has(a))) { return null; }',
    to: '      if (!unreached.length) { return null; }' },
  { id: 'close-salvage-ignores-an-empty-wallet', file: 'lib/stages.js',
    from: "      if (close.reason === 'budget-capped') { return null; }",
    to: '      if (false) { return null; }' },

  /* PLAN 6.6 remainder — declared set membership aims the repair leg at configuration-in-data. */
  { id: 'data-set-membership-never-aimed', file: 'lib/stages.js',
    from: '    const aims = new Set(s.resolvesTo.concat(declaredAims.get(`${s.table}.${s.column}`) || []));',
    to: '    const aims = new Set(s.resolvesTo);' },
  { id: 'data-set-declaration-empty', file: 'lib/stages.js',
    from: '    for (const ref of entry.referencedBy || []) {',
    to: '    for (const ref of []) {' },
  { id: 'data-repair-brief-loses-its-shape', file: 'lib/stages.js',
    from: '        const shape = (BODY_FIELDS[det.tables[0]] || {}).shape || (DATA_AREAS[det.tables[0]] || {}).shape;',
    to: '        const shape = (BODY_FIELDS[det.tables[0]] || {}).shape;' },

  /* PLAN 6.12 (3) — the classes nobody can aim become dictionary questions, bounded and reported. */
  { id: 'dict-leg-never-mints', file: 'lib/stages.js',
    from: '  const dictionaryAreas = dictEligible.slice(0, maxDict).map((s) => ({',
    to: '  const dictionaryAreas = dictEligible.slice(0, 0).map((s) => ({' },
  { id: 'dict-cap-drops-silently', file: 'lib/stages.js',
    from: '  const dictDropped = dictEligible.slice(maxDict).map((s) => ({ class: `${s.table}.${s.column}`, targets: s.ids.length }));',
    to: '  const dictDropped = [];' },
  { id: 'dict-area-briefed-without-its-question', file: 'lib/stages.js',
    from: "        if (det.population !== 'chain-repair-dictionary') { return null; }",
    to: '        return null;' },

  /* PLAN 6.3 — the deliverable may not disclaim what the run already read. */
  { id: 'containment-off', file: 'lib/stages.js',
    from: '            if (t && !allowed.has(t)) { off.set(t, (off.get(t) || 0) + 1); }',
    to: '            if (false) { off.set(t, (off.get(t) || 0) + 1); }' },
  { id: 'containment-escape-removed', file: 'lib/stages.js',
    from: '          for (const row of (art.coverage && art.coverage.children) || []) { if (row.table) { allowed.add(row.table); } }',
    to: '          for (const row of []) { if (row.table) { allowed.add(row.table); } }' },
  { id: 'containment-misses-the-children', file: 'lib/stages.js',
    from: '          for (const child of definingChildrenFor([...allowed])) { allowed.add(child.table); }',
    to: '          for (const child of []) { allowed.add(child.table); }' },
  { id: 'blocked-on-unchecked', file: 'lib/stages.js',
    from: '          for (const m of text.matchAll(/blocked_on:\\s*([a-z0-9_]+)/gi)) {',
    to: '          for (const m of []) {' },
  { id: 'blocked-on-swallows-prose', file: 'lib/stages.js',
    from: "            const inRaw = !inLedger && t.includes('_') && new RegExp(`\\\\b${t}\\\\b`).test(raw());",
    to: '            const inRaw = !inLedger && new RegExp(`\\\\b${t}\\\\b`).test(raw());' },
  { id: 'unread-scan-off', file: 'lib/stages.js',
    from: '            if (!/unprobed|not read|not proven empty/i.test(line)) { continue; }',
    to: '            if (true) { continue; }' },
  { id: 'unread-loses-the-rows-carve-out', file: 'lib/stages.js',
    from: '            if (/\\b\\d+\\s*rows?\\b/i.test(line)) { continue; }',
    to: '            if (false) { continue; }' },

  /* PRODUCT-90 — the queue-aware ceiling applies to rejected iterations too. */
  { id: 'rejected-iteration-gets-the-flat-ceiling', file: 'snbrain.js',
    from: "  const stageCeiling = () => (typeof stage.ceiling === 'function' ? stage.ceiling(ctx) : null);",
    to: '  const stageCeiling = () => null;' },

  /* PLAN 6.7 / PRODUCT-89 — an interpretation is not an L1 claim. */
  { id: 'interpretation-verified-at-L1', file: 'lib/stages.js',
    from: "        const wrong = art.verdicts.filter((v) => { const c = ledger.get(v.claimId); return c && c.behaviour && v.status === 'verified'; });",
    to: '        const wrong = [];' },
  { id: 'explain-minted-back-at-L1', file: 'lib/stages.js',
    from: "        claims: art.claims.map((c) => Object.assign({}, c, { status: 'draft', rung: 'L3', kind: 'behaviour' })),",
    to: "        claims: art.claims.map((c) => Object.assign({}, c, { status: 'draft', rung: 'L1', kind: 'behaviour' }))," },
  { id: 'substrate-never-hashed', file: 'lib/stages.js',
    from: '          if (body !== null && body !== undefined && String(body).length) { substrateHash = digest(String(body), 8); }',
    to: '          if (false) { substrateHash = digest(String(body), 8); }' },
  { id: 'interpretation-reason-open-to-field-claims', file: 'lib/stages.js',
    from: "        const misused = art.verdicts.filter((v) => { const c = ledger.get(v.claimId); return c && !c.behaviour && v.unverifiableReason === 'interpretation'; });",
    to: '        const misused = [];' },
  { id: 'provenance-overwritten-again', file: 'lib/state.js',
    from: "        recordedByStage: (prev && prev.recordedByStage) || (ctx && ctx.stage) || this.state.stage,",
    to: '        recordedByStage: (ctx && ctx.stage) || this.state.stage,' },
  // lib/state.js carries CRLF line endings, so this two-line anchor says \r\n where the
  // stages.js anchors above say \n — an anchor that ignores that reads ANCHOR NOT FOUND forever.
  { id: 'prior-evidence-duplicated', file: 'lib/state.js',
    from: '      if (prev && prev.evidence && row.evidence && row.evidence !== prev.evidence &&\r\n          JSON.stringify(row.evidence) !== JSON.stringify(prev.evidence)) { merged.priorEvidence = prev.evidence; }',
    to: '      if (prev && prev.evidence && row.evidence) { merged.priorEvidence = prev.evidence; }' },

  /* 5.50 — the all-doc-sourced rejection names the enum value, not a prose requirement. */
  { id: 'doc-sourced-rejection-back-to-prose', file: 'lib/stages.js',
    from: 'Set this artifact\'s pages[] entry to status: "doc-sourced" — the literal enum value this validator compares against; prose on the page body does not satisfy it and is not what is being checked. Why the status matters: a reader',
    to: 'Say so on the page\'s face: a reader' },

  /* PLAN 7.2 — the WHY ledger: tiers, anchors, the unbound escape, the induced kill. */
  { id: 'dec-ledger-refusal-off', file: 'render.js',
    from: "    if (!anchors.length && dec.linkage !== 'unbound') { refused.push({ num, id: dec.id }); return; }",
    to: '    if (false) { refused.push({ num, id: dec.id }); return; }' },
  { id: 'dec-ledger-dangling-anchor-renders', file: 'render.js',
    from: '    if (missing.length) { danglingAnchors.push({ num, id: dec.id, missing }); }',
    to: '    if (false) { danglingAnchors.push({ num, id: dec.id, missing }); }' },
  { id: 'render-silent-decision-accepted', file: 'lib/stages.js',
    from: '        if (undisclosed.length) {',
    to: '        if (false) {' },
  { id: 'interview-unbound-not-disclosed', file: 'lib/stages.js',
    from: "            linkage: (witness.length || explains.length) ? 'bound' : 'unbound',",
    to: "            linkage: 'bound'," },
  { id: 'orientation-recall-minted-bound', file: 'lib/stages.js',
    from: "          tier: 'confirmed', anchorSource: 'interview', linkage: 'unbound',",
    to: "          tier: 'confirmed', anchorSource: 'interview', linkage: 'bound'," },
  // Single-line anchor on purpose: lib/state.js is CRLF and a multi-line anchor written with \n
  // audits as NOT FOUND forever.
  { id: 'supersession-induced-treated-as-caveat', file: 'lib/state.js',
    from: "        if (decisionTier(dec) === 'induced') {",
    to: '        if (false) {' },
  { id: 'status-hides-unreachable-decisions', file: 'snbrain.js',
    from: '    const unanchored = decs.filter((d) => !(d.witnessClaims || []).length && !(d.explainsClaims || []).length);',
    to: '    const unanchored = [];' },

  /* PLAN 7.3 — decision induction. The known-answer fixture is what catches most of these. */
  { id: 'induction-dead-test-ledger-wide', file: 'lib/stages.js',
    from: '      .filter((t) => t !== cl.table && !t.startsWith(ownPrefix) && !s.text.includes(t));',
    to: '      .filter((t) => t !== cl.table && !t.startsWith(ownPrefix) && !rows.some((rc) => JSON.stringify(rc).toLowerCase().includes(t)));' },
  { id: 'induction-prefix-kin-loosened', file: 'lib/stages.js',
    from: '  return shared >= 2;',
    to: '  return shared >= 1;' },
  { id: 'induction-response-fallback-off', file: 'lib/stages.js',
    from: '          if (r.fields[k] === undefined && resp[k]) { r.fields[k] = String(resp[k]); }',
    to: '          if (false) { r.fields[k] = String(resp[k]); }' },
  { id: 'induction-cap-drops-silently', file: 'lib/stages.js',
    from: '  const dropped = viable.slice(DECISION_CANDIDATES_MAX).map((c) => ({ key: c.key, source: c.source, score: c.score }));',
    to: '  const dropped = [];' },
  { id: 'induction-witness-check-off', file: 'lib/stages.js',
    from: '    const resolved = cand.witnesses.filter((id) => byId.has(id));',
    to: '    const resolved = cand.witnesses;' },
  { id: 'induction-not-in-queue', file: 'lib/stages.js',
    from: '        queue: { decisionCandidates: induced.candidates, decisionCandidatesDropped: induced.dropped },',
    to: '        queue: {},' },
  { id: 'induction-feature-off-gone', file: 'lib/stages.js',
    from: "      const hides = /(^|[._])(hide|disable|suppress)/.test(name) && ['true', 'yes', '1'].includes(value);",
    to: '      const hides = false;' },
  { id: 'induction-disjointness-blind', file: 'lib/stages.js',
    from: '      const crossers = SIBLING_MODULE_PREFIXES.filter((p) => roleText.includes(p));',
    to: '      const crossers = [];' },
  { id: 'induction-single-source-any-host', file: 'lib/stages.js',
    from: '    if (hosts.size === 1 && [...hosts.values()][0].length >= 2) {',
    to: '    if (hosts.size >= 1 && [...hosts.values()][0].length >= 2) {' },

  /* PLAN 7.4 — the interview asks WHY: minting, the answer forms, the refutation memory. */
  { id: 'why-mint-off', file: 'lib/stages.js',
    from: '      const whyQuestions = whyQuestionsFromCandidates(induced.candidates);',
    to: '      const whyQuestions = [];' },
  { id: 'why-question-cites-nothing', file: 'lib/stages.js',
    from: '    locus: cand.witnesses.slice(0, 12).map((id) => ({ table: null, sysId: id, claim: id })),',
    to: "    locus: [{ table: null, sysId: 'none', claim: null }]," },
  { id: 'interview-confirm-loses-anchor', file: 'lib/stages.js',
    from: '              witnessClaims: cand.witnesses.filter((id) => ctx.brain.claims().has(id)),',
    to: '              witnessClaims: [],' },
  { id: 'interview-deny-unrecorded', file: 'lib/stages.js',
    from: '            refutedCandidates.push({ key: cand.key, statement: cand.statement, by: a.answeredBy, at: a.answeredAt, verbatim: a.verbatim || null });',
    to: '            if (false) { refutedCandidates.push({ key: cand.key, statement: cand.statement, by: a.answeredBy, at: a.answeredAt, verbatim: a.verbatim || null }); }' },
  { id: 'inducer-reasks-refuted', file: 'lib/stages.js',
    from: '  const refuted = new Set((opts && opts.refutedKeys) || []);',
    to: '  const refuted = new Set();' },
  { id: 'render-never-mints-induced', file: 'lib/stages.js',
    from: '      const induced = (((ctx.state.queue || {}).decisionCandidates) || [])',
    to: '      const induced = ([])' },
  { id: 'why-verdict-not-required', file: 'lib/stages.js',
    from: '          if (a.kind === \'decision\' && !a.whyVerdict) {',
    to: '          if (false) {' },
  { id: 'why-correct-needs-no-correction', file: 'lib/stages.js',
    from: "          if (a.whyVerdict === 'correct' && !a.statement && !a.verbatim) {",
    to: '          if (false) {' },

  /* PLAN 7.5 — enforcement minted from conventions, measured before it is minted. */
  { id: 'gates-compliance-floor-removed', file: 'render.js',
    from: '      const enforced = measured.filter((m) => m.n >= CONVENTION_MIN_CLASS && m.ratio >= CONVENTION_COMPLIANCE_FLOOR).map((m) => m.table).sort();',
    to: '      const enforced = measured.filter((m) => m.n >= CONVENTION_MIN_CLASS).map((m) => m.table).sort();' },
  { id: 'gate-blocks-updates-too', file: 'render.js',
    from: "    '  if (/\"sys_id\"\\\\s*:\\\\s*\"[0-9a-f]{32}\"/.test(text)) { process.exit(0); }',",
    to: "    '  // updates are no longer exempt'," },
  { id: 'gate-cites-nothing-ok', file: 'lib/stages.js',
    from: '        if (uncited.length) {',
    to: '        if (false) {' },
  { id: 'enforcement-gap-silent', file: 'lib/stages.js',
    from: '          if (unaccounted.length) {',
    to: '          if (false) {' },
  { id: 'settings-merge-duplicates', file: 'render.js',
    from: '    const present = JSON.stringify(settings.hooks.PreToolUse).includes(g.hookEntry.command);',
    to: '    const present = false;' },

  /* PLAN 7.6 — the persona kernel: slots from ledger facts, gaps declared, never invented. */
  { id: 'kernel-facts-connection-is-landscape', file: 'render.js',
    from: '    if (bare) { bump(bare[1]); }',
    to: '    if (false) { bump(bare[1]); }' },
  { id: 'kernel-facts-counts-the-platform', file: 'render.js',
    from: '  const bump = (host) => { if (!PLATFORM_HOSTS.has(host)) { counts.set(host, (counts.get(host) || 0) + 1); } };',
    to: '  const bump = (host) => { counts.set(host, (counts.get(host) || 0) + 1); };' },
  { id: 'kernel-facts-expansion-by-mention', file: 'lib/kernelfacts.js',
    from: "      return q && q.gate === 'register-gap' && re.test(String(q.question || ''));",
    to: "      return q && re.test(String(q.question || ''));" },
  { id: 'org-map-invents-a-table', file: 'lib/kernelfacts.js',
    from: '  if (namedGroups.length) {',
    to: '  if (orgClaims.length) {' },
  { id: 'config-placeholder-shipped-ok', file: 'lib/stages.js',
    from: '          if (bad.length) {\n            rej.push(\n              `product.config.json ships ${bad.length} placeholder-shaped value(s): ${bad.slice(0, 6).join(\', \')}` +',
    to: '          if (false) {\n            rej.push(\n              `product.config.json ships ${bad.length} placeholder-shaped value(s): ${bad.slice(0, 6).join(\', \')}` +' },
  { id: 'instance-unmentioned-ok', file: 'lib/stages.js',
    from: '          if (unmentioned.length) {',
    to: '          if (false) {' },

  /* PLAN 7.7 — source and scar tissue at day zero. */
  { id: 'source-keeps-the-window', file: 'render.js',
    from: '    const body = fromRaw ? rawBody : claimBody;',
    to: '    const body = claimBody;' },
  { id: 'source-raw-shape-blind', file: 'render.js',
    from: '        if (row && row.sysId && row.response && typeof row.response === \'object\') {',
    to: '        if (false) {' },
  { id: 'source-truncation-undeclared', file: 'render.js',
    from: '        ? [`**TRUNCATED at ${shown.length} of ${body.length} chars for the page cap — the remainder is in .brain, and this line is the declaration.**`] : []),',
    to: '        ? [] : []),' },
  { id: 'source-fence-fixed', file: 'render.js',
    from: "  return '~'.repeat(Math.max(3, longest + 1));",
    to: "  return '~'.repeat(3);" },
  { id: 'gotcha-ownership-off', file: 'gotcha.js',
    from: "  if (klass !== 'platform') {",
    to: '  if (false) {' },
  { id: 'gotcha-dedupe-off', file: 'gotcha.js',
    from: '  if (text.includes(entry.id)) { return { ok: true, already: true }; }',
    to: '  if (false) { return { ok: true, already: true }; }' },
  { id: 'gotcha-appends-anywhere', file: 'gotcha.js',
    from: '  const end = text.indexOf(CORPUS_END);',
    to: '  const end = text.length;' },

  /* PRODUCT-101 — the clock, sized, briefed, filed, and overridable. */
  { id: 'pacing-mean-not-median', file: 'lib/stages.js',
    from: '  const medianMs = durations[Math.floor(durations.length / 2)];',
    to: '  const medianMs = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);' },
  { id: 'pacing-unbriefed', file: 'lib/stages.js',
    from: '        `${pace ? `${pacingLine(pace, pace.fits ? [] : remaining.slice(-pace.shortfall))} ` : \'\'}` +',
    to: "        '' +" },
  { id: 'pacing-unfiled', file: 'lib/stages.js',
    from: '      const pacingFindings = (pace && !pace.fits) ? [{',
    to: '      const pacingFindings = (false) ? [{' },
  { id: 'pacing-always-fits', file: 'lib/stages.js',
    from: '    fits: fitIterations >= remaining,',
    to: '    fits: true,' },
  { id: 'hours-override-refused', file: 'snbrain.js',
    from: '  } else if (a.hours && a.hours !== true) {',
    to: '  } else if (false) {' },

  /* PLAN 6.11 — the scoring surface. */
  { id: 'surface-raw-scores-again', file: 'scoring-surface.js',
    from: "  { tier: 'excluded', prefix: '.brain/raw', why: 'gitignored whole-instance payloads (PRODUCT-97); never ships; 8 of 10 re-score points moved on inconsistent treatment of exactly this' },",
    to: "  { tier: 'ledger', prefix: '.brain/raw', why: 'mutated' }," },
  { id: 'surface-novelty-defaults', file: 'scoring-surface.js',
    from: "  return { path: fwd, tier: 'UNDECLARED', why: 'the manifest has not decided what this file class is — that is an error, not a default' };",
    to: "  return { path: fwd, tier: 'wiki', why: 'mutated default' };" },
];

/*
 * The WHOLE repo is copied, not just tools/snbrain: the suite asserts that every framework path a
 * stage brief names exists on disk, and every stage skill with it. Copying the tool alone fails 22
 * of those on the UNMUTATED copy, which would make every mutation below "caught" for the wrong
 * reason — the exact shape of a mutation run that reads as coverage.
 */
function copyTree(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !/[\\/](\.git|node_modules|snbrain-mutate.*)$/.test(p),
  });
}

function runSuite(tool) {
  const r = spawnSync(process.execPath, [path.join(tool, 'selftest.js')], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  const m = text.match(/(\d+)\/(\d+) passed(?:, (\d+) FAILED)?/);
  return { code: r.status, failed: m ? Number(m[3] || 0) : -1, total: m ? Number(m[2]) : -1, text };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !/^--/.test(argv[i + 1]) ? argv[i + 1] : dflt;
  };
  const only = arg('--only', null);
  const shard = argv.includes('--shard') ? Number(arg('--shard', '0')) : null;
  const shards = Math.max(1, Number(arg('--shards', '1')));
  const workRoot = path.resolve(arg('--work', path.join(os.tmpdir(), 'snbrain-mutate')));
  const work = shard === null ? workRoot : `${workRoot}-${shard}`;
  const tool = path.join(work, 'tools', 'snbrain');
  const say = (s) => process.stdout.write(`${s}\n`);
  const tag = shard === null ? '' : `[shard ${shard}] `;

  copyTree(SRC, work);
  const base = runSuite(tool);
  say(`${tag}baseline on the copy: ${base.total - base.failed}/${base.total} passed`);
  if (base.failed !== 0) {
    say('the UNMUTATED copy already fails; nothing below means anything.');
    say(base.text.slice(-2000));
    return 2;
  }

  let caught = 0, missed = 0, notFound = 0, ran = 0;
  for (let i = 0; i < MUTATIONS.length; i += 1) {
    const mut = MUTATIONS[i];
    if (only && mut.id !== only) { continue; }
    if (shard !== null && i % shards !== shard) { continue; }
    ran += 1;
    const file = path.join(tool, mut.file);
    const original = fs.readFileSync(file, 'utf8');
    const hits = original.split(mut.from).length - 1;
    if (hits !== 1) {
      say(`  ANCHOR NOT FOUND (${hits} match(es))  ${mut.id} [${mut.file}]`);
      notFound += 1;
      continue;
    }
    fs.writeFileSync(file, original.split(mut.from).join(mut.to));
    const r = runSuite(tool);
    fs.writeFileSync(file, original);
    if (r.failed > 0) {
      caught += 1;
      const names = (r.text.match(/^ {2}FAIL .*$/gm) || [])
        .map((s) => s.replace(/^ {2}FAIL [A-Z]\. [^›]*› /, '').slice(0, 62));
      say(`  caught (${r.failed})  ${mut.id}  <- ${names.slice(0, 2).join(' | ')}`);
    } else {
      missed += 1;
      say(`  MISSED       ${mut.id} [${mut.file}] — the suite passed with the guard broken`);
    }
  }

  const after = runSuite(tool);
  say(`${tag}RESULT ran=${ran} caught=${caught} missed=${missed} anchorNotFound=${notFound} ` +
    `afterRestore=${after.total - after.failed}/${after.total}`);
  return missed || notFound || after.failed ? 1 : 0;
}

/**
 * Every anchor must match its target file EXACTLY once. Exported so the mutation list can be
 * audited without running an hour of suites — and because `require()`-ing this file used to start
 * a full run, which is a harness that fires when you look at it.
 */
function auditAnchors() {
  const bad = [];
  const cache = new Map();
  for (const mut of MUTATIONS) {
    const file = path.join(SRC, 'tools', 'snbrain', mut.file);
    if (!cache.has(file)) { cache.set(file, fs.readFileSync(file, 'utf8')); }
    const hits = cache.get(file).split(mut.from).length - 1;
    if (hits !== 1) { bad.push({ id: mut.id, file: mut.file, matches: hits }); }
  }
  return { total: MUTATIONS.length, bad };
}

module.exports = { MUTATIONS, auditAnchors };

if (require.main === module) {
  if (process.argv.includes('--audit')) {
    const r = auditAnchors();
    for (const b of r.bad) { process.stdout.write(`  ANCHOR ${b.matches} match(es)  ${b.id} [${b.file}]\n`); }
    process.stdout.write(`${r.total} anchor(s) checked, ${r.bad.length} bad\n`);
    process.exit(r.bad.length ? 1 : 0);
  }
  process.exit(main());
}
