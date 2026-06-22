# impl-010: Scenario-Based Validation

**Depends on:** impl-009 (Edictum governance — local-verify must be a real Edictum stage)
**Soft depends on:** impl-007 (worktrees — scenario execution isolation is better with worktrees, but works without via git snapshot to temp dir)
**Can start after:** impl-009/P3 (lifecycle migration)
**Dashboard prompt (P5) depends on:** impl-002 if landed (shadcn), otherwise uses current UI

| # | Prompt | Package | Scope | Depends On |
|---|--------|---------|-------|------------|
| P1 | scenario-types-and-loader | core | Types, YAML loader, sample scenarios | — |
| P2 | scenario-runner | core | Step execution engine, satisfaction scoring | P1 |
| P3 | scenario-judge | core | LLM-as-judge evaluator, cross-model defense | P2 |
| P4 | scenario-gate-integration | core, mcp, api | Wire as Ductum post-gate at local-verify, MCP tool, API | P3 |
| P5 | scenario-dashboard | dashboard | Results panel, improvement trend | P4 |

**Note:** P1 can start in parallel with impl-009 since it only creates new files.
P4 (gate integration) requires impl-009/P3 to be done.

**Execution isolation:** Without impl-007, scenarios run in a `git clone --local`
to a temp directory (read-only snapshot of the agent's current commit).
With impl-007, scenarios use a read-only worktree. Neither runs in the agent's
live working directory.

## Load into Ductum

```bash
pnpm load-spec specs/impl-010-scenario-validation/scenario-validation.yaml
```

## Key concepts

- **Scenario holdouts**: Validation stored outside the target repo — organizational holdout (agents not told about paths), not filesystem-level isolation
- **Cross-model evaluation**: Different model judges than implements (Stanford defense)
- **Satisfaction testing**: Probabilistic 0-1 scores, not boolean pass/fail
- **Ductum gate, not Edictum gate**: Scenarios are enforced at the Ductum level after Edictum's command_matches exit gate passes — @edictum/core has no custom evidence type support
- **Digital twins**: YAML schema supports service mocks from day one (implementation deferred)

## Sources

- StrongDM Software Factory: https://factory.strongdm.ai/
- OpenHands SDK: https://docs.openhands.dev/sdk
- Stanford CodeX analysis: https://law.stanford.edu/2026/02/08/built-by-agents-tested-by-agents-trusted-by-whom/
