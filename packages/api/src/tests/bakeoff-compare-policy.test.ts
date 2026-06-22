import { createId, type Agent, type ProjectId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import type { BakeoffCompareResponse } from '../lib/bakeoff-compare.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | null = null

describe('bakeoff compare winner policy', () => {
  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('fails loudly when the structured verdict names an ineligible winner', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const bakeoff = createBakeoff(project.id, [builder, glm], reviewer, 'quality-gated-cost-aware')
    const [broken, fallback] = bakeoff.candidates
    if (broken == null || fallback == null) throw new Error('expected candidates')
    const brokenRun = createRun(broken, builder.id, 0.1)
    const fallbackRun = createRun(fallback, glm.id, 0.5)
    const reviewRun = createRun(bakeoff.reviewTask, reviewer.id, 0)
    createEvidence(brokenRun, { kind: 'verify', passed: false })
    createEvidence(fallbackRun, { kind: 'verify', passed: true })
    createEvidence(reviewRun, verdict(broken.id, bakeoff.candidates, 'quality-gated-cost-aware'))

    const response = await requestJson(fixture.app, `/api/specs/${bakeoff.specId}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.status).toBe('failed')
    expect(payload.winner).toBeNull()
    expect(payload.candidates.find((candidate) => candidate.task.taskId === broken.id)?.winner).toBe(false)
    expect(payload.nextActions[0]).toContain('did not produce an eligible winner')
  })

  it('applies cheapest-verified-reviewed only across eligible measured candidates', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const bakeoff = createBakeoff(project.id, [builder, glm], reviewer, 'cheapest-verified-reviewed')
    const [expensive, cheap] = bakeoff.candidates
    if (expensive == null || cheap == null) throw new Error('expected candidates')
    const expensiveRun = createRun(expensive, builder.id, 1.25)
    const cheapRun = createRun(cheap, glm.id, 0.1)
    const reviewRun = createRun(bakeoff.reviewTask, reviewer.id, 0)
    createEvidence(expensiveRun, { kind: 'verify', passed: true })
    createEvidence(cheapRun, { kind: 'verify', passed: true })
    createEvidence(reviewRun, verdict(expensive.id, bakeoff.candidates, 'cheapest-verified-reviewed'))

    const response = await requestJson(fixture.app, `/api/specs/${bakeoff.specId}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.status).toBe('complete')
    expect(payload.winner).toMatchObject({ taskId: cheap.id, runId: cheapRun.id, eligible: true })
    expect(payload.candidates.find((candidate) => candidate.task.taskId === cheap.id)?.winner).toBe(true)
    expect(payload.stats.totals.humanOverride).toBe(false)
  })

  it('reports an accepted router outcome even when current eligibility is blocked', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const bakeoff = createBakeoff(project.id, [builder, glm], reviewer, 'quality-gated-cost-aware')
    const [accepted, rejected] = bakeoff.candidates
    if (accepted == null || rejected == null) throw new Error('expected candidates')
    const acceptedRun = createRun(accepted, builder.id, 0.5)
    const rejectedRun = createRun(rejected, glm.id, 0.25)
    const reviewRun = createRun(bakeoff.reviewTask, reviewer.id, 0)
    createEvidence(acceptedRun, { kind: 'verify', passed: false })
    createEvidence(acceptedRun, { kind: 'bakeoff-candidate-outcome', outcome: 'accepted' })
    createEvidence(rejectedRun, { kind: 'verify', passed: true })
    createEvidence(rejectedRun, { kind: 'bakeoff-candidate-outcome', outcome: 'rejected' })
    createEvidence(reviewRun, { kind: 'best-of-n-verdict', winnerTaskId: accepted.id, policy: 'quality-gated-cost-aware' })
    createEvidence(reviewRun, { kind: 'internal-review', verdict: 'pass', passed: true, feedback: verdictFeedback(accepted.id, bakeoff.candidates) })

    const response = await requestJson(fixture.app, `/api/specs/${bakeoff.specId}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.status).toBe('complete')
    expect(payload.verdict?.winnerTaskId).toBe(accepted.id)
    expect(payload.winner).toMatchObject({ taskId: accepted.id, runId: acceptedRun.id, outcome: 'accepted', eligible: false })
    expect(payload.nextActions[0]).toContain('no operator approval is waiting')
    expect(payload.candidates.find((candidate) => candidate.task.taskId === accepted.id)).toMatchObject({
      winner: true,
      eligibility: { eligible: false },
    })
  })

  it('does not label an accepted candidate as human override without a structured verdict winner', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const bakeoff = createBakeoff(project.id, [builder, glm], reviewer, 'quality-gated-cost-aware')
    const [accepted, other] = bakeoff.candidates
    if (accepted == null || other == null) throw new Error('expected candidates')
    const acceptedRun = createRun(accepted, builder.id, 0.5)
    createRun(other, glm.id, 0.25)
    createEvidence(acceptedRun, { kind: 'verify', passed: true })
    createEvidence(acceptedRun, { kind: 'bakeoff-candidate-outcome', outcome: 'accepted' })

    const response = await requestJson(fixture.app, `/api/specs/${bakeoff.specId}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.winner?.taskId).toBe(accepted.id)
    expect(payload.stats.perModel.find((row) => row.agentId === builder.id)?.humanOverride).toBe(false)
    expect(payload.stats.totals.humanOverride).toBe(false)
  })

  it('keeps total pass/fail mutually exclusive when the judge row fails', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const bakeoff = createBakeoff(project.id, [builder, glm], reviewer, 'quality-gated-cost-aware')
    const [accepted, other] = bakeoff.candidates
    if (accepted == null || other == null) throw new Error('expected candidates')
    const acceptedRun = createRun(accepted, builder.id, 0.5)
    createRun(other, glm.id, 0.25)
    const reviewRun = createRun(bakeoff.reviewTask, reviewer.id, 0)
    fixture.repos.runs.updateFailure(reviewRun.id, 'review failed', false)
    createEvidence(acceptedRun, { kind: 'verify', passed: true })
    createEvidence(acceptedRun, { kind: 'bakeoff-candidate-outcome', outcome: 'accepted' })
    createEvidence(reviewRun, { kind: 'internal-review', verdict: 'pass', passed: true, feedback: '{malformed' })

    const response = await requestJson(fixture.app, `/api/specs/${bakeoff.specId}/bakeoff/compare`)
    const payload = response.json as BakeoffCompareResponse

    expect(response.response.status).toBe(200)
    expect(payload.stats.totals.passed).toBe(false)
    expect(payload.stats.totals.failed).toBe(true)
  })
})

