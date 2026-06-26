import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { createId, loadRenderedWorkflow, loadWorkflowProfile, resolveProjectWorkflowProfileResource, type RepoWorkflowProfile } from '@ductum/core'

export interface StoredWorkflowSelection {
  workflowProfile: string
  workflowProfileRef: string
}

export function parseWorkflowProfilesEnv(raw = process.env.DUCTUM_WORKFLOW_PROFILES): Map<string, string> {
  const profiles = new Map<string, string>()
  if (raw == null || raw.trim() === '') {
    return profiles
  }

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') {
      continue
    }
    const separator = trimmed.indexOf(':')
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new Error(`Invalid DUCTUM_WORKFLOW_PROFILES entry: ${trimmed}`)
    }
    profiles.set(trimmed.slice(0, separator), trimmed.slice(separator + 1))
  }

  return profiles
}

export function loadWorkflowDefsByProjectName(
  templatePath: string,
  raw = process.env.DUCTUM_WORKFLOW_PROFILES,
): Map<string, ReturnType<typeof loadRenderedWorkflow>> {
  const workflowDefs = new Map<string, ReturnType<typeof loadRenderedWorkflow>>()
  for (const [projectName, profilePath] of parseWorkflowProfilesEnv(raw)) {
    workflowDefs.set(projectName, loadRenderedWorkflow(templatePath, profilePath))
  }
  return workflowDefs
}

export function loadProfilesByProjectName(
  raw = process.env.DUCTUM_WORKFLOW_PROFILES,
): Map<string, RepoWorkflowProfile> {
  const profiles = new Map<string, RepoWorkflowProfile>()
  for (const [projectName, profilePath] of parseWorkflowProfilesEnv(raw)) {
    profiles.set(projectName, loadWorkflowProfile(profilePath))
  }
  return profiles
}

export function parseRepoPathMapEnv(raw = process.env.DUCTUM_REPO_PATH_MAP): Record<string, string> {
  if (raw == null || raw.trim() === '') {
    return {}
  }

  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

export function normalizeWorkflowProfilePath(
  workflowProfile: string,
  repoNames: string[],
  repoPathMap = parseRepoPathMapEnv(),
): string {
  return normalizeWorkflowProfilePathWithRoots(workflowProfile, repoRootsForNames(repoNames, repoPathMap))
}

function normalizeWorkflowProfilePathWithRoots(workflowProfile: string, repoRoots: string[]): string {
  if (isAbsolute(workflowProfile)) {
    const normalizedPath = resolve(workflowProfile)
    if (!existsSync(normalizedPath)) {
      throw new Error(`workflowProfile not found: ${normalizedPath}`)
    }
    if (repoRoots.length > 0 && !repoRoots.some((repoRoot) => isPathWithin(repoRoot, normalizedPath))) {
      throw new Error(`workflowProfile must be inside a configured repo path: ${normalizedPath}`)
    }
    return normalizedPath
  }

  if (repoRoots.length === 0) {
    throw new Error(`workflowProfile must be absolute when repo paths are unavailable: ${workflowProfile}`)
  }

  const matches = repoRoots
    .map((repoRoot) => resolve(repoRoot, workflowProfile))
    .filter((candidate) => existsSync(candidate))

  if (matches.length === 1) {
    return matches[0]!
  }
  if (matches.length === 0) {
    throw new Error(`workflowProfile not found in project repos: ${workflowProfile}`)
  }
  throw new Error(`workflowProfile is ambiguous across project repos: ${workflowProfile}`)
}

export function resolveStoredWorkflowSelection(input: {
  workflowProfile: string
  projectId: string
  repoNames: string[]
  repoRoots?: string[]
  configResources: {
    create: any
    getByName: any
    list: any
  }
  repoPathMap?: Record<string, string>
}): StoredWorkflowSelection {
  const resources = input.configResources.list({ kind: 'WorkflowProfile' })
  const repoRoots = [
    ...new Set([...(input.repoRoots ?? []), ...repoRootsForNames(input.repoNames, input.repoPathMap ?? parseRepoPathMapEnv())]),
  ].map((repoRoot) => resolve(repoRoot))
  const raw = input.workflowProfile.trim()
  const direct = resolveProjectWorkflowProfileResource(resources as never, input.projectId as never, { workflowProfile: raw }, repoRoots)
  if (direct.resource != null && !looksLikeWorkflowPath(raw)) {
    return { workflowProfile: raw, workflowProfileRef: direct.resource.id }
  }
  if (!looksLikeWorkflowPath(raw)) {
    if (direct.issue === 'workflow_profile_legacy_ambiguous') {
      throw new Error(`workflowProfile matches multiple WorkflowProfile records: ${raw}`)
    }
    throw new Error(`workflowProfile not found: ${raw}`)
  }

  const normalizedPath = normalizeWorkflowProfilePathWithRoots(raw, repoRoots)
  const normalized = resolveProjectWorkflowProfileResource(
    resources as never,
    input.projectId as never,
    { workflowProfile: normalizedPath },
    repoRoots,
  )
  if (normalized.resource != null) {
    return { workflowProfile: normalizedPath, workflowProfileRef: normalized.resource.id }
  }

  const profile = loadWorkflowProfile(normalizedPath)
  const existing = input.configResources.getByName('WorkflowProfile', profile.metadata.name, input.projectId)
  if (existing != null) {
    throw new Error(`workflowProfile metadata.name already exists for this project: ${profile.metadata.name}`)
  }
  const created = input.configResources.create({
    id: createId<'ConfigResourceId'>(),
    kind: 'WorkflowProfile',
    projectId: input.projectId,
    name: profile.metadata.name,
    spec: {
      path: normalizedPath,
      ...(profile.metadata.description == null ? {} : { description: profile.metadata.description }),
    },
  })
  return { workflowProfile: normalizedPath, workflowProfileRef: created.id }
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  )
}

function looksLikeWorkflowPath(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\') || value.endsWith('.yaml') || value.endsWith('.yml')
}

function repoRootsForNames(repoNames: string[], repoPathMap: Record<string, string>): string[] {
  return [
    ...new Set(
      repoNames
        .map((repoName) => repoPathMap[repoName])
        .filter((repoRoot): repoRoot is string => typeof repoRoot === 'string' && repoRoot !== ''),
    ),
  ].map((repoRoot) => resolve(repoRoot))
}
