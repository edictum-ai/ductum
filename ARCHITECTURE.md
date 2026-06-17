# Architecture

This is the original architecture baseline. The current resource-model direction
adds `Target`, `WorkflowProfile`, `Harness`, `Model`, `SandboxProfile`, and
`NotificationChannel`; see `specs/CURRENT.md` and decisions `053` through
`057`.

## System layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Agents (Mimi, Codex, GLM)                                       │
│                                                                 │
│  Claude agents → Claude Agent SDK (harness-enforced)             │
│  Other agents  → OpenCode serve (harness-enforced)               │
└───────────────────────────────┬─────────────────────────────────┘
                                │ MCP tools / CLI
┌───────────────────────────────▼─────────────────────────────────┐
│  Ductum MCP Server + CLI                                        │
│  Stateless wrappers over Core REST API                          │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST
┌───────────────────────────────▼─────────────────────────────────┐
│  Ductum Core (TypeScript)                                       │
│                                                                 │
│  Data model: Factory, Project, Spec, Task, Decision,            │
│              Run, Agent, Watcher                                 │
│  DAG evaluator: what’s unblocked?                               │
│  Dispatcher: spawn agents for unblocked tasks                   │
│  Agent registry: capabilities, roles, spawn config              │
│  Harness manager: Claude adapter + OpenCode adapter             │
│  Persistence: SQLite                                            │
│  Events: SSE stream for dashboard                               │
│  REST API: serves MCP server, CLI, and dashboard                │
│                                                                 │
│  EMBEDS @edictum/core (TypeScript SDK)                          │
│  └─ Gate evaluation: in-process, no HTTP round-trip              │
│  └─ Rule compilation: local, from fetched rulesets               │
│  └─ Workflow runtime: stage transitions enforced locally         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP (audit events, optional)
┌───────────────────────────────▼─────────────────────────────────┐
│  edictum-api (Go) — OPTIONAL                                    │
│                                                                 │
│  Ruleset storage (source of truth for rule definitions)         │
│  Event ingestion + audit trail                                  │
│  Approval storage + session management                          │
│  SSE streams for external consumers                             │
│                                                                 │
│  NOTE: edictum-api does NOT evaluate rules or gates.            │
│  It stores and serves data. Evaluation happens in the SDKs.     │
│  Ductum Core fetches rulesets from here, evaluates locally.     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Ductum Dashboard (React + Vite)                                │
│                                                                 │
│  Project / Spec / Task views                                    │
│  DAG visualization                                              │
│  Live agent status (SSE)                                        │
│  Run state machine view (sub-states, watchers, parallel tracks) │
│  Decision trail                                                 │
│  Gate evaluation log                                            │
│  Cost tracking                                                  │
│  Approval actions (human-merge gates)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Enforcement model

Enforcement is LOCAL, not remote. This matches how Edictum actually works across all three SDKs (Python, TypeScript, Go):

1. SDKs fetch rulesets from edictum-api (or load from local config)
2. SDKs compile rules locally
3. SDKs evaluate gates locally, in-process
4. SDKs report events back to edictum-api for audit

Ductum Core embeds `@edictum/core` (the TypeScript SDK). Gate evaluation happens in-process. There is no HTTP round-trip for enforcement.

edictum-api is the audit/storage sink — not the enforcement backend. Ductum works without it. When edictum-api is running, Ductum uses it for:
- Fetching ruleset definitions (source of truth)
- Persisting audit events (decision trail)
- Storing approval state
- Serving SSE streams for external consumers

```
Gate evaluation flow:

Agent calls session-bound `ductum.gate_check("push")`
  │
  ▼
Ductum Core looks up run’s workflow definition
  │
  ▼
@edictum/core evaluates gate IN-PROCESS:
  - Current stage? → implement
  - Target stage? → push
  - Transition allowed? → check: tests_passing == true
  - Result: allowed | blocked + reason
  │
  ▼
Ductum Core records gate evaluation in SQLite
  │
  ▼
Optionally: forwards event to edictum-api for audit
  │
  ▼
If allowed: updates run stage, emits SSE,
  re-evaluates DAG for newly unblocked tasks
If blocked: returns reason to agent,
  agent must satisfy conditions before retrying
```

## Harness layer

See HARNESS.md for full details. Summary:

Enforcement is structural via harness adapters, not via advisory instructions. Agents do not choose to comply — the harness makes compliance non-optional.

- **Claude harness adapter:** Uses Claude Agent SDK. Ductum wraps every tool call through `@edictum/core` before it reaches the model.
- **OpenCode harness adapter:** Uses OpenCode’s HTTP server (`opencode serve`). A stateless Ductum plugin hooks all tool calls and delegates policy decisions to Ductum Core. The plugin itself is generic; policy is dynamic per-run because Ductum resolves session identity against the correct run’s workflow.

Claude agents MUST use Claude products (Agent SDK, Claude Code headless) to stay within the Max subscription. Non-Claude agents use OpenCode with their respective backends (OpenAI for Codex, GLM for GLM).

## MCP tool surface

13 tools organized by category:

### Task lifecycle

| Tool | Purpose | Called by |
|------|---------|----------|
| `ductum.next_task(project?, role?)` | Get next unblocked task | Agent (pull mode) |
| `ductum.accept(task_id)` | Claim a task, start a run | Agent |
| `ductum.complete(result, pr?)` | Mark run as done | Agent |

### Progress reporting

| Tool | Purpose | Called by |
|------|---------|----------|
| `ductum.update(stage, message)` | Report progress | Agent |
| `ductum.heartbeat()` | Keep run alive, prevent timeout | Agent |
| `ductum.decide(decision, context, alternatives?)` | Record a decision | Agent or Human |

