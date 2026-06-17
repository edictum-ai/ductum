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
    if (worktreePath == null) return

    const projectName = this.resolveProjectName(task)
    const tag = `[pipeline:${run.id.slice(0, 6)}]`
    const verifyCommands = this.resolveVerifyCommands(projectName, run, tag)

    await this.finalizeDirtyWorktree(worktreePath, task.name, tag)

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
    if (verifyCommands.length > 0) {
      log.info('pipeline', `${tag} verifying: ${verifyCommands.join(' && ')}`)
      const verifyResult = await verifyWorktree(worktreePath, verifyCommands)
      verifySnapshot = verifyResult
      await this.ctx.postCompletion.onVerificationResult?.(run.id, verifyResult)

      if (!verifyResult.passed) {
        if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
          await this.recordWorktreeSnapshot(run.id, worktreePath, verifyCommands, verifySnapshot, tag)
        }
        log.warn('pipeline', `${tag} verification failed — dispatching fix task`)
        this.dispatchVerificationFix(run, task, verifyCommands, verifyResult.output, tag)
        return
      }
      log.info('pipeline', `${tag} verification passed`)
    }

    if (this.shouldRecordWorktreeSnapshot(worktreePath)) {
      await this.recordWorktreeSnapshot(run.id, worktreePath, verifyCommands, verifySnapshot, tag)
    }
    await this.dispatchReview(run, task, worktreePath, verifyCommands, 1, tag)
  }
}
