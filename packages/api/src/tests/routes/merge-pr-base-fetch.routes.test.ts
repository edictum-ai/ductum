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
  setupMergeFixture,
  vi,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR merge base fetch guard', () => {
  it('fails closed when no local repository path can verify the PR base', async () => {
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
      name: 'Remote-only PR merge',
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
      branch: 'feature/remote-only',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/pulls/42')) {
        return new Response(JSON.stringify({
          number: 42,
          html_url: 'https://github.com/edictum-ai/ductum/pull/42',
          title: 'Remote-only PR merge',
          head: { ref: 'feature/remote-only' },
          base: { ref: 'main', sha: '1234567890abcdef1234567890abcdef12345678' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({ success: false, stage: 'ship' })
    expect(String((result.json as Record<string, unknown>).reason))
      .toContain('could not verify PR base main: no local repository path available')
    expect(fetchMock.mock.calls.map(([url]) => String(url)))
      .not.toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
  }, 60_000)

  it('fails closed when the fetched PR base SHA cannot be resolved locally', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: prHead } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const prHeadSha = prHead.toString().trim()
      const missingBaseSha = '1234567890abcdef1234567890abcdef12345678'

      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const updatedRepository = fixture.repos.repositories.update(repository.id, {
        spec: { ...repository.spec, localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: updatedRepository.id,
        targetId: null,
        componentId: null,
        name: 'Missing base PR merge',
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
        commitSha: prHeadSha,
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
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Missing base PR merge',
            head: { ref: 'feature/x' },
            base: { ref: 'main', sha: missingBaseSha },
          }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain(`could not verify PR base main at ${missingBaseSha}`)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('fails closed when the pinned PR head SHA cannot be resolved locally', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: baseHead } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'main'])
      const baseSha = baseHead.toString().trim()
      const missingHeadSha = 'abcdef1234567890abcdef1234567890abcdef12'

      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const updatedRepository = fixture.repos.repositories.update(repository.id, {
        spec: { ...repository.spec, localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: updatedRepository.id,
        targetId: null,
        componentId: null,
        name: 'Missing head PR merge',
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
        branch: 'feature/missing',
        commitSha: missingHeadSha,
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
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Missing head PR merge',
            head: { ref: 'feature/missing' },
            base: { ref: 'main', sha: baseSha },
          }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain(`could not verify PR head feature/missing at ${missingHeadSha}`)
      expect(fetchMock.mock.calls.map(([url]) => String(url)))
        .not.toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
