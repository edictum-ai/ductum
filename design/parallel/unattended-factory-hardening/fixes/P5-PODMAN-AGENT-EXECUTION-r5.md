# Fix P5 - Podman Teardown Leak Paths

Repo: `/Users/acartagena/project/ductum-next`
Spec: `unattended-factory-hardening`
Parent stream: `P5-PODMAN-AGENT-EXECUTION`
Branch/worktree: continue the existing P5 Ductum worktree/branch.

Authorized internal work. Do not push.

## Read first

- `design/parallel/unattended-factory-hardening/P5-PODMAN-AGENT-EXECUTION.md`
- `packages/core/src/podman-sandbox-driver.ts`
- `packages/core/src/tests/podman-sandbox-driver.test.ts`
- `packages/core/src/tests/sandbox-execution-evidence.test.ts`
- `packages/harness/src/codex-app-server-process.ts`
- `packages/harness/src/podman-exec.ts`
- `packages/harness/src/tests/codex-app-server-podman-env.test.ts`

## Problem

The r5 review found two real leak risks that block the unattended/no-leak
contract:

1. `packages/core/src/podman-sandbox-driver.ts` ignores `podman rm` failures in
   both normal teardown and stale cleanup. If `podman rm -f` fails or times out,
   Ductum can remove local runtime state and report cleanup complete while the
   long-lived container remains running.
2. `podman run -d` can create a labelled container but return nonzero, null, or
   empty stdout, for example on timeout after creation. The current catch path
   removes local runtime/worktree state but has no fallback cleanup by
   `ductum.run` label, so a prepared container can remain alive.

## Task

Fix the Podman teardown paths so Ductum does not silently claim cleanup while a
container can remain alive.

Required behavior:

- Normal release must check `podman rm -f` status. A removal failure must be
  surfaced through a clear error or durable cleanup failure signal; it must not
  be silently swallowed as success.
- Stale cleanup must also check removal status and report/log the failed
  cleanup distinctly.
- The `podman run -d` failure path must attempt best-effort cleanup by the
  `ductum.run=<runId>` label when a container may have been created but no
  container id was returned.
- Local runtime/worktree cleanup must not destroy the only local clue before the
  Podman cleanup result is known.
- Preserve the previous r4 fix: inherited/reused worktrees must not be deleted
  on envelope or container startup failure.

## Out of scope

- Do not redesign the sandbox profile model.
- Do not change host-mode behavior.
- Do not add Docker/remote/microVM support.
- Do not weaken `--network none` or scoped env behavior.
- Do not make fake claims in sandbox evidence.

## Tests

Add focused tests that fail before the fix and pass after:

- release reports/fails when `podman rm -f` fails
- stale cleanup reports/logs failed removal instead of pretending success
- failed `run -d` with an empty/nonzero result triggers label-based cleanup
- inherited/reused worktrees are still preserved on container startup failure

Keep tests deterministic without requiring real Podman unless the existing
env-gated integration variables are set.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run src/tests/podman-sandbox-driver.test.ts src/tests/sandbox-execution-evidence.test.ts
pnpm -C packages/harness build
pnpm -C packages/harness exec vitest run src/tests/codex-app-server-podman-env.test.ts src/tests/codex-app-server.test.ts
node scripts/check-file-size.mjs
git diff --check
```

If Podman is available, also run the env-gated Podman integration and report
whether it actually ran or skipped. Skipped integration is not proof for the
unattended claim.

Commit locally with a conventional commit subject and no attribution. Do not
push.
