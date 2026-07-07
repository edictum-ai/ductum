import { describe, expect, it } from 'vitest'

import { evaluateRunExecutionIntegrity, evaluateTaskExecutionIntegrity } from '../execution-integrity.js'
import type { Evidence, Run, Spec, Task } from '../types.js'

describe('execution integrity - operator PR adoption', () => {
  it('treats pending operator PR adoption as recorded work without Ductum lineage', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'ship', pendingApproval: true, sessionId: null, worktreePaths: null }),
      [evidence({ payload: { kind: 'operator-pr-adoption', prNumber: 42, headSha: 'abc123' } })],
    )

    expect(integrity.mode).toBe('recorded')
    expect(integrity.hasDuctumLineage).toBe(false)
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.issues).toEqual([])
  })

  it('does not scan operator adoption reasons as prose success evidence', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'ship', pendingApproval: true, sessionId: null, worktreePaths: null }),
      [evidence({ payload: { kind: 'operator-pr-adoption', prNumber: 42, headSha: 'abc123', reason: 'PASS: verified locally' } })],
    )

    expect(integrity.mode).toBe('recorded')
    expect(integrity.issues).toEqual([])
  })

  it('treats merged operator PR adoption as a recorded completion outcome', () => {
    const mergedRun = run({ stage: 'done', sessionId: null, worktreePaths: null })
    const mergedEvidence = [
      evidence({ payload: { kind: 'operator-pr-adoption', prNumber: 42, headSha: 'abc123' } }),
      evidence({ payload: { kind: 'github-pr-merge', prNumber: 42, headSha: 'abc123', merged: true } }),
    ]
    const runIntegrity = evaluateRunExecutionIntegrity(mergedRun, mergedEvidence)
    const taskIntegrity = evaluateTaskExecutionIntegrity(
      baseTask({ status: 'done' }),
      { strategy: 'normal' } as Spec,
      [mergedRun],
      new Map([[mergedRun.id, mergedEvidence]]),
    )

    expect(runIntegrity.mode).toBe('external')
    expect(runIntegrity.externalOutcome).toBe('done')
    expect(runIntegrity.issues).toEqual([])
    expect(taskIntegrity.mode).toBe('external')
    expect(taskIntegrity.issues).toEqual([])
  })

  it('keeps normal Ductum PR merge evidence on orchestrated lineage', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run(),
      [evidence({ payload: { kind: 'github-pr-merge', prNumber: 42, headSha: 'abc123', merged: true } })],
    )

    expect(integrity.mode).toBe('orchestrated')
    expect(integrity.hasDuctumLineage).toBe(true)
    expect(integrity.hasExternalOutcome).toBe(false)
    expect(integrity.externalOutcome).toBeNull()
    expect(integrity.issues).toEqual([])
  })

  it('does not let operator PR adoption alone satisfy completed run integrity', () => {
    const integrity = evaluateRunExecutionIntegrity(
      run({ stage: 'done', sessionId: null, worktreePaths: null }),
      [evidence({ payload: { kind: 'operator-pr-adoption', prNumber: 42, headSha: 'abc123' } })],
    )

    expect(integrity.mode).toBe('inconsistent')
    expect(integrity.issues.map((issue) => issue.code)).toEqual([
      'done_run_without_lineage_or_external_outcome',
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
    prNumber: 42,
    prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
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
    name: 'Adopt operator PR',
    prompt: '',
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
