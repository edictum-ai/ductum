import { createId, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import type { GitHubRepoRef } from '../github-ref.js'
import { nonBlank } from './common.js'
import type { ApprovalRequiredCheckDecision } from './approval-required-check-classifier.js'
import type { MergeStrategy } from '../deps.js'
import type { GitHubActorIdentity } from '../github-auth.js'

/**
 * Issue #243: completion evidence payload for a PR-backed GitHub App merge.
 * Captures the final merged state (not just PR creation) plus the check
 * summary the gate observed at merge time, the GitHub actor/app identity,
 * and the merge commit. Operator approval identity is recorded separately
 * by `approveRun` and linked via the shared runId.
 */
export interface GitHubPrMergeEvidenceInput {
  runId: RunId
  run: Pick<Run, 'prUrl' | 'branch'>
  repoRef: GitHubRepoRef
  pullNumber: number
  headSha: string
  baseBranch: string
  mergeMethod: MergeStrategy
  merged: boolean
  mergeCommitSha?: string | undefined
  actor: GitHubActorIdentity
  requiredCheckDecision: ApprovalRequiredCheckDecision | null
}

export function recordGitHubPrMergeEvidence(
  context: Pick<ApiContext, 'repos' | 'now'>,
  input: GitHubPrMergeEvidenceInput,
): void {
  context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: input.runId,
    type: 'custom',
    payload: {
      kind: 'github-pr-merge',
      repo: `${input.repoRef.owner}/${input.repoRef.repo}`,
      prNumber: input.pullNumber,
      ...(nonBlank(input.run.prUrl) ? { prUrl: input.run.prUrl } : {}),
      ...(nonBlank(input.run.branch) ? { branch: input.run.branch } : {}),
      headSha: input.headSha,
      baseBranch: input.baseBranch,
      mergeMethod: input.mergeMethod,
      merged: input.merged,
      ...(input.mergeCommitSha == null ? {} : { mergeCommitSha: input.mergeCommitSha }),
      actorType: input.actor.type,
      actorLabel: input.actor.label,
      ...(input.requiredCheckDecision == null
        ? {}
        : {
            requiredChecksSource: input.requiredCheckDecision.requiredChecksSource,
            requiredChecks: input.requiredCheckDecision.resolvedRequiredChecks,
            observedChecks: input.requiredCheckDecision.observed.map((check) => ({
              name: check.name,
              status: check.status,
              conclusion: check.conclusion,
            })),
          }),
    },
  })
}

export function formatGitHubPrMergeAudit(input: {
  pullNumber: number
  headSha: string
  baseBranch: string
  mergeCommitSha?: string | undefined
}): string {
  const mergeSuffix = input.mergeCommitSha == null
    ? ''
    : ` (merge commit ${input.mergeCommitSha.slice(0, 12)})`
  return `GitHub App merged PR #${input.pullNumber} at head ${input.headSha.slice(0, 12)} into ${input.baseBranch}${mergeSuffix}`
}
