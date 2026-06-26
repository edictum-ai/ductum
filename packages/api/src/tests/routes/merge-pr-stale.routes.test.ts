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
  vi,
  writeFile,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

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
      const ghLog = await fakeGh.readLog()
      expect(ghLog).toContain('"args":["pr","view","https://github.com/acartag7/ductum/pull/42"')
      expect(ghLog).not.toContain('"args":["pr","merge"')
    } finally {
      restoreDevMode()
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('skips the local stale branch guard when the PR head ref is remote-only', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const headSha = head.toString().trim()
      await execFileAsync('git', ['-C', mergeFix.upstream, 'worktree', 'remove', mergeFix.worktree, '--force'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', '-D', 'feature/x'])

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
        branch: 'feature/x',
        commitSha: headSha,
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

      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Remote-only PR merge',
            head: { ref: 'feature/x' },
            base: { ref: 'main' },
          }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: headSha })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'github-pr-merge', prNumber: 42 }),
        }),
      ]))
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('checks PR-backed stale branches against the linked PR base branch', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const headSha = head.toString().trim()
      await execFileAsync('git', ['-C', mergeFix.upstream, 'branch', 'release/1.0'])
      await writeFile(join(mergeFix.upstream, 'main-only.txt'), 'landed on main only\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'main-only.txt'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'main only change'])

      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const updatedRepository = fixture.repos.repositories.update(repository.id, {
        spec: { ...repository.spec, defaultBranch: 'main', localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: updatedRepository.id,
        targetId: null,
        componentId: null,
        name: 'Develop PR merge',
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
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'Release PR',
            head: { ref: 'feature/x' },
            base: { ref: 'release/1.0' },
          }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: headSha })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(fixture.repos.runs.get(run.id)?.stage).toBe('done')
    } finally {
      vi.restoreAllMocks()
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
