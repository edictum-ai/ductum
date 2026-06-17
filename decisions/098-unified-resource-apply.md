# 098 - Unified Resource Apply

## Status

Accepted

## Context

Ductum now has separate declarative apply paths:

- `ductum resource apply` for config resources.
- `ductum target apply` for targets.
- `ductum agent apply` for agent manifests.

That works, but factory setup still requires operators to know which command owns
each document kind. The factory resource model expects one declarative product
graph made of targets, config resources, and agents.

## Decision

Make `ductum resource apply` accept mixed factory manifests containing:

- existing config resource kinds,
- `Target`,
- `Agent`.

The command must dispatch each document to the existing API and parser path for
that kind. `Target` stays in the target table. `Agent` stays in the agent table.
Config resources stay in the config-resource table.

Apply remains sequential and non-transactional. The CLI validates every document
shape before the first write, but it does not roll back successful writes after
a later API failure. That trade-off keeps this slice on existing APIs without a
new table, generic object store, or transaction coordinator; operators see the
loud failure and can rerun the idempotent apply after fixing the cause.

## Why This Comes Next

The runtime slices made refs meaningful. The CLI now needs a single factory
bootstrap path that can apply the graph Ductum dogfoods without asking the
operator to split one manifest across three commands.

## Non-Goals

- No new resource kind.
- No new table or top-level primitive.
- No Operation or WorkOrder primitive.
- No Kubernetes-style generic object store.
- No marketplace, plugin abstraction, or second policy system.
- No runtime behavior change.
- No dependency.
- No Agent or Target migration into `ConfigResource`.
- No rollback or transaction coordinator across existing resource APIs.
