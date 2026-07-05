import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - merge lineage', () => {
  it('mergeApprovedRun kills concurrent runs sharing the worktree before removing it', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const killed: string[] = []
      fixture.context.killRun = async (id) => { killed.push(id) }

      // Parent impl run that owns the worktree.
      const parent = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
        stage: 'ship', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement'],
        blockedReason: null, pendingApproval: true, sessionId: null,
        branch: 'feature/x', commitSha: null, prNumber: null, prUrl: null,
        worktreePaths: [mergeFix.worktree], ciStatus: null, reviewStatus: null,
        failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
        lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
      })

      // Active fix-r3 descendant still using the same worktree dir.
      const fixR3 = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id,
        parentRunId: parent.id,
        stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
        blockedReason: null, pendingApproval: false, sessionId: 'fix-r3-session',
        branch: 'feature/x', commitSha: null, prNumber: null, prUrl: null,
        worktreePaths: [mergeFix.worktree], ciStatus: null, reviewStatus: null,
        failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
        lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
      })

      const result = await mergeApprovedRun(fixture.context, parent.id)
      expect(result.commitSha).toBeTruthy()

      // The descendant run was killed BEFORE the worktree got removed,
      // and is now marked done so the dashboard does not show it as
      // orphaned.
      expect(killed).toContain(fixR3.id)
      const fixAfter = fixture.repos.runs.get(fixR3.id)
      expect(fixAfter?.stage).toBe('done')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun clears stale pending approval on already-done lineage parents', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)

      const parent = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
        stage: 'done', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement', 'ship'],
        blockedReason: 'stale approval latch', pendingApproval: true, sessionId: null,
        branch: 'feature/x', commitSha: null, prNumber: null, prUrl: null,
        worktreePaths: [mergeFix.worktree], ciStatus: null, reviewStatus: null,
        failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
        lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
      })

      const child = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: parent.id,
        stage: 'ship', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement'],
        blockedReason: null, pendingApproval: true, sessionId: null,
        branch: 'feature/x', commitSha: null, prNumber: null, prUrl: null,
        worktreePaths: [mergeFix.worktree], ciStatus: null, reviewStatus: null,
        failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
        lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
      })

      await mergeApprovedRun(fixture.context, child.id)

      expect(fixture.repos.runs.get(child.id)?.pendingApproval).toBe(false)
      expect(fixture.repos.runs.get(parent.id)?.pendingApproval).toBe(false)
      expect(fixture.repos.runs.get(parent.id)?.blockedReason).toBeNull()
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve drives mergeApprovedRun via the route and returns 200 with structured result', async () => {
    const mergeFix = await setupMergeFixture()
    try {
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
        body: { reason: 'reviewed CI and diff' },
      })
      expect(result.response.status).toBe(200)
      const body = result.json as Record<string, unknown>
      // Structured ApproveRunResult shape (P21).
      expect(body.success).toBe(true)
      expect(body.stage).toBe('done')
      expect(body.commitSha).toBeTruthy()
      expect(body.branch).toBe('feature/x')
      expect(body.pushed).toBe(false)
      // The included `run` snapshot reflects the post-merge state.
      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('done')
      expect(runSnap.terminalState).toBeNull()
      expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toEqual(
        expect.arrayContaining([
          'operator approved run; merging: reviewed CI and diff',
          expect.stringMatching(/^operator approved run; merge completed/),
        ]),
      )

      // Main has the merge commit.
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/chore\(merge\): integrate approved branch changes/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun can approve a recorded branch after the worker worktree was cleaned up', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { project, spec, builder } = seedBase(fixture)
      const repository = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>(),
        projectId: project.id,
        name: 'ductum-next',
        spec: { localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        name: 'repair branch',
        prompt: 'repair',
        repos: [mergeFix.upstream],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'feature/x'])
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
        stage: 'ship', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement'],
        blockedReason: null, pendingApproval: true, sessionId: null,
        branch: 'feature/x', commitSha: head.trim(), prNumber: null, prUrl: null,
        worktreePaths: [mergeFix.worktree], ciStatus: null, reviewStatus: 'pass',
        failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
        lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
      })
      await execFileAsync('git', ['-C', mergeFix.upstream, 'worktree', 'remove', mergeFix.worktree, '--force'])

      const result = await mergeApprovedRun(fixture.context, run.id)

      expect(result.branch).toBe('feature/x')
      expect(result.commitSha).toBeTruthy()
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'done', pendingApproval: false })
      expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toContain(
        'approval worktree was already cleaned up; merging recorded branch from repository path',
      )
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/chore\(merge\): integrate approved branch changes/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
