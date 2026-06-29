import { ValidationError } from './errors.js'
import type { GitHubIssueRef, GitHubRepoRef } from './github-ref.js'
import { toGitHubApiBaseUrl, toGitHubRepoApiPath } from './github-ref.js'

export interface GitHubIssuePayload {
  number: number
  html_url: string
  title: string
  body: string | null
  labels: Array<string | { name?: string | null }>
  pull_request?: unknown
}

export interface GitHubIssueRecord extends Omit<GitHubIssuePayload, 'body'> {
  body: string
}

export interface GitHubIssueCommentRecord {
  id: number
  html_url: string
  body: string
}

export interface GitHubIssueCommentCreateRecord extends GitHubIssueCommentRecord {
  user?: { login?: string | null; type?: string | null } | null
}

export interface GitHubPullRequestRecord {
  number: number
  html_url: string
  title: string
  head: { ref: string; sha?: string | null }
  base: { ref: string; sha?: string | null }
}

export interface GitHubPullRequestMergeRecord {
  sha?: string
  merged?: boolean
  message?: string
}

export interface GitHubCheckRunRecord {
  name?: string | null
  status?: string | null
  conclusion?: string | null
  /**
   * Monotonic check-run id assigned by GitHub. Re-runs produce a new id, so
   * the largest id for a given name is the live attempt. Used as the primary
   * sort key for rerun dedupe (Issue #195 review round 2).
   */
  id?: number | string | null
  /** ISO 8601 timestamp from the GitHub API. Fallback sort key for rerun dedupe. */
  started_at?: string | null
  /** ISO 8601 timestamp from the GitHub API. Secondary fallback sort key. */
  completed_at?: string | null
}

export interface GitHubCommitStatusRecord {
  context?: string | null
  state?: string | null
  created_at?: string | null
}

export async function fetchGitHubIssue(issue: GitHubIssueRef, token?: string): Promise<GitHubIssueRecord> {
  const payload = await requestGitHubJson<GitHubIssuePayload>(
    issue,
    `${toGitHubRepoApiPath(issue)}/issues/${issue.issueNumber}`,
    { token },
  )
  if (payload.pull_request != null) {
    throw new ValidationError(`GitHub issue intake only supports issues, not pull requests: ${issue.issueUrl}`)
  }
  return { ...payload, body: payload.body ?? '' }
}

export async function fetchGitHubIssueComments(issue: GitHubIssueRef, token?: string): Promise<GitHubIssueCommentRecord[]> {
  const comments = await requestGitHubJson<Array<{ id: number; html_url: string; body: string | null }>>(
    issue,
    `${toGitHubRepoApiPath(issue)}/issues/${issue.issueNumber}/comments`,
    { token },
  )
  return comments.map((comment) => ({ ...comment, body: comment.body ?? '' }))
}

export async function createGitHubIssueComment(input: {
  repo: GitHubRepoRef
  token: string
  issueNumber: number
  body: string
}): Promise<GitHubIssueCommentCreateRecord> {
  return await requestGitHubJson<GitHubIssueCommentCreateRecord>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/issues/${input.issueNumber}/comments`,
    {
      method: 'POST',
      token: input.token,
      body: { body: input.body },
    },
  )
}

export async function updateGitHubIssueComment(input: {
  repo: GitHubRepoRef
  token: string
  commentId: number
  body: string
}): Promise<GitHubIssueCommentCreateRecord> {
  return await requestGitHubJson<GitHubIssueCommentCreateRecord>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/issues/comments/${input.commentId}`,
    {
      method: 'PATCH',
      token: input.token,
      body: { body: input.body },
    },
  )
}

