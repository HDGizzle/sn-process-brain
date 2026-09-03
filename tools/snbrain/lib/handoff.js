'use strict';
/*
 * handoff.js — what has to be true of a brain before it leaves the machine that built it.
 *
 * Three checks and one record, shared by `render.validate`, `snbrain export`, `snbrain
 * finalize` and `snbrain verify-export`, so the deliverable is held to ONE definition of
 * "finished" wherever it is inspected:
 *
 *   1. NO PLACEHOLDER IN A LIVE PAGE. The second engagement's run (2026-08-31) reached
 *      terminal success with `<fill at engagement>`, `DELETE-ME` rows, `STRY0000001` and
 *      `<open / interview scheduled <date> / ...>` in CONTRACT.md, glossary.md, hard-rules.md,
 *      agent-api.md, deployment-matrix.md, INTERVIEW.md and tbd.md; the first run shipped
 *      CONTRACT.md's `<fill at engagement>` too. `render --check` audited claim accounting,
 *      page caps and retirement markers and never asked whether a page still looked like the
 *      onboarding scaffold. Placeholders are legal ONLY in files whose name says they are
 *      templates (`_TEMPLATE.md`); everywhere else they are a refusal, and the file and line
 *      are named.
 *
 *   2. EVERY KERNEL ROUTE RESOLVES. Parsed by tools/render-kernel.js (the one parser), checked
 *      here against the tree that is about to ship — after export and after finalize, not only
 *      at render, because a route that resolved in the operating repo can dangle in the slim
 *      one (the machine's files are withheld).
 *
 *   3. THE MANIFEST DESCRIBES THE TREE. Per-file sha256 + byte size for every exported path,
 *      the generator's identity and the three kernel mirrors, so `verify-export` can prove
 *      nothing was added, removed or edited after generation. Both runs' manifests carried a
 *      bare file COUNT, which cannot tell a regenerated kernel from an untouched one.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fwd(p) { return String(p).replace(/\\/g, '/'); }

/** Files whose placeholders are the point. Everything else is a live page. */
const TEMPLATE_FILE_RE = /(^|\/)_TEMPLATE\.md$/i;

/**
 * Placeholder shapes, each with the run that shipped it. Case matters where the scaffold's
 * own wording does; `<...>` angle tokens are matched narrowly so a legitimate `<br>` or a
 * generic-type mention in prose does not fire.
 */
const PLACEHOLDER_PATTERNS = Object.freeze([
  { re: /<fill at engagement>|fill at engagement/i, what: 'scaffold fill marker' },
  { re: /set at engagement/i, what: 'scaffold fill marker' },
  { re: /\bDELETE-ME\b/, what: 'scaffold example row' },
  { re: /\bSTRY000000\d\b/, what: 'dummy story id' },
  { re: /<open \/ /i, what: 'unselected status alternatives' },
  // Narrow on purpose: `<slug>`, `<story-id>` and `<update_set_sys_id>` are legitimate in
  // governance prose and API examples (CONTRACT.md's tier table, agent-api.md's JSON).
  { re: /<owner>|<Project>|\{\{storySetFormat\}\}/, what: 'unfilled angle-bracket slot' },
  { re: /\*\(pending\)\*/, what: 'pending answer marker' },
  { re: /<!--\s*SLOT:/, what: 'unresolved kernel slot comment' },
  { re: /^\s*\|(\s*\|){2,}\s*$/m, what: 'blank table row' },
  { re: /\b(REQUIRED|OPTIONAL) — /, what: 'config slot instruction copy' },
]);

/** Every .md and .json under a directory, repo-relative, forward-slashed. */
function listFiles(root, relDir, exts) {
  const want = exts || ['.md', '.json'];
  const out = [];
  const abs = path.resolve(root, relDir);
  if (!fs.existsSync(abs)) { return out; }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '.git') { walk(p); } continue; }
      if (want.includes(path.extname(e.name).toLowerCase())) { out.push(fwd(path.relative(root, p))); }
    }
  };
  walk(abs);
  return out.sort();
}

