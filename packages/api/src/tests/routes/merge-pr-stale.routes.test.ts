import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  join,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupFakeGh,
  setupMergeFixture,
  writeFile,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR merge stale approvals', () => {
  it('keeps a PR-linked approval pending when the local branch is stale', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh()
    const restoreDevMode = setDevGhCliMergeMode()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
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

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })
      expect(result.response.status).toBe(200)
      const body = result.json as Record<string, unknown>
      expect(body.success).toBe(false)
      expect(body.stage).toBe('ship')
      expect(String(body.reason)).toContain('does not contain current main')
      expect(body.nextCommand).toBe(
        `deny ${run.id} --reason ${JSON.stringify('stale approval: branch feature/x no longer contains current main')}`,
      )
      expect(body.followupCommand).toBe(`retry ${run.id}`)
      expect(await fakeGh.readLog()).toBe('')
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
