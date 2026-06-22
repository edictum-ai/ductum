import { describe, expect, it } from 'vitest'

import { evaluateUnattendedApproval, type Evidence, type Run } from '../index.js'

describe('unattended approval policy', () => {
  it('keeps manual approval as default by blocking absent workflow policy', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ runtimeWorkflowProfile: null }),
      evidence: evidence(),
      push: false,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('workflow does not define unattended approval policy')
  })

  it('allows local unattended merge only with workflow policy, verification, review, and budget', () => {
    const decision = evaluateUnattendedApproval({
      run: run(),
      evidence: evidence(),
      push: false,
      budget: { perRunHardUsd: 10, perSpecHardUsd: 20, specCostUsd: 1 },
    })

    expect(decision).toMatchObject({ allowed: true, reasons: [] })
  })

  it('blocks unattended push when CI is unknown and no local substitute is defined', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ ciStatus: null }),
      evidence: evidence(),
      push: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('remote CI is not green')
  })

  it('blocks security flags, scope flags, and budget overage', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ costUsd: 2 }),
      evidence: [
        ...evidence(),
        ev({ kind: 'security-flag' }),
        ev({ scopeFlag: true }),
      ],
      push: false,
      budget: { perRunHardUsd: 1 },
    })

    expect(decision.reasons).toEqual(expect.arrayContaining([
      'security flag is present',
      'scope flag is present',
      'run budget overage: $2.0000 >= $1.00',
    ]))
  })
})

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1' as Run['id'],
    taskId: 'task-1' as Run['taskId'],
    agentId: 'agent-1' as Run['agentId'],
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feature/x',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/wt'],
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: {
      id: 'wf-1' as never,
      name: 'guard',
      projectId: null,
      path: 'workflow.yaml',
      unattended: { autoApprove: true, autoMerge: true, autoPush: true, pushRequires: 'remote_ci' },
    },
    ciStatus: 'pass',
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
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  }
}

function evidence(): Evidence[] {
  return [
    ev({ kind: 'verify', passed: true }),
    ev({ kind: 'internal-review', verdict: 'pass', passed: true }),
  ]
}

function ev(payload: Record<string, unknown>): Evidence {
  return {
    id: `ev-${Math.random()}` as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type: 'custom',
    payload,
    createdAt: '2026-06-22T00:00:00.000Z',
  }
}
