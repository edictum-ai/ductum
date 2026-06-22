import type { Agent, ProjectId, Run, Task } from '@ductum/core'
import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import { createId, describe, expect, it, registerRouteTestCleanup } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - bakeoff verdict evidence', () => {
  it('prompts blind reviewers to use context and complete with the verdict JSON', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm-builder', 'glm-5.2', 'builder')
    const reviewer = createProjectAgent(project.id, 'gpt55-reviewer', 'gpt-5.5', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Context prompt',
        prompt: 'Implement it.',
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(result.response.status).toBe(201)
    const reviewTask = (result.json as { reviewTask: Task }).reviewTask
    expect(reviewTask.prompt).toContain('ductum_get_context')
    expect(reviewTask.prompt).toContain('Put this JSON block in the `ductum_complete` result')
  })

  it('normalizes best-of-n verdict evidence from the agent evidence tool', async () => {
    fixture = await createFixture()
    const { builder, spec } = seedBase(fixture)
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'blind-review',
      prompt: 'Review it.',
      repos: [],
      assignedAgentId: builder.id,
      requiredRole: 'reviewer',
      status: 'active',
      verification: [],
      strategyRole: 'blind_review',
      strategyGroup: 'bon-1',
    })
    const run = createRun(task, builder.id)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'best-of-n-verdict',
        payload: {
          kind: 'best-of-n-verdict',
          winnerTaskId: 'candidate-task',
          scores: [{ taskId: 'candidate-task', passed: true }],
          policy: 'quality-gated-cost-aware',
          reason: 'best candidate',
        },
      },
    })

    expect(result.response.status).toBe(201)
    expect(fixture.repos.evidence.list(run.id)[0]).toMatchObject({
      type: 'custom',
      payload: { kind: 'best-of-n-verdict', winnerTaskId: 'candidate-task' },
    })
  })
})

function createProjectAgent(projectId: ProjectId, name: string, model: string, role: 'builder' | 'reviewer'): Agent {
  if (fixture == null) throw new Error('fixture not set')
  const agent = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name,
    model,
    harness: 'codex-sdk',
    capabilities: role === 'builder' ? ['build', 'test'] : ['review'],
    costTier: role === 'builder' ? 40 : 80,
    spawnConfig: {},
  })
  fixture.repos.projectAgents.assign({ projectId, agentId: agent.id, role })
  return agent
}

function createRun(task: Task, agentId: Agent['id']): Run {
  if (fixture == null) throw new Error('fixture not set')
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: `session-${task.id}`,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  })
}
