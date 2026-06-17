# Agent System Prompt Doctor Readiness

## Intake

Now that `systemPromptRef` is runtime-active, make `ductum doctor` catch bad
configured prompt refs before an operator dispatches a run. This is a readiness
slice only; runtime behavior remains owned by decision `088`.

## Grill Questions

- What should doctor check? Agent `systemPromptRef` fields in settings YAML.
- Which root should it use? The first repo path for each project that assigns
  the agent, matching dispatcher fallback for repo-less tasks.
- What rules should it use? The core prompt resolver from decision `088`.
- What should be visible? Valid prompt metadata only; failures with the agent,
  project, ref, and fix hint.
- What remains out of scope? `toolsRef`, `policyRef`, prompt resource kinds,
  tool registries, and policy enforcement.

## Decisions

- Add decision `089` for doctor readiness of Agent system prompts.
- Use the existing core prompt resolver instead of duplicating path logic.
- Emit failed readiness checks for bad assigned-agent prompt refs.
- Emit warnings for unassigned agents with prompt refs.
- Preserve existing doctor behavior for agents without prompt refs.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `065`, `066`, `085`, `088`,
  `089`.
- Non-goals: no `Prompt`/`Toolset` resource kind; no `toolsRef` runtime; no
  `policyRef` enforcement; no Edictum change; no second policy system; no new
  dependency, table, top-level primitive, marketplace, or registry.
- Allowed scope: CLI doctor readiness helper, CLI tests, spec records,
  evidence, and docs.
- Verification: `ductum spec contract-check ductum specs/current/agent-system-prompt-doctor-readiness --path`,
  `ductum spec drift-review ductum agent-system-prompt-doctor-readiness`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  adversarial slop review.
- Drift handling: record a decision before adding prompt resources, tool
  runtime semantics, policy enforcement, a registry, a new table, or a new
  dependency.

## Behavior Contract

- `ductum doctor` must resolve valid assigned-agent `systemPromptRef` values and
  report an `ok` readiness check.
- Doctor prompt checks must use the same runtime resolver rules as dispatcher.
- Doctor prompt checks must not print or store prompt body text.
- Missing prompt files must fail loudly in doctor output.
- Absolute, traversal, directory, empty-file, symlink-escape, or unreadable
  prompt refs must fail loudly in doctor output.
- An assigned agent with a bad `systemPromptRef` must not be silently reported
  as ready.
- An unassigned agent with a `systemPromptRef` must produce a visible warning
  instead of a false readiness pass.
- Agents without `systemPromptRef` must preserve existing doctor behavior.
- `toolsRef` must preserve metadata-only runtime behavior in this slice.
- `policyRef` must preserve metadata-only runtime behavior in this slice.
- This slice must not add a new policy path, resource kind, table, dependency,
  marketplace, or registry.
- Tests must prove behavior, not only schema shape.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did doctor use the existing resolution logic instead of duplicate resolution logic?
- Did missing or invalid inputs produce loud failures?
- Did any path swallow errors or silently report a bad prompt ref as ready?
- Did doctor avoid storing or printing prompt body text?
- Did it add a fake abstraction, dead config branch, or future features for
  `toolsRef`/`policyRef`?
- Did it preserve legacy no-ref doctor behavior?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-AGENT-SYSTEM-PROMPT-DOCTOR-READINESS.md](P1-AGENT-SYSTEM-PROMPT-DOCTOR-READINESS.md) | cli | Doctor checks and tests for Agent system prompt refs | [x] | - |

## Dogfood Record

- Imported as spec `agent-system-prompt-doctor-readiness` (`ki0xtr63NdI5`) in
  project `ductum`.
- Task `P1-AGENT-SYSTEM-PROMPT-DOCTOR-READINESS` imported as `7UVhLxBIlxJh`,
  assigned to `codex-resource-dogfood`, and accepted as run `h9VWzz2r_60U`.
- Recorded decision `1VUsqwoePOHo` for decision `089`.
- Recorded spec audit evidence: `I1mXAHeuuNnA`.
- Recorded final verification evidence: `KRj2Qooe9YXR`.
- Recorded adversarial review evidence: `kHtyEUnj0JXk`. `claude -p` timed out
  with no stdout after 90 seconds; local slop review passed.

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-system-prompt-doctor-readiness --path
ductum spec drift-review ductum agent-system-prompt-doctor-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
