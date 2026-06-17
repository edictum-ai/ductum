# Ductum

**AI factory orchestration powered by Edictum.**

> *Edictum decrees, Ductum conducts.*

## What Ductum is

Ductum is a local-first application (future SaaS) that orchestrates AI agent factories. It models work as projects with dependency graphs, assigns agents to execute that work, tracks state in real-time, records every decision, and enforces workflow stages via embedded Edictum rules.

Ductum does not reinvent enforcement. It embeds `@edictum/core` (the TypeScript SDK) for in-process gate evaluation, and optionally reports audit events to edictum-api. Ductum’s job is:

- Model the work (projects, specs, tasks, dependencies)
- Assign work to agents
- Enforce stage transitions via embedded @edictum/core
- Track state and surface visibility
- Record decisions
- Dispatch and schedule
- Make enforcement structural via harness adapters (not advisory instructions)

## The problem Ductum solves

AI agents can build software, but they cannot manage themselves. Without orchestration:

- The human is the orchestrator (polling agents, deciding next steps, pushing work forward)
- There is no enforcement (agents stop whenever they want — "same pause failure on my side")
- There is no persistence (session crash = total state loss)
- There is no visibility (human must ask for status)
- There is no cost tracking
- There is no decision trail

With Ductum, the human is the observer. Agents receive work, execute it through enforced workflows, and advance through dependency graphs automatically. The human intervenes only on alerts or approval gates.

## Primitives

### Factory

The top-level Ductum instance. One factory per human operator. Contains projects, the agent registry, and global configuration.

### Project

A body of work with repos, agents, and specs. "Edictum" is a project. "SwissPost AI Enablement" is a project. Projects are independent — each has its own agent assignments, workflow definitions, and gate rules.

Agents are assigned to a project with roles:

```yaml
project: edictum
agents:
  mimi: { role: builder }
  codex: { role: reviewer }
  glm: { role: docs }
```

### Agent

A registered AI worker with a model, a harness adapter, and capabilities.

```yaml
agents:
  mimi:
    model: claude-opus-4.6
    harness: claude-agent-sdk
    capabilities: [build, test, fix]
  codex:
    model: gpt-5.4
    harness: opencode
    capabilities: [review, implement]
  glm:
    model: glm-5.1
    harness: opencode
    capabilities: [docs, quick-fix]
```

Agents connect via harness adapters (see HARNESS.md). The harness makes enforcement structural — agents do not choose to comply. Harness adapters intercept tool calls at the infrastructure level.

### Spec

A planned feature or change within a project. Specs have their own lifecycle: draft → reviewed → approved → implementing → done.

Specs can depend on other specs (hard: blocks start until dependency is done) or be related to other specs (soft: visible link for context, no blocking).

Each spec contains: the specification document, a decision log, adversarial review rounds, and implementation prompts organized as a dependency graph.

### Task

A unit of executable work derived from a spec. This is a P1-API-MODELS, a P2-API-SNAPSHOT. Tasks have:

- Target repo(s)
- Assigned agent (explicit or auto-matched by role/capabilities)
- Dependencies on other tasks (forming a DAG)
- A verification checklist
- A status

Tasks form a DAG within a spec. The DAG evaluator determines which tasks are unblocked based on completed dependencies at both the task level and the spec level.

### Decision

A recorded choice attached to a spec or task. Append-only — changes add a new decision referencing the superseded one. Decisions capture: date, context, the choice made, alternatives considered, who decided.

### Run

An execution of a task by an agent. A task might have multiple runs (first attempt failed, second passed). Each run has:

- A state machine with sub-states and parallel tracks (see ARCHITECTURE.md)
- Linked git artifacts (branch, commits, PR, CI checks)
- Attached evidence (CI results, review findings, test output)
- Cost tracking (tokens in/out per message)
- Gate evaluation history
- Heartbeat monitoring

**Run sub-states:**

