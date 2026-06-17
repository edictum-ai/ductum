# P2 Implementation Decision — D31

**Date:** 2026-04-05
**Scope:** Repo profile resolution in API bootstrap / enforcement

## Context

P2 says the API process should build a `Map<ProjectId, WorkflowDefinition>`.

That does not work at bootstrap time in the current architecture:

- `packages/api/src/index.ts` initializes enforcement before `scripts/serve.mjs` seeds projects
- project IDs only exist after that seed pass completes
- `ductum.yaml` names projects, not project IDs

There is a second ambiguity in the same area:

- `workflow.profile` is defined once per project in `ductum.yaml`
- some projects can list multiple repos
- a relative profile path therefore needs a deterministic repo root

## Decision

Use project names, not project IDs, for the bootstrap profile map.

- `scripts/serve.mjs` passes `DUCTUM_WORKFLOW_PROFILES` as `projectName:absoluteProfilePath`
- the API process renders workflows into `Map<string, WorkflowDefinition>`
- `EnforcementManager` resolves `run -> task -> spec -> project.name` at runtime

For relative `workflow.profile` paths, resolve them against the first repo entry with a filesystem `path`.

## Why

This keeps P2 compatible with the existing process boundary and seed order without adding a second config store or reordering server startup.
