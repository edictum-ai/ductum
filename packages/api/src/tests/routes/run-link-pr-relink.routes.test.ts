import {
  createFixture,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined

registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - run PR relinks', () => {
  it('clears a stale PR URL when relinked with a numeric PR', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accepted.json as { id: string }).id
    fixture.repos.runs.updateGitArtifacts(runId as never, {
      prNumber: 42,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
    })

    const relinked = await requestJson(fixture.app, `/api/runs/${runId}/link`, {
      method: 'POST',
      body: { pr: 99 },
    })

    expect(relinked.response.status).toBe(200)
    expect(fixture.repos.runs.get(runId as never)).toMatchObject({
      prNumber: 99,
      prUrl: null,
    })
  })
})
