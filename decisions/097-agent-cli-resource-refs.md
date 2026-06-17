# 097 - Agent CLI Resource Refs

## Status

Accepted

## Context

Ductum can resolve Agent `modelRef`, `harnessRef`, `workflowProfileRef`,
`sandboxRef`, and `systemPromptRef` through config resources at runtime. The
settings UI, YAML manifests, API, dispatcher, and doctor checks now understand
those refs.

The main `ductum agent register` and `ductum agent update` commands still steer
operators toward direct `model` and `harness` fields. `agent register` also
requires `--model` and supplies a legacy default harness in the CLI before the
operator can express a resource-backed agent.

## Decision

Make resource refs first-class in `ductum agent register` and `ductum agent
update`:

- Add CLI flags for Agent `resourceRefs`.
- Preserve legacy direct `--model` / `--harness` behavior when no ref flags are
  provided.
- Reject direct/ref conflicts in the CLI before the API call.
- Require an explicit harness source when `--model-ref` is used.
- Merge update ref flags with the existing Agent refs instead of deleting
  unspecified refs.
- Keep resource existence, kind, project scope, and runtime validation in the
  API/dispatcher.

## Why This Comes Next

Resource-backed runtime works, but factory operators still need a first-class
CLI path to create and adjust resource-backed Agents without hand-writing YAML
or relying on legacy direct model fields.

## Non-Goals

- No new table or top-level primitive.
- No Operation or WorkOrder primitive.
- No second policy system; Edictum remains the policy system.
- No marketplace or plugin abstraction.
- No new dependency.
- No runtime behavior change.
- No new semantics for `toolsRef` or `policyRef`; they remain metadata-only
  until a later decision gives them behavior.
- No CLI-side config-resource authority beyond local conflict checks.
