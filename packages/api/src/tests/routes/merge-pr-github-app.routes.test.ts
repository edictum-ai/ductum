import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync, randomBytes } from 'node:crypto'

import {
  createId,
  encryptFactorySecret,
  formatFactorySecretRef,
  loadFactorySecretKey,
} from '@ductum/core'

import {
  createFixture,
  describe,
  execFileAsync,
  expect,
  it,
  join,
  requestJson,
  seedBase,
  setupFakeGh,
  setupMergeFixture,
  tmpdir,
  vi,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined

describe('API routes - PR merge through GitHub App auth', () => {
  it('uses the GitHub REST merge endpoint and records separate operator and app evidence', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      fixture.repos.projects.update(project.id, { config: { ...project.config, externalReviewRequired: true } })
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'REST API GitHub merge',
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

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          expect(init?.method).toBe('PUT')
          expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
          expect(JSON.parse(String(init?.body))).toEqual({
            merge_method: 'merge',
            commit_title: `Merge feature/x (run ${run.id.slice(0, 8)})`,
            commit_message: 'Approved via Ductum factory.',
            sha: head.toString().trim(),
          })
          return new Response(JSON.stringify({ sha: 'def456', merged: true }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(await fakeGh.readLog()).toBe('')
      const evidence = fixture.repos.evidence.list(run.id)
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ payload: expect.objectContaining({ kind: 'operator-approval', actorType: 'operator' }) }),
        expect.objectContaining({
          payload: expect.objectContaining({
            kind: 'github-pr-merge',
            actorType: 'github_app',
            prNumber: 42,
            prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
            mergeMethod: 'merge',
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

  it('fails loudly and keeps approval pending when the GitHub API rejects the merge', async () => {
    const mergeFix = await setupMergeFixture()
    const fakeGh = await setupFakeGh({ failMerge: true })
    try {
      const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const factoryDir = seedFactorySecretDir()
      fixture = await createFixture({ factoryDataDir: factoryDir })
      const { project, builder, spec } = seedBase(fixture)
      fixture.repos.projects.update(project.id, { config: { ...project.config, externalReviewRequired: true } })
      const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        targetId: null,
        componentId: null,
        name: 'REST API GitHub merge failure',
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

      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
        }
        if (url.endsWith('/pulls/42/merge')) {
          return new Response('Head branch was modified. Review and retry approval.', { status: 409 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }))

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        stage: 'ship',
        reason: expect.stringMatching(/GitHub API PR merge failed/i),
      })
      expect(await fakeGh.readLog()).toBe('')
      expect(fixture.repos.runs.get(run.id)).toMatchObject({
        stage: 'ship',
        terminalState: null,
        pendingApproval: true,
        failReason: expect.stringMatching(/merge failed: GitHub API PR merge failed:/i),
      })
    } finally {
      vi.restoreAllMocks()
      fixture?.close()
      fixture = undefined
      await fakeGh.cleanup()
      await mergeFix.cleanup()
    }
  }, 60_000)
})

function seedFactorySecretDir(): string {
  const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-gh-merge-'))
  mkdirSync(join(factoryDir, '.ductum'), { recursive: true })
  writeFileSync(join(factoryDir, '.ductum', 'secrets.key'), randomBytes(32), { mode: 0o600 })
  chmodSync(join(factoryDir, '.ductum', 'secrets.key'), 0o600)
  return factoryDir
}

function seedRepositoryWithAuth(fixture: TestFixture, projectId: string, factoryDir: string) {
  const loadedKey = loadFactorySecretKey(factoryDir)
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
    publicKeyEncoding: { format: 'pem', type: 'pkcs1' },
  }).privateKey
  const encrypted = encryptFactorySecret(JSON.stringify({
    mode: 'github_app',
    appId: '123',
    installationId: '456',
    privateKey,
  }), loadedKey)
  fixture.repos.secrets.create({
    id: 'github-app',
    name: 'github-app',
    scope: 'project',
    projectId: projectId as never,
    description: null,
    status: 'configured',
    keySource: encrypted.keySource,
    payload: encrypted.payload,
    lastRotatedAt: null,
    lastTestedAt: null,
  })
  return fixture.repos.repositories.create({
    id: createId<'RepositoryId'>() as never,
    projectId: projectId as never,
    name: 'ductum',
    spec: {
      remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      authRef: formatFactorySecretRef('github-app'),
    },
  })
}
