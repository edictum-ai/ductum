# P3: Config + UI

**Scope:** Dashboard display, cleanup controls, worktree info in run detail
**Package:** `packages/dashboard`, `packages/api`
**Depends on:** P2 (dispatcher integration)

---

## Tasks

### 1. Show worktree paths in RunDetail

In the meta bar or git section, show:
- Worktree paths (JSON array from `run.worktreePaths`) — list each with copy button
- Branch name per worktree
- "Worktree preserved" or "Worktree cleaned up" status

### 2. Manual cleanup action

Add a "Clean up worktree" button on the run detail page for preserved worktrees.
API: POST /api/runs/:id/cleanup-worktree

### 3. Dashboard: worktree indicator

On the homepage triage rows, show a small icon if the run has a worktree (indicates isolation was used).

## Verification

- [ ] RunDetail shows worktree path when present
- [ ] Can clean up preserved worktrees from UI
- [ ] Homepage shows worktree indicator
