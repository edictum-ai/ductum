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

  it('derives a PR URL for external-review numeric relinks', async () => {
    const syncExternalWatchers = vi.fn()
    fixture = await createFixture({ syncExternalWatchers })
    const { project, spec, builder } = seedBase(fixture)
    fixture.repos.projects.update(project.id, {
      config: { ...project.config, externalReviewRequired: true },
    })
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id as never,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'External review task',
      prompt: 'implement',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accepted.json as { id: string }).id
    await fixture.context.enforcement.advanceToStage(runId as never, 'ship')
    fixture.repos.runs.updateGitArtifacts(runId as never, {
      branch: 'feature/x',
      commitSha: 'abc123',
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
      prUrl: 'https://github.com/edictum-ai/ductum/pull/99',
    })
    expect(syncExternalWatchers).toHaveBeenCalledWith(runId)
  })
})
