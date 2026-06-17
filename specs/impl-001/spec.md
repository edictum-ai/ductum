# Ductum Implementation Spec

**Version:** 1.1
**Date:** 2026-04-04
**Status:** Draft (post-review)
**Author:** Arnold + Claude (Opus 4.6)
**Review:** Round 4 complete (Codex) — 6 findings, all accepted, D22-D27

---

## 1. Overview

Ductum is a local-first AI factory orchestration application powered by Edictum. It models work as projects with dependency graphs, assigns agents, enforces workflow stages via embedded `@edictum/core`, and provides a dashboard for visibility.

The enforcement model is structural, not advisory. Agents do not choose to comply with workflow stages — the harness intercepts every tool call and evaluates it against the current run's workflow rules before execution. This is the core differentiator from CLAUDE.md/SKILL.md approaches, which agents routinely ignore.

**Design lineage:** 4 rounds of adversarial review (Codex), 27 decisions (D1-D27), 3 corrections (C1-C3). All findings from `decisions/` are baked into this spec.

## 2. Goals

1. **Eliminate human-as-orchestrator.** The human observes; Ductum dispatches, enforces, and advances work through dependency graphs automatically.
2. **Structural enforcement.** Agents cannot skip stages, go dark, or self-report completion without evidence. Enforcement lives in the harness, evaluated by `@edictum/core` in-process.
3. **Crash resilience.** All state persists in SQLite. Session crashes produce `stalled` runs that new sessions can resume via `get_context`.
4. **Real-time visibility.** Dashboard shows live run state, DAG progress, decision trail, and cost tracking via SSE — no polling the agent.
5. **Multi-agent, multi-harness.** Claude agents via Agent SDK, non-Claude agents via OpenCode. Both harnesses enforce the same workflow rules through the same `@edictum/core` evaluation.
6. **Dogfood Edictum.** Every Ductum demo is an Edictum demo. "This is how we built Edictum — using Edictum."

## 3. Non-Goals

1. **Not a project management tool.** Ductum is a running orchestration system, not Jira-with-markdown (D4).
2. **Not multi-tenant SaaS.** Local-first, single operator. SaaS is a future evolution (D2).
3. **Not a CI/CD system.** Ductum monitors CI results; it does not run CI pipelines.
4. **Not a code review tool.** Ductum orchestrates review assignments and ingests findings; it does not perform reviews.
5. **Not a general-purpose workflow engine.** The workflow model is purpose-built for AI agent coding tasks with the specific state machine defined in this spec.
6. **Not real-time collaboration.** Single human operator (Arnold). No multi-user auth, no role-based access.
7. **No edictum-api dependency for enforcement.** edictum-api is an optional audit/storage sink. Ductum works without it (D10, D14).
8. **No prompt-based enforcement.** SKILL.md, CLAUDE.md instructions, and MCP tool descriptions are advisory context, not enforcement. Enforcement is harness-level interception (D11, C2).
9. **No agent self-reset.** Agents report failure and evidence. Ductum Core evaluates and triggers resets (D20, C4).

## 4. Architecture

```
+------------------------------------------------------------------+
|  Agents (Mimi/Claude, Codex/GPT-5, GLM)                         |
|                                                                  |
|  Claude agents -> Claude Agent SDK harness adapter               |
|  Other agents  -> OpenCode serve + stateless Ductum plugin       |
+-------------------------------+----------------------------------+
                                | MCP tools / CLI
+-------------------------------v----------------------------------+
|  Ductum MCP Server + CLI                                         |
|  Stateless wrappers over Core REST API                           |
+-------------------------------+----------------------------------+
                                | REST
+-------------------------------v----------------------------------+
|  Ductum Core (TypeScript)                                        |
|                                                                  |
|  Data model: Factory, Project, Spec, Task, Decision,             |
|              Run, Agent, Watcher                                 |
|  Run state machine: transitions, parallel latches, resets        |
|  DAG evaluator: task/spec dependency resolution                  |
|  Dispatcher: spawn agents for unblocked tasks (push mode)        |
|  Agent registry: capabilities, roles, spawn config               |
|  Harness manager: Claude adapter + OpenCode adapter              |
|  Persistence: SQLite (better-sqlite3)                            |
|  Events: SSE stream for dashboard                                |
|  REST API: Hono server                                           |
|                                                                  |
|  EMBEDS @edictum/core (TypeScript SDK)                           |
|  +-- WorkflowRuntime: tool-call authorization per stage          |
|  +-- WorkflowDefinition: loaded from YAML                        |
|  +-- Workflow state: persisted in Session (backed by SQLite)     |
+-------------------------------+----------------------------------+
                                | HTTP (audit events, optional)
+-------------------------------v----------------------------------+
|  edictum-api (Go) -- OPTIONAL                                    |
|  Ruleset storage, event ingestion, audit trail, SSE streams      |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  Ductum Dashboard (React + Vite)                                 |
|  Project / Spec / Task views, DAG visualization, live run state, |
|  decision trail, gate evaluation log, cost tracking, approvals   |
+------------------------------------------------------------------+
```

### 4.1 Package Structure

pnpm workspace monorepo:

