# 085 - Agent Settings Resource References

## Status

Accepted

## Context

Runtime dispatch now resolves `Agent.resourceRefs` for model, harness, sandbox,
workflow profile, and related audit state. The API and CLI can store those refs,
but the structured dashboard settings editor still assumes direct `model` and
`harness` fields. That makes resource-backed agents look invalid and can push
operators toward editing legacy fields instead of the declarative refs.

## Decision

Align the settings editor with Agent composition refs without replacing the
existing Agent row:

- `agents.<name>.modelRef` and `harnessRef` are first-class structured settings
  fields.
- `workflowProfileRef`, `sandboxRef`, `systemPromptRef`, `toolsRef`, and
  `policyRef` remain visible/editable advanced Agent resource refs.
- `systemPromptRef`, `toolsRef`, and `policyRef` are stored metadata in this
  slice, not runtime-resolved refs; the dashboard must not imply they are
  validated on save.
- When `modelRef` or `harnessRef` is set, the structured editor must preserve it
  and must not synthesize a direct `model` or `harness` field.
- Settings YAML that uses `modelRef` must name an explicit harness source with
  either direct `harness` or `harnessRef`; otherwise settings sync would invent a
  legacy harness snapshot that is not present in the document.
- Editing unrelated fields such as capabilities, effort, cost tier, pricing, or
  spawn config must preserve Agent refs and YAML comments.
- The server remains the validation authority for missing, wrong-kind,
  cross-project, and malformed refs.
- Legacy agents with direct `model` and `harness` fields keep existing settings
  behavior.

## Why This Is Not Drift

This implements the operator-facing side of decisions `053`, `057`, `058`,
`059`, `060`, `064`, `065`, `066`, `067`, `080`, `081`, `082`, `083`, and
`084`. It does not add a second Agent primitive, a new table, policy enforcement
in Ductum, or a dashboard redesign. It keeps the existing settings YAML document
as the source being edited and relies on existing API validation for runtime
semantics.

## Non-Goals

- No new Agent table or resource table.
- No migration that removes legacy `model` and `harness` fields.
- No second policy system or Edictum change.
- No model/harness/sandbox marketplace UI.
- No broad dashboard polish.
- No new dependency.
