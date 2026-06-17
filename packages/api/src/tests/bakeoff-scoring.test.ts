import type { BakeoffCandidateCompare } from '../lib/bakeoff-compare-types.js'
import { EMPTY_BAKEOFF_SCORES, scoreBakeoffCandidates } from '../lib/bakeoff-scoring.js'
import { describe, expect, it } from './routes/shared.js'

describe('bakeoff scoring', () => {
  it('computes category scores and only ranks cost among eligible candidates', () => {
    const [expensiveWinner, cheapBroken] = scoreBakeoffCandidates([
      candidate({ id: 'winner', costUsd: 1.25, eligible: true, passed: true, reviewPasses: 1, confidence: 0.86 }),
      candidate({ id: 'cheap', costUsd: 0.1, eligible: false, passed: false, verificationFailures: 1 }),
    ])

    expect(expensiveWinner?.scores).toMatchObject({
      implementation: 10,
      review: 9,
      tests: 10,
      costEfficiency: 10,
      overall: 9.8,
      reviewerConfidence: 0.86,
    })
    expect(cheapBroken?.scores).toMatchObject({ review: 0, tests: 0, costEfficiency: 0, overall: 0 })
  })

  it('normalizes eligible cost efficiency against other eligible candidates', () => {
    const [cheap, expensive] = scoreBakeoffCandidates([
      candidate({ id: 'cheap', costUsd: 0.5, eligible: true, passed: true }),
      candidate({ id: 'expensive', costUsd: 2, eligible: true, passed: true }),
    ])

    expect(cheap?.scores.costEfficiency).toBe(10)
    expect(expensive?.scores.costEfficiency).toBe(0)
    expect(cheap?.scores.overall).toBeGreaterThan(expensive?.scores.overall ?? 0)
  })
})

function candidate(input: {
  id: string
  costUsd: number
  eligible: boolean
  passed: boolean
  reviewPasses?: number
  verificationFailures?: number
  confidence?: number
}): BakeoffCandidateCompare {
  return {
    task: {
      taskId: input.id,
      taskName: input.id,
      taskStatus: 'done',
      runIds: [`run-${input.id}`],
      latestRunId: `run-${input.id}`,
      latestRunStage: 'done',
      terminalState: null,
      blockedReason: null,
      failReason: null,
      pendingApproval: false,
      branch: `branch/${input.id}`,
      commitSha: 'abc123',
      prUrl: null,
      worktreePaths: [`/tmp/${input.id}`],
    },
    agent: null,
    metrics: {
      tokensIn: 100,
      tokensOut: 50,
      totalTokens: 150,
      costUsd: input.costUsd,
      elapsedSeconds: 10,
      startedAt: null,
      updatedAt: null,
      attempts: 1,
      reviewPasses: input.reviewPasses ?? 0,
      fixRounds: 0,
      verificationFailures: input.verificationFailures ?? 0,
    },
    scores: EMPTY_BAKEOFF_SCORES,
    outcome: input.passed ? 'accepted' : 'rejected',
    verdictScore: { taskId: input.id, passed: input.passed, confidence: input.confidence },
    winner: false,
    eligibility: {
      eligible: input.eligible,
      gates: {
        implementationCompleted: true,
        verifyPassed: input.verificationFailures == null,
        reviewPassed: input.passed,
        warnAccepted: false,
        safetyBlocked: false,
        artifactsAvailable: true,
      },
      blockingReasons: input.eligible ? [] : ['candidate review has not passed'],
    },
  }
}
