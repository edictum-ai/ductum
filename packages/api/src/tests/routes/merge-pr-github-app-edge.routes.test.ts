import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  requestJson,
  seedBase,
  setupFakeGh,
  setupMergeFixture,
  vi,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined

describe('API routes - GitHub App PR merge guardrails', () => {
  it('merges URL-only PR links through the GitHub REST merge endpoint', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'URL-only GitHub merge',
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
        commitSha: head.toString().trim(),
        prNumber: null,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
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
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: head.toString().trim() })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(await fakeGh.readLog()).toBe('')
      expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'github-pr-merge', prNumber: 42 }),
        }),
      ]))
    } finally {
      vi.restoreAllMocks()
      fixture?.close()
      fixture = undefined
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('prefers a relinked PR URL over a stale recorded PR number', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'Relinked GitHub merge',
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
        commitSha: head.toString().trim(),
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/99',
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
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/99/merge')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: head.toString().trim() })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(await fakeGh.readLog()).toBe('')
      expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'github-pr-merge', prNumber: 99 }),
        }),
      ]))
    } finally {
      vi.restoreAllMocks()
      fixture?.close()
      fixture = undefined
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('keeps approval pending when a PR-backed run has no recorded head SHA', async () => {
    const factoryDir = seedFactorySecretDir()
    fixture = await createFixture({ factoryDataDir: factoryDir })
    try {
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'Missing head SHA merge',
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
        commitSha: null,
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        worktreePaths: null,
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
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        stage: 'ship',
        reason: expect.stringMatching(/recorded commitSha|expected PR head/i),
      })
      expect(fixture.repos.runs.get(run.id)).toMatchObject({
        stage: 'ship',
        terminalState: null,
        pendingApproval: true,
        failReason: expect.stringMatching(/recorded commitSha|expected PR head/i),
      })
    } finally {
      vi.restoreAllMocks()
      fixture?.close()
      fixture = undefined
    }
  })
})
