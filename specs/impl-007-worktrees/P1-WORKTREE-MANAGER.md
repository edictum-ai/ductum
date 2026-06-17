# P1: Worktree Manager

**Scope:** Git worktree creation, cleanup, branch naming
**Package:** `packages/core`
**Depends on:** None
**Deliverable:** WorktreeManager class that creates/removes worktrees for runs

---

## Required Reading

- `specs/impl-007-worktrees/spec.md` (full spec)
- `packages/core/src/dispatcher.ts` — how dispatch resolves cwd
- `packages/core/src/types.ts` — Run type (needs worktreePaths field)
- `git worktree` documentation

## Tasks

### 1. WorktreeManager class

File: `packages/core/src/worktree.ts`

```typescript
interface WorktreeConfig {
  enabled: boolean
  basePath: string       // default: /tmp/ductum-worktrees
  cleanupOnSuccess: boolean  // default: true
  cleanupOnFailure: boolean  // default: false
}

class WorktreeManager {
  constructor(config: WorktreeConfig) {}

  // Create worktree for a run
  async create(repoPath: string, taskName: string, runId: string): Promise<string>
  // Returns the worktree path

  // Remove worktree
  async remove(worktreePaths: string): Promise<void>

  // Check if repo supports worktrees
  isGitRepo(path: string): boolean
}
```

Implementation:
- Sanitize task name for git ref: `taskName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)`
- Derive repoName from repoPath: `path.basename(repoPath)` (e.g., `/Users/x/project/ductum` → `ductum`)
- Branch: `ductum/{sanitizedTaskName}-{runId.slice(0,6)}`
- Path: `{basePath}/{runId}/{repoName}`
- Command: `git -C {repoPath} worktree add {path} -B {branch}`
- Cleanup: `git -C {repoPath} worktree remove {path} --force`

### 2. Migration

Add `worktree_paths` column to runs table (JSON array, even for single repo):
```sql
ALTER TABLE runs ADD COLUMN worktree_paths TEXT;
-- Stored as JSON: ["path1", "path2"] or null
```

### 3. Tests

- Creates worktree in a temp git repo
- Verifies branch name follows pattern
- Cleans up worktree
- Handles non-git directory gracefully (returns original path)
- Handles existing worktree (force recreate)

## Verification

- [ ] WorktreeManager creates worktree with correct branch name
- [ ] WorktreeManager removes worktree cleanly
- [ ] Non-git repos return original path without error
- [ ] Migration adds worktree_paths column
- [ ] Tests cover create, remove, edge cases
