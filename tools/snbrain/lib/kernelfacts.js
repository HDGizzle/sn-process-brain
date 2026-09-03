/*
 * kernelfacts.js — PLAN 7.6: the persona kernel's slots, filled from ledger facts.
 *
 * The kernel's opening line is the highest-consequence sentence in the deliverable, and
 * PRODUCT-92 measured what happens when an agent fills it by hand: a four-instance landscape
 * read at L1, a kernel naming one instance and calling it `dev` (the one the run happened to
 * be pointed at), and two config slots shipped holding their own placeholder copy. So the
 * three kernel-facts slots are GENERATED — {{ledger.instanceLine}}, {{vocabulary.section}},
 * {{orgMap.section}} — and render-kernel.js refuses to write while any of them still holds
 * its REQUIRED placeholder. A template with slots filled from ledger facts, never free prose
 * an agent invents.
 *
 * The org map is the honest half: both scored ledgers hold ZERO group/membership claims (the
 * group legs of 6.6/6.12 need a live run), and the section says so with a pointer instead of
 * being silently absent — an empty org map that names its own gap is a fact; a missing one is
 * an invitation to invent personas.
 *
 * THE VOCABULARY SECTION IS A PROJECTION OF lib/vocabulary.js (F6/F10, 2026-09-02). It used
 * to be built here by matching each recurring token against the TEXT of register-gap
 * questions, which attached the VendorX definition to "APIM" and "Process" on the first run and
 * the eVault definition to "Onboarding" on the second. Now: every confirmed term renders with
 * its definition and DEC number; every recurring token that no human defined renders
 * unexpanded, by name. The glossary page renders from the same model, so the two cannot
 * disagree.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { latestById, readJsonl, instanceMentions, INSTANCE_CLAIM_FLOOR } = require('../render.js');
const { buildVocabularyModel } = require('./vocabulary.js');

const VOCABULARY_KERNEL_MAX = 10;
const ORG_TABLES = Object.freeze(['sys_user_group', 'sys_group_has_role', 'sys_user_grmember', 'sys_user_role_contains']);

function buildVocabularySection(model, wikiRoot) {
  const lines = [];
  for (const t of model.terms) {
    const def = t.definition.length > 160 ? `${t.definition.slice(0, 159)}…` : t.definition;
    lines.push(`- **${t.canonicalTerm}**${t.aliases.length ? ` (also: ${t.aliases.join(', ')})` : ''} — ${def} _(${t.decisionNum} · decision ${t.hash}${t.needsReconfirmation ? ' · NEEDS RECONFIRMATION' : ''})_`);
  }
  const room = Math.max(3, VOCABULARY_KERNEL_MAX - lines.length);
  for (const v of model.unmatched.slice(0, room)) {
    lines.push(`- **${v.display}** (${v.loci} records) — unexpanded: no recorded decision defines it. Ask; do not guess${v.looksLikeAcronym ? ' an acronym expansion' : ''}.`);
  }
  if (!lines.length) {
    return 'No token recurs across two or more customer-authored records in this ledger, and no vocabulary was confirmed at the interview — there is no domain register to carry yet.';
  }
  const tail = model.terms.length
    ? `\n\nFull glossary with anchors and context: ${wikiRoot}/glossary.md (generated from the same decisions; this list is its projection).`
    : `\n\nNo term has a confirmed definition yet; the glossary at ${wikiRoot}/glossary.md lists the same gaps.`;
  return lines.join('\n') + tail;
}

function buildKernelFacts(repoRoot) {
  const brainDir = path.join(repoRoot, '.brain');
  const state = JSON.parse(fs.readFileSync(path.join(brainDir, 'state.json'), 'utf8'));
  const claims = latestById(readJsonl(path.join(brainDir, 'claims.jsonl')));
  let wikiRoot = 'docs/wiki';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'product.config.json'), 'utf8').replace(/^﻿/, ''));
    if (cfg && cfg.paths && typeof cfg.paths.wikiRoot === 'string') { wikiRoot = cfg.paths.wikiRoot.replace(/\/+$/, ''); }
  } catch (noConfig) { /* default */ }

  // --- the instance landscape, from evidence, with the run's own connection kept distinct ---
  const instances = instanceMentions(claims);
  const asserted = instances.filter((i) => i.claims >= INSTANCE_CLAIM_FLOOR);
  const below = instances.filter((i) => i.claims < INSTANCE_CLAIM_FLOOR);
  const instanceLine = (asserted.length
    ? asserted.map((i) => `${i.host} (${i.claims} claims)`).join(', ')
    : `none reaches ${INSTANCE_CLAIM_FLOOR} claims in this ledger`) +
    (below.length ? `; below the ${INSTANCE_CLAIM_FLOOR}-claim floor: ${below.map((i) => `${i.host} (${i.claims})`).join(', ')}` : '') +
    `; this run's own connection was ${state.instance} — the connection is not the landscape`;

  // --- vocabulary: the confirmed terms, then the recurring words nobody defined ------------
  const model = buildVocabularyModel(repoRoot);
  const vocabularySection = buildVocabularySection(model, wikiRoot);

  // --- the org map, or its honestly declared absence ----------------------------------------
  const orgClaims = claims.filter((c) => c.locus && ORG_TABLES.includes(c.locus.table));
  const byGroup = new Map();
  for (const c of orgClaims.filter((x) => x.locus.table === 'sys_user_group')) {
    const name = c.locus.key || null;
    const m = /^name = (.*)$/.exec(String(c.assertion || ''));
    const g = byGroup.get(c.locus.sysId) || { name: null, roles: [] };
    g.name = g.name || (m ? m[1] : name);
    byGroup.set(c.locus.sysId, g);
  }
  for (const c of orgClaims.filter((x) => x.locus.table === 'sys_group_has_role')) {
    const m = /^role = (.*)$/.exec(String(c.assertion || ''));
    const resp = c.evidence && c.evidence.capturedResponse;
    const groupId = resp && typeof resp === 'object' ? resp.group : null;
    if (m && groupId && byGroup.has(groupId)) { byGroup.get(groupId).roles.push(m[1]); }
  }
  const namedGroups = [...byGroup.values()].filter((g) => g.name);
  let orgMapSection;
  if (namedGroups.length) {
    orgMapSection = ['| Group | Roles (from `sys_group_has_role`) |', '|---|---|']
      .concat(namedGroups.map((g) => `| ${g.name} | ${g.roles.join(', ') || '— none read'} |`))
      .join('\n') +
      `\n\n${orgClaims.length} group/membership claim(s) in the ledger; membership beyond this table was not read.`;
  } else {
    /*
     * pilot-run-4 lands here WITH 32 membership claims: they are `sys_user_role_contains` rows
     * banked as raw sys_id pairs — the unreadable version the ledger carries because it was
     * reachable, while the readable sweep sits in .brain/raw (PRODUCT-93). A table of bare
     * sys_ids is not an org map, and pretending it is would be worse than the declared gap.
     */
    orgMapSection = `The ledger holds ${orgClaims.length ? `${orgClaims.length} membership-shaped claim(s), all raw sys_id pairs with no named group anywhere` : '**zero** `sys_user_group` / membership claims'} ` +
      '— the org map awaits the group legs of a live run. **Do not invent groups, personas or ' +
      'assignees**: routing work needs a group sys_id nobody here can give you yet. Ask, or read ' +
      'the instance. The gap is declared here and in tbd.md, not silent.';
  }

  return {
    facts: {
      ledger: { instanceLine, instances },
      vocabulary: { section: vocabularySection, tokens: model.candidates.length, terms: model.terms.length },
      orgMap: { section: orgMapSection, groupClaims: orgClaims.length },
    },
    totals: {
      instancesAsserted: asserted.length, instancesBelowFloor: below.length,
      vocabularyTokens: model.candidates.length,
      vocabularyTerms: model.terms.length,
      vocabularyExpanded: model.matched.length,
      vocabularyUnresolvable: model.unresolvable.length,
      orgClaims: orgClaims.length,
    },
    model,
  };
}

/** Merge the generated facts into product.config.json. These keys are generator-owned. */
function writeKernelFacts(repoRoot) {
  const built = buildKernelFacts(repoRoot);
  const cfgPath = path.join(repoRoot, 'product.config.json');
  const cfg = fs.existsSync(cfgPath)
    ? JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))
    : {};
  cfg.ledger = Object.assign({}, cfg.ledger, { instanceLine: built.facts.ledger.instanceLine, instances: built.facts.ledger.instances });
  cfg.vocabulary = Object.assign({}, cfg.vocabulary, { section: built.facts.vocabulary.section });
  cfg.orgMap = Object.assign({}, cfg.orgMap, { section: built.facts.orgMap.section });
  fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  built.written = true;
  return built;
}

module.exports = {
  buildKernelFacts, writeKernelFacts, buildVocabularySection,
  VOCABULARY_KERNEL_MAX, ORG_TABLES,
};