```
ductum/
  packages/
    core/              # Types, DB, state machine, DAG, enforcement
      src/
        types.ts       # All primitive types
        db.ts          # SQLite setup + migrations
        repos/         # Repository pattern (interfaces + SQLite impl)
          factory.ts
          project.ts
          agent.ts
          spec.ts
          task.ts
          decision.ts
          run.ts
          evidence.ts
        state-machine.ts  # Run state machine
        dag.ts            # DAG evaluator
        enforce.ts        # authorize_tool + gate_check via @edictum/core
        dispatcher.ts     # Push/pull mode dispatch
        watcher.ts        # CI/review watchers
        events.ts         # SSE event emitter
    api/               # REST API (Hono)
      src/
        index.ts
        routes/
          projects.ts
          specs.ts
          tasks.ts
          runs.ts
          agents.ts
          decisions.ts
          events.ts    # SSE endpoint
    mcp/               # MCP Server (12 agent-visible tools)
      src/
        index.ts
        tools/
          lifecycle.ts    # next_task, accept, complete
          progress.ts     # update, heartbeat, decide
          enforcement.ts  # gate_check, wait, fail
          evidence.ts     # evidence, link
          recovery.ts     # get_context
    cli/               # CLI
      src/
        index.ts
        commands/
    harness/           # Both harness adapters
      src/
        claude.ts      # Claude Agent SDK adapter
        opencode.ts    # OpenCode adapter (Ductum-side)
        plugin/        # Stateless OpenCode plugin (deployed to plugin dir)
          index.ts
    dashboard/         # React + Vite
      src/
        App.tsx
        components/
        hooks/
        api/
  workflows/           # Edictum workflow YAML definitions
    coding-guard.yaml  # Default coding workflow
  ductum.config.yaml   # Factory configuration
```

### 4.2 Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Ductum Core | TypeScript | Same language as @edictum/core, shares types |
| Enforcement | @edictum/core ^0.3.1 | In-process WorkflowRuntime, no HTTP overhead |
| Persistence | SQLite via better-sqlite3 | Local-first, zero-config, synchronous API |
| REST API | Hono | Lightweight, excellent TS support, fast |
| MCP Server | @modelcontextprotocol/sdk | Standard MCP implementation |
| CLI | commander | Standard Node.js CLI framework |
| Dashboard | React 19 + Vite + Tailwind + shadcn/ui | Arnold's existing frontend stack |
| Claude harness | Claude Agent SDK (TS) | Subscription-compliant, programmatic control |
| Non-Claude harness | OpenCode serve (HTTP API) | Model-agnostic, plugin hooks |
| Monorepo | pnpm workspaces | Consistent with Edictum ecosystem |
| IDs | nanoid | URL-safe, compact, no UUID overhead |

## 5. Data Model

### 5.1 TypeScript Types

```typescript
// --- Identifiers ---
type FactoryId = string   // nanoid
type ProjectId = string
type AgentId = string
type SpecId = string
type TaskId = string
type DecisionId = string
type RunId = string
type EvidenceId = string

// --- Factory ---
interface Factory {
  id: FactoryId
  name: string
  config: FactoryConfig
  createdAt: string  // ISO 8601
}

interface FactoryConfig {
  heartbeatTimeoutSeconds: number  // default: 120
  defaultMergeMode: 'auto' | 'human'  // default: 'human'
}

// --- Project ---
interface Project {
  id: ProjectId
  factoryId: FactoryId
  name: string        // unique
  repos: string[]     // repo paths (e.g., 'edictum-ai/edictum-ts')
  config: ProjectConfig
  createdAt: string
  updatedAt: string
}

interface ProjectConfig {
  mergeMode: 'auto' | 'human'
  workflowPath: string  // path to Edictum workflow YAML
}

// --- Agent ---
interface Agent {
  id: AgentId
  name: string        // unique (e.g., 'mimi', 'codex', 'glm')
  model: string       // e.g., 'claude-opus-4.6', 'gpt-5.4', 'glm-5.1'
  harness: 'claude-agent-sdk' | 'opencode'
  capabilities: AgentCapability[]
  spawnConfig: AgentSpawnConfig
  createdAt: string
}

type AgentCapability = 'build' | 'test' | 'fix' | 'review' | 'docs' | 'quick-fix'
type AgentRole = 'builder' | 'reviewer' | 'docs' | 'watcher'

interface AgentSpawnConfig {
  port?: number          // for OpenCode serve
  workingDir?: string    // override working directory
  env?: Record<string, string>  // environment variables
}

// --- Project-Agent assignment ---
interface ProjectAgent {
  projectId: ProjectId
  agentId: AgentId
  role: AgentRole
}

// --- Spec ---
type SpecStatus = 'draft' | 'reviewed' | 'approved' | 'implementing' | 'done'

interface Spec {
  id: SpecId
  projectId: ProjectId
  name: string
  status: SpecStatus
  document: string    // markdown content or file path
  createdAt: string
  updatedAt: string
}

interface SpecDependency {
  specId: SpecId
  dependsOnId: SpecId
  kind: 'hard' | 'soft'  // hard blocks start, soft is contextual
}

// --- Task ---
type TaskStatus = 'pending' | 'blocked' | 'ready' | 'active' | 'done' | 'failed'

interface Task {
  id: TaskId
  specId: SpecId
  name: string          // e.g., 'P1-CORE-TYPES'
  prompt: string        // implementation prompt content
  repos: string[]       // target repos
  assignedAgentId: AgentId | null
  status: TaskStatus
  verification: string[]  // checklist items
  createdAt: string
  updatedAt: string
}

interface TaskDependency {
  taskId: TaskId
  dependsOnId: TaskId
}

// --- Decision ---
interface Decision {
  id: DecisionId
  specId: SpecId | null
  taskId: TaskId | null
  runId: RunId | null
  decision: string
  context: string
  alternatives: string[] | null
  decidedBy: string
  supersedesId: DecisionId | null
  createdAt: string
}

// --- Run ---
type RunStage =
  | 'accepted'
  | 'implementing'
  | 'fixing'
  | 'pre-push-review'
  | 'pushing'
  | 'waiting-for-ci'
  | 'waiting-for-review'
  | 'waiting-for-approval'
  | 'merging'
  | 'done'
  | 'failed'
  | 'stalled'

interface Run {
  id: RunId
  taskId: TaskId
  agentId: AgentId
  parentRunId: RunId | null  // for watcher child runs
  stage: RunStage
  sessionId: string | null   // harness session ID (D21)
  branch: string | null
  commitSha: string | null
  prNumber: number | null
  prUrl: string | null
  ciStatus: 'pending' | 'pass' | 'fail' | null
  reviewStatus: 'pending' | 'pass' | 'fail' | null
  failReason: string | null
  recoverable: boolean
  tokensIn: number
  tokensOut: number
  costUsd: number
  lastHeartbeat: string | null
  heartbeatTimeoutSeconds: number
  createdAt: string
  updatedAt: string
}

interface RunStageTransition {
  id: number
  runId: RunId
  fromStage: RunStage
  toStage: RunStage
  reason: string | null
  createdAt: string
}

// --- Evidence ---
type EvidenceType = 'ci' | 'review' | 'test' | 'lint' | 'custom'

interface Evidence {
  id: EvidenceId
  runId: RunId
  type: EvidenceType
  payload: Record<string, unknown>
  createdAt: string
}

// --- Gate Evaluation ---
interface GateEvaluation {
  id: number
  runId: RunId
  gateType: 'authorize_tool' | 'gate_check'
  target: string       // tool name or target stage
  result: 'allowed' | 'blocked'
  reason: string | null
  createdAt: string
}

// --- Session-Run Mapping (D21) ---
interface SessionRunMapping {
  sessionId: string
  runId: RunId
  harness: 'claude-agent-sdk' | 'opencode'
  createdAt: string
}
```

