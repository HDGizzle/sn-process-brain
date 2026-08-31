#!/usr/bin/env node
/*
 * install.js - one command that turns an empty (or existing) engagement repo into a
 * working ServiceNow agentic-development repo.
 *
 *   node tools/snbrain/install.js --target <engagement-repo> [--instance <name>] [--force]
 *
 * What it installs is the PRODUCT LAYER: the kernel template and its renderer, the
 * enforcement hooks and their wiring, the build-procedure skills, the snbrain CLI, the
 * slash commands, and the wiki scaffold at the configured wikiRoot. After it runs the
 * operator authenticates the helper tab, fills the remaining slots, and starts the run
 * with /map-instance.
 *
 * Three rules govern every write:
 *   1. Nothing is overwritten without --force, and the full plan is printed before any
 *      byte is written.
 *   2. product.config.json is NEVER clobbered, not even with --force. It carries the
 *      operator's answers. It is only ever EXTENDED with keys it is missing, because a
 *      slot that silently reverts to "REQUIRED - ..." makes render-kernel.js refuse to
 *      write and the failure looks like a tool bug rather than a config regression.
 *   3. Re-running is safe. A second run reports "already installed, N files differ"
 *      and touches nothing.
 *
 * Plain Node, no dependencies. Windows-friendly (no shell assumptions, no POSIX paths).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

var SOURCE_ROOT = path.resolve(__dirname, '..', '..');
var TOOL_NAME = 'snbrain install';

/* ------------------------------------------------------------------ arguments */

function parseArgs(argv) {
  var args = { force: false, dryRun: false, help: false };
  for (var i = 0; i < argv.length; i++) {
    var token = argv[i];
    if (token === '--force') { args.force = true; continue; }
    if (token === '--blind') { args.blind = true; continue; }
    if (token === '--dry-run') { args.dryRun = true; continue; }
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (token === '--target') { args.target = argv[++i]; continue; }
    if (token === '--instance') { args.instance = argv[++i]; continue; }
    if (token === '--wiki-root') { args.wikiRoot = argv[++i]; continue; }
    fail('unknown argument: ' + token + '\n' + usage());
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/snbrain/install.js --target <engagement-repo> [options]',
    '',
    'Options:',
    '  --target <dir>      the engagement repo to install into (required)',
    '  --instance <name>   dev instance name, e.g. devinst01. Seeds the config slots.',
    '  --wiki-root <path>  repo-relative wiki root. Default: docs/wiki, or whatever an',
    '                      existing product.config.json in the target already says.',
    '  --force             overwrite product-layer files that differ. Never touches',
    '                      product.config.json values.',
    '  --dry-run           print the plan and exit without writing.',
    '  --blind             omit knowledge-bearing files (the design of record, which names a',
    '                      real engagement (scopes, tables, sys_ids). Use when the target',
    '                      instance is one this product already documents, and pair it with',
    '                      `snbrain init --blind` so the briefs stop citing them.',
    '',
    'Exit codes: 0 installed or already current, 1 error, 3 files differ (needs --force).'
  ].join('\n');
}

function fail(message) {
  process.stderr.write(TOOL_NAME + ': ' + message + '\n');
  process.exit(1);
}

/* ---------------------------------------------------------------- fs helpers */

function readTextOrNull(filePath) {
  try { return fs.readFileSync(filePath); } catch (readError) { return null; }
}

function readJsonOrNull(filePath) {
  var raw = readTextOrNull(filePath);
  if (raw === null) { return null; }
  try { return JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); }
  catch (parseError) { fail('cannot parse ' + filePath + ': ' + parseError.message); }
}

function isDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch (statError) { return false; }
}

function isFile(candidate) {
  try { return fs.statSync(candidate).isFile(); } catch (statError) { return false; }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// Compare on normalized text so a CRLF checkout on Windows does not read as a real
// difference. Copies stay byte-for-byte; only the comparison is normalized.
var TEXT_EXTENSIONS = ['.js', '.json', '.md', '.sh', '.txt', '.jsonc', '.yml', '.yaml'];

function digest(buffer, filePath) {
  var isText = TEXT_EXTENSIONS.indexOf(path.extname(filePath).toLowerCase()) !== -1;
  var payload = buffer;
  if (isText) {
    payload = Buffer.from(
      buffer.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'),
      'utf8'
    );
  }
  return crypto.createHash('sha256').update(payload).digest('hex');
}

var WALK_SKIP = ['.git', 'node_modules', '.brain', '_tmp', '.DS_Store', 'Thumbs.db'];

function walkFiles(rootDir, relativePrefix, collected) {
  var entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (WALK_SKIP.indexOf(entry.name) !== -1) { continue; }
    var absolute = path.join(rootDir, entry.name);
    var relative = relativePrefix ? relativePrefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { walkFiles(absolute, relative, collected); }
    else if (entry.isFile()) { collected.push(relative); }
  }
  return collected;
}

