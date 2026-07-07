import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  withTrustedEvidenceProducer,
  type Evidence,
  type Repository,
  type Run,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { resolveGitHubReadAuth } from './github-auth.js'
import { requestGitHubJson } from './github-request.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl, type GitHubRepoRef } from './github-ref.js'
import { addEvidence } from './run-ops/evidence.js'
import { hasPrReference, resolveGitHubPullNumber } from './run-ops/merge-utils.js'
import {
  classifyApprovalRequiredChecks,
  resolveRequiredChecksForEvaluation,
  resolveApprovalRequiredCheckPolicy,
  type ApprovalRequiredCheckDecision,
} from './run-ops/approval-required-checks.js'
import { fetchCurrentPrHeadCiChecks } from './run-ops/pr-ci.js'

const MAX_REVIEW_THREAD_PAGES = 20

export async function evaluateAdoptionCiGate(
  context: ApiContext,
  run: Pick<Run, 'id' | 'taskId' | 'prNumber' | 'prUrl' | 'commitSha'>,
  headSha: string,
  baseBranch: string,
): Promise<ApprovalRequiredCheckDecision> {
  const policy = resolveApprovalRequiredCheckPolicy(context.merge.approvalCiGate)
  const fetchedAt = context.now().toISOString()
  if (!policy.enabled) {
    return classifyApprovalRequiredChecks([], policy, { names: [], source: 'none' }, fetchedAt)
  }
  const resolved = await resolveRequiredChecksForEvaluation({ context, run, policy, baseBranch })
  const checks = await fetchCurrentPrHeadCiChecks(context, run, headSha)
  if (checks == null) {
    throw new ValidationError(`Cannot adopt PR head ${headSha}: could not read CI checks`)
  }
  return classifyApprovalRequiredChecks(checks, policy, resolved, fetchedAt)
}

export interface ReviewThreadGate {
  ok: boolean
  reasons: string[]
  reviewDecision: string | null
}

export async function fetchReviewThreadGate(repo: GitHubRepoRef, token: string, pullNumber: number): Promise<ReviewThreadGate> {
  let cursor: string | null = null
  let decision: string | null = null
  const threads: Array<{ isResolved?: boolean | null; path?: string | null; line?: number | null }> = []

  for (let page = 0; page < MAX_REVIEW_THREAD_PAGES; page += 1) {
    const payload: ReviewGraphqlResponse = await requestGitHubJson(repo, toGitHubGraphqlUrl(repo), {
      method: 'POST',
      token,
      body: {
        query: REVIEW_THREAD_QUERY,
        variables: { owner: repo.owner, repo: repo.repo, number: pullNumber, after: cursor },
      },
    })
    if (payload.errors != null && payload.errors.length > 0) {
      throw new ValidationError(`GitHub review-thread query failed: ${payload.errors.map((item) => item.message).join('; ')}`)
    }
    const pull = payload.data?.repository?.pullRequest
    if (pull == null) throw new ValidationError(`GitHub PR #${pullNumber} was not found while checking review threads`)
    decision = pull.reviewDecision ?? null
    threads.push(...(pull.reviewThreads?.nodes ?? []).filter((thread): thread is NonNullable<typeof thread> => thread != null))
    if (pull.reviewThreads?.pageInfo?.hasNextPage !== true) {
      return classifyReviewThreadGate(decision, threads)
    }
    cursor = pull.reviewThreads.pageInfo.endCursor ?? null
    if (cursor == null || cursor.trim() === '') throw new ValidationError(`GitHub review-thread query for PR #${pullNumber} did not return a next cursor`)
  }
  return {
    ok: false,
    reasons: [`review thread pagination exceeded ${MAX_REVIEW_THREAD_PAGES} pages`],
    reviewDecision: decision,
  }
}

export async function ensureFreshOperatorPrAdoptionReviewEvidence(
  context: ApiContext,
  run: Run,
  currentPrHeadSha: string,
): Promise<ReviewThreadGate> {
  const existing = context.repos.evidence.list(run.id)
  if (!hasOperatorPrAdoptionEvidence(existing)) return { ok: true, reasons: [], reviewDecision: null }
  const repository = resolveTaskRepository(context, run)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository == null || repoRef == null || !hasPrReference(run)) {
    return {
      ok: false,
      reasons: ['operator-adopted PR review refresh could not resolve the GitHub repository and PR reference'],
      reviewDecision: null,
    }
  }
  const auth = await resolveGitHubReadAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    secretAccessLog: context.repos.secretAccessLog,
    secretAccessContext: { runId: run.id },
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  const gate = await fetchReviewThreadGate(repoRef, auth.token, resolveGitHubPullNumber(run, repoRef))
  if (!gate.ok) {
    context.repos.runs.updateLatchStatus(run.id, 'reviewStatus', 'fail')
    return gate
  }
  addEvidence(context, run.id, 'review', withTrustedEvidenceProducer({
    passed: true,
    review: {
      reviewer: 'github-pr-adoption-approval-gate',
      status: 'approved',
      findings: [],
    },
    reviewDecision: gate.reviewDecision,
    commitSha: currentPrHeadSha,
    resolvedAt: context.now().toISOString(),
    source: 'github_pr_adoption_approval_gate',
  }, DUCTUM_APPROVAL_EVIDENCE_PRODUCER))
  context.repos.runUpdates.create(run.id, `approval recorded current PR review evidence for ${currentPrHeadSha}`)
  context.repos.runs.updateLatchStatus(run.id, 'reviewStatus', 'pass')
  return gate
}

function classifyReviewThreadGate(
  decision: string | null,
  threads: Array<{ isResolved?: boolean | null; path?: string | null; line?: number | null }>,
): ReviewThreadGate {
  const reasons: string[] = []
  if (decision !== 'APPROVED') reasons.push(`review decision is ${decision ?? 'missing'}, expected APPROVED`)
  for (const thread of threads) {
    if (thread.isResolved === true) continue
    const location = `${thread.path ?? 'unknown-file'}${typeof thread.line === 'number' ? `:${thread.line}` : ''}`
    reasons.push(`${location} has an unresolved review thread`)
  }
  return { ok: reasons.length === 0, reasons, reviewDecision: decision }
}

function hasOperatorPrAdoptionEvidence(evidence: Evidence[]): boolean {
  return evidence.some((item) => item.payload.kind === 'operator-pr-adoption')
}

function resolveTaskRepository(context: ApiContext, run: Pick<Run, 'taskId'>): Repository | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return null
  return context.repos.repositories.get(task.repositoryId as never)
}

const REVIEW_THREAD_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewDecision
      reviewThreads(first: 100, after: $after) {
        nodes {
          isResolved
          path
          line
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`.trim()

interface ReviewGraphqlResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewDecision?: string | null
        reviewThreads?: {
          nodes?: Array<{ isResolved?: boolean | null; path?: string | null; line?: number | null } | null> | null
          pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null
        } | null
      } | null
    } | null
  } | null
  errors?: Array<{ message: string }>
}

function toGitHubGraphqlUrl(repo: GitHubRepoRef): string {
  return repo.host.toLowerCase() === 'github.com'
    ? 'https://api.github.com/graphql'
    : `https://${repo.host}/api/graphql`
}