### 5.2 SQLite Schema

```sql
-- Factory (singleton for now, table for future multi-tenant)
CREATE TABLE factories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  factory_id TEXT NOT NULL REFERENCES factories(id),
  name TEXT NOT NULL UNIQUE,
  repos TEXT NOT NULL DEFAULT '[]',
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Agents
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  harness TEXT NOT NULL CHECK (harness IN ('claude-agent-sdk', 'opencode')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  spawn_config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Project-Agent assignments
CREATE TABLE project_agents (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('builder', 'reviewer', 'docs', 'watcher')),
  PRIMARY KEY (project_id, agent_id)
);

-- Specs
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'approved', 'implementing', 'done')),
  document TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Spec dependencies
CREATE TABLE spec_dependencies (
  spec_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hard', 'soft')),
  PRIMARY KEY (spec_id, depends_on_id)
);

-- Tasks
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  repos TEXT NOT NULL DEFAULT '[]',
  assigned_agent_id TEXT REFERENCES agents(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'blocked', 'ready', 'active', 'done', 'failed')),
  verification TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task dependencies
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

-- Decisions
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  spec_id TEXT REFERENCES specs(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  context TEXT NOT NULL,
  alternatives TEXT,
  decided_by TEXT NOT NULL,
  supersedes_id TEXT REFERENCES decisions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Runs
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  parent_run_id TEXT REFERENCES runs(id),
  stage TEXT NOT NULL DEFAULT 'accepted'
    CHECK (stage IN (
      'accepted', 'implementing', 'fixing', 'pre-push-review',
      'pushing', 'waiting-for-ci', 'waiting-for-review',
      'waiting-for-approval', 'merging', 'done', 'failed', 'stalled'
    )),
  session_id TEXT,
  branch TEXT,
  commit_sha TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  ci_status TEXT CHECK (ci_status IN (NULL, 'pending', 'pass', 'fail')),
  review_status TEXT CHECK (review_status IN (NULL, 'pending', 'pass', 'fail')),
  fail_reason TEXT,
  recoverable INTEGER NOT NULL DEFAULT 1,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  last_heartbeat TEXT,
  heartbeat_timeout_seconds INTEGER NOT NULL DEFAULT 120,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_runs_task_id ON runs(task_id);
CREATE INDEX idx_runs_session_id ON runs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_runs_stage ON runs(stage) WHERE stage NOT IN ('done', 'failed');

-- Run stage history (append-only)
CREATE TABLE run_stage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_run_stage_history_run ON run_stage_history(run_id);

-- Evidence
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  type TEXT NOT NULL CHECK (type IN ('ci', 'review', 'test', 'lint', 'custom')),
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_evidence_run ON evidence(run_id);

-- Gate evaluations (audit trail)
CREATE TABLE gate_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  gate_type TEXT NOT NULL CHECK (gate_type IN ('authorize_tool', 'gate_check')),
  target TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'blocked')),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gate_evaluations_run ON gate_evaluations(run_id);

-- Session-to-run mapping (D21, D25 — dispatcher sole owner)
CREATE TABLE session_run_mapping (
  session_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  harness TEXT NOT NULL CHECK (harness IN ('claude-agent-sdk', 'opencode')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- @edictum/core StorageBackend tables (D28)
-- Session namespaces keys internally (s:{runId}:{key}), backend is not session-aware.
-- Adapter routes get/set/delete → values table, increment → counters table.
CREATE TABLE edictum_session_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE edictum_session_values (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 6. Run State Machine

### 6.1 State Diagram

```
           accepted
              |
              v
         implementing --------> failed (recoverable?)
              |                     | yes -> Ductum Core resets to implementing
              |                     | no  -> terminal
              v
     gate: local tests pass?
        | blocked -> stay in implementing
        | allowed v
     pre-push-review (local review BEFORE push)
        | findings -> reset to fixing
        | clean v
           pushing
              |
              v
     +-------- PARALLEL LATCHES ---------+
     |                                   |
     |  waiting-for-ci    waiting-for-   |
     |  (watcher polls)   review         |
     |       |            (reviewer      |
     |       |             assigned)     |
     |       v                v          |
     |  ci: pass|fail   review: pass|   |
     |                  fail             |
     +-----------------------------------+
              |
              v
     both pass? -> gate: merge allowed?
     either fail? -> reset to fixing
              |
              v
     gate: merge
        | auto-merge -> merging -> done
        | human-merge -> waiting-for-approval
              | human approves v
           merging
              |
              v
            done ----> DAG re-evaluation:
                         unblock dependent tasks
