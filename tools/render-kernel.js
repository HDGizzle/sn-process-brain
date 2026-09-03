#!/usr/bin/env node
/*
 * render-kernel.js — the kernel single-source mechanism.
 *
 * Reads kernel/CLAUDE.template.md + product.config.json, resolves every {{dotted.path}}
 * slot, and writes ALL THREE rendered copies:
 *   - CLAUDE.md                        (Claude Code kernel)
 *   - .github/copilot-instructions.md  (GitHub Copilot kernel — exact mirror)
 *   - AGENTS.md                        (Codex kernel — exact mirror)
 * Mirror drift is impossible by construction; the kernel-integrity hook still checks,
 * as a belt-and-braces guard against hand edits of the rendered files.
 *
 * Fails LOUDLY on unresolved slots or REQUIRED-placeholder config values: a kernel with
 * a hole in it is worse than no kernel.
 *
 * TWO MORE REFUSALS, both measured on the second engagement's run (2026-08-31):
 *
 *   1. NO HTML-COMMENT SLOTS SURVIVE. The template used to carry two semantic slots as
 *      `<!-- SLOT: platform-choice ... -->` / `<!-- SLOT: language policy ... -->`. They
 *      are comments, so slot resolution never saw them, and BOTH runs shipped a "DO NOT
 *      EDIT" kernel that instructed the customer to finish its own generation by hand —
 *      while product.config.json already said `language.targets: ["nl"]`. The two are now
 *      DERIVED slots ({{policy.languageLine}}, {{policy.platformLine}}), computed here from
 *      typed config, and any `<!-- SLOT:` left in the rendered text is a refusal.
 *
 *   2. EVERY LOCAL ROUTE RESOLVES. The routing map is an executable contract, not prose:
 *      an agent follows `docs/wiki/INTERVIEW.md` the moment it has a question. The template
 *      carried `{{paths.wikiRoot}}/../INTERVIEW.md` — which normalises to docs/INTERVIEW.md,
 *      a file that does not exist — through both runs, because nothing parsed the paths.
 *      Every backticked local path in the rendered kernel is now resolved from the repo
 *      root before a byte is written; a missing one refuses the render. Runtime files the
 *      extension writes (the agent port file, agentinstructions.md, agentrules/) are the
 *      only exemptions, and they are named.
 *
 * Usage: node tools/render-kernel.js [--root <repo>] [--check]   (--check: verify, write nothing)
 */
'use strict';

var fs = require('fs');
var path = require('path');

var argv = process.argv.slice(2);
function argOf(name) { var i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !/^--/.test(argv[i + 1]) ? argv[i + 1] : null; }
var root = path.resolve(argOf('--root') || path.resolve(__dirname, '..'));
var CHECK_ONLY = argv.indexOf('--check') >= 0;
var templatePath = path.join(root, 'kernel', 'CLAUDE.template.md');
var configPath = path.join(root, 'product.config.json');

/** The three mirrors, in the order they are written. Exported for the export/finalize manifest. */
var KERNEL_MIRRORS = ['CLAUDE.md', '.github/copilot-instructions.md', 'AGENTS.md'];

// Strip a UTF-8 BOM if present — PowerShell's Out-File/Set-Content write one, and
// JSON.parse rejects it. Every config consumer in this repo must do the same.
function readUtf8(p) { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); }

function lookup(obj, dotted) {
  var parts = dotted.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) { return undefined; }
    cur = cur[parts[i]];
  }
  return cur;
}

/*
 * THE DERIVED POLICY SLOTS. Typed config in, one sentence out, never a comment.
 *
 * language: `language.source` + `language.targets[]` are already the product's typed
 * representation (the hooks and the translation skills read them). A non-empty
 * `policy.language` string overrides the derivation verbatim, for the engagement whose
 * policy does not fit the bilingual sentence.
 *
 * platform: `policy.platform[]` — one string per non-negotiable platform decision, recorded
 * by a human (orientation conventions of kind prior-decisions are the usual source). When
 * none was recorded the kernel says so, ATTRIBUTED to this renderer and dated, rather than
 * leaving a slot: "not established" is a fact a reader can act on; a comment is not.
 */
