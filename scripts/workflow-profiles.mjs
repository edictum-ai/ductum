import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

function isWithin(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function resolveWorkflowProfilePath(projectName, def) {
  const workflow = typeof def.workflow === 'object' && def.workflow !== null ? def.workflow : null
  if (typeof workflow?.profile !== 'string') return null

  const repoPaths = (def.repos || [])
    .filter((repo) => typeof repo === 'object' && repo.path)
    .map((repo) => resolve(repo.path))
  if (repoPaths.length === 0) {
    throw new Error(`Project ${projectName} declares workflow.profile but has no repo.path to resolve it`)
  }
  if (isAbsolute(workflow.profile)) {
    const profilePath = resolve(workflow.profile)
    if (!existsSync(profilePath)) throw new Error(`workflow.profile not found for ${projectName}: ${profilePath}`)
    if (!repoPaths.some((repoPath) => isWithin(repoPath, profilePath))) {
      throw new Error(`workflow.profile for ${projectName} must be inside a configured repo path: ${profilePath}`)
    }
    return profilePath
  }

  const matches = repoPaths
    .map((repoPath) => resolve(repoPath, workflow.profile))
    .filter((candidate) => existsSync(candidate))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`workflow.profile not found in project repos for ${projectName}: ${workflow.profile}`)
  throw new Error(`workflow.profile is ambiguous across project repos for ${projectName}: ${workflow.profile}`)
}
