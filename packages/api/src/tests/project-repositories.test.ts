import { afterEach, describe, expect, it } from 'vitest'
import { createId, type FactorySecretScope, type ProjectId } from '@ductum/core'

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

  it('rejects repository auth refs during project onboarding before persisting', async () => {
    fixture = await createFixture()
    const factory = fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })

    const malformed = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'bad-project',
        repositories: [{
          remoteUrl: 'https://github.com/edictum-ai/bad-project.git',
          authRef: 'GITHUB_TOKEN',
        }],
      },
    })
    const missing = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'missing-secret-project',
        repository: {
          remoteUrl: 'https://github.com/edictum-ai/missing-secret-project.git',
          authRef: 'secret:missing-github-app',
        },
      },
    })

    expect(malformed.response.status).toBe(400)
    expect(malformed.text).toContain('repository.authRef must be a secret:<id> reference')
    expect(missing.response.status).toBe(400)
    expect(missing.text).toContain('repository.authRef references unknown FactorySecret: secret:missing-github-app')
    expect(fixture.repos.projects.list(factory.id)).toHaveLength(0)
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

  it('rejects malformed repository auth refs before persisting', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const created = await requestJson(fixture.app, `/api/projects/${project.id}/repositories`, {
      method: 'POST',
      body: {
        name: 'ductum',
        spec: {
          remoteUrl: 'https://github.com/edictum-ai/ductum.git',
          authRef: 'GITHUB_TOKEN',
        },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.text).toContain('repository.authRef must be a secret:<id> reference')
    expect(fixture.repos.repositories.list(project.id)).toHaveLength(0)
  })

  it('rejects repository auth refs that point at missing secrets', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })

    const updated = await requestJson(fixture.app, `/api/repositories/${repository.id}`, {
      method: 'PUT',
      body: { spec: { ...repository.spec, authRef: 'secret:missing-github-app' } },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.text).toContain('repository.authRef references unknown FactorySecret: secret:missing-github-app')
    expect(fixture.repos.repositories.get(repository.id)?.spec.authRef).toBeUndefined()
  })

  it('rejects project-scoped repository auth refs from another project', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const otherProject = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: project.factoryId,
      name: 'other',
      repos: [],
      config: { mergeMode: 'human', workflowPath: 'workflows/coding-guard.yaml' },
    })
    seedSecret(fixture, { id: 'github-app', scope: 'project', projectId: otherProject.id })
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })

    const updated = await requestJson(fixture.app, `/api/repositories/${repository.id}`, {
      method: 'PUT',
      body: { spec: { ...repository.spec, authRef: 'secret:github-app' } },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.text).toContain('repository.authRef project-scoped FactorySecret must belong to the repository project')
    expect(fixture.repos.repositories.get(repository.id)?.spec.authRef).toBeUndefined()
  })

  it('allows factory and same-project repository auth refs', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    seedSecret(fixture, { id: 'factory-github-app', scope: 'factory', projectId: null })
    seedSecret(fixture, { id: 'project-github-app', scope: 'project', projectId: project.id })

    const created = await requestJson(fixture.app, `/api/projects/${project.id}/repositories`, {
      method: 'POST',
      body: {
        name: 'factory-auth',
        spec: {
          remoteUrl: 'https://github.com/edictum-ai/factory-auth.git',
          authRef: 'secret:factory-github-app',
        },
      },
    })
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })
    const updated = await requestJson(fixture.app, `/api/repositories/${repository.id}`, {
      method: 'PUT',
      body: { spec: { ...repository.spec, authRef: 'secret:project-github-app' } },
    })

    expect(created.response.status).toBe(201)
    expect(created.json).toMatchObject({ spec: { authRef: 'secret:factory-github-app' } })
    expect(updated.response.status).toBe(200)
    expect(updated.json).toMatchObject({ spec: { authRef: 'secret:project-github-app' } })
  })
})

function seedSecret(
  target: TestFixture,
  options: { id: string; scope: FactorySecretScope; projectId: ProjectId | null },
): void {
  target.repos.secrets.create({
    id: options.id,
    name: options.id,
    scope: options.scope,
    projectId: options.projectId,
    description: null,
    status: 'configured',
    keySource: { type: 'local-file', keyId: 'test' },
    payload: { algorithm: 'aes-256-gcm', ciphertext: 'ciphertext', nonce: 'nonce', authTag: 'tag' },
    lastRotatedAt: null,
    lastTestedAt: null,
  })
}
