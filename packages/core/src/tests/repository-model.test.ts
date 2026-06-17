import { afterEach, describe, expect, it } from 'vitest'

import {
  createId,
  repositoryIdentity,
  repositoryReadiness,
  resolveTaskScope,
} from '../index.js'
import { createRepoContext, seedBase } from './helpers.js'

let context: ReturnType<typeof createRepoContext> | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('Repository and Component model', () => {
  it('prefers remote URL as portable Repository identity when present', () => {
    const identity = repositoryIdentity('ductum', {
      remoteUrl: 'https://github.com/edictum-ai/ductum.git',
      localPath: '/Users/acartagena/project/ductum',
    })

    expect(identity).toEqual({
      kind: 'remote',
      value: 'https://github.com/edictum-ai/ductum.git',
      portable: true,
    })
  })

  it('marks local-only repositories non-portable and does not require remote workflow readiness', () => {
    const readiness = repositoryReadiness({ localPath: '/Users/acartagena/project/ductum' })

    expect(readiness.portable).toBe(false)
    expect(readiness.supportsLocalWorkflow).toBe(true)
    expect(readiness.supportsRemoteWorkflow).toBe(false)
    expect(readiness.github.state).toBe('missing')
  })

  it('keeps Components attached to exactly one Repository', () => {
    context = createRepoContext()
    const { factory, project } = seedBase(context)
    const repository = context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git' },
    })
    const other = context.projectRepo.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'other',
      repos: [],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const otherRepository = context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: other.id,
      name: 'other',
      spec: { localPath: '/tmp/other' },
    })

    const component = context.componentRepo.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: 'cli',
      spec: { path: 'packages/cli' },
    })

    expect(component.repositoryId).toBe(repository.id)
    expect(context.componentRepo.list(repository.id).map((item) => item.id)).toEqual([component.id])
    expect(context.componentRepo.list(otherRepository.id)).toEqual([])
  })

  it('resolves Task scope to Repository plus optional Component', () => {
    context = createRepoContext()
    const { spec } = seedBase(context)
    const repository = context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: spec.projectId,
      name: 'ductum',
      spec: { localPath: '/Users/acartagena/project/ductum' },
    })
    const component = context.componentRepo.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: 'api',
      spec: { path: 'packages/api' },
    })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      componentId: component.id,
      name: 'P4',
      prompt: 'implement',
      repos: ['/Users/acartagena/project/ductum'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })

    const scope = resolveTaskScope(task, scopeRepos(context))

    expect(scope?.repository.id).toBe(repository.id)
    expect(scope?.component?.id).toBe(component.id)
    expect(scope?.source).toBe('task')
  })

  it('bridges existing Target-backed task scope to Repository plus optional Component', () => {
    context = createRepoContext()
    const { project, spec } = seedBase(context)
    const target = context.targetRepo.create({
      id: createId<'TargetId'>(),
      projectId: project.id,
      name: 'ductum-api',
      spec: {
        source: {
          type: 'subdirectory',
          repo: 'https://github.com/edictum-ai/ductum.git',
          localPath: '/Users/acartagena/project/ductum',
          subdirectory: 'packages/api',
        },
      },
    })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      targetId: target.id,
      name: 'legacy-target',
      prompt: 'implement',
      repos: [],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })

    const scope = resolveTaskScope(task, scopeRepos(context))

    expect(scope?.repository.name).toBe('ductum-api')
    expect(scope?.repository.identity.value).toBe('https://github.com/edictum-ai/ductum.git')
    expect(scope?.component?.name).toBe('packages/api')
    expect(scope?.source).toBe('target')
  })

  it('rejects implicit legacy Repository scope in multi-repository Projects', () => {
    context = createRepoContext()
    const { project, spec } = seedBase(context)
    context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'api',
      spec: { localPath: '/repo/api' },
    })
    context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'cli',
      spec: { localPath: '/repo/cli' },
    })
    const task = context.taskRepo.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'unscoped',
      prompt: 'implement',
      repos: [],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })

    expect(() => resolveTaskScope(task, scopeRepos(context!))).toThrow(/must specify a Repository/)
  })
})

function scopeRepos(ctx: NonNullable<typeof context>) {
  return {
    repositories: ctx.repositoryRepo,
    components: ctx.componentRepo,
    targets: ctx.targetRepo,
    specs: ctx.specRepo,
  }
}
