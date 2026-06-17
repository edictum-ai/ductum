import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - retry and reject', () => {
  it('POST /api/runs/:id/retry records an operator audit update', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    fixture.repos.tasks.updateRetry(task.id, 3, '2026-05-01T00:00:00.000Z')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'dead session',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('ready')
    expect(fixture.repos.tasks.get(task.id)?.retryCount).toBe(0)
    expect(fixture.repos.tasks.get(task.id)?.retryAfter).toBeNull()
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toBe(
      'operator retried run; task returned to ready queue',
    )
  })

  it('POST /api/runs/:id/retry rejects superseded runs once a newer attempt exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const staleRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'dead session',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })
    const latestRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
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
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${staleRun.id}/retry`, { method: 'POST' })

    expect(result.response.status).toBe(409)
    expect(result.json).toMatchObject({ error: expect.stringContaining('newer run') })
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.runs.get(latestRun.id)?.stage).toBe('implement')
    expect(fixture.repos.runUpdates.list(staleRun.id)).toEqual([])
  })

  it('POST /api/runs/:id/reject records the reason and makes the run retryable', async () => {
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
      completedStages: [],
      blockedReason: 'waiting for approval',
      pendingApproval: true,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/reject`, {
      method: 'POST',
      body: { reason: 'needs a cleaner Settings pass' },
    })

    expect(result.response.status).toBe(200)
    const after = fixture.repos.runs.get(run.id)!
    expect(after.stage).toBe('ship')
    expect(after.terminalState).toBe('failed')
    expect(after.pendingApproval).toBe(false)
    expect(after.blockedReason).toBeNull()
    expect(after.resetCount).toBe(0)
    expect(after.failReason).toBe('approval rejected: needs a cleaner Settings pass')
    expect(after.recoverable).toBe(true)
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toBe(
      'approval rejected: needs a cleaner Settings pass',
    )
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      passed: false,
      reason: 'needs a cleaner Settings pass',
      source: 'operator_rejection',
    })
    expect(fixture.repos.gateEvaluations.list(run.id).at(-1)).toMatchObject({
      gateType: 'gate_check',
      target: 'approval.reject',
      result: 'blocked',
      reason: 'needs a cleaner Settings pass',
      observed: false,
    })
    expect(fixture.repos.runHistory.list(run.id).at(-1)).toMatchObject({
      fromStage: 'ship',
      toStage: 'ship',
      reason: 'failed: approval rejected: needs a cleaner Settings pass',
    })
  })
})
