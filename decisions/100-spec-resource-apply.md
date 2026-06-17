# 100 - Spec Resource Apply

## Status

Accepted

## Context

Decision `098` unified config resources, Targets, and Agents under
`ductum resource apply`. Decision `099` added Project documents, closing the
factory bootstrap gap for target references.

The remaining declarative bootstrap gap is work declaration. Operators can
apply the product graph, but must still switch to `ductum spec import` to
create a Spec and its Tasks. Existing spec import already owns task fan-out,
target refs, agent assignment by name, dependencies, and DAG evaluation.

## Decision

Teach `ductum resource apply` to accept `Spec` documents that route through the
existing spec import path:

- `Spec` documents use `metadata.name` and `metadata.project`.
- `spec.document`, `spec.status`, and `spec.maxFixIterations` map to the
  existing Spec API payload.
- When `spec.status` is omitted, resource apply preserves the legacy
  `ductum spec import` default of `approved`; changing that default is a
  separate runtime-dispatch decision, not part of this apply-surface slice.
- `spec.tasks` and `spec.fanOut` reuse the existing YAML spec import task
  semantics.
- Spec creation, task creation, task dependency wiring, and DAG evaluation use
  existing APIs.
- A Target document earlier in the same manifest may be referenced by a later
  Spec document through the normal target lookup.
- Existing import behavior is preserved: an existing Spec with tasks is not
  duplicated or mutated by apply.
- Apply remains sequential and non-transactional after all document shapes are
  validated.

## Why This Comes Next

After Project apply, a single resource manifest can declare Projects, Targets,
Agents, and config resources, but cannot yet declare the work graph that Ductum
is supposed to run. Reusing the existing spec import path closes that product
bootstrap gap without adding a new primitive, table, dependency, or policy path.

## Non-Goals

- No standalone top-level `Task` document support in this slice.
- No Factory manifest support in this slice.
- No Spec/Task migration into ConfigResource.
- No task update, task delete, or task reconciliation behavior.
- No transaction coordinator or rollback system.
- No Operation or WorkOrder primitive.
- No second policy system or Edictum behavior change.
- No new dependency.
