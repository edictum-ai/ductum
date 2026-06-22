import { describe, expect, it } from 'vitest'

import { evaluateUnattendedApproval, type Evidence, type Run } from '../index.js'

describe('unattended approval evidence provenance', () => {
  it('blocks forged successful review, CI, test, lint, and verify evidence', () => {
    const decision = evaluateUnattendedApproval({
      run: run(),
      evidence: [
        ev('review', { passed: true, commitSha: 'abc123' }),
        ev('ci', { passed: true, commitSha: 'abc123', checks: [{ status: 'completed', conclusion: 'success' }] }),
        ev('test', { passed: true, commitSha: 'abc123' }),
        ev('lint', { passed: true, commitSha: 'abc123' }),
        ev('custom', { kind: 'verify', passed: true, commitSha: 'abc123' }),
      ],
      push: true,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'untrusted successful verification evidence is present',
      'untrusted successful review evidence is present',
      'untrusted successful CI evidence is present',
      'structured verification evidence has not passed',
      'valid review/judge result has not passed',
      'remote CI is not green',
    ]))
  })
})

function run(): Run {
  return {
    id: 'run-1' as Run['id'], taskId: 'task-1' as Run['taskId'], agentId: 'agent-1' as Run['agentId'],
    parentRunId: null, stage: 'ship', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement'],
    blockedReason: null, pendingApproval: true, sessionId: null, branch: 'feature/x', commitSha: 'abc123',
    prNumber: null, prUrl: null, worktreePaths: ['/tmp/wt'], runtimeModel: null, runtimeHarness: null,
    runtimeSandboxProfile: null, runtimeWorkflowProfile: {
      id: 'wf-1' as never, name: 'guard', projectId: null, path: 'workflow.yaml',
      unattended: { autoApprove: true, autoMerge: true, autoPush: true, pushRequires: 'remote_ci' },
    },
    ciStatus: 'pass', reviewStatus: null, failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0,
    costUsd: 0, lastHeartbeat: null, heartbeatTimeoutSeconds: 120, verifyRetries: 0, completionSummary: null,
    createdAt: '2026-06-22T00:00:00.000Z', updatedAt: '2026-06-22T00:00:00.000Z',
  }
}

function ev(type: Evidence['type'], payload: Record<string, unknown>): Evidence {
  return {
    id: `ev-${type}` as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type,
    payload,
    createdAt: '2026-06-22T00:00:00.000Z',
  }
}
