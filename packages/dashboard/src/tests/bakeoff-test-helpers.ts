import type { Agent, EnrichedRun, Spec, Task } from '@/api/client'

export function agent(id: string, name: string, model: string, role: 'builder' | 'reviewer'): Agent {
  return { id, name, model, harness: 'codex-sdk', capabilities: [role], costTier: 10, spawnConfig: {}, createdAt: '' }
}

export function spec(): Spec {
  return {
    id: 's1',
    projectId: 'p1',
    name: 'Best patch',
    status: 'approved',
    document: 'Implement the patch',
    createdAt: '',
    updatedAt: '',
    strategy: 'best_of_n',
    strategyConfig: {
      kind: 'best_of_n',
      policy: 'quality-gated-cost-aware',
      strategyGroup: 'group-1',
      builderAgentIds: ['builder-a', 'builder-b'],
      reviewerAgentId: 'reviewer',
      verify: ['pnpm test'],
    },
  }
}

export function task(id: string, name: string, agentId: string): Task {
  return {
    id,
    specId: 's1',
    name,
    prompt: '',
    repos: [],
    assignedAgentId: agentId,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: [],
    createdAt: '',
    updatedAt: '',
  }
}

export function run(id: string, taskId: string, agentId: string, agentName: string, agentModel: string, overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    id,
    taskId,
    agentId,
    parentRunId: null,
    sessionId: null,
    stage: 'done',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    worktreePaths: null,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    taskName: taskId,
    specName: 'Best patch',
    projectName: 'ductum',
    agentName,
    agentModel,
    retryCount: 0,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  }
}

export function emptyDiff() {
  return { diff: '', files: [], totals: { files: 0, insertions: 0, deletions: 0 }, base: 'main', truncated: false }
}
