import { createId, type Evidence, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('bakeoff outcome API integrity', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('surfaces the latest candidate outcome through the factory integrity API', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: 'model-race',
      status: 'approved',
      document: 'Compare candidates.',
      strategy: 'best_of_n',
    })
    const candidate = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'candidate-codex',
      prompt: '',
      repos: [],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'done',
      verification: [],
      strategyRole: 'candidate',
      strategyGroup: 'bon-1',
    })
    const run = createRun(fixture, candidate, builder.id)
    createOutcome(fixture, run, 'fixed')
    createOutcome(fixture, run, 'rejected')

    const response = await requestJson(fixture.app, '/api/factory/execution-integrity')
    const report = response.json as {
      tasks: Array<{ taskId: string; bakeoffOutcome: string | null; executionIssues: Array<{ code: string }> }>
    }

    expect(response.response.status).toBe(200)
    expect(report.tasks.find((item) => item.taskId === candidate.id)).toMatchObject({
      bakeoffOutcome: 'rejected',
      executionIssues: [],
    })
  })
})

function createRun(fixture: TestFixture, task: Task, agentId: Run['agentId']): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: 'feat/demo',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/worktree'],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
}

function createOutcome(fixture: TestFixture, run: Run, outcome: string): Evidence {
  return fixture.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: run.id,
    type: 'custom',
    payload: { kind: 'bakeoff-candidate-outcome', outcome },
  })
}
