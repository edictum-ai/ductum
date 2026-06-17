# 062 - Config Resource Shells

## Status

Accepted

## Context

After `Target`, the next resource-model slice needs persisted shells for:

- `WorkflowProfile`
- `Model`
- `Harness`
- `SandboxProfile`
- `NotificationChannel`

These resources need config validation, import/apply, API visibility, and dogfood
traceability. They do not yet need runtime migration.

Creating five nearly identical tables and repos before runtime behavior exists
would add code bulk without improving the dogfood loop.

## Decision

Use one `config_resources` table for non-Target declarative resource shells in
this slice:

- `kind`
- `project_id` nullable
- `name`
- JSON `spec`
- timestamps

`Target` stays in its dedicated table because it is the first work-location
primitive and later task fan-out will reference it directly.

## Why This Is Not Drift

This keeps decision `053` intact: these are still distinct resource kinds with
typed specs and API surfaces. The shared table is an implementation detail for
the first persisted shell slice.

## Dogfood Flow

The factory can now record the resources that generated prompts reference:

- workflow profiles for Edictum workflow files.
- model resources separate from agents.
- harness resources separate from models.
- sandbox profiles separate from harnesses.
- notification channels separate from global Telegram settings.

## Non-Goals

- No runtime harness rewrite.
- No model routing migration.
- No sandbox driver execution.
- No notification backend dispatch migration.
- No second policy system.
