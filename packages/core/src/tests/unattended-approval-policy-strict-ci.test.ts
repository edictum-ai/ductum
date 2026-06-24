import { describe, expect, it } from 'vitest'

import { DUCTUM_RUNTIME_EVIDENCE_PRODUCER, DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD, evaluateUnattendedApproval, type Evidence, type Run } from '../index.js'

describe('unattended approval policy strict CI evidence', () => {
  it('does not count neutral or empty CI as remote CI green', () => {
    const neutralDecision = evaluateUnattendedApproval({
      run: run(),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({ passed: true, commitSha: 'abc123', checks: [{ name: 'ci', status: 'completed', conclusion: 'neutral' }] }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })
    const emptyDecision = evaluateUnattendedApproval({
      run: run(),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({ passed: true, commitSha: 'abc123', checks: [] }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })

    expect(neutralDecision.reasons).toContain('remote CI is not green')
    expect(emptyDecision.reasons).toContain('remote CI is not green')
  })

  it('rejects stale or malformed CI evidence even when run.ciStatus says pass', () => {
    const staleDecision = evaluateUnattendedApproval({
      run: run({ ciStatus: 'pass' }),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({ passed: true, commitSha: 'old123', checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })
    const malformedDecision = evaluateUnattendedApproval({
      run: run({ ciStatus: 'pass' }),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({ passed: true, commitSha: 'abc123', checks: [{ name: 'ci', status: 'completed' }] }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })

    expect(staleDecision.reasons).toContain('remote CI is not green')
    expect(malformedDecision.reasons).toContain('remote CI is not green')
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

function ev(payload: Record<string, unknown>, type: Evidence['type'] = 'custom'): Evidence {
  return {
    id: `ev-${Math.random()}` as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type,
    payload: { ...payload, [DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD]: DUCTUM_RUNTIME_EVIDENCE_PRODUCER },
    createdAt: '2026-06-22T00:00:00.000Z',
  }
}
