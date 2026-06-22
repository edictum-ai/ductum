import type { WorkspaceSnapshot } from '../types.js'
import type { TaskRecord } from './status-data.js'

const DISPATCHABLE_SPEC_STATUSES = new Set(['approved', 'implementing'])

export function filterDispatchableReadyTasks(records: TaskRecord[], snapshot: WorkspaceSnapshot) {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const tasksWithOpenRuns = new Set(
    snapshot.runs
      .filter((run) => run.stage !== 'done' && run.terminalState == null)
      .map((run) => run.taskId),
  )
  return records.filter((record) =>
    record.task.status === 'ready'
    && DISPATCHABLE_SPEC_STATUSES.has(record.spec.status)
    && !tasksWithOpenRuns.has(record.task.id)
    && record.dependencies.every((dependency) => {
      const dependencyTask = taskById.get(dependency.dependsOnId)
      if (dependencyTask == null) return false
      return record.task.strategyRole === 'blind_review'
        ? dependencyTask.status === 'done' || dependencyTask.status === 'failed'
        : dependencyTask.status === 'done'
    }),
  )
}
