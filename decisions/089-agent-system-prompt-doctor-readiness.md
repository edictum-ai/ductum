# 089 - Agent System Prompt Doctor Readiness

## Status

Accepted

## Context

Decision `088` makes `Agent.resourceRefs.systemPromptRef` runtime-active. A bad
prompt ref now fails before harness session creation, but `ductum doctor` does
not report that readiness problem. Operators can still believe the factory is
ready until a run dispatches and stalls.

## Decision

Make `ductum doctor` validate configured `systemPromptRef` paths against the
settings document:

- Doctor reads Agent prompt refs from `agents.<name>.systemPromptRef` or
  `agents.<name>.resourceRefs.systemPromptRef`.
- For assigned agents, doctor resolves the prompt ref against each assigned
  project's first configured repo path.
- Resolution uses the core `systemPromptRef` runtime rules from decision `088`:
  safe relative path, realpath containment, file only, readable, non-empty.
- Valid prompt refs produce an `ok` readiness check with metadata only.
- Missing, absolute, traversal, directory, empty-file, symlink-escape, or
  unreadable prompt refs produce operator-visible failed readiness checks.
- Unassigned agents with a prompt ref produce a warning because no runtime
  working directory can be inferred yet.
- Agents without `systemPromptRef` keep existing doctor behavior.
- `toolsRef` and `policyRef` remain metadata-only and are not validated here.
- No new resource kind, table, dependency, policy path, marketplace, or prompt
  registry is added.

## Why This Is Not Drift

This is a readiness surface for decision `088`, not a new runtime path. The same
core resolver remains the behavior authority, and Ductum still does not enforce
policy from Agent refs.

## Non-Goals

- No `Prompt` or `Toolset` resource kind.
- No `toolsRef` runtime behavior.
- No `policyRef` runtime enforcement.
- No Edictum change or second policy system.
- No new dependency, top-level primitive, table, marketplace, or registry.