```

### 6.2 Valid Transitions

| From | To | Trigger | Condition |
|------|----|---------|-----------|
| accepted | implementing | Agent starts work | Always |
| implementing | pre-push-review | gate_check("pre-push-review") | Local tests evidence attached |
| implementing | failed | ductum.fail() | Agent reports unrecoverable |
| pre-push-review | pushing | Review clean | No findings from pre-push review |
| pre-push-review | fixing | Review findings | Findings found |
| pushing | waiting-for-ci + waiting-for-review | Push complete | PR created, branch pushed |
| waiting-for-ci | (latch resolves) | Watcher injects CI evidence | CI pass or fail |
| waiting-for-review | (latch resolves) | Reviewer injects review evidence | Review pass or fail |
| (both latches pass) | merging OR waiting-for-approval | Gate evaluation | Merge mode config |
| (either latch fails) | fixing | Ductum Core reset | Evidence of failure |
| waiting-for-approval | merging | Human approves from dashboard | Approval recorded |
| merging | done | Merge succeeds | PR merged |
| fixing | pre-push-review | gate_check("pre-push-review") | Fixes pass local tests |
| fixing | failed | ductum.fail() | Agent reports unrecoverable |
| any active stage | stalled | Heartbeat timeout | No heartbeat for N seconds |
| stalled | implementing or fixing | New session resumes | Via get_context |

### 6.3 Sub-State Semantics

- **implementing** — Building from scratch against the task prompt. Full tool freedom within the stage.
- **fixing** — Remediating specific findings from CI or review. Narrower scope. Agent has the failing checks and review comments. Separately trackable for cost (D17, C7).
- **pre-push-review** — Local code review of the diff BEFORE pushing. Catches issues before burning CI runs. Maps to PROCESS.md Track 2 (D16).
- **waiting-for-ci** and **waiting-for-review** — Parallel latches after push. Both must resolve independently before the merge gate evaluates. If either fails, Ductum Core resets to fixing (D16, C6).
- **stalled** — Heartbeat timeout. The agent stopped sending heartbeats. Needs intervention.

### 6.4 Reset Rules (D20, C4)

Agents do NOT self-reset. `ductum.reset()` is internal to Ductum Core.

Reset triggers:
1. **CI failure:** Watcher injects CI failure evidence -> Ductum Core resets run to `fixing`
2. **Review failure:** Reviewer injects review findings -> Ductum Core resets run to `fixing`
3. **Pre-push review findings:** Pre-push reviewer reports findings -> Ductum Core resets to `fixing`
4. **Recoverable failure:** Agent calls `ductum.fail(reason, recoverable: true)` -> Ductum Core evaluates and may reset to `implementing` or `fixing`

Reset always records a stage transition in `run_stage_history` with the reason.

## 7. Enforcement Model

### 7.1 Two Enforcement Paths (C1, C3, D19)

**Path 1: authorize_tool (inner-loop, harness-internal)**

Every intercepted tool call passes through this. Not in the agent-visible MCP surface.

```
Harness intercepts tool call
  |
  v
authorize_tool(run_id, tool_name, tool_args)
  |
  v
Ductum Core resolves run -> gets workflow runtime
  |
  v
@edictum/core WorkflowRuntime.evaluate(session, envelope)
  - Is this tool allowed in the current workflow stage?
  - Do any stage checks apply (command_matches, etc.)?
  |
  v
Result: allowed -> tool executes
Result: blocked -> tool rejected, agent gets reason
  |
  v
Gate evaluation recorded in gate_evaluations table
```

**Path 2: gate_check (outer-loop, agent-visible MCP tool)**

Stage advancement request. Agent calls this to transition between major stages.

```
Agent calls ductum.gate_check(target_stage) [run_id resolved from MCP binding]
  |
  v
Ductum Core checks:
  1. Is from_stage -> target_stage a valid transition?
  2. Does the run have required evidence for the transition?
     - implementing -> pre-push-review: test evidence attached
     - pre-push-review -> pushing: review clean evidence
     - (both latches) -> merging: CI pass + review pass
  3. Custom per-project gate conditions
  |
  v
Result: allowed -> run stage updated, SSE event emitted
Result: blocked -> reason returned, agent must satisfy conditions
  |
  v
Gate evaluation recorded in gate_evaluations table
```

### 7.2 @edictum/core Integration

Ductum embeds `@edictum/core` for tool-level enforcement within workflow stages.

**Workflow YAML** (`workflows/coding-guard.yaml`):

Defines which tools are allowed at each stage. Stages in the workflow YAML correspond to the run state machine's active stages (accepted, implementing, fixing, pre-push-review, pushing, merging). Waiting states are not workflow stages — agents are not making tool calls during waits.

```yaml
apiVersion: edictum/v1
kind: Workflow
metadata:
  name: coding-guard
  description: Default coding workflow for Ductum runs — linear guardrail projection
