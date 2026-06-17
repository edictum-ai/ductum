# impl-005: Operational Views — Sequenced Prompts

**Spec:** `specs/impl-005-operational/spec.md`
**Status:** Draft
**Depends on:** impl-002 (dashboard shadcn rewrite)

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-TRIAGE-HOMEPAGE.md](P1-TRIAGE-HOMEPAGE.md) | Rich homepage with full-context run rows | — |
| 2 | [P2-RUN-FAILURE.md](P2-RUN-FAILURE.md) | Failure summary, cause chain, retry lineage | — |
| 3 | [P3-PROJECT-CONTROL.md](P3-PROJECT-CONTROL.md) | Project operational control panel | P1 |
| 4 | [P4-APPROVAL-QUEUE.md](P4-APPROVAL-QUEUE.md) | One-glance approval decision cards | P2 |
| 5 | [P5-COMMAND-PALETTE.md](P5-COMMAND-PALETTE.md) | Cmd+K search + copy buttons | — |

P1, P2, and P5 can run in parallel.
P3 depends on P1 (reuses triage row components).
P4 depends on P2 (reuses failure summary components).
