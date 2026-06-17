# 081 - Sandbox Runtime Driver

## Status

Accepted

## Context

Decision `077` made `Agent.resourceRefs.sandboxRef` a dispatch-time preflight
and audit boundary, but intentionally left execution behavior unchanged.
Decision `056` makes sandboxing a first-class resource, and decision `057`
names `SandboxDriver` as the runtime seam. The remaining slop gap is that a
valid `SandboxProfile` can still be true only on paper.

Ductum already has a Ductum-managed git worktree path that provides the local
filesystem isolation needed for current dogfood builder tasks. The next useful
runtime step is to make `SandboxProfile(provider=host, mode=worktree)` own that
worktree setup path instead of treating it as unrelated legacy dispatcher
config.

## Decision

Add the first real, narrow `SandboxDriver` behavior for `host/worktree`:

- `host/worktree` is the only supported sandbox runtime in this slice.
- A valid `host/worktree` profile prepares a Ductum-managed git worktree or
  reuses the parent run worktree before harness adapter spawn.
- The resolved sandbox runtime metadata is passed to the harness spawn options
  and recorded as run evidence before the adapter spawn call.
- If a configured sandbox cannot be prepared, dispatch fails before harness
  session creation and does not fall back to legacy working-directory behavior.
- Unsupported providers or modes, including `docker`, `podman`, `isolated`, or
  unknown values, fail loudly in this slice.
- Unsupported host/worktree claims fail loudly instead of being treated as
  advisory config: read-only worktrees, extra mounts, network restrictions,
  credential exposure, resource limits, and process constraints are not
  implemented by the host/worktree driver.
- Agents without `sandboxRef` keep existing legacy dispatcher worktree behavior.
- No new run table, resource status table, top-level primitive, dependency,
  credential vault, policy path, or marketplace is added.
- Edictum remains the policy system. Ductum only prepares the runtime boundary
  and records the result.

## Why This Is Not Drift

This supersedes the execution non-goal in decision `077` by recording the next
slice explicitly. It remains within decisions `056`, `057`, and `058`: the dogfood
flow needs local builder worktree isolation, and unsupported sandbox fields fail
instead of growing a fake policy system.

## Non-Goals

- No Docker, Podman, remote, microVM, or cloud sandbox driver.
- No network isolation implementation.
- No credential vault or credential mounting.
- No CPU, memory, process, or mount enforcement beyond the Ductum worktree.
- No new top-level primitive, resource status table, Operation table, or
  WorkOrder table.
- No second policy system and no Edictum enforcement change.
- No new dependency.