/* ------------------------------------------------------------- copy manifest */

/*
 * Each item maps a source path in the framework to a destination path in the target.
 * `required: false` items are the ones later lanes produce (the CLI's stage briefs, the
 * slash commands). They are skipped with a visible note rather than failing the install,
 * so this works today and picks them up the moment they land.
 */
function buildManifest(wikiRoot) {
  return [
    // Enforcement layer. Hooks are useless without the settings.json that wires them.
    { from: '.claude/hooks', to: '.claude/hooks', kind: 'dir', required: true,
      note: 'enforcement hooks: write guard, delete gate, capture verifier, skill routing, kernel integrity' },
    { from: '.claude/settings.json', to: '.claude/settings.json', kind: 'file', required: true,
      note: 'hook wiring' },

    // Procedure layer.
    { from: '.claude/skills', to: '.claude/skills', kind: 'dir', required: true,
      note: 'build-procedure skills' },
    { from: '.claude/workflows', to: '.claude/workflows', kind: 'dir', required: false,
      note: 'workflow scripts' },

    // The loop: stage briefs and the slash-command entry point.
    { from: '.claude/snbrain', to: '.claude/snbrain', kind: 'dir', required: false,
      note: 'stage briefs and schemas for the next/ingest seam' },
    { from: '.claude/commands', to: '.claude/commands', kind: 'dir', required: false,
      note: 'slash commands, including /map-instance' },

    // Deterministic layer.
    { from: 'tools/snbrain', to: 'tools/snbrain', kind: 'dir', required: true,
      exclude: ['install.js'],
      note: 'the snbrain CLI, the read-only API client and the WP-A probes' },

    // Kernel single-source. render-kernel.js resolves its inputs relative to its own
    // parent-of-parent, so the template must travel with it or the target cannot render
    // a kernel at all.
    { from: 'tools/render-kernel.js', to: 'tools/render-kernel.js', kind: 'file', required: true,
      note: 'renders CLAUDE.md and the Copilot mirror from the template plus the config' },
    { from: 'kernel', to: 'kernel', kind: 'dir', required: true,
      note: 'CLAUDE.template.md, the single source for both rendered kernels' },

    // The design of record. SIX stage briefs cite docs/rework-plan.md line ranges as a
    // REQUIRED read, and the loop runs in the engagement repo, not the framework repo.
    // Without this the agent is told to read a file that is not there on most stages.
    /*
     * KNOWLEDGE-BEARING, and that cuts both ways. Six briefs cite it, so a normal install
     * needs it. But it argues every rule from worked examples taken from a REAL engagement
     * — naming that engagement's scopes, custom tables, decision numbers, message-key
     * namespaces, glossary answers and literal record sys_ids. Installing it into a repo
     * that is about to map THAT engagement hands the agent the answer key.
     *
     * `--blind` omits it. Pair with `snbrain init --blind`, which drops the six pointers
     * from the briefs, so the briefs and the filesystem agree rather than the briefs
     * pointing at a file that is quietly present.
     */
    { from: 'docs/rework-plan.md', to: 'docs/rework-plan.md', kind: 'file', required: true,
      knowledgeBearing: true,
      note: 'design of record; required reading for six of the eight stage briefs' },

    // Knowledge layer, retargeted to the configured wiki root.
    { from: 'wiki-scaffold', to: wikiRoot, kind: 'dir', required: true,
      note: 'wiki scaffold: registry, decisions, gotchas, conventions, TBDs, story records' },

    // Required state, not a preference: without it sn-scriptsync re-injects its managed
    // block into CLAUDE.md and the kernel silently re-fattens.
    { from: '.vscode/settings.json', to: '.vscode/settings.json', kind: 'file', required: true,
      note: 'sn-scriptsync.agentInstructions.autoUpdate=false' }
  ];
}

/* ------------------------------------------------------------------ planning */

var ACTION_CREATE = 'create';
var ACTION_SAME = 'same';
var ACTION_DIFFERS = 'differs';

