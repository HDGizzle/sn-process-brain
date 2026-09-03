#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/bootstrap.js — initialise the brain IN PLACE.
 *
 * D2 (2026-09-02). The cloned (or extracted) product folder IS the engagement root and the
 * workspace: the brain, the wiki, the rendered kernel and sn-scriptsync's port file all land
 * here, and `snbrain finalize` turns this same folder into the deliverable at the end. The
 * previous shape — a sibling `<instance>-<process>-brain` workspace the agent created and
 * asked the developer to open — added a folder switch to every session and gained nothing:
 * one process per clone is the rule either way.
 *
 * What it does, in order, and nothing is spent:
 *   1. RUNNER DETECTION (F1): which agent CLIs are on PATH. A requested runner that is not
 *      there refuses the bootstrap with the options — install the CLI, use another runner, or
 *      the VS Code adapter (designed, not yet available) — before the brain exists, because
 *      the second engagement found this out at `drive run`, after bootstrap and transport.
 *   2. git: `git init` + a first commit if this folder is not a repository yet — render refuses
 *      to render into a directory nothing can hand over (PRODUCT-97).
 *   3. `snbrain init` here, sync root = here (or --sync-root), budget as given.
 *   4. the wiki scaffold instantiated (render.js --scaffold): verification dates filled, no
 *      DELETE-ME rows in live pages, the story template parameterised.
 *   5. product.config.json: instances.dev = the instance; drive.config.json: defaultRunner.
 *   6. .brain/bootstrap.json with what was decided, then wait for the port file HERE.
 *
 * Usage: node tools/snbrain/bootstrap.js --instance <name> --process "<few words>"
 *                                        [--runner copilot|codex|claude] [--budget 400]
 *                                        [--sync-root <folder where sn-scriptsync already syncs>]
 *                                        [--wait <seconds, default 600>] [--root <dir>] [--force]
 * Exit: 0 ready · 1 waiting on the port file (the brain exists) · 2 usage · 3 runner not on PATH
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PRODUCT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) { out[a.slice(2)] = true; } else { out[a.slice(2)] = n; i += 1; } } else { out._.push(a); }
  }
  return out;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'process';
const fwd = (p) => String(p).replace(/\\/g, '/');
const node = (args, cwd) => spawnSync(process.execPath, args, { encoding: 'utf8', cwd });
const git = (root, args) => spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', windowsHide: true });

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.instance || a.instance === true || !a.process || a.process === true) {
    process.stderr.write('usage: node tools/snbrain/bootstrap.js --instance <name> --process "<few words>" [--runner copilot|codex|claude] [--budget 400] [--sync-root <dir>] [--wait <s>] [--root <dir>] [--force]\n');
    process.exit(2);
  }
  const root = path.resolve(a.root && a.root !== true ? a.root : PRODUCT);
  const runner = a.runner && a.runner !== true ? String(a.runner) : null;

  // 1. Runners, before anything else exists.
  const drive = require('./drive.js');
  const config = drive.loadConfig(root, null);
  const detected = drive.detectRunners(config);
  process.stdout.write('runners on this machine:\n');
  for (const r of detected) { process.stdout.write(`  ${r.available ? 'ok      ' : 'MISSING '} ${r.name.padEnd(10)} ${r.kind === 'cli' ? `${r.executable}${r.resolvedPath ? ` -> ${fwd(r.resolvedPath)}` : ''}` : r.note}\n`); }
  if (runner) {
    const chosen = detected.find((r) => r.name === runner);
    if (!chosen || !chosen.available) {
      process.stderr.write(`\n${drive.describeUnavailable(runner, detected)}\n`);
      process.exit(3);
    }
  }

  // 2. A repository, so the render stage has somewhere to commit.
  if (fs.existsSync(path.join(root, '.brain', 'state.json')) && !a.force) {
    process.stderr.write(`a brain already lives in ${fwd(root)} (.brain/state.json). One process per clone: extract or clone the product again for another process, or pass --force to start this one over.\n`);
    process.exit(2);
  }
  if (!fs.existsSync(path.join(root, '.git'))) {
    git(root, ['init', '-q']);
    if (!git(root, ['config', 'user.name']).stdout.trim()) { git(root, ['config', 'user.name', 'snbrain bootstrap']); git(root, ['config', 'user.email', 'bootstrap@snbrain.invalid']); }
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', `bootstrap: ${a.instance} / ${a.process}`]);
    process.stdout.write(`git: initialised ${fwd(root)} and committed the product tree\n`);
  }

  // 3. The brain, here.
  const syncRoot = a['sync-root'] && a['sync-root'] !== true ? path.resolve(a['sync-root']) : root;
  const budget = a.budget && a.budget !== true ? String(a.budget) : '400';
  const init = node([path.join(root, 'tools', 'snbrain', 'snbrain.js'), 'init', '--instance', a.instance, '--root', root, '--sync-root', syncRoot, '--budget', budget].concat(a.force ? ['--force'] : []));
  process.stdout.write(init.stdout);
  if (init.status !== 0) { process.stderr.write(init.stderr); process.exit(2); }

  // 4. The wiki scaffold, instantiated.
  const scaffold = node([path.join(root, 'tools', 'snbrain', 'render.js'), '--root', root, '--scaffold']);
  process.stdout.write(scaffold.stdout);

  // 5. Config: what is known now.
  const cfgPath = path.join(root, 'product.config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''));
    cfg.instances = Object.assign({}, cfg.instances, { dev: a.instance });
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  } catch (e) { /* the render worker fills the rest */ }
  if (runner) {
    const dcPath = path.join(root, 'drive.config.json');
    try { const cfg = JSON.parse(fs.readFileSync(dcPath, 'utf8')); cfg.defaultRunner = runner; fs.writeFileSync(dcPath, `${JSON.stringify(cfg, null, 2)}\n`); } catch (e) { /* keep shipped config */ }
  }
  fs.writeFileSync(path.join(root, '.brain', 'bootstrap.json'), JSON.stringify({
    instance: a.instance, process: a.process, processSlug: slug(a.process), runner, syncRoot: fwd(syncRoot), root: fwd(root),
    createdAt: new Date().toISOString(), runners: detected, inPlace: true,
  }, null, 2));

  // 6. The transport, in THIS folder.
  const port = path.join(syncRoot, '.vscode', 'sn-agent-port.json');
  const waitS = Number(a.wait && a.wait !== true ? a.wait : 600);
  if (!fs.existsSync(port)) {
    process.stdout.write(`\nCONNECT sn-scriptsync TO "${a.instance}" IN THE VS CODE WINDOW FOR THIS FOLDER:\n  ${fwd(syncRoot)}\nWaiting up to ${waitS}s for ${fwd(port)} ...\n`);
    const until = Date.now() + waitS * 1000;
    while (!fs.existsSync(port) && Date.now() < until) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); }
  }
  if (!fs.existsSync(port)) {
    process.stdout.write(`\nNo port file yet. Either connect sn-scriptsync in this folder's VS Code window, or re-run with --sync-root <the folder where sn-scriptsync already syncs "${a.instance}">. The brain is initialised; nothing was lost.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nTransport ready. Next, in this folder:\n  node tools/snbrain/drive.js dry-run\n  node tools/snbrain/drive.js run --runner ${runner || '<copilot|codex|claude>'}\nAt the end: node tools/snbrain/snbrain.js finalize --by <your name>\n`);
}

if (require.main === module) { main(); }
module.exports = { slug };
