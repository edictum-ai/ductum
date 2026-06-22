import {
  classifyTask,
  type Agent,
  type BestOfNPolicy,
  type BestOfNVerdict,
  type Evidence,
  type GateEvaluation,
  parseBestOfNVerdict,
  type Run,
  type Task,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import type {
  BakeoffAgentDisplay,
  BakeoffCandidateCompare,
  BakeoffCandidateEligibility,
  BakeoffCandidateMetrics,
  BakeoffCompareResponse,
  BakeoffOverallStatus,
  BakeoffTaskRunSummary,
} from './bakeoff-compare-types.js'
import { EMPTY_BAKEOFF_SCORES, scoreBakeoffCandidates } from './bakeoff-scoring.js'
import { NotFoundError, ValidationError } from './errors.js'
import { resolveCatalogEntry } from './model-catalog.js'

export type { BakeoffCompareResponse } from './bakeoff-compare-types.js'

export function buildBakeoffCompareResponse(context: ApiContext, specId: string): BakeoffCompareResponse {
  const spec = context.repos.specs.get(specId as never)
  if (spec == null) throw new NotFoundError(`Spec not found: ${specId}`)
  if (spec.strategy !== 'best_of_n' || spec.strategyConfig?.kind !== 'best_of_n') {
    throw new ValidationError(`Spec is not a Best-of-N bakeoff: ${specId}`)
  }
  const strategyGroup = spec.strategyConfig.strategyGroup
  const tasks = context.repos.tasks.list(spec.id)
  const candidates = tasks
    .filter((task) => task.strategyRole === 'candidate' && task.strategyGroup === strategyGroup)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
  const reviewTask = tasks.find((task) => task.strategyRole === 'blind_review' && task.strategyGroup === strategyGroup) ?? null
  const verdict = findStructuredVerdict(context, reviewTask)
  const compared = scoreBakeoffCandidates(candidates.map((task) => compareCandidate(context, tasks, task, verdict)))
  const winnerTaskId = selectWinnerTaskId(compared, verdict, spec.strategyConfig.policy)
  const winner = winnerTaskId == null ? null : compared.find((candidate) => candidate.task.taskId === winnerTaskId) ?? null
  const status = bakeoffStatus(compared, reviewTask, verdict, winnerTaskId)

  return {
    spec: { id: spec.id, projectId: spec.projectId, name: spec.name, status: spec.status },
    policy: spec.strategyConfig.policy,
    strategyGroup,
    status,
    candidates: compared.map((candidate) => ({ ...candidate, winner: candidate.task.taskId === winnerTaskId })),
    reviewTask: reviewTask == null ? null : summarizeTaskRuns(reviewTask, context.repos.runs.list(reviewTask.id)),
    verdict,
    winner: winner == null
      ? null
      : {
          taskId: winner.task.taskId,
          runId: winner.task.latestRunId,
          outcome: winner.outcome,
          eligible: winner.eligibility.eligible,
        },
    eligibility: {
      eligibleCount: compared.filter((candidate) => candidate.eligibility.eligible).length,
      blockedCount: compared.filter((candidate) => !candidate.eligibility.eligible).length,
    },
    nextActions: nextActions(status, reviewTask, winner, verdict != null),
  }
}

function compareCandidate(
  context: ApiContext,
  tasks: Task[],
  task: Task,
  verdict: BestOfNVerdict | null,
): BakeoffCandidateCompare {
  const lineage = candidateLineage(tasks, task)
  const reviewTasks = tasks.filter((item) => {
    const parsed = classifyTask(item)
    return parsed.kind === 'review' && parsed.originalName === task.name
  })
  const runs = lineage.flatMap((item) => context.repos.runs.list(item.id))
  const reviewRuns = reviewTasks.flatMap((item) => context.repos.runs.list(item.id))
  const evidence = evidenceFor(context, [...runs, ...reviewRuns])
  const gates = gateEvaluationsFor(context, runs)
  const outcome = latestOutcome(evidence)
  const metrics = candidateMetrics(runs, reviewRuns, evidence, lineage.length - 1)
  const verdictScore = verdict?.scores.find((score) => score.taskId === task.id) ?? null
  const eligibility = candidateEligibility(task, runs.at(-1) ?? null, evidence, gates, metrics, outcome, verdictScore)

  return {
    task: summarizeTaskRuns(task, runs),
    agent: task.assignedAgentId == null ? null : agentDisplay(context.repos.agents.get(task.assignedAgentId)),
    metrics,
    scores: EMPTY_BAKEOFF_SCORES,
    outcome,
    verdictScore,
    winner: false,
    eligibility,
  }
}

function candidateLineage(tasks: Task[], candidate: Task): Task[] {
  return tasks.filter((task) => {
    if (task.id === candidate.id) return true
    const parsed = classifyTask(task)
    return parsed.kind === 'fix' && parsed.originalName === candidate.name
  })
}

function summarizeTaskRuns(task: Task, runs: Run[]): BakeoffTaskRunSummary {
  const latest = runs.at(-1) ?? null
  return {
    taskId: task.id,
    taskName: task.name,
    taskStatus: task.status,
    runIds: runs.map((run) => run.id),
    latestRunId: latest?.id ?? null,
    latestRunStage: latest?.stage ?? null,
    terminalState: latest?.terminalState ?? null,
    blockedReason: latest?.blockedReason ?? null,
    failReason: latest?.failReason ?? null,
    pendingApproval: latest?.pendingApproval ?? false,
    branch: latest?.branch ?? null,
    commitSha: latest?.commitSha ?? null,
    prUrl: latest?.prUrl ?? null,
    worktreePaths: latest?.worktreePaths ?? null,
  }
}

function candidateMetrics(runs: Run[], reviewRuns: Run[], evidence: Evidence[], fixRounds: number): BakeoffCandidateMetrics {
  const allRuns = [...runs, ...reviewRuns]
  const startedAt = minDate(allRuns.map((run) => run.createdAt))
  const updatedAt = maxDate(allRuns.map((run) => run.updatedAt))
  const tokensIn = sum(allRuns.map((run) => run.tokensIn))
  const tokensOut = sum(allRuns.map((run) => run.tokensOut))
  return {
    tokensIn,
    tokensOut,
    totalTokens: tokensIn + tokensOut,
    costUsd: Number(sum(allRuns.map((run) => run.costUsd)).toFixed(6)),
    elapsedSeconds: startedAt == null || updatedAt == null ? null : Math.max(0, Math.round((Date.parse(updatedAt) - Date.parse(startedAt)) / 1000)),
    startedAt,
    updatedAt,
    attempts: runs.length,
    reviewPasses: evidence.filter((item) => item.payload.kind === 'internal-review' && (item.payload.passed === true || item.payload.verdict === 'pass')).length,
    fixRounds,
    verificationFailures: evidence.filter((item) => item.payload.kind === 'verify' && item.payload.passed === false).length,
  }
}

function candidateEligibility(
  task: Task,
  latestRun: Run | null,
  evidence: Evidence[],
  gates: GateEvaluation[],
  metrics: BakeoffCandidateMetrics,
  outcome: string | null,
  verdictScore: BestOfNVerdict['scores'][number] | null,
): BakeoffCandidateEligibility {
  const implementationCompleted = task.status === 'done'
  const verifyPassed = task.verification.length === 0 || evidence.some((item) => item.payload.kind === 'verify' && item.payload.passed === true)
  const reviewPassed = verdictScore == null
    ? metrics.reviewPasses > 0 || outcome === 'fixed' || outcome === 'accepted' || outcome === 'accepted-with-fixes'
    : verdictScore.passed
  const safetyBlocked = gates.some((gate) => gate.result === 'blocked') || latestRun?.blockedReason != null
  const artifactsAvailable = latestRun != null && (
    latestRun.worktreePaths?.length ? true : latestRun.branch != null || latestRun.commitSha != null || latestRun.prUrl != null || evidence.length > 0
  )
  const blockingReasons = [
    implementationCompleted ? null : 'implementation is not complete',
    verifyPassed ? null : 'required verification has not passed',
    reviewPassed ? null : 'candidate review has not passed',
    safetyBlocked ? 'candidate has a blocking gate or blocked run state' : null,
    artifactsAvailable ? null : 'inspection artifacts are not available',
    latestRun?.failReason == null ? null : `latest run failed: ${latestRun.failReason}`,
  ].filter((item): item is string => item != null)
  return {
    eligible: blockingReasons.length === 0,
    gates: { implementationCompleted, verifyPassed, reviewPassed, warnAccepted: outcome === 'accepted-with-fixes', safetyBlocked, artifactsAvailable },
    blockingReasons,
  }
}

function findStructuredVerdict(context: ApiContext, reviewTask: Task | null): BestOfNVerdict | null {
  if (reviewTask == null) return null
  const verdicts: BestOfNVerdict[] = []
  for (const item of evidenceFor(context, context.repos.runs.list(reviewTask.id))) {
    if (isBestOfNVerdict(item.payload)) verdicts.push(item.payload)
    if (item.payload.kind === 'internal-review' && typeof item.payload.feedback === 'string') {
      const parsed = parseBestOfNVerdict(item.payload.feedback)
      if (parsed.verdict != null) verdicts.push(parsed.verdict)
    }
  }
  return verdicts.at(-1) ?? null
}

function latestOutcome(evidence: Evidence[]): string | null {
  return evidence
    .map((item) => item.payload)
    .filter((payload) => payload.kind === 'bakeoff-candidate-outcome' && typeof payload.outcome === 'string')
    .map((payload) => payload.outcome as string)
    .at(-1) ?? null
}

function selectWinnerTaskId(
  candidates: BakeoffCandidateCompare[],
  verdict: BestOfNVerdict | null,
  policy: BestOfNPolicy,
): string | null {
  const accepted = candidates.find((candidate) => isAcceptedOutcome(candidate.outcome))?.task.taskId ?? null
  if (accepted != null) return accepted
  if (policy === 'cheapest-verified-reviewed') {
    const eligibleCosted = candidates.filter((candidate) => candidate.eligibility.eligible && candidate.metrics.costUsd > 0)
    const minCost = eligibleCosted.length === 0 ? null : Math.min(...eligibleCosted.map((candidate) => candidate.metrics.costUsd))
    if (minCost != null) {
      const cheapest = eligibleCosted.filter((candidate) => Math.abs(candidate.metrics.costUsd - minCost) < 0.000001)
      return (cheapest.find((candidate) => candidate.task.taskId === verdict?.winnerTaskId) ?? cheapest[0])?.task.taskId ?? null
    }
  }
  return candidates.find((candidate) => candidate.task.taskId === verdict?.winnerTaskId && candidate.eligibility.eligible)?.task.taskId ?? null
}

function isAcceptedOutcome(outcome: string | null): boolean {
  return outcome === 'accepted' || outcome === 'accepted-with-fixes'
}

function bakeoffStatus(
  candidates: BakeoffCandidateCompare[],
  reviewTask: Task | null,
  verdict: BestOfNVerdict | null,
  winnerTaskId: string | null,
): BakeoffOverallStatus {
  if (winnerTaskId != null && candidates.some((candidate) => candidate.task.taskId === winnerTaskId && isAcceptedOutcome(candidate.outcome))) return 'complete'
  if (verdict != null) return winnerTaskId == null ? 'failed' : 'complete'
  if (reviewTask?.status === 'failed') return 'failed'
  if (reviewTask?.status === 'active') return 'reviewing'
  if (candidates.some((candidate) => candidate.task.taskStatus === 'active' || (candidate.task.latestRunStage != null && candidate.task.latestRunStage !== 'done' && candidate.task.terminalState == null))) return 'running'
  if (candidates.length > 0 && candidates.every((candidate) => ['done', 'failed'].includes(candidate.task.taskStatus))) return 'ready_for_review'
  return candidates.some((candidate) => candidate.task.runIds.length > 0) ? 'running' : 'pending'
}

function nextActions(status: BakeoffOverallStatus, reviewTask: Task | null, winner: BakeoffCandidateCompare | null, hasVerdict: boolean): string[] {
  if (status === 'complete' && winner != null) {
    return winner.task.pendingApproval
      ? [`Review candidate ${winner.task.taskId}; approve through the normal Ductum approval flow if it should ship.`]
      : [`Winner candidate ${winner.task.taskId} is already accepted; no operator approval is waiting.`]
  }
  if (status === 'failed' && hasVerdict) {
    return ['Structured verdict did not produce an eligible winner; inspect blockers, then rerun or reject the bakeoff.']
  }
  if (status === 'ready_for_review' && reviewTask != null) return [`Dispatch or watch blind review task ${reviewTask.id}.`]
  if (status === 'failed') return ['Inspect failed candidate/review evidence, then rerun or reject the bakeoff.']
  return ['Wait for candidate tasks to finish before selecting a winner.']
}

function agentDisplay(agent: Agent | null): BakeoffAgentDisplay | null {
  if (agent == null) return null
  const entry = resolveCatalogEntry(agent.model)
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    modelLabel: entry?.label ?? null,
    provider: entry?.provider ?? null,
    harness: agent.harness,
    effort: agent.effort ?? null,
    costTier: agent.costTier,
  }
}

function evidenceFor(context: ApiContext, runs: Run[]): Evidence[] {
  return runs.flatMap((run) => context.repos.evidence.list(run.id))
}

function gateEvaluationsFor(context: ApiContext, runs: Run[]): GateEvaluation[] {
  return runs.flatMap((run) => context.repos.gateEvaluations.list(run.id))
}

function isBestOfNVerdict(value: unknown): value is BestOfNVerdict {
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.kind === 'best-of-n-verdict'
    && typeof record.winnerTaskId === 'string'
    && Array.isArray(record.scores)
    && typeof record.policy === 'string'
    && typeof record.reason === 'string'
}

function minDate(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((min, value) => value < min ? value : min)
}

function maxDate(values: string[]): string | null {
  return values.length === 0 ? null : values.reduce((max, value) => value > max ? value : max)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
