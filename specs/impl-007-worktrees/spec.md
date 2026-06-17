# impl-007: Git Worktree Isolation

**Status:** Draft
**Priority:** High — required for parallel dispatch to the same repo
**Depends on:** None

## Problem

When two agents are dispatched to the same repo simultaneously (e.g., two tasks in the `edictum` project), they both operate on the same checkout directory. This causes:
- Git conflicts (both try to create branches, commit, push)
- File write collisions (both editing the same files)
- Test interference (one agent's changes break another's tests)
- No clean isolation between task attempts

Claude Code already supports worktrees (`isolation: "worktree"` in Agent tool). Ductum should use the same pattern at the dispatch level.

## Goals

1. Each dispatched run gets its own git worktree
2. Worktrees are created before the agent session starts
3. Agent's cwd is set to the worktree path
4. On completion: worktree is kept (for review) or cleaned up (configurable)
5. On failure/stall: worktree is preserved for debugging
6. Multiple agents can work on the same repo in parallel without conflicts

## Non-Goals

- Cross-worktree file sharing (agents are fully isolated)
- Merging worktree changes automatically (that's the push-pr workflow stage)
- Worktree pooling or reuse (create fresh each time)

## Architecture

### Worktree lifecycle

```
Task dispatched
    ↓
git worktree add /tmp/ductum-wt-{runId} -b ductum/{taskName}-{runId}
    ↓
Set agent cwd = /tmp/ductum-wt-{runId}
    ↓
Agent works in isolation
    ↓
On completion:
  - If mergeMode=auto: merge worktree branch back
  - If mergeMode=human: leave for review
  - Clean up worktree: git worktree remove (configurable)
On failure/stall:
  - Preserve worktree for debugging
  - Log worktree path in run record
```

### Key changes

1. **Dispatcher** (`packages/core/src/dispatcher.ts`):
   - Before `adapter.spawn()`, create worktree
   - Pass worktree path as `workingDir` in SpawnOptions
   - Store worktree paths (JSON array) in run record
   - On session end, handle cleanup for all worktrees

2. **Run model** (`packages/core/src/types.ts`):
   - Add `worktreePaths: string[] | null` to Run (JSON array — even single-repo tasks use array)
   - Migration: `ALTER TABLE runs ADD COLUMN worktree_paths TEXT` (stored as JSON)
   - First entry is the primary worktree (used as agent cwd)

3. **Config** (`ductum.yaml`):
   ```yaml
   factory:
     worktrees:
       enabled: true
       basePath: /tmp/ductum-worktrees  # default
       cleanupOnSuccess: true           # remove worktree after done
       cleanupOnFailure: false          # keep for debugging
   ```

4. **Branch naming**:
   - Sanitize task name: `taskName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)`
   - Pattern: `ductum/{sanitizedTaskName}-{runId.slice(0,6)}`
   - Example: `ductum/spec-import-command-n32TJB`

### Edge cases

- **Repo not a git repo**: skip worktree, use main directory (warn in logs)
- **Worktree already exists**: remove and recreate (previous run didn't clean up)
- **Branch already exists**: use `-B` flag to force-create
- **Shallow clone**: worktrees may not work — detect and warn
- **Submodules**: `git worktree add` doesn't init submodules — may need post-create hook

## Acceptance Criteria

1. Two agents dispatched to same repo work without conflicts
2. Each run record shows worktree path
3. Agent works in worktree directory (verified by file writes appearing there)
4. Worktree branch named `ductum/{taskName}-{short-id}`
5. Cleanup configurable via ductum.yaml
6. Failed runs preserve worktree for debugging
7. Dashboard shows worktree path in run detail
