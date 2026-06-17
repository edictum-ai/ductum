import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'
import { optionalString, optionalStringArray } from './http.js'
import { repositoryLegacyRef } from './repositories.js'

interface TaskSourceScope {
  repositoryId: string | null
  componentId: string | null
  repos: string[]
}

export function resolveTaskSourceScope(
  context: ApiContext,
  projectId: Parameters<ApiContext['repos']['repositories']['list']>[0],
  body: Record<string, unknown>,
): TaskSourceScope {
  const bodyRepos = optionalStringArray(body.repos, 'repos')
  const repositoryId = optionalString(body.repositoryId, 'repositoryId') ?? null
  const componentId = optionalString(body.componentId, 'componentId') ?? null
  const component = componentId == null ? null : context.repos.components.get(componentId as never)
  if (componentId != null && component == null) throw new NotFoundError(`Component not found: ${componentId}`)

  const resolvedRepositoryId = repositoryId ?? component?.repositoryId ?? null
  const repository = resolvedRepositoryId == null ? null : context.repos.repositories.get(resolvedRepositoryId as never)
  if (resolvedRepositoryId != null && repository == null) {
    throw new NotFoundError(`Repository not found: ${resolvedRepositoryId}`)
  }
  if (repository != null && repository.projectId !== projectId) {
    throw new ValidationError('Task repository must belong to the same project as the spec')
  }
  if (component != null && repository != null && component.repositoryId !== repository.id) {
    throw new ValidationError('Task component must belong to the task repository')
  }

  const projectRepositories = repository == null ? context.repos.repositories.list(projectId) : []
  if (repository == null && (bodyRepos == null || bodyRepos.length === 0) && projectRepositories.length > 1) {
    throw new ValidationError('Task repositoryId or componentId is required for multi-repository projects')
  }
  const inferredRepository = repository ?? (projectRepositories.length === 1 ? projectRepositories[0]! : null)

  return {
    repositoryId: inferredRepository?.id ?? null,
    componentId: component?.id ?? null,
    repos: bodyRepos ?? (inferredRepository == null ? [] : [repositoryLegacyRef(inferredRepository)]),
  }
}
