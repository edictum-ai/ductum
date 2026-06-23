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
