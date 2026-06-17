# impl-007: Git Worktree Isolation — Sequenced Prompts

**Spec:** `specs/impl-007-worktrees/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-WORKTREE-MANAGER.md](P1-WORKTREE-MANAGER.md) | Worktree creation, cleanup, branch naming | — |
| 2 | [P2-DISPATCHER-INTEGRATION.md](P2-DISPATCHER-INTEGRATION.md) | Wire worktrees into dispatch lifecycle | P1 |
| 3 | [P3-CONFIG-UI.md](P3-CONFIG-UI.md) | Config options, dashboard display, cleanup controls | P2 |

## Dependency Graph

```
P1-WORKTREE-MANAGER → P2-DISPATCHER-INTEGRATION → P3-CONFIG-UI
```

Sequential — each builds on the previous.
