import type { DuctumEventEmitter } from './events.js'
import { log } from './logger.js'
import { cleanupOrphanWorkerProcess, type OrphanWorkerCleanupResult } from './orphan-worker-process-cleanup.js'
import { redactPublicText } from './public-redaction.js'
import type { RunRepo, SessionRunMappingRepo, TaskRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import type { Run, RunId } from './types.js'
import type { WatcherManager } from './watcher-manager.js'
import { isWorkflowOwnedRun } from './workflow-owned-run.js'

interface StaleSlotGcInput {
  runRepo: RunRepo
  taskRepo: TaskRepo
  sessionMappingRepo: SessionRunMappingRepo
  stateMachine: RunStateMachine
  watcherManager: WatcherManager
  eventEmitter: DuctumEventEmitter
  activeRunIds: Set<RunId>
  startingRunIds?: Set<RunId>
  finishingRunIds: Set<RunId>
  now: Date
  cleanupWorkerProcess?: (run: Run) => Promise<OrphanWorkerCleanupResult>
}

export interface StaleSlotGcResult {
  closed: RunId[]
  cleanup: {
    attempted: number
    cleaned: number
    skipped: number
    failed: number
  }
}

export async function closeStaleSlots(input: StaleSlotGcInput): Promise<StaleSlotGcResult> {
  const result: StaleSlotGcResult = {
    closed: [],
    cleanup: { attempted: 0, cleaned: 0, skipped: 0, failed: 0 },
  }
  for (const run of input.runRepo.getActive()) {
    if (
      input.activeRunIds.has(run.id) ||
      input.startingRunIds?.has(run.id) ||
      input.finishingRunIds.has(run.id) ||
      isWorkflowOwnedRun(run, input.taskRepo) ||
      !isStaleSlot(run, input.now)
    ) {
      continue
    }
    const cleanup = await cleanupStaleSlotWorker(input, run)
    bumpCleanup(result, cleanup)
    if (cleanup.outcome === 'failed') {
      log.warn('dispatcher', `stale slot worker cleanup failed for ${run.id.slice(0, 8)}: ${cleanup.reason}`)
    }
    input.stateMachine.markStalled(run.id)
    input.runRepo.updateFailure(run.id, 'stale_slot_gc', true)
    input.watcherManager.stopWatchers(run.id, 'stale slot auto-closed')
    input.eventEmitter.emit({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
    result.closed.push(run.id)
  }
  return result
}

function isStaleSlot(run: Run, now: Date): boolean {
  if (run.lastHeartbeat == null) return false
  const lastHeartbeat = new Date(run.lastHeartbeat).getTime()
  if (!Number.isFinite(lastHeartbeat)) return false
  return lastHeartbeat + run.heartbeatTimeoutSeconds * 2_000 < now.getTime()
}

async function cleanupStaleSlotWorker(
  input: StaleSlotGcInput,
  run: Run,
): Promise<OrphanWorkerCleanupResult> {
  try {
    const mapping = input.sessionMappingRepo.getByRunId(run.id)
    return await (input.cleanupWorkerProcess?.(run) ?? cleanupOrphanWorkerProcess(mapping ?? {
      createdAt: run.createdAt,
      workerPid: null,
      workerOwnershipKind: null,
      workerStartedAt: null,
      workerOwnershipUnsupportedReason: null,
    }))
  } catch (error) {
    return {
      attempted: true,
      outcome: 'failed',
      reason: redactPublicText(error instanceof Error ? error.message : String(error)),
      pid: null,
      ownershipKind: null,
      startedAt: null,
    }
  }
}

function bumpCleanup(result: StaleSlotGcResult, cleanup: OrphanWorkerCleanupResult): void {
  if (cleanup.outcome === 'skipped') {
    result.cleanup.skipped += 1
    return
  }
  result.cleanup.attempted += 1
  if (cleanup.outcome === 'failed') result.cleanup.failed += 1
  else result.cleanup.cleaned += 1
}
