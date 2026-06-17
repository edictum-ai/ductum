# impl-003: Multi-Model Dispatch — Sequenced Prompts

**Spec:** `specs/impl-003-multi-model/spec.md`
**Status:** Draft

## Execution Order

| # | Prompt | Scope | Depends On |
|---|--------|-------|------------|
| 1 | [P1-OPENCODE-VERIFY.md](P1-OPENCODE-VERIFY.md) | Test OpenCode adapter against a live OpenCode instance | — |
| 2 | [P2-ACTIVITY-BRIDGE.md](P2-ACTIVITY-BRIDGE.md) | Bridge OpenCode messages to Ductum activity feed + tokens | P1 |
| 3 | [P3-MODEL-ROUTING.md](P3-MODEL-ROUTING.md) | Task-to-model routing, cost-based dispatch hints | P1 |

## Dependency Graph

```
P1-OPENCODE-VERIFY
  |
  +---> P2-ACTIVITY-BRIDGE
  |
  +---> P3-MODEL-ROUTING
```

P2 and P3 can run in parallel after P1.
