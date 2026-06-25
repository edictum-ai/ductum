import { PREREQUISITE_BLOCKED_SKIP_REASON } from './dispatcher-prerequisite-block.js'
import type { Task } from './types.js'
import type { TaskDispatchSkip } from './task-dispatch-skip-types.js'
import type { PrerequisiteIssue } from './repair-types.js'
import { recordRef, repairItem } from './repair-utils.js'

export function buildDispatchSkipRepairItems(input: {
  tasks?: readonly Task[]
  dispatchSkips?: readonly TaskDispatchSkip[]
}): PrerequisiteIssue[] {
  const tasks = new Map((input.tasks ?? []).map((task) => [task.id, task]))
  return (input.dispatchSkips ?? []).flatMap((skip) => {
    const task = tasks.get(skip.taskId)
    if (task == null || (task.status !== 'ready' && !(task.status === 'blocked' && skip.reason === PREREQUISITE_BLOCKED_SKIP_REASON))) return []
    if (skip.reason === PREREQUISITE_BLOCKED_SKIP_REASON) return [repairItem({
      id: `task:${task.id}:prerequisite-blocked`,
      area: 'dispatcher_visibility',
      severity: 'blocker',
      title: 'Task was blocked by dispatch prerequisites',
      reason: skip.detail ?? `The dispatcher blocked ${task.name} because prerequisite checks failed.`,
      suggestedAction: 'Fix the prerequisite, then explicitly set the task back to ready or retry dispatch.',
      record: recordRef('Task', task.id, task.name),
      field: { path: `tasks.${task.id}.status`, label: 'Task status', value: task.status },
      status: 'missing',
      issueCode: `dispatch_skip:${skip.reason}`,
      target: { taskId: task.id, taskName: task.name },
    })]
    return [repairItem({
      id: `task:${task.id}:dispatch-skip`,
      area: 'dispatcher_visibility',
      severity: 'attention',
      title: 'Ready task dispatch was skipped',
      reason: skip.detail == null || skip.detail.trim() === ''
        ? `The dispatcher skipped ${task.name}: ${skip.reason}.`
        : `The dispatcher skipped ${task.name}: ${skip.reason} (${skip.detail}).`,
      suggestedAction: 'Inspect the ready task and clear the blocking condition; this item clears when the dispatcher starts the task.',
      record: recordRef('Task', task.id, task.name),
      field: { path: `tasks.${task.id}.dispatchSkip`, label: 'Latest dispatch skip', value: skip.reason },
      status: 'unknown',
      issueCode: `dispatch_skip:${skip.reason}`,
      target: { taskId: task.id, taskName: task.name },
    })]
  })
}
