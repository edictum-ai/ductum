# impl-006: DX Polish — Sequenced Prompts

**Spec:** `specs/impl-006-dx-polish/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-README.md](P1-README.md) | Getting-started guide | — |
| 2 | [P2-STARTUP-VALIDATION.md](P2-STARTUP-VALIDATION.md) | Env var validation, structured logging | — |
| 3 | [P3-URL-STRUCTURE.md](P3-URL-STRUCTURE.md) | Descriptive URLs, cleanup | P1 |

P1 and P2 can run in parallel.
