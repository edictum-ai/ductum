# D172: Podman container sandbox driver (phase2)

**Date:** 2026-06-18
**Decided by:** Arnold + Claude (GLM-5.2)
**Linked:** `design/parallel/phase2-podman-sandbox.md`, `design/03-execution-harness-extensible.md` (S5/S6), D056 (sandbox resource model)

## Context

Phase 2 of the sandbox ladder needs the first non-host `SandboxDriver`:
Podman (rootless, daemonless). The `SandboxDriver` seam
(`prepare` / `boundary` / `teardown`) and the `ContainerSandboxSpec` type
(`provider: 'podman'`) already existed, but `parseSandboxSpec` threw for
`kind: 'container'` and `sandbox-runtime.ts` was hardwired to
`HostSandboxDriver`. No container driver existed.

Two facts shaped the design and must not be forgotten:

1. **The dispatcher never calls `SandboxDriver.teardown()` today.** Host's
   `teardown` is a no-op; worktree cleanup happens elsewhere
   (`dispatcher-worktree-cleanup`). A long-lived container started in
   `prepare` would therefore leak on a long-running dispatcher.
2. **No harness adapter reads `spawnOptions.sandbox`.** Every adapter
   (claude/codex/copilot/opencode) spawns the agent on the host using only
   `workingDir`/`env`. So the agent process is not yet contained by any
   container the driver prepares.

## Decision

Ship a real `PodmanSandboxDriver` (`packages/core/src/podman-sandbox-driver.ts`)
selected through the existing seam, with this shape:

- **Selection** is the only dispatcher-adjacent edit: `sandbox-runtime.ts`
  dispatches on `spec.kind` / `spec.provider` (host vs podman).
  `parseSandboxSpec` routes `container` → `parseContainerSandboxSpec`
  (provider `podman` only; docker/local/remote still fail honestly with
  `unsupported sandbox runtime <provider>/<mode>`). `dispatcher-spawn.ts` and
  the rest of dispatcher core are untouched.
- **Fail-closed preflight/runtime** in `prepare`: throws a clear
  `resource_malformed` error when the podman binary is missing, the engine is
  unreachable, the image is absent, or the live container cannot mount/verify
  the worktree. Unsupported claims (`resources`, `network: egress-allowlist`,
  `network.allowlist`, `process.user`, `filesystem.worktree: readOnly`,
  `credentials.mode` other than `scoped`) are rejected at parse time.
- **Truthful boundary** (`podmanBoundary`): `{ filesystem:'worktree-readWrite',
  network:'none', credentials:'scoped', resources:'none', process:'namespaced' }`.
  Every field reflects a property the driver actually enforces on the prepared
  container (bind-mount writable, `--network none`, PID namespace, scoped
  credentials via the broker, no cpu/memory cap).
- **Ephemeral envelope verification, not a kept-alive container.** Because of
  fact (1), `prepare` proves the isolation envelope is real and enforceable by
  running a short-lived `podman run --rm --network none -v <worktree>:/ductum/worktree
  <image> sh -c '<writable-mount probe>'` that exits and is auto-removed. No
  long-lived container, no leak, `teardown` is a no-op satisfying the contract.
- **No new npm dependency.** Uses `node:child_process` `spawnSync`. The podman
  binary path is configurable via `DUCTUM_PODMAN_COMMAND` (a control-plane
  config var, not an agent secret — does not touch the scoped-secret broker).

## Honest boundary (the caveat)

The boundary descriptor describes the **prepared container's** enforced
isolation, not the agent process's runtime. Because of fact (2), until a
harness adapter routes the agent through `podman exec`, the agent executes on
the host and the container's network/process isolation is not yet applied to
the agent's own side effects. The driver verifies the envelope is real; routing
the agent into it is the next stream (matches `design/03` S6 staging).

This is recorded deliberately rather than papered over: the descriptor never
claims a stronger sandbox tier than the flags actually provide, and the
follow-up is named, not hidden.

## Alternatives considered

- **Long-lived container + wire teardown into the dispatcher session-end.**
  Rejected for this phase: touches moat-adjacent dispatcher core beyond
  "select the driver" and would leak until that wiring lands.
- **Preflight-only driver (no real container).** Rejected: would not prove the
  seam with a second real driver and could not truthfully report a container
  boundary.
- **Full agent containment now (adapter `podman exec` + image with agent
  installed).** Out of scope for the driver brief; tracked as the follow-up.

## Verification

`pnpm -C packages/core build`, core vitest (723 passed, integration skipped),
`pnpm -C packages/api build`, api vitest (419 passed), `node scripts/check-file-size.mjs`
(pass). Real-Podman integration smoke
(`DUCTUM_PODMAN_INTEGRATION=1 DUCTUM_PODMAN_COMMAND=/opt/podman/bin/podman
DUCTUM_PODMAN_TEST_IMAGE=busybox:latest`): 3/3 passed, container count
unchanged before/after (no leak).

## Follow-ups (flagged)

1. Route the agent process into the prepared container (harness adapter reads
   `spawnOptions.sandbox` and launches via `podman exec`), then make
   `prepare` keep the container alive and wire `teardown` into the dispatcher
   session-end. Until then the boundary describes the prepared container, not
   the agent's runtime.
2. Surface the container tier in the dashboard (register a renderer for
   `runtime.sandbox.prepared`; today it renders as a JSON blob).
