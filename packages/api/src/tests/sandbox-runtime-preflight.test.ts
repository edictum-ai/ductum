import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('sandbox runtime preflight API run creation', () => {
  let fixture: TestFixture
  let seeded: ReturnType<typeof seedBase>
  const cleanupPaths: string[] = []

  beforeEach(async () => {
    fixture = await createFixture()
    seeded = seedBase(fixture)
  })

  afterEach(() => {
    fixture.close()
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  function createWorkflowProfileFile(contents = `
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: api-workflow
context:
  required_files: [SNAPSHOT.md]
verify:
  commands: ['pnpm test']
push: {}
`): string {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-api-workflow-profile-'))
    cleanupPaths.push(dir)
    mkdirSync(join(dir, '.edictum'))
    writeFileSync(join(dir, 'SNAPSHOT.md'), '# Snapshot\n')
    const profilePath = join(dir, '.edictum', 'profile.yaml')
    writeFileSync(profilePath, contents)
    return profilePath
  }

  it('rejects a bad sandboxRef before accept creates a run', async () => {
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'missing-sandbox' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining('sandboxRef not found: missing-sandbox') })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it.each([
    ['wrong-kind', (): string => {
      fixture.repos.configResources.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'Model',
        projectId: null,
        name: 'bad-sandbox',
        spec: { provider: 'openai', modelId: 'gpt-5.4' },
      })
      return 'references Model, expected SandboxProfile'
    }],
    ['cross-project', (): string => {
      const project = fixture.repos.projects.create({
        id: createId<'ProjectId'>(),
        factoryId: seeded.factory.id,
        name: 'other',
        repos: [],
        config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
      })
      fixture.repos.configResources.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'SandboxProfile',
        projectId: project.id,
        name: 'bad-sandbox',
        spec: { provider: 'host', mode: 'worktree' },
      })
      return 'outside the run project'
    }],
    ['malformed', (): string => {
      fixture.repos.configResources.create({
        id: createId<'ConfigResourceId'>(),
        kind: 'SandboxProfile',
        projectId: null,
        name: 'bad-sandbox',
        spec: { provider: 'host' } as never,
      })
      return 'without spec.mode'
    }],
  ] as const)('rejects %s sandboxRef through API accept', async (_name, setup) => {
    const expected = setup()
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'bad-sandbox' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining(expected) })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it('snapshots a resolved sandboxRef when accept creates a run', async () => {
    const sandbox = fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: seeded.project.id,
      name: 'api-worktree',
      spec: { provider: 'host', mode: 'worktree' },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'api-worktree' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status, accepted.text).toBe(201)
    expect(accepted.json).toMatchObject({
      runtimeSandboxProfile: {
        id: sandbox.id,
        name: 'api-worktree',
        projectId: seeded.project.id,
        provider: 'host',
        mode: 'worktree',
      },
    })
  })

  it('rejects a deferred project-scoped unsupported sandboxRef before accept creates a run', async () => {
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: seeded.project.id,
      name: 'project-future-sandbox',
      spec: { provider: 'docker', mode: 'container' },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'project-future-sandbox' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining('unsupported sandbox runtime docker/container') })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it('snapshots a resolved workflowProfileRef when accept creates a run', async () => {
    const profilePath = createWorkflowProfileFile()
    const profile = fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: seeded.project.id,
      name: 'api-workflow',
      spec: { path: profilePath, description: 'API workflow' },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { workflowProfileRef: 'api-workflow' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status, accepted.text).toBe(201)
    expect(accepted.json).toMatchObject({
      runtimeWorkflowProfile: {
        id: profile.id,
        name: 'api-workflow',
        projectId: seeded.project.id,
        path: profilePath,
        description: 'API workflow',
        renderedWorkflow: expect.stringContaining('stages:'),
        setupCommands: [],
        verifyCommands: ['pnpm test'],
      },
    })
  })

  it('rejects a bad workflowProfileRef before accept creates a run', async () => {
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { workflowProfileRef: 'missing-workflow' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining('workflowProfileRef not found: missing-workflow') })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it('rejects an unrenderable workflowProfileRef before accept creates a run', async () => {
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: seeded.project.id,
      name: 'api-unrenderable-workflow',
      spec: { path: '/tmp/ductum-missing-workflow-profile.yaml' },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { workflowProfileRef: 'api-unrenderable-workflow' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining('could not render WorkflowProfile') })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it('rejects workflowProfileRef when API accept cannot validate profiles', async () => {
    fixture.close()
    fixture = await createFixture({ validateWorkflowProfile: undefined })
    seeded = seedBase(fixture)
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'WorkflowProfile',
      projectId: seeded.project.id,
      name: 'api-unvalidated-workflow',
      spec: { path: createWorkflowProfileFile() },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { workflowProfileRef: 'api-unvalidated-workflow' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(500)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining('has no workflow profile validator') })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })

  it('keeps legacy no-ref accept behavior with a null sandbox snapshot', async () => {
    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status, accepted.text).toBe(201)
    expect(accepted.json).toMatchObject({ runtimeSandboxProfile: null, runtimeWorkflowProfile: null })
  })

  it('reports an active-run conflict before resolving a later-bad sandboxRef', async () => {
    const first = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'missing-sandbox' } })

    const second = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(first.response.status, first.text).toBe(201)
    expect(second.response.status).toBe(409)
    expect(second.json).toMatchObject({ error: expect.stringContaining('already has an active run') })
    expect(fixture.repos.runs.list(seeded.task.id)).toHaveLength(1)
  })
})
