import type { HarnessSessionResult } from './dispatcher-support.js'
import type { Run } from './types.js'
import type { WorktreeManager } from './worktree.js'

export async function cleanupFailedOwnWorktrees(
  worktreeManager: WorktreeManager | undefined,
  current: Run,
  result: HarnessSessionResult,
): Promise<void> {
  if (worktreeManager == null || current.worktreePaths == null || current.worktreePaths.length === 0) return
  if (result.exitReason === 'paused-max-turns' || result.exitReason === 'paused-cost-budget') return
  if (current.failReason != null && (
    current.failReason.startsWith('cost_budget_paused')
    || current.failReason.startsWith('spec_cost_budget_paused')
    || current.failReason.startsWith('max_turns_paused')
  )) return
  const shouldCleanup =
    (result.exitReason === 'crashed' || result.exitReason === 'timeout')
    && worktreeManager.cleanupOnFailure
    && current.parentRunId == null
  if (!shouldCleanup) return
  for (const wt of current.worktreePaths) {
    await worktreeManager.remove(wt).catch(() => undefined)
  }
}
