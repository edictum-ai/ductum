import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('config resource routes', () => {
  it('persists factory-scoped resource shells through the API', async () => {
    fixture = await createFixture()

    const created = await requestJson(fixture.app, '/api/resources/Model', {
      method: 'POST',
      body: {
        name: 'gpt-54',
        spec: { provider: 'openai', modelId: 'gpt-5.4', supportedEfforts: ['high', 'xhigh'] },
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({
      kind: 'Model',
      projectId: null,
      spec: { provider: 'openai', modelId: 'gpt-5.4' },
    })

    const listed = await requestJson(fixture.app, '/api/resources/Model?projectId=factory')
    expect(listed.json).toHaveLength(1)
  })

  it('persists project-scoped workflow profile shells', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const created = await requestJson(fixture.app, '/api/resources/WorkflowProfile', {
      method: 'POST',
      body: {
        projectId: project.id,
        name: 'coding-guard',
        spec: { path: '.edictum/workflow-profile.yaml', description: 'Default coding workflow' },
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({
      kind: 'WorkflowProfile',
      projectId: project.id,
      name: 'coding-guard',
    })
  })

  it('rejects shell resources missing required fields', async () => {
    fixture = await createFixture()

    const result = await requestJson(fixture.app, '/api/resources/SandboxProfile', {
      method: 'POST',
      body: { name: 'builder-worktree', spec: { provider: 'docker' } },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toMatchObject({ error: 'spec.mode is required' })
  })
})
