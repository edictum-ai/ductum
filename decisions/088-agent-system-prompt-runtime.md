# 088 - Agent System Prompt Runtime

## Status

Accepted

## Context

Decision `053` defines an Agent as a configured worker over model, harness,
persona, system prompt, tools, sandbox, and policy. Decisions `065` and `085`
let Agents store `resourceRefs.systemPromptRef`, but that ref is currently only
metadata. Dispatcher still sends the generic Ductum task prompt to every
harness session.

That leaves an Agent migration gap: a resource-backed agent can claim a persona
prompt while runtime ignores it.

## Decision

Make `Agent.resourceRefs.systemPromptRef` runtime-active for local prompt files:

- `systemPromptRef` resolves after dispatcher selects the run working directory
  and before harness adapter spawn.
- The ref must be a safe relative path under the resolved working directory.
- Missing, empty, absolute, traversal, directory, or unreadable prompt refs fail
  loudly before harness session creation.
- The resolved prompt text is prepended to the existing Ductum dispatcher prompt
  so Ductum workflow guardrails remain in the spawned system prompt.
- The prompt resolution is recorded as run Evidence with ref, absolute path,
  byte count, and SHA-256 hash. The prompt body is not stored in evidence.
- Agents without `systemPromptRef` keep existing prompt behavior exactly.
- `toolsRef` and `policyRef` remain stored metadata in this slice. Edictum
  remains the policy system and `gate_check` remains the agent-visible policy
  path.
- No new resource kind, table, dependency, prompt marketplace, tool registry, or
  policy path is added.

## Why This Is Not Drift

This advances the Agent resource model from decision `053` without changing the
policy boundary or adding a second Agent primitive. The runtime source is the
existing Agent row plus its stored refs; the audit surface is existing Evidence.

## Non-Goals

- No `Prompt` or `Toolset` resource kind.
- No `toolsRef` runtime wiring.
- No `policyRef` runtime enforcement.
- No second policy system or Edictum change.
- No MCP tool surface change.
- No new top-level primitive or table.
- No new dependency.
