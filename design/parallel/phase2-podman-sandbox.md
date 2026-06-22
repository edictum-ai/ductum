# Worker brief - phase2 real Podman sandbox driver

Repo worktree: `/Users/acartagena/project/dn-p2-podman-sandbox`
Branch: `stream/p2-podman-sandbox`
Suggested model: GLM 5.2 for implementation, GPT 5.5 for review
Migration reserved: none expected

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/03-execution-harness-extensible.md`
- `design/ORCHESTRATOR-HANDOFF.md`, "What's NOT done yet"
- `packages/core/src/sandbox-driver.ts`
- `packages/core/src/sandbox-runtime.ts`
- `packages/core/src/dispatcher-spawn.ts`
- existing sandbox tests under `packages/core/src/tests/` and `packages/api/src/tests/`

## Problem

The SandboxDriver seam exists and the host driver is wired. Phase 2 needs the next
real driver: Podman, preferred because it can be rootless and daemonless. The driver
must prove the seam without weakening the current host behavior or over-claiming
isolation.

## Task

Add a real Podman container sandbox driver behind the existing SandboxDriver surface.

Expected shape:

- Support a `container` spec with `provider: 'podman'` and `mode: 'container'`.
- Keep host behavior unchanged.
- Do not edit dispatcher core except for the narrow wiring needed to select the driver.
- Do not add a dynamic plugin loader.
- Do not claim stronger isolation than the driver actually enforces.
- Mount the worktree intentionally and document/read back the boundary descriptor.
- Fail closed when Podman is unavailable, the image is missing, or unsupported claims
  are requested.
- Prefer no new npm dependency. Use Node standard process APIs if possible.

## Tests

Add focused tests for:

- Podman spec selects the Podman driver
- unsupported Docker/remote specs still fail honestly unless intentionally supported
- boundary descriptor is truthful
- missing Podman or rejected claim produces a clear preflight/runtime error
- host sandbox tests remain green

If an integration test would require real Podman on the machine, gate it behind an
explicit environment variable and keep the normal suite deterministic.

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

If real Podman is installed and the integration env var is enabled, also report that
smoke output separately. Do not describe skipped Podman integration as passed.

Commit locally on `stream/p2-podman-sandbox`. Conventional commit subject. No AI
attribution. Do not push.

