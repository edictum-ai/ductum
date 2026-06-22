import { describe, expect, it, vi } from 'vitest'
import type { BakeoffCompareResponse } from '../types.js'
import { createMockApi, project, runCommand } from './helpers.js'

describe('spec bakeoff compare actions', () => {
  it('prints approveWinner only while the winning run is pending approval', async () => {
    const pending = compareResponse(true, ['Review candidate task-winner; approve through the normal Ductum approval flow if it should ship.'])
    const pendingResult = await runCommand(['spec', 'bakeoff', 'compare', pending.spec.id], createMockApi({
      getBakeoffCompare: vi.fn().mockResolvedValue(pending),
    }))

    expect(pendingResult.code).toBe(0)
    expect(pendingResult.text).toContain('ductum approve run-winner')

    const accepted = compareResponse(false, ['Winner candidate task-winner is already accepted; no operator approval is waiting.'])
    const acceptedResult = await runCommand(['spec', 'bakeoff', 'compare', accepted.spec.id], createMockApi({
      getBakeoffCompare: vi.fn().mockResolvedValue(accepted),
    }))

    expect(acceptedResult.code).toBe(0)
    expect(acceptedResult.text).not.toContain('ductum approve run-winner')
    expect(acceptedResult.text).toContain('no operator approval is waiting')
  })
})

function compareResponse(pendingApproval: boolean, nextActions: string[]): BakeoffCompareResponse {
  return {
    spec: { id: 'spec-bakeoff', projectId: project.id, name: 'Best patch', status: 'approved' },
    policy: 'quality-gated-cost-aware',
    strategyGroup: 'strategy-bon',
    status: 'complete',
    candidates: [{
      task: taskSummary(pendingApproval),
      agent: { id: 'agent-opus', name: 'opus', model: 'claude-opus-4-8', modelLabel: 'Opus 4.8', provider: 'anthropic', harness: 'claude-agent-sdk', effort: null, costTier: 80 },
      metrics: { tokensIn: 100, tokensOut: 20, totalTokens: 120, costUsd: 0.2, elapsedSeconds: null, startedAt: null, updatedAt: null, attempts: 1, reviewPasses: 1, fixRounds: 0, verificationFailures: 0 },
      scores: { implementation: 10, review: 10, tests: 10, costEfficiency: 0, overall: 9, reviewerConfidence: 0.9 },
      outcome: 'accepted',
      verdictScore: { taskId: 'task-winner', passed: true, confidence: 0.9, notes: 'clean' },
      winner: true,
      eligibility: { eligible: true, gates: { implementationCompleted: true, verifyPassed: true, reviewPassed: true, warnAccepted: false, safetyBlocked: false, artifactsAvailable: true }, blockingReasons: [] },
    }],
    reviewTask: null,
    verdict: { kind: 'best-of-n-verdict', winnerTaskId: 'task-winner', scores: [{ taskId: 'task-winner', passed: true }], policy: 'quality-gated-cost-aware', reason: 'clean' },
    winner: { taskId: 'task-winner', runId: 'run-winner', outcome: 'accepted', eligible: true },
    eligibility: { eligibleCount: 1, blockedCount: 0 },
    malformed: { reviewCount: 0, recoveryState: null },
    stats: {
      totals: { role: 'total', key: 'total', agentName: null, model: 'all', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 0.2, totalTokens: 120, winner: true, humanOverride: false, failureCategory: null, judge: null },
      perModel: [{ role: 'builder', key: 'agent-opus', agentName: 'opus', model: 'claude-opus-4-8', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 0.2, totalTokens: 120, winner: true, humanOverride: false, failureCategory: null }],
      perJudge: [],
    } as unknown as BakeoffCompareResponse['stats'],
    nextActions,
  }
}

function taskSummary(pendingApproval: boolean): BakeoffCompareResponse['candidates'][number]['task'] {
  return {
    taskId: 'task-winner',
    taskName: 'candidate-1',
    taskStatus: 'done',
    runIds: ['run-winner'],
    latestRunId: 'run-winner',
    latestRunStage: pendingApproval ? 'ship' : 'done',
    terminalState: null,
    blockedReason: null,
    failReason: null,
    pendingApproval,
    branch: 'ductum/candidate-1',
    commitSha: 'abc123',
    prUrl: null,
    worktreePaths: ['/tmp/candidate-1'],
  }
}