stages:
  - id: accepted
    description: Agent has claimed the task, reading context
    tools: [Read, Glob, Grep]
    entry: []
    exit: []

  - id: implementing
    description: Building from task prompt
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    entry:
      - condition: 'stage_complete("__ductum_manual__")'
        message: "Stage advancement managed by Ductum"
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during implementing — use gate_check to advance"
    exit: []

  - id: fixing
    description: Remediating CI/review findings
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    entry:
      - condition: 'stage_complete("__ductum_manual__")'
        message: "Stage advancement managed by Ductum"
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during fixing — use gate_check to advance"
    exit: []

  - id: pre-push-review
    description: Local review of diff before push
    tools: [Read, Glob, Grep, Bash]
    entry:
      - condition: 'stage_complete("__ductum_manual__")'
        message: "Stage advancement managed by Ductum"
    checks:
      - command_not_matches: "git push"
        message: "git push blocked during review — reviewer must approve first"
    exit: []

  - id: pushing
    description: Pushing to remote and creating PR
    tools: [Bash]
    entry:
      - condition: 'stage_complete("__ductum_manual__")'
        message: "Stage advancement managed by Ductum"
    checks:
      - command_matches: "^git (push|remote)|^gh pr"
        message: "Only git push and gh pr commands allowed during push stage"
    exit: []

  - id: merging
    description: Merge in progress
    tools: [Bash]
    entry:
      - condition: 'stage_complete("__ductum_manual__")'
        message: "Stage advancement managed by Ductum"
    checks:
      - command_matches: "^gh pr merge"
        message: "Only gh pr merge allowed during merge stage"
    exit: []
```

**Sentinel entry gates (D29):** `stage_complete("__ductum_manual__")` references a stage that doesn't exist, so the gate never passes. This blocks auto-advance during `evaluate()`. `setStage()` and `reset()` bypass entry gates — they force-set `activeStage` directly. The previous approach using `stage_complete(previous_stage)` did NOT work because the runtime adds the current stage to `completedStages` before checking the next stage's entry gate.

**Runtime setup (D27):**

One `WorkflowRuntime` per run, not per factory. The `WorkflowDefinition` is shared (immutable, loaded once from YAML). Each runtime instance has its own async lock, so concurrent runs do not serialize.

```typescript
import { WorkflowRuntime, loadWorkflow } from '@edictum/core'

// Load workflow definition ONCE (immutable, shared)
const definition = await loadWorkflow('workflows/coding-guard.yaml')

// Create runtime PER RUN (each has its own lock)
function getRuntimeForRun(runId: RunId): WorkflowRuntime {
  if (!runtimes.has(runId)) {
    runtimes.set(runId, new WorkflowRuntime(definition))
  }
  return runtimes.get(runId)!
}
// Dispose when run completes: runtimes.delete(runId)
```

**Session management (D24, D28):**

Each run gets its own `@edictum/core` Session backed by Ductum's SQLite. The session key is `run.id` (stable across harness crashes and session resumes), NOT the volatile harness session ID. Session handles key namespacing internally (`s:{runId}:{key}`).

```typescript
import { Session } from '@edictum/core'

// CORRECT: stable run.id survives crash/resume (D24)
// Session internally prefixes all keys with s:{runId}:
const session = new Session(run.id, sqliteStorageBackend)

// WRONG: volatile harness sessionId fragments on resume
// const session = new Session(harnessSessionId, ...)
```

**StorageBackend interface (D28 — corrected from D23):**

The actual @edictum/core StorageBackend is 4 methods, NOT session-aware. Session handles namespacing. The adapter must implement:

```typescript
interface StorageBackend {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  increment(key: string, amount?: number): Promise<number>
}
```

Optional: implement `batchGet(keys: readonly string[])` — Session feature-detects it for batch counter reads.

Backed by two SQLite tables: `edictum_session_values` (string key-value) and `edictum_session_counters` (integer counters). The adapter routes `get/set/delete` to the values table and `increment` to the counters table. `increment` must be atomic (`INSERT...ON CONFLICT DO UPDATE SET value = value + ?`).

**Integration model (D28):**

Ductum owns the state machine. @edictum/core's WorkflowRuntime is a linear guardrail projection. The two stay in sync:

- **Forward moves** (implementing → pre-push-review → pushing → merging): call `runtime.setStage(session, stageId)` — non-destructive, preserves evidence/approvals
- **Backward moves** (pushing → fixing): call `runtime.reset(session, stageId)` — destructive, correctly clears stale evidence from the stages being rolled back
- **Tool authorization**: call `runtime.evaluate(session, envelope)` — checks tool is allowed in current workflow stage
- **Never call `recordResult()`** — Ductum does not use @edictum/core's auto-advance. Entry gates with `stage_complete()` conditions block auto-advance.

```typescript
// authorize_tool: evaluate tool call against current workflow stage
const runtime = getRuntimeForRun(run.id)
const session = new Session(run.id, sqliteStorageBackend)
const envelope = createEnvelope(toolName, toolArgs, { runId: run.id })
const evaluation = await runtime.evaluate(session, envelope)
// evaluation.action: WorkflowAction.ALLOW | WorkflowAction.BLOCK

// Forward stage move (Ductum state machine advanced)
await runtime.setStage(session, 'pre-push-review')  // preserves evidence

