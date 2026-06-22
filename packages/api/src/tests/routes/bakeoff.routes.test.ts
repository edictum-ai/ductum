import type { Agent, ProjectId, Run, Task } from '@ductum/core'
import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import type { BakeoffCompareResponse } from '../../lib/bakeoff-compare.js'
import { createId, describe, expect, it, registerRouteTestCleanup } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - Best-of-N bakeoffs', () => {
  it('creates candidate tasks and one blocked blind-review task', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const reviewer = createProjectAgent(project.id, 'gpt55-reviewer', 'gpt-5.5', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Best API patch',
        prompt: 'Implement the API patch',
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
        verify: ['pnpm test'],
      },
    })

    expect(result.response.status).toBe(201)
    const payload = result.json as BakeoffCreateResponse
    expect(payload.spec).toMatchObject({
      name: 'Best API patch',
      status: 'approved',
      strategy: 'best_of_n',
      strategyConfig: {
        kind: 'best_of_n',
        policy: 'quality-gated-cost-aware',
        strategyGroup: payload.strategyGroup,
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
        verify: ['pnpm test'],
      },
    })
    expect(payload.candidates).toHaveLength(2)
    expect(payload.candidates.map((task) => task.name)).toEqual(['candidate-1', 'candidate-2'])
    expect(payload.reviewTask.prompt).not.toContain(builder.name)
    expect(payload.reviewTask.prompt).not.toContain(glm.name)
    expect(payload.reviewTask).toMatchObject({
      name: 'blind-review',
      status: 'blocked',
      assignedAgentId: reviewer.id,
      strategyRole: 'blind_review',
    })
    expect(new Set(payload.candidates.map((task) => task.strategyGroup))).toEqual(new Set([payload.strategyGroup]))
    expect(payload.reviewTask.strategyGroup).toBe(payload.strategyGroup)
    expect(payload.candidates.map((task) => task.status)).toEqual(['ready', 'ready'])
    expect(payload.candidates.map((task) => task.strategyRole)).toEqual(['candidate', 'candidate'])
    expect(payload.candidates.map((task) => task.verification)).toEqual([['pnpm test'], ['pnpm test']])
    expect(new Set(fixture.repos.taskDependencies.list(payload.reviewTask.id).map((dependency) => dependency.dependsOnId))).toEqual(
      new Set(payload.candidates.map((candidate) => candidate.id)),
    )
  })

  it('rejects fewer than two builders', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Too small',
        prompt: 'Do it',
        builderAgentIds: [builder.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/at least two builders/)
  })

  it('rejects an empty prompt at the API boundary', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'No prompt',
        prompt: '   ',
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/prompt (is required|must not be empty)/)
  })

  it('rejects same-model reviewer and builder pairs', async () => {
    fixture = await createFixture()
    const { project, builder, reviewer } = seedBase(fixture)
    const sameModelBuilder = createProjectAgent(project.id, 'same-model-builder', reviewer.model, 'builder')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Bad reviewer',
        prompt: 'Do it',
        builderAgentIds: [builder.id, sameModelBuilder.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toMatch(/Reviewer model must be different/)
  })

  it('defaults to Opus 4.8 when builders are not Claude models', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const gptBuilder = createProjectAgent(project.id, 'gpt-builder', 'gpt-5.5', 'builder')
    const glmBuilder = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const opusReviewer = createProjectAgent(project.id, 'opus-reviewer', 'claude-opus-4.8', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Default reviewer',
        prompt: 'Do it',
        builderAgentIds: [gptBuilder.id, glmBuilder.id],
      },
    })

    expect(result.response.status).toBe(201)
    expect((result.json as BakeoffCreateResponse).reviewer.id).toBe(opusReviewer.id)
  })

  it('defaults to GPT 5.5 when any builder uses a Claude model', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const glmBuilder = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const gptReviewer = createProjectAgent(project.id, 'gpt55-reviewer', 'gpt-5.5', 'reviewer')
    createProjectAgent(project.id, 'opus-reviewer', 'claude-opus-4.8', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Claude default reviewer',
        prompt: 'Do it',
        builderAgentIds: [builder.id, glmBuilder.id],
      },
    })

    expect(result.response.status).toBe(201)
    expect((result.json as BakeoffCreateResponse).reviewer.id).toBe(gptReviewer.id)
  })

  it('redacts reviewer spawn config in the response', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const gptBuilder = createProjectAgent(project.id, 'gpt-builder', 'gpt-5.5', 'builder')
    const glmBuilder = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const reviewer = createProjectAgent(project.id, 'opus-reviewer', 'claude-opus-4.8', 'reviewer', {
      env: { API_TOKEN: 'not-a-real-route-test-token' },
    })

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Redacted reviewer',
        prompt: 'Do it',
        builderAgentIds: [gptBuilder.id, glmBuilder.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(result.response.status).toBe(201)
    expect(JSON.stringify((result.json as BakeoffCreateResponse).reviewer.spawnConfig)).not.toContain('not-a-real-route-test-token')
  })

  it('exposes status and compare aggregates without approving or merging', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const reviewer = createProjectAgent(project.id, 'gpt55-reviewer', 'gpt-5.5', 'reviewer')
    const created = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Compare API',
        prompt: 'Implement the compare API',
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
        verify: ['pnpm test'],
      },
    })
    const bakeoff = created.json as BakeoffCreateResponse

    const status = await requestJson(fixture.app, `/api/specs/${bakeoff.spec.id}/bakeoff/status`)
    expect(status.response.status).toBe(200)
    expect((status.json as BakeoffCompareResponse).status).toBe('pending')
    expect((status.json as BakeoffCompareResponse).candidates[0]?.eligibility.blockingReasons).toContain('implementation is not complete')

    const [winnerTask, loserTask] = bakeoff.candidates
    if (winnerTask == null || loserTask == null) throw new Error('expected two candidates')
    fixture.repos.tasks.updateStatus(winnerTask.id, 'done')
    fixture.repos.tasks.updateStatus(loserTask.id, 'done')
    fixture.repos.tasks.updateStatus(bakeoff.reviewTask.id, 'done')
    const winnerRun = createRun(winnerTask, builder.id, { tokensIn: 120, tokensOut: 80, costUsd: 1.25, pendingApproval: true })
    const loserRun = createRun(loserTask, glm.id, { tokensIn: 40, tokensOut: 20, costUsd: 0.1 })
    const reviewRun = createRun(bakeoff.reviewTask, reviewer.id)
    createEvidence(winnerRun, { kind: 'verify', passed: true, output: 'ok' })
    createEvidence(winnerRun, { kind: 'internal-review', verdict: 'pass', passed: true })
    createEvidence(winnerRun, { kind: 'bakeoff-candidate-outcome', outcome: 'accepted' })
    createEvidence(loserRun, { kind: 'verify', passed: false, output: 'tests failed' })
    createEvidence(loserRun, { kind: 'bakeoff-candidate-outcome', outcome: 'rejected' })
    createEvidence(reviewRun, {
      kind: 'best-of-n-verdict',
      winnerTaskId: loserTask.id,
      scores: [
        { taskId: winnerTask.id, passed: true, notes: 'cleaner implementation' },
        { taskId: loserTask.id, passed: false, notes: 'verification failed' },
      ],
      policy: 'quality-gated-cost-aware',
      reason: 'winner passed review and verification',
    })

    const compare = await requestJson(fixture.app, `/api/specs/${bakeoff.spec.id}/bakeoff/compare`)
    expect(compare.response.status).toBe(200)
    const payload = compare.json as BakeoffCompareResponse
    expect(payload.status).toBe('complete')
    expect(payload.winner).toMatchObject({ taskId: winnerTask.id, runId: winnerRun.id, outcome: 'accepted', eligible: true })
    expect(payload.reviewTask?.latestRunId).toBe(reviewRun.id)
    expect(payload.nextActions[0]).toContain('normal Ductum approval flow')
    const winner = payload.candidates.find((candidate) => candidate.task.taskId === winnerTask.id)
    const loser = payload.candidates.find((candidate) => candidate.task.taskId === loserTask.id)
    expect(winner).toMatchObject({
      winner: true,
      agent: { id: builder.id, name: builder.name, model: builder.model },
      metrics: { tokensIn: 120, tokensOut: 80, totalTokens: 200, costUsd: 1.25, reviewPasses: 1 },
      eligibility: { eligible: true },
    })
    expect(winner?.verdictScore).toMatchObject({ passed: true, notes: 'cleaner implementation' })
    expect(loser?.metrics.verificationFailures).toBe(1)
    expect(loser?.eligibility).toMatchObject({ eligible: false })
    expect(loser?.eligibility.blockingReasons).toContain('candidate review has not passed')
  })
})

