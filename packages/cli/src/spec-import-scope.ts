import type { Component, Repository } from '@ductum/core'

import type { DuctumApi } from './api-client.js'
import type { ImportedSpec } from './spec-import-types.js'

export interface ImportedTaskScope {
  repositoryId?: string
  componentId?: string
}

export interface ImportedTaskScopeDefaults {
  repository?: string
  component?: string
}

export async function resolveImportedTaskScopes(
  api: DuctumApi,
  projectId: string,
  imported: ImportedSpec,
  defaults: ImportedTaskScopeDefaults = {},
): Promise<Map<string, ImportedTaskScope>> {
  const repositories = await api.listRepositories(projectId)
  const componentsByRepository = new Map<string, Component[]>()
  const result = new Map<string, ImportedTaskScope>()
  const unscoped = imported.tasks.filter((task) =>
    task.repository == null
    && task.component == null
    && defaults.repository == null
    && defaults.component == null
    && task.repos.length === 0
  )
  if (repositories.length > 1 && unscoped.length > 0) {
    throw new Error([
      `Task "${unscoped[0]?.name ?? 'unknown'}" requires --repository or task Repository metadata for multi-repository project ${projectId}.`,
      `Available repositories: ${repositories.map((repo) => repo.name).join(', ')}`,
    ].join(' '))
  }
  if (!hasAnyScope(imported, defaults)) return result

  for (const task of imported.tasks) {
    const repositoryRef = task.repository ?? defaults.repository
    const componentRef = task.component ?? defaults.component
    if (repositoryRef == null && componentRef == null) continue
    const repository = resolveRepository(repositories, repositoryRef, task.name)
    const components = await listComponents(api, componentsByRepository, repository.id)
    const component = componentRef == null ? null : resolveComponent(components, componentRef, task.name)
    result.set(task.name, {
      repositoryId: repository.id,
      ...(component == null ? {} : { componentId: component.id }),
    })
  }

  return result
}

async function listComponents(
  api: DuctumApi,
  cache: Map<string, Component[]>,
  repositoryId: string,
): Promise<Component[]> {
  const cached = cache.get(repositoryId)
  if (cached != null) return cached
  const components = await api.listComponents(repositoryId)
  cache.set(repositoryId, components)
  return components
}

function resolveRepository(repositories: Repository[], ref: string | undefined, taskName: string): Repository {
  if (ref == null) throw new Error(`Task "${taskName}" has component scope but no repository`)
  const repository = repositories.find((candidate) =>
    candidate.id === ref
    || candidate.name === ref
    || candidate.spec.localPath === ref
    || candidate.spec.remoteUrl === ref
  )
  if (repository == null) throw new Error(`Repository "${ref}" not found for task "${taskName}"`)
  return repository
}

function resolveComponent(components: Component[], ref: string, taskName: string): Component {
  const component = components.find((candidate) =>
    candidate.id === ref || candidate.name === ref || candidate.spec.path === ref
  )
  if (component == null) throw new Error(`Component "${ref}" not found for task "${taskName}"`)
  return component
}

function hasAnyScope(imported: ImportedSpec, defaults: ImportedTaskScopeDefaults): boolean {
  return defaults.repository != null
    || defaults.component != null
    || imported.tasks.some((task) => task.repository != null || task.component != null)
}
