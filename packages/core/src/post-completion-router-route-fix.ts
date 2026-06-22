import { log } from './logger.js'
import { verifyWorktree, type VerifyResult } from './post-completion.js'
import { PostCompletionImplRouter } from './post-completion-router-route-impl.js'
import { classifyTask } from './task-lineage.js'
import type { Run } from './types.js'

export class PostCompletionFixRouter extends PostCompletionImplRouter {
  /**
   * Handle completion of a fix run. Fix output is NEVER parsed as a verdict.
   */
  async runFixCompletion(fixRun: Run): Promise<void> {
    if (this.ctx.postCompletion == null) return
    const fixTask = this.ctx.taskRepo.get(fixRun.taskId)
    if (fixTask == null) return
    const parsed = classifyTask(fixTask)
    if (parsed.kind !== 'fix') return
    if (this.lineageAlreadyShipped(fixRun)) {
      log.info('pipeline', `[fix:${fixRun.id.slice(0, 6)}] lineage root already done — closing stale fix`)
      this.completeLineageTask(fixRun, fixTask, 'lineage already shipped; stale fix closed')
      return
    }

    const worktreePath = fixRun.worktreePaths?.[0]
    if (worktreePath == null) {
      log.warn('pipeline', `[fix:${fixRun.id.slice(0, 6)}] no worktree inherited — cannot verify fix`)
      return
    }

    const tag = `[fix:${fixRun.id.slice(0, 6)}]`
    const projectName = this.resolveProjectName(fixTask)
    const verifyCommands = this.resolveVerifyCommands(projectName, fixRun, tag)

    await this.finalizeDirtyWorktree(worktreePath, fixTask.name, tag)
    if (this.shouldSyncGitArtifacts(worktreePath)) {
      await this.syncGitArtifacts(fixRun.id, worktreePath, tag)
    }

    if (verifyCommands.length > 0) {
      log.info('pipeline', `${tag} verifying fix: ${verifyCommands.join(' && ')}`)
      const verifyResult = await verifyWorktree(worktreePath, verifyCommands)
      await this.ctx.postCompletion.onVerificationResult?.(fixRun.id, verifyResult)
      let verifiedOutput = verifyResult.output
      let snapshotResult = verifyResult

      if (!verifyResult.passed) {
        if (this.canRetryFinalFixVerify(fixRun, parsed.round)) {
          const retryResult = await this.retryFinalFixVerify(fixRun, worktreePath, verifyCommands, tag)
          snapshotResult = retryResult
          if (retryResult.passed) {
            log.info('pipeline', `${tag} fix verification passed after retry`)
            verifiedOutput = retryResult.output
          } else {
            if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
              await this.recordWorktreeSnapshot(fixRun.id, worktreePath, verifyCommands, snapshotResult, tag)
            }
            log.warn('pipeline', `${tag} final fix verification retry failed — escalating`)
            this.dispatchVerificationFix(fixRun, fixTask, verifyCommands, retryResult.output, tag)
            return
          }
        } else {
          if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
            await this.recordWorktreeSnapshot(fixRun.id, worktreePath, verifyCommands, snapshotResult, tag)
          }
          log.warn('pipeline', `${tag} fix verification failed — dispatching another fix task`)
          this.dispatchVerificationFix(fixRun, fixTask, verifyCommands, verifyResult.output, tag)
          return
        }
      }
      if (verifyResult.passed) log.info('pipeline', `${tag} fix verification passed`)
      if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
        await this.recordWorktreeSnapshot(fixRun.id, worktreePath, verifyCommands, snapshotResult, tag)
      }
      await this.dispatchReview(fixRun, fixTask, worktreePath, verifyCommands, parsed.round + 1, tag, verifiedOutput)
      this.completeLineageTask(fixRun, fixTask, 'fix completed; review dispatched')
      return
    }

    if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
      await this.recordWorktreeSnapshot(fixRun.id, worktreePath, verifyCommands, null, tag)
    }
    await this.dispatchReview(fixRun, fixTask, worktreePath, verifyCommands, parsed.round + 1, tag)
    this.completeLineageTask(fixRun, fixTask, 'fix completed; review dispatched')
  }

  private canRetryFinalFixVerify(fixRun: Run, fixRound: number): boolean {
    if (fixRound < this.maxFixIterations(fixRun)) return false
    const current = this.ctx.runRepo.get(fixRun.id) ?? fixRun
    return current.verifyRetries === 0
  }

  private async retryFinalFixVerify(
    fixRun: Run,
    worktreePath: string,
    verifyCommands: string[],
    tag: string,
  ): Promise<VerifyResult> {
    this.ctx.runRepo.incrementVerifyRetries(fixRun.id)
    log.warn('pipeline', `${tag} final fix verification failed — retrying once`)
    const retryResult = await verifyWorktree(worktreePath, verifyCommands)
    await this.ctx.postCompletion?.onVerificationResult?.(fixRun.id, retryResult)
    return retryResult
  }
}
