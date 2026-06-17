import type { EnrichedRun, OperatorBrief, RepairReport } from '@/api/client'

export function layoutApiResponses(input: {
  runs?: EnrichedRun[]
  approvalRuns?: EnrichedRun[]
  brief?: OperatorBrief
  repair?: RepairReport
  search?: Record<string, unknown>
} = {}) {
  return {
    '/api/runs?limit=200': input.runs ?? [],
    '/api/runs?stage=ship': input.approvalRuns ?? [],
    '/api/factory/operator-brief': input.brief ?? operatorBrief(),
    '/api/repair': input.repair ?? repairReport(),
    ...(input.search ?? {}),
  }
}

export function operatorBrief(queue: Partial<OperatorBrief['queue']> = {}): OperatorBrief {
  return {
    generatedAt: '2026-06-16T10:00:00.000Z',
    dispatcher: {
      enabled: true,
      running: true,
      activeRuns: queue.activeRuns ?? 0,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-06-16T09:59:00.000Z',
      adapterCount: 1,
    },
    queue: {
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks: 0,
      needsOperator: 0,
      integrityIssues: 0,
      ...queue,
    },
    integrity: {
      readiness: 'clear',
      issueCount: 0,
      taskIssueCount: 0,
      runIssueCount: 0,
      externalTaskCount: 0,
      externalRunCount: 0,
      taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      issues: [],
    },
    telegram: { enabled: false, configured: false },
    agents: [],
    recommendedActions: [],
  }
}

export function repairReport(summary: Partial<RepairReport['summary']> = {}): RepairReport {
  return {
    generatedAt: '2026-06-16T10:00:00.000Z',
    items: [],
    groups: [],
    summary: {
      total: 0,
      blockers: 0,
      attention: 0,
      byArea: {
        factory_setup: 0,
        project_readiness: 0,
        repository_readiness: 0,
        agent_readiness: 0,
        provider_auth: 0,
        workflow_validity: 0,
        spec_start: 0,
        attempt_recovery: 0,
        migration: 0,
      },
      ...summary,
    },
  }
}

export function run(overrides: Partial<EnrichedRun>): EnrichedRun {
  return {
    id: 'run-default',
    taskId: 'task-default',
    agentId: 'agent-default',
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: [],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: '2026-06-16T09:00:00.000Z',
    updatedAt: '2026-06-16T09:00:00.000Z',
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    taskName: 'task-default',
    specName: 'spec-default',
    projectName: 'project-default',
    agentName: 'agent-default',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    ...overrides,
  }
}
