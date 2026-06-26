import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupFakeGh,
  setupMergeFixture,
  vi,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR merge dev gh base lookup', () => {
  it('uses write-mode gh to resolve PR base for GitHub remotes without read auth', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh()
    const restoreDevModes = setDevGhCliWriteOnly()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const headSha = head.toString().trim()

      fixture = await createFixture()
      const { project, builder, spec } = seedBase(fixture)
      const repository = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>() as never,
        projectId: project.id,
        name: 'ductum',
        spec: {
          localPath: mergeFix.upstream,
          remoteUrl: 'https://github.com/acartag7/ductum.git',
          defaultBranch: 'main',
        },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'Dev gh PR merge',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: ['pnpm test'],
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
        commitSha: headSha,
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
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/pulls/42')) throw new Error('read API lookup should not run in write-mode gh path')
        if (url.endsWith('/pulls/42/merge')) {
          expect(init?.headers).toMatchObject({ Authorization: 'Bearer dev-gh-token' })
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: headSha })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      const ghLog = await fakeGh.readLog()
      expect(ghLog).toContain('"args":["pr","view","https://github.com/acartag7/ductum/pull/42"')
      expect(ghLog).toContain('"args":["auth","token"]')
      expect(process.env.DUCTUM_GITHUB_DEV_READ_MODE).toBeUndefined()
    } finally {
      restoreDevModes()
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('uses write-mode PAT for PR base lookup and skips absent local base refs', async () => {
    const mergeFix = await setupMergeFixture()
    const restoreDevModes = setDevPatWriteOnly()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const headSha = head.toString().trim()

      fixture = await createFixture()
      const { project, builder, spec } = seedBase(fixture)
      const repository = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>() as never,
        projectId: project.id,
        name: 'ductum',
        spec: {
          localPath: mergeFix.upstream,
          remoteUrl: 'https://github.com/acartag7/ductum.git',
          defaultBranch: 'main',
        },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'Dev PAT PR merge',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: ['pnpm test'],
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
        commitSha: headSha,
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
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer dev-pat-token' })
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/acartag7/ductum/pull/42',
            title: 'Release PR',
            head: { ref: 'feature/x' },
            base: { ref: 'release/missing-locally' },
          }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: headSha })
          return new Response(JSON.stringify({ sha: 'def789', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(process.env.DUCTUM_GITHUB_DEV_READ_MODE).toBeUndefined()
    } finally {
      restoreDevModes()
      await mergeFix.cleanup()
    }
  }, 60_000)
})

function setDevGhCliWriteOnly(): () => void {
  const previousWrite = process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
  const previousRead = process.env.DUCTUM_GITHUB_DEV_READ_MODE
  process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = 'gh-cli'
  delete process.env.DUCTUM_GITHUB_DEV_READ_MODE
  return () => {
    if (previousWrite == null) delete process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
    else process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = previousWrite
    if (previousRead == null) delete process.env.DUCTUM_GITHUB_DEV_READ_MODE
    else process.env.DUCTUM_GITHUB_DEV_READ_MODE = previousRead
  }
}

function setDevPatWriteOnly(): () => void {
  const previousWrite = process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
  const previousRead = process.env.DUCTUM_GITHUB_DEV_READ_MODE
  const previousToken = process.env.DUCTUM_GITHUB_DEV_TOKEN
  process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = 'pat'
  process.env.DUCTUM_GITHUB_DEV_TOKEN = 'dev-pat-token'
  delete process.env.DUCTUM_GITHUB_DEV_READ_MODE
  return () => {
    if (previousWrite == null) delete process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
    else process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = previousWrite
    if (previousRead == null) delete process.env.DUCTUM_GITHUB_DEV_READ_MODE
    else process.env.DUCTUM_GITHUB_DEV_READ_MODE = previousRead
    if (previousToken == null) delete process.env.DUCTUM_GITHUB_DEV_TOKEN
    else process.env.DUCTUM_GITHUB_DEV_TOKEN = previousToken
  }
}
