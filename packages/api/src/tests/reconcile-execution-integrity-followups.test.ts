import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('reconcile execution-integrity follow-ups', () => {
  it('treats reconcile lineage evidence as orchestrated in the API report', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const run = createRun(task, builder.id, {
      stage: 'done',
      sessionId: null,
      worktreePaths: null,
      commitSha: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'state-reconcile', reason: 'merged', mergeCommit: 'abc123' },
    })

    const response = await requestJson(fixture.app, '/api/factory/execution-integrity')

    expect(response.response.status).toBe(200)
    const report = response.json as {
      tasks: Array<{ taskId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
      runs: Array<{ runId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
    }
    expect(report.tasks.find((item) => item.taskId === task.id)).toMatchObject({
      executionMode: 'orchestrated',
      executionIssues: [],
    })
    expect(report.runs.find((item) => item.runId === run.id)).toMatchObject({
      executionMode: 'orchestrated',
      executionIssues: [],
    })
  })

  it('keeps manual done blocked when the only external outcome is on a non-done run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(task, builder.id, {
      stage: 'implement',
      terminalState: 'failed',
      sessionId: null,
      worktreePaths: null,
      commitSha: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'external-outcome', outcome: 'fixed', reason: 'operator fixed it elsewhere' },
    })

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/status`, {
      method: 'PUT',
      body: { status: 'done' },
    })

    expect(response.response.status).toBe(409)
    expect(String(response.text)).toContain('Cannot mark task')
    expect(response.json).toMatchObject({
      details: {
        executionIntegrity: {
          executionMode: 'inconsistent',
          hasDuctumLineage: false,
          hasExternalOutcome: false,
          externalOutcome: null,
          executionIssues: [
            { code: 'external_outcome_on_non_done_run' },
            { code: 'done_task_without_lineage_or_external_outcome' },
          ],
        },
      },
    })
  })
})

function createRun(task: Task, agentId: Run['agentId'], overrides: Partial<Run> = {}): Run {
  if (fixture == null) throw new Error('test fixture missing')
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
    ...overrides,
  })
}
