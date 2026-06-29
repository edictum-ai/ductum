import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  withTrustedEvidenceProducer,
  type CICheckResult,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext, ApprovalCiGateConfig } from '../deps.js'
import { addEvidence } from './evidence.js'
import { fetchCurrentPrHeadCiChecks } from './pr-ci.js'

/**
 * Resolved policy used by {@link evaluateApprovalRequiredChecks}. Defaults
 * are fail-closed for the production GitHub App lifecycle so a missing
 * observation is treated as a blocker rather than a silent pass.
 */
export interface ApprovalRequiredCheckPolicy {
  enabled: boolean
  requiredChecks: string[]
  failClosedOnMissing: boolean
}

export interface ApprovalRequiredCheckDecision {
  ok: boolean
  reasons: string[]
  observed: CICheckResult[]
  missingRequired: string[]
  fetchedAt: string
  policy: ApprovalRequiredCheckPolicy
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

/**
 * Issue #195: evaluate the live required-check state for the pinned PR head
 * immediately before the production GitHub App merge call. Cached latch
 * state (`run.ciStatus`) is intentionally ignored — only the live check-run
 * + commit status set seen right now counts.
 *
 * The function never throws on GitHub API failures; it returns a fail-closed
 * decision so the caller can surface a concrete reason instead of merging.
 */
export async function evaluateApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  policy: ApprovalRequiredCheckPolicy
}): Promise<ApprovalRequiredCheckDecision> {
  const fetchedAt = input.context.now().toISOString()
  if (!input.policy.enabled) {
    return { ok: true, reasons: [], observed: [], missingRequired: [], fetchedAt, policy: input.policy }
  }

  const checks = await fetchCurrentPrHeadCiChecks(input.context, input.run, input.prHeadSha).catch(
    (error) => {
      const detail = error instanceof Error ? error.message : String(error)
      input.context.repos.runUpdates.create(
        input.runId,
        `approval required-checks snapshot failed: ${detail}`,
      )
      return null
    },
  )

  if (checks == null) {
    return {
      ok: false,
      reasons: [
        `could not read CI checks for PR head ${input.prHeadSha} (GitHub auth or API unavailable)`,
      ],
      observed: [],
      missingRequired: input.policy.requiredChecks,
      fetchedAt,
      policy: input.policy,
    }
  }

  return classifyApprovalRequiredChecks(checks, input.policy, fetchedAt)
}

export function classifyApprovalRequiredChecks(
  checks: CICheckResult[],
  policy: ApprovalRequiredCheckPolicy,
  fetchedAt: string,
): ApprovalRequiredCheckDecision {
  if (!policy.enabled) {
    return { ok: true, reasons: [], observed: [], missingRequired: [], fetchedAt, policy }
  }
  const reasons: string[] = []
  const observedByName = new Map<string, CICheckResult>()
  for (const check of checks) {
    const name = check.name.trim()
    if (name === '') continue
    if (!observedByName.has(name)) observedByName.set(name, check)
  }

  if (policy.requiredChecks.length > 0) {
    for (const requiredName of policy.requiredChecks) {
      const observed = observedByName.get(requiredName)
      if (observed == null) {
        reasons.push(`required check "${requiredName}" is missing`)
        continue
      }
      const checkReason = reasonForCheck(observed)
      if (checkReason != null) reasons.push(`required check "${requiredName}" ${checkReason}`)
    }
  } else {
    if (observedByName.size === 0 && policy.failClosedOnMissing) {
      reasons.push('no CI checks observed for the pinned PR head (expected at least one passing check)')
    }
    for (const check of observedByName.values()) {
      const name = check.name.trim() || 'unknown'
      const checkReason = reasonForCheck(check)
      if (checkReason != null) reasons.push(`check "${name}" ${checkReason}`)
    }
  }

  const missingRequired = policy.requiredChecks.filter((name) => !observedByName.has(name))
  return {
    ok: reasons.length === 0,
    reasons,
    observed: [...observedByName.values()],
    missingRequired,
    fetchedAt,
    policy,
  }
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

/**
 * Persist a non-merge gate decision to the run's evidence trail and the
 * structured gate-evaluations table. The evidence payload is recorded with
 * the trusted approval producer so downstream policy checks treat it as
 * fresh operator-time signal rather than an untrusted claim.
 */
export function recordApprovalRequiredCheckDecision(
  context: ApiContext,
  runId: RunId,
  prHeadSha: string,
  decision: ApprovalRequiredCheckDecision,
): void {
  if (decision.ok) return
  addEvidence(
    context,
    runId,
    'custom',
    withTrustedEvidenceProducer(
      {
        kind: 'approval-required-checks',
        passed: false,
        commitSha: prHeadSha,
        resolvedAt: decision.fetchedAt,
        source: 'github_pr_approval_gate',
        reasons: decision.reasons,
        requiredChecks: decision.policy.requiredChecks,
        missingRequired: decision.missingRequired,
        observed: decision.observed.map((check) => ({
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
        })),
      },
      DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
    ),
  )
  context.repos.gateEvaluations.create({
    runId,
    gateType: 'gate_check',
    target: 'approval.required_checks',
    result: 'blocked',
    reason: decision.reasons.join('; '),
    observed: false,
  })
  context.repos.runUpdates.create(
    runId,
    `approval blocked: required CI checks are not green for PR head ${prHeadSha} — ${decision.reasons.join('; ')}`,
  )
}

/**
 * Evaluate the gate and, on a fail-closed verdict, persist the decision and
 * throw {@link ApprovalRequiredChecksError} so the merge driver aborts before
 * the GitHub App merge call. The merge driver only needs this single entry
 * point — keeps `merge-drivers.ts` under the file-size cap.
 */
export async function enforceApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  policy: ApprovalRequiredCheckPolicy
}): Promise<void> {
  const decision = await evaluateApprovalRequiredChecks(input)
  if (decision.ok) return
  recordApprovalRequiredCheckDecision(input.context, input.runId, input.prHeadSha, decision)
  throw new ApprovalRequiredChecksError(input.prHeadSha, decision)
}

/**
 * Issue #195 convenience for `mergeViaGitHubApi`: resolve the policy from
 * `context.merge.approvalCiGate` and enforce when both the policy and the
 * resolved auth say "production GitHub App". Returns silently when the gate
 * does not apply (dev mode) or passes; throws {@link ApprovalRequiredChecksError}
 * on a fail-closed verdict.
 */
export async function enforceGitHubAppApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  actorType: 'github_app' | 'dev_pat' | 'dev_gh_cli'
}): Promise<void> {
  if (input.actorType !== 'github_app') return
  const policy = resolveApprovalRequiredCheckPolicy(input.context.merge.approvalCiGate)
  if (!policy.enabled) return
  await enforceApprovalRequiredChecks({
    context: input.context,
    runId: input.runId,
    run: input.run,
    prHeadSha: input.prHeadSha,
    policy,
  })
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
