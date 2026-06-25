import type { TaskId } from './types.js'

export interface TaskDispatchSkip {
  taskId: TaskId
  reason: string
  detail: string | null
  skippedAt: string
  updatedAt: string
}
