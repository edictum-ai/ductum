import { describe, expect, it } from 'vitest'

import { DUCTUM_RUNTIME_EVIDENCE_PRODUCER, DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD, evaluateUnattendedApproval, type Evidence, type Run } from '../index.js'

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
      gitClean: true,
    })

    expect(decision).toMatchObject({ allowed: true, reasons: [] })
  })

  it('blocks unattended push when CI is unknown and no local substitute is defined', () => {
    const decision = evaluateUnattendedApproval({
      run: run(),
      evidence: evidence().filter((item) => item.type !== 'ci'),
      push: true,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('remote CI is not green')
  })

  it('blocks when git clean state is unknown', () => {
    const decision = evaluateUnattendedApproval({
      run: run(),
      evidence: evidence(),
      push: false,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('git clean state is unknown')
  })

  it('does not count skipped CI as remote CI green', () => {
    const decision = evaluateUnattendedApproval({
      run: run(),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({
          passed: true,
          commitSha: 'abc123',
          checks: [{ name: 'ci', status: 'completed', conclusion: 'skipped' }],
        }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('remote CI is not green')
  })

  it('blocks invalid push requirements instead of skipping push prerequisites', () => {
    const decision = evaluateUnattendedApproval({
      run: run({
        runtimeWorkflowProfile: {
          id: 'wf-1' as never,
          name: 'guard',
          projectId: null,
          path: 'workflow.yaml',
          unattended: {
            autoApprove: true,
            autoMerge: true,
            autoPush: true,
            pushRequires: 'bad-value' as never,
          },
        },
      }),
      evidence: evidence(),
      push: true,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('workflow unattended push requirement is invalid')
  })

  it('does not accept CI evidence as workflow-local verification substitute', () => {
    const decision = evaluateUnattendedApproval({
      run: run({
        runtimeWorkflowProfile: {
          ...run().runtimeWorkflowProfile!,
          unattended: { autoApprove: true, autoMerge: true, autoPush: true, pushRequires: 'local_verify' },
        },
      }),
      evidence: [
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({
          passed: true,
          commitSha: 'abc123',
          checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
        }, 'ci'),
      ],
      push: true,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'structured verification evidence has not passed',
      'workflow local verification substitute is not green',
    ]))
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

  it('blocks stale evidence and dirty worktrees', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ commitSha: 'new456', updatedAt: '2026-06-22T01:00:00.000Z' }),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'old123' }),
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'old123' }),
      ],
      push: false,
      gitClean: false,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'git worktree has uncommitted changes',
      'structured verification evidence has not passed',
      'valid review/judge result has not passed',
    ]))
  })

  it('accepts runtime verification evidence stamped before ship advancement for the same commit', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ updatedAt: '2026-06-22T01:00:00.000Z' }),
      evidence: [
        { ...ev({ kind: 'verify', passed: true, commitSha: 'abc123' }), createdAt: '2026-06-22T00:30:00.000Z' },
        ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
        ev({ passed: true, commitSha: 'abc123', checks: [{ status: 'completed', conclusion: 'success' }] }, 'ci'),
      ],
      push: false,
      gitClean: true,
    })

    expect(decision).toMatchObject({ allowed: true, reasons: [] })
  })

  it('accepts runtime review evidence stamped before ship advancement for the same commit', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ updatedAt: '2026-06-22T01:00:00.000Z' }),
      evidence: [
        ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
        { ...ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }), createdAt: '2026-06-22T00:30:00.000Z' },
        ev({ passed: true, commitSha: 'abc123', checks: [{ status: 'completed', conclusion: 'success' }] }, 'ci'),
      ],
      push: false,
      gitClean: true,
    })

    expect(decision).toMatchObject({ allowed: true, reasons: [] })
  })

  it('rejects commitless evidence when the run has a commit even if evidence is newer', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ updatedAt: '2026-06-22T01:00:00.000Z' }),
      evidence: [
        { ...ev({ kind: 'verify', passed: true }), createdAt: '2026-06-22T02:00:00.000Z' },
        { ...ev({ kind: 'internal-review', verdict: 'pass', passed: true }), createdAt: '2026-06-22T02:00:00.000Z' },
      ],
      push: false,
      gitClean: true,
    })

    expect(decision.reasons).toEqual(expect.arrayContaining([
      'structured verification evidence has not passed',
      'valid review/judge result has not passed',
    ]))
  })

  it('allows retry after a previous unattended policy block is fixed', () => {
    const decision = evaluateUnattendedApproval({
      run: run({
        blockedReason: 'Needs Attention: unattended approval blocked: git clean state is unknown',
      }),
      evidence: evidence(),
      push: false,
      gitClean: true,
    })

    expect(decision).toMatchObject({ allowed: true, reasons: [] })
  })

  it('still blocks non-policy blocked reasons', () => {
    const decision = evaluateUnattendedApproval({
      run: run({ blockedReason: 'operator paused for scope review' }),
      evidence: evidence(),
      push: false,
      gitClean: true,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('run is blocked: operator paused for scope review')
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
    ev({ kind: 'verify', passed: true, commitSha: 'abc123' }),
    ev({ kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' }),
    ev({
      passed: true,
      commitSha: 'abc123',
      checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    }, 'ci'),
  ]
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
