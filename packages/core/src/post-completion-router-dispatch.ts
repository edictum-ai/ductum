import {
  buildRebaseFixPrompt,
  buildReviewPrompt,
  collectDiff,
  verifyWorktree,
} from './post-completion.js'
import { PostCompletionTaskCompletionRouter } from './post-completion-router-task-completion.js'
import { classifyTask } from './task-lineage.js'
import { createId, type AgentId, type Run, type Task } from './types.js'
import { log } from './logger.js'

export class PostCompletionDispatchRouter extends PostCompletionTaskCompletionRouter {
  /** Shared review-task dispatch used by impl and fix completion paths. */
  protected async dispatchReview(
    parentRun: Run,
    parentTask: Task,
    worktreePath: string,
    verifyCommands: string[],
    reviewRound: number,
    tag: string,
    verifiedOutput?: string,
  ): Promise<void> {
    if (this.ctx.postCompletion == null) return
    const parsed = classifyTask(parentTask)
    const originalName = parsed.kind === 'impl' ? parentTask.name : parsed.originalName
    const tasksInSpec = this.ctx.taskRepo.list(parentTask.specId)
    const originalTask = tasksInSpec.find((t) => t.name === originalName) ?? parentTask

    const projectName = this.resolveProjectName(parentTask)
    const reviewerAgentId = projectName != null
      ? this.ctx.postCompletion.resolveReviewerAgent?.(parentRun.agentId as AgentId, projectName) ?? null
      : null

    if (reviewerAgentId == null) {
      if (this.shouldSyncGitArtifacts(worktreePath)) {
        await this.syncGitArtifacts(parentRun.id, worktreePath, tag)
      }
      await this.ctx.postCompletion.onReadyToShip?.(parentRun.id)
      log.info('pipeline', `${tag} no reviewer configured — parent run is ready for ship`)
      return
    }

    const diff = await collectDiff(worktreePath, this.ctx.postCompletion.rebaseBase)
    const verifyOutput = verifiedOutput ?? (verifyCommands.length > 0
      ? (await verifyWorktree(worktreePath, verifyCommands)).output
      : '(no verify commands configured)')
    const reviewPrompt = buildReviewPrompt(originalTask, diff, verifyOutput)

    const reviewName = reviewRound === 1
      ? `review-${originalName}`
      : `review-${originalName}-r${reviewRound}`

    const reviewTaskId = createId<'TaskId'>()
    this.ctx.taskRepo.create({
      id: reviewTaskId,
      specId: parentTask.specId,
      targetId: originalTask.targetId,
      repositoryId: originalTask.repositoryId,
      componentId: originalTask.componentId,
      name: reviewName,
      prompt: reviewPrompt,
      repos: originalTask.repos,
      assignedAgentId: reviewerAgentId,
      requiredRole: 'reviewer',
      complexity: 'simple',
      status: 'ready',
      verification: [],
      retryCount: 0,
      retryAfter: null,
    })

    log.info(
      'pipeline',
      `${tag} review task ${reviewName} (${reviewTaskId.slice(0, 6)}) dispatched to ${reviewerAgentId.slice(0, 6)}`,
    )
    if (parentRun.stage !== 'done' && parentRun.terminalState == null) {
      this.ctx.stateMachine.markDone(
        parentRun.id,
        `Review round ${reviewRound} dispatched to ${reviewerAgentId.slice(0, 6)}`,
      )
      return
    }
    this.ctx.stateMachine.recordStageAdvance(
      parentRun.id,
      parentRun.stage,
      parentRun.stage,
      `Review round ${reviewRound} dispatched to ${reviewerAgentId.slice(0, 6)}`,
    )
  }

  protected async dispatchRebaseFix(
    parentRun: Run,
    parentTask: Task,
    _worktreePath: string,
    base: string,
    rebaseOutput: string,
    tag: string,
  ): Promise<void> {
    const parsed = classifyTask(parentTask)
    const originalName = parsed.kind === 'impl' ? parentTask.name : parsed.originalName
    const tasksInSpec = this.ctx.taskRepo.list(parentTask.specId)
    const originalTask = tasksInSpec.find((t) => t.name === originalName) ?? parentTask

    const chain = this.walkParentChain(parentRun)
    const existingFixCount = chain.filter((r) => {
      const t = this.ctx.taskRepo.get(r.taskId)
      return t != null && classifyTask(t).kind === 'fix'
    }).length
    const round = existingFixCount + 1

    const fixPrompt = buildRebaseFixPrompt(originalTask, base, rebaseOutput)
    const fixTaskId = createId<'TaskId'>()
    this.ctx.taskRepo.create({
      id: fixTaskId,
      specId: parentTask.specId,
      targetId: originalTask.targetId,
      repositoryId: originalTask.repositoryId,
      componentId: originalTask.componentId,
      name: `fix-${originalName}-r${round}`,
      prompt: fixPrompt,
      repos: originalTask.repos,
      assignedAgentId: parentRun.agentId as AgentId,
      requiredRole: 'builder',
      complexity: 'simple',
      status: 'ready',
      verification: [],
      retryCount: 0,
      retryAfter: null,
    })
    log.info('pipeline', `${tag} dispatched fix-${originalName}-r${round} for rebase conflict resolution onto ${base}`)
    this.ctx.stateMachine.recordStageAdvance(
      parentRun.id,
      parentRun.stage,
      parentRun.stage,
      `Rebase onto ${base} failed; fix-${originalName}-r${round} dispatched`,
    )
  }
}
