import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('task targets', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(() => {
    fixture.close()
  })

  it('persists a target-scoped task when the target belongs to the spec project', async () => {
    const { project, spec } = seedBase(fixture)
    const target = fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'ductum',
      spec: { source: { type: 'local', localPath: '/Users/acartagena/project/ductum' } },
    })

    const created = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: {
        name: 'targeted-task',
        targetId: target.id,
        prompt: 'Do target work',
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({ name: 'targeted-task', targetId: target.id })
    const taskId = (created.json as { id: string }).id
    expect(fixture.repos.tasks.get(taskId as never)?.targetId).toBe(target.id)
  })

  it('rejects a target from another project', async () => {
    const { factory, spec } = seedBase(fixture)
    const otherProject = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'other',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const target = fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: otherProject.id,
      name: 'other-target',
      spec: { source: { type: 'local', localPath: '/tmp/other' } },
    })

    const result = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: {
        name: 'bad-target',
        targetId: target.id,
        prompt: 'Do target work',
      },
    })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('Task target must belong to the same project')
  })
})
