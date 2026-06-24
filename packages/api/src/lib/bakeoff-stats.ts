import { resolveRecordedCostTruth, type BestOfNVerdict, type Run } from '@ductum/core'

import type {
  BakeoffAgentDisplay,
  BakeoffCandidateCompare,
  BakeoffStats,
  BakeoffStatsRow,
  BakeoffTaskRunSummary,
} from './bakeoff-compare-types.js'
import { maxDate, maxNullable, minDate, rate, roundMoney, sum } from './bakeoff-metrics.js'

export function buildBakeoffStats(input: {
  candidates: BakeoffCandidateCompare[]
  reviewTask: BakeoffTaskRunSummary | null
  judge: BakeoffAgentDisplay | null
  judgeRuns: Run[]
  verdict: BestOfNVerdict | null
  winnerTaskId: string | null
  malformed: { reviewCount: number; recoveryState: string | null }
}): BakeoffStats {
  const judgeRow = input.judge == null || input.reviewTask == null
    ? []
    : [rowForJudge(input.judge, input.reviewTask, runMetrics(input.judgeRuns), input.malformed, input.verdict)]
  const builderRows = input.candidates.map((candidate) => rowForCandidate(candidate, input.winnerTaskId, input.verdict?.winnerTaskId ?? null))
  const totals = totalRow(builderRows, judgeRow, input)
  return { totals, perModel: builderRows, perJudge: judgeRow }
}

function rowForCandidate(candidate: BakeoffCandidateCompare, winnerTaskId: string | null, verdictWinnerTaskId: string | null): BakeoffStatsRow {
  const reviewPassed = candidate.eligibility.gates.reviewPassed
  const failureCategory = failureCategoryFor(candidate)
  return {
    key: candidate.agent == null ? candidate.task.taskId : candidate.agent.id,
    role: 'builder',
    agentId: candidate.agent?.id ?? null,
    agentName: candidate.agent?.name ?? null,
    model: candidate.agent?.model ?? 'unknown',
    modelLabel: candidate.agent?.modelLabel ?? null,
    provider: candidate.agent?.provider ?? null,
    harness: candidate.agent?.harness ?? 'unknown',
    costUsd: candidate.metrics.costUsd,
    costState: resolveRecordedCostTruth({
      model: candidate.agent?.model ?? null,
      tokensIn: candidate.metrics.tokensIn,
      tokensOut: candidate.metrics.tokensOut,
      costUsd: candidate.metrics.costUsd,
    }).state,
    tokensIn: candidate.metrics.tokensIn,
    tokensOut: candidate.metrics.tokensOut,
    totalTokens: candidate.metrics.totalTokens,
    elapsedSeconds: candidate.metrics.elapsedSeconds,
    attempts: candidate.metrics.attempts,
    passed: candidate.eligibility.eligible || candidate.outcome === 'accepted' || candidate.outcome === 'accepted-with-fixes',
    failed: failureCategory != null,
    malformedCount: 0,
    malformedRate: 0,
    reviewPasses: candidate.metrics.reviewPasses,
    reviewFailures: reviewPassed ? 0 : 1,
    reviewPassRate: reviewPassed ? 1 : 0,
    judge: null,
    winner: candidate.task.taskId === winnerTaskId,
    humanOverride: isHumanOverride(candidate, verdictWinnerTaskId),
    failureCategory,
  }
}

function rowForJudge(
  judge: BakeoffAgentDisplay,
  reviewTask: BakeoffTaskRunSummary,
  metrics: { costUsd: number; tokensIn: number; tokensOut: number; totalTokens: number; elapsedSeconds: number | null },
  malformed: { reviewCount: number },
  verdict: BestOfNVerdict | null,
): BakeoffStatsRow {
  const attempts = reviewTask.runIds.length
  const passed = verdict != null && malformed.reviewCount === 0 && reviewTask.failReason == null
  const failureCategory = passed ? null : malformed.reviewCount > 0 ? 'malformed' : reviewTask.failReason == null ? null : 'review_failure'
  return {
    key: judge.id,
    role: 'judge',
    agentId: judge.id,
    agentName: judge.name,
    model: judge.model,
    modelLabel: judge.modelLabel,
    provider: judge.provider,
    harness: judge.harness,
    costUsd: metrics.costUsd,
    costState: resolveRecordedCostTruth({
      model: judge.model,
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      costUsd: metrics.costUsd,
    }).state,
    tokensIn: metrics.tokensIn,
    tokensOut: metrics.tokensOut,
    totalTokens: metrics.totalTokens,
    elapsedSeconds: metrics.elapsedSeconds,
    attempts,
    passed,
    failed: failureCategory != null,
    malformedCount: malformed.reviewCount,
    malformedRate: rate(malformed.reviewCount, attempts),
    reviewPasses: passed ? 1 : 0,
    reviewFailures: passed ? 0 : attempts > 0 ? 1 : 0,
    reviewPassRate: passed ? 1 : 0,
    judge: judge.name,
    winner: false,
    humanOverride: false,
    failureCategory,
  }
}

