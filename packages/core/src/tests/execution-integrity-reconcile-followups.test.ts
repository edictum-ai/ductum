import { describe, expect, it } from 'vitest'

import { evaluateRunExecutionIntegrity, evaluateTaskExecutionIntegrity } from '../execution-integrity.js'
import type { Evidence, Run, Spec, Task } from '../types.js'

describe('execution integrity reconcile follow-ups', () => {
  it('treats reconcile merged evidence as Ductum lineage for done runs', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ sessionId: null, worktreePaths: null, commitSha: null }),
      [evidence({ payload: { kind: 'state-reconcile', reason: 'merged', mergeCommit: 'abc123' } })],
    )

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.issues).toEqual([])
  })

  it('treats approval-lineage reconcile evidence as Ductum lineage for done tasks', () => {
    const staleFixRun = run({ sessionId: null, worktreePaths: null, commitSha: null })
    const integrity = evaluateTaskExecutionIntegrity(
      baseTask({ status: 'done', name: 'fix-P1-r1' }),
      { strategy: 'normal' } as Spec,
      [staleFixRun],
      new Map([[staleFixRun.id, [evidence({ payload: { kind: 'state-reconcile', reason: 'approval_lineage', rootRunId: 'run-root' } })]]]),
    )

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.issues).toEqual([])
  })

  it('keeps done tasks inconsistent when the only external outcome is on a non-done run', () => {
    const staleRun = run({
      stage: 'implement',
      terminalState: 'failed',
      sessionId: null,
      worktreePaths: null,
      commitSha: null,
    })
    const integrity = evaluateTaskExecutionIntegrity(
      baseTask({ status: 'done' }),
      { strategy: 'normal' } as Spec,
      [staleRun],
      new Map([[staleRun.id, [evidence({ payload: { kind: 'external-outcome', outcome: 'fixed', reason: 'operator fixed it elsewhere' } })]]]),
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.externalOutcome).toBe(null)
    expect(integrity.issues.map((issue) => issue.code)).toEqual([
      'external_outcome_on_non_done_run',
      'done_task_without_lineage_or_external_outcome',
    ])
  })
})

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1' as Run['id'],
    taskId: 'task-1' as Run['taskId'],
    agentId: 'agent-1' as Run['agentId'],
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: 'feat/demo',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/worktree'],
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
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    specId: 'spec-1' as Task['specId'],
    targetId: null,
    name: 'P1',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'evidence-1' as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type: 'custom',
    payload: {},
    createdAt: '2026-04-29T00:00:00.000Z',
    ...overrides,
  }
}
