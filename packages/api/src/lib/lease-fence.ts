import type { RunId, SessionRunMapping } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ConflictError, ForbiddenError, ValidationError } from './errors.js'
import { requireSessionControl, SESSION_CONTROL_TOKEN_HEADER } from './session-control.js'

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

export function resolveRunFence(context: ApiContext, runId: RunId, controlToken?: string): number | undefined {
  const latest = context.repos.attemptLeases.getLatestForRun(runId)
  if (latest == null) return undefined
  const active = context.repos.attemptLeases.getActiveForRun(runId, context.now())
  const token = controlToken?.trim()
  if (active == null) {
    if (token != null && token !== '') {
      throw new ConflictError(`Run ${runId} has no active attempt lease`)
    }
    return undefined
  }
  if (token == null || token === '') {
    throw new ValidationError(`${SESSION_CONTROL_TOKEN_HEADER} is required for leased run ${runId}`)
  }
  const run = context.repos.runs.get(runId)
  if (run?.sessionId == null) {
    throw new ConflictError(`Run ${runId} has an active attempt lease but no active session`)
  }
  const mapping = requireSessionControl(context, run.sessionId, token)
  if (mapping.runId !== runId) {
    throw new ForbiddenError(`Session ${mapping.sessionId} is not bound to run ${runId}`)
  }
  return resolveSessionFence(context, mapping)
}
