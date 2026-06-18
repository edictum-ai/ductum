import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - reconcile orphaned runs', () => {
  it('POST /api/runs/reconcile marks orphaned runs failed when heartbeat is older than the threshold', async () => {
    fixture = await createFixture()
    const { task, spec, builder } = seedBase(fixture)

    // Run with a stale heartbeat — represents the survivor of a
    // previous server crash that the dispatcher's stall detector
    // doesn't see (it's not in dispatcher.activeSessions).
    const oldHeartbeat = new Date(Date.now() - 7200_000).toISOString() // 2h old
    const orphanRun = fixture.repos.runs.create({
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
      lastHeartbeat: oldHeartbeat,
      heartbeatTimeoutSeconds: 300,
    })

    // Run with a fresh heartbeat — must NOT be touched.
    const liveTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'Fresh API',
      prompt: 'fresh heartbeat',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })
    const liveRun = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: liveTask.id,
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
      heartbeatTimeoutSeconds: 300,
    })

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: {},
    })
    const result = response.json as {
      runsReconciled: Array<{
        runId: string
        reason: string
        disposition?: string
        staleSeconds?: number
        audit?: { evidenceId: string }
      }>
    }
    const orphanEntry = result.runsReconciled.find((r) => r.runId === orphanRun.id)
    expect(orphanEntry?.reason).toBe('orphaned')
    expect(orphanEntry?.disposition).toBe('genuinely-stalled')
    expect(orphanEntry?.staleSeconds).toBeGreaterThan(3600)
    expect(orphanEntry?.audit?.evidenceId).toEqual(expect.any(String))

    const orphanAfter = fixture.repos.runs.get(orphanRun.id)!
    expect(orphanAfter.terminalState).toBe('failed')
    expect(orphanAfter.failReason).toMatch(/orphaned|reconciled/)
    expect(fixture.repos.evidence.list(orphanRun.id).at(-1)?.payload).toMatchObject({
      kind: 'state-reconcile',
      reason: 'orphaned',
    })

    // Live run untouched.
    const liveAfter = fixture.repos.runs.get(liveRun.id)!
    expect(liveAfter.terminalState).toBeNull()
  })
})
