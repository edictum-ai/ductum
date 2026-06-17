import { closeFailedLineageDescendants } from './failed-lineage-cleanup.js'
import { log } from './logger.js'
import { PostCompletionLineageRouter } from './post-completion-router-lineage.js'
import type { EvidenceRepo } from './repos/interfaces.js'
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
    if (reviewRun.stage !== 'done') {
      this.ctx.stateMachine.markDone(reviewRun.id, reason)
    }
    if (reviewTask.status === 'done') return
    this.ctx.taskRepo.updateStatus(reviewTask.id, 'done')
    this.ctx.eventEmitter.emit({
      type: 'task.status_changed',
      taskId: reviewTask.id,
      from: reviewTask.status,
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
    if (reviewTask.status === 'failed') return
    this.ctx.taskRepo.updateStatus(reviewTask.id, 'failed')
    this.ctx.eventEmitter.emit({
      type: 'task.status_changed',
      taskId: reviewTask.id,
      from: reviewTask.status,
      to: 'failed',
    })
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
      '- Reviewer agent must end its `ductum_complete` result with a single terminal line: PASS, WARN, or FAIL (optionally followed by ": <feedback>"). Verdicts mixed into prose are rejected.',
    ].join('\n')
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