### Enforcement + state transitions

| Tool | Purpose | Called by |
|------|---------|----------|
| `ductum.gate_check(target_stage)` | Request stage transition (evaluated by @edictum/core) | Agent |
| `ductum.wait(waiting_for, timeout?)` | Enter wait state (ci, review, approval) | Agent |
| `ductum.reset(target_stage, reason)` | Stage regression (review found issues, go back) | Ductum-controlled |
| `ductum.fail(reason, recoverable?)` | Report failure, trigger reset or alert | Agent |

### Evidence + linking

| Tool | Purpose | Called by |
|------|---------|----------|
| `ductum.evidence(type, payload)` | Attach CI results, review findings, test output | Agent or Watcher |
| `ductum.link(branch?, commit?, pr?, checks?)` | Associate git artifacts with the run | Agent |

### Recovery

| Tool | Purpose | Called by |
|------|---------|----------|
| `ductum.get_context(task_id)` | Full state for crash recovery | Agent |

## Run state machine

A Run is not a linear progression. It has sub-states, can regress, and runs parallel tracks after push.

```
           accepted
              │
              ▼
         implementing ─────▶ failed (recoverable?)
              │                   │ yes → reset to implementing
              │                   │ no  → terminal
              ▼
     gate: local tests pass?
        │ blocked → stay in implementing
        │ allowed ▼
     pre-push-review (local review BEFORE push)
        │ findings → reset to fixing
        │ clean ▼
           pushing
              │
              ▼
     ┌──────── PARALLEL LATCHES ─────────┐
     │                                   │
     │  waiting-for-ci    waiting-for-   │
     │  (watcher polls)   review         │
     │       │            (reviewer      │
     │       │             assigned)     │
     │       ▼                ▼          │
     │  ci: pass|fail   review: pass|   │
     │                  fail             │
     └───────────────────────────────────┘
              │
              ▼
     both pass? → gate: merge allowed?
     either fail? → reset to fixing
              │
              ▼
     gate: merge
        │ auto-merge → merging → done
        │ human-merge → waiting-for-approval
              │ human approves ▼
           merging
              │
              ▼
            done ───▶ DAG re-evaluation:
                       unblock dependent tasks
```

### Sub-state definitions

- **implementing** — Building from scratch against the task prompt. Full freedom within the stage.
- **fixing** — Remediating specific findings from CI or review. Narrower scope: agent has the failing checks, review comments, specific issues. Different from implementing because the agent addresses findings, not the full task. Separately trackable for cost and evidence.
- **pre-push-review** — Local code review (by Opus or Codex) of the diff BEFORE pushing. Saves CI runs by catching issues locally first. This is PROCESS.md Track 2.
- **waiting-for-ci** and **waiting-for-review** — Parallel latches after push. CI and review run independently. Both must pass before merge gate evaluates. Either failing triggers reset to fixing.
- **stalled** — Heartbeat timeout. Agent stopped sending heartbeats. Needs intervention — human alert or another agent resumes via `ductum.get_context()`.

### Key properties

- **Reset is not a new run.** Same run, stage regression. Full history preserved.
- **Fixing is narrower than implementing.** Different allowed actions, evidence requirements, and cost tracking.
- **CI and review are independent parallel latches.** Not sequential. Both must resolve before merge gate.
- **Pre-push review is a gate.** Catches issues locally before burning CI runs. Maps to PROCESS.md Track 2.
- **Next-task prep** (PROCESS.md Track 3) is not a Run sub-state — it’s Ductum Core dispatcher behavior. While a run is in any `waiting-*` state, the dispatcher can assign the same agent to prep work on the next task.
- **Watchers** are lightweight agents that poll external state and inject evidence. Modeled as child runs.
- **External signals** (CI results, review findings, webhooks) arrive asynchronously and can unblock waiting runs or trigger resets.

## Agent work modes

**Push mode (automated):** Ductum dispatcher sees unblocked task → spawns agent via harness adapter → agent works through enforced workflow → completes or stalls.

**Pull mode (manual):** Human starts agent → agent calls `ductum.next_task()` → gets assigned work → works through enforced workflow → completes.

Both modes are harness-enforced. The agent cannot skip stages or avoid reporting.

## Merge modes

Merge is a workflow stage with its own gate rules:

- **Auto-merge:** CI green + reviewer approved → gate allows → merge proceeds. Default for routine tasks.
- **Human-merge:** Gate requires `human_approval`. Dashboard shows "ready to merge", alerts human. Human approves from dashboard or CLI.

Configurable per-project (default) and per-task (override).

## Tech stack

| Component | Technology | Rationale |
|-----------|-----------|----------|
| Ductum Core | TypeScript | Same language as frontend, embeds @edictum/core natively |
| Enforcement | @edictum/core (TS SDK, embedded) | In-process gate evaluation, no HTTP overhead |
| Persistence | SQLite | Local-first, zero-config, sufficient for single-operator |
| MCP Server | TypeScript | Native MCP SDK support |
| CLI | TypeScript | Shares types with Core |
| Dashboard | React + Vite | Arnold’s existing frontend stack |
| Claude harness | Claude Agent SDK (TS) | Subscription-compliant, programmatic control |
| Non-Claude harness | OpenCode serve (HTTP API) | Model-agnostic, MCP built-in, plugin hooks |
| Audit storage | edictum-api (Go, optional) | Existing service for event persistence + ruleset storage |
| Real-time | SSE | Simple, unidirectional, sufficient for dashboard updates |
