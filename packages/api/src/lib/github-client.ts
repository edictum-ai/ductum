import { ValidationError } from './errors.js'
import type { GitHubIssueRef, GitHubRepoRef } from './github-ref.js'
import { toGitHubRepoApiPath } from './github-ref.js'
import { requestGitHubJson } from './github-request.js'

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
