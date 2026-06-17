import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - no-op approvals', () => {
  it('approves missing-worktree runs when a zero-diff snapshot proves no merge is needed', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/noop',
      commitSha: 'abc1234',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum-missing-noop-worktree'],
      ciStatus: null,
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'worktree.snapshot',
        branch: 'feature/noop',
        commitSha: 'abc1234',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
        timestamp: '2026-06-15T10:00:00.000Z',
      },
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: true,
      stage: 'done',
      run: { stage: 'done', pendingApproval: false, terminalState: null },
    })
    expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toContain(
      'approved no-op run; recorded worktree was already cleaned up',
    )
  })

  it('refuses missing-worktree approvals without zero-diff snapshot evidence', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/unknown',
      commitSha: 'abc1234',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum-missing-unknown-worktree'],
      ciStatus: null,
      reviewStatus: 'pass',
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      stage: 'ship',
    })
    expect(String((result.json as { reason?: unknown }).reason)).toContain('could not resolve worktree git state')
    expect(fixture.repos.runs.get(run.id)).toMatchObject({
      stage: 'ship',
      pendingApproval: true,
      terminalState: null,
    })
  })
})
