# 057 - Reference Runtime Systems

## Status

Accepted

## Context

Ductum is being reframed as a factory/control plane for agent work. Before
committing to the next implementation pass, we looked at nearby systems for
runtime and extension design:

- NVIDIA OpenShell: safe private runtime for autonomous agents.
- t3code: minimal web/desktop GUI for Codex and Claude sessions.
- Sandcastle references from decision 056.

The goal is not to copy these systems. The goal is to keep Ductum's primitives
small while making the runtime pluggable enough to survive new agents,
sandboxes, notification channels, and model backends.

These references are not dependency targets. Ductum should learn the seams that
worked elsewhere, then implement only the smallest Ductum-native version needed
for dogfooding.

## OpenShell Lessons

OpenShell's strongest lesson is the split between the public resource model and
the compute driver model.

Its gateway exposes sandbox resources with:

- `spec`: desired sandbox intent.
- `status`: observed state.
- `phase`: normalized lifecycle summary.
- `conditions`: readiness and error details.
- events/log streams for watch-style clients.

Its compute driver contract is separate and lower-level:

- capabilities and defaults.
- validate create.
- create, get, list, stop, delete.
- watch platform observations.

Ductum should use the same shape for sandboxing. The dashboard and CLI should
not interpret raw Docker, Podman, SSH, or Kubernetes state directly. A
`SandboxDriver` translates provider-native observations into Ductum resources.

OpenShell also treats credentials as provider records: named bundles with
secret values and non-secret config. That maps cleanly to Ductum `Credential` /
`AuthRef` resources. Agents should reference credentials; credentials should
not be baked into agents.

OpenShell's policy model has four useful domains:

- filesystem policy.
- network policy.
- process policy.
- inference routing policy.

Filesystem and process policy are mostly create-time constraints. Network and
inference policy can be hot-reloaded. Ductum should copy that distinction into
`SandboxProfile`: some fields require a new sandbox, some can be reconciled
into a live sandbox.

OpenShell's `inference.local` idea is also useful later: code inside a sandbox
can call a local inference endpoint while the runtime strips caller
credentials, injects managed credentials, and routes to the configured model.
Ductum should not build that immediately, but the model/provider abstraction
should leave room for it.

OpenShell's draft policy recommendation flow is also relevant. When a sandbox
blocks network or filesystem access, Ductum should eventually surface proposed
policy amendments as approvals, not leave operators to read low-level logs.

## T3 Code Lessons

T3 Code's strongest lesson is the provider adapter split.

It separates:

- provider adapter contract: provider-native session operations.
- provider adapter registry: lookup by provider.
- provider service: cross-provider routing, validation, session binding, event
  publishing, and recovery.
- provider registry: installed/auth/version/model snapshots.
- server settings: authoritative persisted config with validation, atomic writes,
  watch, and change streams.

Ductum should follow that shape for harnesses and agents.

A Ductum `HarnessAdapter` should focus on provider/session behavior:

- start session.
- send turn.
- interrupt turn.
- respond to approval or user-input request.
- stop session.
- read or resume thread when supported.
- emit canonical runtime events.

The dispatcher/factory layer should own orchestration:

- choosing the agent.
- binding the session to a run.
- applying Edictum authorization.
- tracking costs and state.
- routing approvals and notifications.

T3 Code also models provider option descriptors. This is the right direction for
Ductum's model chooser. Models should expose typed options such as effort,
reasoning mode, sandbox mode, or provider-specific flags. Settings should render
those descriptors instead of showing raw JSON fields.

This does not mean Ductum should build the full T3 Code settings system now.
Server-authoritative validation is required first; descriptor-driven UI can be
added only where the current Settings flow needs it.

## Decision

Ductum will use three explicit extension seams:

1. `SandboxDriver`
   - Owns sandbox lifecycle and platform translation.
   - Inspired by OpenShell compute drivers.
2. `HarnessAdapter`
   - Owns agent runtime/session protocol.
   - Inspired by T3 Code provider adapters and Pi-style harness control.
3. `NotificationBackend`
   - Owns delivery and inbound actions for Telegram, email, Slack, webhook, or
     future channels.

These seams are configured by resources, not hardcoded switches.

An `Agent` is composed from:

- model reference.
- harness reference.
- role/system prompt.
- capabilities.
- tool policy.
- sandbox profile reference.
- credential references.
- approval/sandbox/runtime modes.
- budget and concurrency limits.

A `Model` is not an `Agent`. A `Harness` is not an `Agent`. A sandbox is not a
harness. Keeping these separate is the main way Ductum avoids turning into a
pile of special cases.

## Consequences

The next implementation pass should not build an OpenShell clone. It should add
the smallest Ductum-native resource model that can later support OpenShell-like
sandbox drivers.

The practical sequence is:

1. Add `Target` as the missing repo/subdir primitive.
2. Make settings server-authoritative and schema-validated.
3. Move agent config toward typed resources.
4. Define `HarnessAdapter` and `SandboxDriver` interfaces.
5. Keep existing harnesses running while adapters are migrated.
6. Add Docker/worktree sandbox profile support before remote/cloud sandboxes.
7. Treat Telegram as the first `NotificationBackend`.

Do not add top-level `Operation` and `WorkOrder` tables yet. Multi-repo work can
be represented first as fan-out specs and target-scoped tasks.

See decision `058` for the explicit non-goals created to prevent reference
system scope creep.
