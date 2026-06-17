import type { DuctumEventEmitter } from './events.js'
import type { RunRepo, TaskRepo } from './repos/interfaces.js'
import type { RunStateMachine } from './state-machine.js'
import { isTaskInLineage, lineageOriginalName } from './task-lineage.js'
import type { Run, RunId, Task, TaskId, TaskStatus } from './types.js'

export interface FailedLineageCleanupContext {
  runRepo: RunRepo
  taskRepo: TaskRepo
  stateMachine: RunStateMachine
  eventEmitter: DuctumEventEmitter
  hasLiveSession?: (runId: RunId) => boolean
}

export interface FailedLineageCleanupOptions {
  rootRun: Run
  currentRun?: Run
  currentRunDisposition?: 'done' | 'failed'
  reason: string
}

export interface FailedLineageCleanupResult {
  closedRunIds: RunId[]
  closedTaskIds: TaskId[]
  skippedLiveRunIds: RunId[]
}

export function closeFailedLineageDescendants(
  ctx: FailedLineageCleanupContext,
  options: FailedLineageCleanupOptions,
): FailedLineageCleanupResult {
  const rootTask = ctx.taskRepo.get(options.rootRun.taskId)
  if (rootTask == null) {
    return emptyResult()
  }

  const hasLiveSession = ctx.hasLiveSession ?? (() => false)
  const originalName = lineageOriginalName(rootTask.name)
  const lineageTasks = ctx.taskRepo
    .list(rootTask.specId)
    .filter((task) => isTaskInLineage(task.name, originalName))
  const lineageTaskIds = new Set(lineageTasks.map((task) => task.id))
  const lineageRuns = lineageTasks.flatMap((task) => ctx.runRepo.list(task.id))

  const closedRunIds: RunId[] = []
  const skippedLiveRunIds: RunId[] = []
  for (const run of lineageRuns) {
    if (!lineageTaskIds.has(run.taskId)) continue
    if (run.id === options.currentRun?.id) {
      const closed = closeCurrentRun(ctx, run, options)
      if (closed) closedRunIds.push(run.id)
      continue
    }
    if (hasLiveSession(run.id)) {
      skippedLiveRunIds.push(run.id)
      continue
    }
    if (run.stage !== 'done' && run.terminalState !== 'failed') {
      ctx.stateMachine.markFailed(run.id, options.reason)
      closedRunIds.push(run.id)
    }
  }

  const closedTaskIds = closeLineageTasks(ctx, lineageTasks, hasLiveSession)
  return { closedRunIds, closedTaskIds, skippedLiveRunIds }
}

function closeCurrentRun(
  ctx: FailedLineageCleanupContext,
  run: Run,
  options: FailedLineageCleanupOptions,
): boolean {
  if (options.currentRunDisposition === 'done') {
    if (run.stage === 'done') return false
    ctx.stateMachine.markDone(run.id, options.reason)
    return true
  }
  if (options.currentRunDisposition === 'failed') {
    if (run.stage === 'done' || run.terminalState === 'failed') return false
    ctx.stateMachine.markFailed(run.id, options.reason)
    return true
  }
  return false
}

function closeLineageTasks(
  ctx: FailedLineageCleanupContext,
  tasks: Task[],
  hasLiveSession: (runId: RunId) => boolean,
): TaskId[] {
  const closedTaskIds: TaskId[] = []
  for (const task of tasks) {
    const runs = ctx.runRepo.list(task.id)
    if (runs.some((run) => hasLiveSession(run.id))) continue

    const targetStatus = resolveTaskStatus(task, runs)
    if (targetStatus == null || task.status === targetStatus) continue

    ctx.taskRepo.updateStatus(task.id, targetStatus)
    ctx.eventEmitter.emit({
      type: 'task.status_changed',
      taskId: task.id,
      from: task.status,
      to: targetStatus,
    })
    closedTaskIds.push(task.id)
  }
  return closedTaskIds
}

function resolveTaskStatus(task: Task, runs: Run[]): TaskStatus | null {
  if (runs.length === 0) {
    return task.status === 'done' ? null : 'failed'
  }
  if (runs.some((run) => run.stage === 'done')) return 'done'
  if (runs.every((run) => run.terminalState != null)) return 'failed'
  return null
}

function emptyResult(): FailedLineageCleanupResult {
  return { closedRunIds: [], closedTaskIds: [], skippedLiveRunIds: [] }
}
