# D109: Factory readiness recovery — staged plan

**Date:** 2026-04-30
**Decided by:** Arnold + Claude Opus

## Context

The 2026-04-30 mission to merge P18-P21 of `agent-first-factory-readiness`
shipped, but the operator audit afterwards exposed structural gaps:

- 30 of 32 spec directories on disk are code-shipped but never tracked in
  Ductum. The previous workflow used Specs/Decisions as a diary alongside
  normal git, not as the authoritative work register. The factory does
  not run itself.
- Default first-run reviewer pool is `codex` only; codex reliably emits
  verdicts inside prose which the strict P18 parser rejects, so the
  out-of-the-box review chain never PASSes a task. P19 needed three
  retries plus a new `operator-ship` endpoint to recover.
- Every `pnpm serve` restart orphans live runs (in-memory session map is
  process-local). We saw this 3× in one session.
- Approval gate requires the branch to contain current main; every
  concurrent merge breaks the next approval and forces a manual rebase
  + re-verify before approve.
- Resource model is partially populated: claude models / claude-agent-sdk
  harness are not registered as Model/Harness resources, even though the
  factory uses them every day. NotificationChannel table is empty.
  Telegram has never been end-to-end tested.
- Pi is intentionally not implemented (D52) but no operator-visible
  signal says so; an operator has to read decisions/ to know.
- Dashboard ships with `localStorage.ductum.operatorToken="local-demo-token"`;
  the real token is in `.env.local`, which 401s every API call. There
  is no UI flow to reach a working state from a fresh checkout.
- Dashboard resource panels (Models, Harnesses, SandboxProfile,
  WorkflowProfile) use plain text inputs for fields that have small
  enums; agent panel uses the right pickers, so the components exist
  but the resource panels don't use them.
- `/runs/<id>` route returns "spec X could not be resolved" — wrong
  page, wrong error message.
- Spec list mislabels every spec as `failed`, including ones that are
  `done`.
- `SpecStatus` enum has no `failed` terminal value, so abandoned specs
  sit in `approved`/`draft` forever.
- Several recovery endpoints are not exposed via CLI (`/spec set-status`,
  `/run end-session`, `/project agent assign|unassign|list-roles`),
  forcing operators (and agents) to fall back to curl.

## Alternatives considered

1. **Big-bang fix-everything-in-one-session.** Tried this on 2026-04-30.
   17 commits landed; only 4 were dogfooded through Ductum. The rest
   reinforced the diary problem. Rejected.

2. **Strip the factory back to the resource-model primitives only.**
   Throws away all the operator/dispatch/approval surface that already
   works. Rejected.

3. **Ignore the dashboard entirely, run from CLI.** Plausible but the
   dashboard is part of the public product story. Operators expect a
   visible factory. Rejected.

4. **Stage the work, dogfood from Stage 2 onward.** Selected.

## Decision

Tackle the recovery in 6 staged batches. Stage 0 + 1 are operator-direct
because they are prerequisites that unblock dogfooding. Stage 2 onward
imports as Ductum specs and dispatches through the factory.

| Stage | Scope | How | Cost ceiling |
|-------|-------|-----|--------------|
| 0 | Token UX, spec list status, `/runs/<id>` route, `SpecStatus = failed`, missing CLI parity | Operator-direct | $0 |
| 1 | `ductum-cli` skill + self-test | Operator-direct | $0 |
| 2 | Dashboard truthfulness (resource pickers, spec import button, dependency picker, harness source-of-truth, decisions split, glm card cleanup, home skeleton) | Dogfood through Ductum | $30 |
| 3 | Factory durability (persistent session-binding, approval auto-rebase, reviewer-format compat, spec-budget realism) | Dogfood through Ductum | $50 |
| 4 | Catalog truth (claude models/harness as resources, Pi doctor signal, Telegram wizard end-to-end tested, glm follow-up) | Dogfood through Ductum | $30 |
| 5 | Diary cleanup — bulk-import the 30 unimported specs as `done` with provenance from git history; mark abandoned drafts `failed` | Dogfood through Ductum | $5 |
| 6 | `ductum bootstrap` proof — fresh clone → one merged commit in <10 minutes | Dogfood through Ductum | $5 |

Each stage has a single demo-based exit criterion. No stage advances on
"tests pass" alone.

The `ductum-cli` skill written in Stage 1 is a hard prerequisite for
Stage 2+: agents must drive Ductum through the CLI, not through curl,
not through SQLite, not through hand-edited yaml. The skill encodes
this rule and the recovery recipes we developed today.

## How to apply

- Create `specs/current/factory-readiness-recovery/` with one P-file per
  stage so each stage can be imported into Ductum and dispatched
  individually.
- Update `specs/CURRENT.md` to point at this recovery as the active
  direction (replacing "build the declarative resource model" which is
  now partially done).
- Update root `AGENTS.md` and root/repo `CLAUDE.md` so any new agent
  session lands on this plan immediately.
- Stage 0 + 1 commits go on `main` directly with conventional-commit
  messages, no Ductum tracking required (they enable dogfooding).
- Stage 2 onward: import the spec, let the dispatcher pick tasks up,
  approve+merge as they land. Use `ductum operator-ship` for the cases
  Stage 3.3 has not yet fixed.
- Each stage merges in its entirety before the next starts.

## Non-goals

- Do not add new top-level primitives (no `Operation`, `WorkOrder`,
  `DesignSession`). D52, D53, D58 still apply.
- Do not add a second policy engine. Edictum stays the policy layer.
- Do not re-dogfood the 30 already-shipped specs by re-running them.
  Stage 5 imports them as `done` with provenance.
- Do not enable Pi in any harness. D52 still gates Pi.
- Do not re-add glm to the agent pool until the harness can route
  non-Anthropic models through claude-agent-sdk reliably.

## Sources

- 2026-04-30 mission transcript and operator audit (this session)
- `decisions/052-pi-harness-evaluation.md`
- `decisions/053-factory-resource-model.md`
- `decisions/060-decision-drift.md`
- `decisions/108-execution-integrity-operator-readiness.md`
- `specs/CURRENT.md`
- `/tmp/ductum-ui-audit/*.png` — dashboard defect screenshots (D1-D14)
