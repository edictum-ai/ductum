import { isAwaitingApproval } from '@/lib/derived-status'
import { statusOf, type RunStatus } from '@/components/signal'
import type { RunType } from './types'

const VISIBLE_DIFF_STATUSES = new Set<RunStatus['kind']>([
  'failed',
  'stalled',
  'running',
  'fixing',
  'reviewing',
  'watching',
])

/** A worktree path is preserved when at least one entry is a non-empty string.
 *  Failed / stalled / running attempts whose `worktreePaths` is null or empty
 *  have no worktree to diff against (issue #211). */
export function hasPreservedWorktree(run: { worktreePaths?: string[] | null }): boolean {
  return Boolean((run.worktreePaths ?? []).some((p) => p != null && p.trim() !== ''))
}

/** Decide whether to fire the /api/runs/:id/diff request for a run.
 *
 *  - Load approval diffs only when a worktree is preserved.
 *  - Otherwise load only when the run-detail page renders the worktree diff
 *    card: failed, stalled, or actively running attempts with a preserved
 *    worktree. Done, cancelled, paused, and blocked attempts should not hit
 *    the expensive git diff route when no diff card is visible.
 */
export function shouldLoadRunDiff(run: RunType): boolean {
  if (!hasPreservedWorktree(run)) return false
  if (isAwaitingApproval(run)) return true
  const status = statusOf(run)
  if (run.blockedReason != null && run.blockedReason.trim() !== '' && status.kind !== 'failed' && status.kind !== 'stalled') return false
  return VISIBLE_DIFF_STATUSES.has(status.kind)
}

/** Explicit operator-facing reason the worktree diff is unavailable, when the
 *  run has no preserved worktree. Returns null when the diff surface should
 *  not be shown at all (e.g. approval or done attempts). */
export function diffUnavailableReason(run: RunType, running: boolean): string | null {
  if (running) {
    return 'No worktree has been preserved for this attempt yet. The diff will appear here once the agent creates its first commit.'
  }
  if (run.terminalState === 'failed' || run.terminalState === 'stalled') {
    return 'No worktree was preserved for this attempt, so worktree changes are not available. The attempt either did not reach a commit or its worktree was cleaned up.'
  }
  return 'No worktree was preserved for this attempt, so worktree changes are not available.'
}
