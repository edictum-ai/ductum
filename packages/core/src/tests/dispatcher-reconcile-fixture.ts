import { vi } from 'vitest'

import type {
  DispatcherMcpServer,
  HarnessAdapter,
} from '../dispatcher-support.js'
import type { ActiveDispatchSession } from '../dispatcher-types.js'
import type { AttemptLease } from '../attempt-lease.js'
import type {
  AgentRepo,
  AttemptLeaseRepo,
  EvidenceRepo,
  RunCheckpointRepo,
  RunRepo,
  SessionRunMappingRepo,
  TaskRepo,
} from '../repos/interfaces.js'
import type { RunActivityRepo } from '../repos/run-activity.js'
import type { RunCheckpoint } from '../run-checkpoint.js'
import type { RunStateMachine } from '../state-machine.js'
import type { Agent, Evidence, Run, RunActivity, RunId, SessionRunMapping, Task } from '../types.js'

export function makeRun(id: string, agentId: string = 'agent-1', overrides: Partial<Run> = {}): Run {
  return {
    id: id as RunId,
    taskId: 'task-1' as Run['taskId'],
    agentId: agentId as Run['agentId'],
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'sess-' + id,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/wt-' + id],
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completionSummary: null,
    ...overrides,
  }
}

export function makeTask(id: string = 'task-1', name: string = 'P1', overrides: Partial<Task> = {}): Task {
  return {
    id: id as Task['id'],
    specId: 'spec-1' as Task['specId'],
    targetId: null,
    repositoryId: null,
    componentId: null,
    name,
    prompt: 'prompt',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'active',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeMapping(runId: string, harness: SessionRunMapping['harness'] = 'codex-app-server'): SessionRunMapping {
  return {
    sessionId: 'sess-' + runId,
    runId: runId as RunId,
    harness,
    controlToken: 'tok-' + runId,
    workingDir: '/tmp/wt-' + runId,
    harnessSessionId: 'thread-' + runId,
    createdAt: new Date().toISOString(),
  }
}

export function harness(over: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    spawn: vi.fn(),
    kill: vi.fn(),
    isAlive: vi.fn().mockResolvedValue(true),
    ...over,
  }
}

export function fixture(opts: {
  runs: Run[]
  mappings: SessionRunMapping[]
  leases?: AttemptLease[]
  checkpoints?: RunCheckpoint[]
  tasks?: Task[]
  activity?: Record<string, RunActivity[]>
  adapters?: Map<string, HarnessAdapter>
  active?: Map<RunId, ActiveDispatchSession>
  dryRun?: boolean
}) {
  const runs = new Map(opts.runs.map((r) => [r.id, { ...r } as Run] as const))
  const mappings = new Map(opts.mappings.map((m) => [m.runId, { ...m }] as const))
  const leases = new Map((opts.leases ?? []).map((l) => [l.runId, { ...l } as AttemptLease] as const))
  const checkpoints = new Map((opts.checkpoints ?? []).map((c) => [c.runId, { ...c } as RunCheckpoint] as const))
  const tasks = new Map((opts.tasks ?? [makeTask()]).map((t) => [t.id, { ...t } as Task] as const))
  const activity = opts.activity ?? {}

  const runRepo = {
    get: (id: RunId) => runs.get(id) ?? null,
    getActive: () => [...runs.values()].filter((r) => r.terminalState == null),
    updateFailure: vi.fn((id: RunId, reason: string | null, recoverable: boolean) => {
      const run = runs.get(id)!
      const updated = { ...run, failReason: reason, recoverable } as Run
      runs.set(id, updated)
      return updated
    }),
  } as unknown as RunRepo

  const taskRepo = {
    get: (id: Task['id']) => tasks.get(id) ?? null,
    list: (specId: Task['specId']) => [...tasks.values()].filter((task) => task.specId === specId),
  } as unknown as TaskRepo

  const sessionMappingRepo = {
    getByRunId: (id: RunId) => mappings.get(id) ?? null,
    delete: vi.fn((sid: string) => {
      for (const [k, v] of mappings) {
        if (v.sessionId === sid) mappings.delete(k)
      }
    }),
  } as unknown as SessionRunMappingRepo

  const agentRepo = {
    get: (id: string) => ({ id, name: 'agent', model: 'm', harness: 'codex-app-server' } as unknown as Agent),
  } as unknown as AgentRepo

  const stateMachine = {
    markStalled: vi.fn((id: RunId) => {
      const run = runs.get(id)!
      const updated = { ...run, terminalState: 'stalled' } as Run
      runs.set(id, updated)
      return updated
    }),
  } as unknown as RunStateMachine

  const closedMcps: DispatcherMcpServer[] = []
  const closeMcpServer = vi.fn(async (mcp: DispatcherMcpServer) => {
    closedMcps.push(mcp)
  })

  const onSessionEnd = vi.fn()
  const evidence: Evidence[] = []
  const evidenceRepo = {
    list: (runId: RunId) => evidence.filter((item) => item.runId === runId),
    create: vi.fn((item: Omit<Evidence, 'createdAt'>) => {
      const row = { ...item, createdAt: new Date().toISOString() } as Evidence
      evidence.push(row)
      return row
    }),
  } as unknown as EvidenceRepo

  const runActivityRepo = {
    list: (runId: RunId, limit = 200) => (activity[runId] ?? []).slice(-limit),
  } as unknown as RunActivityRepo

  const attemptLeaseRepo = {
    getLatestForRun: (runId: RunId) => leases.get(runId) ?? null,
    getActiveForRun: (runId: RunId, now = new Date()) => {
      const lease = leases.get(runId) ?? null
      if (lease == null || lease.status !== 'active') return null
      if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
        leases.set(runId, { ...lease, status: 'expired', updatedAt: now.toISOString() })
        return null
      }
      return lease
    },
    expireRun: vi.fn((runId: RunId, now = new Date()) => {
      const lease = leases.get(runId)
      if (lease != null) leases.set(runId, { ...lease, status: 'expired', updatedAt: now.toISOString() })
    }),
  } as unknown as AttemptLeaseRepo

  const runCheckpointRepo = {
    get: (runId: RunId) => checkpoints.get(runId) ?? null,
  } as unknown as RunCheckpointRepo
  const resumeRun = vi.fn(async (runId: RunId) => ({ ...runs.get(runId)!, id: `${runId}-resumed` as RunId }))

  return {
    runs,
    mappings,
    tasks,
    runRepo,
    taskRepo,
    sessionMappingRepo,
    agentRepo,
    stateMachine,
    activeSessions: opts.active ?? new Map<RunId, ActiveDispatchSession>(),
    harnessAdapters: opts.adapters ?? new Map<string, HarnessAdapter>(),
    resolveRuntimeAgentForRun: () => null,
    createMcpServer: vi.fn(async () => ({ close: vi.fn() } as DispatcherMcpServer)),
    closeMcpServer,
    closedMcps,
    onSessionEnd,
    evidence,
    evidenceRepo,
    runActivityRepo,
    attemptLeaseRepo,
    runCheckpointRepo,
    resumeRun,
    now: () => new Date('2026-06-14T12:00:00.000Z'),
    dryRun: opts.dryRun,
  }
}
