# P5 - Podman Agent Execution

## Decision Trace

- D056: sandboxing is a first-class resource and must not be buried in harness
  details.
- D172 shipped a real Podman driver but recorded the caveat: no harness adapter
  reads `spawnOptions.sandbox`, so agent side effects still run on the host.
- Operator decision for unattended: this is a blocker before claiming unattended
  operation.

## Behavior Contract

- [ ] Runtime must execute agent side effects inside the prepared Podman
  container when the sandbox spec selects Podman; evidence: env-gated real
  Podman integration.
- [ ] Teardown must remove/stop any long-lived container and leave no leaked
  container after success, failure, cancel, or crash; evidence: tests and
  integration count before/after.
- [ ] Unsupported claims must continue to fail closed; evidence: existing
  sandbox tests remain green.
- [ ] FAILS if evidence conflates host, prepared-container-only, and
  agent-contained modes; evidence: API/CLI/dashboard contract tests.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/podman-sandbox-driver.test.ts src/tests/podman-sandbox-integration.test.ts
pnpm -C packages/harness build
pnpm -C packages/harness exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
git diff --check
```

If Podman is available, run the env-gated integration with the local Podman
binary and report whether it actually ran or skipped. Skipped integration is not
a pass.

## Drift Handling

Record a decision before adding a new container image dependency, dynamic plugin
loader, remote sandbox mode, or secret-mount behavior.

## Slop Review

- [ ] Attack explicit evidence: prove the agent command runs inside the container,
  not only that a probe container ran.
- [ ] Attack runtime behavior: success, failure, cancel, timeout, and process crash must
  not leak containers or worktrees.
- [ ] Attack runtime behavior: scoped env and `--network none` must match the
  reported boundary.

## Objective

Route real agent execution through Podman for Podman sandbox profiles and make
teardown reliable enough for unattended operation.

## Read first

- `decisions/172-podman-container-sandbox-driver.md`
- `packages/core/src/podman-sandbox-driver.ts`
- `packages/core/src/sandbox-runtime.ts`
- `packages/core/src/dispatcher-spawn.ts`
- `packages/harness/src/claude*.ts`
- `packages/harness/src/codex*.ts`
- `packages/core/src/tests/podman-sandbox-driver.test.ts`
- `packages/core/src/tests/podman-sandbox-integration.test.ts`

## Allowed Scope

- Sandbox runtime prepared-handle shape, harness spawn options, container
  lifecycle/teardown wiring, tests, and honest UI/API/CLI evidence.

## Non-goals

- Do not build Docker, remote, microVM, or dynamic plugin loading.
- Do not claim CPU/memory resource isolation unless enforced.
- Do not weaken host sandbox behavior.
- Do not expose unscoped host environment into the container.

## Implementation Notes

- D172 intentionally used ephemeral verification because teardown was not wired.
  This task may make Podman long-lived only if teardown is wired through every
  session end path.
- Prefer the narrowest first supported harness path, but fail closed for Podman
  specs on unsupported harnesses rather than silently falling back to host.
- Include a test that writes a marker from inside the container and proves the
  host process path did not perform the side effect.

## Acceptance Criteria

- A Podman sandboxed attempt runs the agent command in the container.
- Teardown runs on success, failure, cancel, timeout, and stale lease cleanup.
- Boundary evidence is truthful and operator-readable.
- Normal host mode still works.

## Stop Conditions

- Required base image/tooling is undecided.
- The implementation would leak containers on known paths.
- The implementation would silently fall back to host while reporting Podman.
