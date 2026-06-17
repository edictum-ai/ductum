# P1 - Agent System Prompt Doctor Readiness

Implement doctor readiness checks for runtime-active Agent `systemPromptRef`.

## Decision Trace

- Decisions: `053`, `058`, `059`, `060`, `064`, `065`, `066`, `085`, `088`,
  `089`.
- Non-goals: no `Prompt`/`Toolset` resource kind; no `toolsRef` runtime; no
  `policyRef` enforcement; no Edictum change; no second policy system; no new
  dependency, table, top-level primitive, marketplace, or registry.
- Allowed scope: CLI doctor readiness helper, CLI tests, spec records,
  evidence, and docs.
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

## Implementation Notes

- Add a small CLI helper for Agent prompt readiness rather than growing
  `doctor-checks.ts` heavily.
- Import the core resolver from `@ductum/core` so doctor does not fork path
  validation.
- Derive project assignments and repo paths from the settings config document.
- Use metadata-only output: ref, agent, project, repo root, bytes/hash if useful.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did doctor use the existing resolution logic instead of duplicate resolution logic?
- Did missing or invalid inputs produce loud failures?
- Did any path swallow errors or silently report a bad prompt ref as ready?
- Did doctor avoid storing or printing prompt body text?
- Did it add a fake abstraction, dead config branch, or future features for
  `toolsRef`/`policyRef`?
- Did it preserve legacy no-ref doctor behavior?

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-system-prompt-doctor-readiness --path
ductum spec drift-review ductum agent-system-prompt-doctor-readiness
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
