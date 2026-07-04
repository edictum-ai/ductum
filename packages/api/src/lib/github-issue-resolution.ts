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
  type ResolvedMergeEvidence,
  type ResolvedMergeObservedCheck,
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
    requiredChecks: string[]
    observedChecks: ResolvedMergeObservedCheck[]
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
  // P1 #243 review round 2: cross-check the merge evidence against the
  // referenced run + repository and validate observed required checks
  // BEFORE any GitHub write. Stale PR-evidence or non-success checks fail
  // closed here.
  assertMergeChecksObserved(run.id, mergeEvidence.merge, {
    repository,
    repoRef,
    run: { prNumber: run.prNumber, prUrl: run.prUrl },
  })
  // P1 #243 review round 2: headSha is authoritative from the merge
  // evidence — run.commitSha is the merge commit after the merge driver
  // records github-pr-merge evidence, not the PR head.
  const headSha = mergeEvidence.merge.headSha

  // P1 #243 review round 2: issue closeout must NEVER fall back to dev
  // PAT or gh-cli. The standard resolveGitHubWriteAuth helper permits
  // DUCTUM_GITHUB_DEV_WRITE_MODE=pat or gh-cli fallback; for closeout we
  // enforce App-only auth: pre-check authRef is present, then assert the
  // resolved actor is github_app so a dev env cannot close issues with
  // non-App credentials.
  const authRef = repository.spec.authRef?.trim()
  if (authRef == null || authRef === '') {
    throw new ValidationError(
      `Repository ${repository.name} is missing GitHub App installation auth; production write paths fail closed`,
    )
  }
  const auth = await resolveGitHubWriteAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    secretAccessLog: context.repos.secretAccessLog,
    secretAccessContext: { runId: run.id },
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  if (auth.actor.type !== 'github_app') {
    // Defense in depth: if the resolver ever changes shape we still refuse
    // to close issues with non-App credentials.
    throw new ValidationError(
      `Issue closeout requires GitHub App auth; resolved actor was ${auth.actor.type} (${auth.actor.label})`,
    )
  }

  const issueRepo = { host: repoRef.host, owner: issueRef.owner, repo: issueRef.repo }
  const operatorAction = normalizeOptionalString(input.operatorAction)
  const commentBody = buildGitHubIssueCloseoutComment({
    runId: run.id,
    prNumber,
    prUrl,
    headSha,
    mergeCommitSha: mergeEvidence.merge.mergeCommitSha,
    requiredChecksSource: mergeEvidence.merge.requiredChecksSource,
    requiredChecks: mergeEvidence.merge.requiredChecks,
    observedChecks: mergeEvidence.merge.observedChecks,
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

  // P1 #243 review: record the comment-id evidence BEFORE the issue-close call.
  // If close fails, this record lets a retry PATCH the same comment instead of
  // creating a duplicate. The full github-issue-resolution evidence is still
  // recorded only after a successful close below.
  recordCloseoutCommentEvidence(context, {
    run,
    issueRef,
    comment,
    actor: auth.actor,
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
      requiredChecks: mergeEvidence.merge.requiredChecks,
      observedChecks: mergeEvidence.merge.observedChecks,
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
    merge: ResolvedMergeEvidence
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
      requiredChecks: input.merge.requiredChecks,
      observedChecks: input.merge.observedChecks,
      ...(input.merge.baseBranch == null ? {} : { baseBranch: input.merge.baseBranch }),
      ...(input.operatorAction == null ? {} : { operatorAction: input.operatorAction }),
      actorType: input.actor.type,
      actorLabel: input.actor.label,
    },
  })
}

/**
 * P1 #243 review: a narrow pre-close evidence record used only for comment-id
 * dedup. Recorded immediately after comment create/update so a retry that
 * follows a close failure PATCHes the same comment instead of duplicating it.
 * The full github-issue-resolution evidence (with merge/operator/head detail)
 * is still recorded only after a successful close.
 */
function recordCloseoutCommentEvidence(
  context: ApiContext,
  input: {
    run: Run
    issueRef: { owner: string; repo: string; issueNumber: number; issueUrl: string }
    comment: { html_url: string; id: number }
    actor: GitHubActorIdentity
  },
): Evidence {
  return context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: input.run.id,
    type: 'custom',
    payload: {
      kind: 'github-issue-resolution-comment',
      repo: `${input.issueRef.owner}/${input.issueRef.repo}`,
      issueNumber: input.issueRef.issueNumber,
      issueUrl: input.issueRef.issueUrl,
      commentUrl: input.comment.html_url,
      commentId: input.comment.id,
      runId: input.run.id,
      actorType: input.actor.type,
      actorLabel: input.actor.label,
    },
  })
}
