import { ValidationError } from './errors.js'

export interface GitHubRepoRef {
  host: string
  owner: string
  repo: string
}

export interface GitHubIssueRef extends GitHubRepoRef {
  issueNumber: number
  issueUrl: string
}

export interface GitHubPullRef extends GitHubRepoRef {
  pullNumber: number
  pullUrl: string
}

export function parseGitHubIssueRef(input: string, fallbackRepo?: GitHubRepoRef | null): GitHubIssueRef {
  const trimmed = input.trim()
  if (trimmed === '') throw new ValidationError('issueRef is required')

  const fullUrl = parseIssueUrl(trimmed)
  if (fullUrl != null) return fullUrl

  const repoScoped = trimmed.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/)
  if (repoScoped != null) {
    return buildIssueRef('github.com', repoScoped[1]!, repoScoped[2]!, Number(repoScoped[3]!))
  }

  const issueNumber = trimmed.replace(/^#/, '')
  if (/^\d+$/.test(issueNumber)) {
    if (fallbackRepo == null) {
      throw new ValidationError('issueRef must include owner/repo or the repository must be inferred from scope')
    }
    return buildIssueRef(fallbackRepo.host, fallbackRepo.owner, fallbackRepo.repo, Number(issueNumber))
  }

  throw new ValidationError(`Unsupported GitHub issue reference: ${input}`)
}

export function parseGitHubRepoRef(input: string): GitHubRepoRef | null {
  const trimmed = input.trim().replace(/\.git$/i, '')
  const urlMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/i)
  if (urlMatch != null) return { host: urlMatch[1]!, owner: urlMatch[2]!, repo: urlMatch[3]! }
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+)$/i)
  if (sshMatch != null) return { host: sshMatch[1]!, owner: sshMatch[2]!, repo: sshMatch[3]! }
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (shortMatch != null) return { host: 'github.com', owner: shortMatch[1]!, repo: shortMatch[2]! }
  return null
}

export function parseGitHubPullRef(input: string): GitHubPullRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 4 || parts[2]?.toLowerCase() !== 'pull' || !/^\d+$/.test(parts[3]!)) return null
  return buildPullRef(url.host, parts[0]!, parts[1]!, Number(parts[3]!))
}

export function toGitHubApiBaseUrl(repo: GitHubRepoRef): string {
  return repo.host.toLowerCase() === 'github.com'
    ? 'https://api.github.com'
    : `https://${repo.host}/api/v3`
}

export function toGitHubRepoApiPath(repo: GitHubRepoRef): string {
  return `/repos/${repo.owner}/${repo.repo}`
}

export function toHttpsRemoteUrl(repo: GitHubRepoRef): string {
  return `https://${repo.host}/${repo.owner}/${repo.repo}.git`
}

function parseIssueUrl(value: string): GitHubIssueRef | null {
  const urlMatch = value.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/i)
  if (urlMatch == null) return null
  return buildIssueRef(urlMatch[1]!, urlMatch[2]!, urlMatch[3]!, Number(urlMatch[4]!))
}

function buildIssueRef(host: string, owner: string, repo: string, issueNumber: number): GitHubIssueRef {
  return {
    host,
    owner,
    repo,
    issueNumber,
    issueUrl: `https://${host}/${owner}/${repo}/issues/${issueNumber}`,
  }
}

function buildPullRef(host: string, owner: string, repo: string, pullNumber: number): GitHubPullRef {
  return {
    host,
    owner,
    repo,
    pullNumber,
    pullUrl: `https://${host}/${owner}/${repo}/pull/${pullNumber}`,
  }
}
