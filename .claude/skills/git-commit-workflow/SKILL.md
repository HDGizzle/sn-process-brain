---
name: git-commit-workflow
description: This skill should be used when the user asks to "commit", "push", "pull", "git sync", "merge", "should I branch or commit to the default branch", "stage changes", "git status", "reconcile with remote", "create a branch", "open a PR", or any git operation in an sn-scriptsync workspace repo. Do NOT route on the bare word "sync" — "sn-scriptsync" is an extension name, not a git operation. It recommends default-branch-vs-branch, syncs with the remote first, and handles merges/conflicts (incl. the `_map.json` union rule). NOTE: this is git version control only — it is NOT about ServiceNow update sets (see `update-set-workflow` / `update-set-scope-strategy` for those).
---

# Git Commit Workflow (sn-scriptsync workspace)

This repo is a ServiceNow `sn-scriptsync` workspace pushed to a shared remote
(`product.config.json` → `git.remote`). Multiple people plus coding agents
commit to it. **Azure DevOps is the primary host path** (`git.host:
"azure-devops"`); the workflow below is host-neutral except for the sections
under "Azure DevOps specifics" — adapt those when `git.host` is `github` or
`gitlab`.

> **Git ≠ ServiceNow update sets.** A git branch does NOT substitute for the
> right update set, and vice-versa. They are independent axes — get both right.
> Update-set rules live in `update-set-workflow` / `update-set-scope-strategy`.

---

## Step 0 — ALWAYS sync with the remote first

Before committing or branching, see where local stands vs the remote. Never
commit blind on top of a stale default branch.

```bash
git fetch origin
git status -sb
git rev-list --left-right --count HEAD...@{u}   # "behind  ahead"  (0 0 = in sync)
```

- **Behind > 0** → pull/integrate before doing more (see Step 3).
- New remote branches in the fetch output → check whether they overlap your
  uncommitted work *before* you commit. Parallel same-work collisions (two
  people doing the same doc/sync work on separate branches) are a real failure
  mode in shared sn-scriptsync repos — catch them here, not at merge time.

---

## Step 1 — Recommend: default branch or a feature branch?

Lead with a recommendation, don't just survey. If the repo already uses a PR
flow, **default to a branch**.

| Situation | Where | Why |
|---|---|---|
| Feature work, multi-file syncs, anything a teammate might also touch | **Branch + PR** | Surfaces overlap before it becomes a manual 3-way merge |
| Story docs / update-set syncs beyond a trivial edit | **Branch + PR** | Reviewable; reversible |
| Coding-agent-generated work | **Branch** (agent prefix) | Keeps agent work reviewable and attributable |
| One-line typo / solo, uncontested edit | Default branch OK *if the user allows* | Low risk, low overhead |
| User explicitly says "straight to the default branch" | Default branch | Honour the explicit instruction |

When unsure, **ask the user** rather than defaulting to a direct push to the
default branch.

Branch naming: follow the convention already visible in the repo's branch list.
A common pattern is an agent prefix for agent work (e.g. `agent/<topic>`) and
`<user>/<topic>` otherwise; tie the branch to a story when one exists (e.g.
`agent/<story-number>-<topic>`). These are examples — match the repo.

```bash
# Branch path:
git switch -c <branch-name>
git add -A && git commit -m "<type>(<scope>): <summary>"
git push -u origin <branch-name>       # then open a PR on the git host
```

---

## Step 2 — Commit conventions (match existing history)

Conventional Commits, lower-case type + scope — read `git log --oneline -20`
first and match the scopes already in use. Typical shapes:

- `feat(<scope>): …`, `docs(<scope>): …` (examples: `feat(skills): …`, `docs(rules): …`)
- `chore(sync): …` for sn-scriptsync map/artifact syncs
- `chore: …` for repo housekeeping

End every commit message with a co-author trailer naming the current model:

```
Co-Authored-By: <current model name> <noreply@anthropic.com>
```

