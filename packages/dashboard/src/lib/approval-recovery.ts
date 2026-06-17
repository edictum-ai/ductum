/**
 * Helpers for surfacing approval failure recovery guidance to the operator.
 *
 * Scope: pure functions — no React, no API calls.
 * Decision 108: operator-visible state must not lie about live work.
 */

export interface ApprovalFailureInfo {
  runId: string
  message: string
  branch: string | null
  isStale: boolean
}

/**
 * Heuristic: does the failure reason look like a stale-branch / not-mergeable
 * failure that the operator can resolve with a rebase?
 */
export function isStaleError(reason: string): boolean {
  const lower = reason.toLowerCase()
  return (
    lower.includes('stale') ||
    lower.includes('behind') ||
    lower.includes('rebase') ||
    lower.includes('not mergeable') ||
    lower.includes('diverged') ||
    lower.includes('merge conflict') ||
    lower.includes('non-fast-forward') ||
    lower.includes('ahead of')
  )
}

/**
 * Build a structured failure record from a caught approval error and the
 * run's known branch. Branch is taken from the EnrichedRun already in the
 * queue — we do NOT need an extra API call.
 */
export function buildFailureInfo(
  runId: string,
  error: unknown,
  branch: string | null | undefined,
): ApprovalFailureInfo {
  const message =
    error instanceof Error ? error.message : 'Approval failed'
  return {
    runId,
    message,
    branch: branch ?? null,
    isStale: isStaleError(message),
  }
}