function totalRow(
  perModel: BakeoffStatsRow[],
  perJudge: BakeoffStatsRow[],
  input: { candidates: BakeoffCandidateCompare[]; judge: BakeoffAgentDisplay | null; winnerTaskId: string | null; malformed: { reviewCount: number } },
): BakeoffStatsRow {
  const rows = [...perModel, ...perJudge]
  const { reviewPasses, reviewFailures } = reviewOutcomeCounts(perModel)
  const winner = input.candidates.find((candidate) => candidate.task.taskId === input.winnerTaskId) ?? null
  return {
    key: 'total',
    role: 'total',
    agentId: null,
    agentName: null,
    model: 'all',
    modelLabel: null,
    provider: null,
    harness: 'all',
    costUsd: roundMoney(sum(rows.map((row) => row.costUsd))),
    costState: rows.some((row) => row.costState === 'unpriced')
      ? 'unpriced'
      : rows.some((row) => row.costState === 'measured')
        ? 'measured'
        : 'unmeasured',
    tokensIn: sum(rows.map((row) => row.tokensIn)),
    tokensOut: sum(rows.map((row) => row.tokensOut)),
    totalTokens: sum(rows.map((row) => row.totalTokens)),
    elapsedSeconds: maxNullable(rows.map((row) => row.elapsedSeconds)),
    attempts: sum(rows.map((row) => row.attempts)),
    passed: perModel.some((row) => row.passed) && !perJudge.some((row) => row.failed),
    failed: perModel.every((row) => !row.passed) || perJudge.some((row) => row.failed),
    malformedCount: input.malformed.reviewCount,
    malformedRate: rate(input.malformed.reviewCount, perJudge[0]?.attempts ?? 0),
    reviewPasses,
    reviewFailures,
    reviewPassRate: rate(reviewPasses, reviewPasses + reviewFailures),
    judge: input.judge?.name ?? null,
    winner: winner != null,
    humanOverride: perModel.some((row) => row.humanOverride),
    failureCategory: aggregateFailure(perModel, perJudge),
  }
}

function reviewOutcomeCounts(perModel: BakeoffStatsRow[]): { reviewPasses: number; reviewFailures: number } {
  // Totals report builder-level review outcomes, not raw review pass events.
  return {
    reviewPasses: perModel.filter((row) => row.reviewPassRate === 1).length,
    reviewFailures: perModel.filter((row) => row.reviewFailures > 0).length,
  }
}

function failureCategoryFor(candidate: BakeoffCandidateCompare): BakeoffStatsRow['failureCategory'] {
  if (candidate.eligibility.eligible || candidate.outcome === 'accepted' || candidate.outcome === 'accepted-with-fixes') return null
  if (candidate.task.failReason != null) return 'implementation_failure'
  if (!candidate.eligibility.gates.verifyPassed || candidate.metrics.verificationFailures > 0) return 'verification_failure'
  if (!candidate.eligibility.gates.reviewPassed) return 'review_failure'
  if (candidate.eligibility.gates.safetyBlocked) return 'blocked'
  if (!candidate.eligibility.gates.artifactsAvailable) return 'missing_artifacts'
  return 'unknown'
}

function isHumanOverride(candidate: BakeoffCandidateCompare, verdictWinnerTaskId: string | null): boolean {
  if (candidate.outcome !== 'accepted' && candidate.outcome !== 'accepted-with-fixes') return false
  return verdictWinnerTaskId != null && candidate.task.taskId !== verdictWinnerTaskId
}

function aggregateFailure(perModel: BakeoffStatsRow[], perJudge: BakeoffStatsRow[]): BakeoffStatsRow['failureCategory'] {
  return perJudge.find((row) => row.failureCategory != null)?.failureCategory
    ?? perModel.find((row) => row.failureCategory != null)?.failureCategory
    ?? null
}

function runMetrics(runs: Run[]) {
  const tokensIn = sum(runs.map((run) => run.tokensIn))
  const tokensOut = sum(runs.map((run) => run.tokensOut))
  const startedAt = minDate(runs.map((run) => run.createdAt))
  const updatedAt = maxDate(runs.map((run) => run.updatedAt))
  return { tokensIn, tokensOut, totalTokens: tokensIn + tokensOut, costUsd: roundMoney(sum(runs.map((run) => run.costUsd))), elapsedSeconds: startedAt == null || updatedAt == null ? null : Math.max(0, Math.round((Date.parse(updatedAt) - Date.parse(startedAt)) / 1000)) }
}
