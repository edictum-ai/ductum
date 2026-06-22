# Ductum Implementation — Sequenced Prompts

**Spec:** `specs/impl-001/spec.md`
**Generated:** 2026-04-04
**Status:** Not started

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-CORE-TYPES.md](P1-CORE-TYPES.md) | core | Types, SQLite schema, repository pattern | All TS types, migrations, CRUD repos, DB setup | [ ] | — |
| 2 | [P2-STATE-MACHINE.md](P2-STATE-MACHINE.md) | core | Run state machine + @edictum/core integration | RunStateMachine class, authorize_tool, gate_check, workflow YAML | [ ] | P1 |
| 3 | [P3-DAG-EVALUATOR.md](P3-DAG-EVALUATOR.md) | core | Task/spec dependency resolution | DAG evaluator, re-evaluation on completion, status propagation | [ ] | P1 |
| 4 | [P4-REST-API.md](P4-REST-API.md) | api | REST API + SSE event stream | Hono server, CRUD routes, SSE, health check | [ ] | P1, P2, P3 |
| 5 | [P5-MCP-SERVER.md](P5-MCP-SERVER.md) | mcp | 12 agent-visible MCP tools | MCP server wrapping REST API | [ ] | P4 |
| 6 | [P6-CLI.md](P6-CLI.md) | cli | Command-line interface | Admin + agent commands over REST API | [ ] | P4 |
| 7 | [P7-HARNESS-CLAUDE.md](P7-HARNESS-CLAUDE.md) | harness | Claude Agent SDK adapter | Tool-call interception, session lifecycle, auto heartbeat, cost tracking | [ ] | P2, P4 |
| 8 | [P8-HARNESS-OPENCODE.md](P8-HARNESS-OPENCODE.md) | harness | OpenCode stateless plugin + adapter | Plugin, session-to-run mapping, crash detection | [ ] | P2, P4, P5 |
| 9 | [P9-WATCHERS.md](P9-WATCHERS.md) | core | CI + review watcher system | Watcher spawning, polling, evidence injection, latch resolution | [ ] | P2, P4 |
| 10 | [P10-DISPATCHER.md](P10-DISPATCHER.md) | core | Push-mode dispatcher | Auto-dispatch loop, agent matching, concurrent run coordination | [ ] | P3, P7, P8, P9 |
| 11 | [P11-DASHBOARD.md](P11-DASHBOARD.md) | dashboard | React dashboard | Project/spec/task/run views, DAG viz, SSE, approvals | [ ] | P4 |

## Dependency Graph

```
P1-CORE-TYPES
  |
  +---> P2-STATE-MACHINE --+---> P7-HARNESS-CLAUDE ------+
  |                        |                              |
  |                        +---> P8-HARNESS-OPENCODE --+  |
  |                        |                           |  |
  |                        +---> P9-WATCHERS -------+  |  |
  |                                                 |  |  |
  +---> P3-DAG-EVALUATOR --+                        |  |  |
  |                        |                        v  v  v
  +---> P4-REST-API -------+----> P5-MCP-SERVER    P10-DISPATCHER
  |         |              |
  |         |              +----> P6-CLI
  |         |
  |         +----> P11-DASHBOARD
  |
  +---> (P2, P3, P4 can start after P1)
```

## Parallelization

- **P2, P3 can start in parallel** as soon as P1 completes (both depend only on P1 types/repos)
- **P4 needs P1, P2, P3** — it exposes the state machine and DAG as API endpoints
- **P5, P6, P11 can start in parallel** as soon as P4 completes (all are thin clients of the API)
- **P7, P8 can start in parallel** as soon as P2 + P4 complete (both need state machine + API)
- **P9 can start** as soon as P2 + P4 complete
- **P10 needs P3, P7, P8, P9** — dispatcher spawns agents via harnesses and uses DAG + watchers

### Critical Path

```
P1 -> P2 -> P4 -> P7 -> P10
              \-> P8 -/
              \-> P9 -/
```

P3 (DAG) is on the critical path only for P10 (dispatcher). P11 (dashboard) is independent after P4.

## Verification (run after all prompts complete)

```bash
# Core package
cd packages/core && pnpm test

# API package
cd packages/api && pnpm test

# MCP package
cd packages/mcp && pnpm test

# CLI package
cd packages/cli && pnpm test

# Harness package
cd packages/harness && pnpm test

# Dashboard
cd packages/dashboard && pnpm build

# Integration: full lifecycle
pnpm test:integration

# Lint all
pnpm lint
```

## Artifacts

- Spec: [spec.md](spec.md)
- Design docs: `../../CONTEXT.md`, `../../VISION.md`, `../../ARCHITECTURE.md`, `../../HARNESS.md`
- Decisions: `../../decisions/` (D1-D21)
- Corrections: C1-C7 from `../../CLAUDE.md`
