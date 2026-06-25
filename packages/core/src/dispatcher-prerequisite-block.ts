import type { TaskDispatchSkipRepo } from './repos/task-dispatch-skip.js'
import type { TaskRepo } from './repos/interfaces.js'
import type { TaskId } from './types.js'

export const PREREQUISITE_BLOCKED_SKIP_REASON = 'prerequisite-blocked'

export function blockTaskForPrerequisites(
  taskRepo: TaskRepo,
  taskDispatchSkipRepo: TaskDispatchSkipRepo | undefined,
  input: { taskId: TaskId; detail: string; blockedAt: string },
): void {
  taskRepo.updateStatus(input.taskId, 'blocked')
  taskDispatchSkipRepo?.record({
    taskId: input.taskId,
    reason: PREREQUISITE_BLOCKED_SKIP_REASON,
    detail: input.detail,
    skippedAt: input.blockedAt,
  })
}
