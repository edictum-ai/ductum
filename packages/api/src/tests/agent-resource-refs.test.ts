import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('agent resource refs', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
    seedRuntimeResources(fixture)
  })

  afterEach(() => {
    fixture.close()
  })

  it('persists and returns Agent composition refs', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'codex-builder',
        resourceRefs: {
          modelRef: 'gpt-54',
          harnessRef: 'codex-sdk',
          sandboxRef: 'host-worktree',
          systemPromptRef: 'prompts/builder.md',
          policyRef: 'edictum-coding',
        },
      },
    })

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({
      resourceRefs: {
        modelRef: 'gpt-54',
        harnessRef: 'codex-sdk',
        sandboxRef: 'host-worktree',
        policyRef: 'edictum-coding',
      },
    })
    const id = (created.json as { id: string }).id
    expect(fixture.repos.agents.get(id as never)?.resourceRefs?.systemPromptRef).toBe('prompts/builder.md')
  })

  it('creates an Agent from modelRef and harnessRef without legacy fields', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'ref-only',
        resourceRefs: {
          modelRef: 'gpt-54',
          harnessRef: 'codex-sdk',
        },
      },
    })

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({
      name: 'ref-only',
      model: 'gpt-5.4',
      harness: 'codex-sdk',
      resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
    })
  })

  it('round-trips provider/account identity through create, update, and list', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'identity-agent',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
        providerId: ' openai ',
        accountId: ' acct-primary ',
      },
    })
    const id = (created.json as { id: string }).id

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({ providerId: 'openai', accountId: 'acct-primary' })
    expect(fixture.repos.agents.get(id as never)).toMatchObject({ providerId: 'openai', accountId: 'acct-primary' })

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { providerId: 'openai', accountId: 'acct-secondary' },
    })
    expect(updated.response.status, updated.text).toBe(200)
    expect(updated.json).toMatchObject({ providerId: 'openai', accountId: 'acct-secondary' })

    const listed = await requestJson(fixture.app, '/api/agents')
    expect(listed.json).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, providerId: 'openai', accountId: 'acct-secondary' }),
    ]))

    const cleared = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { providerId: null, accountId: '' },
    })
    expect(cleared.json).toMatchObject({ providerId: null, accountId: null })
  })

  it('accepts modelRef values that are not in the static model catalog', async () => {
    fixture.repos.configResources.create({
      id: 'model-next' as never,
      kind: 'Model',
      projectId: null,
      name: 'next-model',
      spec: { provider: 'openai', modelId: 'gpt-next-runtime' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'next-ref',
        resourceRefs: {
          modelRef: 'next-model',
          harnessRef: 'codex-sdk',
        },
      },
    })

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({ model: 'gpt-next-runtime', harness: 'codex-sdk' })
  })

  it('persists resource-resolved harness types outside the static API catalog', async () => {
    fixture.repos.configResources.create({
      id: 'future-harness' as never,
      kind: 'Harness',
      projectId: null,
      name: 'future-harness',
      spec: { type: 'future-harness' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'future-agent',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'future-harness' },
      },
    })

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({ harness: 'future-harness' })
    expect(fixture.repos.agents.getByName('future-agent')?.harness).toBe('future-harness')
  })

  it('rejects a bad modelRef instead of falling back to legacy fields', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-ref',
        resourceRefs: { modelRef: 'missing-model' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('modelRef not found: missing-model') })
    expect(fixture.repos.agents.getByName('bad-ref')).toBeNull()
  })

  it('rejects wrong-kind and cross-project refs', async () => {
    const wrongKind = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'wrong-kind',
        resourceRefs: { modelRef: 'codex-sdk' },
      },
    })

    expect(wrongKind.response.status).toBe(400)
    expect(wrongKind.json).toMatchObject({ error: expect.stringContaining('references Harness, expected Model') })

    const factory = fixture.repos.factory.get() ?? fixture.repos.factory.create({
      id: 'factory-id' as never,
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    const other = fixture.repos.projects.create({
      id: 'other-project' as never,
      factoryId: factory.id,
      name: 'other',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    fixture.repos.configResources.create({
      id: 'other-model-id' as never,
      kind: 'Model',
      projectId: other.id,
      name: 'other-model',
      spec: { provider: 'openai', modelId: 'gpt-5.4' },
    })

    const crossProject = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'cross-project',
        resourceRefs: { modelRef: 'other-model' },
      },
    })

    expect(crossProject.response.status).toBe(400)
    expect(crossProject.json).toMatchObject({ error: expect.stringContaining('outside the run project') })
  })

  it('rejects bad harnessRef instead of falling back to legacy harness', async () => {
    const missing = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-harness',
        model: 'gpt-5.4',
        resourceRefs: { harnessRef: 'missing-harness' },
      },
    })

    expect(missing.response.status).toBe(400)
    expect(missing.json).toMatchObject({ error: expect.stringContaining('harnessRef not found: missing-harness') })
    expect(fixture.repos.agents.getByName('bad-harness')).toBeNull()

    const wrongKind = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'wrong-harness-kind',
        model: 'gpt-5.4',
        resourceRefs: { harnessRef: 'gpt-54' },
      },
    })

    expect(wrongKind.response.status).toBe(400)
    expect(wrongKind.json).toMatchObject({ error: expect.stringContaining('references Model, expected Harness') })
  })

  it('creates an Agent from resource-backed models and harnesses outside the static catalogs', async () => {
    fixture.repos.configResources.create({
      id: 'model-local-next' as never,
      kind: 'Model',
      projectId: null,
      name: 'local-next',
      spec: { provider: 'openai', modelId: 'gpt-next-runtime' },
    })
    fixture.repos.configResources.create({
      id: 'harness-local-codex' as never,
      kind: 'Harness',
      projectId: null,
      name: 'local-codex',
      spec: { type: 'codex-sdk' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'codex',
        resourceRefs: { modelRef: 'local-next', harnessRef: 'local-codex' },
      },
    })

    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({ model: 'gpt-next-runtime', harness: 'codex-sdk' })
  })
})

function seedRuntimeResources(fixture: TestFixture) {
  fixture.repos.configResources.create({
    id: 'model-gpt54' as never,
    kind: 'Model',
    projectId: null,
    name: 'gpt-54',
    spec: { provider: 'openai', modelId: 'gpt-5.4' },
  })
  fixture.repos.configResources.create({
    id: 'harness-codex' as never,
    kind: 'Harness',
    projectId: null,
    name: 'codex-sdk',
    spec: { type: 'codex-sdk' },
  })
  fixture.repos.configResources.create({
    id: 'sandbox-host-worktree' as never,
    kind: 'SandboxProfile',
    projectId: null,
    name: 'host-worktree',
    spec: { provider: 'host', mode: 'worktree' },
  })
}
