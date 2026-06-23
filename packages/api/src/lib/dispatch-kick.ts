import { log } from '@ductum/core'

import type { ApiContext } from './deps.js'

export async function kickDispatcherForReadyTask(context: ApiContext, reason: string): Promise<void> {
  if (context.cycleDispatcher == null) return
  const status = context.getDispatcherStatus?.()
  if (status != null && !status.enabled) return

  try {
    await context.cycleDispatcher()
  } catch (error) {
    log.warn(
      'dispatcher',
      `ready-queue kick after ${reason} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function evaluateTaskDAGAndKick(
  context: ApiContext,
  specId: string,
  reason: string,
  taskIdsToCheck: string[] = [],
) {
  const readyTaskIds = context.dag.evaluateTaskDAG(specId as never)
  const hasReadyTask = readyTaskIds.length > 0 || taskIdsToCheck.some((id) =>
    context.repos.tasks.get(id as never)?.status === 'ready'
  )
  if (hasReadyTask) await kickDispatcherForReadyTask(context, reason)
  return readyTaskIds
}
