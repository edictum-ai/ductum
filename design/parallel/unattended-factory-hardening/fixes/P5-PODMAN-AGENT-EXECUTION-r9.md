# Fix P5 - Fail Normal Completion On Teardown Failure

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P5-PODMAN-AGENT-EXECUTION`

Authorized internal work. Do not push.

## Required Branch Setup

This repair must build on the latest P5 repair branch, not plain `main`.

Before editing source files, verify:

```sh
git merge-base --is-ancestor f3be284f HEAD
```

The command must exit 0. If it exits non-zero, stop and report that branch setup
is missing. Do not create `.git-local`, do not reset the branch, and do not try
to bypass worktree git metadata. The orchestrator is responsible for pre-merging
`ductum/fix-P5-PODMAN-AGENT-EXECUTION-r8-DR8XtG` before implementation starts.

## Read First

- `design/parallel/unattended-factory-hardening/P5-PODMAN-AGENT-EXECUTION.md`
- `design/parallel/unattended-factory-hardening/fixes/P5-PODMAN-AGENT-EXECUTION-r8.md`
- `packages/core/src/dispatcher-session.ts`
- `packages/core/src/dispatcher-spawn.ts`
- `packages/core/src/dispatcher-release-session.ts`
- `packages/core/src/podman-sandbox-driver.ts`
- `packages/core/src/tests/podman-sandbox-teardown-leaks.test.ts`
- `packages/core/src/tests/sandbox-execution-evidence.test.ts`

## Review Finding

The r8 review failed with this blocking finding:

> `packages/core/src/dispatcher-session.ts:69-136` and
> `packages/core/src/dispatcher-spawn.ts:287-295`: `handleSessionEnd` deletes
> the active session, performs completion routing, adds `handledSessionEnds`,
> and only then calls `releaseSession`; if Podman teardown throws, the
> `waitForCompletion` promise catch logs it as a session crash and calls
> `handleSessionEnd` again, which immediately returns because
> `handledSessionEnds` is already set. The run can therefore remain
> successfully routed/completed with no durable cleanup-failure record and no
> active session left to retry, so the normal release path still effectively
> turns teardown failure into transient log-only success from the operator
> perspective.

## Task

Make normal dispatcher completion fail or durably surface cleanup failure before
the run is routed as successful.

Required behavior:

- A Podman teardown failure during normal completion must not allow the run to
  be marked as a clean success.
- Do not add the session to `handledSessionEnds` before teardown failure has
  been handled in a way that prevents silent success.
- Do not delete the only active session state before the failure path can record
  a durable operator-visible failure.
- Completion routing must happen only after release has either succeeded or the
  failure has been recorded as a cleanup failure that blocks approval/merge.
- Preserve existing success behavior for host mode and successful Podman
  teardown.
- Preserve the r8 behavior that direct `releaseSession` calls surface Podman
  teardown failure.

Use the smallest dispatcher change that makes the ordering honest. Do not
rewrite the dispatcher lifecycle.

## Tests

Add or update focused tests that fail before the fix and pass after:

- normal `handleSessionEnd`/completion does not route a run as done or pending
  approval when Podman teardown throws
- the teardown failure remains visible after the completion promise catch path
  runs; a second `handleSessionEnd` must not hide it behind `handledSessionEnds`
- successful Podman release still routes normally and clears active session state
- host-mode release remains unchanged
- existing Podman teardown leak and sandbox evidence tests remain green

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
