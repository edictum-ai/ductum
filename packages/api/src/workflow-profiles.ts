import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { loadRenderedWorkflow, loadWorkflowProfile, type RepoWorkflowProfile } from '@ductum/core'

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
  const repoRoots = [
    ...new Set(
      repoNames
        .map((repoName) => repoPathMap[repoName])
        .filter((repoRoot): repoRoot is string => typeof repoRoot === 'string' && repoRoot !== ''),
    ),
  ].map((repoRoot) => resolve(repoRoot))

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

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  )
}
