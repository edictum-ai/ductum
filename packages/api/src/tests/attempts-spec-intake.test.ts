import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('Attempt and SpecIntake public paths', () => {
  it('exposes new Run-backed execution through Attempt JSON with runtime snapshot', async () => {
    fixture = await createFixture()
    const { project, builder, spec } = seedBase(fixture)
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/repo/ductum' },
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      name: 'P5',
      prompt: 'implement',
      repos: ['/repo/ductum'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: [],
    })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accepted.json as { id: string }).id
    const attempt = await requestJson(fixture.app, `/api/attempts/${runId}`)

    expect(attempt.response.status).toBe(200)
    expect(attempt.json).toMatchObject({
      recordType: 'Attempt',
      id: runId,
      taskId: task.id,
      agentId: builder.id,
      snapshot: {
        completeness: 'full',
        legacy: false,
        runtime: {
          repository: { id: repository.id, name: 'ductum' },
          agent: { name: 'mimi' },
        },
      },
    })
    expect(attempt.json).not.toHaveProperty('parentRunId')
  })

  it('creates one Spec with Repository-scoped Tasks from SpecIntake and no Attempts', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const apiRepo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'api',
      spec: { localPath: '/repo/api' },
    })
    const cliRepo = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'cli',
      spec: { localPath: '/repo/cli' },
    })

    const result = await requestJson(fixture.app, '/api/spec-intake', {
      method: 'POST',
      body: {
        schemaVersion: 'ductum.spec-intake.v1',
        project: { id: project.id, name: project.name },
        spec: { name: 'multi-repo', document: '# Multi repo' },
        repositories: [
          { id: apiRepo.id, name: 'api', tasks: [{ name: 'API task', prompt: 'api work' }] },
          { id: cliRepo.id, name: 'cli', tasks: [{ name: 'CLI task', prompt: 'cli work', dependsOn: ['API task'] }] },
        ],
      },
    })

    expect(result.response.status).toBe(201)
    expect(result.json).toMatchObject({
      recordType: 'SpecIntake',
      spec: { recordType: 'Spec', name: 'multi-repo', taskCount: 2 },
      taskCount: 2,
      dependencyCount: 1,
    })
    expect(result.json).not.toHaveProperty('attempts')

    const tasks = (result.json as { tasks: Array<{ id: string; specId: string; repositoryId: string }> }).tasks
    expect(new Set(tasks.map((task) => task.specId)).size).toBe(1)
    expect(tasks.map((task) => task.repositoryId).sort()).toEqual([apiRepo.id, cliRepo.id].sort())
    expect(tasks.flatMap((task) => fixture!.repos.runs.list(task.id as never))).toEqual([])
  })

  it('rejects unscoped Task creation in a multi-repository Project', async () => {
    fixture = await createFixture()
    const { project, spec } = seedBase(fixture)
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'api',
      spec: { localPath: '/repo/api' },
    })
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'cli',
      spec: { localPath: '/repo/cli' },
    })

    const created = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'unscoped', prompt: 'work' },
    })

    expect(created.response.status).toBe(400)
    expect(created.text).toContain('repositoryId or componentId is required')
  })
})
