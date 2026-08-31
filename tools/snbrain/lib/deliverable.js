'use strict';
/**
 * deliverable.js — is the thing the run produced actually IN the repo?
 *
 * WHY THIS FILE EXISTS. `PRODUCT-97`. Both engagement repos carry a `.gitignore` written by this
 * framework's own installer, containing this sentence about the brain:
 *
 *     # state.json and the three ledgers are the run's audit trail and the evidence base
 *     # of the deliverable. They are committed.
 *
 * They were not committed. `pilot-run-4` has one commit, dated two days before the run, holding the
 * installer's scaffold; `pilot-run-3` has no `HEAD` at all. Everything run 4 produced — 34 rendered
 * pages, the re-rendered kernel, `state.json`, all three ledgers — was uncommitted working-tree
 * state, one `git clean -fd` from being the scaffold again. A prose assertion that nothing checks
 * is a test with no runner, which is the `detect-only` failure the register named at `PLATFORM-5`.
 *
 * TRACKED IS NOT ENOUGH, AND THAT IS MEASURED. The first shape of this check asked only whether
 * each declared path appears in `git ls-files`. On `pilot-run-4` that passes 13 of 39 paths — and
 * all 13 pass because the installer's PRE-RUN commit happened to create a file at the same path.
 * Their tracked content is the scaffold; their working-tree content is the run's. A presence check
 * over a stale index reports the deliverable as delivered while the deliverable is the thing that
 * would be lost. So the assertion is tracked AND clean, and both halves are reported separately,
 * because they fail for different reasons and are fixed by different actions.
 *
 * WHAT IS IN THE DELIVERABLE — decided, not inherited. `.brain/raw/` is NOT. It holds whole-instance
 * streamed payloads, it is `.gitignore`d by policy, and an independent scoring pass rested 16 of run
 * 4's 107 ledger-only complete verdicts on it, which means those verdicts were scored against
 * evidence that will never reach a reader by any route. Anything in `raw/` that matters is promoted
 * into the evidence appendix (render.js `--appendix`), which is generated FROM `claims.jsonl` — a
 * tracked file. See `docs/build-log/ISSUES.md#PRODUCT-97`.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

/** The ledgers and the run state. Committed on purpose; they are the evidence base. */
const BRAIN_DELIVERABLE = Object.freeze([
  '.brain/state.json',
  '.brain/claims.jsonl',
  '.brain/decisions.jsonl',
  '.brain/findings.jsonl',
]);

/** Excluded on purpose, and the exclusion is a decision with a stated reason. */
const NOT_DELIVERABLE = Object.freeze([
  { path: '.brain/raw/', why: 'bulk streamed instance payloads; never meant to enter a diff, and never scored against — see PRODUCT-97' },
]);

function fwd(p) { return String(p).replace(/\\/g, '/').replace(/^\.\//, ''); }

/**
 * Every path the deliverable consists of, from `render.json` plus the fixed brain set.
 * Deduplicated and forward-slashed, because that is how git spells a path on every platform.
 */
function deliverablePaths(renderArtifact) {
  const a = renderArtifact || {};
  const out = [];
  for (const p of (a.pages || [])) { if (p && p.path) { out.push(fwd(p.path)); } }
  if (a.kernel && a.kernel.path) { out.push(fwd(a.kernel.path)); }
  if (a.settings && a.settings.path) { out.push(fwd(a.settings.path)); }
  for (const s of (a.skills || [])) { if (s && s.path) { out.push(fwd(s.path)); } }
  for (const b of BRAIN_DELIVERABLE) { out.push(b); }
  return [...new Set(out)];
}

/**
 * The subset a render artifact DECLARED, which is the population whose absence from disk is a
 * defect. A ledger file that was never written is not a missing deliverable — it is a run that
 * recorded no decisions — while a page `render.json` says it wrote and that is not there is the
 * artifact lying about its own output, and `render.validate` already refuses that.
 */
function declaredPaths(renderArtifact) {
  const brain = new Set(BRAIN_DELIVERABLE);
  return deliverablePaths(renderArtifact).filter((p) => !brain.has(p));
}

function git(root, args, opts) {
  const r = childProcess.spawnSync('git', ['-C', root].concat(args), Object.assign({
    encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true,
  }, opts || {}));
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String((r.error && r.error.message) || r.stderr || ''),
  };
}

/**
 * What git knows about this repo. `hasHead` is separate from `isRepo` on purpose: `pilot-run-3` is a
 * git repo with no commits, where every check below is vacuously satisfiable and the honest answer
 * is "there is nothing here to hand over".
 */
function gitState(root) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { isRepo: false, hasHead: false, tracked: new Set(), changed: new Set(), error: 'not a git repository' };
  }
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  const ls = git(root, ['ls-files', '-z']);
  const st = git(root, ['status', '--porcelain', '-z']);
  const tracked = new Set(ls.stdout.split('\0').filter(Boolean).map(fwd));
  /*
   * `--porcelain -z` emits `XY <path>\0` per entry, and for renames a second NUL-separated
   * original path follows. Both spellings are recorded as changed: a deliverable path that moved
   * is a deliverable path whose committed content is not the one on disk.
   */
  const changed = new Set();
  const parts = st.stdout.split('\0').filter((s) => s.length);
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) { continue; }
    const code = entry.slice(0, 2);
    changed.add(fwd(entry.slice(3)));
    if (code[0] === 'R' || code[0] === 'C') { i += 1; if (parts[i]) { changed.add(fwd(parts[i])); } }
  }
  return { isRepo: true, hasHead: head.ok, tracked, changed, error: head.ok ? null : 'repository has no HEAD — nothing has ever been committed' };
}

