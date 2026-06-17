# Sandbox Resource Model

**Date:** 2026-04-26

## Decision

Sandboxing is a first-class Ductum configuration primitive. Do not bury it inside
the harness. Agents and targets reference sandbox profiles.

## Why

Agents need different isolation levels:

- builders need writable worktrees
- reviewers may need read-only source plus test execution
- security advisors may need no network
- release operators may need GitHub and deploy credentials

The sandbox determines filesystem, network, process, and credential exposure.
It is central to "agent" identity.

## Sandcastle Lessons

The most relevant Sandcastle project is Matt Pocock's `@ai-hero/sandcastle`,
which describes itself as a TypeScript library for orchestrating coding agents
inside isolated sandboxes. It supports Docker, Podman, Vercel, no-sandbox, and
custom providers.

Useful design points to copy:

- `SandboxProvider` is pluggable.
- Providers are split into bind-mount and isolated modes.
- Docker and Podman are bind-mount providers.
- Vercel is an isolated provider.
- A reusable sandbox can run implement then review on the same branch.
- Worktree locking prevents concurrent runs from sharing the same branch.
- Multi-repo inside one sandbox is explicitly out of scope there because it
  breaks the single-repo assumptions around worktrees and commit extraction.

Andres Marquez's Sandcastle is closer to an orchestrator UI for fleets of Claude
Code agents. It validates the category, but the sandbox provider design from
`@ai-hero/sandcastle` is more directly useful for Ductum.

## Resource

```yaml
apiVersion: ductum.ai/v1
kind: SandboxProfile
metadata:
  name: read-only-worktree
spec:
  provider: docker
  mode: bindMount
  filesystem:
    worktree: readOnly
    extraMounts: []
  network:
    mode: none
  credentials:
    expose: []
  resources:
    cpu: 2
    memoryMb: 4096
```

Writable builder:

```yaml
kind: SandboxProfile
metadata:
  name: builder-worktree
spec:
  provider: docker
  mode: bindMount
  filesystem:
    worktree: readWrite
  network:
    mode: limited
    allowHosts:
      - registry.npmjs.org
      - api.github.com
  credentials:
    expose:
      - github-default
```

## Provider Interface

```ts
interface SandboxProvider {
  id: string;
  capabilities(): SandboxCapabilities;
  create(input: CreateSandboxInput): Promise<SandboxHandle>;
}

interface SandboxHandle {
  worktreePath: string;
  exec(command: string, options: ExecOptions): Promise<ExecResult>;
  stream(command: string, options: ExecOptions): AsyncIterable<SandboxEvent>;
  copyIn?(from: string, to: string): Promise<void>;
  copyOut?(from: string, to: string): Promise<void>;
  close(): Promise<void>;
}
```

Provider modes:

- `host`: no isolation, local dev only.
- `worktree`: local filesystem worktree with Ductum controls.
- `docker`: container bind-mount.
- `podman`: rootless container bind-mount.
- `isolated`: remote or microVM-like provider with explicit sync.

## Multi-Repo Rule

Do not start with one sandbox containing many independently managed repos.

For Ductum, multi-repo work should fan out to target-scoped tasks. Each task gets
its own worktree, branch, sandbox, and commit extraction. A future optimization
can mount sibling repos read-only for context, but they should not be managed as
write targets in the same sandbox until the model is proven.

## Edictum Boundary

Sandboxing limits what the process can touch. Edictum limits what actions are
allowed in the workflow. Both are required.

Example: a reviewer sandbox may be read-only, and Edictum also blocks write
tools. Defense should be layered.

## Next Step

Add `SandboxProfile` to the declarative resource model, then make Agents and
WorkflowProfiles reference it.
