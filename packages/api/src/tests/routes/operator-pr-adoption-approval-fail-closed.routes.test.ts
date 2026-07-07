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
import { buildGreenCheckRunsResponse, seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - operator PR adoption approval fail-closed checks', () => {
  it('fails closed when approval-time review refresh cannot query GitHub', async () => {
    const head = 'ee4431d718c37dd542c49f67fa5076ba22b61bb0'
    const run = await seedAdoptedRun(head)
    const green = buildGreenCheckRunsResponse(head)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/pulls/42')) {
        return new Response(JSON.stringify({
          number: 42,
          html_url: 'https://github.com/edictum-ai/ductum/pull/42',
          title: 'Adopted PR',
          head: { ref: 'feature/x', sha: head },
          base: { ref: 'main' },
        }), { status: 200 })
      }
      if (url.endsWith(green.checkRunsUrl)) return new Response(green.checkRunsBody, { status: 200 })
      if (url.endsWith(green.statusesUrl)) return new Response(green.statusesBody, { status: 200 })
      if (url.endsWith('/graphql')) throw new Error('GraphQL unavailable')
      if (url.endsWith('/pulls/42/merge')) return new Response(JSON.stringify({ sha: 'merge-sha', merged: true }), { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    }))

    const result = await requestJson(fixture!.app, `/api/runs/${run.id}/approve`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      stage: 'ship',
      reason: expect.stringContaining('current PR review state is not passing'),
    })
    expect(result.text).toContain('could not refresh review state')
    expect(fixture!.repos.runs.get(run.id)?.reviewStatus).toBe('fail')
    expect(fixture!.repos.evidence.list(run.id)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'github-pr-merge' }) }),
    ]))
  })
})

async function seedAdoptedRun(head: string) {
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
    name: 'Adopted PR approval guard',
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
  return run
}