function createBakeoff(projectId: ProjectId, builders: Agent[], reviewer: Agent, policy: 'quality-gated-cost-aware' | 'cheapest-verified-reviewed') {
  if (fixture == null) throw new Error('fixture not set')
  const group = createId<'TaskId'>()
  const spec = fixture.repos.specs.create({
    id: createId<'SpecId'>(),
    projectId,
    name: 'Best policy patch',
    status: 'approved',
    strategy: 'best_of_n',
    strategyConfig: {
      kind: 'best_of_n',
      policy,
      strategyGroup: group,
      builderAgentIds: builders.map((builder) => builder.id),
      reviewerAgentId: reviewer.id,
      verify: ['pnpm test'],
    },
    document: 'Implement it.',
  })
  const candidates = builders.map((builder, index) =>
    fixture!.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `candidate-${index + 1}`,
      prompt: 'Implement it.',
      repos: [],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'done',
      verification: ['pnpm test'],
      strategyRole: 'candidate',
      strategyGroup: group,
    }),
  )
  const reviewTask = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: 'blind-review',
    prompt: 'Review it.',
    repos: [],
    assignedAgentId: reviewer.id,
    requiredRole: 'reviewer',
    status: 'done',
    verification: [],
    strategyRole: 'blind_review',
    strategyGroup: group,
  })
  return { specId: spec.id, candidates, reviewTask }
}

function createProjectAgent(projectId: ProjectId, name: string, model: string, role: 'builder' | 'reviewer'): Agent {
  if (fixture == null) throw new Error('fixture not set')
  const agent = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name,
    model,
    harness: 'codex-sdk',
    capabilities: role === 'builder' ? ['build', 'test'] : ['review'],
    costTier: 50,
    spawnConfig: {},
  })
  fixture.repos.projectAgents.assign({ projectId, agentId: agent.id, role })
  return agent
}

function createRun(task: Task, agentId: Agent['id'], costUsd: number): Run {
  if (fixture == null) throw new Error('fixture not set')
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
    commitSha: `${task.id.slice(0, 8)}abc`,
    prNumber: null,
    prUrl: null,
    worktreePaths: [`/tmp/${task.id}`],
    ciStatus: 'pass',
    reviewStatus: 'pass',
    failReason: null,
    recoverable: false,
    tokensIn: 100,
    tokensOut: 50,
    costUsd,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  })
}

function createEvidence(run: Run, payload: Record<string, unknown>) {
  if (fixture == null) throw new Error('fixture not set')
  return fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: run.id, type: 'custom', payload })
}

function verdict(winnerTaskId: string, candidates: Task[], policy: string) {
  return {
    kind: 'best-of-n-verdict',
    winnerTaskId,
    scores: candidates.map((task) => ({ taskId: task.id, passed: true, notes: `${task.name} reviewed` })),
    policy,
    reason: 'judge preferred this candidate',
  }
}

function verdictFeedback(winnerTaskId: string, candidates: Task[]) {
  const { kind: _kind, ...bestOfN } = verdict(winnerTaskId, candidates, 'quality-gated-cost-aware')
  return JSON.stringify({
    kind: 'ductum-review-result',
    verdict: 'pass',
    summary: 'structured verdict attached',
    findings: [],
    bestOfN,
  })
}
