# 086 - Config Resource Settings Panels

## Status

Accepted

## Context

Runtime dispatch now uses declarative resources for Model, Harness,
SandboxProfile, WorkflowProfile, and NotificationChannel behavior. Settings can
store those sections in YAML, but operators still need the raw YAML editor for
most resource edits. That leaves the resource model production-hostile even
though the runtime path is real.

## Decision

Add narrow structured Settings panels for existing config resource sections:

- `models`
- `harnesses`
- `sandboxProfiles`
- `workflowProfiles`
- `notificationChannels`

The panels edit only the fields already accepted by settings validation. They
must preserve YAML comments for common scalar and list edits, surface existing
server validation errors, and avoid provider marketplaces or fake plugin UI.
Secrets remain masked or YAML-only unless an existing settings path already
handles them.

## Why This Is Not Drift

This is the operator-facing continuation of decisions `053`, `055`, `056`,
`057`, `079`, `080`, `081`, `082`, `083`, `084`, and `085`. It does not add a
new resource kind, table, runtime behavior, dependency, marketplace, or policy
system. It makes existing resource sections editable without changing their
meaning.

## Non-Goals

- No new config resource kind.
- No new top-level primitive/table.
- No provider marketplace, plugin marketplace, or adapter registry UI.
- No Edictum or policy behavior change.
- No runtime behavior change.
- No broad dashboard redesign.
- No new dependency.