function planFileCopies(manifest, targetRoot) {
  var plan = [];
  var missingSources = [];

  manifest.forEach(function (item) {
    var sourceAbsolute = path.join(SOURCE_ROOT, item.from);
    var exists = item.kind === 'dir' ? isDirectory(sourceAbsolute) : isFile(sourceAbsolute);

    if (!exists) {
      if (item.required) {
        fail('source missing: ' + item.from + ' under ' + SOURCE_ROOT +
             '\n  The framework repo is incomplete. Refusing to install a partial product layer.');
      }
      missingSources.push(item);
      return;
    }

    var relatives = item.kind === 'dir' ? walkFiles(sourceAbsolute, '', []) : [''];
    relatives.forEach(function (relative) {
      if (item.exclude && item.exclude.indexOf(relative) !== -1) { return; }
      var from = relative ? path.join(sourceAbsolute, relative.split('/').join(path.sep)) : sourceAbsolute;
      var toRelative = relative ? item.to + '/' + relative : item.to;
      var to = path.join(targetRoot, toRelative.split('/').join(path.sep));

      var sourceBuffer = fs.readFileSync(from);
      var targetBuffer = readTextOrNull(to);
      var action = ACTION_CREATE;
      if (targetBuffer !== null) {
        action = digest(sourceBuffer, from) === digest(targetBuffer, to) ? ACTION_SAME : ACTION_DIFFERS;
      }
      plan.push({ from: from, to: to, toRelative: toRelative, action: action, group: item.to });
    });
  });

  return { plan: plan, missingSources: missingSources };
}

/* ------------------------------------------------------- product.config.json */

/*
 * Slot defaults added on top of the framework registry. Every one carries a working
 * value, because the hooks and the read adapter load this file at runtime and must fail
 * open. Source: docs/rework-plan.md section 6.11.
 */
function snbrainSlotDefaults() {
  return {
    tooling: {
      readAdapter: 'scriptsync',
      supportedApiVersions: [4, 5, 6],
      restRequestReads: 'auto'
    },
    read: {
      pageSize: 100,
      widePageSize: 25,
      wideFieldTables: ['sys_update_xml', 'sys_script', 'sys_script_include', 'sp_widget', 'sys_ui_page'],
      maxConcurrency: 1,
      requestTimeoutMs: 75000,
      retry: { maxAttempts: 2, baseMs: 500, jitter: true, retryOn: ['E_TIMEOUT', 'E_INTERNAL'] },
      identityProperty: 'instance_name',
      guardBudgetPct: { negation: 15 }
    },
    verify: { staleAfterDays: 14 },
    budgets: {
      mapApiCalls: 2000,
      verifyApiCalls: 600,
      mapWallClockMin: 45,
      questionsPerRun: 10
    },
    paths: { brainRoot: '.brain' },
    instanceIdentity: {
      name: 'REQUIRED - instance name used to stamp every claim, e.g. devinst01',
      url: 'REQUIRED - instance base URL, e.g. https://devinst01.service-now.com',
      tier: 'REQUIRED - customer-dev | customer-test | vendor-dev | sandbox'
    },
    // PLAN 7.6 — the persona kernel's ledger-fact slots. Filled MECHANICALLY by
    // `node tools/snbrain/render.js --root . --kernel-facts` once a ledger exists —
    // never typed by hand and never free prose: render-kernel.js refuses to write
    // while any of them still holds this placeholder, which is the 6.5 failure mode
    // (a kernel naming the wrong instance) made impossible rather than checked.
    ledger: {
      instanceLine: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts'
    },
    vocabulary: {
      section: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts'
    },
    orgMap: {
      section: 'REQUIRED - generated from the claim ledger: node tools/snbrain/render.js --root . --kernel-facts'
    }
  };
}

// Adds keys the target lacks. Never replaces a value the operator already set, and never
// re-imposes a REQUIRED placeholder over a real answer.
function mergeMissing(base, additions, trail, added) {
  Object.keys(additions).forEach(function (key) {
    var dotted = trail ? trail + '.' + key : key;
    var incoming = additions[key];
    var isPlainObject = incoming !== null && typeof incoming === 'object' && !Array.isArray(incoming);
    if (!(key in base)) {
      base[key] = incoming;
      added.push(dotted);
      return;
    }
    if (isPlainObject && base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      mergeMissing(base[key], incoming, dotted, added);
    }
  });
  return base;
}

function isPlaceholder(value) {
  return typeof value === 'string' && /^(REQUIRED|OPTIONAL)\b/.test(value);
}

