#!/usr/bin/env node
/*
 * SessionStart hook — kernel-integrity
 *
 * Detects the specific regressions that silently re-fatten the always-on layer, on
 * EVERY machine, the day they happen:
 *   1. sn-scriptsync managed-block re-injection into CLAUDE.md (SN-SCRIPTSYNC markers)
 *      — happens when a machine lacks sn-scriptsync.agentInstructions.autoUpdate=false.
 *   2. Any @-import line in CLAUDE.md (imports load at launch: concatenation, not
 *      decomposition — the classic fat-kernel failure mode).
 *   3. Copilot-mirror drift (both rendered kernels must stay byte-identical; they are
 *      generated from kernel/CLAUDE.template.md by tools/render-kernel.js — hand edits
 *      of either rendered file are the only way they can diverge).
 * Plus a token-budget estimate over the full always-on inventory (kernel + rules +
 * skill frontmatter descriptions). Budgets come from product.config.json `budgets`
 * (fallback defaults below). Warns only on violation — silent when healthy.
 */
'use strict';

var fs = require('fs');
var path = require('path');

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''); } catch (readError) { return ''; }
}

var root = process.cwd();
var budgets = { kernelTokens: 6000, alwaysOnTokens: 14000 };
try {
  var config = JSON.parse(safeRead(path.join(root, 'product.config.json')));
  if (config.budgets) {
    budgets.kernelTokens = config.budgets.kernelTokens || budgets.kernelTokens;
    budgets.alwaysOnTokens = config.budgets.alwaysOnTokens || budgets.alwaysOnTokens;
  }
} catch (noConfig) { /* defaults stand */ }

function estimateTokens(text) { return Math.round(text.length / 4); }

var problems = [];

// --- CLAUDE.md checks -------------------------------------------------------
var claudeMd = safeRead(path.join(root, 'CLAUDE.md'));
if (claudeMd) {
  if (/SN-SCRIPTSYNC:(BEGIN|END)/.test(claudeMd)) {
    problems.push(
      'CLAUDE.md contains an SN-SCRIPTSYNC managed block — the extension re-injected the vendor manual. ' +
      'Fix: set "sn-scriptsync.agentInstructions.autoUpdate": false in .vscode/settings.json on THIS machine, ' +
      'then re-run: node tools/render-kernel.js');
  }
  var importLines = claudeMd.split('\n').filter(function (line) {
    return /(^|\s)@[\w./\\-]+\.(md|json)\b/.test(line) && !/^\s*(#|\/\/|<!--)/.test(line);
  });
  if (importLines.length) {
    problems.push(
      'CLAUDE.md has ' + importLines.length + ' @-import line(s) — imports load at LAUNCH (concatenation, not ' +
      'decomposition). Replace with routing-map pointers: ' + importLines.slice(0, 3).join(' | ').slice(0, 200));
  }
}

// --- Budget estimate --------------------------------------------------------
var kernelTokens = estimateTokens(claudeMd);
var rulesDir = path.join(root, '.claude', 'rules');
try {
  fs.readdirSync(rulesDir).forEach(function (ruleFile) {
    if (/\.md$/.test(ruleFile)) { kernelTokens += estimateTokens(safeRead(path.join(rulesDir, ruleFile))); }
  });
} catch (noRulesDir) { /* fine */ }

var skillDescTokens = 0;
var skillsDir = path.join(root, '.claude', 'skills');
try {
  fs.readdirSync(skillsDir).forEach(function (skillName) {
    var skillMd = safeRead(path.join(skillsDir, skillName, 'SKILL.md')) ||
                  safeRead(path.join(skillsDir, skillName, 'skill.md'));
    var descMatch = skillMd.match(/^description:\s*([\s\S]*?)(\n[a-zA-Z_-]+:|\n---)/m);
    if (descMatch) { skillDescTokens += estimateTokens(descMatch[1]); }
  });
} catch (noSkillsDir) { /* fine */ }

// --- Copilot mirror sync (rendered kernels must be byte-identical) ----------
var copilotMirror = safeRead(path.join(root, '.github', 'copilot-instructions.md'));
if (copilotMirror && claudeMd && copilotMirror.replace(/\r\n/g, '\n') !== claudeMd.replace(/\r\n/g, '\n')) {
  problems.push('.github/copilot-instructions.md is OUT OF SYNC with CLAUDE.md — someone hand-edited a rendered kernel. ' +
    'Re-run: node tools/render-kernel.js (and make the edit in kernel/CLAUDE.template.md instead).');
}

if (kernelTokens > budgets.kernelTokens) {
  problems.push('Kernel over budget: CLAUDE.md + rules ~' + kernelTokens + ' tokens (budget ' +
    budgets.kernelTokens + '). Run the per-line pruning test; move content to wiki/skills.');
}
if (kernelTokens + skillDescTokens > budgets.alwaysOnTokens) {
  problems.push('Always-on total over budget: kernel ~' + kernelTokens + ' + skill descriptions ~' +
    skillDescTokens + ' > ' + budgets.alwaysOnTokens + '. Trim skill descriptions (<=500 chars each) or archive skills.');
}

if (problems.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'KERNEL-INTEGRITY: ' + problems.length + ' problem(s):\n- ' + problems.join('\n- ')
    }
  }));
}
process.exit(0);
