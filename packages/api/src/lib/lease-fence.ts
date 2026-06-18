import type { RunId, SessionRunMapping } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, ForbiddenError } from './errors.js'

export function resolveSessionFence(
  context: ApiContext,
  mapping: SessionRunMapping,
): number | undefined {
  const latest = context.repos.attemptLeases.getLatestForRun(mapping.runId)
  if (latest == null) return undefined
  const active = context.repos.attemptLeases.getActiveForSession(mapping.sessionId, context.now())
  if (active == null || active.runId !== mapping.runId) {
    throw new ForbiddenError(`Session ${mapping.sessionId} does not hold the active lease for run ${mapping.runId}`)
  }
  return active.fenceToken
}

export function resolveRunFence(context: ApiContext, runId: RunId): number | undefined {
  const latest = context.repos.attemptLeases.getLatestForRun(runId)
  if (latest == null) return undefined
  const active = context.repos.attemptLeases.getActiveForRun(runId, context.now())
  if (active == null) {
    throw new ConflictError(`Run ${runId} has no active attempt lease`)
  }
  return active.fenceToken
}
