import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('target routes', () => {
  it('persists targets through the API', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const created = await requestJson(fixture.app, `/api/projects/${project.id}/targets`, {
      method: 'POST',
      body: {
        name: 'ductum',
        spec: {
          source: { type: 'local', localPath: '/Users/acartagena/project/ductum' },
          branch: { base: 'main', prefix: 'feat/' },
          workflowRef: '.edictum/workflow-profile.yaml',
        },
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({
      name: 'ductum',
      projectId: project.id,
      spec: { source: { type: 'local', localPath: '/Users/acartagena/project/ductum' } },
    })

    const targetId = (created.json as { id: string }).id
    const updated = await requestJson(fixture.app, `/api/targets/${targetId}`, {
      method: 'PUT',
      body: { spec: { source: { type: 'github', repo: 'acartag7/ductum' } } },
    })
    const listed = await requestJson(fixture.app, `/api/projects/${project.id}/targets`)

    expect(updated.response.status).toBe(200)
    expect(updated.json).toMatchObject({ spec: { source: { type: 'github', repo: 'acartag7/ductum' } } })
    expect(listed.json).toHaveLength(1)
  })

  it('rejects target sources that do not identify anything', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/targets`, {
      method: 'POST',
      body: { name: 'bad', spec: { source: { type: 'service' } } },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toMatchObject({ error: 'spec.source must identify a repo, localPath, package, or subdirectory' })
  })
})