- `accepted` — agent claimed the task
- `implementing` — agent is building from scratch against the task prompt. Full freedom within stage.
- `fixing` — agent is addressing specific CI/review findings. Narrower scope than implementing. Agent has failing checks, review comments, specific issues. Separately trackable for cost.
- `pre-push-review` — local code review of diff before pushing. Catches issues before burning CI runs.
- `pushing` — agent is pushing to remote, creating PR
- `waiting-for-ci` — parallel latch: watcher polling CI status
- `waiting-for-review` — parallel latch: reviewer agent assigned. Runs in parallel with CI.
- `waiting-for-approval` — human approval gate
- `merging` — merge in progress
- `done` — complete, triggers DAG re-evaluation to unblock dependent tasks
- `failed` — terminal or recoverable (with reset to implementing or fixing)
- `stalled` — heartbeat timeout, needs intervention

Runs can regress: CI failure or review findings reset to `fixing` (not back to `implementing`). `fixing` is a narrower remediation mode. Full history of all stage transitions is preserved.

CI and review are parallel latches after push. Both must resolve independently before the merge gate evaluates. If either fails, the run resets to `fixing`.

### Watcher

A lightweight agent (e.g., Haiku) that monitors external state and reports back. Watchers:

- Poll CI status (`gh pr checks`) and inject evidence
- Monitor review bot results
- Listen for GitHub webhooks
- Unblock waiting runs when conditions are met

Watchers are modeled as child runs. They can inject evidence but cannot directly trigger resets — Ductum Core evaluates evidence against gate rules and triggers resets when needed. This separation of authority is important: watchers observe and report, Ductum Core decides.

### Gate

An Edictum Workflow Gate checkpoint between stages. Evaluated by `@edictum/core` in-process within Ductum Core. The run cannot advance past a gate without evaluation returning `allowed`.

Gates can require:

- Automated checks (CI green, tests pass, evidence attached)
- Peer review (reviewer agent approved with no critical findings)
- Human approval (Arnold signs off from dashboard)

Merge is itself a gated stage. Configurable per-project and per-task:

- **Auto-merge**: CI green + reviewer approved = merge proceeds
- **Human-merge**: gate requires `human_approval`, dashboard alerts, human approves

## Architecture

See ARCHITECTURE.md for the full system diagram, enforcement model, and Run state machine.

See HARNESS.md for how enforcement is made structural via harness adapters.

Key points:
- Ductum Core embeds `@edictum/core` for in-process enforcement
- edictum-api is optional (audit/storage sink, not enforcement backend)
- Harness adapters make enforcement structural (agents cannot bypass)
- Claude agents use Claude Agent SDK (subscription-compliant)
- Non-Claude agents use OpenCode serve with stateless Ductum plugin (model-agnostic)
- OpenCode plugin delegates policy to Ductum Core via MCP (session-aware, per-run isolation)

## Relationship to Edictum

Ductum is built ON `@edictum/core`, the TypeScript SDK. It embeds the SDK directly for in-process gate evaluation and rule enforcement.

edictum-api (the Go server) is used optionally for:
- Ruleset storage (central source of truth)
- Audit event persistence
- Approval and session management

Ductum does not depend on edictum-api for enforcement. The Edictum product architecture is "local enforcement + remote audit," and Ductum follows this pattern.

The dogfood story: "Ductum uses Edictum’s TypeScript SDK to enforce every stage transition in every agent run. This is how we built Edictum — using Edictum."

## Replaces

edictum-harness was the manual version of Ductum — markdown files, BOARD.md, PROCESS.md, WhatsApp babysitting. Ductum replaces the harness with a running system.

## Status

The original design phase is complete and the system has working code. The
current roadmap extends these primitives with declarative resources:
`Target`, `WorkflowProfile`, `Model`, `Harness`, `Agent`, `SandboxProfile`, and
`NotificationChannel`.

Current source of truth: `specs/CURRENT.md` and decisions `053` through `057`.
