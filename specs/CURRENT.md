# Current Ductum Direction

**Date:** 2026-06-09 (operational model redesign P9 PASS; post-P9 hardening active)

## Active Mission

**Post-P9 hardening after operational model redesign closeout.** The
operational model redesign passed P9 on 2026-06-09 and is closed as the normal
Ductum operator model.

**Source of truth:** `specs/current/post-p9-hardening/README.md`,
`specs/current/operational-model-redesign/README.md`, and
`decisions/166-operational-model-redesign-closeout.md`.

P1-P9 of `operational-model-redesign` are done/pass. The accepted operator
model is Factory -> Project -> Repository/Component -> Spec -> Task -> Attempt,
with Factory Settings owning Providers, Models, Harnesses, Workflows, Agents,
sandboxes, notifications, budgets, and app settings. Legacy Target/Run/resource
surfaces remain compatibility/debug paths, not the normal public model.

Ductum may now dogfood later polish stages. The post-P9 hardening list is
explicitly not a blocker to the redesign closeout.

Bootstrap redesign is not the active mission. It remains paused by D161 until a
separate audit/resume decision changes that state.

Inventory of what's left across the whole backlog:
`specs/backlog/next-session-inventory.md`. Read this when deciding what
comes after this arc closes.

## Operational Hardening Bundle (shipped 2026-05-03)

The 10-feature reliability + agent-first bundle landed against D135's design
contract: shared helpers, bakeoff sandbox, stale-slot GC, last-iteration
verify retry, SSE event stream, claude max-turns mid-write detection, spec
sync, task set-status, typed worktree-snapshot evidence, output-mode toggle,
operator cancel control. Plus a live tmp-db demo harness (D146,
`pnpm demos:sse-cancel`) that exercises the SSE+cancel lifecycle end-to-end
against mock agents.

Decisions: D135 (contract) → D136-D145 (per feature) → D146 (demo harness).
1593 package tests + 31 script tests passing, file-size gate green, working
tree clean.

## Recovery Status (closed 2026-05-02)

`factory-readiness-recovery` shipped as **Outcome A** — all seven
P-stages merged to main. The factory runs itself: dispatcher, post-
completion pipeline, reviewer chain, approval gate, and merge
orchestration are all proven end-to-end. Closeout: `decisions/131-
factory-readiness-recovery-closeout.md`. The bootstrap prereq blocker
identified in D131 is fixed by D132; fresh-checkout bootstrap now proceeds
past auth detection with only `ANTHROPIC_OAUTH_TOKEN` exported and names the
provider/source in the startup banner. The remaining D131 caveat —
fresh-clone wall-clock against real (not mock) agents — is intentionally
deferred to the bootstrap-redesign arc, where it becomes that spec's
exit criterion against the new `ductum init` flow.

## Background Direction

Ductum is a factory control plane for agentic software work.

The product should let a solo founder or small team define a product graph,
configure agents, declare work, fan tasks out across targets, enforce policy,
approve risky transitions, merge safely, and receive completion notifications.

The old implementation specs under `specs/impl-*` are retained as history. They
are not the active product roadmap.

## Active Primitives

Use these decisions as the current design source:

- `decisions/053-factory-resource-model.md`
- `decisions/054-harness-plugin-model.md`
- `decisions/055-notification-backends.md`
- `decisions/056-sandbox-resource-model.md`
- `decisions/057-reference-runtime-systems.md`
- `decisions/058-minimal-scope-and-reference-non-goals.md`
- `decisions/059-design-to-spec-pipeline.md`
- `decisions/060-decision-drift.md`

## Next Implementation Theme

Work through post-P9 hardening in order:

1. P0 workflow validity targeting and secret-message wording.
2. P1 safety/honesty hardening.
3. P2 model/API architecture seams.
4. P3 cleanup debt.
5. P4 process directives.

Do not implement hardening items without a stage prompt and verification gate.

## Architectural Rule

Ductum coordinates. Edictum bounds agency.

Ductum owns scheduling, state, assignments, fan-out, aggregation, notifications,
and merge orchestration. Edictum owns tool authorization, workflow gates,
evidence, approvals-as-policy, and behavioral conformance.

Edictum is the policy engine. Do not grow a second policy engine inside Ductum.

## Scope Rule

Reference systems are pattern libraries, not product requirements. Before adding
a field, table, endpoint, dependency, or abstraction, name the Ductum dogfood
flow that breaks without it. If the answer is unclear, defer it.

## Reference Systems

OpenShell is the closest reference for sandbox resource shape: public
spec/status/phase/conditions/events above private compute drivers. T3 Code is
the closest reference for provider/harness pluggability: adapters emit canonical
events while a service owns routing, validation, persistence, and recovery.

Ductum should not clone those systems. Use the seams, not the bulk.

## Sandbox Rule

Sandboxing is a first-class resource. It is not a harness detail. Agents and
workflow profiles should reference sandbox profiles explicitly.

## Migration Rule

Do not add new top-level concepts named `Operation` or `WorkOrder` yet. First
try:

- multi-repo operation = fan-out `Spec`
- work order = target-scoped `Task`
- workspace = richer `Factory` / `Project` configuration

Only add new primitives if this model breaks under real dogfood.

## Design-To-Spec Rule

Planning is also a workflow. Use a `Spec` plus append-only `Decision`,
`Approval`, `Evidence`, `Task`, and `Run` records to capture the path from rough
idea to implementation prompts. Do not add a top-level `DesignSession` until
the spec-based model breaks.

The next implementation session must dogfood this. It should turn the current
resource-model plan into a Ductum spec artifact, generate implementation
prompts, import or represent them as tasks, and run at least one through Ductum.

## Decision Drift Rule

Every generated prompt and review should carry a decision trace: linked
decisions, linked non-goals, allowed scope, expected verification, and what to
do if the implementation needs to drift. Drift is acceptable only when the
"why" is recorded as a decision, waiver, or amendment with evidence.
