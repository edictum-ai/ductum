import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  withTrustedEvidenceProducer,
  type CICheckResult,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { addEvidence } from './evidence.js'
import { fetchCurrentPrHeadCiChecks, fetchPrBaseBranchRequiredChecks } from './pr-ci.js'
import {
  ApprovalRequiredChecksError,
  classifyApprovalRequiredChecks,
  resolveApprovalRequiredCheckPolicy,
  type ApprovalRequiredCheckDecision,
  type ApprovalRequiredCheckPolicy,
  type ResolvedRequiredChecks,
} from './approval-required-check-classifier.js'

export {
  ApprovalRequiredChecksError,
  classifyApprovalRequiredChecks,
  formatApprovalRequiredChecksMessage,
  resolveApprovalRequiredCheckPolicy,
} from './approval-required-check-classifier.js'
export type {
  ApprovalRequiredCheckDecision,
  ApprovalRequiredCheckPolicy,
  RequiredChecksSource,
  ResolvedRequiredChecks,
} from './approval-required-check-classifier.js'

export async function evaluateApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  policy: ApprovalRequiredCheckPolicy
  baseBranch?: string
}): Promise<ApprovalRequiredCheckDecision> {
  const fetchedAt = input.context.now().toISOString()
  if (!input.policy.enabled) {
    return {
      ok: true,
      reasons: [],
      observed: [],
      missingRequired: [],
      fetchedAt,
      policy: input.policy,
      requiredChecksSource: 'none',
      resolvedRequiredChecks: [],
    }
  }

  const resolved = await resolveRequiredChecksForEvaluation(input).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error)
    input.context.repos.runUpdates.create(
      input.runId,
      `approval required-checks resolution failed: ${detail}`,
    )
    return {
      names: input.policy.requiredChecks,
      source: 'none' as const,
      resolutionError: detail,
    }
  })

  let fetchFailureDetail: string | null = null
  const checks = await fetchCurrentPrHeadCiChecks(input.context, input.run, input.prHeadSha).catch(
    (error) => {
      fetchFailureDetail = error instanceof Error ? error.message : String(error)
      input.context.repos.runUpdates.create(
        input.runId,
        `approval required-checks snapshot failed: ${fetchFailureDetail}`,
      )
      return null
    },
  )

  if (checks == null) {
    const detail = fetchFailureDetail ?? 'GitHub auth or API unavailable'
    return {
      ok: false,
      reasons: [`could not read CI checks for PR head ${input.prHeadSha} (${detail})`],
      observed: [],
      missingRequired: resolved.names,
      fetchedAt,
      policy: input.policy,
      requiredChecksSource: resolved.source,
      resolvedRequiredChecks: resolved.names,
    }
  }

  const decision = classifyApprovalRequiredChecks(checks, input.policy, resolved, fetchedAt)
  if ('resolutionError' in resolved && resolved.resolutionError != null) {
    decision.reasons = [
      `could not read required-checks policy from GitHub branch protection (${resolved.resolutionError})`,
      ...decision.reasons,
    ]
    decision.ok = false
  }
  return decision
}

async function resolveRequiredChecksForEvaluation(input: {
  context: ApiContext
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  policy: ApprovalRequiredCheckPolicy
  baseBranch?: string
}): Promise<ResolvedRequiredChecks> {
  if (input.policy.requiredChecks.length > 0) {
    return { names: input.policy.requiredChecks, source: 'policy' }
  }
  const fetched = await fetchPrBaseBranchRequiredChecks(
    input.context,
    input.run,
    input.baseBranch ?? 'main',
  )
  if (fetched == null) return { names: [], source: 'none' }
  return { names: dedupeRequiredChecks(fetched), source: 'branch_protection' }
}

function dedupeRequiredChecks(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

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
        requiredChecksSource: decision.requiredChecksSource,
        missingRequired: decision.missingRequired,
        observed: decision.observed.map((check: CICheckResult) => ({
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

export async function enforceApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  policy: ApprovalRequiredCheckPolicy
  baseBranch?: string
}): Promise<ApprovalRequiredCheckDecision> {
  const decision = await evaluateApprovalRequiredChecks(input)
  if (decision.ok) return decision
  recordApprovalRequiredCheckDecision(input.context, input.runId, input.prHeadSha, decision)
  throw new ApprovalRequiredChecksError(input.prHeadSha, decision)
}

export async function enforceGitHubAppApprovalRequiredChecks(input: {
  context: ApiContext
  runId: RunId
  run: Pick<Run, 'id' | 'taskId' | 'prUrl' | 'prNumber' | 'commitSha'>
  prHeadSha: string
  actorType: 'github_app' | 'dev_pat' | 'dev_gh_cli'
  baseBranch?: string
}): Promise<ApprovalRequiredCheckDecision | null> {
  if (input.actorType !== 'github_app') return null
  const policy = resolveApprovalRequiredCheckPolicy(input.context.merge.approvalCiGate)
  if (!policy.enabled) return null
  return await enforceApprovalRequiredChecks({
    context: input.context,
    runId: input.runId,
    run: input.run,
    prHeadSha: input.prHeadSha,
    policy,
    ...(input.baseBranch == null ? {} : { baseBranch: input.baseBranch }),
  })
}
