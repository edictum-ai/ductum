# Sandbox Runtime Driver

## Intake

Make `SandboxProfile` runtime-active for the current Ductum dogfood path:
agents with `resourceRefs.sandboxRef` should run through the referenced
`host/worktree` sandbox profile instead of merely snapshotting it. This is not a
Docker, Podman, cloud, network-isolated, or credential-mounting sandbox slice.

## Grill Questions

- What is the first real driver? `provider: host` plus `mode: worktree`, because
  Ductum already owns per-run git worktree creation and that is the immediate
  dogfood isolation boundary.
- What must fail? Any configured sandbox ref that cannot be prepared must fail
  before harness session creation and must not fall back to legacy behavior.
- What is unsupported? Docker, Podman, isolated/remote providers, read-only
  worktrees, extra mounts, network restrictions, credential exposure, resource
  limits, and process constraints.
- Where is audit visibility? Existing run state keeps the redacted
  `runtimeSandboxProfile` snapshot, and existing Evidence records the prepared
  sandbox runtime before adapter spawn.
- Does this change policy? No. Edictum remains the policy system; Ductum
  prepares a filesystem runtime boundary and records what happened.

## Decisions

- Add decision `081` for the first `SandboxDriver` runtime slice.
- Support only `host/worktree` with Ductum-managed writable git worktrees.
- Treat unsupported sandbox claims as loud failures, not advisory metadata.
- Pass resolved sandbox runtime metadata into harness spawn options so adapters
  have a single runtime source.
- Record prepared sandbox evidence before adapter spawn using existing
  `Evidence` records.
- Preserve legacy worktree behavior when an agent has no `sandboxRef`.

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
- Verification: `ductum spec contract-check ductum specs/current/sandbox-runtime-driver --path`,
  `ductum spec drift-review ductum sandbox-runtime-driver`, package tests,
  build, `git diff --check`, and Claude adversarial slop review.
- Drift handling: record a decision before adding Docker/Podman/remote
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-SANDBOX-RUNTIME-DRIVER.md](P1-SANDBOX-RUNTIME-DRIVER.md) | core | Host/worktree sandbox driver, dispatch wiring, audit evidence, behavioral tests, dogfood | [x] | - |

## Dogfood Record

- Imported as spec `sandbox-runtime-driver` (`tWAg6hebc9TG`) in project
  `ductum`.
- Task `P1-SANDBOX-RUNTIME-DRIVER` imported as `pbXCfXfOJUZF`, assigned to
  `codex-resource-dogfood`, and accepted as run `T1U7dU4Gv5v7`.
- Recorded decision evidence: `ryEmAH_t7B-r` for decision `081`.
- Recorded spec audit evidence: `spefijn22JhJ`.
- Recorded final verification evidence: `2Maj9NQSUf9p`.
- Recorded final Claude slop review evidence: `SvJ3qLJ5SqTF` with `PASS`.

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
