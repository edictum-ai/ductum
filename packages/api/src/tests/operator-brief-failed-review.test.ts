import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory summary failed review visibility', () => {
  let fixture: TestFixture | null = null
  afterEach(() => { fixture?.close(); fixture = null })

  it('counts a failed review task as needs-operator after parent completion', async () => {
    fixture = await createFixture()
    const { spec, task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const parent = createRun(task, builder.id, { stage: 'done' })
    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(), specId: spec.id, name: `review-${task.name}`,
      prompt: 'review', repos: task.repos, assignedAgentId: reviewer.id,
      requiredRole: 'reviewer', status: 'failed', verification: [],
    })
    createRun(reviewTask, reviewer.id, {
      parentRunId: parent.id, terminalState: 'failed', failReason: 'malformed reviewer completion',
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    const brief = response.json as { queue: Record<string, number> }
    expect(response.response.status).toBe(200)
    expect(brief.queue.needsOperator).toBe(1)
    expect(brief.queue.activeRuns).toBe(0)
  })

  function createRun(task: Task, agentId: Run['agentId'], overrides: Partial<Run> = {}): Run {
    return fixture!.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null, branch: null,
      commitSha: null, prNumber: null, prUrl: null, worktreePaths: null,
      ciStatus: null, reviewStatus: null, failReason: null, recoverable: true,
      tokensIn: 0, tokensOut: 0, costUsd: 0, lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120, ...overrides,
    })
  }
})
