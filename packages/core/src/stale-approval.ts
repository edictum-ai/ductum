import type { Run } from './types.js'

const STALE_APPROVAL_REASON = /(?:^merge failed:\s*)?merge approval blocked: branch "([^"]+)" does not contain current ([^;]+)(?:;|$)/

export interface StaleApprovalDetails {
  branch: string
  base: string
}

export function buildStaleApprovalFailureReason(branch: string, base: string): string {
  return `merge approval blocked: branch "${branch}" does not contain current ${base}; deny this approval, then retry the run after rebasing and re-running verification before approval`
}

export function parseStaleApprovalFailureReason(reason: string | null | undefined): StaleApprovalDetails | null {
  if (reason == null) return null
  const match = STALE_APPROVAL_REASON.exec(reason)
  if (match == null) return null
  const branch = match[1]?.trim()
  const base = match[2]?.trim()
  if (!branch || !base) return null
  return { branch, base }
}

export function isStaleApprovalFailureReason(reason: string | null | undefined): boolean {
  return parseStaleApprovalFailureReason(reason) != null
}

export function buildStaleApprovalDenyReason(details?: Partial<StaleApprovalDetails>): string {
  const branch = details?.branch?.trim()
  const base = details?.base?.trim()
  if (branch && base) return `stale approval: branch ${branch} no longer contains current ${base}`
  if (branch) return `stale approval: branch ${branch} no longer contains current base branch`
  if (base) return `stale approval: branch no longer contains current ${base}`
  return 'stale approval: branch no longer contains current base branch'
}

export function isStaleApprovalRun(
  run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval' | 'failReason'>,
): boolean {
  return run.stage === 'ship'
    && run.pendingApproval
    && run.terminalState == null
    && isStaleApprovalFailureReason(run.failReason)
}