/**
 * THE ACCEPTANCE. Every declared path must be tracked in the index AND identical to what is
 * committed. Three populations come back separately because they are three different failures:
 * missing on disk (the render lied), untracked (never added), tracked-but-dirty (the committed
 * bytes are not the run's bytes — the failure a presence check cannot see).
 */
function deliverableGitStatus(root, paths, opts) {
  const g = gitState(root);
  const want = (paths || []).map(fwd);
  // Absence is a defect only for a path something DECLARED it wrote. Default: every path given.
  const required = new Set(((opts && opts.required) || want).map(fwd));
  const missing = [], untracked = [], dirty = [];
  for (const p of want) {
    if (!fs.existsSync(path.resolve(root, p))) { if (required.has(p)) { missing.push(p); } continue; }
    if (!g.tracked.has(p)) { untracked.push(p); continue; }
    if (g.changed.has(p)) { dirty.push(p); }
  }
  return {
    population: 'every path render.json declares it wrote, plus the kernel, settings, the build skills, state.json and the three ledgers',
    isRepo: g.isRepo, hasHead: g.hasHead, gitError: g.error,
    total: want.length, missing, untracked, dirty,
    ok: g.isRepo && g.hasHead && !missing.length && !untracked.length && !dirty.length,
  };
}

/** One line per failure class, in the order a human would fix them. */
function describeDeliverableStatus(s) {
  const L = [];
  if (!s.isRepo) { L.push('the engagement repo is not a git repository, so the deliverable cannot be handed over at all. `git init`, then commit.'); return L; }
  if (!s.hasHead) { L.push('the engagement repo has no HEAD — nothing has ever been committed. A `git clone` of it yields nothing.'); }
  if (s.missing.length) { L.push(`${s.missing.length} declared path(s) do not exist on disk: ${s.missing.slice(0, 6).join(', ')}.`); }
  if (s.untracked.length) { L.push(`${s.untracked.length} of ${s.total} deliverable path(s) are untracked: ${s.untracked.slice(0, 6).join(', ')}${s.untracked.length > 6 ? ', …' : ''}. A clone of this repo does not contain them.`); }
  if (s.dirty.length) {
    L.push(`${s.dirty.length} of ${s.total} deliverable path(s) are tracked but MODIFIED against HEAD: ${s.dirty.slice(0, 6).join(', ')}${s.dirty.length > 6 ? ', …' : ''}. ` +
      'Tracked is not delivered: on run 93838afe87 all 13 "tracked" paths held the installer scaffold from two days before the run, so a presence check passed while the deliverable existed only in the working tree.');
  }
  return L;
}

/**
 * `render.apply` finishes with a commit, or fails naming what is still not in it.
 *
 * Deliberately narrow: it stages the DECLARED paths and nothing else, so a run cannot sweep an
 * operator's unrelated working-tree changes into the deliverable commit. `add --` on an ignored
 * path is a git error rather than a silent skip, so `.brain/raw/` cannot arrive by accident.
 */
function commitDeliverable(root, opts) {
  const o = opts || {};
  const paths = (o.paths || []).map(fwd);
  const statusOpts = { required: o.required };
  const status = () => deliverableGitStatus(root, paths, statusOpts);
  const g = gitState(root);
  if (!g.isRepo) { return { committed: false, reason: 'not a git repository', status: status() }; }

  const present = paths.filter((p) => fs.existsSync(path.resolve(root, p)));
  if (present.length) {
    /*
     * `--` and an explicit list, never `-A`: an operator's unrelated working-tree changes must not
     * ride into the deliverable commit. `git add` on an ignored path is an ERROR rather than a
     * silent skip, which is why `.brain/raw/` cannot arrive here by accident — and why a
     * deliberately ignored deliverable path surfaces as a failure instead of a quiet omission.
     */
    const add = git(root, ['add', '--'].concat(present));
    if (!add.ok) { return { committed: false, reason: `git add failed: ${add.stderr.trim()}`, status: status() }; }
  }
  const staged = git(root, ['diff', '--cached', '--name-only']);
  if (staged.ok && !staged.stdout.trim()) {
    // Nothing to commit is a legitimate outcome — a re-ingest of an unchanged render — but it is
    // only legitimate if the acceptance passes, which is what the caller reports on.
    return { committed: false, reason: 'nothing staged: the declared paths are already committed as they stand', status: status() };
  }
  const args = ['commit', '-m', o.message || 'chore(snbrain): render — the deliverable, committed'];
  if (o.author) { args.push('--author', o.author); }
  const c = git(root, args);
  if (!c.ok) { return { committed: false, reason: `git commit failed: ${c.stderr.trim() || c.stdout.trim()}`, status: status() }; }
  const sha = git(root, ['rev-parse', '--short', 'HEAD']);
  return { committed: true, sha: sha.ok ? sha.stdout.trim() : null, status: status() };
}

module.exports = {
  BRAIN_DELIVERABLE, NOT_DELIVERABLE,
  deliverablePaths, declaredPaths, gitState, deliverableGitStatus, describeDeliverableStatus, commitDeliverable,
};
