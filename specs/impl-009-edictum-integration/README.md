# impl-009: Edictum as the Governance Layer — Sequenced Prompts

**Spec:** `specs/impl-009-edictum-integration/spec.md`
**Status:** Draft
**Depends on:** None (absorbs impl-004)
**Absorbed:** impl-004 (workflow completion) is folded into this spec

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-CONDITION-MATCHING.md](P1-CONDITION-MATCHING.md) | Fix exit condition matching for absolute paths (was impl-004/P1) | — |
| 2 | [P2-REPO-PROFILES.md](P2-REPO-PROFILES.md) | Repo profile format, template renderer, ductum.yaml integration | — |
| 3 | [P3-LIFECYCLE-MIGRATION.md](P3-LIFECYCLE-MIGRATION.md) | Edictum as source of truth, remove dual lifecycle, DB persistence | P1, P2 |
| 4 | [P4-REVIEW-RESET.md](P4-REVIEW-RESET.md) | Review/CI failure → reset; approval gates | P3 |
| 5 | [P5-STRUCTURED-COMPLETION.md](P5-STRUCTURED-COMPLETION.md) | Structured completion, dead code cleanup | P3 |

## Dependency Graph

```
P1-CONDITION-MATCHING ──┐
                        ├──→ P3-LIFECYCLE-MIGRATION ──→ P4-REVIEW-RESET
P2-REPO-PROFILES ───────┘                           ──→ P5-STRUCTURED-COMPLETION
```

P1 and P2 can run in parallel (no dependency).
P3 needs both P1 and P2 (conditions must match, profiles must render).
P4 and P5 can run in parallel after P3.

## Critical Path

P1 → P3 → P4 (condition matching → lifecycle migration → reset semantics)
