# 074 - Agent API Ref Scope Stays Factory Scoped

## Status

Accepted

## Context

Agent resources are currently factory-level records. Dispatcher runtime has a
task spec and can resolve `modelRef`/`harnessRef` against that spec's project,
but global Agent API and settings sync do not have a single run project.

## Decision

Global Agent API and settings validation resolve and snapshot factory-scoped
`Model` and `Harness` refs only. Project-scoped config resources remain valid
runtime refs when dispatcher resolves them for a task in that project.

Adding project-bound Agent create/update endpoints, or per-project Agent
bindings that validate project-scoped refs before dispatch, needs a separate
decision.

## Why This Is Not Drift

This keeps session-to-run binding authoritative at dispatch time and avoids
guessing a project in factory-level Agent operations.

## Non-Goals

- No new Agent table.
- No project-bound Agent API in this slice.
- No Operation or WorkOrder table.
