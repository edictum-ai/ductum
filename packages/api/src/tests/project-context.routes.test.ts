import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('project context routes', () => {
  it('persists project purpose and audience through create and update', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'ductum',
        config: {
          mergeMode: 'human',
          purpose: 'Coordinate governed agent work.',
          audience: 'Ductum operators and repo maintainers.',
        },
      },
    })
    const projectId = (created.json as { id: string }).id
    const updated = await requestJson(fixture.app, `/api/projects/${projectId}`, {
      method: 'PUT',
      body: {
        config: {
          mergeMode: 'human',
          purpose: 'Keep factory work understandable.',
          audience: 'Developers using the Ductum UI.',
        },
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({
      config: {
        purpose: 'Coordinate governed agent work.',
        audience: 'Ductum operators and repo maintainers.',
      },
    })
    expect(updated.json).toMatchObject({
      config: {
        purpose: 'Keep factory work understandable.',
        audience: 'Developers using the Ductum UI.',
      },
    })
  })
})
