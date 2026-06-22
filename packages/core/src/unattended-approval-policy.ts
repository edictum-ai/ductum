import type { Evidence, Run } from './types.js'

export interface UnattendedApprovalBudget {
  perRunHardUsd?: number
  perSpecHardUsd?: number
  specCostUsd?: number
}

export interface UnattendedApprovalInput {
  run: Run
  evidence: readonly Evidence[]
  push: boolean
  budget?: UnattendedApprovalBudget
  hasOpenDescendants?: boolean
  gitClean?: boolean
}

export interface UnattendedApprovalDecision {
  allowed: boolean
  reasons: string[]
  recovery: string
}

export function evaluateUnattendedApproval(input: UnattendedApprovalInput): UnattendedApprovalDecision {
  const reasons: string[] = []
  const policy = input.run.runtimeWorkflowProfile?.unattended
  if (policy == null) reasons.push('workflow does not define unattended approval policy')
  else {
    if (!policy.autoApprove) reasons.push('workflow does not allow unattended approval')
    if (!policy.autoMerge) reasons.push('workflow does not allow unattended merge')
    if (input.push && !policy.autoPush) reasons.push('workflow does not allow unattended push')
  }

  if (input.run.stage !== 'ship') reasons.push(`run is in ${input.run.stage}, not ship`)
  for (const stage of ['understand', 'implement']) {
    if (!input.run.completedStages.includes(stage)) reasons.push(`workflow gate ${stage} has not completed`)
  }
  if (!input.run.pendingApproval) reasons.push('run is not waiting for approval')
  if (input.run.terminalState != null) reasons.push(`run is ${input.run.terminalState}`)
  if (input.run.blockedReason != null && input.run.blockedReason.trim() !== '') {
    reasons.push(`run is blocked: ${input.run.blockedReason}`)
  }
  if (input.hasOpenDescendants === true) reasons.push('descendant work is still active')
  if (isBlank(input.run.branch)) reasons.push('run is missing branch')
  if (isBlank(input.run.commitSha)) reasons.push('run is missing commitSha')
  if (input.gitClean !== true) {
    reasons.push(input.gitClean === false ? 'git worktree has uncommitted changes' : 'git clean state is unknown')
  }
  const currentEvidence = currentCommitEvidence(input.run, input.evidence)
  if (!hasVerificationPass(currentEvidence)) reasons.push('structured verification evidence has not passed')
  if (!hasReviewPass(currentEvidence)) reasons.push('valid review/judge result has not passed')
  if (hasStopFlag(input.evidence, 'security')) reasons.push('security flag is present')
  if (hasStopFlag(input.evidence, 'scope')) reasons.push('scope flag is present')
  reasons.push(...budgetReasons(input.run, input.budget))

  if (policy != null && !isValidPushRequirement(policy.pushRequires)) {
    reasons.push('workflow unattended push requirement is invalid')
  }
  if (input.push && policy != null && isValidPushRequirement(policy.pushRequires)) {
    if (policy.pushRequires === 'remote_ci' && !hasRemoteCiPass(currentEvidence)) {
      reasons.push('remote CI is not green')
    } else if (policy.pushRequires === 'local_verify' && !hasVerificationPass(currentEvidence)) {
      reasons.push('workflow local verification substitute is not green')
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    recovery: reasons.length === 0
      ? 'continue'
      : 'Needs Attention: fix the listed blocker, rerun verification/review if needed, then retry unattended approval or use manual approval.',
  }
}

function currentCommitEvidence(run: Pick<Run, 'commitSha' | 'updatedAt'>, evidence: readonly Evidence[]): Evidence[] {
  return evidence.filter((item) => isCurrentCommitEvidence(run, item))
}

function isCurrentCommitEvidence(run: Pick<Run, 'commitSha' | 'updatedAt'>, item: Evidence): boolean {
  const evidenceCommit = evidenceCommitSha(item.payload)
  if (!isBlank(run.commitSha) && evidenceCommit != null) return evidenceCommit === run.commitSha
  if (!isBlank(run.commitSha) && evidenceCommit == null && item.createdAt != null) {
    return Date.parse(item.createdAt) >= Date.parse(run.updatedAt)
  }
  return true
}

function evidenceCommitSha(payload: Record<string, unknown>): string | null {
  for (const key of ['commitSha', 'commit', 'headCommitSha', 'headSha']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

function hasVerificationPass(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => {
    const payload = item.payload
    if ((item.type === 'test' || item.type === 'lint') && payload.passed === true) {
      return true
    }
    if (item.type !== 'custom') return false
    if (payload.kind === 'verify' && payload.passed === true) return true
    if (payload.kind !== 'worktree.snapshot') return false
    const verify = payload.verifyOutput
    return typeof verify === 'object' && verify != null && (verify as { exitCode?: unknown }).exitCode === 0
  })
}

function hasRemoteCiPass(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => item.type === 'ci' && item.payload.passed === true && ciChecksAreStrictlyGreen(item.payload))
}

function ciChecksAreStrictlyGreen(payload: Record<string, unknown>): boolean {
  const checks = payload.checks
  if (!Array.isArray(checks) || checks.length === 0) return false
  return checks.every((check) => {
    if (typeof check !== 'object' || check == null) return false
    const fields = check as { status?: unknown; conclusion?: unknown }
    return fields.status === 'completed' && fields.conclusion === 'success'
  })
}

function hasReviewPass(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => {
    const payload = item.payload
    if (item.type === 'review' && payload.passed === true) return true
    if (item.type !== 'custom' || payload.kind !== 'internal-review') return false
    return payload.passed === true || payload.verdict === 'pass'
  })
}

function hasStopFlag(evidence: readonly Evidence[], flag: 'security' | 'scope'): boolean {
  return evidence.some((item) => {
    const payload = item.payload
    return payload[`${flag}Flag`] === true ||
      payload.kind === `${flag}-flag` ||
      payload.kind === `${flag}_flag` ||
      payload[flag] === 'flagged'
  })
}

function budgetReasons(run: Pick<Run, 'costUsd'>, budget?: UnattendedApprovalBudget): string[] {
  const reasons: string[] = []
  if (budget?.perRunHardUsd != null && run.costUsd >= budget.perRunHardUsd) {
    reasons.push(`run budget overage: $${run.costUsd.toFixed(4)} >= $${budget.perRunHardUsd.toFixed(2)}`)
  }
  if (
    budget?.perSpecHardUsd != null &&
    budget.specCostUsd != null &&
    budget.specCostUsd >= budget.perSpecHardUsd
  ) {
    reasons.push(`spec budget overage: $${budget.specCostUsd.toFixed(4)} >= $${budget.perSpecHardUsd.toFixed(2)}`)
  }
  return reasons
}

function isValidPushRequirement(value: unknown): value is 'remote_ci' | 'local_verify' {
  return value === 'remote_ci' || value === 'local_verify'
}

function isBlank(value: string | null): boolean {
  return value == null || value.trim() === ''
}
