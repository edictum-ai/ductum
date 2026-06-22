import { PostCompletionRouterBase } from './post-completion-router-base.js'
import type { RouterDispatchIntent } from './post-completion-router-types.js'
import { classifyTask } from './task-lineage.js'
import type { Run, SpecId, Task } from './types.js'

export class PostCompletionLineageRouter extends PostCompletionRouterBase {
  /**
   * Resolve dispatch options from the task name.
   * - fix-* -> parent = most recent impl/fix run, reuse its worktree
   * - review-* -> parent = same, reuse its worktree so the reviewer sees
   *   the actual implementation state by default
   * - impl -> no parent, fresh worktree
   */
  resolveDispatchIntent(task: Task): RouterDispatchIntent {
    const parsed = classifyTask(task)
    if (parsed.kind === 'impl') return {}

    const parent = this.findMostRecentLineageRun(task.specId, parsed.originalName)
    if (parent == null) return {}
    const worktreeSource = this.findMostRecentLineageRunWithOptions(task.specId, parsed.originalName, {
      requireWorktree: true,
    })

    return {
      parentRunId: parent.id,
      ...(worktreeSource == null ? {} : { reuseWorktreeFromRunId: worktreeSource.id }),
    }
  }

  /** Walk the parentRunId chain, newest first. */
  walkParentChain(run: Run): Run[] {
    const chain: Run[] = [run]
    let current: Run = run
    while (current.parentRunId != null) {
      const parent = this.ctx.runRepo.get(current.parentRunId)
      if (parent == null) break
      chain.push(parent)
      current = parent
    }
    return chain
  }

  /** Find the root of a parent chain (the implementation run). */
  findRootRun(run: Run): Run | null {
    const chain = this.walkParentChain(run)
    return chain[chain.length - 1] ?? null
  }

  /**
   * For a fix or review task targeting `originalName`, find the most
   * recent run across the impl task and any previous fix rounds.
   */
  findMostRecentLineageRun(specId: SpecId, originalName: string): Run | null {
    return this.findMostRecentLineageRunWithOptions(specId, originalName, {})
  }

  protected findMostRecentLineageRunWithOptions(
    specId: SpecId,
    originalName: string,
    options: { requireWorktree?: boolean },
  ): Run | null {
    const tasksInSpec = this.ctx.taskRepo.list(specId)
    const lineageTasks = tasksInSpec.filter((t) => {
      if (t.name === originalName) return true
      const p = classifyTask(t)
      return p.kind === 'fix' && p.originalName === originalName
    })
    let latest: { run: Run; order: number } | null = null
    let order = 0

    for (const task of lineageTasks) {
      for (const run of this.ctx.runRepo.list(task.id)) {
        if (options.requireWorktree === true && (run.worktreePaths == null || run.worktreePaths.length === 0)) {
          continue
        }
        const candidate = { run, order }
        order += 1
        if (latest == null || this.compareRunRecency(candidate, latest) > 0) {
          latest = candidate
        }
      }
    }

    return latest?.run ?? null
  }

  /**
   * Returns true if the lineage root for this run is already at
   * stage=done and its task is also done (the user has approved + merged it).
   *
   * Implementation runs are also marked stage=done after review dispatch so
   * they stop consuming a live slot. That is not "shipped" while the root task
   * remains active; downstream review/fix routing must still run.
   */
  protected lineageAlreadyShipped(run: Run): boolean {
    const root = this.findRootRun(run)
    if (root == null) return false
    if (root.terminalState != null) return false
    if (root.stage !== 'done') return false
    return this.ctx.taskRepo.get(root.taskId)?.status === 'done'
  }
}
