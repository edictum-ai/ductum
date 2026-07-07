import { createId, hasCurrentCommitRemoteCiPass } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adoptOperatorPullRequest } from '../lib/operator-pr-adoption.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'
import {
  buildGreenCheckRunsResponse,
  seedFactorySecretDir,
  seedRepositoryWithAuth,
} from './routes/github-app-merge-shared.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fixture?.close()
  fixture = undefined
})

describe('operator PR adoption', () => {
  it('rejects repositories without a local path before reading GitHub', async () => {
    const { task } = await seedAdoptionTask({}, { withLocalPath: false })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(adoptOperatorPullRequest(fixture!.context, task.id, {
      pr: '#42',
      reason: 'operator checked PR',
    })).rejects.toThrow('no local repository path for approval merge verification')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fixture!.repos.runs.list(task.id)).toHaveLength(0)
    expect(fixture!.repos.tasks.get(task.id)?.status).toBe('ready')
  })

  it('rejects closed or merged pull requests before creating an adoption run', async () => {
    const { task } = await seedAdoptionTask()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/42')) {
        return new Response(JSON.stringify({
          number: 42,
          html_url: 'https://github.com/edictum-ai/ductum/pull/42',
          title: 'Already closed',
          state: 'closed',
          merged: true,
          head: { ref: 'feature/x', sha: 'abc123' },
          base: { ref: 'main', sha: 'base123' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    await expect(adoptOperatorPullRequest(fixture!.context, task.id, {
      pr: '#42',
      reason: 'operator checked stale PR',
    })).rejects.toThrow('Cannot adopt PR #42: PR is merged')
    expect(fixture!.repos.runs.list(task.id)).toHaveLength(0)
    expect(fixture!.repos.tasks.get(task.id)?.status).toBe('ready')
  })

  it('records only required green checks as strict passing CI evidence', async () => {
    const { task } = await seedAdoptionTask({
      merge: {
        push: false,
        base: 'main',
        strategy: 'merge',
        approvalCiGate: {
          enabled: true,
          requiredChecks: ['build-and-test'],
          failClosedOnMissing: true,
        },
      },
    })
    const headSha = 'abc123'
    const green = buildGreenCheckRunsResponse(headSha)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/42')) return new Response(JSON.stringify(openPullResponse(headSha)), { status: 200 })
      if (url.endsWith(green.checkRunsUrl)) {
        return new Response(JSON.stringify({
          check_runs: [
            { name: 'build-and-test', status: 'completed', conclusion: 'success' },
            { name: 'optional-lint', status: 'completed', conclusion: 'failure' },
          ],
        }), { status: 200 })
      }
      if (url.endsWith(green.statusesUrl)) return new Response(green.statusesBody, { status: 200 })
      if (url.endsWith('/graphql')) return reviewGraphqlResponse(init)
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const adopted = await adoptOperatorPullRequest(fixture!.context, task.id, {
      pr: '#42',
      reason: 'required checks green',
    })

    const ciEvidence = adopted.evidence.find((item) => item.type === 'ci')
    expect(adopted.run.ciStatus).toBe('pass')
    expect(ciEvidence?.payload.checks).toEqual([
      expect.objectContaining({ name: 'build-and-test', status: 'completed', conclusion: 'success' }),
    ])
    expect(hasCurrentCommitRemoteCiPass(adopted.run, fixture!.repos.evidence.list(adopted.run.id))).toBe(true)
  })

  it('returns an adoption created concurrently before the write transaction', async () => {
    const { task } = await seedAdoptionTask()
    const headSha = 'abc123'
    const green = buildGreenCheckRunsResponse(headSha)
    let concurrentRunId: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/42')) return new Response(JSON.stringify(openPullResponse(headSha)), { status: 200 })
      if (url.endsWith(green.checkRunsUrl)) return new Response(green.checkRunsBody, { status: 200 })
      if (url.endsWith(green.statusesUrl)) return new Response(green.statusesBody, { status: 200 })
      if (url.endsWith(green.branchProtectionUrl)) return new Response('Branch not protected', { status: 404 })
      if (url.endsWith('/graphql')) {
        if (concurrentRunId == null) concurrentRunId = seedConcurrentAdoption(task.id, headSha)
        return reviewGraphqlResponse(init)
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const adopted = await adoptOperatorPullRequest(fixture!.context, task.id, {
      pr: '#42',
      reason: 'same adoption raced in',
    })

    expect(adopted.alreadyAdopted).toBe(true)
    expect(adopted.run.id).toBe(concurrentRunId)
    expect(adopted.evidence).toEqual([])
    expect(fixture!.repos.runs.list(task.id)).toHaveLength(1)
  })
})

async function seedAdoptionTask(
  overrides: Parameters<typeof createFixture>[0] = {},
  options: { withLocalPath?: boolean } = {},
) {
  const factoryDir = seedFactorySecretDir()
  fixture = await createFixture({ ...overrides, factoryDataDir: factoryDir })
  const { project, builder, spec } = seedBase(fixture)
  const seededRepository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
  const repository = options.withLocalPath === false
    ? seededRepository
    : fixture.repos.repositories.update(seededRepository.id, {
      spec: { ...seededRepository.spec, localPath: factoryDir },
    })
  const task = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: repository.id,
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
  return { task }
}

function openPullResponse(headSha: string) {
  return {
    number: 42,
    html_url: 'https://github.com/edictum-ai/ductum/pull/42',
    title: 'Open PR',
    state: 'open',
    merged: false,
    head: { ref: 'feature/x', sha: headSha },
    base: { ref: 'main', sha: 'base123' },
  }
}

function reviewGraphqlResponse(init?: RequestInit): Response {
  JSON.parse(String(init?.body ?? '{}'))
  return new Response(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewDecision: 'APPROVED',
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  }), { status: 200 })
}

function seedConcurrentAdoption(taskId: string, headSha: string): string {
  const task = fixture!.repos.tasks.get(taskId as never)!
  const run = fixture!.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: task.assignedAgentId!,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: 'operator-created PR adopted; waiting for approval',
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
  fixture!.repos.tasks.updateStatus(task.id, 'active')
  return run.id
}
