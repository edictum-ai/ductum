import { createId, type Agent, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { BakeoffCompareResponse } from '../lib/bakeoff-compare.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('bakeoff compare safety gates', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('reports a failed blind review as an actionable failed bakeoff', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const group = createId<'TaskId'>()
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'Best lifecycle repair',
      status: 'implementing',
      strategy: 'best_of_n',
      strategyConfig: {
        kind: 'best_of_n',
        policy: 'quality-gated-cost-aware',
        strategyGroup: group,
        builderAgentIds: [builder.id],
        reviewerAgentId: reviewer.id,
        verify: [],
      },
      document: 'Compare candidates.',
    })
    const candidateA = createCandidate(fixture, spec.id, builder.id, group, 'candidate-a')
    const candidateB = createCandidate(fixture, spec.id, builder.id, group, 'candidate-b')
    createRun(fixture, candidateA, builder.id)
    createRun(fixture, candidateB, builder.id)
    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'blind-review',
      prompt: 'choose',
      repos: [],
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'failed',
      verification: [],
      strategyRole: 'blind_review',
      strategyGroup: group,
    })
    createRun(fixture, reviewTask, reviewer.id, {
      terminalState: 'failed',
      failReason: 'blind review completion is malformed; structured verdict evidence cannot override a missing ductum-review-result contract',
    })

    const response = await requestJson(fixture.app, `/api/specs/${spec.id}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.status).toBe('failed')
    expect(payload.reviewTask?.taskStatus).toBe('failed')
    expect(payload.malformed.reviewCount).toBe(1)
    expect(payload.malformed.recoveryState).toContain('blind review completion is malformed')
    expect(payload.nextActions.join(' ')).toContain('Inspect failed candidate/review evidence')
  })

  it('marks observed blocked gates as ineligible safety blockers', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const group = createId<'TaskId'>()
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'Best safety patch',
      status: 'approved',
      strategy: 'best_of_n',
      strategyConfig: {
        kind: 'best_of_n',
        policy: 'quality-gated-cost-aware',
        strategyGroup: group,
        builderAgentIds: [builder.id],
        reviewerAgentId: builder.id,
        verify: ['pnpm test'],
      },
      document: 'Implement it.',
    })
    const candidate = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'candidate-1',
      prompt: 'Implement it.',
      repos: [],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'done',
      verification: ['pnpm test'],
      strategyRole: 'candidate',
      strategyGroup: group,
    })
    const run = createRun(fixture, candidate, builder.id)
    fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: run.id, type: 'custom', payload: { kind: 'verify', passed: true } })
    fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: run.id, type: 'custom', payload: { kind: 'internal-review', verdict: 'pass', passed: true } })
    fixture.repos.gateEvaluations.create({
      runId: run.id,
      gateType: 'authorize_tool',
      target: 'Bash(rm -rf /)',
      result: 'blocked',
      reason: 'observer-mode block',
      observed: true,
    })

    const response = await requestJson(fixture.app, `/api/specs/${spec.id}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.candidates[0]?.eligibility).toMatchObject({
      eligible: false,
      gates: { safetyBlocked: true },
    })
    expect(payload.candidates[0]?.eligibility.blockingReasons).toContain('candidate has a blocking gate or blocked run state')
    expect(payload.candidates[0]?.scores.overall).toBe(0)
  })
})

function createRun(fixture: TestFixture, task: Task, agentId: Agent['id'], overrides: Partial<Run> = {}): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement', 'ship'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: `session-${task.id}`,
    branch: `ductum/${task.name}`,
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: [`/tmp/${task.id}`],
    ciStatus: 'pass',
    reviewStatus: 'pass',
    failReason: null,
    recoverable: false,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.25,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}

function createCandidate(fixture: TestFixture, specId: Task['specId'], agentId: Agent['id'], group: string, name: string): Task {
  return fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId,
    name,
    prompt: 'Implement it.',
    repos: [],
    assignedAgentId: agentId,
    requiredRole: 'builder',
    status: 'done',
    verification: [],
    strategyRole: 'candidate',
    strategyGroup: group,
  })
}