function lookupSlot(config, dotted) {
  var parts = dotted.split('.');
  var cursor = config;
  for (var i = 0; i < parts.length; i++) {
    if (cursor === null || typeof cursor !== 'object' || !(parts[i] in cursor)) { return undefined; }
    cursor = cursor[parts[i]];
  }
  return cursor;
}

// The slots render-kernel.js will actually try to resolve. It strips the template's
// leading header comment before substituting, so this must strip it too, otherwise the
// {{dotted.path}} example inside that comment is reported as a real unresolved slot.
function kernelSlots() {
  var templatePath = path.join(SOURCE_ROOT, 'kernel', 'CLAUDE.template.md');
  var raw = readTextOrNull(templatePath);
  if (raw === null) { return []; }
  var body = raw.toString('utf8').replace(/^﻿/, '').replace(/^<!--[\s\S]*?-->\s*/, '');
  var found = {};
  var pattern = /\{\{([a-zA-Z0-9_.]+)\}\}/g;
  var match;
  while ((match = pattern.exec(body)) !== null) { found[match[1]] = true; }
  return Object.keys(found).sort();
}

function buildTargetConfig(targetRoot, options) {
  var targetConfigPath = path.join(targetRoot, 'product.config.json');
  var existing = readJsonOrNull(targetConfigPath);
  var base = existing;
  var created = false;

  if (base === null) {
    base = readJsonOrNull(path.join(SOURCE_ROOT, 'product.config.json'));
    if (base === null) { fail('framework product.config.json not found under ' + SOURCE_ROOT); }
    created = true;
  }

  var added = [];
  mergeMissing(base, snbrainSlotDefaults(), '', added);

  var seeded = [];
  function seed(dotted, value) {
    var parts = dotted.split('.');
    var cursor = base;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) { cursor[parts[i]] = {}; }
      cursor = cursor[parts[i]];
    }
    var leaf = parts[parts.length - 1];
    var current = cursor[leaf];
    // Only fill holes. An answered slot is the operator's, and stays theirs.
    if (current === undefined || current === null || current === '' || isPlaceholder(current)) {
      cursor[leaf] = value;
      seeded.push(dotted + ' = ' + value);
    }
  }

  if (options.instance) {
    seed('instances.dev', options.instance);
    seed('instanceIdentity.name', options.instance);
    seed('instanceIdentity.url', 'https://' + options.instance + '.service-now.com');
  }
  // wikiRoot is not a question, it is where this installer just put the scaffold.
  base.paths = base.paths || {};
  if (base.paths.wikiRoot !== options.wikiRoot) {
    base.paths.wikiRoot = options.wikiRoot;
    seeded.push('paths.wikiRoot = ' + options.wikiRoot);
  }

  // The instance the repo will ACTUALLY run against is whatever the config says, not
  // whatever the flag said. If those disagree the operator has to know, because every
  // NEXT STEP below names an instance and a silent mismatch sends the run at the wrong
  // one.
  var configured = base.instanceIdentity && !isPlaceholder(base.instanceIdentity.name)
    ? base.instanceIdentity.name
    : (base.instances && !isPlaceholder(base.instances.dev) ? base.instances.dev : null);
  var effectiveInstance = configured || options.instance || null;
  var instanceConflict = (options.instance && configured && configured !== options.instance)
    ? { passed: options.instance, configured: configured }
    : null;

  var serialized = JSON.stringify(base, null, 2) + '\n';
  var currentRaw = readTextOrNull(targetConfigPath);
  var changed = currentRaw === null ||
    digest(Buffer.from(serialized, 'utf8'), targetConfigPath) !== digest(currentRaw, targetConfigPath);

  // What still blocks a kernel render, stated now rather than discovered later.
  var unresolved = kernelSlots().filter(function (slot) {
    var value = lookupSlot(base, slot);
    return value === undefined || value === null || value === '' || isPlaceholder(value);
  });

  // Slots outside the kernel template that the loop still needs a real answer for.
  var otherPlaceholders = [];
  (function scan(node, trail) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) { return; }
    Object.keys(node).forEach(function (key) {
      if (key === '$comment') { return; }
      var dotted = trail ? trail + '.' + key : key;
      if (isPlaceholder(node[key])) {
        if (unresolved.indexOf(dotted) === -1 && !/^OPTIONAL\b/.test(node[key])) { otherPlaceholders.push(dotted); }
      } else { scan(node[key], dotted); }
    });
  })(base, '');

  return {
    filePath: targetConfigPath,
    contents: serialized,
    created: created,
    changed: changed,
    addedKeys: added,
    seeded: seeded,
    unresolvedKernelSlots: unresolved,
    otherPlaceholders: otherPlaceholders,
    effectiveInstance: effectiveInstance,
    instanceConflict: instanceConflict
  };
}

