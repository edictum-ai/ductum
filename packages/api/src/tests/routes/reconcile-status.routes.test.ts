import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - reconcile status', () => {
  it('POST /api/runs/reconcile marks tasks failed when every run is terminal but task is still active', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)

    // Force the task into 'active' but every run is terminal-failed.
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const failedRuns: Run['id'][] = []
    for (let i = 0; i < 3; i += 1) {
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
        failReason: `attempt ${i + 1} failed`,
        recoverable: false,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })
      failedRuns.push(run.id)
    }

    const reconcileResponse = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: {},
    })
    expect(reconcileResponse.response.status).toBe(200)
    const result = reconcileResponse.json as {
      scannedTasks: number
      tasksReconciled: Array<{
        taskId: string
        toStatus: string
        reason: string
        auditRunId?: string
        audit?: { evidenceId: string }
      }>
    }
    expect(result.scannedTasks).toBe(1)
    expect(result.tasksReconciled).toHaveLength(1)
    expect(result.tasksReconciled[0]?.taskId).toBe(task.id)
    expect(result.tasksReconciled[0]?.toStatus).toBe('failed')
    expect(result.tasksReconciled[0]?.reason).toMatch(/attempt 3 failed/)
    expect(result.tasksReconciled[0]?.auditRunId).toBe(failedRuns.at(-1))
    expect(result.tasksReconciled[0]?.audit?.evidenceId).toEqual(expect.any(String))
    expect(fixture.repos.evidence.list(failedRuns.at(-1)!).at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'task_failed',
    })

    // Task is now actually marked failed.
    const taskAfter = fixture.repos.tasks.get(task.id)
    expect(taskAfter?.status).toBe('failed')
  })

  it('POST /api/runs/reconcile clears stale approval latches on done runs', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const staleRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: 'waiting for approval',
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/already-merged',
      commitSha: 'abc123',
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

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: {},
    })
    const result = response.json as {
      runsReconciled: Array<{ runId: string; reason: string; audit?: { evidenceId: string } }>
    }

    expect(result.runsReconciled).toContainEqual(expect.objectContaining({
      runId: staleRun.id,
      reason: 'stale_approval',
      audit: expect.objectContaining({ evidenceId: expect.any(String) }),
    }))
    expect(fixture.repos.evidence.list(staleRun.id).at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'stale_approval',
    })
    const after = fixture.repos.runs.get(staleRun.id)!
    expect(after.stage).toBe('done')
    expect(after.pendingApproval).toBe(false)
    expect(after.blockedReason).toBeNull()
  })

  it('POST /api/runs/reconcile exposes audit for approval-lineage repairs', async () => {
    fixture = await createFixture()
    const { task, spec, builder } = seedBase(fixture)
    const root = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
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
    const fixTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-rest-api',
      prompt: 'fix',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const fixRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: fixTask.id,
      agentId: builder.id,
      parentRunId: root.id,
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

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: {},
    })
    const result = response.json as {
      runsReconciled: Array<{ runId: string; reason: string; audit?: { evidenceId: string } }>
    }
    const entry = result.runsReconciled.find((item) => item.runId === fixRun.id)

    expect(entry).toMatchObject({
      runId: fixRun.id,
      reason: 'approval_lineage',
      audit: expect.objectContaining({ evidenceId: expect.any(String) }),
    })
    expect(fixture.repos.runs.get(fixRun.id)?.stage).toBe('done')
    expect(fixture.repos.tasks.get(fixTask.id)?.status).toBe('active')
    expect(fixture.repos.evidence.list(fixRun.id).at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'approval_lineage',
    })
  })
})
