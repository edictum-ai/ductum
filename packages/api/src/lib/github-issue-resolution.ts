import { createId, type Evidence, type Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'
import { resolveGitHubWriteAuth, type GitHubActorIdentity } from './github-auth.js'
import {
  closeGitHubIssue as closeGitHubIssueApi,
  createGitHubIssueComment,
  updateGitHubIssueComment,
} from './github-client.js'
import { buildGitHubIssueCloseoutComment } from './github-issue-resolution-format.js'
import {
  assertIssueMatchesRepository,
  assertMergeChecksObserved,
  findExistingResolutionComment,
  findLatestGitHubPrMergeEvidence,
  normalizeOptionalString,
  requireNonBlankNumber,
  requireNonBlankString,
  resolveRepositoryForCloseout,
} from './github-issue-resolution-resolve.js'
import { resolveGitHubIssueProject } from './github-intake.js'
import {
  parseGitHubIssueRef,
  parseGitHubRepoRef,
  toGitHubApiBaseUrl,
} from './github-ref.js'

/**
 * P1 #243: operator-driven explicit issue closeout. Closes a GitHub issue
 * through configured GitHub App auth after pointing Ductum at a `done` run
 * that has PR-backed merge evidence. The run does NOT need to be issue-sourced:
 * the operator-supplied issueRef is authoritative for non-issue-sourced work.
 *
 * Operator identity (operatorAction) is preserved separately from the GitHub
 * App actor that writes to GitHub — they are never conflated.
 */
export interface GitHubIssueCloseoutInput {
  projectName?: string
  projectId?: string
  repository?: string
  issueRef: string
  runId: string
  operatorAction?: string
}

export interface GitHubIssueCloseoutResult {
  recordType: 'GitHubIssueCloseout'
  run: Run
  issue: { number: number; url: string; repository: string }
  comment: { url: string; id: number }
  pr: { number: number; url: string }
  merge: {
    commitSha: string
    baseBranch: string | null
    requiredChecksSource: string | null
  }
  actor: GitHubActorIdentity
  operatorAction: string | null
  evidence: Evidence
}

export async function closeGitHubIssue(
  context: ApiContext,
  input: GitHubIssueCloseoutInput,
): Promise<GitHubIssueCloseoutResult> {
  const project = resolveGitHubIssueProject(context, input)
  const repository = resolveRepositoryForCloseout(context, project, input.repository)
  const repoRef = parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repoRef == null) {
    throw new ValidationError(`Repository ${repository.name} has no GitHub remote URL`)
  }
  const issueRef = parseGitHubIssueRef(input.issueRef, repoRef)
  assertIssueMatchesRepository(issueRef.owner, issueRef.repo, repository.name, repoRef)

  const run = context.repos.runs.get(input.runId as never)
  if (run == null) throw new NotFoundError(`Run not found: ${input.runId}`)
  if (run.stage !== 'done') {
    throw new ValidationError(
      `Run ${run.id} is stage "${run.stage}"; issue closeout requires stage "done"`,
    )
  }
  const prNumber = requireNonBlankNumber(run.prNumber, 'run.prNumber')
  const prUrl = requireNonBlankString(run.prUrl, 'run.prUrl')
  const headSha = requireNonBlankString(run.commitSha, 'run.commitSha')

  const evidence = context.repos.evidence.list(run.id)
  const mergeEvidence = findLatestGitHubPrMergeEvidence(evidence)
  if (mergeEvidence == null) {
    throw new ValidationError(
      `Run ${run.id} has no GitHub PR merge evidence; cannot prove closeout`,
    )
  }
  if (mergeEvidence.merge.payload.merged !== true) {
    throw new ValidationError(`Run ${run.id} merge evidence does not confirm a successful merge`)
  }
  assertMergeChecksObserved(run.id, mergeEvidence.merge, evidence)

  const auth = await resolveGitHubWriteAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    secretAccessLog: context.repos.secretAccessLog,
    secretAccessContext: { runId: run.id },
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })

  const issueRepo = { host: repoRef.host, owner: issueRef.owner, repo: issueRef.repo }
  const operatorAction = normalizeOptionalString(input.operatorAction)
  const commentBody = buildGitHubIssueCloseoutComment({
    runId: run.id,
    prNumber,
    prUrl,
    headSha,
    mergeCommitSha: mergeEvidence.merge.mergeCommitSha,
    requiredChecksSource: mergeEvidence.merge.requiredChecksSource,
    operatorAction,
    actor: auth.actor,
  })

  const existing = findExistingResolutionComment(evidence, issueRef.issueNumber)
  const comment = existing?.commentId == null
    ? await createGitHubIssueComment({
      repo: issueRepo,
      token: auth.token,
      issueNumber: issueRef.issueNumber,
      body: commentBody,
    })
    : await updateGitHubIssueComment({
      repo: issueRepo,
      token: auth.token,
      commentId: existing.commentId,
      body: commentBody,
    })

  await closeGitHubIssueApi({
    repo: issueRepo,
    token: auth.token,
    issueNumber: issueRef.issueNumber,
  })

  const evidenceRecord = recordResolutionEvidence(context, {
    run,
    issueRef,
    comment,
    prNumber,
    prUrl,
    headSha,
    merge: mergeEvidence.merge,
    operatorAction,
    actor: auth.actor,
  })

  return {
    recordType: 'GitHubIssueCloseout',
    run,
    issue: {
      number: issueRef.issueNumber,
      url: issueRef.issueUrl,
      repository: `${issueRef.owner}/${issueRef.repo}`,
    },
    comment: { url: comment.html_url, id: comment.id },
    pr: { number: prNumber, url: prUrl },
    merge: {
      commitSha: mergeEvidence.merge.mergeCommitSha,
      baseBranch: mergeEvidence.merge.baseBranch,
      requiredChecksSource: mergeEvidence.merge.requiredChecksSource,
    },
    actor: auth.actor,
    operatorAction,
    evidence: evidenceRecord,
  }
}

function recordResolutionEvidence(
  context: ApiContext,
  input: {
    run: Run
    issueRef: { owner: string; repo: string; issueNumber: number; issueUrl: string }
    comment: { html_url: string; id: number }
    prNumber: number
    prUrl: string
    headSha: string
    merge: { mergeCommitSha: string; baseBranch: string | null; requiredChecksSource: string | null }
    operatorAction: string | null
    actor: GitHubActorIdentity
  },
): Evidence {
  return context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: input.run.id,
    type: 'custom',
    payload: {
      kind: 'github-issue-resolution',
      repo: `${input.issueRef.owner}/${input.issueRef.repo}`,
      issueNumber: input.issueRef.issueNumber,
      issueUrl: input.issueRef.issueUrl,
      commentUrl: input.comment.html_url,
      commentId: input.comment.id,
      prNumber: input.prNumber,
      prUrl: input.prUrl,
      runId: input.run.id,
      headSha: input.headSha,
      mergeCommitSha: input.merge.mergeCommitSha,
      ...(input.merge.requiredChecksSource == null
        ? {}
        : { requiredChecksSource: input.merge.requiredChecksSource }),
      ...(input.merge.baseBranch == null ? {} : { baseBranch: input.merge.baseBranch }),
      ...(input.operatorAction == null ? {} : { operatorAction: input.operatorAction }),
      actorType: input.actor.type,
      actorLabel: input.actor.label,
    },
  })
}
