import { ValidationError } from './errors.js'
import type { GitHubRepoRef } from './github-ref.js'
import { toGitHubApiBaseUrl, toGitHubRepoApiPath } from './github-ref.js'
import { requestGitHubResponse } from './github-request.js'

export interface GitHubCheckRunRecord {
  name?: string | null
  status?: string | null
  conclusion?: string | null
  id?: number | string | null
  started_at?: string | null
  completed_at?: string | null
}

export interface GitHubCommitStatusRecord {
  context?: string | null
  state?: string | null
  created_at?: string | null
}

const GITHUB_LIST_PAGINATION_MAX_PAGES = 50

export class GitHubPaginationTruncatedError extends Error {
  constructor(
    public readonly endpoint: 'check-runs' | 'statuses',
    public readonly pagesFetched: number,
    public readonly nextUrl: string,
  ) {
    super(
      `GitHub ${endpoint} pagination truncated after ${pagesFetched} pages with rel="next" still present (${nextUrl}); required checks beyond the cap cannot be observed`,
    )
    this.name = 'GitHubPaginationTruncatedError'
  }
}

export async function fetchGitHubCommitCheckRuns(input: {
  repo: GitHubRepoRef
  token: string
  ref: string
}): Promise<GitHubCheckRunRecord[]> {
  const records: GitHubCheckRunRecord[] = []
  let nextUrl: string | null =
    `${toGitHubRepoApiPath(input.repo)}/commits/${encodeURIComponent(input.ref)}/check-runs?per_page=100`
  let pagesFetched = 0
  for (let page = 0; page < GITHUB_LIST_PAGINATION_MAX_PAGES && nextUrl != null; page++) {
    const response = await requestGitHubResponse(input.repo, nextUrl, { token: input.token })
    const payload = await response.json() as { check_runs?: GitHubCheckRunRecord[] }
    if (Array.isArray(payload.check_runs)) records.push(...payload.check_runs)
    nextUrl = parseGitHubNextLink(response.headers.get('link'))
    pagesFetched = page + 1
  }
  if (nextUrl != null) {
    throw new GitHubPaginationTruncatedError('check-runs', pagesFetched, nextUrl)
  }
  return records
}

export async function fetchGitHubCommitStatuses(input: {
  repo: GitHubRepoRef
  token: string
  ref: string
}): Promise<GitHubCommitStatusRecord[]> {
  const records: GitHubCommitStatusRecord[] = []
  let nextUrl: string | null =
    `${toGitHubRepoApiPath(input.repo)}/commits/${encodeURIComponent(input.ref)}/statuses?per_page=100`
  let pagesFetched = 0
  for (let page = 0; page < GITHUB_LIST_PAGINATION_MAX_PAGES && nextUrl != null; page++) {
    const response = await requestGitHubResponse(input.repo, nextUrl, { token: input.token })
    const payload = await response.json() as GitHubCommitStatusRecord[]
    if (Array.isArray(payload)) records.push(...payload)
    nextUrl = parseGitHubNextLink(response.headers.get('link'))
    pagesFetched = page + 1
  }
  if (nextUrl != null) {
    throw new GitHubPaginationTruncatedError('statuses', pagesFetched, nextUrl)
  }
  return records
}

export async function fetchGitHubBranchRequiredStatusChecks(input: {
  repo: GitHubRepoRef
  token: string
  branch: string
}): Promise<string[] | null> {
  const path =
    `${toGitHubRepoApiPath(input.repo)}/branches/${encodeURIComponent(input.branch)}/protection/required_status_checks`
  const response = await fetch(`${toGitHubApiBaseUrl(input.repo)}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${input.token}`,
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new ValidationError(
      `GitHub request failed (${response.status}) fetching required status checks for ${input.branch}: ${await response.text()}`,
    )
  }
  const payload = await response.json() as { contexts?: unknown }
  if (!Array.isArray(payload.contexts)) return null
  return payload.contexts
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim())
}

function parseGitHubNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i)
    if (match?.[1]) return match[1]
  }
  return null
}
