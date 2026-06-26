import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD,
} from '@ductum/core'

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

describe('API routes - PR approval current-head CI snapshot', () => {
  it('records trusted current-head CI evidence from GitHub App auth before merging', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      const { stdout } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const currentHead = stdout.trim()
      const oldHead = '717dba550b24c4ff6d11d962d173a2e7ccdabae2'
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
        name: 'PR approval CI snapshot',
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
        commitSha: oldHead,
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        worktreePaths: [mergeFix.worktree],
        ciStatus: 'pass',
        reviewStatus: null,
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42')) {
          return new Response(JSON.stringify({
            number: 42,
            html_url: 'https://github.com/edictum-ai/ductum/pull/42',
            title: 'PR approval CI snapshot',
            head: { ref: 'feature/x', sha: currentHead },
            base: { ref: 'main' },
          }), { status: 200 })
        }
        if (url.endsWith(`/commits/${currentHead}/check-runs?per_page=100`)) {
          return new Response(JSON.stringify({
            check_runs: [
              { name: 'audit', status: 'completed', conclusion: 'success' },
              { name: 'bootstrap-self-test', status: 'completed', conclusion: 'success' },
              { name: 'build-and-test', status: 'completed', conclusion: 'success' },
            ],
          }), { status: 200 })
        }
        if (url.endsWith(`/commits/${currentHead}/statuses?per_page=100`)) {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(init?.method).toBe('PUT')
          expect(JSON.parse(String(init?.body))).toMatchObject({ sha: currentHead })
          return new Response(JSON.stringify({ sha: 'merge123', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(await fakeGh.readLog()).toBe('')
      expect(fixture.repos.evidence.list(run.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'ci',
          payload: expect.objectContaining({
            passed: true,
            commitSha: currentHead,
            source: 'github_pr_approval_snapshot',
            [DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD]: DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
          }),
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
})
