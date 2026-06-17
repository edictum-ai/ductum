import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('execution integrity failed review evidence', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('does not report explicit failed internal-review evidence as inconsistent', async () => {
    fixture = await createFixture()
    const { spec, reviewer } = seedBase(fixture)
    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-cli-smoke',
      prompt: 'review docs change',
      repos: ['docs'],
      assignedAgentId: reviewer.id,
      status: 'failed',
      requiredRole: 'reviewer',
      verification: [],
    })
    const run = createRun(fixture, reviewTask, reviewer.id, {
      stage: 'understand',
      terminalState: 'failed',
      sessionId: 'review-session-1',
      worktreePaths: ['/tmp/review-worktree'],
      commitSha: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'internal-review', verdict: 'fail', passed: false },
    })

    const response = await requestJson(fixture.app, '/api/factory/execution-integrity')

    expect(response.response.status).toBe(200)
    const report = response.json as {
      summary: { issueCount: number }
      runs: Array<{ runId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
    }
    expect(report.summary.issueCount).toBe(0)
    expect(report.runs.find((item) => item.runId === run.id)).toMatchObject({
      executionMode: 'orchestrated',
      executionIssues: [],
    })
  })
})

function createRun(
  fixture: TestFixture,
  task: Task,
  agentId: Run['agentId'],
  overrides: Partial<Run>,
): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
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
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}