/* -------------------------------------------------------------- .gitignore */

var GITIGNORE_BEGIN = '# >>> snbrain install: managed block, do not edit inside these markers >>>';
var GITIGNORE_END = '# <<< snbrain install: managed block <<<';

/*
 * The engagement .gitignore is NOT the framework's. It inverts one rule deliberately.
 * The framework ignores every .brain/ anywhere, because instance data must never reach
 * the product repo. In the engagement repo the ledgers ARE the evidence base, so
 * state.json, claims.jsonl, questions.jsonl and decisions.jsonl are tracked on purpose,
 * and only .brain/raw/ (bulk instance payloads) is excluded.
 */
function gitignoreBlock(wikiRoot) {
  return [
    GITIGNORE_BEGIN,
    '# Written by the framework installer. To refresh it, re-run the installer FROM THE',
    '# FRAMEWORK REPO (it is not copied into the engagement repo on purpose):',
    '#   node tools/snbrain/install.js --target <this repo>',
    '# Rules outside these markers are yours and are never touched.',
    '',
    '# --- credentials. These are the real hazards. ---',
    '# sn-scriptsync per-instance settings files carry instance credentials. Ignore every',
    '# settings.json, then re-include the two that are versioned deliberately.',
    '**/_settings.json',
    '**/settings.json',
    '!.claude/settings.json',
    '!.vscode/settings.json',
    '',
    '# Live agent token for the helper tab. Rotates per session, never commit it.',
    '.vscode/sn-agent-port.json',
    '',
    '# MCP server config may carry credentials.',
    '.mcp.json',
    '',
    '# --- sn-scriptsync transient state ---',
    '**/_last_error.json',
    '**/_requests.json',
    '**/_requests.log',
    '**/agent/requests/',
    '**/agent/responses/',
    '**/agent/_*',
    '',
    /*
     * PRODUCT-97. This block used to assert "They are committed" and nothing checked it: both
     * engagement repos had the whole brain untracked, and run 93838afe87's entire deliverable
     * existed only as working-tree state over a commit dated two days before the run. A comment
     * that says a thing is committed is a test with no runner, which is the `detect-only` failure
     * this register named at PLATFORM-5 — so the sentence now names its runner.
     */
    '# --- the brain. TRACKED ON PURPOSE, with one exclusion. ---',
    '# state.json and the three ledgers are the run\'s audit trail and the evidence base',
    '# of the deliverable. The render stage COMMITS them, and',
    '#   node tools/snbrain/render.js --root . --deliverable-check',
    '# asserts that every path render.json declared, plus the kernel, the hooks, the build',
    '# skills and these four files, is tracked AND clean. Tracked alone is not delivered.',
    '#',
    '# raw/ is excluded, and that is a DECISION rather than an inheritance: it holds',
    '# whole-instance streamed payloads that were never meant to enter context or a diff,',
    '# so nothing that exists only there can ever reach a reader. Anything in it that',
    '# matters is promoted into docs/wiki/evidence/ by `render.js --appendix`, which',
    '# generates from claims.jsonl — a file that ships.',
    '.brain/raw/',
    '',
    '# --- scratch layers. Where instance data and PII sneak into git. ---',
    '**/_tmp/',
    '**/_tmp_*',
    '**/_demo_prep_*/',
    '/screenshots/',
    'debug.log',
    'audit.log',
    '*_composition_temp.json',
    '',
    '# --- local-only agent state ---',
    '.claude/settings.local.json',
    '.claude/scheduled_tasks.lock',
    '',
    '# --- generated / vendored ---',
    'autocomplete/server.d.ts',
    'node_modules/',
    '',
    '# --- OS and editors ---',
    '.DS_Store',
    'Thumbs.db',
    '',
    '# NOTE: ' + wikiRoot + '/ is TRACKED. It is the knowledge deliverable.',
    '# NOTE: snbrain-requests.ndjson is TRACKED. It is the append-before-send proof that',
    '#       every instance call was read-only, and it is what you hand the instance owner.',
    GITIGNORE_END
  ].join('\n');
}

