# Harness Plugin Model

**Date:** 2026-04-26

## Decision

Ductum should make harnesses pluggable, but should converge toward one preferred
controlled substrate once proven. Pi is the leading candidate, but it should be
an adapter, not hardcoded into Ductum.

## Boundary

A harness drives an agent runtime. It does not own Ductum state, policy, or
approval semantics.

```text
Ductum Run Controller
  -> Harness Adapter
    -> Pi / Codex / Claude Code / OpenCode / custom runner
```

Before a tool executes, the harness must surface the request to Ductum. Ductum
checks Edictum policy, records the decision, then allows or blocks execution.

## Interface Shape

```ts
interface Harness {
  id: string;
  capabilities(): HarnessCapabilities;

  prepare(input: PrepareRunInput): Promise<PreparedRun>;
  start(input: StartRunInput): AsyncIterable<HarnessEvent>;
  interrupt(runId: string, reason: string): Promise<void>;
  recover(runId: string): Promise<RecoverResult>;
  cleanup(runId: string): Promise<void>;
}
```

Required event types:

- `session.started`
- `text.delta`
- `tool.requested`
- `tool.allowed`
- `tool.blocked`
- `tool.result`
- `cost.updated`
- `heartbeat`
- `needs_approval`
- `completed`
- `failed`

## Harness Resource

```yaml
apiVersion: ductum.ai/v1
kind: Harness
metadata:
  name: pi
spec:
  type: pi
  command: pi
  controlMode: sdk
  supportedSandboxes: [worktree, docker, podman]
```

## Agent Composition

Agents reference harnesses.

```yaml
kind: Agent
metadata:
  name: gpt-55-builder
spec:
  harnessRef: pi
  modelRef: gpt-5.5
  systemPromptRef: prompts/agents/builder.md
  capabilities: [build, test, fix]
```

## Pi Direction

The desired end state is:

```text
Ductum control plane
  -> Pi harness adapter
  -> model/provider execution
  -> sandbox provider
  -> Edictum policy checks
```

Current Codex, Claude, OpenCode, and Vercel adapters should remain until Pi
proves it can cover streaming, tool authorization, session recovery, model
routing, sandboxing, cost events, and cancellation.

## Rules

- Harness adapters return events; they do not mutate Ductum state directly.
- Harness adapters cannot bypass Edictum for tool execution.
- Harness sessions must bind to Ductum run ids through the dispatcher.
- A harness may support many models and many agents.
- A model is not an agent; an agent is a role over model plus harness plus
  prompt plus tools plus sandbox.

## Next Step

Add a harness registry and normalize current adapters behind this interface
before removing existing harness paths.
