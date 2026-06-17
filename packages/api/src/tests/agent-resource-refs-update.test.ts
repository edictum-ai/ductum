import { AgentRuntimeResolutionError } from '@ductum/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('Agent resource ref updates', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
    seedRuntimeResources(fixture)
  })

  afterEach(() => {
    fixture.close()
  })

  it('rejects direct model updates while modelRef remains set', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'ref-agent',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
      },
    })
    const id = (created.json as { id: string }).id

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { model: 'gpt-5.4-mini' },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.json).toMatchObject({ error: 'Agent model is a raw provider model ID; omit model while modelRef is set' })
    expect(fixture.repos.agents.get(id as never)?.model).toBe('gpt-5.4')
  })

  it('requires supportedEfforts before validating effort on any model resource', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'bad-effort',
        effort: 'max',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('must define supportedEfforts') })
    expect(fixture.repos.agents.getByName('bad-effort')).toBeNull()
  })

  it('rejects direct runtime fields together with matching refs on create', async () => {
    const modelConflict = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'model-conflict',
        model: 'claude-opus-4-6',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
      },
    })
    const harnessConflict = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'harness-conflict',
        harness: 'claude-agent-sdk',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
      },
    })
    const emptyModelConflict = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'empty-model-conflict',
        model: '',
        resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
      },
    })

    expect(modelConflict.response.status).toBe(400)
    expect(modelConflict.json).toMatchObject({ error: 'Agent model is a raw provider model ID; omit model when modelRef is set' })
    expect(harnessConflict.response.status).toBe(400)
    expect(harnessConflict.json).toMatchObject({ error: 'Agent harness is a raw Harness adapter type; omit harness when harnessRef is set' })
    expect(emptyModelConflict.response.status).toBe(400)
    expect(emptyModelConflict.json).toMatchObject({ error: 'Agent model is a raw provider model ID; omit model when modelRef is set' })
  })

  it('treats top-level REST refs like nested resourceRefs instead of dropping them', async () => {
    const conflict = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'top-conflict', model: 'gpt-5.4', modelRef: 'gpt-54' },
    })
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'top-ref', modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
    })

    expect(conflict.response.status).toBe(400)
    expect(conflict.json).toMatchObject({ error: 'Agent model is a raw provider model ID; omit model when modelRef is set' })
    expect(fixture.repos.agents.getByName('top-conflict')).toBeNull()
    expect(created.response.status, created.text).toBe(201)
    expect(created.json).toMatchObject({
      model: 'gpt-5.4',
      harness: 'codex-sdk',
      resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' },
    })
  })

  it('rejects bad top-level refs on update without changing the saved refs', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'top-update', resourceRefs: { modelRef: 'gpt-54', harnessRef: 'codex-sdk' } },
    })
    const id = (created.json as { id: string }).id

    const updated = await requestJson(fixture.app, `/api/agents/${id}`, {
      method: 'PUT',
      body: { modelRef: 'missing-model' },
    })

    expect(updated.response.status).toBe(400)
    expect(updated.json).toMatchObject({ error: expect.stringContaining('modelRef not found: missing-model') })
    expect(fixture.repos.agents.get(id as never)?.resourceRefs?.modelRef).toBe('gpt-54')
  })

  it('requires supportedEfforts before validating effort on an uncataloged model resource', async () => {
    fixture.repos.configResources.create({
      id: 'custom-model' as never,
      kind: 'Model',
      projectId: null,
      name: 'custom-model',
      spec: { provider: 'custom', modelId: 'custom-model-v1' },
    })

    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'custom-effort',
        effort: 'high',
        resourceRefs: { modelRef: 'custom-model', harnessRef: 'codex-sdk' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({
      error: expect.stringContaining('must define supportedEfforts'),
    })
  })

  it('validates a direct model against a known resource-resolved harness', async () => {
    const created = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'mixed-agent',
        model: 'claude-opus-4-6',
        resourceRefs: { harnessRef: 'codex-sdk' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({
      error: expect.stringContaining('Agent mixed-agent direct model ID claude-opus-4-6 provider ID anthropic is not supported by Harness adapter type codex-sdk'),
    })
    expect(fixture.repos.agents.getByName('mixed-agent')).toBeNull()
  })

  it('still applies the static model catalog guard for direct models with uncataloged harness refs', async () => {
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
        name: 'unknown-direct-model',
        model: 'made-up-model',
        resourceRefs: { harnessRef: 'future-harness' },
      },
    })

    expect(created.response.status).toBe(400)
    expect(created.json).toMatchObject({ error: expect.stringContaining('Unsupported model: made-up-model') })
    expect(fixture.repos.agents.getByName('unknown-direct-model')).toBeNull()
  })

  it('keeps unsupported dispatch-time harness refs as server-state errors', async () => {
    fixture.close()
    fixture = await createFixture({
      dispatchTask: async () => {
        throw new AgentRuntimeResolutionError('Agent ref-agent harnessRef "future" resolved to unsupported harness: future', 'unsupported_harness')
      },
    })

    const dispatched = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      body: { taskId: 'task-id', agentId: 'agent-id' },
    })

    expect(dispatched.response.status).toBe(500)
    expect(dispatched.json).toMatchObject({ error: expect.stringContaining('resolved to unsupported harness') })
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
}
