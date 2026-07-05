import { syncGitHubShipArtifacts } from '../../lib/github-lifecycle.js'
import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  mergeApprovedRun,
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

describe('API routes - non-empty head gate', () => {
  it('blocks GitHub ship sync before opening a PR when HEAD has no commits ahead of base', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', defaultBranch: 'main' },
    })
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'empty ship',
      status: 'approved',
      document: '# imported',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'Do nothing',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: [],
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
      pendingApproval: false,
      sessionId: null,
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/worktree'],
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

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const gitCalls: string[][] = []

    await expect(syncGitHubShipArtifacts({
      repos: {
        runs: fixture.repos.runs,
        tasks: fixture.repos.tasks,
        specs: fixture.repos.specs,
        repositories: fixture.repos.repositories,
        secrets: fixture.repos.secrets,
        evidence: fixture.repos.evidence,
      },
      runGit: async (args) => {
        gitCalls.push(args)
        if (args.includes('rev-parse')) return { stdout: 'abc123\n' }
        if (args.includes('rev-list')) return { stdout: '0\n' }
        return { stdout: '' }
      },
      now: () => new Date('2026-07-05T12:00:00.000Z'),
    }, run.id)).rejects.toThrow(/no commits ahead of main/)

    expect(gitCalls).toContainEqual(['-C', '/tmp/worktree', 'rev-list', '--count', 'main..HEAD'])
    expect(gitCalls.some((args) => args.includes('push'))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks local merge when the branch points at the base tip', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      await execFileAsync('git', ['-C', mergeFix.upstream, 'checkout', 'main'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'reset', '--hard', 'feature/x'])

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

      await expect(mergeApprovedRun(fixture.context, run.id)).rejects.toThrow(/no commits ahead of main/)
      expect(fixture.repos.runs.get(run.id)?.stage).toBe('ship')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks GitHub App PR merge when the PR head equals the base tip', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: baseOut } = await execFileAsync('git', ['-C', mergeFix.upstream, 'rev-parse', 'main'])
      const baseSha = baseOut.trim()
      await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', 'feature/empty', baseSha])

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
        name: 'Empty PR merge',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: builder.id,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: [],
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
        branch: 'feature/empty',
        commitSha: baseSha,
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
      fixture.repos.evidence.create({
        id: createId<'EvidenceId'>(),
        runId: run.id,
        type: 'ci',
        payload: {
          passed: true,
          commitSha: baseSha,
          ductumEvidenceProducer: 'ductum.watcher',
          checks: [{ name: 'unit', status: 'completed', conclusion: 'success' }],
        },
      })
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Empty PR merge',
            head: { ref: 'feature/empty', sha: baseSha },
            base: { ref: 'main', sha: baseSha },
          }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason)).toContain('no commits ahead of main')
      expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
        'https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge',
      )
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})
