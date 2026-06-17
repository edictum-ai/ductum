# P2: Dispatcher Integration

**Scope:** Wire worktrees into the dispatch lifecycle
**Package:** `packages/core`
**Depends on:** P1 (WorktreeManager)

---

## Required Reading

- `packages/core/src/dispatcher.ts` — dispatch(), handleSessionEnd(), resolveWorkingDir()
- `packages/core/src/dispatcher-support.ts` — SpawnOptions, resolveRepoPath
- `packages/core/src/types.ts` — Task.repos (string[], can have multiple repos, line ~108)
- `packages/core/src/types.ts` — MergeMode (line ~60)

## Tasks

### 1. Create worktrees for ALL task repos, not just repos[0]

The current dispatcher resolves cwd from `task.repos[0]` only (dispatcher.ts:398).
Tasks can target multiple repos. Create a worktree for each repo:

```typescript
const worktrees: string[] = []
for (const repoName of task.repos) {
  const repoPath = this.resolveRepoPath(repoName)
  if (repoPath && this.worktreeManager?.isGitRepo(repoPath)) {
    worktrees.push(await this.worktreeManager.create(repoPath, task.name, run.id))
  }
}
// Primary cwd = first worktree (or first repo path if no worktrees)
const workingDir = worktrees[0] ?? this.resolveWorkingDir(task)
```

Store all worktree paths in the run record (JSON array in `worktree_paths` column).

### 2. Cleanup respects merge mode

Current code keys cleanup off `result.exitReason`. But in human-merge mode,
a successful run goes through `waiting-for-approval` AFTER the session ends.
If cleanup runs on `exitReason === 'completed'`, the worktree is deleted
before the human can review.

Fix: cleanup decision must consider both exit reason AND merge mode:

```typescript
if (run.worktreePaths && run.worktreePaths.length > 0) {
  const mergeMode = this.getMergeMode(run)  // from project config
  const shouldCleanup =
    result.exitReason === 'completed' && mergeMode === 'auto'
      ? this.worktreeConfig.cleanupOnSuccess
      : result.exitReason === 'crashed' || result.exitReason === 'timeout'
        ? this.worktreeConfig.cleanupOnFailure
        : false  // human-merge: never auto-cleanup on success
  if (shouldCleanup) {
    for (const wt of run.worktreePaths) {
      await this.worktreeManager.remove(wt)
    }
  }
}
```

For human-merge: cleanup happens when the operator explicitly approves and
the run transitions to `done`, or via the manual cleanup button (P3).

### 3. Config wiring

Read worktree config from `ductum.yaml`:
```yaml
factory:
  worktrees:
    enabled: true
    basePath: /tmp/ductum-worktrees
    cleanupOnSuccess: true      # only applies to auto-merge projects
    cleanupOnFailure: false
```

Wire into dispatcher constructor via `scripts/serve.mjs`.

### 4. Integration test

Dispatch two tasks targeting the same repo simultaneously.
Verify both get different worktree paths and don't conflict.

## Verification

- [ ] Dispatched run creates worktree for each repo in task.repos
- [ ] Agent works in worktree directory
- [ ] Worktree paths stored in run record
- [ ] human-merge: worktree preserved after successful session completion
- [ ] auto-merge: worktree cleaned up per config
- [ ] Two parallel dispatches to same repo don't conflict
