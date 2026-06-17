import type { DuctumEventEmitter } from './events.js'
import type { RunRepo, TaskRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { Run, RunId } from './types.js'
import type { WatcherManager } from './watcher-manager.js'
import { isWorkflowOwnedRun } from './workflow-owned-run.js'

interface StaleSlotGcInput {
  runRepo: RunRepo
  taskRepo: TaskRepo
  stateMachine: RunStateMachine
  watcherManager: WatcherManager
  eventEmitter: DuctumEventEmitter
  activeRunIds: Set<RunId>
  finishingRunIds: Set<RunId>
  now: Date
}

export function closeStaleSlots(input: StaleSlotGcInput): RunId[] {
  const closed: RunId[] = []
  for (const run of input.runRepo.getActive()) {
    if (
      input.activeRunIds.has(run.id) ||
      input.finishingRunIds.has(run.id) ||
      isWorkflowOwnedRun(run, input.taskRepo) ||
      !isStaleSlot(run, input.now)
    ) {
      continue
    }
    input.stateMachine.markStalled(run.id)
    input.runRepo.updateFailure(run.id, 'stale_slot_gc', true)
    input.watcherManager.stopWatchers(run.id, 'stale slot auto-closed')
    input.eventEmitter.emit({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
    closed.push(run.id)
  }
  return closed
}

function isStaleSlot(run: Run, now: Date): boolean {
  if (run.lastHeartbeat == null) return false
  const lastHeartbeat = new Date(run.lastHeartbeat).getTime()
  if (!Number.isFinite(lastHeartbeat)) return false
  return lastHeartbeat + run.heartbeatTimeoutSeconds * 2_000 < now.getTime()
}
