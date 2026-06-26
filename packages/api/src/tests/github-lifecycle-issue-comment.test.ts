import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  createId,
  encryptFactorySecret,
  formatFactorySecretRef,
  loadFactorySecretKey,
} from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncGitHubShipArtifacts } from '../lib/github-lifecycle.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'
import { registerRouteTestCleanup } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('GitHub lifecycle issue comment sync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('comments back on imported issues using GitHub App auth', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-gh-app-'))
    mkdirSync(join(factoryDir, '.ductum'), { recursive: true })
    writeFileSync(join(factoryDir, '.ductum', 'secrets.key'), randomBytes(32), { mode: 0o600 })
    chmodSync(join(factoryDir, '.ductum', 'secrets.key'), 0o600)
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
      projectId: project.id,
      description: null,
      status: 'configured',
      keySource: encrypted.keySource,
      payload: encrypted.payload,
      lastRotatedAt: null,
      lastTestedAt: null,
    })

    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: {
        remoteUrl: 'https://github.com/edictum-ai/ductum.git',
        authRef: formatFactorySecretRef('github-app'),
      },
    })
    const source = {
      kind: 'github-issue' as const,
      provider: 'github' as const,
      repoOwner: 'edictum-ai',
      repoName: 'ductum',
      issueNumber: 12,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
      title: 'core: imported issue',
      labels: ['needs-triage'],
      importedAt: '2026-06-23T12:00:00.000Z',
      formId: 'ductum-work-item' as const,
      parsed: {
        workType: 'feature',
        priority: 'P1 - blocks unattended/prod readiness',
        area: 'core',
        blockers: [],
        objective: 'Import GitHub issues.',
        evidence: ['issue body'],
        requirements: ['Persist provenance'],
        outOfScope: ['Do not merge'],
        acceptanceCriteria: ['PR created'],
        verificationCommands: ['pnpm test'],
        safetyNotes: ['No destructive commands.'],
        suggestedBranch: 'feat/github-issue-intake-auth',
      },
    }
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'core: imported issue',
      status: 'approved',
      document: '# imported',
      source,
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'core: imported issue',
      prompt: 'implement',
      repos: ['packages/core'],
      source,
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
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'verify', passed: true },
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.includes('/pulls?state=open')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.endsWith('/pulls')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        return new Response(JSON.stringify({
          number: 81,
          html_url: 'https://github.com/edictum-ai/ductum/pull/81',
          title: 'feat: core: imported issue',
          head: { ref: 'feat/github-issue-intake-auth' },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        const body = JSON.parse(String(init?.body)) as { body: string }
        expect(body.body).toContain('<!-- ductum:github-issue-sync:')
        expect(body.body).toContain('PR: #81 https://github.com/edictum-ai/ductum/pull/81')
        return new Response(JSON.stringify({
          id: 101,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
          body: body.body,
          user: { login: 'ductum-factory', type: 'Bot' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const gitCalls: string[][] = []
    const result = await syncGitHubShipArtifacts({
      repos: {
        runs: fixture.repos.runs,
        tasks: fixture.repos.tasks,
        specs: fixture.repos.specs,
        repositories: fixture.repos.repositories,
        secrets: fixture.repos.secrets,
        evidence: fixture.repos.evidence,
      },
      factoryDataDir: factoryDir,
      now: () => new Date('2026-06-23T12:00:00.000Z'),
      runGit: async (args) => {
        gitCalls.push(args)
        return { stdout: args.includes('rev-parse') ? 'abc123\n' : '' }
      },
    }, run.id)

    expect(result).toMatchObject({
      skipped: false,
      branch: 'feat/github-issue-intake-auth',
      commitSha: 'abc123',
      prNumber: 81,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
    })
    expect(gitCalls).toEqual(expect.arrayContaining([
      ['-C', '/tmp/worktree', 'branch', '-M', 'feat/github-issue-intake-auth'],
      ['-C', '/tmp/worktree', 'rev-parse', 'HEAD'],
    ]))
    const evidence = fixture.repos.evidence.list(run.id)
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-branch-sync', actorType: 'github_app' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-pr-sync', actorType: 'github_app', prNumber: 81 }) }),
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'github-issue-comment-sync',
          actorType: 'github_app',
          issueNumber: 12,
          commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-101',
        }),
      }),
    ]))
  })
})
