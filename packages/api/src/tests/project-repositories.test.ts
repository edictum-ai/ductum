import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('project repository onboarding', () => {
  it('can start project onboarding from a local path', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'local-project',
        repository: { localPath: '/Users/acartagena/project/local-project' },
      },
    })
    const projectId = (created.json as { id: string }).id
    const repositories = await requestJson(fixture.app, `/api/projects/${projectId}/repositories`)

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({ repos: ['/Users/acartagena/project/local-project'] })
    expect(repositories.json).toMatchObject([
      {
        name: 'local-project',
        portable: false,
        identity: { kind: 'local', value: '/Users/acartagena/project/local-project' },
        readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: false },
      },
    ])
  })

  it('can start project onboarding from a remote repository', async () => {
    fixture = await createFixture()
    fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const created = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'remote-project',
        repository: { remoteUrl: 'https://github.com/edictum-ai/remote-project.git' },
      },
    })
    const projectId = (created.json as { id: string }).id
    const repositories = await requestJson(fixture.app, `/api/projects/${projectId}/repositories`)

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({ repos: ['https://github.com/edictum-ai/remote-project.git'] })
    expect(repositories.json).toMatchObject([
      {
        name: 'remote-project',
        portable: true,
        identity: { kind: 'remote', value: 'https://github.com/edictum-ai/remote-project.git' },
        readiness: {
          supportsLocalWorkflow: false,
          supportsRemoteWorkflow: true,
          github: { state: 'configured', owner: 'edictum-ai', repo: 'remote-project' },
        },
      },
    ])
  })

  it('exposes Target-backed tasks through the Repository bridge', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const target = fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'legacy-target',
      spec: { source: { type: 'local', localPath: '/Users/acartagena/project/ductum' } },
    })

    const repositories = await requestJson(fixture.app, `/api/projects/${project.id}/repositories`)
    const repository = await requestJson(fixture.app, `/api/repositories/${target.id}`)

    expect(repositories.json).toMatchObject([
      { id: target.id, name: 'legacy-target', portable: false },
    ])
    expect(repository.json).toMatchObject({
      id: target.id,
      spec: { localPath: '/Users/acartagena/project/ductum', targetRef: target.id },
    })
  })

  it('creates tasks scoped to a Repository and Component', async () => {
    fixture = await createFixture()
    const { project, spec } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/Users/acartagena/project/ductum' },
    })
    const component = fixture.repos.components.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: 'api',
      spec: { path: 'packages/api' },
    })

    const created = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: {
        name: 'component-task',
        repositoryId: repository.id,
        componentId: component.id,
        prompt: 'Do scoped work',
      },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({
      repositoryId: repository.id,
      componentId: component.id,
      repos: ['/Users/acartagena/project/ductum'],
    })
  })
})
