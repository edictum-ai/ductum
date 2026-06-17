import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import { describe, expect, it, registerRouteTestCleanup } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes — parser-enforced validation', () => {
  it('POST /api/specs/:specId/tasks rejects invalid status on create (not only update)', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'new task', status: 'shipped' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid status: shipped/)
  })

  it('POST /api/specs/:specId/tasks rejects invalid requiredRole on create', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'new task', requiredRole: 'ops' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid requiredRole: ops/)
  })

  it('POST /api/specs/:specId/tasks rejects unknown assignedAgentId on create', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'new task', assignedAgentId: 'agent_missing' },
    })

    expect(result.response.status).toBe(404)
    expect((result.json as { error: string }).error).toMatch(/Agent not found: agent_missing/)
  })

  it('POST /api/specs/:specId/tasks rejects invalid complexity', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'new task', complexity: 'huge' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid complexity: huge/)
  })

  it('POST /api/projects/:projectId/specs rejects invalid spec status on create', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/specs`, {
      method: 'POST',
      body: { name: 'spec', status: 'shipping' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid status: shipping/)
  })

  it('PUT /api/specs/:id/status rejects invalid spec status', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/status`, {
      method: 'PUT',
      body: { status: 'shipping' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid status: shipping/)
  })

  it('POST /api/specs/:id/dependencies rejects invalid dependency kind', async () => {
    fixture = await createFixture()
    const { project, spec } = seedBase(fixture)
    const otherSpecBody = await requestJson(fixture.app, `/api/projects/${project.id}/specs`, {
      method: 'POST',
      body: { name: 'second spec' },
    })
    const otherSpec = otherSpecBody.json as { id: string }

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/dependencies`, {
      method: 'POST',
      body: { dependsOnId: otherSpec.id, kind: 'weak' },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid kind: weak/)
  })

  it('POST /api/projects/:projectId/specs/import rejects invalid task requiredRole', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/specs/import`, {
      method: 'POST',
      body: {
        spec: { name: 'imported spec' },
        tasks: [{ name: 'T1', prompt: 'go', requiredRole: 'sneak' }],
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Invalid tasks\[0\]\.requiredRole/)
  })

  it('POST /api/projects/:projectId/specs/import rejects non-string repos entries', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/specs/import`, {
      method: 'POST',
      body: {
        spec: { name: 'imported spec' },
        tasks: [{ name: 'T1', prompt: 'go', repos: ['ok', 42] }],
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/tasks\[0\]\.repos/)
  })

  it('POST /api/projects/:projectId/specs/import accepts valid payload', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/specs/import`, {
      method: 'POST',
      body: {
        spec: { name: 'imported spec' },
        tasks: [
          { name: 'T1', prompt: 'first', repos: ['packages/api'] },
          { name: 'T2', prompt: 'second', depends_on: ['T1'] },
        ],
      },
    })

    expect(result.response.status).toBe(201)
    expect((result.json as { taskCount: number }).taskCount).toBe(2)
  })
})
