import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - merge basics', () => {
  const prOnlyProtectedBranchPolicy = {
    id: createId<'ConfigResourceId'>(),
    name: 'github-pr-only',
    projectId: null,
    path: '/tmp/workflow-profile.yaml',
    push: {
      protectedBranches: ['main'],
      allowedGitCommands: ['git status', 'git push'],
      protectedBranchMode: 'github_pull_request' as const,
    },
    renderedWorkflow: 'rendered',
    setupCommands: ['pnpm install --frozen-lockfile'],
    verifyCommands: ['pnpm test'],
  }

  it('mergeApprovedRun merges the worktree branch into main, cleans up branch + worktree', async () => {
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

      const result = await mergeApprovedRun(fixture.context, run.id)
      expect(result.commitSha).toBeTruthy()
      expect(result.branch).toBe('feature/x')
      expect(result.pushed).toBe(false)

      const after = fixture.repos.runs.get(run.id)!
      expect(after.stage).toBe('done')
      expect(after.terminalState).toBeNull()
      expect(after.commitSha).toBeTruthy()

      // The upstream main branch must now contain the feature commit.
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/Merge feature\/x/)
      expect(log.stdout).toMatch(/add feature/)

      const ls = await execFileAsync('git', ['-C', mergeFix.upstream, 'ls-tree', '-r', 'HEAD', '--name-only'])
      expect(ls.stdout).toMatch(/feature\.txt/)

      // feature/x branch must be DELETED after the merge.
      const branches = await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', '--list'])
      expect(branches.stdout).not.toMatch(/feature\/x/)

      // Worktree dir must be GONE after the merge.
      const worktreeList = await execFileAsync('git', ['-C', mergeFix.upstream, 'worktree', 'list'])
      expect(worktreeList.stdout).not.toContain(mergeFix.worktree)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun refuses a reviewed branch that is stale against current main', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await writeFile(join(mergeFix.upstream, 'parallel.txt'), 'landed while waiting\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'parallel.txt'])
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

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(
        /does not contain current main/,
      )

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).toMatch(/parallel change on main/)
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun refuses a dirty merge target before merging', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await writeFile(join(mergeFix.upstream, 'dirty.txt'), 'operator draft\n')

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

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(
        /merge target has uncommitted changes: \?\? dirty\.txt/,
      )

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('mergeApprovedRun with push=true pushes the merge to the configured remote', async () => {
    const mergeFix = await setupMergeFixture()
    // Create a bare repo to act as the remote and wire upstream to it.
    const remote = join(await mkdtemp(join(tmpdir(), 'ductum-remote-')), 'origin.git')
    try {
      await execFileAsync('git', ['init', '--bare', '-b', 'main', remote])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'remote', 'add', 'origin', remote])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'push', 'origin', 'main'])

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

      const result = await mergeApprovedRun(fixture.context, run.id, { push: true })
      expect(result.pushed).toBe(true)

      // The bare remote should now have the merge commit on main.
      const remoteLog = await execFileAsync('git', ['-C', remote, 'log', '--oneline', 'main'])
      expect(remoteLog.stdout).toMatch(/Merge feature\/x/)
    } finally {
      await rm(join(remote, '..'), { recursive: true, force: true }).catch(() => undefined)
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks local protected-branch merges when the workflow requires GitHub PR delivery', async () => {
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
        runtimeWorkflowProfile: prOnlyProtectedBranchPolicy,
      })

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(
        /requires GitHub pull-request delivery for protected branch main/i,
      )

      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline'])
      expect(log.stdout).not.toMatch(/Merge feature\/x/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
