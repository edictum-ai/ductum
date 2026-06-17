import type { Component, Repository } from './resource-types.js'
import { componentFromTarget, repositoryFromTarget } from './repository-model.js'
import type { ComponentRepo, RepositoryRepo, SpecRepo, TargetRepo } from './repos/interfaces.js'
import type { ProjectId, Task } from './types.js'

export type TaskScopeSource = 'task' | 'target' | 'legacy-repos'

export interface ResolvedTaskScope {
  repository: Repository
  component: Component | null
  source: TaskScopeSource
}

export interface TaskScopeRepos {
  repositories: RepositoryRepo
  components: ComponentRepo
  targets: TargetRepo
  specs: SpecRepo
}

export function resolveTaskScope(task: Task, repos: TaskScopeRepos): ResolvedTaskScope | null {
  const explicit = resolveExplicitTaskScope(task, repos)
  if (explicit != null) return explicit
  const target = task.targetId == null ? null : repos.targets.get(task.targetId)
  if (target != null) {
    return {
      repository: repositoryFromTarget(target),
      component: componentFromTarget(target),
      source: 'target',
    }
  }
  return resolveLegacyRepoScope(task, repos)
}

function resolveExplicitTaskScope(task: Task, repos: TaskScopeRepos): ResolvedTaskScope | null {
  const repository = task.repositoryId == null ? null : repos.repositories.get(task.repositoryId as Repository['id'])
  const component = task.componentId == null ? null : repos.components.get(task.componentId as Component['id'])
  if (repository == null && component == null) return null
  if (component != null && repository != null && component.repositoryId !== repository.id) {
    throw new Error(`Task ${task.id} component does not belong to repository ${repository.name}`)
  }
  if (repository != null) return { repository, component, source: 'task' }
  const componentRepository = repos.repositories.get(component!.repositoryId)
  if (componentRepository == null) throw new Error(`Task ${task.id} component repository not found`)
  return { repository: componentRepository, component, source: 'task' }
}

function resolveLegacyRepoScope(task: Task, repos: TaskScopeRepos): ResolvedTaskScope | null {
  const spec = repos.specs.get(task.specId)
  if (spec == null) return null
  const repoName = task.repos[0]
  if (repoName == null) {
    const projectRepositories = repos.repositories.list(spec.projectId)
    if (projectRepositories.length > 1) {
      throw new Error(`Task ${task.id} must specify a Repository in multi-repository project ${spec.projectId}`)
    }
    const repository = projectRepositories[0] ?? null
    return repository == null ? null : { repository, component: null, source: 'legacy-repos' }
  }
  const repository = repoName == null
    ? null
    : findRepository(spec.projectId, repoName, repos.repositories)
      ?? syntheticLocalRepository(spec.projectId, repoName)
  return repository == null ? null : { repository, component: null, source: 'legacy-repos' }
}

function findRepository(projectId: ProjectId, value: string, repo: RepositoryRepo): Repository | null {
  return repo.list(projectId).find((candidate) =>
    candidate.name === value
    || candidate.spec.localPath === value
    || candidate.spec.remoteUrl === value
    || candidate.identity.value === value
  ) ?? null
}

function syntheticLocalRepository(projectId: ProjectId, value: string): Repository {
  return {
    id: `legacy:${value}` as Repository['id'],
    projectId,
    name: value,
    identity: { kind: 'local', value, portable: false },
    portable: false,
    readiness: {
      portable: false,
      supportsLocalWorkflow: true,
      supportsRemoteWorkflow: false,
      local: { state: 'ready', path: value },
      git: { state: 'missing' },
      github: { state: 'missing', reason: 'legacy task repository has no remote configured' },
    },
    spec: { localPath: value },
    createdAt: '',
    updatedAt: '',
  }
}
