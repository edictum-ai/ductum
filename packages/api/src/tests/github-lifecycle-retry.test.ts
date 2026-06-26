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

describe('GitHub lifecycle retry safety', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('force-with-lease updates a stale remote lifecycle branch without renaming the worktree to the target branch', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-gh-stale-'))
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
        branchPrefix: 'docs/',
      },
    })
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'github auth docs',
      status: 'approved',
      document: '# imported',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'Document GitHub App factory setup',
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

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.includes('/pulls?state=open')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.endsWith('/pulls')) {
        return new Response(JSON.stringify({
          number: 135,
          html_url: 'https://github.com/edictum-ai/ductum/pull/135',
          title: 'docs: github auth docs',
          head: { ref: 'docs/document-github-app-factory-setup' },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const gitCalls: string[][] = []
    await syncGitHubShipArtifacts({
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
        if (args.includes('ls-remote')) return { stdout: 'deadbeef\trefs/heads/docs/document-github-app-factory-setup\n' }
        if (args.includes('rev-parse')) return { stdout: 'abc123\n' }
        return { stdout: '' }
      },
    }, run.id)

    expect(gitCalls).toEqual(expect.arrayContaining([
      ['-C', '/tmp/worktree', 'checkout', '-B', `ductum/github-lifecycle-${run.id.slice(0, 8)}`],
      [
        '-C',
        '/tmp/worktree',
        '-c',
        expect.stringContaining('AUTHORIZATION: basic'),
        'push',
        '--force-with-lease=refs/heads/docs/document-github-app-factory-setup:deadbeef',
        'https://github.com/edictum-ai/ductum.git',
        'HEAD:refs/heads/docs/document-github-app-factory-setup',
      ],
    ]))
  })
})
