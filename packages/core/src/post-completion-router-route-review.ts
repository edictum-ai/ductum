import { isBakeoffCandidateTask } from './bakeoff.js'
import { log } from './logger.js'
import {
  buildFixPrompt,
  parseReviewResult,
} from './post-completion.js'
import { PostCompletionFixRouter } from './post-completion-router-route-fix.js'
import { classifyTask } from './task-lineage.js'
import { createId, type AgentId, type Run } from './types.js'

export class PostCompletionReviewRouter extends PostCompletionFixRouter {
  /**
   * Route a completed review back to the run being reviewed.
   * PASS -> advance root impl run to ship.
   * FAIL -> create a fix task targeting the parent run.
   */
  async runReviewCompletion(reviewRun: Run): Promise<void> {
    if (this.ctx.postCompletion == null) return
    const reviewTask = this.ctx.taskRepo.get(reviewRun.taskId)
    if (reviewTask == null) return
    const parsed = classifyTask(reviewTask)
    if (parsed.kind !== 'review') return
    if (this.lineageAlreadyShipped(reviewRun)) {
      log.info('pipeline', `[review:${reviewRun.id.slice(0, 6)}] lineage root already done — closing stale review`)
      this.completeReviewTask(reviewRun, reviewTask, 'lineage already shipped; stale review closed')
      return
    }

    const originalTaskName = parsed.originalName
    const tasksInSpec = this.ctx.taskRepo.list(reviewTask.specId)
    const originalTask = tasksInSpec.find((t) => t.name === originalTaskName)
    if (originalTask == null) return

    const parentRun = reviewRun.parentRunId != null
      ? this.ctx.runRepo.get(reviewRun.parentRunId)
      : this.findMostRecentLineageRun(reviewTask.specId, originalTaskName)
    if (parentRun == null) return

    const completionText = this.ctx.postCompletion.resolveRunCompletionText?.(reviewRun.id) ?? ''
    const review = parseReviewResult(completionText)
    await this.ctx.postCompletion.onReviewResult?.(reviewRun.id, review)
    const rootRun = this.findRootRun(parentRun) ?? parentRun
    const tag = `[review:${reviewRun.id.slice(0, 6)}→${parentRun.id.slice(0, 6)}]`

    if (review.malformed) {
      const reason = this.buildMalformedReviewFailReason(review.feedback, reviewRun, reviewTask)
      if (this.retryMalformedReviewTask(reviewRun, reviewTask, reason)) {
        log.warn('pipeline', `${tag} malformed reviewer completion — retrying review once with strict contract instructions`)
        return
      }
      log.warn('pipeline', `${tag} malformed reviewer completion — marking review failed without routing a code fix`)
      this.failReviewTask(reviewRun, reviewTask, reason)
      return
    }

    if (review.passed) {
      const parentWorktreePath = parentRun.worktreePaths?.[0]
      if (this.shouldSyncGitArtifacts(parentWorktreePath)) {
        await this.syncGitArtifacts(parentRun.id, parentWorktreePath, tag)
        if (rootRun.id !== parentRun.id) {
          await this.syncGitArtifacts(rootRun.id, parentWorktreePath, tag)
        }
      }
      const spec = this.ctx.specRepo.get(originalTask.specId)
      if (isBakeoffCandidateTask(spec, originalTask)) {
        log.info('pipeline', `${tag} PASS — marking bakeoff candidate artifact ready without merge approval`)
        this.completeBakeoffCandidate(
          parentRun,
          rootRun,
          originalTask,
          reviewRun,
          reviewTask,
          `bakeoff candidate reviewed: ${review.feedback.slice(0, 100)}`,
        )
        return
      }
      log.info('pipeline', `${tag} PASS — advancing root ${rootRun.id.slice(0, 6)} to ship`)
      this.reopenRootForSuccessfulReview(rootRun, originalTask, reviewRun, reviewTask, review.feedback)
      await this.ctx.postCompletion.onReadyToShip?.(rootRun.id)
      this.completeSuccessfulFixChain(parentRun, rootRun, `review passed: ${review.feedback.slice(0, 100)}`)
      this.completeReviewTask(reviewRun, reviewTask, 'review passed')
      this.ctx.eventEmitter.emit({
        type: 'run.stage_changed',
        runId: rootRun.id,
        from: rootRun.stage,
        to: 'ship',
        reason: `Review passed: ${review.feedback.slice(0, 100)}`,
      })
      return
    }

    log.info(
      'pipeline',
      `${tag} ${review.verdict.toUpperCase()} — preparing ${review.verdict === 'warn' ? 'warning cleanup' : 'fix'} task`,
    )

    const parentChain = this.walkParentChain(parentRun)
    const fixRunsInChain = parentChain.filter((r) => {
      const t = this.ctx.taskRepo.get(r.taskId)
      return t != null && classifyTask(t).kind === 'fix'
    }).length
    const maxIterations = this.maxFixIterations(parentRun)

    if (fixRunsInChain >= maxIterations) {
      log.warn('pipeline', `${tag} max fix iterations (${maxIterations}) reached — escalating root ${rootRun.id.slice(0, 6)}`)
      const failureReason =
        `max_review_iterations (${maxIterations}) exceeded after ${review.verdict.toUpperCase()}: ${review.feedback.slice(0, 300)}`
      if (rootRun.terminalState == null) {
        this.ctx.stateMachine.markFailed(rootRun.id, failureReason)
      }
      this.cleanupFailedLineage(rootRun, reviewRun, 'done', failureReason, tag)
      return
    }

    const nextFixRound = fixRunsInChain + 1
    const blockingVerdict = review.verdict === 'warn' ? 'warn' : 'fail'
    const fixPrompt = buildFixPrompt(
      originalTask,
      review.feedback,
      nextFixRound,
      blockingVerdict,
    )
    const fixTaskId = createId<'TaskId'>()
    this.ctx.taskRepo.create({
      id: fixTaskId,
      specId: originalTask.specId,
      targetId: originalTask.targetId,
      repositoryId: originalTask.repositoryId,
      componentId: originalTask.componentId,
      name: `fix-${originalTaskName}-r${nextFixRound}`,
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

    log.info(
      'pipeline',
      `${tag} ${review.verdict === 'warn' ? 'warning cleanup' : 'fix'} task ${fixTaskId.slice(0, 6)} created (round ${nextFixRound}/${maxIterations})`,
    )
    this.completeReviewTask(
      reviewRun,
      reviewTask,
      `review ${review.verdict} routed to fix round ${nextFixRound}`,
    )
  }
}
