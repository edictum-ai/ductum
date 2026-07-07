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
import { buildGreenCheckRunsResponse, seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - operator PR adoption', () => {
  it('adopts an operator-created PR and merges it through the GitHub App approval path', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      vi.stubGlobal('fetch', buildFetchMock({ headSha, baseSha, mergeSha: 'def456merge' }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: '42', author: 'operator', reason: 'operator salvage branch verified locally' },
      })

      expect(adopted.response.status).toBe(201)
      expect(adopted.json).toMatchObject({
        alreadyAdopted: false,
        task: { id: task.id, status: 'active' },
        run: {
          stage: 'ship',
          pendingApproval: true,
          branch: 'feature/x',
          commitSha: headSha,
          prNumber: 42,
          prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
          ciStatus: 'pass',
          reviewStatus: 'pass',
        },
      })
      const runId = (adopted.json as { run: { id: string } }).run.id
      expect(fixture.repos.evidence.list(runId as never)).toEqual(expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ kind: 'operator-pr-adoption', headSha }) }),
        expect.objectContaining({ type: 'ci', payload: expect.objectContaining({ passed: true, commitSha: headSha }) }),
        expect.objectContaining({ type: 'review', payload: expect.objectContaining({ passed: true, commitSha: headSha }) }),
      ]))
      await expectRunIntegrity(fixture, runId, 'recorded')

      const approved = await requestJson(fixture.app, `/api/runs/${runId}/approve`, { method: 'POST' })

      expect(approved.response.status).toBe(200)
      expect(approved.json).toMatchObject({ success: true, stage: 'done' })
      expect(fixture.repos.evidence.list(runId as never)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            kind: 'github-pr-merge',
            actorType: 'github_app',
            prNumber: 42,
            headSha,
            mergeCommitSha: 'def456merge',
          }),
        }),
      ]))
      await expectRunIntegrity(fixture, runId, 'external')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('refuses adoption when exact-head CI is not green', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      vi.stubGlobal('fetch', buildFetchMock({ headSha, baseSha, ciConclusion: 'failure' }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: 'https://github.com/edictum-ai/ductum/pull/42' },
      })

      expect(adopted.response.status).toBe(400)
      expect(adopted.text).toContain('required CI checks are not green')
      expect(fixture.repos.runs.list(task.id)).toHaveLength(0)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('refuses adoption while review threads remain unresolved', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      vi.stubGlobal('fetch', buildFetchMock({
        headSha,
        baseSha,
        reviewThreads: [{ isResolved: false, path: 'packages/api/src/index.ts', line: 12 }],
      }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: '#42' },
      })

      expect(adopted.response.status).toBe(400)
      expect(adopted.text).toContain('review gate is not passing')
      expect(adopted.text).toContain('packages/api/src/index.ts:12')
      expect(fixture.repos.runs.list(task.id)).toHaveLength(0)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('refuses adoption until GitHub review decision is approved', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      vi.stubGlobal('fetch', buildFetchMock({ headSha, baseSha, reviewDecision: 'REVIEW_REQUIRED' }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: '#42' },
      })

      expect(adopted.response.status).toBe(400)
      expect(adopted.text).toContain('review decision is REVIEW_REQUIRED, expected APPROVED')
      expect(fixture.repos.runs.list(task.id)).toHaveLength(0)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('checks paginated review threads before adoption', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      vi.stubGlobal('fetch', buildFetchMock({
        headSha,
        baseSha,
        reviewPages: [
          { nodes: [], hasNextPage: true },
          { nodes: [{ isResolved: false, path: 'packages/api/src/page-two.ts', line: 44 }] },
        ],
      }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: '#42' },
      })

      expect(adopted.response.status).toBe(400)
      expect(adopted.text).toContain('packages/api/src/page-two.ts:44')
      expect(fixture.repos.runs.list(task.id)).toHaveLength(0)
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('rechecks review threads during approval for adopted PRs', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { fixture: seeded, task, headSha, baseSha } = await seedAdoptionTask(mergeFix.upstream, mergeFix.worktree)
      fixture = seeded
      const reviewThreads = { current: [] as Array<{ isResolved: boolean; path: string; line: number }> }
      vi.stubGlobal('fetch', buildFetchMock({ headSha, baseSha, reviewThreads: () => reviewThreads.current }))

      const adopted = await requestJson(fixture.app, `/api/tasks/${task.id}/adopt-pr`, {
        method: 'POST',
        body: { pr: '#42' },
      })
      expect(adopted.response.status).toBe(201)
      const runId = (adopted.json as { run: { id: string } }).run.id

      reviewThreads.current = [{ isResolved: false, path: 'packages/api/src/fresh.ts', line: 9 }]
      const approved = await requestJson(fixture.app, `/api/runs/${runId}/approve`, { method: 'POST' })

      expect(approved.response.status).toBe(200)
      expect(approved.json).toMatchObject({ success: false, stage: 'ship' })
      expect(approved.text).toContain('current PR review state is not passing')
      expect(approved.text).toContain('packages/api/src/fresh.ts:9')
      expect(fixture.repos.evidence.list(runId as never)).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-pr-merge' }) }),
      ]))
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

