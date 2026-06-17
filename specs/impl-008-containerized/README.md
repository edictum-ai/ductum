# impl-008: Containerized Deployment — Sequenced Prompts

**Spec:** `specs/impl-008-containerized/spec.md`
**Status:** Draft
**Depends on:** impl-007 (worktrees)

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-DOCKERFILE.md](P1-DOCKERFILE.md) | Multi-stage Dockerfile, build and run | — |
| 2 | [P2-ENV-CONFIG.md](P2-ENV-CONFIG.md) | Environment-based config, DB path, port config | P1 |
| 3 | [P3-COMPOSE.md](P3-COMPOSE.md) | Docker Compose, volumes, health checks | P1, P2 |

P1 first, then P2, then P3.