/**
 * Scan live files for placeholder shapes. Returns one row per (file, line, pattern), the
 * template files skipped and counted separately so the report can say "N templates exempt".
 */
function scanPlaceholders(root, relFiles) {
  const hits = [];
  let templates = 0;
  for (const rel of relFiles) {
    if (TEMPLATE_FILE_RE.test(rel)) { templates += 1; continue; }
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) { continue; }
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    for (const p of PLACEHOLDER_PATTERNS) {
      if (p.re.flags.includes('m')) {
        // A multi-line pattern (the blank table row) is matched per line without the anchor issue.
        lines.forEach((l, i) => { if (/^\s*\|(\s*\|){2,}\s*$/.test(l)) { hits.push({ path: rel, line: i + 1, what: p.what, text: l.trim().slice(0, 80) }); } });
        continue;
      }
      lines.forEach((l, i) => {
        const m = p.re.exec(l);
        if (m) { hits.push({ path: rel, line: i + 1, what: p.what, text: m[0].slice(0, 80) }); }
      });
    }
  }
  return { hits, templatesExempt: templates, scanned: relFiles.length - templates };
}

/** One aggregate sentence for a rejection or a refusal; empty string when clean. */
function describePlaceholders(scan) {
  if (!scan.hits.length) { return ''; }
  const byFile = new Map();
  for (const h of scan.hits) { byFile.set(h.path, (byFile.get(h.path) || 0) + 1); }
  const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  return `${scan.hits.length} placeholder(s) survive in ${byFile.size} live page(s) ` +
    `(population: every .md/.json under the wiki root plus the kernel mirrors, ${scan.templatesExempt} _TEMPLATE.md file(s) exempt): ` +
    `${files.slice(0, 6).map(([f, n]) => `${f} (${n}: ${scan.hits.find((h) => h.path === f).what} at line ${scan.hits.find((h) => h.path === f).line})`).join('; ')}` +
    `${files.length > 6 ? `; and ${files.length - 6} more file(s)` : ''}. ` +
    'A terminal-success deliverable may not carry onboarding scaffolding in a page an agent is routed to: fill the value from ' +
    'run metadata, remove the example row, or move the text into a _TEMPLATE.md file where placeholders are the point.';
}

