import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BakeoffComparePanel } from '@/components/BakeoffComparePanel'
import { agent, spec, task } from './bakeoff-test-helpers'
import { renderWithProviders } from './test-utils'

describe('Bakeoff compare stage labels', () => {
  it('humanizes raw compare-stage fallbacks for review and verify', () => {
    renderWithProviders(
      <BakeoffComparePanel
        spec={spec()}
        tasks={[
          { ...task('task-review', 'candidate-review', 'builder-a'), strategyRole: 'candidate' },
          { ...task('task-verify', 'candidate-verify', 'builder-b'), strategyRole: 'candidate' },
        ]}
        runs={[]}
        agents={[
          agent('builder-a', 'Builder A', 'gpt-5.5', 'builder'),
          agent('builder-b', 'Builder B', 'glm-5.2', 'builder'),
        ]}
        compare={{
          spec: { id: 's1', projectId: 'p1', name: 'Best patch', status: 'approved' },
          policy: 'quality-gated-cost-aware',
          strategyGroup: 'group-1',
          status: 'complete',
          candidates: [
            candidate('task-review', 'candidate-review', 'review', agent('builder-a', 'Builder A', 'gpt-5.5', 'builder')),
            candidate('task-verify', 'candidate-verify', 'verify', agent('builder-b', 'Builder B', 'glm-5.2', 'builder')),
          ],
          reviewTask: null,
          verdict: null,
          winner: null,
          eligibility: { eligibleCount: 0, blockedCount: 2 },
          malformed: { reviewCount: 0, recoveryState: null },
          stats: { totals: { role: 'total', key: 'total', agentName: null, model: 'all', attempts: 0, passed: false, failed: false, malformedRate: 0, reviewPassRate: 0, costUsd: 0, totalTokens: 0, winner: false, humanOverride: false, failureCategory: null, judge: null }, perModel: [], perJudge: [] } as never,
          nextActions: [],
        }}
        onOpenTask={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    )

    expect(screen.getByText('Reviewing')).toBeInTheDocument()
    expect(screen.getByText('Verifying')).toBeInTheDocument()
  })
})

function candidate(taskId: string, taskName: string, latestRunStage: string, buildAgent: ReturnType<typeof agent>) {
  return {
    task: {
      taskId,
      taskName,
      taskStatus: 'active',
      runIds: [],
      latestRunId: null,
      latestRunStage,
      terminalState: null,
      blockedReason: null,
      failReason: null,
      pendingApproval: false,
      branch: null,
      commitSha: null,
      prUrl: null,
      worktreePaths: null,
    },
    agent: { id: buildAgent.id, name: buildAgent.name, model: buildAgent.model, modelLabel: buildAgent.model, provider: 'openai', harness: 'codex-sdk', effort: null, costTier: 10 },
    metrics: { tokensIn: 0, tokensOut: 0, totalTokens: 0, costUsd: 0, elapsedSeconds: 0, startedAt: null, updatedAt: null, attempts: 0, reviewPasses: 0, fixRounds: 0, verificationFailures: 0 },
    scores: { implementation: 0, review: 0, tests: 0, costEfficiency: 0, overall: 0, reviewerConfidence: null },
    outcome: null,
    verdictScore: null,
    winner: false,
    eligibility: { eligible: false, gates: { implementationCompleted: false, verifyPassed: false, reviewPassed: false, warnAccepted: false, safetyBlocked: false, artifactsAvailable: false }, blockingReasons: [] },
  }
}
