import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
import { STARTUP_RESUME_UNAVAILABLE_REASON } from '@ductum/core'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - stale approvals', () => {
  it('POST /api/runs/:id/approve rejects failed runs with stale approval latches', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/stale',
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
      failReason: 'orphaned by reconcile',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
      method: 'POST',
      body: {},
    })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('is failed; retry the run before approval')
  })

  it('POST /api/runs/:id/approve merges reviewed ship runs stalled by stale_slot_gc', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])

      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: 'stalled',
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: true,
        sessionId: null,
        branch: 'feature/x',
        commitSha: head.toString().trim(),
        prNumber: null,
        prUrl: null,
        worktreePaths: [mergeFix.worktree],
        ciStatus: null,
        reviewStatus: 'pass',
        failReason: 'stale_slot_gc',
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: '2026-04-04T11:55:59.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
      })

      expect(result.response.status).toBe(200)
      const body = result.json as Record<string, unknown>
      expect(body.success).toBe(true)
      expect(body.stage).toBe('done')
      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('done')
      expect(runSnap.terminalState).toBeNull()
      expect(runSnap.pendingApproval).toBe(false)
      expect(runSnap.failReason).toBeNull()
      expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toContain(
        'cleared stale_slot_gc metadata before approval merge',
      )

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve merges reviewed ship runs stalled by startup reconcile', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])

      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: 'stalled',
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: true,
        sessionId: null,
        branch: 'feature/x',
        commitSha: head.toString().trim(),
        prNumber: null,
        prUrl: null,
        worktreePaths: [mergeFix.worktree],
        ciStatus: null,
        reviewStatus: 'pass',
        failReason: STARTUP_RESUME_UNAVAILABLE_REASON,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: '2026-04-04T11:55:59.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
      })

      expect(result.response.status).toBe(200)
      expect((result.json as Record<string, unknown>).success).toBe(true)
      expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toContain(
        `cleared ${STARTUP_RESUME_UNAVAILABLE_REASON} metadata before approval merge`,
      )
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve returns 200 with success=false and keeps approval on stale approval failure (P21)', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      // Create a conflicting commit on main.
      await writeFile(join(mergeFix.upstream, 'feature.txt'), 'conflict\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'feature.txt'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'conflict on main'])

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
        branch: 'feature/x',
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: [mergeFix.worktree],
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

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
      })
      // 200 with structured failure — NOT 500.
      expect(result.response.status).toBe(200)
      const body = result.json as Record<string, unknown>
      expect(body.success).toBe(false)
      expect(body.stage).toBe('ship')
      expect(String(body.reason)).toContain('does not contain current main')
      expect(body.nextCommand).toBe(
        `deny ${run.id} --reason ${JSON.stringify('stale approval: branch feature/x no longer contains current main')}`,
      )
      expect(body.followupCommand).toBe(`retry ${run.id}`)

      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('ship')
      expect(runSnap.terminalState).toBeNull()
      expect(runSnap.pendingApproval).toBe(true)
      expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toEqual(
        expect.arrayContaining([
          'operator approved run; merging',
          expect.stringMatching(/^operator approval failed during merge:/),
        ]),
      )

      // Main is NOT polluted.
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve returns deny-then-retry guidance when the approval branch is stale', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await writeFile(join(mergeFix.upstream, 'README.md'), '# changed on main\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'README.md'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'parallel change on main'])

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
        branch: 'feature/x',
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: [mergeFix.worktree],
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

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
      })
      expect(result.response.status).toBe(200)
      const body = result.json as Record<string, unknown>
      expect(body.success).toBe(false)
      expect(body.stage).toBe('ship')
      expect(String(body.reason)).toContain('does not contain current main')
      expect(String(body.reason)).toContain('deny this approval')
      expect(String(body.reason)).not.toContain(`retry ${run.id}`)
      expect(body.nextCommand).toBe(
        `deny ${run.id} --reason ${JSON.stringify('stale approval: branch feature/x no longer contains current main')}`,
      )
      expect(body.followupCommand).toBe(`retry ${run.id}`)

      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('ship')
      expect(runSnap.terminalState).toBeNull()
      expect(runSnap.pendingApproval).toBe(true)
      expect(String(runSnap.failReason)).toContain('merge failed: merge approval blocked:')

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/parallel change on main/)
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
