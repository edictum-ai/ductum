import type { TaskRepo } from './repos/interfaces.js'
import { classifyTask } from './post-completion-router.js'
import type { Run, Task } from './types.js'

export interface CompletionRouter {
  isBakeoffBlindReviewTask(task: Task): boolean
  runBlindReviewCompletion(run: Run): Promise<void>
  runReviewCompletion(run: Run): Promise<void>
  runFixCompletion(run: Run): Promise<void>
  runImplCompletion(run: Run): Promise<void>
}

export async function routeCompletedRun(input: {
  run: Run
  taskRepo: TaskRepo
  router: CompletionRouter
}): Promise<void> {
  const task = input.taskRepo.get(input.run.taskId)
  if (task == null) return
  const kind = classifyTask(task).kind
  if (input.router.isBakeoffBlindReviewTask(task)) {
    await input.router.runBlindReviewCompletion(input.run)
  } else if (kind === 'review') {
    await input.router.runReviewCompletion(input.run)
  } else if (kind === 'fix') {
    await input.router.runFixCompletion(input.run)
  } else if (input.run.worktreePaths != null && input.run.worktreePaths.length > 0) {
    await input.router.runImplCompletion(input.run)
  }
}