async function seedAdoptionTask(upstream: string, worktree: string) {
  const headSha = (await execFileAsync('git', ['-C', worktree, 'rev-parse', 'HEAD'])).stdout.trim()
  const baseSha = (await execFileAsync('git', ['-C', upstream, 'rev-parse', 'main'])).stdout.trim()
  const factoryDir = seedFactorySecretDir()
  const seeded = await createFixture({ factoryDataDir: factoryDir })
  const { project, builder, spec } = seedBase(seeded)
  const repository = seedRepositoryWithAuth(seeded, project.id, factoryDir)
  const updatedRepository = seeded.repos.repositories.update(repository.id, {
    spec: { ...repository.spec, localPath: upstream },
  })
  const task = seeded.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: updatedRepository.id,
    targetId: null,
    componentId: null,
    name: 'Adopt operator PR',
    prompt: 'adopt existing PR',
    repos: ['packages/api'],
    assignedAgentId: builder.id,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: ['pnpm test'],
  })
  return { fixture: seeded, task, headSha, baseSha }
}

type IntegrityReport = { runs: Array<{ runId: string; executionMode: string; executionIssues: unknown[] }> }
async function expectRunIntegrity(seed: TestFixture, runId: string, executionMode: string) {
  const integrity = await requestJson(seed.app, '/api/factory/execution-integrity')
  expect(integrity.response.status).toBe(200)
  expect((integrity.json as IntegrityReport).runs.find((item) => item.runId === runId)).toMatchObject({ executionMode, executionIssues: [] })
}

function buildFetchMock(options: {
  headSha: string
  baseSha: string
  ciConclusion?: 'success' | 'failure'
  reviewDecision?: string | null
  reviewThreads?: Array<{ isResolved: boolean; path: string; line: number }> | (() => Array<{ isResolved: boolean; path: string; line: number }>)
  reviewPages?: Array<{
    nodes: Array<{ isResolved: boolean; path: string; line: number }>
    hasNextPage?: boolean
    endCursor?: string | null
  }>
  mergeSha?: string
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
    if (url.endsWith('/pulls/42')) {
      return new Response(JSON.stringify({
        number: 42, state: 'open', merged: false,
        html_url: 'https://github.com/edictum-ai/ductum/pull/42',
        title: 'Adopt operator PR',
        head: { ref: 'feature/x', sha: options.headSha },
        base: { ref: 'main', sha: options.baseSha },
      }), { status: 200 })
    }
    const green = buildGreenCheckRunsResponse(options.headSha)
    if (url.endsWith(green.checkRunsUrl)) {
      return new Response(JSON.stringify({
        check_runs: [{ name: 'build-and-test', status: 'completed', conclusion: options.ciConclusion ?? 'success' }],
      }), { status: 200 })
    }
    if (url.endsWith(green.statusesUrl)) return new Response(green.statusesBody, { status: 200 })
    if (url.endsWith(green.branchProtectionUrl)) return new Response('Branch not protected', { status: 404 })
    if (url.endsWith('/graphql')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { after?: string | null } }
      const pageIndex = body.variables?.after == null ? 0 : Number(String(body.variables.after).replace(/^cursor-/, '')) + 1
      const pages = options.reviewPages ?? [{
        nodes: typeof options.reviewThreads === 'function' ? options.reviewThreads() : (options.reviewThreads ?? []),
      }]
      const page = pages[pageIndex] ?? { nodes: [] }
      return new Response(JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewDecision: options.reviewDecision ?? 'APPROVED',
              reviewThreads: {
                nodes: page.nodes,
                pageInfo: {
                  hasNextPage: page.hasNextPage ?? false,
                  endCursor: page.endCursor ?? `cursor-${pageIndex}`,
                },
              },
            },
          },
        },
      }), { status: 200 })
    }
    if (url.endsWith('/pulls/42/merge')) {
      expect(init?.method).toBe('PUT')
      expect(JSON.parse(String(init?.body))).toMatchObject({ sha: options.headSha })
      return new Response(JSON.stringify({ sha: options.mergeSha ?? 'merge-sha', merged: true }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}
