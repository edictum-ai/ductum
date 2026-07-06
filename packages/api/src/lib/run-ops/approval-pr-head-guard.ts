import {
  hasCurrentCommitRemoteCiPass,
  hasCurrentCommitReviewPass,
  type Evidence,
  type Run,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ensureFreshOperatorPrAdoptionReviewEvidence } from '../operator-pr-adoption-gates.js'
import { ensureCurrentPrHeadRemoteCiEvidence } from './approval-ci-evidence.js'
import { nonBlank } from './common.js'
import { hasPrReference, isPrBackedExternalReviewRun } from './merge-utils.js'
import { resolveCurrentPrHeadSha } from './pr-head.js'

interface ApprovalGuardResult {
  success: false
  stage: string
  reason: string
}

export async function guardStalePrHeadApproval(context: ApiContext, run: Run): Promise<ApprovalGuardResult | null> {
  if (!hasPrReference(run)) return null
  const existingEvidence = context.repos.evidence.list(run.id)
  const requiresAdoptionReviewRefresh = hasOperatorPrAdoptionEvidence(existingEvidence)
  let currentPrHeadSha: string | null = null
  let readError: unknown
  try {
    currentPrHeadSha = await resolveCurrentPrHeadSha(context, run)
  } catch (error) {
    readError = error
  }
  if (!nonBlank(currentPrHeadSha)) {
    if (!requiresAdoptionReviewRefresh) return null
    const reason = `approval blocked: current PR review state cannot be checked for operator-adopted PR; ${describePrHeadReadFailure(readError)}`
    context.repos.runUpdates.create(run.id, reason)
    context.repos.runs.updateLatchStatus(run.id, 'reviewStatus', 'fail')
    return { success: false, stage: run.stage, reason }
  }
  const guardedRun = currentPrHeadSha === run.commitSha
    ? run
    : context.repos.runs.updateGitArtifacts(run.id, { commitSha: currentPrHeadSha })
  const evidenceRun = await ensureCurrentPrHeadRemoteCiEvidence(context, guardedRun, currentPrHeadSha)
  const adoptionReviewGate = await ensureFreshOperatorPrAdoptionReviewEvidence(context, evidenceRun, currentPrHeadSha)
    .catch((error: unknown) => {
      if (!requiresAdoptionReviewRefresh) throw error
      return {
        ok: false,
        reasons: [describeReviewRefreshFailure(error)],
        reviewDecision: null,
      }
    })
  if (!adoptionReviewGate.ok) {
    const reason = `approval blocked: current PR review state is not passing for ${currentPrHeadSha}; ${adoptionReviewGate.reasons.join('; ')}`
    context.repos.runUpdates.create(run.id, reason)
    if (requiresAdoptionReviewRefresh) context.repos.runs.updateLatchStatus(run.id, 'reviewStatus', 'fail')
    return { success: false, stage: run.stage, reason }
  }
  const evidence = context.repos.evidence.list(run.id)
  const externalReviewRequired = isPrBackedExternalReviewRun(context, run.id, evidenceRun)
  const reasons = [
    (run.ciStatus === 'pass' || currentPrHeadSha !== run.commitSha) && !hasCurrentCommitRemoteCiPass(evidenceRun, evidence)
      ? 'current PR head has no passing remote CI evidence'
      : null,
    externalReviewRequired && !hasCurrentCommitReviewPass(evidenceRun, evidence)
      ? 'current PR head has no passing review evidence'
      : null,
  ].filter(Boolean)
  if (reasons.length === 0) return null
  const reason = currentPrHeadSha === run.commitSha
    ? `approval blocked: current PR head ${currentPrHeadSha} lacks fresh gate evidence; ${reasons.join('; ')}`
    : `approval blocked: PR head changed from ${run.commitSha ?? 'unknown'} to ${currentPrHeadSha}; ${reasons.join('; ')}`
  context.repos.runUpdates.create(run.id, reason)
  return { success: false, stage: run.stage, reason }
}

function hasOperatorPrAdoptionEvidence(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) =>
    item.type === 'custom' &&
    item.payload.kind === 'operator-pr-adoption',
  )
}

function describePrHeadReadFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return `could not read current PR head: ${error.message.trim()}`
  return 'current PR head is unavailable'
}

function describeReviewRefreshFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return `could not refresh review state: ${error.message.trim()}`
  return 'could not refresh review state'
}
