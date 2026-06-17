import type { BakeoffCandidateCompare, BakeoffCandidateScores } from './bakeoff-compare-types.js'

const WEIGHTS = {
  implementation: 0.4,
  review: 0.25,
  tests: 0.2,
  costEfficiency: 0.15,
}

export const EMPTY_BAKEOFF_SCORES: BakeoffCandidateScores = {
  implementation: 0,
  review: 0,
  tests: 0,
  costEfficiency: 0,
  overall: 0,
  reviewerConfidence: null,
}

export function scoreBakeoffCandidates(candidates: BakeoffCandidateCompare[]): BakeoffCandidateCompare[] {
  const eligibleMeasuredCosts = candidates
    .filter((candidate) => candidate.eligibility.eligible && candidate.metrics.costUsd > 0)
    .map((candidate) => candidate.metrics.costUsd)
  const minEligibleCost = eligibleMeasuredCosts.length === 0 ? null : Math.min(...eligibleMeasuredCosts)
  const maxEligibleCost = eligibleMeasuredCosts.length === 0 ? null : Math.max(...eligibleMeasuredCosts)

  return candidates.map((candidate) => {
    const implementation = implementationScore(candidate)
    const review = reviewScore(candidate)
    const tests = testScore(candidate)
    const costEfficiency = costEfficiencyScore(candidate, minEligibleCost, maxEligibleCost)
    const overall = candidate.eligibility.eligible
      ? roundScore(
        implementation * WEIGHTS.implementation
        + review * WEIGHTS.review
        + tests * WEIGHTS.tests
        + costEfficiency * WEIGHTS.costEfficiency,
      )
      : 0
    return {
      ...candidate,
      scores: {
        implementation,
        review,
        tests,
        costEfficiency,
        overall,
        reviewerConfidence: candidate.verdictScore?.confidence ?? null,
      },
    }
  })
}

function implementationScore(candidate: BakeoffCandidateCompare): number {
  const gates = candidate.eligibility.gates
  if (!gates.implementationCompleted || gates.safetyBlocked) return 0
  let score = 10
  score -= Math.max(0, candidate.metrics.attempts - 1) * 1.5
  score -= candidate.metrics.fixRounds
  if (!gates.artifactsAvailable) score -= 4
  if (candidate.outcome === 'accepted-with-fixes') score -= 1
  return roundScore(score)
}

function reviewScore(candidate: BakeoffCandidateCompare): number {
  const gates = candidate.eligibility.gates
  if (!gates.reviewPassed) return 0
  const base = candidate.verdictScore?.passed === true ? 8 : candidate.metrics.reviewPasses > 0 ? 7 : 6
  const score = base + Math.min(2, candidate.metrics.reviewPasses)
  return roundScore(gates.warnAccepted ? Math.min(score, 7) : score)
}

function testScore(candidate: BakeoffCandidateCompare): number {
  if (!candidate.eligibility.gates.verifyPassed) return 0
  return roundScore(10 - candidate.metrics.verificationFailures * 2)
}

function costEfficiencyScore(candidate: BakeoffCandidateCompare, minCost: number | null, maxCost: number | null): number {
  if (!candidate.eligibility.eligible || candidate.metrics.costUsd <= 0 || minCost == null || maxCost == null) return 0
  if (maxCost === minCost) return 10
  return roundScore(10 - ((candidate.metrics.costUsd - minCost) / (maxCost - minCost)) * 10)
}

function roundScore(value: number): number {
  return Math.round(Math.min(10, Math.max(0, value)) * 10) / 10
}
