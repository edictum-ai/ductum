import { isBakeoffBlindReviewTask, isBakeoffCandidateTask } from './bakeoff.js'
import { bakeoffWinnerOutcome, resolveBakeoffWinner, type BestOfNVerdict } from './bakeoff-outcomes.js'
import { parseReviewResult } from './post-completion.js'
import { PostCompletionReviewRouter } from './post-completion-router-route-review.js'
import { createId, type BestOfNPolicy, type Run, type Task } from './types.js'

const COST_EPSILON_USD = 0.000001

interface CandidateRun { task: Task; run: Run }

type WinnerSelection = { task: Task; run: Run; policySelected: boolean } | { reason: string }

export class PostCompletionBlindReviewRouter extends PostCompletionReviewRouter {
  async runBlindReviewCompletion(reviewRun: Run): Promise<void> {
    if (this.ctx.postCompletion == null) return
    const reviewTask = this.ctx.taskRepo.get(reviewRun.taskId)
    if (reviewTask == null) return
    const spec = this.ctx.specRepo.get(reviewTask.specId)
    if (!isBakeoffBlindReviewTask(spec, reviewTask)) return

    const completionText = this.ctx.postCompletion.resolveRunCompletionText?.(reviewRun.id) ?? ''
    if (reviewTask.strategyGroup == null || reviewTask.strategyGroup.trim() === '') {
      this.failReviewTask(reviewRun, reviewTask, 'blind review requires a strategy group')
      return
    }
    const strategyGroup = reviewTask.strategyGroup.trim()

    const candidates = this.ctx.taskRepo
      .list(reviewTask.specId)
      .filter((task) => isBakeoffCandidateTask(spec, task) && task.strategyGroup?.trim() === strategyGroup)
    if (candidates.length < 2) {
      this.failReviewTask(reviewRun, reviewTask, 'blind review requires at least two bakeoff candidates')
      return
    }
    const strategyConfig = spec?.strategyConfig?.kind === 'best_of_n' ? spec.strategyConfig : null
    if (strategyConfig?.builderAgentIds.includes(strategyConfig.reviewerAgentId)) {
      this.failReviewTask(reviewRun, reviewTask, 'blind review reviewer agent must differ from every builder agent')
      return
    }

    const winner = resolveBakeoffWinner(completionText, candidates)
    if (winner.task == null) {
      this.failReviewTask(reviewRun, reviewTask, winner.reason ?? 'blind review did not resolve a winner')
      return
    }
    if (winner.verdict == null) {
      this.failReviewTask(reviewRun, reviewTask, 'blind review did not include structured verdict evidence')
      return
    }
    if (winner.task.status !== 'done') {
      this.failReviewTask(reviewRun, reviewTask, `structured verdict winner is not done: ${winner.task.name}`)
      return
    }
    const operatorPolicy = strategyConfig?.policy ?? null
    if (operatorPolicy == null) {
      this.failReviewTask(reviewRun, reviewTask, 'blind review requires Best-of-N spec policy metadata')
      return
    }
    if (winner.verdict.policy !== operatorPolicy) {
      this.failReviewTask(reviewRun, reviewTask, `structured verdict policy mismatch: expected ${operatorPolicy}, got ${winner.verdict.policy}`)
      return
    }
    const parsedReview = parseReviewResult(completionText)
    const review = parsedReview.malformed
      ? { verdict: 'pass' as const, passed: true, feedback: completionText }
      : parsedReview
    await this.ctx.postCompletion.onReviewResult?.(reviewRun.id, review)
    if (review.verdict === 'fail') {
      this.failReviewTask(reviewRun, reviewTask, review.feedback)
      return
    }

    const candidateRuns: Array<{ task: Task; run: Run }> = []
    for (const candidate of candidates) {
      if (!['done', 'failed'].includes(candidate.status)) {
        this.failReviewTask(reviewRun, reviewTask, `candidate ${candidate.name} is not terminal`)
        return
      }
      const run = this.ctx.runRepo.list(candidate.id).at(-1)
      if (run == null) {
        this.failReviewTask(reviewRun, reviewTask, `candidate ${candidate.name} has no run for outcome evidence`)
        return
      }
      candidateRuns.push({ task: candidate, run })
    }

    this.requireEvidenceRepo('bakeoff blind review')
    const acceptedOutcome = bakeoffWinnerOutcome(review.verdict)
    const selection = this.selectWinner(winner.task, winner.verdict, operatorPolicy, candidateRuns)
    if ('reason' in selection) {
      this.failReviewTask(reviewRun, reviewTask, selection.reason)
      return
    }
    const selectedTask = selection.task
    const selectedRun = selection.run

    this.commitAtomically(() => {
      this.createVerdictEvidenceOnce(reviewRun, winner.verdict!)
      this.reopenCandidateForApproval(selectedRun, reviewRun, reviewTask)
    })
    if (!this.isPendingApproval(selectedRun)) {
      try {
        await this.ctx.postCompletion.onReadyToShip?.(selectedRun.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.rollbackApprovalReopenIfStillUnshipped(selectedRun, reviewRun, reviewTask, message)
        this.failReviewTask(reviewRun, reviewTask, `bakeoff winner failed to enter approval flow: ${message}`)
        this.ctx.evaluateTaskDAG?.(reviewTask.specId)
        return
      }
    }
    this.commitAtomically(() => {
      for (const candidate of candidateRuns) {
        const selected = candidate.task.id === selectedTask.id
        this.createCandidateOutcomeEvidenceOnce(candidate.run, {
          kind: 'bakeoff-candidate-outcome',
          outcome: selected ? acceptedOutcome : 'rejected',
          reason: winner.verdict!.reason,
          source: 'blind-review-router',
          blindReviewRunId: reviewRun.id,
          blindReviewTaskId: reviewTask.id,
          winnerTaskName: selectedTask.name,
          winnerTaskId: selectedTask.id,
          judgeWinnerTaskId: winner.task!.id,
          policySelected: selection.policySelected,
        })
      }
      this.completeReviewTask(reviewRun, reviewTask, `blind review selected ${selectedTask.name}`)
    })
    this.ctx.evaluateTaskDAG?.(reviewTask.specId)
  }

  private reopenCandidateForApproval(winnerRun: Run, reviewRun: Run, reviewTask: Task): void {
    const current = this.ctx.runRepo.get(winnerRun.id) ?? winnerRun
    if (current.stage === 'implement' && this.hasWinnerReopenEvidence(current)) {
      this.ctx.runRepo.updateWorkflowState(current.id, {
        blockedReason: null,
        pendingApproval: false,
      })
      return
    }
    if (this.isPendingApproval(current) && this.hasWinnerReopenEvidence(current)) return
    if (current.stage !== 'done') {
      throw new Error(`bakeoff winner approval requires done run stage: ${current.id}`)
    }
    this.ctx.runRepo.updateStage(current.id, 'implement', 'bakeoff winner selected for approval')
    this.ctx.runRepo.updateWorkflowState(current.id, {
      blockedReason: null,
      pendingApproval: false,
    })
    this.ctx.stateMachine.recordStageReset(
      current.id,
      'done',
      'implement',
      `bakeoff blind review ${reviewTask.id.slice(0, 8)} selected this candidate for approval`,
    )
    this.ctx.evidenceRepo?.create({
      id: createId<'EvidenceId'>(),
      runId: current.id,
      type: 'custom',
      payload: {
        kind: 'bakeoff-winner-reopened-for-approval',
        source: 'blind-review-router',
        blindReviewRunId: reviewRun.id,
        blindReviewTaskId: reviewTask.id,
      },
    })
  }

  private selectWinner(
    winnerTask: Task,
    verdict: BestOfNVerdict,
    policy: BestOfNPolicy,
    candidateRuns: CandidateRun[],
  ): WinnerSelection {
    const selected = candidateRuns.find((candidate) => candidate.task.id === winnerTask.id)
    if (selected == null) return { reason: `winner ${winnerTask.name} has no run for approval` }
    if (policy !== 'cheapest-verified-reviewed') {
      if (!this.canRouteToApproval(selected.run)) {
        return { reason: `structured verdict winner run is not done: ${winnerTask.name}` }
      }
      return { task: selected.task, run: selected.run, policySelected: false }
    }

    const passed = candidateRuns
      .filter((candidate) => candidate.task.status === 'done')
      .filter((candidate) => verdict.scores.some((score) => score.taskId === candidate.task.id && score.passed))
    if (passed.length === 0) return { reason: 'cheapest-verified-reviewed requires at least one passed candidate' }
    const incomplete = passed.find((candidate) => !this.canRouteToApproval(candidate.run))
    if (incomplete != null) {
      return { reason: `passed candidate run is not done: ${incomplete.task.name}` }
    }
    const unknownCost = passed.find((candidate) => !Number.isFinite(candidate.run.costUsd) || candidate.run.costUsd <= 0)
    if (unknownCost != null) {
      return { reason: `cheapest-verified-reviewed requires known recorded cost for candidate: ${unknownCost.task.name}` }
    }

    const cheapestCost = Math.min(...passed.map((candidate) => candidate.run.costUsd))
    const cheapest = passed.filter((candidate) => candidate.run.costUsd <= cheapestCost + COST_EPSILON_USD)
    const selectedCheapest = cheapest.find((candidate) => candidate.task.id === winnerTask.id) ?? cheapest[0]
    if (selectedCheapest == null) return { reason: 'cheapest-verified-reviewed could not select a winner' }
    return {
      task: selectedCheapest.task,
      run: selectedCheapest.run,
      policySelected: selectedCheapest.task.id !== winnerTask.id,
    }
  }

  private canRouteToApproval(run: Run): boolean {
    return run.stage === 'done'
      || (run.stage === 'implement' && this.hasWinnerReopenEvidence(run))
      || (this.isPendingApproval(run) && this.hasWinnerReopenEvidence(run))
  }

  private isPendingApproval(run: Run): boolean {
    const current = this.ctx.runRepo.get(run.id) ?? run
    return current.stage === 'ship' && current.pendingApproval
  }

  private hasWinnerReopenEvidence(run: Run): boolean {
    return this.ctx.evidenceRepo
      ?.list(run.id)
      .some((item) => item.payload.kind === 'bakeoff-winner-reopened-for-approval') === true
  }

  private rollbackApprovalReopenIfStillUnshipped(
    winnerRun: Run,
    reviewRun: Run,
    reviewTask: Task,
    reason: string,
  ): void {
    const current = this.ctx.runRepo.get(winnerRun.id) ?? winnerRun
    const reachedApproval = current.stage === 'ship' && current.pendingApproval
    if (reachedApproval) return
    this.commitAtomically(() => {
      const latest = this.ctx.runRepo.get(winnerRun.id) ?? current
      if (latest.stage === 'implement' && !latest.pendingApproval && this.hasWinnerReopenEvidence(latest)) {
        this.ctx.runRepo.updateStage(latest.id, 'done', 'bakeoff winner approval entry failed')
        this.ctx.runRepo.updateWorkflowState(latest.id, {
          blockedReason: null,
          pendingApproval: false,
        })
        this.ctx.stateMachine.recordStageReset(
          latest.id,
          'implement',
          'done',
          `bakeoff blind review ${reviewTask.id.slice(0, 8)} failed to enter approval`,
        )
      }
      this.ctx.evidenceRepo?.create({
        id: createId<'EvidenceId'>(),
        runId: latest.id,
        type: 'custom',
        payload: {
          kind: 'bakeoff-ready-to-ship-failed',
          source: 'blind-review-router',
          blindReviewRunId: reviewRun.id,
          blindReviewTaskId: reviewTask.id,
          reason,
        },
      })
    })
  }

  private createCandidateOutcomeEvidenceOnce(run: Run, payload: Record<string, unknown>): void {
    const exists = this.ctx.evidenceRepo
      ?.list(run.id)
      .some((item) =>
        item.payload.kind === 'bakeoff-candidate-outcome'
        && item.payload.blindReviewTaskId === payload.blindReviewTaskId
        && item.payload.winnerTaskId === payload.winnerTaskId
        && item.payload.outcome === payload.outcome)
    if (exists) return
    this.ctx.evidenceRepo?.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload,
    })
  }

  private createVerdictEvidenceOnce(run: Run, verdict: BestOfNVerdict): void {
    const exists = this.ctx.evidenceRepo
      ?.list(run.id)
      .some((item) =>
        item.payload.kind === 'best-of-n-verdict'
        && item.payload.winnerTaskId === verdict.winnerTaskId
        && item.payload.policy === verdict.policy
        && Array.isArray(item.payload.scores))
    if (exists) return
    this.ctx.evidenceRepo?.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { ...verdict },
    })
  }
}
