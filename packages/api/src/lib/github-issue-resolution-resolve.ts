import type { Evidence, Project, Repository, Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError, ValidationError } from './errors.js'

/**
 * P1 #243: pure resolution + lookup helpers used by the issue closeout
 * orchestrator. Split out so the orchestrator stays under the 300 LOC file
 * cap and the validation rules are testable in isolation.
 *
 * Review round 2: this module owns three concrete guarantees the closeout
 * path must enforce before any GitHub write is attempted:
 *   1. The merged evidence headSha (NOT run.commitSha, which the merge driver
 *      mutates to the merge commit) is the authoritative Head SHA.
 *   2. The evidence's repo/prNumber/prUrl/headSha cross-checks against the
 *      referenced run + repository — stale or mismatched PR evidence cannot
 *      close an issue.
 *   3. observed required checks are present at successful conclusions, not
 *      just any requiredChecksSource string.
 */
export interface ResolvedMergeObservedCheck {
  name: string
  status: string
  conclusion: string | null
}

export interface ResolvedMergeEvidence {
  repo: string | null
  prNumber: number | null
  prUrl: string | null
  branch: string | null
  headSha: string
  baseBranch: string | null
  mergeCommitSha: string
  requiredChecksSource: string | null
  requiredChecks: string[]
  observedChecks: ResolvedMergeObservedCheck[]
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

/**
 * P1 #243 review round 2/4: cross-check the merge evidence against the
 * referenced run + repository and validate observed required checks.
 * Stale PR-evidence, mismatched repos, missing required checks, and
 * non-success conclusions all fail closed here — before any GitHub write.
 *
 * Review round 4: repo/prNumber/prUrl are REQUIRED identity fields, not
 * optional cross-checks. A `github-pr-merge` record missing any of them
 * cannot be tied to the referenced run/repository and must be rejected
 * loudly rather than silently falling back to run metadata.
 */
export function assertMergeChecksObserved(
  runId: string,
  merge: ResolvedMergeEvidence,
  context: {
    repository: { name: string; spec: { remoteUrl?: string | null } }
    repoRef: { owner: string; repo: string }
    run: Pick<Run, 'prNumber' | 'prUrl'>
  },
): void {
  // 1. Evidence repo is required and must match the resolved repository.
  if (merge.repo == null) {
    throw new ValidationError(
      `Run ${runId} merge evidence is missing required repo identity`,
    )
  }
  const evidenceRepo = merge.repo.toLowerCase()
  const resolvedRepo = `${context.repoRef.owner}/${context.repoRef.repo}`.toLowerCase()
  if (evidenceRepo !== resolvedRepo) {
    throw new ValidationError(
      `Run ${runId} merge evidence repo "${merge.repo}" does not match repository ${context.repository.name} (${context.repoRef.owner}/${context.repoRef.repo})`,
    )
  }
  // 2. Evidence prNumber is required and must match run.prNumber.
  if (merge.prNumber == null) {
    throw new ValidationError(
      `Run ${runId} merge evidence is missing required prNumber identity`,
    )
  }
  if (context.run.prNumber == null || merge.prNumber !== context.run.prNumber) {
    throw new ValidationError(
      `Run ${runId} merge evidence prNumber ${merge.prNumber} does not match run.prNumber ${context.run.prNumber ?? 'missing'}`,
    )
  }
  // 3. Evidence prUrl is required and must match run.prUrl.
  if (merge.prUrl == null || merge.prUrl.trim() === '') {
    throw new ValidationError(
      `Run ${runId} merge evidence is missing required prUrl identity`,
    )
  }
  if (context.run.prUrl == null || context.run.prUrl.trim() === ''
    || merge.prUrl.trim() !== context.run.prUrl.trim()) {
    throw new ValidationError(
      `Run ${runId} merge evidence prUrl does not match run.prUrl`,
    )
  }
  // 4. requiredChecksSource must be policy or branch_protection (not none/missing).
  if (merge.requiredChecksSource !== 'policy' && merge.requiredChecksSource !== 'branch_protection') {
    throw new ValidationError(
      `Run ${runId} merge evidence lacks a required-check policy source (got "${merge.requiredChecksSource ?? 'none'}")`,
    )
  }
  // 5. Each required check must be observed with status=completed + conclusion=success.
  if (merge.requiredChecks.length > 0) {
    const observedByName = new Map<string, ResolvedMergeObservedCheck>()
    for (const check of merge.observedChecks) {
      const name = check.name.trim()
      if (name !== '' && !observedByName.has(name)) observedByName.set(name, check)
    }
    for (const requiredName of merge.requiredChecks) {
      const observed = observedByName.get(requiredName)
      if (observed == null) {
        throw new ValidationError(
          `Run ${runId} merge evidence is missing observed required check "${requiredName}"`,
        )
      }
      if (observed.status !== 'completed') {
        throw new ValidationError(
          `Run ${runId} merge evidence required check "${requiredName}" did not complete (status="${observed.status}")`,
        )
      }
      if (observed.conclusion !== 'success') {
        throw new ValidationError(
          `Run ${runId} merge evidence required check "${requiredName}" concluded "${observed.conclusion}" (expected success)`,
        )
      }
    }
    return
  }
  // 6. No policy-required checks: still require at least one observed success.
  const anySuccess = merge.observedChecks.some((check) => check.status === 'completed' && check.conclusion === 'success')
  if (anySuccess) return
  throw new ValidationError(
    `Run ${runId} merge evidence recorded no successful observed checks for the merged PR head`,
  )
}

export function findLatestGitHubPrMergeEvidence(
  evidence: Evidence[],
): { evidence: Evidence; merge: ResolvedMergeEvidence } | null {
  for (const entry of [...evidence].reverse()) {
    if (entry.type !== 'custom') continue
    if (entry.payload.kind !== 'github-pr-merge') continue
    const payload = entry.payload as Record<string, unknown>
    const headSha = typeof payload.headSha === 'string' && payload.headSha.trim() !== ''
      ? payload.headSha.trim()
      : null
    if (headSha == null) continue
    const mergeCommitSha = typeof payload.mergeCommitSha === 'string' && payload.mergeCommitSha.trim() !== ''
      ? payload.mergeCommitSha.trim()
      : ''
    if (mergeCommitSha === '') continue
    const requiredChecksSource = typeof payload.requiredChecksSource === 'string'
      ? payload.requiredChecksSource
      : null
    const baseBranch = typeof payload.baseBranch === 'string' && payload.baseBranch.trim() !== ''
      ? payload.baseBranch.trim()
      : null
    const repo = typeof payload.repo === 'string' && payload.repo.trim() !== ''
      ? payload.repo.trim()
      : null
    const prNumber = typeof payload.prNumber === 'number' && Number.isFinite(payload.prNumber)
      ? payload.prNumber
      : null
    const prUrl = typeof payload.prUrl === 'string' && payload.prUrl.trim() !== ''
      ? payload.prUrl.trim()
      : null
    const branch = typeof payload.branch === 'string' && payload.branch.trim() !== ''
      ? payload.branch.trim()
      : null
    const requiredChecks = Array.isArray(payload.requiredChecks)
      ? payload.requiredChecks.filter((name): name is string => typeof name === 'string' && name.trim() !== '')
      : []
    const observedChecks = Array.isArray(payload.observedChecks)
      ? payload.observedChecks
          .map((raw) => normalizeObservedCheck(raw))
          .filter((check): check is ResolvedMergeObservedCheck => check != null)
      : []
    return {
      evidence: entry,
      merge: {
        repo, prNumber, prUrl, branch, headSha, baseBranch, mergeCommitSha,
        requiredChecksSource, requiredChecks, observedChecks, payload,
      },
    }
  }
  return null
}

function normalizeObservedCheck(raw: unknown): ResolvedMergeObservedCheck | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : ''
  const status = typeof record.status === 'string' ? record.status : ''
  const conclusion = typeof record.conclusion === 'string'
    ? record.conclusion
    : record.conclusion == null
      ? null
      : String(record.conclusion)
  if (name.trim() === '' || status.trim() === '') return null
  return { name, status, conclusion }
}

export function findExistingResolutionComment(
  evidence: Evidence[],
  issueNumber: number,
): { commentId: number | null } | null {
  const match = [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && (entry.payload.kind === 'github-issue-resolution'
      || entry.payload.kind === 'github-issue-resolution-comment')
    && entry.payload.issueNumber === issueNumber,
  )
  if (match == null) return null
  // P1 #243 review: read the stored commentId directly instead of regex-parsing
  // it back out of commentUrl. Both evidence kinds record commentId at write
  // time; only fall back to null if an old record predates that field.
  const commentId = typeof match.payload.commentId === 'number'
    ? Number.isFinite(match.payload.commentId)
      ? match.payload.commentId
      : null
    : null
  return { commentId }
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
