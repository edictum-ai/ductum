import { afterEach, describe, expect, it } from 'vitest'
import { createId, type FactorySecretScope, type ProjectId } from '@ductum/core'

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

  it('rejects malformed target auth refs before persisting', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)

    const created = await requestJson(fixture.app, `/api/projects/${project.id}/targets`, {
      method: 'POST',
      body: {
        name: 'unsafe-target',
        spec: {
          source: { type: 'github', repo: 'edictum-ai/ductum' },
          authRef: 'GITHUB_TOKEN',
        },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.text).toContain('repository.authRef must be a secret:<id> reference')
    expect(fixture.repos.targets.list(project.id)).toHaveLength(0)
  })

  it('rejects target auth refs that point at missing secrets', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const target = fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'ductum',
      spec: { source: { type: 'github', repo: 'edictum-ai/ductum' } },
    })

    const updated = await requestJson(fixture.app, `/api/targets/${target.id}`, {
      method: 'PUT',
      body: {
        spec: {
          source: { type: 'github', repo: 'edictum-ai/ductum' },
          authRef: 'secret:missing-github-app',
        },
      },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.text).toContain('repository.authRef references unknown FactorySecret: secret:missing-github-app')
    expect(fixture.repos.targets.get(target.id)?.spec.authRef).toBeUndefined()
  })

  it('allows factory and same-project target auth refs', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    seedSecret(fixture, { id: 'factory-github-app', scope: 'factory', projectId: null })
    seedSecret(fixture, { id: 'project-github-app', scope: 'project', projectId: project.id })

    const created = await requestJson(fixture.app, `/api/projects/${project.id}/targets`, {
      method: 'POST',
      body: {
        name: 'factory-auth',
        spec: {
          source: { type: 'github', repo: 'edictum-ai/factory-auth' },
          authRef: 'secret:factory-github-app',
        },
      },
    })
    const target = fixture.repos.targets.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'ductum',
      spec: { source: { type: 'github', repo: 'edictum-ai/ductum' } },
    })
    const updated = await requestJson(fixture.app, `/api/targets/${target.id}`, {
      method: 'PUT',
      body: {
        spec: {
          source: { type: 'github', repo: 'edictum-ai/ductum' },
          authRef: 'secret:project-github-app',
        },
      },
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
