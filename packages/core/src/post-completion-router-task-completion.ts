import { closeFailedLineageDescendants } from './failed-lineage-cleanup.js'
import { log } from './logger.js'
import { PostCompletionLineageRouter } from './post-completion-router-lineage.js'
import type { EvidenceRepo } from './repos/interfaces.js'
import { STRUCTURED_REVIEW_CONTRACT_RULE } from './structured-review-contract.js'
import type { Run, Task } from './types.js'
import { createId } from './types.js'

export class PostCompletionTaskCompletionRouter extends PostCompletionLineageRouter {
  protected completeSuccessfulFixChain(parentRun: Run, rootRun: Run, reason: string): void {
    for (const run of this.walkParentChain(parentRun)) {
      if (run.id === rootRun.id) continue
      if (this.ctx.hasLiveSession?.(run.id) === true) continue
      if (run.terminalState == null && run.stage !== 'done') {
        this.ctx.stateMachine.markDone(run.id, reason)
      }
      const task = this.ctx.taskRepo.get(run.taskId)
      if (task == null || task.status === 'done') continue
      this.ctx.taskRepo.updateStatus(task.id, 'done')
      this.ctx.eventEmitter.emit({
        type: 'task.status_changed',
        taskId: task.id,
        from: task.status,
        to: 'done',
      })
    }
  }

  protected reopenRootForSuccessfulReview(
    rootRun: Run,
    originalTask: Task,
    reviewRun: Run,
    reviewTask: Task,
    feedback: string,
  ): void {
    const needsRunReopen = rootRun.terminalState != null || rootRun.failReason != null || !rootRun.recoverable
    if (needsRunReopen) {
      this.ctx.runRepo.updateTerminalState(rootRun.id, null)
      this.ctx.runRepo.updateFailure(rootRun.id, null, true)
      this.ctx.runRepo.updateWorkflowState(rootRun.id, {
        blockedReason: null,
        pendingApproval: false,
      })
      this.ctx.evidenceRepo?.create({
        id: createId<'EvidenceId'>(),
        runId: rootRun.id,
        type: 'custom',
        payload: {
          kind: 'post-completion-root-reopened',
          reason: 'review passed after a failed root state',
          feedback: feedback.slice(0, 1_000),
          source: 'post-completion-router',
          reviewRunId: reviewRun.id,
          reviewTaskId: reviewTask.id,
          before: {
            terminalState: rootRun.terminalState,
            failReason: rootRun.failReason,
            recoverable: rootRun.recoverable,
          },
          after: {
            terminalState: null,
            failReason: null,
            recoverable: true,
          },
        },
      })
    }

    if (rootRun.stage === 'done' && originalTask.status !== 'done') {
      this.ctx.runRepo.updateStage(rootRun.id, 'ship')
      this.ctx.stateMachine.recordStageReset(
        rootRun.id,
        'done',
        'ship',
        `review passed; reopening root for approval: ${feedback.slice(0, 100)}`,
      )
    }

    if (originalTask.status === 'failed') {
      this.ctx.taskRepo.updateStatus(originalTask.id, 'active')
      this.ctx.eventEmitter.emit({
        type: 'task.status_changed',
        taskId: originalTask.id,
        from: 'failed',
        to: 'active',
      })
    }
  }

  protected completeReviewTask(reviewRun: Run, reviewTask: Task, reason: string): void {
    this.completeLineageTask(reviewRun, reviewTask, reason)
  }

  protected completeLineageTask(run: Run, task: Task, reason: string): void {
    if (run.terminalState == null && run.stage !== 'done') {
      this.ctx.stateMachine.markDone(run.id, reason)
    }
    if (task.status === 'done') return
    this.ctx.taskRepo.updateStatus(task.id, 'done')
    this.ctx.eventEmitter.emit({
      type: 'task.status_changed',
      taskId: task.id,
      from: task.status,
      to: 'done',
    })
  }

  protected completeBakeoffCandidate(
    parentRun: Run,
    rootRun: Run,
    candidateTask: Task,
    reviewRun: Run,
    reviewTask: Task,
    reason: string,
  ): void {
    const evidenceRepo = this.requireEvidenceRepo('bakeoff candidate completion')
    this.commitAtomically(() => {
      if (rootRun.terminalState == null && rootRun.stage !== 'done') {
        this.ctx.stateMachine.markDone(rootRun.id, reason)
      }
      if (candidateTask.status !== 'done') {
        this.ctx.taskRepo.updateStatus(candidateTask.id, 'done')
        this.ctx.eventEmitter.emit({
          type: 'task.status_changed',
          taskId: candidateTask.id,
          from: candidateTask.status,
          to: 'done',
        })
      }
      evidenceRepo.create({
        id: createId<'EvidenceId'>(),
        runId: rootRun.id,
        type: 'custom',
        payload: {
          kind: 'bakeoff-candidate-outcome',
          outcome: 'fixed',
          reason,
          source: 'post-completion-router',
          reviewRunId: reviewRun.id,
          reviewTaskId: reviewTask.id,
        },
      })
      this.completeSuccessfulFixChain(parentRun, rootRun, reason)
      this.completeReviewTask(reviewRun, reviewTask, 'bakeoff candidate reviewed')
    })
    this.ctx.evaluateTaskDAG?.(candidateTask.specId)
  }

