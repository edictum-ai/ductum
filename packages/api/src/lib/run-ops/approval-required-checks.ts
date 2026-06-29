import {
  DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
  withTrustedEvidenceProducer,
  type CICheckResult,
  type Run,
  type RunId,
} from '@ductum/core'

import type { ApiContext, ApprovalCiGateConfig } from '../deps.js'
import { addEvidence } from './evidence.js'
import { fetchCurrentPrHeadCiChecks, fetchPrBaseBranchRequiredChecks } from './pr-ci.js'

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

/**
 * Where the resolved required-checks list came from. Issue #195 review round 3:
 * when {@link ApprovalRequiredCheckPolicy.requiredChecks} is empty (the
 * default), the gate asks GitHub branch protection what is required before
 * merging. Without that lookup the classifier would only see checks that
 * have already started, so a slow required check that has not appeared yet
 * would be silently treated as satisfied.
 */
export type RequiredChecksSource = 'policy' | 'branch_protection' | 'none'

/**
 * The authoritative required-checks set used by the classifier. `names` is
 * the union of policy-supplied and branch-protection-supplied entries (with
 * policy taking precedence when both are present). `source` records where
 * the list came from so the decision payload is auditable.
 */
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

/**
 * Issue #195: evaluate the live required-check state for the pinned PR head
 * immediately before the production GitHub App merge call. Cached latch
 * state (`run.ciStatus`) is intentionally ignored — only the live check-run
 * + commit status set seen right now counts.
 *
 * Issue #195 review round 3: when {@link ApprovalRequiredCheckPolicy.requiredChecks}
 * is empty (the default), the gate asks GitHub branch protection what is
 * required. Using the authoritative list — not just the observed set — is
 * what makes the default fail closed for missing/pending required checks.
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
  /**
   * PR base branch used to look up branch protection when the policy does
   * not name required checks explicitly. Defaults to "main".
   */
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
      reasons: [
        `could not read CI checks for PR head ${input.prHeadSha} (${detail})`,
      ],
      observed: [],
      missingRequired: resolved.names,
      fetchedAt,
      policy: input.policy,
      requiredChecksSource: resolved.source,
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

/**
 * Resolve the authoritative required-checks list for the evaluation. Policy
 * takes precedence — if the operator named checks explicitly, those win and
 * we do not call branch protection. Otherwise we ask GitHub what the base
 * branch requires; if branch protection is configured (even with an empty
 * required-checks set), the source is `branch_protection` so the classifier
 * knows the operator has GitHub enforcement on. If neither policy nor
 * branch protection names anything, the source is `none` and the classifier
 * falls back to the observed-checks heuristic.
 */
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

export function classifyApprovalRequiredChecks(
  checks: CICheckResult[],
  policy: ApprovalRequiredCheckPolicy,
  resolved: ResolvedRequiredChecks,
  fetchedAt: string,
): ApprovalRequiredCheckDecision {
  if (!policy.enabled) {
    return {
      ok: true,
      reasons: [],
      observed: [],
      missingRequired: [],
      fetchedAt,
      policy,
      requiredChecksSource: resolved.source,
    }
  }
  const reasons: string[] = []
  const observedByName = new Map<string, CICheckResult>()
  /**
   * Issue #195 review round 2: GitHub can report multiple check runs with
   * the same name for re-runs / retries on the same head SHA. Keeping the
   * first one seen lets a stale earlier success mask a current failure (or
   * a stale failure block a later green rerun). We sort newest-first by
   * `startedAt` so the live attempt wins; records without a timestamp fall
   * back to encounter order, which is acceptable because `pr-ci.ts` already
   * collapses reruns at fetch time.
   */
  const ordered = [...checks].sort(compareNewestCheckResultFirst)
  for (const check of ordered) {
    const name = check.name.trim()
    if (name === '') continue
    if (!observedByName.has(name)) observedByName.set(name, check)
  }

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
  } else {
    /**
     * Issue #195 review round 3: this branch only runs when neither policy
     * nor branch protection named any required checks. We keep the
     * observed-checks heuristic so dev fixture paths (no GitHub App, no
     * branch protection) still merge on all-green observed checks, but the
     * production path now flows through the explicit `resolved.names`
     * branch above with the authoritative list.
     */
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
 * Issue #195 review round 2: sort comparator that places the newest record
 * for a given name first. Used by the dedupe loop so re-runs are collapsed
 * to the live attempt rather than the first record seen.
 */
function compareNewestCheckResultFirst(left: CICheckResult, right: CICheckResult): number {
  return checkResultAge(right) - checkResultAge(left)
}

function checkResultAge(check: CICheckResult): number {
  if (check.startedAt == null || check.startedAt === '') return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(check.startedAt)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
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
        requiredChecksSource: decision.requiredChecksSource,
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
  baseBranch?: string
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
  baseBranch?: string
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
    ...(input.baseBranch == null ? {} : { baseBranch: input.baseBranch }),
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
