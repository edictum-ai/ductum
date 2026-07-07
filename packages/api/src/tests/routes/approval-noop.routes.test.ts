import {
  createFixture,
  createId,
  describe,
  expect,
  execFileAsync,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupMergeFixture,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - no-op approvals', () => {
  it('routes zero-diff missing-worktree approvals into a failed terminal state distinguishable from shipped work (issue #292)', async () => {
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
    // Issue #292: a zero-diff approval must NEVER land in the same terminal
    // disposition as merged work. Stage stays at 'ship' and terminalState
    // becomes 'failed' — distinguishable from shipped work at the state level.
    expect(result.json).toMatchObject({ success: false })
    expect(String((result.json as { reason?: unknown }).reason)).toContain('zero-diff snapshot')
    expect(fixture.repos.runs.get(run.id)).toMatchObject({
      stage: 'ship',
      pendingApproval: false,
      terminalState: 'failed',
    })
    expect(fixture.repos.runUpdates.list(run.id).map((u) => u.message)).toContain(
      'failed no-op approval; rejected (missing worktree; zero-diff snapshot)',
    )
  })

  it('ignores stale zero-diff snapshot evidence for missing-worktree approvals', async () => {
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
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'worktree.snapshot',
        branch: 'feature/stale',
        commitSha: 'stale1234',
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
        timestamp: '2026-06-15T09:00:00.000Z',
      },
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

  it('uses repository fallback before zero-diff snapshot when recorded branch can be verified', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { project, spec, builder } = seedBase(fixture)
      const repository = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>() as never,
        projectId: project.id,
        name: 'ductum',
        spec: { localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'No-op fallback',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: [],
      })
      const commitSha = (await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])).stdout.trim()
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
        commitSha,
        prNumber: null,
        prUrl: null,
        worktreePaths: ['/tmp/ductum-missing-fallback-noop-worktree'],
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
          branch: 'feature/x',
          commitSha,
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
          verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' },
          timestamp: '2026-06-15T10:00:00.000Z',
        },
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done', branch: 'feature/x' })
      expect(fixture.repos.runs.get(run.id)).toMatchObject({
        stage: 'done',
        pendingApproval: false,
        terminalState: null,
      })
      const log = await execFileAsync('git', ['-C', mergeFix.upstream, 'log', '--oneline', 'main'])
      expect(log.stdout).toMatch(/add feature/)
      const ls = await execFileAsync('git', ['-C', mergeFix.upstream, 'ls-tree', '-r', 'HEAD', '--name-only'])
      expect(ls.stdout).toMatch(/feature\.txt/)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
