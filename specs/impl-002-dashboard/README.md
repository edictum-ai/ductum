# impl-002: Dashboard Rewrite — Sequenced Prompts

**Spec:** `specs/impl-002-dashboard/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-SHADCN-FOUNDATION.md](P1-SHADCN-FOUNDATION.md) | Tailwind + shadcn setup, Layout, Sidebar | — |
| 2 | [P2-CORE-PAGES.md](P2-CORE-PAGES.md) | ProjectList, ProjectDetail, SpecDetail, TaskDetail, AgentList | P1 |
| 3 | [P3-RUN-DETAIL.md](P3-RUN-DETAIL.md) | RunDetail page (activity feed, evidence, gates, tabs) | P1 |
| 4 | [P4-CRUD-FORMS.md](P4-CRUD-FORMS.md) | Create spec, task, agent dialogs + YAML import | P2 |
| 5 | [P5-APPROVAL-TESTS.md](P5-APPROVAL-TESTS.md) | ApprovalQueue rewrite + test suite update | P3 |

## Dependency Graph

```
P1-SHADCN-FOUNDATION
  |
  +---> P2-CORE-PAGES ---> P4-CRUD-FORMS
  |
  +---> P3-RUN-DETAIL ---> P5-APPROVAL-TESTS
```

P2 and P3 can run in parallel after P1.
P4 and P5 can run in parallel after their parents.
