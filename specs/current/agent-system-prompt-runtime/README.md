# Agent System Prompt Runtime

## Intake

Make `Agent.resourceRefs.systemPromptRef` meaningful at dispatch time. Ductum
already stores the ref, but runtime ignores it and spawns every agent with the
generic dispatcher prompt. The first useful slice is local prompt-file
resolution into the harness system prompt, with audit evidence and loud failure
for bad refs.

## Grill Questions

- What is the prompt source? A safe relative file path under the run working
  directory. This matches current manifest examples such as
  `prompts/agents/builder.md` without adding a new prompt resource kind.
- When should it resolve? After dispatcher has selected the run working
  directory or sandbox worktree, and before harness adapter spawn.
- How should it compose? The Agent prompt is prepended to the existing Ductum
  dispatcher prompt. Ductum workflow instructions must remain present.
- What should fail? Empty refs, absolute paths, traversal, missing files,
  directories, and unreadable files.
- What gets audited? Ref, absolute resolved path, byte count, and SHA-256 hash.
  Prompt content is intentionally not stored in evidence.
- Are `toolsRef` or `policyRef` in scope? No. They remain metadata until a
  separate decision records runtime semantics.

## Decisions

- Add decision `088` for `systemPromptRef` runtime.
- Resolve only local relative prompt files under the run working directory.
- Compose the resolved Agent prompt with the existing dispatcher prompt instead
  of replacing Ductum workflow guardrails.
- Fail loudly before harness session creation for bad configured refs.
- Record prompt resolution evidence using existing Evidence records.
- Preserve legacy prompt behavior when refs are absent.

## Decision Trace

- Decisions: `053`, `054`, `058`, `059`, `060`, `064`, `065`, `066`, `067`,
  `070`, `080`, `081`, `082`, `083`, `084`, `085`, `088`.
- Non-goals: no new `Prompt` or `Toolset` resource kind; no `toolsRef` runtime;
  no `policyRef` enforcement; no Edictum change; no second policy system; no
  new top-level primitive/table; no dependency; no marketplace or plugin
  abstraction.
- Allowed scope: core prompt-file resolver, dispatcher prompt composition,
  evidence recording, behavioral tests, dogfood records, and docs.
- Verification: `ductum spec contract-check ductum specs/current/agent-system-prompt-runtime --path`,
  `ductum spec drift-review ductum agent-system-prompt-runtime`, package tests,
  build, `git diff --check`, and Claude adversarial slop review.
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-AGENT-SYSTEM-PROMPT-RUNTIME.md](P1-AGENT-SYSTEM-PROMPT-RUNTIME.md) | core | Prompt ref resolution, dispatcher composition, audit evidence, behavioral tests, dogfood | [x] | - |

## Dogfood Record

- Imported as spec `agent-system-prompt-runtime` (`uMutNYpFV9PA`) in project
  `ductum`.
- Task `P1-AGENT-SYSTEM-PROMPT-RUNTIME` imported as `kGm1ez7GDgZi`, assigned
  to `codex-resource-dogfood`, and accepted as run `UdKEChgNn0BB`.
- Recorded decision `SMAVKnygPumo` for decision `088`.
- Recorded spec audit evidence: `I7J3qyRKfc97`.
- Recorded final verification evidence: `tjQ85oaAqke-`.
- Recorded adversarial review evidence: `gRv2pqSJ4pRy`. `claude -p` timed out
  with no stdout after 90 seconds; local slop review found and fixed a
  symlink-escape blocker, then passed.

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
