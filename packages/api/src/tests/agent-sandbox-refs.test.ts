import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('Agent sandbox refs', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
    fixture.repos.configResources.create({
      id: 'sandbox-host-worktree' as never,
      kind: 'SandboxProfile',
      projectId: null,
      name: 'host-worktree',
      spec: { provider: 'host', mode: 'worktree' },
    })
  })

  afterEach(() => {
    fixture.close()
  })

  it('rejects bad factory-scope sandboxRef on Agent create', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-sandbox',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'missing-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('sandboxRef not found: missing-sandbox') })
    expect(fixture.repos.agents.getByName('bad-sandbox')).toBeNull()
  })

  it('rejects project-scoped sandboxRef at factory Agent write scope', async () => {
    const factory = fixture.repos.factory.create({
      id: 'factory-id' as never,
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    const project = fixture.repos.projects.create({
      id: 'project-sandbox' as never,
      factoryId: factory.id,
      name: 'project-sandbox',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.configResources.create({
      id: 'project-sandbox-profile' as never,
      kind: 'SandboxProfile',
      projectId: project.id,
      name: 'project-only-sandbox',
      spec: { provider: 'host', mode: 'worktree' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'project-sandbox-agent',
        model: 'gpt-5.4',
        resourceRefs: { sandboxRef: 'project-only-sandbox' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('sandboxRef "project-only-sandbox" references a SandboxProfile resource outside the run project') })
    expect(fixture.repos.agents.getByName('project-sandbox-agent')).toBeNull()
  })
})