// Backward stage move (CI failed, rolling back)
await runtime.reset(session, 'fixing')  // clears stale push evidence — correct
```

**Constraint:** Session forbids `:` in sessionId. Ductum uses nanoid (URL-safe alphanumeric), which never produces colons.

### 7.3 Session-to-Run Binding (C5, D21, D22, D25)

Ductum Core maintains an authoritative `session_id -> run_id` mapping in the `session_run_mapping` table. The **dispatcher is the sole owner** of this mapping (D25) — harness adapters return a `sessionId` from `spawn()`, and the dispatcher records it.

Agents never see or pass `run_id` (D22). The MCP server is per-session and pre-bound to the run:
- **Push mode:** MCP server instantiated with `run_id` already set
- **Pull mode:** MCP server starts unbound; `accept()` or `get_context()` binds it

```
Dispatcher creates run
  |-> Calls adapter.spawn(run, task, prompt)
  |-> Adapter creates harness session, returns sessionId
  |-> Dispatcher records: session_id -> run_id (sole owner, D25)
  |-> Dispatcher starts per-session MCP server pre-bound to run_id
  |
  v
Agent makes tool call
  |-> Harness intercepts
  |-> Harness sends session_id to Ductum Core
  |-> Ductum Core resolves: session_id -> run_id
  |-> Ductum Core evaluates: authorize_tool(run_id, tool, args)
  |
Agent calls MCP tool (e.g., ductum.gate_check)
  |-> MCP server uses pre-bound run_id (agent never passes it)
  |-> Delegates to REST API with resolved run_id
```

**Two authorize-tool routes, same logic (D25):**
- `POST /api/runs/:id/authorize-tool` — for Claude adapter (knows run_id directly)
- `POST /api/internal/authorize-tool` — for OpenCode plugin (knows session_id, resolves to run_id)

Both call `EnforcementManager.authorizeTool(runId, tool, args)`.

## 8. MCP Tool Surface

12 agent-visible tools (D13, D20, D22). `ductum.reset()` is NOT agent-visible (D20).

**Agents never pass `run_id` (D22).** The MCP server is per-session and pre-bound to the active run. In push mode, it's pre-bound at spawn. In pull mode, `accept()` binds it. In crash recovery, `get_context()` binds it. All subsequent tools use the bound run implicitly.

### 8.1 Task Lifecycle

| Tool | Signature | Purpose |
|------|-----------|---------|
| `ductum.next_task` | `(project?: string, role?: string)` | Get next unblocked task matching optional filters |
| `ductum.accept` | `(task_id: string)` | Claim a task, create a new run, bind MCP to this run |
| `ductum.complete` | `(result: string, pr?: string)` | Mark run as done with result summary |

### 8.2 Progress Reporting

| Tool | Signature | Purpose |
|------|-----------|---------|
| `ductum.update` | `(message: string)` | Report progress (free-text, for dashboard) |
| `ductum.heartbeat` | `()` | Keep run alive, reset heartbeat timer |
| `ductum.decide` | `(decision: string, context: string, alternatives?: string[])` | Record a decision |

### 8.3 Enforcement + State Transitions

| Tool | Signature | Purpose |
|------|-----------|---------|
| `ductum.gate_check` | `(target_stage: string)` | Request stage transition (see section 7.1) |
| `ductum.wait` | `(waiting_for: string, timeout?: number)` | Enter wait state (ci, review, approval) |
| `ductum.fail` | `(reason: string, recoverable?: boolean)` | Report failure — Ductum Core decides reset or terminal |

### 8.4 Evidence + Linking

| Tool | Signature | Purpose |
|------|-----------|---------|
| `ductum.evidence` | `(type: string, payload: object)` | Attach CI results, review findings, test output |
| `ductum.link` | `(branch?: string, commit?: string, pr?: string)` | Associate git artifacts with the run |

### 8.5 Recovery

| Tool | Signature | Purpose |
|------|-----------|---------|
| `ductum.get_context` | `(task_id: string)` | Full state for crash recovery; also binds MCP to the existing stalled run |

### 8.6 Internal (Harness-Only, Not MCP)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `authorize_tool` | `(run_id: string, tool: string, args: object)` | Inner-loop tool authorization via @edictum/core (C1, D19) |
| `reset` | `(run_id: string, target_stage: string, reason: string)` | Stage regression — Ductum Core only (D20) |

## 9. Harness Adapters

### 9.1 Claude Harness Adapter (Claude Agent SDK)

**Runtime:** Claude Agent SDK (TypeScript)
**Subscription:** Claude Max (covered)
**Used for:** Mimi (primary builder)

```
Ductum Core
  |-- Creates agent session via Agent SDK
  |-- Injects system prompt with task context + Ductum MCP tools
  |-- Registers available tools (file ops, git, bash, etc.)
  |-- Wraps every tool call through authorize_tool:
  |     Agent wants to call `git push` ->
  |     Harness calls authorize_tool(run_id, "Bash", {command: "git push ..."})
  |     @edictum/core evaluates: current stage implementing -> BLOCKED
  |     Tool call rejected, agent gets reason
  |-- Monitors token usage per message (tokensIn, tokensOut)
  |-- Sends heartbeats automatically on each message
  +-- Detects session end / crash, updates run state
```

**Key capability:** Agent SDK exposes the full message/tool-call loop programmatically. Ductum sits in the execution path — not just a system prompt injection.

### 9.2 OpenCode Harness Adapter (D15)

**Runtime:** OpenCode server mode (`opencode serve`)
**Used for:** Codex (reviewer), GLM (docs/quick-fix)

**Plugin isolation model:** The Ductum plugin is stateless and generic. It does not contain per-run policy. All policy decisions delegate to Ductum Core via MCP.

```
OpenCode Plugin (stateless)                Ductum Core (session-aware)
  |                                            |
  |-- Agent wants to call `bash git push`      |
  |-- Plugin fires before_tool_call hook       |
  |-- Plugin calls authorize_tool ---------->  |
  |                                            |-- Resolves session_id -> run_id
  |                                            |-- Current stage: implementing
  |                                            |-- @edictum/core: BLOCKED
  |  <---------- { blocked, reason } ----------|
  |-- Plugin rejects tool call
  +-- Agent receives block reason
