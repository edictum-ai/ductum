import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('sandbox settings runtime alignment', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(() => {
    fixture.close()
  })

  it('rejects Agent create with an unsupported sandboxRef before persisting', async () => {
    seedSandbox('local-sandbox', { provider: 'local', mode: 'permissive' }, fixture)

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-sandbox',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'local-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('unsupported sandbox runtime local/permissive') })
    expect(fixture.repos.agents.getByName('bad-sandbox')).toBeNull()
  })

  it('rejects Agent update with an unsupported sandboxRef and preserves the saved Agent', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'builder', model: 'gpt-5.4' },
    })
    const id = (created.json as { id: string }).id
    const before = fixture.repos.agents.get(id as never)
    seedSandbox('future-sandbox', { provider: 'docker', mode: 'container' }, fixture)

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { resourceRefs: { sandboxRef: 'future-sandbox' } },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.json).toMatchObject({ error: expect.stringContaining('unsupported sandbox runtime docker/container') })
    expect(fixture.repos.agents.get(id as never)).toEqual(before)
  })

  it.each([
    ['filesystem', { provider: 'host', mode: 'worktree', filesystem: { root: '/tmp/ductum' } }, 'filesystem.root'],
    ['network', { provider: 'host', mode: 'worktree', network: { mode: 'none' } }, 'network.mode=none'],
    ['credentials', { provider: 'host', mode: 'worktree', credentials: { expose: ['github'] } }, 'spec.credentials'],
    ['resources', { provider: 'host', mode: 'worktree', resources: { cpu: 2 } }, 'spec.resources'],
    ['process', { provider: 'host', mode: 'worktree', process: { uid: 1000 } }, 'spec.process'],
  ] as const)('rejects Agent update with unsupported %s claims and preserves the Agent', async (_name, spec, expected) => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'builder', model: 'gpt-5.4' },
    })
    const id = (created.json as { id: string }).id
    const before = fixture.repos.agents.get(id as never)
    seedSandbox('claimed-sandbox', spec, fixture)

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { resourceRefs: { sandboxRef: 'claimed-sandbox' } },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.json).toMatchObject({ error: expect.stringContaining(expected) })
    expect(fixture.repos.agents.get(id as never)).toEqual(before)
  })

  it('rejects project-scoped sandbox profiles at factory Agent write scope', async () => {
    const factory = fixture.repos.factory.create({
      id: createId<'FactoryId'>(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    const project = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'ductum',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: project.id,
      name: 'project-future-sandbox',
      spec: { provider: 'docker', mode: 'container' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'project-scoped-agent',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'project-future-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('sandboxRef "project-future-sandbox" references a SandboxProfile resource outside the run project') })
    expect(fixture.repos.agents.getByName('project-scoped-agent')).toBeNull()
  })
})

function seedSandbox(name: string, spec: Record<string, unknown>, fixture: TestFixture): void {
  fixture.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId: null,
    name,
    spec: spec as never,
  })
}
