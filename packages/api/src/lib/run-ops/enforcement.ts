import type { FencingToken, RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ForbiddenError } from '../errors.js'
import { requireRun } from './common.js'

export async function authorizeTool(
  context: ApiContext,
  runId: RunId,
  tool: string,
  args: Record<string, unknown>,
  fenceToken?: FencingToken,
) {
  requireRun(context, runId)
  const result = fenceToken == null
    ? await context.enforcement.authorizeTool(runId, tool, args)
    : await context.enforcement.authorizeTool(runId, tool, args, { fenceToken, fenceNow: context.now() })
  if (!result.allowed) throw new ForbiddenError(result.reason ?? 'Tool call blocked')
  return result
}

export async function gateCheck(context: ApiContext, runId: RunId) {
  requireRun(context, runId)
  const state = await context.enforcement.getWorkflowState(runId)
  return {
    allowed: true,
    stage: state.activeStage,
    completedStages: state.completedStages,
    pendingApproval: state.pendingApproval,
    blockedReason: (state as unknown as Record<string, unknown>).blockedReason ?? null,
  }
}

export async function failRun(
  context: ApiContext,
  runId: RunId,
  reason: string,
  recoverable: boolean,
) {
  requireRun(context, runId)
  if (!recoverable) return context.stateMachine.markFailed(runId, reason)
  await context.enforcement.resetToStage(runId, 'implement', { reason: `recoverable failure: ${reason}` })
  return requireRun(context, runId)
}

export async function reportToolSuccess(
  context: ApiContext,
  runId: RunId,
  tool: string,
  args: Record<string, unknown>,
  fenceToken?: FencingToken,
): Promise<void> {
  requireRun(context, runId)
  if (fenceToken == null) {
    await context.enforcement.recordToolSuccess(runId, tool, args)
  } else {
    await context.enforcement.recordToolSuccess(runId, tool, args, { fenceToken, fenceNow: context.now() })
  }
}
