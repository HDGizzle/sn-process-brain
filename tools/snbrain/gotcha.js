#!/usr/bin/env node
/*
 * gotcha.js — PLAN 7.7(b): the cross-engagement gotchas corpus mechanism (folds 6.10).
 *
 * The 136 `needs-a-human` absences on the scored instrument are 59% of everything still
 * missing, and their composition (59 gotcha + 35 convention vs 17 process + 6 people) says
 * they are NOT facts about one customer a longer SME session would produce — they are
 * platform knowledge learned by writing code. The mechanism that measurably works is
 * installer-shipped doctrine (a quarter of both scored runs' A/B hits), so the corpus lives
 * in the framework's wiki-scaffold — every install ships it at day zero — and this tool is
 * the ONE way an engagement's confirmed gotcha travels back into it.
 *
 * Ownership rule (the pilot customer gotchas.md): platform-wide failure classes ONLY. A gotcha scoped to
 * one artifact type or procedure belongs in the owning skill's Gotchas section, and this
 * tool refuses it rather than diluting the catalogue.
 *
 *   node tools/snbrain/gotcha.js --add --title <t> --body <text> --by <name> --engagement <name>
 *        [--class platform] [--root <engagement repo>] [--corpus <file>]
 *   node tools/snbrain/gotcha.js --list [--corpus <file>]
 *
 * --corpus overrides the corpus file (default: this framework's
 * wiki-scaffold/gotchas-platform-catalogue.md). --root also appends to that engagement's
 * installed copy so both sides carry the entry from the moment it is confirmed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.resolve(__dirname, '..', '..');
const CORPUS_START = '<!-- snbrain:gotcha-corpus:start -->';
const CORPUS_END = '<!-- snbrain:gotcha-corpus:end -->';
const CATALOGUE_BASENAME = 'gotchas-platform-catalogue.md';

function slugOf(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function entryText(opts) {
  const id = `GOTCHA-${slugOf(opts.title)}-${crypto.createHash('sha256').update(`${opts.title}|${opts.body}`).digest('hex').slice(0, 6)}`;
  return {
    id,
    text: [
      `### ${id} — ${opts.title}`,
      `\`platform-wide\` · first confirmed: ${opts.engagement}, ${opts.at} · by: ${opts.by}`,
      opts.body.trim(),
      '',
    ].join('\n'),
  };
}

function appendToCatalogue(file, entry) {
  if (!fs.existsSync(file)) { return { ok: false, reason: `no catalogue at ${file}` }; }
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes(entry.id)) { return { ok: true, already: true }; }
  const end = text.indexOf(CORPUS_END);
  if (end < 0) { return { ok: false, reason: `${file} carries no ${CORPUS_END} marker — not a corpus catalogue` }; }
  const out = `${text.slice(0, end)}${entry.text}\n${text.slice(end)}`;
  fs.writeFileSync(file, out, 'utf8');
  return { ok: true };
}

function listEntries(file) {
  if (!fs.existsSync(file)) { return []; }
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/^### (GOTCHA-[a-z0-9-]+) — (.*)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined && !/^--/.test(argv[i + 1]) ? argv[i + 1] : dflt;
  };
  const corpus = path.resolve(arg('--corpus', path.join(SRC, 'wiki-scaffold', CATALOGUE_BASENAME)));
  const say = (s) => process.stdout.write(`${s}\n`);

  if (argv.includes('--list')) {
    const entries = listEntries(corpus);
    say(`${entries.length} gotcha(s) in ${corpus}`);
    for (const e of entries) { say(`  ${e.id}  ${e.title}`); }
    return 0;
  }

  if (!argv.includes('--add')) {
    say('usage: gotcha.js --add --title <t> --body <text> --by <name> --engagement <name> [--class platform] [--root <repo>] [--corpus <file>]');
    say('       gotcha.js --list [--corpus <file>]');
    return 2;
  }

  const klass = arg('--class', 'platform');
  if (klass !== 'platform') {
    say(`REFUSED: class "${klass}" does not belong in the platform catalogue. The ownership rule is the pilot customer's: only ` +
      'platform-wide failure classes live here; a gotcha scoped to one artifact type or procedure belongs in the ' +
      'owning skill\'s Gotchas section (`.claude/skills/<skill>/SKILL.md`), which links back here for the general class.');
    return 1;
  }
  const title = arg('--title', null);
  const body = arg('--body', null);
  const by = arg('--by', null);
  const engagement = arg('--engagement', null);
  if (!title || !body || !by || !engagement) {
    say('gotcha --add requires --title, --body, --by and --engagement: an unattributed gotcha is a rumour, and a ' +
      'rumour shipped to every future engagement at day zero is the exact failure this corpus exists to prevent.');
    return 2;
  }
  const entry = entryText({ title, body, by, engagement, at: arg('--at', new Date().toISOString().slice(0, 10)) });

  const r1 = appendToCatalogue(corpus, entry);
  if (!r1.ok) { say(`corpus: ${r1.reason}`); return 1; }
  say(`corpus: ${r1.already ? 'already carries' : 'appended'} ${entry.id} (${corpus})`);

  const root = arg('--root', null);
  if (root) {
    // The engagement's installed copy, wherever its wiki root is.
    let wiki = 'docs/wiki';
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'product.config.json'), 'utf8').replace(/^﻿/, ''));
      if (cfg && cfg.paths && typeof cfg.paths.wikiRoot === 'string') { wiki = cfg.paths.wikiRoot; }
    } catch (noConfig) { /* default */ }
    const engagementCopy = path.resolve(root, wiki, CATALOGUE_BASENAME);
    const r2 = appendToCatalogue(engagementCopy, entry);
    say(`engagement: ${r2.ok ? (r2.already ? 'already carries' : 'appended') + ` ${entry.id}` : r2.reason} (${engagementCopy})`);
    if (!r2.ok) { return 1; }
  }
  return 0;
}

module.exports = { entryText, appendToCatalogue, listEntries, CORPUS_START, CORPUS_END, CATALOGUE_BASENAME };

if (require.main === module) { process.exit(main()); }