function derivedSlots(config) {
  var lang = (config && config.language) || {};
  var policy = (config && config.policy) || {};
  var wiki = (config && config.paths && config.paths.wikiRoot) || 'docs/wiki';
  var src = String(lang.source || 'en');
  var targets = Array.isArray(lang.targets) ? lang.targets.filter(Boolean).map(String) : [];
  var languageLine;
  if (typeof policy.language === 'string' && policy.language.trim()) {
    languageLine = policy.language.trim();
  } else if (targets.length) {
    languageLine = 'Bilingual ' + src.toUpperCase() + '+' + targets.map(function (t) { return t.toUpperCase(); }).join('+') +
      ': every user-visible label, message, choice and notification ships with its ' + src + ' source AND its ' +
      targets.join('/') + ' translation, via the translation mechanics in ' + wiki + '/hard-rules.md §9 and the ' +
      'translation skills. Source of this rule: product.config.json language.source / language.targets.';
  } else {
    languageLine = 'Single-language (' + src + '): no translation obligation on this engagement; the translation ' +
      'mechanics in ' + wiki + '/hard-rules.md §9 still apply to any translated artifact you touch. Source: ' +
      'product.config.json language.targets is empty.';
  }
  var platformLine;
  var platform = Array.isArray(policy.platform) ? policy.platform.filter(function (p) { return typeof p === 'string' && p.trim(); })
    : (typeof policy.platform === 'string' && policy.platform.trim() ? [policy.platform.trim()] : []);
  if (platform.length) {
    platformLine = platform.map(function (p) { return p.trim().replace(/\.?$/, '.'); }).join(' ') +
      ' Source: product.config.json policy.platform[] (recorded by a human; mechanics in the wiki).';
  } else {
    platformLine = '**Not established.** No platform-choice hard rule (workspace family, flow engine, ' +
      'integration transport, …) was recorded by a human at orientation or interview, and this renderer ' +
      'did not infer one — stated by tools/render-kernel.js on ' + new Date().toISOString().slice(0, 10) +
      '. Treat every platform choice as OPEN: ask before assuming, and record the answer in ' +
      'product.config.json policy.platform[] then re-run node tools/render-kernel.js.';
  }
  return { 'policy.languageLine': languageLine, 'policy.platformLine': platformLine };
}

/*
 * THE ROUTE CHECK. Population: every backticked token in the rendered kernel that looks like
 * a repo-relative path — at least one `/`, no whitespace, a file extension or a known
 * repo-root directory. A `<placeholder>` segment (stories/<story>.md) is checked at its
 * parent directory. Exemptions are runtime files the extension writes into the checkout:
 * they are absent from a fresh clone by design and the kernel says so where it names them.
 */