/** The kernel's routes, checked against a tree. Uses render-kernel.js as the single parser. */
function kernelRouteProblems(root, kernelRel, configOverride) {
  const rk = require(path.join(__dirname, '..', '..', 'render-kernel.js'));
  const abs = path.resolve(root, kernelRel || 'CLAUDE.md');
  if (!fs.existsSync(abs)) { return [`${kernelRel || 'CLAUDE.md'} does not exist, so its routing map cannot be checked`]; }
  let config = configOverride || {};
  if (!configOverride) {
    try { config = JSON.parse(fs.readFileSync(path.join(root, 'product.config.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { config = {}; }
  }
  const text = fs.readFileSync(abs, 'utf8');
  return rk.missingRoutes(text, config, root).map((r) => `${kernelRel || 'CLAUDE.md'} routes to \`${r.token}\` and nothing exists at ${r.resolve || '(unresolvable)'}`);
}

function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

/** The manifest's file table for a set of relative paths under a root. */
function fileTable(root, relFiles) {
  return relFiles.map(fwd).sort().map((rel) => {
    const abs = path.resolve(root, rel);
    const st = fs.statSync(abs);
    return { path: rel, sha256: sha256File(abs), bytes: st.size };
  });
}

/**
 * Everything under a directory except .git, the manifest itself, and anything the caller
 * declares ignored.
 *
 * `ignored` is not cosmetic. `finalize` KEEPS extension-owned paths on disk (.vscode, the
 * sn-scriptsync instance folders, agentrules/, spikes/) and deliberately leaves them out of
 * the manifest, because they are not the deliverable and they change under the operator's
 * feet. Measured on the first finalize against a real engagement folder: the manifest listed
 * 169 files, the verifier walked the whole tree, and `finalize --check` reported the
 * deliverable DRIFTED the moment it was created — an integrity check that cries wolf on its
 * own output teaches the operator to ignore it. The verifier reads the ignore list the
 * manifest carries.
 */
function treeFiles(root, ignored) {
  const skip = new Set((ignored || []).map(fwd));
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') { continue; }
      const p = path.join(dir, e.name);
      const rel = fwd(path.relative(root, p));
      if (skip.has(rel)) { continue; }
      if (e.isDirectory()) { walk(p); continue; }
      if (rel === MANIFEST_NAME) { continue; }
      out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

const MANIFEST_NAME = 'EXPORT-MANIFEST.json';

/**
 * Compare a directory against the manifest it carries. Any add, delete or modify fails.
 * `expectedKernels` are also asserted present, because a manifest that lists two mirrors is
 * how the third one went missing on the second engagement.
 */
function verifyManifest(dir) {
  const mp = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(mp)) { return { ok: false, error: `${MANIFEST_NAME} not found in ${fwd(dir)}`, added: [], deleted: [], modified: [] }; }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { return { ok: false, error: `${MANIFEST_NAME} is not valid JSON: ${e.message}`, added: [], deleted: [], modified: [] }; }
  const listed = Array.isArray(manifest.files) ? manifest.files : null;
  if (!listed) { return { ok: false, error: `${MANIFEST_NAME} carries no per-file list (files: ${JSON.stringify(manifest.files)}) — an older manifest; regenerate with export or finalize`, added: [], deleted: [], modified: [], manifest }; }
  const byPath = new Map(listed.map((f) => [fwd(f.path), f]));
  const present = treeFiles(dir, manifest.ignored);
  const presentSet = new Set(present);
  const added = present.filter((p) => !byPath.has(p));
  const deleted = [...byPath.keys()].filter((p) => !presentSet.has(p));
  const modified = [];
  for (const p of present) {
    const f = byPath.get(p);
    if (!f) { continue; }
    if (sha256File(path.join(dir, p)) !== f.sha256) { modified.push(p); }
  }
  const kernelsMissing = (manifest.kernels || []).filter((k) => !presentSet.has(fwd(k)));
  return {
    ok: !added.length && !deleted.length && !modified.length && !kernelsMissing.length,
    added, deleted, modified, kernelsMissing, manifest,
    fileCount: listed.length,
  };
}

/*
 * THE SKILLS AUDIT (D1, 2026-09-02). The deliverable ships the whole build-skill library, and a
 * skill that cannot be triggered is dead weight that reads as coverage. Two properties, both
 * mechanical: ROUTABLE — the frontmatter description carries at least one quoted trigger
 * phrase (exactly what .claude/hooks/skill-trigger.js harvests at prompt time), and
 * REACHABLE — the kernel's routing map names the skill in a table row, or carries the
 * `.claude/skills/` directory route ("their descriptions route themselves"). A skill failing
 * either is a BLOCKING finding: it runs at render, at finalize, and on demand
 * (`snbrain skills-audit`), so a skill added later is verified to route.
 */
const MACHINE_SKILL_RE = /^(snbrain-[a-z-]+|map-process|bootstrap-project-brain)$/i;

function skillFrontmatter(md) {
  const text = String(md).replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) { return null; }
  const name = /^name:\s*(.+)$/m.exec(fm[1]);
  const desc = /^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n*$)/m.exec(fm[1]);
  const phrases = [];
  if (desc) { const re = /"([^"]{2,60})"/g; let m; while ((m = re.exec(desc[1])) !== null) { phrases.push(m[1]); } }
  return { name: name ? name[1].trim() : null, description: desc ? desc[1].trim() : '', phrases };
}

function auditSkills(root, opts) {
  const o = opts || {};
  const skillsDir = path.resolve(root, '.claude', 'skills');
  /*
   * The rendered kernel is the routing map an agent reads. In the PRODUCT tree it does not
   * exist yet — the engagement renders it — so the template is the kernel-to-be and carries
   * the same routes. Falling back to it means `skills-audit` answers the question the operator
   * is actually asking ("can every shipped skill be triggered?") in both trees.
   */
  const candidates = [o.kernel || 'CLAUDE.md', 'kernel/CLAUDE.template.md'];
  const kernelRel = candidates.find((rel) => fs.existsSync(path.resolve(root, rel)));
  const kernelAbs = kernelRel ? path.resolve(root, kernelRel) : null;
  const kernel = kernelAbs ? fs.readFileSync(kernelAbs, 'utf8') : '';
  const dirRoute = /`\.claude\/skills\/?`/.test(kernel);
  const namedInTable = new Set();
  for (const line of kernel.split(/\n/)) {
    if (!/^\s*\|/.test(line)) { continue; }
    for (const m of line.match(/`[a-z][a-z0-9]*(?:-[a-z0-9]+)+`/g) || []) { namedInTable.add(m.replace(/`/g, '')); }
  }
  const skills = [];
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir).sort()) {
      const dir = path.join(skillsDir, name);
      if (!fs.statSync(dir).isDirectory()) { continue; }
      const md = ['SKILL.md', 'skill.md'].map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
      const problems = [];
      const machine = MACHINE_SKILL_RE.test(name);
      let fm = null;
      if (!md) { problems.push('no SKILL.md'); } else {
        fm = skillFrontmatter(fs.readFileSync(md, 'utf8'));
        if (!fm) { problems.push('no frontmatter block'); } else {
          if (fm.name && fm.name !== name) { problems.push(`frontmatter name "${fm.name}" is not the directory name`); }
          if (!fm.description) { problems.push('no description'); }
          else if (!machine && !fm.phrases.some((p) => p.length >= 4)) { problems.push('description carries no quoted trigger phrase of 4+ characters — skill-trigger.js cannot route it'); }
        }
      }
      const reachable = machine || namedInTable.has(name) || dirRoute;
      if (!reachable && !machine) { problems.push(kernel ? 'not reachable from the kernel: not named in a routing-map row and the kernel carries no `.claude/skills/` route' : 'no kernel to be reachable from'); }
      skills.push({ name, path: md ? fwd(path.relative(root, md)) : null, machine, phrases: fm ? fm.phrases.length : 0, reachable, problems });
    }
  }
  const failing = skills.filter((s) => s.problems.length && !s.machine);
  return {
    skills, failing, kernelPresent: !!kernel, kernelPath: kernelRel || null, dirRoute, namedInTable: [...namedInTable],
    ok: !failing.length && skills.some((s) => !s.machine),
    buildSkills: skills.filter((s) => !s.machine).length,
    machineSkills: skills.filter((s) => s.machine).length,
  };
}

function describeSkillsAudit(a) {
  if (!a.skills.length) { return 'no .claude/skills directory: the deliverable carries no build procedure at all'; }
  if (!a.skills.some((s) => !s.machine)) { return `${a.skills.length} skill(s) present and every one is the loop's own machine (snbrain-*, map-process): no build skill ships, so an agent opening this repo has no procedure to follow`; }
  if (!a.failing.length) { return ''; }
  return `${a.failing.length} of ${a.buildSkills} build skill(s) cannot be triggered: ` +
    a.failing.slice(0, 6).map((s) => `${s.name} (${s.problems.join('; ')})`).join(' · ') + (a.failing.length > 6 ? ` · and ${a.failing.length - 6} more` : '') +
    '. A skill nobody can trigger is a page that reads as coverage; give its description quoted trigger phrases and name it in the kernel, or remove it.';
}

module.exports = {
  TEMPLATE_FILE_RE, PLACEHOLDER_PATTERNS, MANIFEST_NAME, MACHINE_SKILL_RE,
  listFiles, scanPlaceholders, describePlaceholders, kernelRouteProblems,
  sha256File, fileTable, treeFiles, verifyManifest, fwd,
  skillFrontmatter, auditSkills, describeSkillsAudit,
};
