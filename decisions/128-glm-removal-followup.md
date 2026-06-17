# D128: GLM-5.1 stays in the agent catalog as evidence-keep

**Date:** 2026-05-01
**Context:** P4 (Catalog Truth) flagged that `glm` is half-removed: still in
the agent table for foreign-key audit, no longer assigned to any project
pool, and the `claude-agent-sdk` route to z.ai stopped resolving with
"model may not exist or you may not have access to it" on 2026-05-01 even
with `ZAI_API_KEY` set.
**Decided by:** Arnold + dispatched P4 builder

## Alternatives considered

1. **Delete the `glm` agent row.**
   Rejected today. The `runs` table has historical `agent_id` foreign
   keys pointing at the glm row from earlier bakeoff dispatches. A naive
   `DELETE` cascades through `runs`, `run_activity`, `evidence`,
   `gate_evaluations`, `run_updates`, and `session_run_mappings`, which
   would erase real audit trail evidence we still need for cost
   reconciliation and the bakeoff retrospective. The right fix is a
   soft-delete migration (`agents.deletedAt`) plus an explicit
   evidence-keep policy on historical runs — that is its own focused
   spec, not a P4 follow-up.

2. **Add explicit OpenRouter routing in `claude-agent-sdk` so glm-5.1
   becomes reachable again.**
   Rejected for P4 scope. The `claude-agent-sdk` adapter is wired for
   Anthropic-compatible auth (`ANTHROPIC_API_KEY` / Claude Code OAuth /
   `ANTHROPIC_BASE_URL`). Routing glm through OpenRouter requires either
   a dedicated z.ai harness adapter or an `ANTHROPIC_BASE_URL`
   environment override per-agent. Both touch session binding (D24,
   D25), per-run sandbox env (D55), and harness selection (D54). That
   work belongs under a follow-up spec
   (`specs/current/glm-zai-harness-adapter`) and must land its own
   decision before a Harness resource can declare `type: zai-sdk`.

## Decision

`glm` agent row, `glm-5-1` Model resource, and the `glm-5.1` catalog
entry **stay declared** in `ductum.yaml` and the model catalog as an
evidence-keep record. The agent stays excluded from the active project
`agents:` pool. P4's `models:` block declares `glm-5-1` because the
agent record references it via `modelRef`, which keeps the resource
resolution graph honest.

The doctor surface treats `glm` as expected when no project pool
includes it. If a project does include `glm`, the existing model check
already fails with "model may not exist or you may not have access to
it" — that error stays the operator's signal that glm needs the
follow-up adapter before being reachable.

## Follow-ups (not in P4 scope)

- Add `specs/current/glm-zai-harness-adapter/` describing either an
  OpenRouter route under `claude-agent-sdk` or a dedicated `zai-sdk`
  harness. Until then, glm cannot be reassigned to any project.
- Add `agents.deletedAt` and an evidence-keep policy under a separate
  recovery spec when we want to soft-delete agents without dropping
  historical lineage.

## Sources

- `decisions/052-pi-harness-evaluation.md` — adjacent harness-blocked
  pattern this decision mirrors.
- `ductum.yaml` 2026-05-01 — `glm` declared, not in any project pool.
- `specs/current/factory-readiness-recovery/P4-CATALOG-TRUTH.md` §4.5.
