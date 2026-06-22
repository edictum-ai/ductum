# D176: Podman sandbox executes supported agent commands in the container

**Date:** 2026-06-22
**Decided by:** Arnold + Codex
**Linked:** D056, D172, P5 Podman Agent Execution

## Context

D172 shipped a real Podman driver but deliberately used an ephemeral probe
container because teardown was not wired. That left `spawnOptions.sandbox` as
evidence of a prepared container only; harness adapters still ran agent side
effects on the host.

## Decision

Podman sandbox preparation now creates a labelled long-lived container and the
dispatcher wires teardown through session release. The first supported harness
path is Codex app-server / `codex-sdk` compatibility: it launches `codex
app-server` with `podman exec` in the prepared container workdir. Harnesses
that do not claim or implement container execution fail closed instead of
silently falling back to host.

Teardown runs on normal session release, spawn failure after preparation,
operator kill/cancel/pause, heartbeat timeout paths, and stale slot cleanup.
Stale cleanup also removes labelled Podman containers by run id so a dispatcher
restart does not leave a known stale container behind.

Codex app-server also gets a separate per-run runtime mount at
`/ductum/runtime`. Its config/auth files are prepared on the host outside the
git worktree and copied into that mounted runtime directory. This is narrower
than mounting a host home directory and avoids putting auth files into the
worktree that Ductum may later commit.

## Non-decisions

No new base image dependency is introduced. Operators must configure a Podman
image that already contains the selected agent command. No Docker, remote
sandbox, dynamic plugin loading, CPU/memory claims, or broad host-home mount is
added.