On Windows PowerShell, pass multi-line messages via a single-quoted here-string
(`@'` … `'@`, closing token at column 0), or use the Bash tool.

### NEVER commit these (verify before `git add -A`)
- `_settings.json` / `settings.json` (ServiceNow credentials)
- `.vscode/sn-agent-port.json` (live agent token)
- `*_composition_temp.json` (sn-scriptsync macroponent scratch — should be
  gitignored; has been swept in by accident before)
- `debug.log`, `audit.log`, PII/demo data snapshots

After a bulk `git add -A`, scan `git diff --cached --stat` for anything large or
transient that shouldn't ship.

---

## Step 3 — Pull / sync / merge

**Working tree dirty + remote ahead?** Commit (or stash) your work *first* so the
merge has a clean 3-way base — don't merge over uncommitted changes (Git refuses,
and untracked files that the merge wants to write get clobbered):

```bash
git add -A && git commit -m "chore(sync): snapshot before merge"
git merge --no-edit origin/<branch>     # or: git pull --no-rebase
```

### `_map.json` conflicts → UNION both sides
`sn-scriptsync` `_map.json` files map `ArtifactName → sys_id`. Parallel work
almost always produces **add/add** conflicts where each side added *different*
keys. The correct resolution is the **union of all keys from both sides**:
- Overlapping keys normally carry the **same** sys_id → keep one.
- If an overlapping key has **different** sys_ids on each side, STOP and ask —
  that's a real divergence, not a routine union.

```jsonc
// <<<<<<< HEAD            {"A":"sys1","B":"sys2"}
// =======                {"A":"sys1","C":"sys3"}
// resolved (union):      {"A":"sys1","B":"sys2","C":"sys3"}
```

After resolving: `git grep -l '<<<<<<<'` must return nothing, then
`git add -A && git commit --no-edit`.

---

## Step 4 — Push (only when the user asks)

```bash
git push origin <branch>
git rev-list --left-right --count @{u}...HEAD   # expect 0 0
```

Pushing to the default branch puts commits straight on the shared line — prefer
a branch + PR for anything reviewable (Step 1).

---

## Azure DevOps specifics

### Reading the Branches view (Behind | Ahead)
- **Ahead = 0** → branch is fully contained in the default branch → safe to delete.
- **Ahead = N** → it has N commits not in the default branch. Before deleting,
  verify they're real: a commit can show as "ahead" yet be **byte-identical** to
  one already merged (same change committed under a different SHA). Confirm with
  a content diff, not the count alone.

```bash
git log --oneline origin/<default>..origin/<branch>       # what's actually ahead
# Content-identical check (Windows: avoid MSYS mangling the ref:path arg):
MSYS_NO_PATHCONV=1 git show origin/<branch>:path/to/file > /tmp/a
git show origin/<default>:path/to/file > /tmp/b
diff -q /tmp/a /tmp/b
```

### Deleting remote branches — permission reality
Deleting a remote branch from the CLI needs the Git **`ForcePush`** permission,
which not every account has; without it `git push origin --delete` is rejected
with `TF401027`. When that happens, delete it in the **Azure DevOps web UI**:
Repos → Branches → row's **⋯** → **Delete branch**.

A branch with an **open PR** can't be cleanly deleted first — **Abandon (or
Complete) the PR**, ticking "delete source branch", which removes both together.

(Other hosts: GitHub/GitLab branch deletion is governed by branch-protection
rules instead — adapt per `product.config.json` → `git.host`.)

---

## Quick checklist
1. `git fetch` + check behind/ahead and new remote branches.
2. Decide default branch vs feature branch (default: **branch**; ask if unsure).
3. Don't commit secrets / temp files; scan `--cached --stat`.
4. Dirty + behind → commit first, then merge; union `_map.json` conflicts.
5. Conventional commit msg + co-author trailer (current model name).
6. Push only when asked; verify `0 0` after.

## Customer Project Rules
<!-- Engagement overlay — record THIS customer's mandatory conventions and
     discovered rules for this artifact type here. Framework updates never touch
     this section. -->
