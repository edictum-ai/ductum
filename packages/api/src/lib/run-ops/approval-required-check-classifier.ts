import type { CICheckResult } from '@ductum/core'

import type { ApprovalCiGateConfig } from '../deps.js'

export interface ApprovalRequiredCheckPolicy {
  enabled: boolean
  requiredChecks: string[]
  failClosedOnMissing: boolean
}

export type RequiredChecksSource = 'policy' | 'branch_protection' | 'none'

export interface ResolvedRequiredChecks {
  names: string[]
  source: RequiredChecksSource
}

export interface ApprovalRequiredCheckDecision {
  ok: boolean
  reasons: string[]
  observed: CICheckResult[]
  missingRequired: string[]
  fetchedAt: string
  policy: ApprovalRequiredCheckPolicy
  requiredChecksSource: RequiredChecksSource
}

export function resolveApprovalRequiredCheckPolicy(
  config: ApprovalCiGateConfig | undefined,
): ApprovalRequiredCheckPolicy {
  const requiredChecks = Array.isArray(config?.requiredChecks)
    ? config!.requiredChecks.filter(
        (name): name is string => typeof name === 'string' && name.trim() !== '',
      )
    : []
  return {
    enabled: config?.enabled ?? true,
    requiredChecks,
    failClosedOnMissing: config?.failClosedOnMissing ?? true,
  }
}

export function classifyApprovalRequiredChecks(
  checks: CICheckResult[],
  policy: ApprovalRequiredCheckPolicy,
  resolved: ResolvedRequiredChecks,
  fetchedAt: string,
): ApprovalRequiredCheckDecision {
  if (!policy.enabled) {
    return emptyDecision(policy, resolved.source, fetchedAt)
  }

  const reasons: string[] = []
  const observedByName = latestObservedChecksByName(checks)

  if (resolved.names.length > 0) {
    for (const requiredName of resolved.names) {
      const observed = observedByName.get(requiredName)
      if (observed == null) {
        reasons.push(`required check "${requiredName}" is missing`)
        continue
      }
      const checkReason = reasonForCheck(observed)
      if (checkReason != null) reasons.push(`required check "${requiredName}" ${checkReason}`)
    }
  } else if (resolved.source !== 'branch_protection') {
    if (observedByName.size === 0 && policy.failClosedOnMissing) {
      reasons.push('no CI checks observed for the pinned PR head (expected at least one passing check)')
    }
    for (const check of observedByName.values()) {
      const name = check.name.trim() || 'unknown'
      const checkReason = reasonForCheck(check)
      if (checkReason != null) reasons.push(`check "${name}" ${checkReason}`)
    }
  }

  const missingRequired = resolved.names.filter((name) => !observedByName.has(name))
  return {
    ok: reasons.length === 0,
    reasons,
    observed: [...observedByName.values()],
    missingRequired,
    fetchedAt,
    policy,
    requiredChecksSource: resolved.source,
  }
}

function emptyDecision(
  policy: ApprovalRequiredCheckPolicy,
  source: RequiredChecksSource,
  fetchedAt: string,
): ApprovalRequiredCheckDecision {
  return {
    ok: true,
    reasons: [],
    observed: [],
    missingRequired: [],
    fetchedAt,
    policy,
    requiredChecksSource: source,
  }
}

function latestObservedChecksByName(checks: CICheckResult[]): Map<string, CICheckResult> {
  const observedByName = new Map<string, CICheckResult>()
  for (const check of [...checks].sort(compareNewestCheckResultFirst)) {
    const name = check.name.trim()
    if (name === '') continue
    if (!observedByName.has(name)) observedByName.set(name, check)
  }
  return observedByName
}

function reasonForCheck(check: CICheckResult): string | null {
  if (check.status === 'queued') return 'is queued'
  if (check.status === 'in_progress') return 'is in progress'
  if (check.status !== 'completed') return `has unknown status "${check.status}"`
  switch (check.conclusion) {
    case 'success':
      return null
    case null:
      return 'completed without a conclusion'
    case 'failure':
      return 'failed'
    case 'timed_out':
      return 'timed out'
    case 'neutral':
      return 'finished neutral'
    case 'skipped':
      return 'was skipped unexpectedly'
    default:
      return `concluded "${String(check.conclusion)}"`
  }
}

function compareNewestCheckResultFirst(left: CICheckResult, right: CICheckResult): number {
  return checkResultAge(right) - checkResultAge(left)
}

function checkResultAge(check: CICheckResult): number {
  if (check.startedAt == null || check.startedAt === '') return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(check.startedAt)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export class ApprovalRequiredChecksError extends Error {
  constructor(
    public readonly prHeadSha: string,
    public readonly decision: ApprovalRequiredCheckDecision,
  ) {
    super(formatApprovalRequiredChecksMessage(prHeadSha, decision))
    this.name = 'ApprovalRequiredChecksError'
  }
}

export function formatApprovalRequiredChecksMessage(
  prHeadSha: string,
  decision: ApprovalRequiredCheckDecision,
): string {
  return [
    `required CI checks are not green for PR head ${prHeadSha}`,
    ...decision.reasons.map((reason) => `  - ${reason}`),
  ].join('\n')
}
