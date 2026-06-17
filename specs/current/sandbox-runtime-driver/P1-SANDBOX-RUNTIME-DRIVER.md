# P1 - Sandbox Runtime Driver

## Scope

Wire `SandboxProfile(provider=host, mode=worktree)` into dispatcher runtime
execution. Preserve existing legacy behavior when no sandbox ref is configured.

## Decision Trace

- Decisions: `053`, `056`, `057`, `058`, `059`, `060`, `064`, `065`, `066`,
  `067`, `077`, `078`, `080`, `081`.
- Non-goals: no Docker/Podman/isolated/remote driver; no network isolation; no
  credential vault; no resource-limit enforcement; no second policy system; no
  Edictum policy change; no marketplace or plugin abstraction; no Operation or
  WorkOrder table; no new top-level primitive/table; no new dependency.
- Allowed scope: core sandbox runtime validation, host/worktree preparation,
  spawn option metadata, run evidence, behavioral tests, dogfood records, and
  existing operator-visible dispatch failures.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding Docker/Podman/remote
  execution, network isolation, credential exposure, resource limits, a new
  table, a new dependency, or an Edictum policy change.

## Behavior Contract

- An agent with a valid `host/worktree` `sandboxRef` must dispatch through the
  referenced SandboxProfile runtime.
- The sandbox runtime must prepare or reuse a Ductum-managed worktree before
  adapter spawn.
- Harness spawn runtime options must include resolved sandbox metadata.
- Run evidence for the prepared sandbox runtime must be visible before adapter
  spawn.
- A configured bad sandbox runtime must fail loudly and must never silently fall
  back to legacy working-directory behavior.
- Unsupported sandbox resource providers or modes must fail loudly before
  harness session creation.
- Unsupported sandbox runtime filesystem claims must fail loudly, including
  read-only worktrees and extra mounts.
- Unsupported sandbox runtime network restrictions must fail loudly because the
  host/worktree driver does not enforce network isolation.
- Unsupported sandbox runtime credential exposure must fail loudly because this
  slice has no credential vault or mount path.
- Unsupported sandbox runtime resource or process limits must fail loudly
  because this slice does not enforce CPU, memory, or process limits.
- Agents without `sandboxRef` must preserve existing legacy dispatch behavior.
- Dispatcher runtime behavior must preserve dispatcher-only creation of
  session-to-run mappings.
- This slice must not implement a fake Docker/Podman/remote runtime branch.
- This slice must not change Edictum policy enforcement or add a second policy
  system.
- Tests must prove dispatch, failure, evidence, and no-fallback behavior, not
  only schema shape.

## Implementation Notes

- Reuse `resolveAgentRuntimeDetails`; do not add a second sandbox ref lookup
  path.
- Add a small core sandbox runtime module that validates and prepares only
  `host/worktree`.
- For configured sandbox refs, fail loudly when a worktree manager, repo path,
  git repo, or new worktree cannot be prepared.
- For legacy agents without `sandboxRef`, leave existing dispatcher worktree
  behavior intact.
- Pass prepared sandbox metadata to `SpawnOptions`.
- Record prepared sandbox metadata as existing run evidence before adapter
  spawn.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did configured bad sandbox runtimes fail before harness session creation?
- Did any path silently fall back to legacy working-dir behavior after a bad
  `sandboxRef`?
- Did the implementation duplicate sandbox ref lookup logic?
- Did it add fake Docker, Podman, isolated, or remote branches?
- Did it pretend to enforce network, credentials, read-only filesystem,
  resources, or process limits?
- Did it preserve legacy no-ref behavior?
- Is prepared sandbox evidence visible before adapter spawn?

## Verification

```sh
ductum spec contract-check ductum specs/current/sandbox-runtime-driver --path
ductum spec drift-review ductum sandbox-runtime-driver
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```
