import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('D185 conservative defaults for new records', () => {
  it('defaults project mergeMode to human when the request omits it', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'conservative-project',
        repos: ['edictum-ai/ductum'],
        config: { workflowPath: 'workflows/coding-guard.yaml' },
      },
    })

    expect(created.response.status).toBe(201)
    expect((created.json as { config: { mergeMode: string } }).config.mergeMode).toBe('human')
  })

  it('falls back to human mergeMode when the request supplies an unrecognized value', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'defensive-project',
        repos: ['edictum-ai/ductum'],
        config: { mergeMode: 'totally-unbounded', workflowPath: 'workflows/coding-guard.yaml' },
      },
    })

    expect(created.response.status).toBe(201)
    expect((created.json as { config: { mergeMode: string } }).config.mergeMode).toBe('human')
  })

  it('only opts in to auto mergeMode with an explicit auto value', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'opted-in-project',
        repos: ['edictum-ai/ductum'],
        config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
      },
    })

    expect(created.response.status).toBe(201)
    expect((created.json as { config: { mergeMode: string } }).config.mergeMode).toBe('auto')
  })

  it('preserves an explicit auto opt-in on update but never relaxes to auto implicitly', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const humanProject = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'human-then-update',
        repos: ['edictum-ai/ductum'],
        config: { workflowPath: 'workflows/coding-guard.yaml' },
      },
    })
    const projectId = (humanProject.json as { id: string }).id
    expect((humanProject.json as { config: { mergeMode: string } }).config.mergeMode).toBe('human')

    const updated = await requestJson(fixture.app, `/api/projects/${projectId}`, {
      method: 'PUT',
      body: { name: 'human-then-update', config: { workflowPath: 'workflows/coding-guard.yaml' } },
    })

    expect(updated.response.status).toBe(200)
    // No explicit auto opt-in on update → still human, never silently relaxed.
    expect((updated.json as { config: { mergeMode: string } }).config.mergeMode).toBe('human')

    const explicitAuto = await requestJson(fixture.app, `/api/projects/${projectId}`, {
      method: 'PUT',
      body: {
        name: 'human-then-update',
        config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
      },
    })

    expect(explicitAuto.response.status).toBe(200)
    expect((explicitAuto.json as { config: { mergeMode: string } }).config.mergeMode).toBe('auto')
  })
})
