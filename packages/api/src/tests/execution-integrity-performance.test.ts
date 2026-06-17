import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('execution integrity route batching', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('uses batched run and evidence loading for report and list routes', async () => {
    fixture = await createFixture()
    const { project, spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const siblingTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'CLI',
      prompt: 'ship cli',
      repos: ['packages/cli'],
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'done',
      verification: [],
    })
    createRun(fixture, task, builder.id, 'session-1', 'abc123')
    createRun(fixture, siblingTask, builder.id, 'session-2', 'def456')

    const runListSpy = vi.spyOn(fixture.repos.runs, 'list')
    const runGetSpy = vi.spyOn(fixture.repos.runs, 'get')
    const evidenceListSpy = vi.spyOn(fixture.repos.evidence, 'list')

    const [report, projectTasks, projectRuns, specTasks] = await Promise.all([
      requestJson(fixture.app, '/api/factory/execution-integrity'),
      requestJson(fixture.app, `/api/projects/${project.id}/tasks`),
      requestJson(fixture.app, `/api/projects/${project.id}/runs`),
      requestJson(fixture.app, `/api/specs/${spec.id}/tasks`),
    ])

    expect(report.response.status).toBe(200)
    expect(projectTasks.response.status).toBe(200)
    expect(projectRuns.response.status).toBe(200)
    expect(specTasks.response.status).toBe(200)
    expect(runListSpy).not.toHaveBeenCalled()
    expect(runGetSpy).not.toHaveBeenCalled()
    expect(evidenceListSpy).not.toHaveBeenCalled()
  })
})

function createRun(
  fixture: TestFixture,
  task: Task,
  agentId: Run['agentId'],
  sessionId: string,
  commitSha: string,
): Run {
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
    sessionId,
    branch: `feat/${task.name.toLowerCase()}`,
    commitSha,
    prNumber: null,
    prUrl: null,
    worktreePaths: [`/tmp/${task.id}`],
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