function kernelRoutes(text, config) {
  var portFile = (config && config.tooling && config.tooling.agentPortFile) || '.vscode/sn-agent-port.json';
  var seen = {};
  var routes = [];
  var re = /`([^`\s]+)`/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var tok = m[1];
    if (tok.indexOf('/') < 0) { continue; }
    if (/^(https?:|[A-Za-z]:\\|\/)/.test(tok)) { continue; }               // URLs and absolute paths are not routes
    if (!/^[A-Za-z0-9_.\-<>]+(\/[A-Za-z0-9_.\-<>*]+)+\/?$/.test(tok)) { continue; }
    if (!/\.(md|json|js|ndjson|jsonl|txt)$/i.test(tok) && !/^(docs|\.claude|\.github|kernel|tools|wiki-scaffold)\//.test(tok)) { continue; }
    if (tok === portFile || /^agentrules\//.test(tok) || /^agentinstructions\.md$/.test(tok)) { continue; }
    if (seen[tok]) { continue; }
    seen[tok] = true;
    // Resolve up to the first placeholder or glob segment; a trailing slash means "this directory".
    var segs = tok.replace(/\/$/, '').split('/');
    var keep = [];
    for (var i = 0; i < segs.length; i++) { if (/[<>*]/.test(segs[i])) { break; } keep.push(segs[i]); }
    routes.push({ token: tok, resolve: keep.join('/') });
  }
  return routes;
}

function missingRoutes(text, config, repoRoot) {
  return kernelRoutes(text, config).filter(function (r) {
    return !r.resolve || !fs.existsSync(path.resolve(repoRoot, r.resolve));
  });
}

function render(repoRoot) {
  var template = readUtf8(path.join(repoRoot, 'kernel', 'CLAUDE.template.md'));
  var config = JSON.parse(readUtf8(path.join(repoRoot, 'product.config.json')));
  // Drop the template-only header comment BEFORE slot resolution (it documents the
  // {{dotted.path}} syntax, which must not be treated as a real slot).
  template = template.replace(/^<!--[\s\S]*?-->\s*/, '');
  var derived = derivedSlots(config);
  var errors = [];
  var rendered = template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, function (whole, slot) {
    var value = Object.prototype.hasOwnProperty.call(derived, slot) ? derived[slot] : lookup(config, slot);
    if (value === undefined || value === null || value === '') {
      errors.push('unresolved slot: ' + slot);
      return whole;
    }
    if (typeof value === 'string' && /^(REQUIRED|OPTIONAL)\b/.test(value)) {
      errors.push('slot still holds its placeholder: ' + slot + ' = "' + value.slice(0, 60) + '..."');
      return whole;
    }
    return String(value);
  });
  var slots = rendered.match(/<!--\s*SLOT:[^>]*-->/g) || [];
  slots.forEach(function (s) { errors.push('unresolved HTML-comment slot in the rendered kernel: ' + s.slice(0, 70).replace(/\s+/g, ' ') + ' — a DO NOT EDIT kernel may not ask its reader to finish it by hand'); });
  missingRoutes(rendered, config, repoRoot).forEach(function (r) {
    errors.push('routing map names `' + r.token + '` and nothing exists at ' + (r.resolve || '(unresolvable)') +
      ' — a route is an executable contract; fix the template or create the page');
  });
  var banner = '<!-- GENERATED from kernel/CLAUDE.template.md + product.config.json — DO NOT EDIT.\n' +
    '     Change the template/config and re-run: node tools/render-kernel.js\n' +
    '     Mirrors: ' + KERNEL_MIRRORS.join(', ') + ' (byte-identical by construction) -->\n\n';
  return { errors: errors, out: banner + rendered, config: config };
}

function writeMirrors(repoRoot, out) {
  KERNEL_MIRRORS.forEach(function (rel) {
    var abs = path.join(repoRoot, rel);
    var dir = path.dirname(abs);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(abs, out);
  });
}

function main() {
  var r;
  try { r = render(root); } catch (e) {
    console.error('render-kernel: cannot render — ' + e.message);
    return 1;
  }
  if (r.errors.length) {
    var unique = r.errors.filter(function (e, i) { return r.errors.indexOf(e) === i; });
    console.error('render-kernel: REFUSING to write — ' + unique.length + ' problem(s):');
    unique.forEach(function (e) { console.error('  - ' + e); });
    return 1;
  }
  if (CHECK_ONLY) {
    console.log('render-kernel --check: clean (' + KERNEL_MIRRORS.length + ' mirrors would be written, ' + Math.round(r.out.length / 4) + ' est. tokens)');
    return 0;
  }
  writeMirrors(root, r.out);
  console.log('render-kernel: wrote ' + KERNEL_MIRRORS.join(' + ') + ' (' + Math.round(r.out.length / 4) + ' est. tokens)');
  return 0;
}

if (require.main === module) { process.exit(main()); }
module.exports = { KERNEL_MIRRORS, derivedSlots, kernelRoutes, missingRoutes, render };
