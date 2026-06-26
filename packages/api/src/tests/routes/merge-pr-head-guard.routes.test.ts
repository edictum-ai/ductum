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
  setupMergeFixture,
  vi,
  writeFile,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR merge head guard', () => {
  it('checks the actual PR head ref before GitHub API merges', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: staleHead } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const prHeadSha = staleHead.toString().trim()
      await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', 'feature/pr-head', prHeadSha])
      await writeFile(join(mergeFix.upstream, 'base.txt'), 'current base\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'base.txt'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'current base'])
      await execFileAsync('git', ['-C', mergeFix.worktree, 'merge', 'main', '--no-ff', '-m', 'catch up feature'])

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
        name: 'Relinked PR merge',
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
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Relinked PR merge',
            head: { ref: 'feature/pr-head' },
            base: { ref: 'main' },
          }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('branch "feature/pr-head" does not contain current main')
      expect(fetchMock.mock.calls.map(([url]) => String(url)))
        .not.toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
