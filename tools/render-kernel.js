#!/usr/bin/env node
/*
 * render-kernel.js — the kernel single-source mechanism.
 *
 * Reads kernel/CLAUDE.template.md + product.config.json, resolves every {{dotted.path}}
 * slot, and writes BOTH rendered copies:
 *   - CLAUDE.md                        (Claude Code kernel)
 *   - .github/copilot-instructions.md  (GitHub Copilot kernel — exact mirror)
 * Mirror drift is impossible by construction; the kernel-integrity hook still checks,
 * as a belt-and-braces guard against hand edits of the rendered files.
 *
 * Fails LOUDLY on unresolved slots or REQUIRED-placeholder config values: a kernel with
 * a hole in it is worse than no kernel.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var templatePath = path.join(root, 'kernel', 'CLAUDE.template.md');
var configPath = path.join(root, 'product.config.json');

// Strip a UTF-8 BOM if present — PowerShell's Out-File/Set-Content write one, and
// JSON.parse rejects it. Every config consumer in this repo must do the same.
var template = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '');
var config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));

// Drop the template-only header comment BEFORE slot resolution (it documents the
// {{dotted.path}} syntax, which must not be treated as a real slot).
template = template.replace(/^<!--[\s\S]*?-->\s*/, '');

function lookup(obj, dotted) {
  var parts = dotted.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || typeof cur !== 'object' || !(parts[i] in cur)) { return undefined; }
    cur = cur[parts[i]];
  }
  return cur;
}

var errors = [];
var rendered = template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, function (whole, slot) {
  var value = lookup(config, slot);
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

var banner = '<!-- GENERATED from kernel/CLAUDE.template.md + product.config.json — DO NOT EDIT.\n' +
  '     Change the template/config and re-run: node tools/render-kernel.js -->\n\n';

if (errors.length) {
  var unique = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
  console.error('render-kernel: REFUSING to write — ' + unique.length + ' problem(s):');
  unique.forEach(function (e) { console.error('  - ' + e); });
  process.exit(1);
}

var out = banner + rendered;
fs.writeFileSync(path.join(root, 'CLAUDE.md'), out);
var ghDir = path.join(root, '.github');
if (!fs.existsSync(ghDir)) { fs.mkdirSync(ghDir); }
fs.writeFileSync(path.join(ghDir, 'copilot-instructions.md'), out);
console.log('render-kernel: wrote CLAUDE.md + .github/copilot-instructions.md (' +
  Math.round(out.length / 4) + ' est. tokens)');