  protected commitAtomically<T>(fn: () => T): T {
    return this.ctx.transaction == null ? fn() : this.ctx.transaction(fn)
  }

  protected requireEvidenceRepo(context: string): EvidenceRepo {
    if (this.ctx.evidenceRepo == null) {
      throw new Error(`${context} requires an evidence repository`)
    }
    return this.ctx.evidenceRepo
  }

  protected failReviewTask(reviewRun: Run, reviewTask: Task, reason: string): void {
    if (reviewRun.terminalState == null) {
      this.ctx.stateMachine.markFailed(reviewRun.id, reason)
    }
    if (reviewTask.status !== 'failed') {
      this.ctx.taskRepo.updateStatus(reviewTask.id, 'failed')
      this.ctx.eventEmitter.emit({
        type: 'task.status_changed',
        taskId: reviewTask.id,
        from: reviewTask.status,
        to: 'failed',
      })
    }
    this.ctx.evaluateTaskDAG?.(reviewTask.specId)
  }

  protected failReviewRun(reviewRun: Run, reason: string): void {
    if (reviewRun.terminalState == null) {
      this.ctx.stateMachine.markFailed(reviewRun.id, reason)
    }
  }

  protected failReviewRouting(
    reviewRun: Run,
    reviewTask: Task | null,
    reason: string,
  ): void {
    if (reviewTask == null) {
      this.failReviewRun(reviewRun, reason)
      return
    }
    this.failReviewTask(reviewRun, reviewTask, reason)
  }

  protected retryMalformedReviewTask(reviewRun: Run, reviewTask: Task, reason: string): boolean {
    if (reviewTask.retryCount >= 1) return false
    if (reviewRun.terminalState == null) {
      this.ctx.stateMachine.markFailed(reviewRun.id, reason)
    }
    this.ctx.taskRepo.updateRetry(reviewTask.id, reviewTask.retryCount + 1, null)
    this.ctx.taskRepo.updatePrompt(reviewTask.id, this.buildStrictReviewRetryPrompt(reviewTask.prompt, reason))
    if (reviewTask.status !== 'ready') {
      this.ctx.taskRepo.updateStatus(reviewTask.id, 'ready')
      this.ctx.eventEmitter.emit({
        type: 'task.status_changed',
        taskId: reviewTask.id,
        from: reviewTask.status,
        to: 'ready',
      })
    }
    this.ctx.evaluateTaskDAG?.(reviewTask.specId)
    return true
  }

  protected buildMalformedReviewFailReason(
    parseFeedback: string,
    reviewRun: Run,
    reviewTask: Task,
  ): string {
    return [
      parseFeedback,
      '',
      'Recovery:',
      `- Retry this review run: \`node packages/cli/dist/index.js retry ${reviewRun.id}\``,
      `- Or close it and dispatch a fresh review task: \`node packages/cli/dist/index.js run ${reviewTask.name} --agent <reviewer>\``,
      '- Reviewer agent must call `ductum_complete` with exactly one `ductum-review-result` JSON object.',
      STRUCTURED_REVIEW_CONTRACT_RULE,
    ].join('\n')
  }

  private buildStrictReviewRetryPrompt(currentPrompt: string, reason: string): string {
    return [
      currentPrompt,
      '',
      '## Previous Malformed Review Completion',
      'Ductum rejected the previous review completion before routing a verdict.',
      '',
      reason,
      '',
      'For this retry, call `ductum_complete` with exactly one JSON object matching the contract below.',
      STRUCTURED_REVIEW_CONTRACT_RULE,
      'Do not emit prose-only PASS/WARN/FAIL or a second alternate verdict.',
    ].filter((line) => line.trim() !== '').join('\n')
  }


  protected cleanupFailedLineage(
    rootRun: Run,
    currentRun: Run,
    currentRunDisposition: 'done' | 'failed',
    reason: string,
    tag: string,
  ): void {
    const result = closeFailedLineageDescendants(this.ctx, {
      rootRun,
      currentRun,
      currentRunDisposition,
      reason,
    })
    if (result.closedRunIds.length === 0 && result.closedTaskIds.length === 0) return
    log.info(
      'pipeline',
      `${tag} closed ${result.closedRunIds.length} lineage run(s) and ${result.closedTaskIds.length} task(s)` +
      (result.skippedLiveRunIds.length === 0 ? '' : `, skipped ${result.skippedLiveRunIds.length} live run(s)`),
    )
  }
}
