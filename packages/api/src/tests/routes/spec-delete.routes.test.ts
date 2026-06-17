import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - spec deletion', () => {
  it('DELETE /api/specs/:id cascades to tasks, runs, and all run child rows', async () => {
    fixture = await createFixture()
    const { task, spec, builder } = seedBase(fixture)

    // Seed two runs, two activity rows, one evidence row, one
    // session mapping, one run update, one stage history entry,
    // plus a second task in the same spec to make sure BOTH tasks
    // get removed when the spec is dropped.
    const run1 = fixture.repos.runs.create({
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
      sessionId: 'session-r1',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'test fail',
      recoverable: false,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.1,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const task2 = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-REST API',
      prompt: '',
      repos: [],
      assignedAgentId: builder.id,
      status: 'done',
      verification: [],
    })
    const run2 = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task2.id,
      agentId: builder.id,
      parentRunId: run1.id,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-r2',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: false,
      tokensIn: 200,
      tokensOut: 100,
      costUsd: 0.2,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-r1',
      runId: run1.id,
      harness: 'claude-agent-sdk',
      controlToken: 'tok',
      workingDir: null,
    })
    fixture.repos.runUpdates.create(run1.id, 'progress')
    fixture.repos.runHistory.add({
      runId: run1.id,
      fromStage: 'understand',
      toStage: 'implement',
      reason: 'advance',
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run1.id,
      type: 'test',
      payload: { file: 'foo.ts' },
    })

    const deleteResponse = await requestJson(fixture.app, `/api/specs/${spec.id}`, {
      method: 'DELETE',
    })
    expect(deleteResponse.response.status).toBe(200)
    const result = deleteResponse.json as {
      specId: string
      tasksDeleted: number
      runsDeleted: number
      runsKilled: number
    }
    expect(result.specId).toBe(spec.id)
    expect(result.tasksDeleted).toBe(2)
    expect(result.runsDeleted).toBe(2)

    // Verify everything is actually gone.
    expect(fixture.repos.specs.get(spec.id)).toBeNull()
    expect(fixture.repos.tasks.get(task.id)).toBeNull()
    expect(fixture.repos.tasks.get(task2.id)).toBeNull()
    expect(fixture.repos.runs.get(run1.id)).toBeNull()
    expect(fixture.repos.runs.get(run2.id)).toBeNull()
    expect(fixture.repos.sessionRunMappings.getByRunId(run1.id)).toBeNull()
    expect(fixture.repos.runUpdates.list(run1.id)).toHaveLength(0)
    expect(fixture.repos.runHistory.list(run1.id)).toHaveLength(0)
    expect(fixture.repos.evidence.list(run1.id)).toHaveLength(0)
  })

  it('DELETE /api/specs/:id returns 404 for an unknown spec id', async () => {
    fixture = await createFixture()
    seedBase(fixture)
    const response = await requestJson(fixture.app, '/api/specs/nonexistent-spec-id', {
      method: 'DELETE',
    })
    expect(response.response.status).toBe(404)
  })
})
