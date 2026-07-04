import type { Evidence, Project, Repository } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'

/**
 * P1 #243: pure resolution + lookup helpers used by the issue closeout
 * orchestrator. Split out so the orchestrator stays under the 300 LOC file
 * cap and the validation rules are testable in isolation.
 */
export interface ResolvedMergeEvidence {
  mergeCommitSha: string
  baseBranch: string | null
  requiredChecksSource: string | null
  payload: Record<string, unknown>
}

export function resolveRepositoryForCloseout(
  context: Pick<ApiContext, 'repos'>,
  project: Project,
  repositoryName: string | undefined,
): Repository {
  const repositories = context.repos.repositories.list(project.id as never)
  if (repositoryName == null) {
    if (repositories.length !== 1) {
      throw new ValidationError(
        `Project ${project.name} has ${repositories.length} repositories; pass --repository <name>`,
      )
    }
    return repositories[0]!
  }
  const matched = repositories.find((candidate) => candidate.name === repositoryName)
  if (matched == null) {
    throw new NotFoundError(`Repository not found in project ${project.name}: ${repositoryName}`)
  }
  return matched
}

export function assertIssueMatchesRepository(
  issueOwner: string,
  issueRepo: string,
  repositoryName: string,
  repoRef: { owner: string; repo: string },
): void {
  if (issueOwner.toLowerCase() !== repoRef.owner.toLowerCase()
    || issueRepo.toLowerCase() !== repoRef.repo.toLowerCase()) {
    throw new ValidationError(
      `Issue ${issueOwner}/${issueRepo} does not match repository ${repositoryName} (${repoRef.owner}/${repoRef.repo})`,
    )
  }
}

export function assertMergeChecksObserved(
  runId: string,
  merge: ResolvedMergeEvidence,
  evidence: Evidence[],
): void {
  if (merge.requiredChecksSource === 'policy' || merge.requiredChecksSource === 'branch_protection') {
    return
  }
  if (Array.isArray(merge.payload.observedChecks) && merge.payload.observedChecks.length > 0) {
    return
  }
  if (evidence.some((entry) => entry.type === 'ci')) {
    return
  }
  throw new ValidationError(
    `Run ${runId} merge evidence lacks required-check status source and no CI evidence is recorded`,
  )
}

export function findLatestGitHubPrMergeEvidence(
  evidence: Evidence[],
): { evidence: Evidence; merge: ResolvedMergeEvidence } | null {
  for (const entry of [...evidence].reverse()) {
    if (entry.type !== 'custom') continue
    if (entry.payload.kind !== 'github-pr-merge') continue
    const payload = entry.payload as Record<string, unknown>
    const mergeCommitSha = typeof payload.mergeCommitSha === 'string' && payload.mergeCommitSha.trim() !== ''
      ? payload.mergeCommitSha.trim()
      : null
    if (mergeCommitSha == null) continue
    const requiredChecksSource = typeof payload.requiredChecksSource === 'string'
      ? payload.requiredChecksSource
      : null
    const baseBranch = typeof payload.baseBranch === 'string' && payload.baseBranch.trim() !== ''
      ? payload.baseBranch.trim()
      : null
    return {
      evidence: entry,
      merge: { mergeCommitSha, baseBranch, requiredChecksSource, payload },
    }
  }
  return null
}

export function findExistingResolutionComment(
  evidence: Evidence[],
  issueNumber: number,
): { commentId: number | null } | null {
  const match = [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && entry.payload.kind === 'github-issue-resolution'
    && entry.payload.issueNumber === issueNumber,
  )
  if (match == null) return null
  const commentUrl = typeof match.payload.commentUrl === 'string' ? match.payload.commentUrl : ''
  const commentId = /issuecomment-(\d+)/.exec(commentUrl)?.[1]
  return { commentId: commentId == null ? null : Number(commentId) }
}

export function requireNonBlankString(value: string | null | undefined, field: string): string {
  if (value == null) throw new ValidationError(`Run is missing required PR metadata (${field})`)
  const trimmed = value.trim()
  if (trimmed === '') throw new ValidationError(`Run is missing required PR metadata (${field})`)
  return trimmed
}

export function requireNonBlankNumber(value: number | null | undefined, field: string): number {
  if (value == null || !Number.isFinite(value)) {
    throw new ValidationError(`Run is missing required PR metadata (${field})`)
  }
  return value
}

export function normalizeOptionalString(value: string | undefined | null): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