interface BakeoffCreateResponse { spec: { id: string; name: string; status: string; strategy: string }; candidates: Task[]; reviewTask: Task; strategyGroup: string; reviewer: Agent }

function createProjectAgent(projectId: ProjectId, name: string, model: string, role: 'builder' | 'reviewer', spawnConfig: Agent['spawnConfig'] = {}): Agent {
  if (fixture == null) throw new Error('fixture not set')
  const agent = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name,
    model,
    harness: 'codex-sdk',
    capabilities: role === 'builder' ? ['build', 'test'] : ['review'],
    costTier: role === 'builder' ? 40 : 80,
    spawnConfig,
  })
  fixture.repos.projectAgents.assign({ projectId, agentId: agent.id, role })
  return agent
}

function createRun(task: Task, agentId: Agent['id'], overrides: Partial<Pick<Run, 'tokensIn' | 'tokensOut' | 'costUsd' | 'pendingApproval'>> = {}): Run {
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
    pendingApproval: overrides.pendingApproval ?? false,
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
    tokensIn: overrides.tokensIn ?? 0,
    tokensOut: overrides.tokensOut ?? 0,
    costUsd: overrides.costUsd ?? 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  })
}

function createEvidence(run: Run, payload: Record<string, unknown>) {
  if (fixture == null) throw new Error('fixture not set')
  return fixture.repos.evidence.create({ id: createId<'EvidenceId'>(), runId: run.id, type: 'custom', payload })
}
