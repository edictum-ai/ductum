import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - PR merge', () => {
  it('mergeApprovedRun throws and leaves main clean when the merge has a conflict', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      // Create a conflicting commit on main so the merge will fail.
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

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(/merge|conflict/i)

      // Main is NOT polluted — the conflict commit is still HEAD.
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve merges PR-backed parity runs through gh and still cleans up locally', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh()
    const restoreDevMode = setDevGhCliMergeMode()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])

      fixture = await createFixture()
      const { task, builder, project } = seedBase(fixture)
      fixture.repos.projects.update(project.id, {
        config: { ...project.config, externalReviewRequired: true },
      })

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
        commitSha: head.toString().trim(),
        prNumber: 42,
        prUrl: 'https://github.com/acartag7/ductum/pull/42',
        worktreePaths: [mergeFix.worktree],
        ciStatus: 'pass',
        reviewStatus: 'pass',
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
      expect(body.success).toBe(true)
      expect(body.stage).toBe('done')

      const ghLog = await fakeGh.readLog()
      expect(ghLog).toContain('"args":["pr","merge","https://github.com/acartag7/ductum/pull/42"')
      expect(ghLog).toContain('--merge')
      expect(ghLog).toContain('--match-head-commit')

      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('done')
      expect(runSnap.terminalState).toBeNull()
      expect(runSnap.pendingApproval).toBe(false)

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/Merge feature\/x/)

      const branches = await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', '--list'])
      expect(branches.stdout).not.toMatch(/feature\/x/)

      const worktreeList = await execFileAsync('git', ['-C', mergeFix.upstream, 'worktree', 'list'])
      expect(worktreeList.stdout).not.toContain(mergeFix.worktree)
    } finally {
      restoreDevMode()
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('POST /api/runs/:id/approve returns structured failure and keeps approval state when gh merge fails', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    const restoreDevMode = setDevGhCliMergeMode()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])

      fixture = await createFixture()
      const { task, builder, project } = seedBase(fixture)
      fixture.repos.projects.update(project.id, {
        config: { ...project.config, externalReviewRequired: true },
      })

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
        commitSha: head.toString().trim(),
        prNumber: 42,
        prUrl: 'https://github.com/acartag7/ductum/pull/42',
        worktreePaths: [mergeFix.worktree],
        ciStatus: 'pass',
        reviewStatus: 'pass',
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
      expect(body.reason).toMatch(/gh pr merge failed|simulated gh merge failure/i)

      const ghLog = await fakeGh.readLog()
      expect(ghLog).toContain('"args":["pr","merge","https://github.com/acartag7/ductum/pull/42"')

      const runSnap = body.run as Record<string, unknown>
      expect(runSnap.stage).toBe('ship')
      expect(runSnap.terminalState).toBeNull()
      expect(runSnap.pendingApproval).toBe(true)
      expect(String(runSnap.failReason)).toMatch(/merge failed:/i)

      const branches = await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', '--list'])
      expect(branches.stdout).toMatch(/feature\/x/)

      const worktreeList = await execFileAsync('git', ['-C', mergeFix.upstream, 'worktree', 'list'])
      expect(worktreeList.stdout).toContain(mergeFix.worktree)
    } finally {
      restoreDevMode()
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun rolls back local PR merge side effects when required gh push fails', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failAfterMerge: true })
    const restoreDevMode = setDevGhCliMergeMode()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const { stdout: baseBefore } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'main'])
      fixture = await createFixture()
      const { task, builder, project } = seedBase(fixture)
      fixture.repos.projects.update(project.id, { config: { ...project.config, externalReviewRequired: true } })
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
        stage: 'ship', terminalState: null, resetCount: 0, completedStages: ['understand', 'implement'],
        blockedReason: null, pendingApproval: true, sessionId: null, branch: 'feature/x',
        commitSha: head.toString().trim(), prNumber: 42, prUrl: 'https://github.com/acartag7/ductum/pull/42',
        worktreePaths: [mergeFix.worktree], ciStatus: 'pass', reviewStatus: 'pass', failReason: null,
        recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0, lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      await expect(mergeApprovedRun(fixture.context, run.id, { requirePush: true })).rejects.toThrow(/gh pr merge failed/)

      const { stdout: baseAfter } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'main'])
      expect(baseAfter.trim()).toBe(baseBefore.trim())
    } finally {
      restoreDevMode()
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

})

function setDevGhCliMergeMode(): () => void {
  const previous = process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
  process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = 'gh-cli'
  return () => {
    if (previous == null) delete process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
    else process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = previous
  }
}
