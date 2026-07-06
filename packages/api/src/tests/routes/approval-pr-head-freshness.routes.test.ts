import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  vi,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'
import { buildRuntimeReviewEvidencePayload } from '../../lib/runtime-approval-evidence.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - PR head freshness approval guard', () => {
  it('rejects stale PR-head CI evidence before merge when the PR head changed while awaiting approval', async () => {
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
      name: 'PR head freshness guard',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const oldHead = 'e9d621a0c14db2fb3cc03fb740696db2dd5c18bf'
    const currentHead = 'ee4431d718c37dd542c49f67fa5076ba22b61bb0'
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
        commitSha: oldHead,
        ductumEvidenceProducer: 'ductum.watcher',
        checks: [{ name: 'unit', status: 'completed', conclusion: 'success' }],
      },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: buildRuntimeReviewEvidencePayload({ verdict: 'pass', passed: true, feedback: 'PASS' }, oldHead),
    })

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/pulls/42')) {
        return new Response(JSON.stringify({
          number: 42,
          html_url: 'https://github.com/edictum-ai/ductum/pull/42',
          title: 'PR head freshness guard',
          head: { ref: 'feature/x', sha: currentHead },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      stage: 'ship',
      reason: expect.stringContaining('approval blocked: PR head changed'),
    })
    expect(String((result.json as Record<string, unknown>).reason)).toContain('current PR head has no passing remote CI evidence')
    expect(String((result.json as Record<string, unknown>).reason)).toContain('current PR head has no passing review evidence')
    expect(fixture.repos.runs.get(run.id)?.commitSha).toBe(currentHead)
    expect(fetchMock.mock.calls.map(([url]) => String(url)))
      .not.toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
  })

  it('rejects stale gate evidence even when the run already points at the current PR head', async () => {
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
      name: 'PR head freshness guard',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const oldHead = 'e9d621a0c14db2fb3cc03fb740696db2dd5c18bf'
    const currentHead = 'ee4431d718c37dd542c49f67fa5076ba22b61bb0'
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
      commitSha: currentHead,
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
        commitSha: oldHead,
        ductumEvidenceProducer: 'ductum.watcher',
        checks: [{ name: 'unit', status: 'completed', conclusion: 'success' }],
      },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: buildRuntimeReviewEvidencePayload({ verdict: 'pass', passed: true, feedback: 'PASS' }, oldHead),
    })

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/pulls/42')) {
        return new Response(JSON.stringify({
          number: 42,
          html_url: 'https://github.com/edictum-ai/ductum/pull/42',
          title: 'PR head freshness guard',
          head: { ref: 'feature/x', sha: currentHead },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      stage: 'ship',
      reason: expect.stringContaining('lacks fresh gate evidence'),
    })
    expect(String((result.json as Record<string, unknown>).reason)).toContain('current PR head has no passing remote CI evidence')
    expect(String((result.json as Record<string, unknown>).reason)).toContain('current PR head has no passing review evidence')
    expect(fetchMock.mock.calls.map(([url]) => String(url)))
      .not.toContain('https://api.github.com/repos/edictum-ai/ductum/pulls/42/merge')
  })

  it('fails closed for adopted PR approval when current head cannot be read', async () => {
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
      name: 'Adopted PR freshness guard',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const head = 'ee4431d718c37dd542c49f67fa5076ba22b61bb0'
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
      commitSha: head,
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
      type: 'custom',
      payload: { kind: 'operator-pr-adoption', prNumber: 42, headSha: head },
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/42')) throw new Error('GitHub PR read unavailable')
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      stage: 'ship',
      reason: expect.stringContaining('current PR review state cannot be checked'),
    })
    expect(result.text).toContain('could not read current PR head')
    expect(fixture.repos.runs.get(run.id)?.reviewStatus).toBe('fail')
  })
})
