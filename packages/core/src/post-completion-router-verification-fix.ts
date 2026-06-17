import { log } from './logger.js'
import { PostCompletionDispatchRouter } from './post-completion-router-dispatch.js'
import { DEFAULT_MAX_FIX_ITERATIONS } from './post-completion-router-types.js'
import { classifyTask } from './task-lineage.js'
import { createId, type AgentId, type Run, type Task } from './types.js'

export class PostCompletionVerificationFixRouter extends PostCompletionDispatchRouter {
  protected dispatchVerificationFix(
    parentRun: Run,
    parentTask: Task,
    verifyCommands: string[],
    verifyOutput: string,
    tag: string,
  ): void {
    const parsed = classifyTask(parentTask)
    const originalName = parsed.kind === 'impl' ? parentTask.name : parsed.originalName
    const tasksInSpec = this.ctx.taskRepo.list(parentTask.specId)
    const originalTask = tasksInSpec.find((t) => t.name === originalName) ?? parentTask
    const root = this.findRootRun(parentRun) ?? parentRun
    const chain = this.walkParentChain(parentRun)
    const existingFixCount = chain.filter((r) => {
      const t = this.ctx.taskRepo.get(r.taskId)
      return t != null && classifyTask(t).kind === 'fix'
    }).length
    const maxIterations = this.maxFixIterations(parentRun)

    if (existingFixCount >= maxIterations) {
      const failureReason = `max_review_iterations (${maxIterations}) exceeded after verification failure`
      log.warn('pipeline', `${tag} verification failed after ${existingFixCount} fix iteration(s) — escalating root ${root.id.slice(0, 6)}`)
      if (root.terminalState == null) {
        this.ctx.stateMachine.markFailed(root.id, failureReason)
      }
      this.cleanupFailedLineage(root, parentRun, 'failed', failureReason, tag)
      return
    }

    const round = existingFixCount + 1
    const fixTaskId = createId<'TaskId'>()
    this.ctx.taskRepo.create({
      id: fixTaskId,
      specId: originalTask.specId,
      targetId: originalTask.targetId,
      repositoryId: originalTask.repositoryId,
      componentId: originalTask.componentId,
      name: `fix-${originalName}-r${round}`,
      prompt: [
        '## Verification Fix Task (Round ' + round + ')',
        '',
        'The previous run completed, but Ductum verification failed. Fix only the issues exposed by verification; do not rewrite from scratch.',
        '',
        '### Original Task',
        originalTask.prompt,
        '',
        '### Verify Commands',
        '```',
        verifyCommands.join('\n'),
        '```',
        '',
        '### Verify Output',
        '```',
        verifyOutput.slice(0, 10_000),
        '```',
        '',
        '### Instructions',
        '',
        '1. Reproduce the failing verification command in this worktree.',
        '2. Make the smallest fix that addresses the failure.',
        '3. Re-run the relevant verification command.',
        '4. Call `ductum_complete` with what you changed and the verification result.',
        '',
        'Do not push branches or merge. Ductum owns shipping after you complete.',
      ].join('\n'),
      repos: originalTask.repos,
      assignedAgentId: parentRun.agentId as AgentId,
      requiredRole: 'builder',
      complexity: 'simple',
      status: 'ready',
      verification: [],
      retryCount: 0,
      retryAfter: null,
    })
    log.info('pipeline', `${tag} verification fix task ${fixTaskId.slice(0, 6)} created (round ${round}/${maxIterations})`)
    // Persist the milestone in stage_history so dashboard, ductum
    // history, and audit trails show "verification failed → fix
    // dispatched" rather than the parent looking like it's still
    // typing in the same implement stage. Stage value stays the same
    // (no new enum needed); the reason carries the signal.
    this.ctx.stateMachine.recordStageAdvance(
      parentRun.id,
      parentRun.stage,
      parentRun.stage,
      `Verification failed; fix-${originalName}-r${round} dispatched`,
    )
  }

  protected maxFixIterations(run?: Run): number {
    if (run != null) {
      const task = this.ctx.taskRepo.get(run.taskId)
      if (task != null) {
        const spec = this.ctx.specRepo.get(task.specId)
        if (spec != null && typeof spec.maxFixIterations === 'number' && spec.maxFixIterations > 0) {
          return spec.maxFixIterations
        }
      }
    }
    const pc = this.ctx.postCompletion
    if (pc == null) return DEFAULT_MAX_FIX_ITERATIONS
    if (typeof pc.maxFixIterations === 'number') return pc.maxFixIterations
    if (typeof pc.maxReviewRounds === 'number') return pc.maxReviewRounds
    return DEFAULT_MAX_FIX_ITERATIONS
  }
}
