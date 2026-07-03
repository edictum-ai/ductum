import type { TaskId } from './types.js'

/**
 * Find a cycle in a task dependency graph restricted to `remaining` task
 * ids. Returns the cycle (including the repeated node at the end) when
 * one exists, otherwise returns all remaining nodes when no cycle is
 * found (mirrors the prior in-class behavior so DAG validation callers
 * can render a useful diagnostic either way).
 */
export function findTaskCycle(
  dependencies: Map<TaskId, TaskId[]>,
  remaining: Set<TaskId>,
): TaskId[] {
  const visited = new Set<TaskId>()
  const stack = new Set<TaskId>()
  const path: TaskId[] = []

  const walk = (taskId: TaskId): TaskId[] | null => {
    visited.add(taskId)
    stack.add(taskId)
    path.push(taskId)

    for (const dependsOnId of dependencies.get(taskId) ?? []) {
      if (!remaining.has(dependsOnId)) continue
      if (!visited.has(dependsOnId)) {
        const cycle = walk(dependsOnId)
        if (cycle != null) return cycle
        continue
      }
      if (stack.has(dependsOnId)) {
        const startIndex = path.indexOf(dependsOnId)
        return [...path.slice(startIndex), dependsOnId]
      }
    }

    path.pop()
    stack.delete(taskId)
    return null
  }

  for (const taskId of remaining) {
    if (visited.has(taskId)) continue
    const cycle = walk(taskId)
    if (cycle != null) return cycle
  }

  return [...remaining]
}
