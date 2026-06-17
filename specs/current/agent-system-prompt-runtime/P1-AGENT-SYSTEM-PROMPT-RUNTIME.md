# P1 - Agent System Prompt Runtime

Implement the narrow runtime slice for `Agent.resourceRefs.systemPromptRef`.

## Decision Trace

- Decisions: `053`, `054`, `058`, `059`, `060`, `064`, `065`, `066`, `067`,
  `070`, `080`, `081`, `082`, `083`, `084`, `085`, `088`.
- Non-goals: no new `Prompt` or `Toolset` resource kind; no `toolsRef` runtime;
  no `policyRef` enforcement; no Edictum change; no second policy system; no
  new top-level primitive/table; no dependency; no marketplace or plugin
  abstraction.
- Allowed scope: core prompt-file resolver, dispatcher prompt composition,
  evidence recording, behavioral tests, dogfood records, and docs.
- Drift handling: record a decision before adding prompt resource kinds, tool
  resource semantics, policy enforcement, a prompt registry, a new table, or a
  new dependency.

## Behavior Contract

- An agent with a valid `systemPromptRef` must spawn with the referenced prompt
  content included in the harness system prompt.
- The existing Ductum dispatcher workflow instructions must be preserved in the
  composed system prompt.
- `systemPromptRef` must resolve relative to the selected run working directory
  or sandbox worktree.
- Empty, absolute, traversal, missing-file, directory, unreadable, or empty-file
  `systemPromptRef` values must fail loudly before harness session creation.
- An Agent with a bad configured `systemPromptRef` must never silently fall back to the generic
  dispatcher prompt.
- Agents without `systemPromptRef` must preserve existing runtime prompt behavior.
- Prompt resolution evidence must be visible before adapter spawn.
- Prompt evidence must not store the prompt body.
- Dispatcher must preserve dispatcher-only creation of session-to-run mappings.
- Agent `policyRef` must preserve metadata-only runtime behavior in this slice; Edictum remains the policy
  system.
- Agent `toolsRef` must preserve metadata-only runtime behavior in this slice; no fake tool registry is added.
- Tests must prove behavior, not only schema shape.

## Implementation Notes

- Add a small core helper rather than growing dispatcher with file-path
  parsing. Keep the helper dependency-free.
- Resolve prompt refs after sandbox/legacy worktree selection has determined the
  working directory and before adapter spawn.
- Compose as Agent prompt first, then the existing Ductum dispatcher prompt.
- Record evidence before adapter spawn. Store metadata only: ref, resolved path,
  bytes, and SHA-256 hash.
- Keep legacy `buildSystemPrompt` callback behavior for agents without
  `systemPromptRef`.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did bad prompt refs produce a loud failure before session creation?
- Did any path swallow errors or silently fall back after a configured bad `systemPromptRef`?
- Did the implementation preserve Ductum workflow guardrails in the composed
  prompt?
- Did it read prompt files only from the selected working directory?
- Did evidence avoid storing prompt body text?
- Did it add a fake abstraction, dead config branch, or future features for `toolsRef` or `policyRef` runtime behavior?
- Did it preserve legacy no-ref prompt behavior?

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-system-prompt-runtime --path
ductum spec drift-review ductum agent-system-prompt-runtime
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
