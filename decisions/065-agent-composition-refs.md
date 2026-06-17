# 065 - Agent Composition References

## Status

Accepted

## Context

Decision `053` defines `Agent` as a configured worker over model, harness,
system prompt, tools, sandbox, and policy. Ductum already has an `agents` table
that dispatch uses directly through `model` and `harness`.

Adding a second Agent resource table would split runtime identity. Replacing
runtime `model` and `harness` immediately would also touch dispatcher and
harness behavior in the same slice.

## Decision

Keep the existing `agents` row as the authoritative runtime agent and add
composition references to it.

- Add `resourceRefs` JSON on `Agent`.
- Store refs for `modelRef`, `harnessRef`, `workflowProfileRef`, `sandboxRef`,
  `systemPromptRef`, `toolsRef`, and `policyRef`.
- Keep existing `model` and `harness` fields as trusted dispatch fields.
- Let declarative `Agent` manifests resolve `modelRef` and `harnessRef` into
  runtime `model` and `harness` when the referenced resources are available.
- Do not enforce policy from these refs inside Ductum; Edictum remains the
  policy engine.

## Why This Is Not Drift

This implements the Agent direction from decision `053` without introducing a
parallel Agent primitive or moving enforcement into Ductum. References explain
composition; runtime dispatch still uses the existing tested path.

## Non-Goals

- No second policy engine.
- No dispatcher session binding changes.
- No sandbox runtime driver.
- No removal of current `model` and `harness` fields.
- No new dependency.
