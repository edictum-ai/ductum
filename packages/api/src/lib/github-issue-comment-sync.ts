import {
  assertPublicGitMetadataSafe,
  createId,
  type Evidence,
  type GitHubIssueSource,
  type Repository,
  type Run,
  type Spec,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { resolveGitHubWriteAuth } from './github-auth.js'
import { createGitHubIssueComment, updateGitHubIssueComment } from './github-client.js'
import { buildConventionalPrTitle, buildGitHubIssueCompletionComment, resolveGitHubIssueSource } from './github-lifecycle-format.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from './github-ref.js'

export interface GitHubIssueCommentContext {
  repos: Pick<ApiContext['repos'], 'runs' | 'tasks' | 'specs' | 'repositories' | 'secrets' | 'evidence'>
    & Partial<Pick<ApiContext['repos'], 'secretAccessLog'>>
  factoryDataDir?: string
  now: () => Date
}

export interface GitHubIssueCommentSyncResult {
  skipped: boolean
  reason?: string
  commentUrl?: string
}

export async function syncGitHubIssueCommentForRun(
  context: GitHubIssueCommentContext,
  runId: Run['id'],
): Promise<GitHubIssueCommentSyncResult> {
  const run = context.repos.runs.get(runId)
  if (run == null) return { skipped: true, reason: 'run not found' }
  const task = context.repos.tasks.get(run.taskId)
  if (task == null) return { skipped: true, reason: 'task not found' }
  const spec = context.repos.specs.get(task.specId as never)
  if (spec == null) return { skipped: true, reason: 'spec not found' }
  const source = resolveGitHubIssueSource(spec, task)
  if (source == null) return { skipped: true, reason: 'run has no GitHub issue source' }
  const repository = resolveRepository(context, task.repositoryId)
  if (repository == null) return { skipped: true, reason: 'task has no repository scope' }
  const repoRef = parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repoRef == null) return { skipped: true, reason: 'repository has no GitHub remote' }

  const branch = requiredString(run.branch)
  const commitSha = requiredString(run.commitSha)
  const prUrl = requiredString(run.prUrl)
  const prNumber = run.prNumber
  if (branch == null || commitSha == null || prUrl == null || prNumber == null) {
    return { skipped: true, reason: 'run has no linked PR metadata' }
  }

  const auth = await resolveGitHubWriteAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    secretAccessLog: context.repos.secretAccessLog,
    secretAccessContext: { runId: run.id },
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  const commentUrl = await syncGitHubIssueComment({
    context,
    run,
    spec,
    task,
    source,
    repoRef,
    token: auth.token,
    branch,
    commitSha,
    prNumber,
    prUrl,
    evidence: context.repos.evidence.list(run.id),
    actorType: auth.actor.type,
    actorLabel: auth.actor.label,
  })
  return { skipped: false, commentUrl }
}

export async function syncGitHubIssueComment(input: {
  context: GitHubIssueCommentContext
  run: Run
  spec: Spec
  task: Task
  source: GitHubIssueSource | null
  repoRef: NonNullable<ReturnType<typeof parseGitHubRepoRef>>
  token: string
  branch: string
  commitSha: string
  prNumber: number
  prUrl: string
  evidence: Evidence[]
  actorType: string
  actorLabel: string
}): Promise<string | undefined> {
  if (input.source == null) return undefined
  const body = buildGitHubIssueCompletionComment({
    spec: input.spec,
    task: input.task,
    run: input.run,
    branch: input.branch,
    commitSha: input.commitSha,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    evidence: input.evidence,
  })
  if (body == null) return undefined
  assertPublicGitMetadataSafe(buildConventionalPrTitle(input.spec, input.task), body)
  const issueRepo = {
    host: input.repoRef.host,
    owner: input.source.repoOwner,
    repo: input.source.repoName,
  }
  const existingComment = findIssueCommentEvidence(input.context.repos.evidence.list(input.run.id), input.source.issueNumber)
  const comment = existingComment?.commentId == null
    ? await createGitHubIssueComment({
      repo: issueRepo,
      token: input.token,
      issueNumber: input.source.issueNumber,
      body,
    })
    : await updateGitHubIssueComment({
      repo: issueRepo,
      token: input.token,
      commentId: existingComment.commentId,
      body,
    })
  input.context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: input.run.id,
    type: 'custom',
    payload: {
      kind: 'github-issue-comment-sync',
      repo: `${input.source.repoOwner}/${input.source.repoName}`,
      issueNumber: input.source.issueNumber,
      issueUrl: input.source.issueUrl,
      commentUrl: comment.html_url,
      prNumber: input.prNumber,
      prUrl: input.prUrl,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
    },
  })
  return comment.html_url
}

function resolveRepository(context: GitHubIssueCommentContext, repositoryId: string | null | undefined): Repository | null {
  if (repositoryId == null) return null
  return context.repos.repositories.get(repositoryId as never)
}

function requiredString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? null : trimmed
}

function findIssueCommentEvidence(evidence: Evidence[], issueNumber: number): { commentId: number | null } | null {
  const match = [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && entry.payload.kind === 'github-issue-comment-sync'
    && entry.payload.issueNumber === issueNumber,
  )
  if (match == null) return null
  const commentUrl = typeof match.payload.commentUrl === 'string' ? match.payload.commentUrl : ''
  const commentId = /issuecomment-(\d+)/.exec(commentUrl)?.[1]
  return { commentId: commentId == null ? null : Number(commentId) }
}
