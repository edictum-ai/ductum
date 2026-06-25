import { isAbsolute, normalize as normalizePath, resolve as resolvePath } from 'node:path'

import type { ConfigResource } from './resource-types.js'
import type { ProjectConfig, ProjectId } from './types.js'

export type ProjectWorkflowProfileResolutionIssue =
  | 'workflow_profile_ref_missing'
  | 'workflow_profile_legacy_missing'
  | 'workflow_profile_legacy_ambiguous'

export interface ProjectWorkflowProfileResolution {
  resource: ConfigResource | null
  issue: ProjectWorkflowProfileResolutionIssue | null
  reference: string | null
}

export function resolveProjectWorkflowProfileResource(
  workflowResources: readonly ConfigResource[],
  projectId: ProjectId,
  config: Pick<ProjectConfig, 'workflowProfileRef' | 'workflowProfile'>,
  repoRoots: readonly string[],
): ProjectWorkflowProfileResolution {
  const workflowProfileRef = trimToNull(config.workflowProfileRef)
  if (workflowProfileRef != null) {
    const resource = workflowResources.find((item) => item.id === workflowProfileRef && isProjectAccessible(item, projectId)) ?? null
    return {
      resource,
      issue: resource == null ? 'workflow_profile_ref_missing' : null,
      reference: workflowProfileRef,
    }
  }

  const workflowProfile = trimToNull(config.workflowProfile)
  if (workflowProfile == null) {
    return { resource: null, issue: null, reference: null }
  }

  const identityMatch = workflowResources.filter((item) => item.id === workflowProfile && isProjectAccessible(item, projectId))
  if (identityMatch.length === 1) {
    return { resource: identityMatch[0]!, issue: null, reference: workflowProfile }
  }

  const nameMatches = workflowResources.filter((item) => item.name === workflowProfile && isProjectAccessible(item, projectId))
  if (nameMatches.length === 1) {
    return { resource: nameMatches[0]!, issue: null, reference: workflowProfile }
  }
  if (nameMatches.length > 1) {
    return { resource: null, issue: 'workflow_profile_legacy_ambiguous', reference: workflowProfile }
  }

  const pathMatches = workflowResources.filter((item) => workflowResourcePathMatches(item, workflowProfile, projectId, repoRoots))
  if (pathMatches.length === 1) {
    return { resource: pathMatches[0]!, issue: null, reference: workflowProfile }
  }
  return {
    resource: null,
    issue: pathMatches.length > 1 ? 'workflow_profile_legacy_ambiguous' : 'workflow_profile_legacy_missing',
    reference: workflowProfile,
  }
}

export function migrateProjectWorkflowConfig(
  config: ProjectConfig,
  workflowResources: readonly ConfigResource[],
  projectId: ProjectId,
  repoRoots: readonly string[],
): ProjectConfig {
  if (trimToNull(config.workflowProfileRef) != null) return config
  const resolution = resolveProjectWorkflowProfileResource(workflowResources, projectId, config, repoRoots)
  return resolution.resource == null ? config : { ...config, workflowProfileRef: resolution.resource.id }
}

export function workflowResourcePathMatches(
  resource: ConfigResource,
  workflowProfile: string,
  projectId: ProjectId,
  repoRoots: readonly string[],
): boolean {
  if (!isProjectAccessible(resource, projectId)) return false
  const recordPath = trimToNull((resource.spec as { path?: unknown }).path)
  if (recordPath == null) return false
  if (recordPath === workflowProfile) return true
  const workflowForms = absolutePathForms(workflowProfile, repoRoots)
  for (const form of absolutePathForms(recordPath, repoRoots)) {
    if (workflowForms.has(form)) return true
  }
  return false
}

function isProjectAccessible(resource: ConfigResource, projectId: ProjectId): boolean {
  return resource.projectId == null || resource.projectId === projectId
}

function absolutePathForms(target: string, repoRoots: readonly string[]): Set<string> {
  if (isAbsolute(target)) return new Set([normalizePath(target)])
  const forms = new Set(repoRoots.map((root) => resolvePath(root, target)))
  forms.add(resolvePath(target))
  return forms
}

function trimToNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
