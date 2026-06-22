# Fix P5 - Surface Dispatcher Release Teardown Failures

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P5-PODMAN-AGENT-EXECUTION`

Authorized internal work. Do not push.

## Required Branch Setup

This repair must build on the latest P5 repair branch, not plain `main`.

Before editing source files, verify:

```sh
git merge-base --is-ancestor 2d81a0f6 HEAD
```

The command must exit 0. If it exits non-zero, stop and report that branch setup
is missing. Do not create `.git-local`, do not reset the branch, and do not try
to bypass worktree git metadata. The orchestrator is responsible for pre-merging
`ductum/fix-P5-PODMAN-AGENT-EXECUTION-r7-4YuITx` before implementation starts.

## Read First

- `design/parallel/unattended-factory-hardening/P5-PODMAN-AGENT-EXECUTION.md`
- `design/parallel/unattended-factory-hardening/fixes/P5-PODMAN-AGENT-EXECUTION-r5.md`
- `packages/core/src/dispatcher-release-session.ts`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/podman-sandbox-driver.ts`
- `packages/core/src/tests/podman-sandbox-driver.test.ts`
- `packages/core/src/tests/podman-sandbox-teardown-leaks.test.ts`
- `packages/core/src/tests/sandbox-execution-evidence.test.ts`

## Review Finding

The r7 review failed with this blocking finding:

> `packages/core/src/dispatcher-release-session.ts:11-15` marks the session
> released before teardown and catches `teardownSandboxRuntime` errors, only
> emitting a transient warning before closing the MCP server. Since
> `packages/core/src/podman-sandbox-driver.ts:137-145` now throws on
> `podman rm -f` failure, the normal release path still returns success and
> prevents retry, with no durable cleanup-failure signal. This does not satisfy
> the required normal-release behavior that removal failure be surfaced as an
> error or durable cleanup failure rather than success.

## Task

Make normal dispatcher release surface Podman teardown failures instead of
turning them into successful release.

Required behavior:

- `teardownSandboxRuntime` failure during normal release must not be silently
  swallowed as success.
- Do not mark a session released before teardown has either succeeded or been
  recorded as a durable cleanup failure.
- Operators must get a clear failure signal that can be retried or investigated.
- Closing the MCP server may still be best-effort, but it must not hide sandbox
  cleanup failure.
- Preserve existing success behavior for host mode and successful Podman
  teardown.

## Tests

Add or update focused tests that fail before the fix and pass after:

- normal release reports or fails when Podman teardown throws
- a teardown failure does not get recorded as a clean successful release
- successful release still closes the MCP server and clears session state
- the previous driver tests for `podman rm -f` failure and label cleanup remain
  green

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/podman-sandbox-driver.test.ts src/tests/podman-sandbox-teardown-leaks.test.ts src/tests/sandbox-execution-evidence.test.ts
pnpm -C packages/harness build
pnpm -C packages/harness exec vitest run src/tests/codex-app-server-podman-env.test.ts src/tests/codex-app-server.test.ts
node scripts/check-file-size.mjs
git diff --check
```

Commit locally with a conventional commit subject and no attribution. Do not
push.
