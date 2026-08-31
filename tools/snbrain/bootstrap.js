#!/usr/bin/env node
'use strict';
/*
 * tools/snbrain/bootstrap.js — create the engagement workspace and initialise the brain.
 *
 * A downloading team extracts the product somewhere; the BRAIN must not be built inside
 * the product tree (a second process would collide with the first). This creates a sibling
 * workspace named from the instance and the process, copies the product tree into it,
 * initialises the brain there, and waits for sn-scriptsync to write its port file into
 * that workspace — which happens when the user opens the folder in VS Code and connects
 * the extension to the instance. If the file does not appear, it says what to do next.
 *
 * Usage: node tools/snbrain/bootstrap.js --instance <name> --process "<few words>"
 *                                        [--runner copilot|codex|claude] [--budget 400]
 *                                        [--sync-root <existing folder with .vscode/sn-agent-port.json>]
 *                                        [--wait <seconds, default 600>] [--parent <dir>]
 * Exit: 0 ready · 1 waiting on the port file (workspace and brain exist) · 2 usage
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PRODUCT = path.resolve(__dirname, '..', '..');
const NEVER = [/^\.git$/, /^\.brain$/, /^dist$/, /^TRANSFER\.md$/, /^docs\/exam-/];

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

function copyTree(src, dst, rel) {
  for (const name of fs.readdirSync(src)) {
    const r = rel ? `${rel}/${name}` : name;
    if (NEVER.some((re) => re.test(r))) { continue; }
    const s = path.join(src, name), d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d, r); } else { fs.copyFileSync(s, d); }
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.instance || a.instance === true || !a.process || a.process === true) {
    process.stderr.write('usage: node tools/snbrain/bootstrap.js --instance <name> --process "<few words>" [--runner copilot|codex|claude] [--budget 400] [--sync-root <dir>] [--wait <s>] [--parent <dir>]\n');
    process.exit(2);
  }
  const parent = path.resolve(a.parent && a.parent !== true ? a.parent : path.join(PRODUCT, '..'));
  const base = `${slug(a.instance)}-${slug(a.process)}-brain`;
  let ws = path.join(parent, base);
  for (let n = 2; fs.existsSync(ws); n += 1) { ws = path.join(parent, `${base}-${n}`); }
  fs.mkdirSync(ws, { recursive: true });
  copyTree(PRODUCT, ws, '');
  process.stdout.write(`workspace ${fwd(ws)}\n`);

  const syncRoot = a['sync-root'] && a['sync-root'] !== true ? path.resolve(a['sync-root']) : ws;
  const budget = a.budget && a.budget !== true ? String(a.budget) : '400';
  const init = spawnSync(process.execPath, [path.join(ws, 'tools', 'snbrain', 'snbrain.js'), 'init', '--instance', a.instance, '--root', ws, '--sync-root', syncRoot, '--budget', budget], { encoding: 'utf8' });
  process.stdout.write(init.stdout);
  if (init.status !== 0) { process.stderr.write(init.stderr); process.exit(2); }
  if (a.runner && a.runner !== true) {
    const cfgPath = path.join(ws, 'drive.config.json');
    try { const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); cfg.defaultRunner = String(a.runner); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n'); } catch (e) { /* keep shipped config */ }
  }
  fs.writeFileSync(path.join(ws, '.brain', 'bootstrap.json'), JSON.stringify({ instance: a.instance, process: a.process, runner: a.runner || null, syncRoot: fwd(syncRoot), createdAt: new Date().toISOString() }, null, 2));

  const port = path.join(syncRoot, '.vscode', 'sn-agent-port.json');
  const waitS = Number(a.wait && a.wait !== true ? a.wait : 600);
  if (!fs.existsSync(port)) {
    process.stdout.write(`\nOPEN THE WORKSPACE IN VS CODE AND CONNECT sn-scriptsync TO "${a.instance}":\n  code "${fwd(ws)}"\nWaiting up to ${waitS}s for ${fwd(port)} ...\n`);
    try { spawnSync('code', [ws], { shell: true, stdio: 'ignore' }); } catch (e) { /* the user can open it by hand */ }
    const until = Date.now() + waitS * 1000;
    while (!fs.existsSync(port) && Date.now() < until) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); }
  }
  if (!fs.existsSync(port)) {
    process.stdout.write(`\nNo port file yet. Either connect sn-scriptsync in the VS Code window for ${fwd(ws)}, or re-run with --sync-root <the folder where sn-scriptsync already syncs "${a.instance}">. The workspace and the brain are ready; nothing was lost.\n`);
    process.exit(1);
  }
  process.stdout.write(`\nTransport ready. Next:\n  cd "${fwd(ws)}"\n  node tools/snbrain/drive.js dry-run\n  node tools/snbrain/drive.js run --runner ${a.runner && a.runner !== true ? a.runner : '<copilot|codex|claude>'}\n`);
}

if (require.main === module) { main(); }
module.exports = { slug };
