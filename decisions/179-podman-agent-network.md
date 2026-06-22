# 179 - Podman Agent Network Boundary

Date: 2026-06-22

## Decision

Podman-backed Codex agent execution uses Podman's default container network for
now. The runtime boundary reports this honestly as `container-default`, not
`none` and not an egress allowlist.

## Why

The Codex process now runs inside the prepared Podman container. That process
must reach:

- the Ductum per-run MCP endpoint on the host control plane
- the configured model provider endpoint

Starting the container with `--network none` makes both routes unreachable. The
previous no-network boundary was truthful for an idle prepared container, but it
is not a usable boundary for real in-container agent execution.

## Consequences

- `network.mode=none` is rejected for Podman specs until Ductum has a container
  MCP/model proxy or a real enforceable allowlist.
- Loopback MCP URLs are rewritten to `host.containers.internal` inside
  containerized Codex.
- This does not claim egress restriction. It only claims worktree isolation,
  scoped runtime credentials, and process namespacing.