export async function upsertGitHubPullRequest(input: {
  repo: GitHubRepoRef
  token: string
  headBranch: string
  baseBranch: string
  title: string
  body: string
  existingPrNumber?: number | null
}): Promise<GitHubPullRequestRecord> {
  if (input.existingPrNumber != null) {
    return await requestGitHubJson<GitHubPullRequestRecord>(
      input.repo,
      `${toGitHubRepoApiPath(input.repo)}/pulls/${input.existingPrNumber}`,
      {
        method: 'PATCH',
        token: input.token,
        body: { title: input.title, body: input.body, base: input.baseBranch },
      },
    )
  }

  const existing = await requestGitHubJson<GitHubPullRequestRecord[]>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/pulls?state=open&head=${encodeURIComponent(`${input.repo.owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}`,
    { token: input.token },
  )
  const found = existing.find((candidate) => candidate.head.ref === input.headBranch)
  if (found != null) {
    return await requestGitHubJson<GitHubPullRequestRecord>(
      input.repo,
      `${toGitHubRepoApiPath(input.repo)}/pulls/${found.number}`,
      {
        method: 'PATCH',
        token: input.token,
        body: { title: input.title, body: input.body, base: input.baseBranch },
      },
    )
  }

  return await requestGitHubJson<GitHubPullRequestRecord>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/pulls`,
    {
      method: 'POST',
      token: input.token,
      body: { title: input.title, body: input.body, head: input.headBranch, base: input.baseBranch },
    },
  )
}

export async function fetchGitHubPullRequest(input: {
  repo: GitHubRepoRef
  token: string
  pullNumber: number
}): Promise<GitHubPullRequestRecord> {
  return await requestGitHubJson<GitHubPullRequestRecord>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/pulls/${input.pullNumber}`,
    { token: input.token },
  )
}

/**
 * Issue #195 review follow-up: GitHub's `/commits/:sha/check-runs` and
 * `/commits/:sha/statuses` endpoints cap at 100 items per page. The previous
 * implementation only fetched page one, so a repo with more than 100 check
 * contexts could silently hide a pending or failing required check on a later
 * page — and the fail-closed approval gate would then merge incorrectly.
 *
 * Issue #195 review round 2: the walker stops after a safety cap (50 pages ≈
 * 5000 contexts, far above any realistic repo). If GitHub still advertises a
 * `rel="next"` link at that point we THROW instead of returning the partial
 * set — the approval gate must fail closed when the live required-check state
 * cannot be fully observed, otherwise a required check beyond the cap would
 * be silently dropped and the merge would proceed on incomplete data.
 */
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

/**
 * Extract the `rel="next"` URL from a GitHub `Link` header. Returns null when
 * the header is absent or there is no next page. The header looks like:
 * `<https://api.github.com/.../check-runs?page=2>; rel="next", <...>; rel="last"`
 */
function parseGitHubNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/i)
    if (match?.[1]) return match[1]
  }
  return null
}

export async function mergeGitHubPullRequest(input: {
  repo: GitHubRepoRef
  token: string
  pullNumber: number
  mergeMethod: 'merge' | 'squash' | 'rebase'
  commitTitle: string
  commitMessage: string
  expectedHeadSha?: string
}): Promise<GitHubPullRequestMergeRecord> {
  return await requestGitHubJson<GitHubPullRequestMergeRecord>(
    input.repo,
    `${toGitHubRepoApiPath(input.repo)}/pulls/${input.pullNumber}/merge`,
    {
      method: 'PUT',
      token: input.token,
      body: {
        merge_method: input.mergeMethod,
        commit_title: input.commitTitle,
        commit_message: input.commitMessage,
        ...(input.expectedHeadSha == null ? {} : { sha: input.expectedHeadSha }),
      },
    },
  )
}

async function requestGitHubJson<T>(
  repo: GitHubRepoRef,
  path: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await requestGitHubResponse(repo, path, options)
  return await response.json() as T
}

/**
 * Underlying fetch wrapper shared by {@link requestGitHubJson} and the
 * pagination walkers in {@link fetchGitHubCommitCheckRuns} /
 * {@link fetchGitHubCommitStatuses}. Accepts either a repo-relative path
 * (the common case) or a full URL (used to follow GitHub `rel="next"` links,
 * which are absolute).
 */
async function requestGitHubResponse(
  repo: GitHubRepoRef,
  url: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<Response> {
  const isAbsoluteUrl = /^https?:\/\//i.test(url)
  const fullUrl = isAbsoluteUrl ? url : `${toGitHubApiBaseUrl(repo)}${url}`
  const response = await fetch(fullUrl, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.token == null ? {} : { Authorization: `Bearer ${options.token}` }),
      ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body == null ? {} : { body: JSON.stringify(options.body) }),
  })
  if (!response.ok) {
    throw new ValidationError(`GitHub request failed (${response.status}): ${await response.text()}`)
  }
  return response
}
