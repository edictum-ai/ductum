import type { FencingToken, Run, RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ConflictError, ValidationError } from '../errors.js'
import { resolveRunFence } from '../lease-fence.js'
import { isLinkedForExternalReview, recordProgress, requireRun } from './common.js'

export async function linkRun(
  context: ApiContext,
  runId: RunId,
  fields: Partial<Pick<Run, 'branch' | 'commitSha' | 'prNumber' | 'prUrl'>>,
): Promise<Run> {
  const run = context.repos.runs.updateGitArtifacts(runId, fields)
  if (run.stage !== 'ship' || !context.enforcement.isExternalReviewRequired(runId)) return run
  if (isLinkedForExternalReview(run)) context.syncExternalWatchers?.(runId)
  return await context.enforcement.syncRunState(runId)
}

export function assertRunCanComplete(context: ApiContext, runId: RunId): Run {
  const current = requireRun(context, runId)
  if (current.pendingApproval) {
    throw new ValidationError(`Run ${runId} requires approval before completion`)
  }
  if (current.terminalState != null) {
    throw new ConflictError(`Attempt ${runId} is already ${current.terminalState}; inspect status or retry the Attempt instead`)
  }
  if (current.stage !== 'done' && context.hasActiveSession?.(runId) !== true) {
    throw new ConflictError(`Run ${runId} is not ready to complete and has no live session to end`)
  }
  return current
}

export function completeRun(context: ApiContext, runId: RunId, result?: string, fenceToken?: FencingToken) {
  const current = assertRunCanComplete(context, runId)
  const effectiveFenceToken = fenceToken ?? resolveRunFence(context, runId)
  const completionSummary = result?.trim() ?? ''
  if (completionSummary !== '') {
    context.repos.runs.updateCompletionSummary(runId, completionSummary)
    recordProgress(context, runId, completionSummary)
  }

  if (current.stage !== 'done') return requireRun(context, runId)

  const updated = context.stateMachine.markDone(
    runId,
    completionSummary === '' ? undefined : completionSummary,
    { fenceToken: effectiveFenceToken, fenceNow: context.now() },
  )
  context.dag.onRunComplete(runId)
  context.enforcement.disposeRuntime(runId)
  return updated
}
