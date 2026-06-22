import { describe, expect, it } from 'vitest'
import type { BestOfNVerdict } from '@ductum/core'

import { buildBakeoffStats } from '../lib/bakeoff-stats.js'
import type { BakeoffAgentDisplay, BakeoffCandidateCompare, BakeoffTaskRunSummary } from '../lib/bakeoff-compare-types.js'

describe('buildBakeoffStats', () => {
  it('aggregates review pass rate by candidate outcomes, not raw pass events', () => {
    const stats = buildBakeoffStats({
      candidates: [
        candidate({ id: 'task-pass', reviewPassed: true, reviewPasses: 5 }),
        candidate({ id: 'task-fail', reviewPassed: false, reviewPasses: 0 }),
      ],
      reviewTask: reviewTask({ failReason: null }),
      judge: judge(),
      judgeRuns: [],
      verdict: verdict('task-pass'),
      winnerTaskId: 'task-pass',
      malformed: { reviewCount: 0, recoveryState: null },
    })

    expect(stats.totals.reviewPasses).toBe(1)
    expect(stats.totals.reviewFailures).toBe(1)
    expect(stats.totals.reviewPassRate).toBe(0.5)
  })

  it('classifies failed judge work as a review failure', () => {
    const stats = buildBakeoffStats({
      candidates: [candidate({ id: 'task-pass', reviewPassed: true, reviewPasses: 1 })],
      reviewTask: reviewTask({ failReason: 'review command failed' }),
      judge: judge(),
      judgeRuns: [],
      verdict: null,
      winnerTaskId: null,
      malformed: { reviewCount: 0, recoveryState: null },
    })

    expect(stats.perJudge[0]?.failureCategory).toBe('review_failure')
    expect(stats.totals.failureCategory).toBe('review_failure')
  })
})

function candidate(input: { id: string; reviewPassed: boolean; reviewPasses: number }): BakeoffCandidateCompare {
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
      branch: null,
      commitSha: null,
      prUrl: null,
      worktreePaths: null,
    },
    agent: {
      id: `agent-${input.id}`,
      name: `agent-${input.id}`,
      model: `model-${input.id}`,
      modelLabel: null,
      provider: null,
      harness: 'codex',
      effort: null,
      costTier: 1,
    },
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      totalTokens: 0,
      costUsd: 0,
      elapsedSeconds: null,
      startedAt: null,
      updatedAt: null,
      attempts: 1,
      reviewPasses: input.reviewPasses,
      fixRounds: 0,
      verificationFailures: 0,
    },
    scores: { implementation: 0, review: 0, tests: 0, costEfficiency: 0, overall: 0, reviewerConfidence: null },
    outcome: input.reviewPassed ? 'accepted' : null,
    verdictScore: null,
    winner: false,
    eligibility: {
      eligible: input.reviewPassed,
      gates: {
        implementationCompleted: true,
        verifyPassed: true,
        reviewPassed: input.reviewPassed,
        warnAccepted: true,
        safetyBlocked: false,
        artifactsAvailable: true,
      },
      blockingReasons: [],
    },
  }
}

function judge(): BakeoffAgentDisplay {
  return { id: 'judge', name: 'judge', model: 'judge-model', modelLabel: null, provider: null, harness: 'codex', effort: null, costTier: 1 }
}

function reviewTask(input: { failReason: string | null }): BakeoffTaskRunSummary {
  return {
    taskId: 'review',
    taskName: 'review',
    taskStatus: input.failReason == null ? 'done' : 'failed',
    runIds: ['review-run'],
    latestRunId: 'review-run',
    latestRunStage: input.failReason == null ? 'done' : null,
    terminalState: input.failReason == null ? null : 'failed',
    blockedReason: null,
    failReason: input.failReason,
    pendingApproval: false,
    branch: null,
    commitSha: null,
    prUrl: null,
    worktreePaths: null,
  }
}

function verdict(winnerTaskId: string): BestOfNVerdict {
  return { kind: 'best-of-n-verdict', winnerTaskId, scores: [], policy: 'quality-gated-cost-aware', reason: 'ok' }
}
