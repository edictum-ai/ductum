import { log } from './logger.js'
import {
  rebaseWorktreeOntoBase,
  verifyWorktree,
  type VerifyResult,
} from './post-completion.js'
import { PostCompletionVerificationFixRouter } from './post-completion-router-verification-fix.js'
import type { Run } from './types.js'

export class PostCompletionImplRouter extends PostCompletionVerificationFixRouter {
  /**
   * Post-completion pipeline for an IMPLEMENTATION run:
   * rebase onto base, verify build+tests in the worktree, then
   * dispatch a fresh review run.
   */
  async runImplCompletion(run: Run): Promise<void> {
    if (this.ctx.postCompletion == null) return
    if (this.lineageAlreadyShipped(run)) {
      log.info('pipeline', `[pipeline:${run.id.slice(0, 6)}] lineage root already done — skipping post-completion`)
      return
    }
    const task = this.ctx.taskRepo.get(run.taskId)
    if (task == null) return
    const worktreePath = run.worktreePaths?.[0]
    if (worktreePath == null) {
      // Issue #245 (P1TqLlKzD7-F): a run that recorded a completion
      // summary and linked branch/commit but had no worktree on record
      // used to silently fall through routeCompletedRun and stay Active
      // forever. Fail closed so the operator sees a Needs Attention row
      // with a recoverable reason and a path forward; never ghost the
      // run as a live Active Attempt.
      this.failClosedMissingWorktree(run)
      return
    }

    const projectName = this.resolveProjectName(task)
    const tag = `[pipeline:${run.id.slice(0, 6)}]`
    const verifyCommands = this.resolveVerifyCommands(projectName, task, run, tag)

    if (!await this.finalizeDirtyWorktree(run.id, worktreePath, task.name, tag)) return

    const rebaseBase = this.ctx.postCompletion.rebaseBase
    if (rebaseBase != null && rebaseBase !== '') {
      const rebaseResult = await rebaseWorktreeOntoBase(worktreePath, rebaseBase)
      if (rebaseResult.needed && !rebaseResult.rebased) {
        log.warn('pipeline', `${tag} rebase onto ${rebaseBase} failed — escalating to fix task`)
        await this.dispatchRebaseFix(run, task, worktreePath, rebaseBase, rebaseResult.output, tag)
        return
      }
      if (rebaseResult.needed) {
        log.info('pipeline', `${tag} rebased worktree onto ${rebaseBase}`)
      }
    }
    if (this.shouldSyncGitArtifacts(worktreePath)) {
      await this.syncGitArtifacts(run.id, worktreePath, tag)
    }

    let verifySnapshot: VerifyResult | null = null
    let snapshot = null
    if (verifyCommands.length > 0) {
      log.info('pipeline', `${tag} verifying: ${verifyCommands.join(' && ')}`)
      const verifyResult = await verifyWorktree(worktreePath, verifyCommands)
      verifySnapshot = verifyResult
      await this.ctx.postCompletion.onVerificationResult?.(run.id, verifyResult)

      if (!verifyResult.passed) {
        if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
          if (await this.failIfDirtyTrackedWorktree(run.id, worktreePath, tag)) return
          snapshot = await this.recordWorktreeSnapshot(run.id, worktreePath, verifyCommands, verifySnapshot, tag)
        }
        log.warn('pipeline', `${tag} verification failed — dispatching fix task`)
        this.dispatchVerificationFix(run, task, verifyCommands, verifyResult.output, tag)
        return
      }
      log.info('pipeline', `${tag} verification passed`)
    }

    if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
      if (await this.failIfDirtyTrackedWorktree(run.id, worktreePath, tag)) return
      snapshot = await this.recordWorktreeSnapshot(run.id, worktreePath, verifyCommands, verifySnapshot, tag)
    }
    if (this.failIfZeroDiffSnapshot(run, snapshot, tag, 'implementation')) return
    await this.dispatchReview(run, task, worktreePath, verifyCommands, 1, tag)
  }

  protected failIfZeroDiffSnapshot(
    run: Run,
    snapshot: { diffStat: { filesChanged: number; insertions: number; deletions: number } } | null,
    tag: string,
    kind: 'implementation' | 'fix',
  ): boolean {
    if (snapshot == null) return false
    if (snapshot.diffStat.filesChanged !== 0 || snapshot.diffStat.insertions !== 0 || snapshot.diffStat.deletions !== 0) return false
    const reason = `${kind} completed with zero diff; normal ${kind} tasks must change files`
    this.ctx.stateMachine.markFailed(run.id, reason)
    log.warn('pipeline', `${tag} ${reason}`)
    return true
  }

  /**
   * Issue #245: fail closed when a completion has no worktree to verify or
   * review. Branch/commit evidence alone is insufficient — Ductum cannot
   * re-run verification, snapshot a diff, or dispatch a reviewer without a
   * worktree path. Mark recoverable so the operator can retry from a
   * worktree-bearing attempt rather than losing the lineage.
   */
  private failClosedMissingWorktree(run: Run): void {
    const tag = `[pipeline:${run.id.slice(0, 6)}]`
    const hasEvidence = (run.completionSummary?.trim().length ?? 0) > 0
      || (run.branch != null && run.branch !== '')
      || (run.commitSha != null && run.commitSha !== '')
    const reason = hasEvidence
      ? 'implementation_completed_without_worktree: completion recorded branch/commit evidence but no worktree is on record; cannot verify, snapshot, or dispatch review'
      : 'implementation_completed_without_worktree: no worktree, branch, or commit evidence; nothing to verify or review'
    this.ctx.stateMachine.markFailed(run.id, reason)
    this.ctx.runRepo.updateFailure(run.id, reason, true)
    log.warn('pipeline', `${tag} ${reason}`)
  }
}