```

**Session-to-run mapping (D21, D25):** The dispatcher (sole owner) records the OpenCode session ID in `session_run_mapping` after the adapter returns from `spawn()`. The plugin passes the session identity on each tool call; Ductum Core resolves it to the correct run_id.

**Concurrent runs:** Multiple concurrent runs work because the plugin is stateless. Each tool call includes the session identity, and Ductum Core evaluates independently per-run. Dedicated servers only needed if OpenCode itself has per-session state that conflicts.

### 9.3 Hot Factory Pattern

```bash
# Persistent server on Mac Mini (stays warm)
opencode serve --port 4097 --hostname 0.0.0.0

# Ductum dispatches by attaching to warm server
opencode run --attach http://macmini:4097 "task prompt"
```

## 10. DAG Evaluation

### 10.1 Task DAG

Tasks within a spec form a DAG via `task_dependencies`. The DAG evaluator determines which tasks are `ready` (all dependencies satisfied) vs `blocked` (at least one dependency not `done`).

```typescript
function evaluateTaskDAG(specId: SpecId): TaskId[] {
  // 1. Get all tasks for spec
  // 2. Get all task dependencies
  // 3. For each task with status 'pending' or 'blocked':
  //    - If ALL dependencies have status 'done' -> mark 'ready'
  //    - Else -> mark 'blocked'
  // 4. Return list of newly-ready task IDs
}
```

### 10.2 Spec DAG

Specs within a project have dependencies via `spec_dependencies`. Hard dependencies block the spec from starting. Soft dependencies are informational only.

```typescript
function evaluateSpecDAG(projectId: ProjectId): SpecId[] {
  // 1. Get all specs for project
  // 2. Get all hard spec dependencies
  // 3. For each spec with status 'approved':
  //    - If ALL hard dependencies have status 'done' -> ready to start
  //    - Else -> blocked
  // 4. Return list of ready-to-start spec IDs
}
```

### 10.3 DAG Re-evaluation

When a run completes (`done`):
1. Mark the task as `done`
2. Re-evaluate the task DAG for the spec — newly unblocked tasks become `ready`
3. If all tasks in the spec are `done`, mark the spec as `done`
4. Re-evaluate the spec DAG for the project — newly unblocked specs become startable
5. Emit SSE events for all state changes
6. If push mode is active, dispatcher picks up newly ready tasks

## 11. Watcher System

Watchers are lightweight processes that monitor external state and report back. Modeled as child runs in the database (D26) — this gives cost tracking, history, and audit trail.

### 11.1 CI Watcher

Spawned after a run enters `pushing` and creates a PR. Polls `gh pr checks` at intervals.

```
CI Watcher lifecycle:
  1. Ductum Core creates child Run record (parent_run_id set, stage='accepted')
  2. Watcher polls: gh pr checks <pr_url> --json name,state,conclusion
  3. On CI complete:
     - Validates: evidence commit SHA matches parent run's current commit_sha
       (discards stale signals from previous push cycles)
     - Injects evidence with commit SHA
     - Ductum Core evaluates evidence against latch:
       - pass -> ci_status = 'pass', check if both latches resolved
       - fail -> ci_status = 'fail', reset parent run to 'fixing'
  4. Watcher child run marked 'done'
```

### 11.2 Review Watcher

Spawned after pushing to monitor review status. Can also trigger a reviewer agent assignment. Same child run model as CI watcher.

### 11.3 Watcher Lifecycle on Fix-Repush (D26)

When a parent run resets to `fixing` (from CI/review failure):
1. WatcherManager stops current watchers (child runs marked done)
2. Agent fixes code, re-pushes (new commit SHA on the parent run)
3. New watcher child runs spawned with new commit SHA context
4. Old watchers cannot resolve new latches (commit SHA mismatch)

### 11.4 Authority (Q8)

Watchers inject evidence but cannot directly trigger resets. Ductum Core evaluates evidence against gate rules and triggers resets when needed. This separation is critical — watchers observe and report, Ductum Core decides.

Duplicate signal handling: deduplicate by commit SHA (D26). Evidence whose commit SHA does not match the parent run's current `commit_sha` is discarded. For signals matching the current commit, first write wins.

Out-of-order signals: each latch resolves independently. The merge gate only evaluates when both have resolved.

## 12. Dispatcher

### 12.1 Push Mode (Automated)

Ductum watches for unblocked tasks and spawns agents automatically.

```
Dispatcher loop:
  1. Query: SELECT tasks WHERE status = 'ready' ORDER BY created_at
  2. For each ready task:
     a. Match agent by: task.assigned_agent_id (explicit) OR
        project_agents role + agent capabilities
     b. Spawn agent via harness adapter (Claude or OpenCode)
     c. Create run, record session mapping (dispatcher is sole owner, D25)
     d. Start per-session MCP server pre-bound to run_id (D22)
     e. Mark task as 'active'
  3. Sleep interval, repeat
