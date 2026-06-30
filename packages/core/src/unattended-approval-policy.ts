import type { Evidence, Run } from './types.js'
import { isTrustedEvidencePayload } from './evidence-provenance.js'
import { ciEvidenceHasStrictPass } from './strict-ci.js'

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

export const UNATTENDED_APPROVAL_BLOCKED_PREFIX = 'Action Needed: unattended approval blocked:'

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
  if (
    input.run.blockedReason != null &&
    input.run.blockedReason.trim() !== '' &&
    !isUnattendedApprovalBlockedReason(input.run.blockedReason)
  ) {
    reasons.push(`run is blocked: ${input.run.blockedReason}`)
  }
  if (input.hasOpenDescendants === true) reasons.push('descendant work is still active')
  if (isBlank(input.run.branch)) reasons.push('run is missing branch')
  if (isBlank(input.run.commitSha)) reasons.push('run is missing commitSha')
  if (input.gitClean !== true) {
    reasons.push(input.gitClean === false ? 'git worktree has uncommitted changes' : 'git clean state is unknown')
  }
  const currentEvidence = currentCommitEvidenceForRun(input.run, input.evidence)
  reasons.push(...untrustedSuccessfulGateReasons(currentEvidence))
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
      : buildRecovery(reasons),
  }
}

export function isUnattendedApprovalBlockedReason(reason: string | null | undefined): boolean {
  return reason?.trim().startsWith(UNATTENDED_APPROVAL_BLOCKED_PREFIX) === true
}

export function currentCommitEvidenceForRun(
  run: Pick<Run, 'commitSha' | 'updatedAt'>,
  evidence: readonly Evidence[],
): Evidence[] {
  return evidence.filter((item) => isCurrentCommitEvidence(run, item))
}

export function hasCurrentCommitRemoteCiPass(
  run: Pick<Run, 'commitSha' | 'updatedAt'>,
  evidence: readonly Evidence[],
): boolean {
  return hasRemoteCiPass(currentCommitEvidenceForRun(run, evidence))
}

export function hasCurrentCommitReviewPass(
  run: Pick<Run, 'commitSha' | 'updatedAt'>,
  evidence: readonly Evidence[],
): boolean {
  return hasReviewPass(currentCommitEvidenceForRun(run, evidence))
}

function isCurrentCommitEvidence(run: Pick<Run, 'commitSha' | 'updatedAt'>, item: Evidence): boolean {
  const evidenceCommit = evidenceCommitSha(item.payload)
  if (!isBlank(run.commitSha)) {
    return evidenceCommit === run.commitSha
  }
  if (evidenceCommit == null && item.createdAt != null) return Date.parse(item.createdAt) >= Date.parse(run.updatedAt)
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
    if (!isTrustedEvidencePayload(payload)) return false
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
  return evidence.some((item) =>
    item.type === 'ci' &&
    item.payload.passed === true &&
    isTrustedEvidencePayload(item.payload) &&
    ciEvidenceHasStrictPass(item.payload))
}

function hasReviewPass(evidence: readonly Evidence[]): boolean {
  return evidence.some((item) => {
    const payload = item.payload
    if (!isTrustedEvidencePayload(payload)) return false
    if (item.type === 'review' && payload.passed === true) return true
    if (item.type !== 'custom' || payload.kind !== 'internal-review') return false
    return payload.passed === true || payload.verdict === 'pass'
  })
}

function untrustedSuccessfulGateReasons(evidence: readonly Evidence[]): string[] {
  const reasons = new Set<string>()
  for (const item of evidence) {
    if (isTrustedEvidencePayload(item.payload)) continue
    if (isSuccessfulVerificationEvidence(item)) reasons.add('untrusted successful verification evidence is present')
    if (isSuccessfulReviewEvidence(item)) reasons.add('untrusted successful review evidence is present')
    if (item.type === 'ci' && item.payload.passed === true) reasons.add('untrusted successful CI evidence is present')
  }
  return [...reasons]
}

function isSuccessfulVerificationEvidence(item: Evidence): boolean {
  const payload = item.payload
  if ((item.type === 'test' || item.type === 'lint') && payload.passed === true) return true
  if (item.type !== 'custom') return false
  if (payload.kind === 'verify' && payload.passed === true) return true
  if (payload.kind !== 'worktree.snapshot') return false
  const verify = payload.verifyOutput
  return typeof verify === 'object' && verify != null && (verify as { exitCode?: unknown }).exitCode === 0
}

function isSuccessfulReviewEvidence(item: Evidence): boolean {
  const payload = item.payload
  if (item.type === 'review' && payload.passed === true) return true
  if (item.type !== 'custom' || payload.kind !== 'internal-review') return false
  return payload.passed === true || payload.verdict === 'pass'
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
  if (budget?.perRunHardUsd == null) {
    reasons.push('perRunHardUsd is not configured for unattended approval')
  }
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

function buildRecovery(reasons: readonly string[]): string {
  if (reasons.includes('perRunHardUsd is not configured for unattended approval')) {
    return 'Action Needed: configure Factory Settings budgets.perRunHardUsd, rerun verification/review if needed, then retry unattended approval or use manual approval.'
  }
  return 'Action Needed: fix the listed blocker, rerun verification/review if needed, then retry unattended approval or use manual approval.'
}
