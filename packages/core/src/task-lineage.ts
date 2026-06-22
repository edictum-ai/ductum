import type { Task } from './types.js'

export type TaskKind = 'impl' | 'review' | 'fix'

export interface ParsedTaskName {
  kind: TaskKind
  originalName: string
  round: number
}

/**
 * Parse a task name into its post-completion lineage role.
 *
 *   `P1`             -> impl
 *   `review-P1`      -> review (round 1)
 *   `review-P1-r2`   -> review (round 2)
 *   `fix-P1-r1`      -> fix   (round 1)
 *
 * Pure name parser. When a Task object is available prefer `classifyTask`,
 * which uses `task.requiredRole` to disambiguate impl tasks whose human
 * name happens to start with `review-` or `fix-`.
 */
export function parseTaskName(name: string): ParsedTaskName {
  const reviewRoundMatch = name.match(/^review-(.+)-r(\d+)$/)
  if (reviewRoundMatch != null) {
    return {
      kind: 'review',
      originalName: reviewRoundMatch[1]!,
      round: Number(reviewRoundMatch[2]),
    }
  }
  if (name.startsWith('review-')) {
    return { kind: 'review', originalName: name.slice('review-'.length), round: 1 }
  }
  const fixMatch = name.match(/^fix-(.+)-r(\d+)$/)
  if (fixMatch != null) {
    return {
      kind: 'fix',
      originalName: fixMatch[1]!,
      round: Number(fixMatch[2]),
    }
  }
  return { kind: 'impl', originalName: name, round: 0 }
}

/**
 * Classify a task by its post-completion lineage role. Reviewer tasks still
 * require `requiredRole === 'reviewer'` so spec-imported implementation tasks
 * that start with `review-` do not get misrouted. Exact `fix-*-rN` names are
 * reserved repair-lineage syntax even when an imported/operator-created fix
 * task lacks `requiredRole === 'builder'`.
 *
 * For review/fix kinds we still parse the name to extract `originalName`
 * and `round` because those metadata are encoded in the name by the
 * router.
 */
export function classifyTask(task: Task): ParsedTaskName {
  if (task.requiredRole === 'reviewer') {
    const parsed = parseTaskName(task.name)
    if (parsed.kind === 'review') return parsed
  }
  const parsed = parseTaskName(task.name)
  if (parsed.kind === 'fix' && (task.requiredRole === 'builder' || task.requiredRole == null)) return parsed
  return { kind: 'impl', originalName: task.name, round: 0 }
}

export function lineageOriginalName(taskName: string): string {
  const parsed = parseTaskName(taskName)
  return parsed.kind === 'impl' ? taskName : parsed.originalName
}

export function isTaskInLineage(taskName: string, originalName: string): boolean {
  if (taskName === originalName) return true
  const parsed = parseTaskName(taskName)
  return parsed.kind !== 'impl' && parsed.originalName === originalName
}