```

### 12.2 Pull Mode (Manual)

Agent calls `ductum.next_task(project?, role?)`. Ductum returns the highest-priority unblocked task matching the filters.

### 12.3 Next-Task Prep

While a run is in any `waiting-*` state, the dispatcher can assign the same agent to prep work on the next task in the DAG. This is orchestration logic, not run state — the agent may be reading context for the next task while CI runs on the current one.

## 13. Dashboard

React + Vite + Tailwind CSS + shadcn/ui.

### 13.1 Views

| View | Route | Content |
|------|-------|---------|
| Projects | `/` | Project list with status badges |
| Project Detail | `/projects/:id` | Specs, agents, config |
| Spec Detail | `/specs/:id` | Task DAG visualization, decisions |
| Task Detail | `/tasks/:id` | Runs, prompt, verification checklist |
| Run Detail | `/runs/:id` | State machine view, stage history, evidence, gate log, cost |
| Agents | `/agents` | Agent registry, current assignments |
| Approvals | `/approvals` | Pending approval queue |

### 13.2 Real-Time Updates (SSE)

Single `EventSource` connection per view. Events:
- `run.stage_changed` — update run state machine view
- `run.evidence_attached` — append to evidence list
- `task.status_changed` — update DAG visualization
- `run.heartbeat` — update "last seen" indicator
- `approval.requested` — show in approval queue

### 13.3 Approval Actions

For `human-merge` gates, the dashboard shows:
- Pending approval with context (run summary, evidence, PR link)
- Approve / Reject buttons
- Approval records in decision trail

## 14. Acceptance Criteria

### 14.1 Core Lifecycle

- [ ] Create a factory, project, agents, spec, and tasks via CLI or API
- [ ] Tasks form a DAG; DAG evaluator correctly identifies `ready` tasks
- [ ] Agent pulls a task via `ductum.next_task()` and accepts it
- [ ] Run progresses through: accepted -> implementing -> pre-push-review -> pushing -> waiting-for-ci + waiting-for-review -> merging -> done
- [ ] Completing a run triggers DAG re-evaluation; dependent tasks become `ready`

### 14.2 Enforcement

- [ ] `authorize_tool` blocks `git push` during `implementing` stage via @edictum/core
- [ ] `authorize_tool` allows `git push` during `pushing` stage
- [ ] `gate_check("pre-push-review")` is blocked without test evidence attached
- [ ] `gate_check("pre-push-review")` is allowed with test evidence
- [ ] Stage transitions are recorded in `run_stage_history`
- [ ] Gate evaluations are recorded in `gate_evaluations`

### 14.3 Parallel Latches

- [ ] After push, CI and review latches run independently
- [ ] Both passing triggers merge gate evaluation
- [ ] CI failure resets run to `fixing` (via Ductum Core, not agent)
- [ ] Review failure resets run to `fixing` (via Ductum Core, not agent)
- [ ] Agent does NOT self-reset — only Ductum Core resets

### 14.4 Crash Recovery

- [ ] Run with stale heartbeat transitions to `stalled`
- [ ] `get_context` returns full run state: stage, evidence, git artifacts
- [ ] New agent session resumes stalled run from correct stage

### 14.5 Dashboard

- [ ] Dashboard shows live run state via SSE
- [ ] DAG visualization shows task dependencies and status
- [ ] Approval queue shows pending human-merge approvals
- [ ] Approve/reject from dashboard updates run state

### 14.6 Multi-Harness

- [ ] Claude agent (via Agent SDK) completes a full run lifecycle
- [ ] OpenCode agent (via plugin) completes a full run lifecycle
- [ ] Both harnesses enforce the same workflow rules through @edictum/core
- [ ] Session-to-run mapping works for both harnesses

### 14.7 Push Mode

- [ ] Dispatcher detects newly `ready` tasks
- [ ] Dispatcher spawns appropriate agent via correct harness
- [ ] Multiple runs execute concurrently across different agents

## 15. Dependencies

### 15.1 npm Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@edictum/core` | 0.3.2 | Workflow runtime, tool-call enforcement (setStage + reset) |
| `better-sqlite3` | ^11 | SQLite persistence |
| `hono` | ^4 | REST API server |
| `@modelcontextprotocol/sdk` | ^1 | MCP server |
| `commander` | ^12 | CLI framework |
| `nanoid` | ^5 | ID generation |
| `react` | ^19 | Dashboard UI |
| `vite` | ^6 | Dashboard build |
| `tailwindcss` | ^4 | Dashboard styling |
| `@claude-ai/agent-sdk` | latest | Claude harness adapter |

### 15.2 External Services

| Service | Required? | Purpose |
|---------|-----------|---------|
| edictum-api | No | Optional audit sink + ruleset storage (D14) |
| GitHub | Yes (for push mode) | PR creation, CI status, merge |
| OpenCode | For non-Claude agents | Agent session management |

## 16. Open Design Work

These items need resolution during implementation, not before:

1. **Claude Agent SDK tool-call interception API.** How exactly does the SDK expose the tool-call loop for wrapping? Verify the actual API surface in P7.
2. **OpenCode plugin crash resilience.** If the plugin fails to load, the agent runs unmonitored. Mitigation: the OpenCode adapter's heartbeat loop includes a plugin-health probe that routes a synthetic tool call through the OpenCode session — if the plugin is loaded, the probe reaches Ductum Core; if not, the adapter detects the absence and kills the session immediately. See P8 §4 for the probe design. Short heartbeat timeout is a backstop, not the primary detection mechanism.
3. **Token cost normalization.** Claude Agent SDK gives per-message token counts. OpenCode gives aggregate counts. Need a consistent cost model. Address in P7 and P8.
4. **Workflow YAML per-project overrides.** Projects may need different workflows (e.g., docs tasks skip CI). The workflow YAML path is configurable per-project, but the mechanism for loading multiple WorkflowRuntime instances needs implementation. Address in P2.
5. **SQLite concurrency under multiple dispatched runs.** better-sqlite3 uses WAL mode by default, which supports concurrent readers + one writer. Verify this is sufficient for Ductum's access patterns. Address in P1.
