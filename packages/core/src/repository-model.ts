import type {
  Component,
  Repository,
  RepositoryGitReadiness,
  RepositoryIdentity,
  RepositorySpec,
  Target,
} from './resource-types.js'

export function repositoryIdentity(name: string, spec: RepositorySpec): RepositoryIdentity {
  const remoteUrl = clean(spec.remoteUrl)
  if (remoteUrl != null) return { kind: 'remote', value: remoteUrl, portable: true }
  const localPath = clean(spec.localPath)
  if (localPath != null) return { kind: 'local', value: localPath, portable: false }
  return { kind: 'local', value: name, portable: false }
}

export function repositoryReadiness(spec: RepositorySpec): RepositoryGitReadiness {
  const remoteUrl = clean(spec.remoteUrl)
  const localPath = clean(spec.localPath)
  const github = remoteUrl == null ? null : parseGithubRemote(remoteUrl)
  return {
    portable: remoteUrl != null,
    supportsLocalWorkflow: localPath != null,
    supportsRemoteWorkflow: github != null,
    local: localPath == null
      ? { state: 'missing' }
      : { state: 'configured', path: localPath },
    git: remoteUrl == null
      ? { state: 'missing' }
      : { state: 'configured', remoteUrl, defaultBranch: clean(spec.defaultBranch) },
    github: github == null
      ? {
          state: remoteUrl == null ? 'missing' : 'not_applicable',
          reason: remoteUrl == null ? 'no remote repository configured' : 'remote is not a GitHub repository',
        }
      : { state: 'configured', owner: github.owner, repo: github.repo },
  }
}

export function materializeRepository(input: Omit<Repository, 'identity' | 'portable' | 'readiness'>): Repository {
  const identity = repositoryIdentity(input.name, input.spec)
  return {
    ...input,
    identity,
    portable: identity.portable,
    readiness: repositoryReadiness(input.spec),
  }
}

export function repositorySpecFromTarget(target: Target): RepositorySpec {
  const source = target.spec.source
  return {
    ...(source.repo == null ? {} : { remoteUrl: source.repo }),
    ...(source.localPath == null ? {} : { localPath: source.localPath }),
    ...(target.spec.branch?.base == null ? {} : { defaultBranch: target.spec.branch.base }),
    ...(target.spec.branch?.prefix == null ? {} : { branchPrefix: target.spec.branch.prefix }),
    ...(target.spec.authRef == null ? {} : { authRef: target.spec.authRef }),
    targetRef: target.id,
  }
}

export function repositoryFromTarget(target: Target): Repository {
  return materializeRepository({
    id: target.id as unknown as Repository['id'],
    projectId: target.projectId,
    name: target.name,
    spec: repositorySpecFromTarget(target),
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  })
}

export function componentFromTarget(target: Target): Component | null {
  const source = target.spec.source
  const path = clean(source.subdirectory) ?? clean(source.package)
  if (path == null) return null
  return {
    id: `${target.id}:component` as Component['id'],
    repositoryId: target.id as unknown as Component['repositoryId'],
    name: path,
    spec: { path, targetRef: target.id },
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  }
}

function parseGithubRemote(value: string): { owner: string; repo: string } | null {
  const normalized = value.trim().replace(/\.git$/i, '')
  const match = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
    ?? normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i)
    ?? normalized.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (match == null) return null
  return { owner: match[1]!, repo: match[2]! }
}

function clean(value: string | undefined): string | undefined {
  if (value == null) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