function planGitignore(targetRoot, wikiRoot) {
  var filePath = path.join(targetRoot, '.gitignore');
  var block = gitignoreBlock(wikiRoot);
  var existingBuffer = readTextOrNull(filePath);

  if (existingBuffer === null) {
    return { filePath: filePath, contents: block + '\n', action: ACTION_CREATE };
  }

  var existing = existingBuffer.toString('utf8').replace(/^﻿/, '');
  var beginIndex = existing.indexOf(GITIGNORE_BEGIN);
  var endIndex = existing.indexOf(GITIGNORE_END);

  if (beginIndex === -1 || endIndex === -1) {
    // Somebody else's .gitignore. Append our block, never rewrite their rules.
    var joined = existing.replace(/\s*$/, '') + '\n\n' + block + '\n';
    return { filePath: filePath, contents: joined, action: 'append-block' };
  }

  var head = existing.slice(0, beginIndex);
  var tail = existing.slice(endIndex + GITIGNORE_END.length);
  var rebuilt = head + block + tail;
  if (rebuilt.replace(/\r\n/g, '\n') === existing.replace(/\r\n/g, '\n')) {
    return { filePath: filePath, contents: rebuilt, action: ACTION_SAME };
  }
  return { filePath: filePath, contents: rebuilt, action: 'update-block' };
}

/* ------------------------------------------------------------------ reporting */

function summarize(plan) {
  var counts = {};
  counts[ACTION_CREATE] = 0;
  counts[ACTION_SAME] = 0;
  counts[ACTION_DIFFERS] = 0;
  plan.forEach(function (entry) { counts[entry.action]++; });
  return counts;
}

function printPlan(plan, missingSources, configPlan, gitignorePlan, options) {
  var counts = summarize(plan);
  var byGroup = {};
  plan.forEach(function (entry) {
    if (!byGroup[entry.group]) { byGroup[entry.group] = { create: 0, same: 0, differs: 0 }; }
    byGroup[entry.group][entry.action]++;
  });

  process.stdout.write('\n' + TOOL_NAME + '\n');
  process.stdout.write('  source: ' + SOURCE_ROOT + '\n');
  process.stdout.write('  target: ' + options.targetRoot + '\n');
  process.stdout.write('  wiki:   ' + options.wikiRoot + '\n');
  if (options.instance) { process.stdout.write('  instance: ' + options.instance + '\n'); }
  process.stdout.write('\nPLAN\n');

  Object.keys(byGroup).sort().forEach(function (group) {
    var g = byGroup[group];
    var parts = [];
    if (g.create) { parts.push(g.create + ' new'); }
    if (g.differs) { parts.push(g.differs + ' differ'); }
    if (g.same) { parts.push(g.same + ' identical'); }
    process.stdout.write('  ' + pad(group, 28) + parts.join(', ') + '\n');
  });

  missingSources.forEach(function (item) {
    process.stdout.write('  ' + pad(item.to, 28) + 'SKIPPED, not built yet in the framework repo (' + item.note + ')\n');
  });

  process.stdout.write('  ' + pad('product.config.json', 28) +
    (configPlan.created ? 'new, seeded from the framework slot registry'
                        : (configPlan.changed ? 'exists, extended with ' + configPlan.addedKeys.length + ' missing key(s)'
                                              : 'exists, already current')) + '\n');
  if (configPlan.addedKeys.length) {
    process.stdout.write('    added:  ' + configPlan.addedKeys.join(', ') + '\n');
  }
  if (configPlan.seeded.length) {
    process.stdout.write('    seeded: ' + configPlan.seeded.join('\n            ') + '\n');
  }

  process.stdout.write('  ' + pad('.gitignore', 28) + gitignorePlan.action + '\n');

  if (counts[ACTION_DIFFERS] > 0) {
    process.stdout.write('\n  files that differ' +
      (options.force ? ' (will be OVERWRITTEN, --force given):' : ' (left alone, needs --force):') + '\n');
    plan.filter(function (e) { return e.action === ACTION_DIFFERS; })
      .forEach(function (e) { process.stdout.write('    ' + e.toRelative + '\n'); });
  }

  if (configPlan.instanceConflict) {
    process.stdout.write('\n  WARNING: --instance ' + configPlan.instanceConflict.passed +
      ' does not match the instance already configured in\n           product.config.json (' +
      configPlan.instanceConflict.configured +
      '). The config wins, it carries the operator\'s answer.\n' +
      '           Edit product.config.json by hand if the engagement really moved instance.\n');
  }
  process.stdout.write('\n');
}

function pad(text, width) {
  var out = String(text);
  while (out.length < width) { out += ' '; }
  return out;
}

/* --------------------------------------------------------------------- apply */

