import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

describe('agents resource ref identity validation', () => {
  let fixture: TestFixture

  beforeEach(async () => {
    fixture = await createFixture()
    seedFactoryResources(fixture)
  })

  afterEach(() => {
    fixture.close()
  })

  it.each([
    ['missing sandboxRef', { sandboxRef: 'missing-sandbox' }, 'sandboxRef not found: missing-sandbox'],
    ['wrong-kind sandboxRef', { sandboxRef: 'workflow-default' }, 'references WorkflowProfile, expected SandboxProfile'],
    ['cross-project sandboxRef', { sandboxRef: 'project-sandbox' }, 'references a SandboxProfile resource outside the run project'],
    ['missing workflowProfileRef', { workflowProfileRef: 'missing-workflow' }, 'workflowProfileRef not found: missing-workflow'],
    ['wrong-kind workflowProfileRef', { workflowProfileRef: 'host-worktree' }, 'references SandboxProfile, expected WorkflowProfile'],
    ['cross-project workflowProfileRef', { workflowProfileRef: 'project-workflow' }, 'references a WorkflowProfile resource outside the run project'],
  ] as const)('rejects %s without persisting the Agent', async (name, refs, expected) => {
    seedProjectResources(fixture)

    const result = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name, model: 'gpt-5.4', resourceRefs: refs },
    })

    expect(result.response.status).toBe(400)
    expect(result.json).toMatchObject({ error: expect.stringContaining(expected) })
    expect(fixture.repos.agents.getByName(name)).toBeNull()
  })
})

function seedFactoryResources(fixture: TestFixture): void {
  fixture.repos.configResources.create({
    id: 'sandbox-host-worktree' as never,
    kind: 'SandboxProfile',
    projectId: null,
    name: 'host-worktree',
    spec: { provider: 'host', mode: 'worktree' },
  })
  fixture.repos.configResources.create({
    id: 'workflow-default' as never,
    kind: 'WorkflowProfile',
    projectId: null,
    name: 'workflow-default',
    spec: { path: 'workflows/coding-guard-profile.yaml' },
  })
}

function seedProjectResources(fixture: TestFixture): void {
  const factory = fixture.repos.factory.get() ?? fixture.repos.factory.create({
    id: 'factory-id' as never,
    name: 'Ductum',
    config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
  })
  const project = fixture.repos.projects.create({
    id: 'other-project' as never,
    factoryId: factory.id,
    name: 'other',
    repos: [],
    config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
  })
  fixture.repos.configResources.create({
    id: 'project-sandbox-id' as never,
    kind: 'SandboxProfile',
    projectId: project.id,
    name: 'project-sandbox',
    spec: { provider: 'host', mode: 'worktree' },
  })
  fixture.repos.configResources.create({
    id: 'project-workflow-id' as never,
    kind: 'WorkflowProfile',
    projectId: project.id,
    name: 'project-workflow',
    spec: { path: 'workflows/coding-guard-profile.yaml' },
  })
}
