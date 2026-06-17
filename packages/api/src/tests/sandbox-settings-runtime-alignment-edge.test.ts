import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId, type ProjectId } from '@ductum/core'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('sandbox settings runtime alignment edge cases', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  afterEach(() => {
    fixture.close()
  })

  it.each([
    ['filesystem', { provider: 'host', mode: 'worktree', filesystem: { root: '/tmp/ductum' } }, 'filesystem.root'],
    ['network', { provider: 'host', mode: 'worktree', network: { mode: 'none' } }, 'network.mode=none'],
    ['credentials', { provider: 'host', mode: 'worktree', credentials: { expose: ['github'] } }, 'spec.credentials'],
    ['resources', { provider: 'host', mode: 'worktree', resources: { cpu: 2 } }, 'spec.resources'],
    ['process', { provider: 'host', mode: 'worktree', process: { uid: 1000 } }, 'spec.process'],
  ] as const)('rejects Agent create with referenced unsupported %s claims', async (_name, spec, expected) => {
    seedSandbox('claimed-sandbox', spec, null, fixture)

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-claims',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'claimed-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining(expected) })
    expect(fixture.repos.agents.getByName('bad-claims')).toBeNull()
  })

  it('does not swallow unsupported factory-scoped sandbox validation errors at factory Agent write scope', async () => {
    seedSandbox('future-factory-sandbox', { provider: 'docker', mode: 'container' }, null, fixture)

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-factory-sandbox',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'future-factory-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('unsupported sandbox runtime docker/container') })
    expect(fixture.repos.agents.getByName('bad-factory-sandbox')).toBeNull()
  })

  it('rejects project-scoped sandbox profiles at factory Agent update scope', async () => {
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
    seedSandbox('project-future-sandbox', { provider: 'docker', mode: 'container' }, project.id, fixture)
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'project-scoped-agent', model: 'gpt-5.4' },
    })
    const id = (created.json as { id: string }).id
    const before = fixture.repos.agents.get(id as never)

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { resourceRefs: { sandboxRef: 'project-future-sandbox' } },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.json).toMatchObject({ error: expect.stringContaining('sandboxRef "project-future-sandbox" references a SandboxProfile resource outside the run project') })
    expect(fixture.repos.agents.get(id as never)).toEqual(before)
  })
})

function seedSandbox(
  name: string,
  spec: Record<string, unknown>,
  projectId: ProjectId | null,
  fixture: TestFixture,
): void {
  fixture.repos.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'SandboxProfile',
    projectId,
    name,
    spec: spec as never,
  })
}