function applyPlan(plan, force) {
  var written = 0;
  var skipped = 0;
  plan.forEach(function (entry) {
    if (entry.action === ACTION_SAME) { return; }
    if (entry.action === ACTION_DIFFERS && !force) { skipped++; return; }
    ensureDir(path.dirname(entry.to));
    fs.copyFileSync(entry.from, entry.to);
    written++;
  });
  /*
   * PRODUCT-86. VERIFY WHAT WAS PLANNED ACTUALLY LANDED.
   *
   * The manifest already refuses to install when a REQUIRED SOURCE is missing. It never checked
   * the other end. Engagement repo `pilot-run-4` was installed on 2026-08-14 from a manifest that
   * has carried `docs/rework-plan.md` as `required: true` since 2026-08-04, and the file is not
   * there — while six stage briefs cite line ranges in it as `required: true` reads. The run
   * reached harvest and was told to read a file that does not exist, and nothing anywhere said so.
   * A `differs`-and-not-forced entry is a deliberate skip and is exempt; everything else the plan
   * said it would write has to exist afterwards.
   */
  var absent = plan.filter(function (entry) {
    if (entry.action === ACTION_DIFFERS && !force) { return false; }
    return !fs.existsSync(entry.to);
  });
  if (absent.length) {
    fail('install wrote ' + written + ' file(s) and ' + absent.length + ' planned target(s) are not on disk:\n  ' +
      absent.slice(0, 10).map(function (e) { return e.toRelative; }).join('\n  ') +
      (absent.length > 10 ? '\n  … (' + absent.length + ' in total)' : '') +
      '\n  A partial install is worse than none: stage briefs cite these paths as required reads, and a' +
      '\n  missing one surfaces as an agent improvising four stages later rather than as an error here.');
  }
  return { written: written, skipped: skipped };
}

function initGitRepo(targetRoot) {
  if (isDirectory(path.join(targetRoot, '.git'))) { return 'already a git repo'; }
  var result = childProcess.spawnSync('git', ['init'], {
    cwd: targetRoot, encoding: 'utf8', shell: process.platform === 'win32'
  });
  if (result.error || result.status !== 0) {
    return 'git init FAILED (' + ((result.error && result.error.message) ||
      (result.stderr || '').trim() || 'exit ' + result.status) + '). Initialize it yourself.';
  }
  /*
   * PRODUCT-97. Still no automatic commit of the scaffold — that stays a human's call — but the
   * sentence now says what happens later, because "nothing was committed" was true of BOTH
   * engagement repos at the END of a run as well as at the start, and nobody noticed.
   */
  return 'git init done. Nothing was committed — review and commit the scaffold yourself. ' +
    'The render stage commits its own output and refuses to leave it untracked.';
}

/* ---------------------------------------------------------------- next steps */

function printNextSteps(options, configPlan, missingSources) {
  var step = 0;
  var instance = configPlan.effectiveInstance || '<instance>';
  function line(text) { process.stdout.write('  ' + (++step) + '. ' + text + '\n'); }

  process.stdout.write('NEXT STEPS\n');

  if (configPlan.unresolvedKernelSlots.length) {
    line('Fill these slots in product.config.json. render-kernel.js REFUSES to write while\n' +
         '     any of them still holds its placeholder, so the kernel does not exist until they\n' +
         '     are answered:\n' +
         configPlan.unresolvedKernelSlots.map(function (s) { return '       - ' + s; }).join('\n'));
  }
  if (configPlan.otherPlaceholders.length) {
    line('Also answer these (not kernel-blocking, but the loop stamps claims with them):\n' +
         configPlan.otherPlaceholders.map(function (s) { return '       - ' + s; }).join('\n'));
  }

  line('Render the kernel:\n' +
       '       cd ' + options.targetRoot + '\n' +
       '       node tools/render-kernel.js\n' +
       '     Writes CLAUDE.md and .github/copilot-instructions.md. Never edit either by hand,\n' +
       '     the kernel-integrity hook flags drift on the next session start.');

  line('Open the engagement repo in VS Code with the sn-scriptsync extension active, and\n' +
       '     open the helper tab for ' + instance + ' so the browser session is authenticated.\n' +
       '     Confirm .vscode/sn-agent-port.json appears. That file is the live token and is\n' +
       '     gitignored.');

  line('Verify the transport before trusting anything it returns:\n' +
       '       node tools/snbrain/probe.js --instance ' + instance + ' --root <scriptsync-sync-folder>\n' +
       '     Exit 0 means every probe was conclusive. Exit 1 means a kill criterion fired and\n' +
       '     the run stops here.');

  line('Start the brain. In Claude Code, opened on this repo:\n' +
       '       /map-instance ' + instance);

  if (missingSources.length) {
    line('NOTE: ' + missingSources.map(function (m) { return m.to; }).join(', ') +
         ' were not present in the framework\n' +
         '     repo and were not installed. /map-instance will not resolve until they are built\n' +
         '     and this installer is re-run with --force.');
  }

  process.stdout.write('\n');
}

