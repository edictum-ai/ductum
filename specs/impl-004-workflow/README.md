# impl-004: Workflow Completion — Sequenced Prompts

**Spec:** `specs/impl-004-workflow/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-CONDITION-MATCHING.md](P1-CONDITION-MATCHING.md) | Fix exit condition matching for absolute paths | — |
| 2 | [P2-COMPLETION-STORAGE.md](P2-COMPLETION-STORAGE.md) | Store completion summaries, DB persistence | — |

P1 and P2 can run in parallel.
