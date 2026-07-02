import { collectProtectedWorktreeShortIds } from './dispatcher-resume.js'
import { log } from './logger.js'
import type { RunCheckpointRepo, RunRepo, TaskRepo } from './repos/interfaces.js'
import type { WorktreeCleanupOptions, WorktreeManager } from './worktree.js'

export async function cleanupStaleWorktreesForDispatcher(
  worktreeManager: WorktreeManager | undefined,
  runRepo: RunRepo,
  taskRepo: TaskRepo,
  runCheckpointRepo: RunCheckpointRepo | undefined,
  options: WorktreeCleanupOptions = {},
): Promise<number> {
  if (worktreeManager == null) return 0
  try {
    const protectedShortIds = collectProtectedWorktreeShortIds(runRepo, taskRepo, runCheckpointRepo)
    const removed = await worktreeManager.cleanupStale(protectedShortIds, options)
    if (removed > 0) log.info('dispatcher', `cleaned up ${removed} stale worktree(s)${options.force ? ' (forced)' : ''}`)
    return removed
  } catch (error) {
    log.warn('dispatcher', `stale worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    if (options.strict === true) throw error
    return 0
  }
}