/* ---------------------------------------------------------------------- main */

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage() + '\n'); return 0; }
  if (!args.target) { fail('--target is required.\n' + usage()); }

  var targetRoot = path.resolve(args.target);

  if (!isDirectory(targetRoot)) {
    fail('target is not an existing directory: ' + targetRoot +
         '\n  Create it first. This tool will not invent the engagement repo location.');
  }
  if (path.resolve(targetRoot) === path.resolve(SOURCE_ROOT)) {
    fail('target is the framework repo itself. Install into the ENGAGEMENT repo, not the product.');
  }
  try {
    fs.accessSync(targetRoot, fs.constants.W_OK);
  } catch (accessError) {
    fail('target is not writable: ' + targetRoot);
  }

  // wikiRoot precedence: explicit flag, then whatever the target already decided, then
  // the framework default. Changing it after a run would orphan the installed scaffold.
  var existingConfig = readJsonOrNull(path.join(targetRoot, 'product.config.json'));
  var frameworkConfig = readJsonOrNull(path.join(SOURCE_ROOT, 'product.config.json')) || {};
  var wikiRoot = args.wikiRoot ||
    (existingConfig && existingConfig.paths && existingConfig.paths.wikiRoot) ||
    (frameworkConfig.paths && frameworkConfig.paths.wikiRoot) ||
    'docs/wiki';
  wikiRoot = wikiRoot.replace(/\\/g, '/').replace(/\/+$/, '');

  var options = {
    targetRoot: targetRoot,
    wikiRoot: wikiRoot,
    instance: args.instance,
    force: args.force
  };

  var manifest = buildManifest(wikiRoot);
  if (args.blind) {
    var omitted = manifest.filter(function (m) { return m.knowledgeBearing; });
    manifest = manifest.filter(function (m) { return !m.knowledgeBearing; });
    console.log('BLIND INSTALL: ' + omitted.length + ' knowledge-bearing file(s) omitted:');
    omitted.forEach(function (m) { console.log('  - ' + m.from + '  (' + m.note + ')'); });
    console.log('  Run `snbrain init --blind` too, so the stage briefs stop citing them.');
    console.log('');
  }
  var planned = planFileCopies(manifest, targetRoot);
  var configPlan = buildTargetConfig(targetRoot, options);
  var gitignorePlan = planGitignore(targetRoot, wikiRoot);

  printPlan(planned.plan, planned.missingSources, configPlan, gitignorePlan, options);

  var counts = summarize(planned.plan);
  var alreadyInstalled = counts[ACTION_CREATE] === 0 && !configPlan.created;

  if (args.dryRun) {
    process.stdout.write('DRY RUN. Nothing was written.\n\n');
    return counts[ACTION_DIFFERS] > 0 && !args.force ? 3 : 0;
  }

  if (alreadyInstalled && counts[ACTION_DIFFERS] === 0 && !configPlan.changed &&
      gitignorePlan.action === ACTION_SAME) {
    process.stdout.write('already installed, 0 files differ. Nothing to do.\n\n');
    printNextSteps(options, configPlan, planned.missingSources);
    return 0;
  }

  if (alreadyInstalled && counts[ACTION_DIFFERS] > 0 && !args.force) {
    process.stdout.write('already installed, ' + counts[ACTION_DIFFERS] + ' file(s) differ.\n' +
      '  Nothing was overwritten. Re-run with --force to take the framework version,\n' +
      '  or diff them first if those edits were deliberate.\n');
  }

  var applied = applyPlan(planned.plan, args.force);

  if (configPlan.changed) {
    fs.writeFileSync(configPlan.filePath, configPlan.contents);
  }
  if (gitignorePlan.action !== ACTION_SAME) {
    fs.writeFileSync(gitignorePlan.filePath, gitignorePlan.contents);
  }

  process.stdout.write('\nWROTE ' + applied.written + ' file(s)' +
    (applied.skipped ? ', left ' + applied.skipped + ' differing file(s) untouched' : '') + '.\n');
  process.stdout.write('GIT   ' + initGitRepo(targetRoot) + '\n\n');

  printNextSteps(options, configPlan, planned.missingSources);

  return applied.skipped > 0 ? 3 : 0;
}

process.exit(main());
