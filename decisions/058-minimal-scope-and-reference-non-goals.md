# 058 - Minimal Scope And Reference Non-Goals

## Status

Accepted

## Context

Decisions `056` and `057` use Sandcastle, OpenShell, and T3 Code as reference
systems. That is useful, but it creates a scope risk. Good reference systems are
seductive: every generalization looks reasonable in isolation.

Ductum's job is not to become OpenShell, T3 Code, Sandcastle, Kubernetes, or a
generic agent runtime. Ductum is a factory control plane:

- all work state is saved.
- all decisions are saved.
- all transitions are auditable.
- all approvals are traceable.
- all outcomes are explainable by who, what, when, why, and how.

Edictum is the policy engine. Ductum should coordinate work and delegate policy
semantics to Edictum instead of growing its own parallel policy system.

## Decision

Reference projects are pattern libraries, not product requirements and not
dependency targets.

Ductum should keep dependencies minimal. Prefer no new dependency unless the
standard library or existing repo code is clearly insufficient. When a
dependency is needed, follow `SECURITY.md`: exact pins, lockfile committed,
package reviewed, no blind upgrades.

For every new resource field, endpoint, table, or abstraction, the implementer
must be able to name the Ductum dogfood scenario it supports. If the reason is
"OpenShell has it" or "T3 Code has it," defer it.

## Non-Goals For The Next Resource-Model Pass

Do not build these yet:

- OpenShell clone.
- Kubernetes-style gateway runtime.
- full sandbox `spec/status/phase/conditions/events` observability.
- four complete sandbox policy domains.
- draft sandbox policy recommendation flow.
- `inference.local` routing.
- credential vault.
- generic provider marketplace.
- full provider option descriptor UI.
- settings change streams.
- remote/cloud sandbox orchestration.
- Pi-only harness rewrite.
- new top-level `Operation` or `WorkOrder` kinds.

Some of these may become useful later. They do not belong in the first resource
model pass unless a Ductum dogfood scenario forces them.

## Required Guardrails

The first implementation pass stays narrow:

1. Add `Target` end to end.
2. Make settings server-authoritative and schema-validated before larger
   resource migrations.
3. Preserve the `Agent != Model != Harness != Sandbox` separation.
4. Keep `HarnessAdapter` protocol-only. Adapters emit events and execute
   provider/session operations; core owns routing, session binding, Edictum
   authorization, state, approvals, and notifications.
5. Encode the sandbox create-time vs hot-reloadable split when
   `SandboxProfile` is introduced. Filesystem and process constraints are
   create-time. Network and inference-style routing may be hot-reloadable later.
6. Leave room for inference routing without implementing it. The model/harness
   shapes must not make future runtime-routed inference impossible.
7. Keep Edictum as the only policy engine.

## Implementation Heuristic

When adding anything, answer this in the PR or decision:

> Which Ductum dogfood flow breaks without this?

If the answer is unclear, do not add it.
