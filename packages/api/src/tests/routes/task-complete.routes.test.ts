import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - task completion', () => {
  it('POST /api/runs/reconcile dryRun=true reports without writing the DB', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)

    fixture.repos.tasks.updateStatus(task.id, 'active')
    fixture.repos.runs.create({
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
      failReason: 'one failed run',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: { dryRun: true },
    })
    const result = response.json as { dryRun: boolean; tasksReconciled: unknown[] }
    expect(result.dryRun).toBe(true)
    expect(result.tasksReconciled).toHaveLength(1)

    // Task is still active — dry run did not write.
    const taskAfter = fixture.repos.tasks.get(task.id)
    expect(taskAfter?.status).toBe('active')
  })

  it('POST /api/tasks/:id/complete marks the task done and records a decision when no run exists', async () => {
    fixture = await createFixture()
    const { spec, task } = seedBase(fixture)

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: 'shipped operator-direct on main' },
    })

    expect(response.response.status).toBe(200)
    const result = response.json as {
      task: { id: string; status: string }
      alreadyDone: boolean
      decision: { id: string; decidedBy: string; decision: string; taskId: string; specId: string } | null
      evidence: unknown
    }
    expect(result.alreadyDone).toBe(false)
    expect(result.task.status).toBe('done')
    expect(result.decision).not.toBeNull()
    expect(result.decision!.decidedBy).toBe('unknown-operator')
    expect(result.decision!.decision).toContain('operator-complete')
    expect(result.decision!.taskId).toBe(task.id)
    expect(result.decision!.specId).toBe(spec.id)
    expect(result.evidence).toBeNull()

    expect(fixture.repos.tasks.get(task.id)?.status).toBe('done')
    const decisions = fixture.repos.decisions.list({ taskId: task.id })
    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.context).toBe('shipped operator-direct on main')
  })

  it('POST /api/tasks/:id/complete is idempotent when the task is already done', async () => {
    fixture = await createFixture()
    const { task } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')

    const first = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: 'no-op' },
    })
    expect(first.response.status).toBe(200)
    const firstResult = first.json as { alreadyDone: boolean; decision: unknown }
    expect(firstResult.alreadyDone).toBe(true)
    expect(firstResult.decision).toBeNull()

    expect(fixture.repos.decisions.list({ taskId: task.id })).toHaveLength(0)
  })

  it('POST /api/tasks/:id/complete attaches operator-note evidence to the most recent run when one exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: ['understand'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'feature/old',
      commitSha: 'cafef00d',
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'reviewer chain broken',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: 'verified by hand; reviewer chain unreliable' },
    })

    expect(response.response.status).toBe(200)
    const result = response.json as { evidence: { id: string; runId: string; payload: Record<string, unknown> } | null }
    expect(result.evidence).not.toBeNull()
    expect(result.evidence!.runId).toBe(run.id)
    expect(result.evidence!.payload.kind).toBe('operator-note')
    expect(result.evidence!.payload.source).toBe('task-complete')

    const evidence = fixture.repos.evidence.list(run.id)
    expect(evidence.some((e) => (e.payload as Record<string, unknown>).source === 'task-complete')).toBe(true)
  })

  it('POST /api/tasks/:id/complete rejects empty reason', async () => {
    fixture = await createFixture()
    const { task } = seedBase(fixture)

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: '   ' },
    })

    expect(response.response.status).toBe(400)
    expect(fixture.repos.tasks.get(task.id)?.status).not.toBe('done')
  })

  it('POST /api/tasks/:id/complete rejects when the task has an active run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.runs.create({
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

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: 'short-circuit' },
    })

    expect(response.response.status).toBe(409)
    expect(fixture.repos.tasks.get(task.id)?.status).not.toBe('done')
  })
})
