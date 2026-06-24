import { describe, expect, it } from 'vitest'

import { evaluateUnattendedApproval, type Evidence, type Run } from '../index.js'

describe('unattended approval policy budget guard', () => {
  it('fails closed when perRunHardUsd is missing and tells the operator how to recover', () => {
    const decision = evaluateUnattendedApproval({
      run: {
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
      },
      evidence: [],
      push: false,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('perRunHardUsd is not configured for unattended approval')
    expect(decision.recovery).toContain('budgets.perRunHardUsd')
  })
})
