# Factory Resource Model

**Date:** 2026-04-26

## Decision

Ductum is a factory control plane for agentic software work. Keep the existing
execution primitives, but make the configuration plane more declarative.

Do not add `Operation` and `WorkOrder` as new top-level primitives yet.
Represent multi-repo operations as fan-out `Spec`s that emit target-scoped
`Task`s.

## Resource Kinds

Configuration plane:

- `Factory`: the Ductum installation and global defaults.
- `Project`: a product or system boundary.
- `Target`: something Ductum can work on.
- `WorkflowProfile`: setup, verification, review, approval, and merge rules.
- `Harness`: the adapter that drives an agent runtime.
- `Model`: an LLM backend and access method.
- `Agent`: a configured worker role over a model and harness.
- `SandboxProfile`: isolation and filesystem/network policy.
- `Credential`: a named secret reference, never inline secret data.
- `NotificationChannel`: Telegram, Slack, webhook, email, or local channel.
- `Policy`: Edictum-backed boundaries applied to agents, workflows, or merges.

Work plane:

- `Spec`: user intent; may target one target or fan out to many.
- `Task`: concrete work emitted from a spec for one target.
- `Run`: one execution attempt by one agent on one task.
- `Decision`: human/operator decision.
- `Approval`: a decision request with approve/deny/skip/retry actions.
- `Event`: audit, status, cost, and tool/activity event.

## Target

`Target` is the missing primitive. It describes where work happens.

Targets can be GitHub repos, local filesystem repos, monorepo packages,
subdirectories, docs sites, apps, or services.

```yaml
apiVersion: ductum.ai/v1
kind: Target
metadata:
  name: edictum-hub
  project: edictum
spec:
  source:
    type: github
    repo: edictum-ai/edictum-hub
    localPath: /Users/acartagena/project/edictum-hub
  branch:
    base: main
    prefix: docs/
  workflowRef: frontend-docs-change
  authRef: github-default
```

## Agent

An agent is not a model. It is a configured worker persona.

An agent is composed of:

- model backend
- harness
- role/persona
- system prompt
- capabilities
- tool permissions
- sandbox profile
- workflow permissions
- effort/reasoning config
- budget and concurrency limits
- review or approval authority

```yaml
apiVersion: ductum.ai/v1
kind: Agent
metadata:
  name: opus-adversarial-reviewer
spec:
  modelRef: claude-opus-4-7
  harnessRef: pi
  sandboxRef: read-only-worktree
  systemPromptRef: prompts/agents/adversarial-reviewer.md
  capabilities: [review, security]
  tools:
    mode: read-only
  effort: xhigh
  maxConcurrency: 1
```

The same model can back many agents, such as `opus-security-advisor`,
`opus-product-reviewer`, and `opus-release-reviewer`.

## Fan-Out Specs

A multi-repo operation is a `Spec` with `fanOut`.

```yaml
apiVersion: ductum.ai/v1
kind: Spec
metadata:
  name: agency-control-rollout
  project: edictum
spec:
  sharedContextRef: prompts/agency-control-shared.md
  fanOut:
    mergePolicy: coordinated
    partialPolicy: allowSkipWithDecision
    targets:
      - targetRef: edictum-hub
        promptRef: prompts/edictum-hub.md
      - targetRef: edictum-docs
        promptRef: prompts/edictum-docs.md
```

Each target emits one task. Each task runs its normal workflow: worktree,
branch, implement, review, fix, approval, merge, and notification.

## Merge Policies

`perTarget`: each target reviews, approves, and merges independently. The parent
spec completes when all children are done, skipped, or failed.

`coordinated`: each target stops at ready-to-merge. The parent spec asks for a
final decision, then merges approved targets in order.

Partial policies:

- `block`: one blocked target blocks the parent.
- `allowSkipWithDecision`: operator may skip targets explicitly.
- `bestEffort`: complete when all reachable targets are done.
- `timeoutThenDecision`: wait until timeout, then ask an operator.

## Edictum Boundary

Ductum coordinates. Edictum bounds agency.

Ductum creates targets, specs, tasks, runs, assignments, notifications, and
aggregate status. Edictum enforces tool boundaries, workflow gates, evidence,
approval boundaries, and behavioral conformance for each run.

## Migration Rule

Add `Target`, `WorkflowProfile`, `Harness`, `Model`, `SandboxProfile`, and
`NotificationChannel` as configuration resources before adding more UI. Keep
`Spec`, `Task`, and `Run` as execution resources.
