import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('execution integrity API behavior', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('surfaces final structured evidence on non-done runs without prose inference', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, { stage: 'implement', terminalState: 'failed' })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'internal-review', passed: true },
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { note: 'PASS: looks good' },
    })

    const response = await requestJson(fixture.app, '/api/factory/execution-integrity')

    expect(response.response.status).toBe(200)
    const report = response.json as {
      summary: {
        issueCount: number
        runModes: Record<string, number>
        issues: Array<{ scope: string; issueCode: string; projectName: string; taskName: string }>
      }
      runs: Array<{ runId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
    }
    expect(report.summary.issueCount).toBe(2)
    expect(report.summary.runModes.inconsistent).toBe(1)
    expect(report.runs.find((item) => item.runId === run.id)?.executionIssues).toEqual([
      { code: 'final_evidence_on_non_done_run', message: expect.any(String) },
      { code: 'prose_success_signal_on_non_done_run', message: expect.any(String) },
    ])
    expect(report.summary.issues[0]).toMatchObject({
      scope: 'run',
      issueCode: 'final_evidence_on_non_done_run',
      projectName: 'ductum',
      taskName: 'REST API',
    })
  })

  it('does not flag implementation verification evidence while review is pending', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, {
      stage: 'implement',
      sessionId: 'session-verify',
      worktreePaths: ['/tmp/verify-worktree'],
      commitSha: 'abc123',
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'verify', passed: true, output: 'pnpm test passed' },
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

  it('rejects manual done status without lineage or explicit external outcome', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)

    const rejected = await requestJson(fixture.app, `/api/tasks/${task.id}/status`, {
      method: 'PUT',
      body: { status: 'done' },
    })
    expect(rejected.response.status).toBe(409)
    expect(String(rejected.text)).toContain('Cannot mark task')

    const run = createRun(fixture, task, builder.id, { stage: 'done' })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'external-outcome', outcome: 'done', reason: 'operator verified externally' },
    })

    const accepted = await requestJson(fixture.app, `/api/tasks/${task.id}/status`, {
      method: 'PUT',
      body: { status: 'done' },
    })
    expect(accepted.response.status).toBe(200)
    expect((accepted.json as Task).status).toBe('done')
  })

  it('does not block manual done for unrelated run-level contradictions', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    createRun(fixture, task, builder.id, {
      stage: 'done',
      sessionId: 'session-1',
      worktreePaths: ['/tmp/worktree'],
      commitSha: 'abc123',
    })
    const sibling = createRun(fixture, task, builder.id, { stage: 'implement' })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: sibling.id,
      type: 'custom',
      payload: { kind: 'internal-review', passed: true },
    })

    const accepted = await requestJson(fixture.app, `/api/tasks/${task.id}/status`, {
      method: 'PUT',
      body: { status: 'done' },
    })

    expect(accepted.response.status).toBe(200)
    expect((accepted.json as Task).status).toBe('done')
  })

  it('rejects invalid custom outcome evidence before it can satisfy integrity', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'done' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { kind: 'external-outcome', outcome: 'tbd', reason: 'not explicit' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rejects explicit external outcomes without a reason', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'done' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { kind: 'external-outcome', outcome: 'done' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(response.json).toMatchObject({ error: expect.stringContaining('payload.reason is required') })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rejects external outcomes on non-done runs instead of storing contradictory evidence', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = createRun(fixture, task, builder.id, { stage: 'implement', terminalState: 'failed' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { kind: 'external-outcome', outcome: 'done', reason: 'operator verified externally' },
      },
    })

    expect(response.response.status).toBe(409)
    expect(response.json).toMatchObject({ error: expect.stringContaining('already be done') })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rejects success-looking custom prose evidence before run completion', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'implement', terminalState: 'failed' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { note: 'PASS: reviewed in chat' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(response.json).toMatchObject({ error: expect.stringContaining('Invalid custom evidence kind') })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rejects operator notes that look like success evidence', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'implement', terminalState: 'failed' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { kind: 'operator-note', note: 'PASS: reviewed in chat' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(response.json).toMatchObject({ error: expect.stringContaining('Success-looking custom prose') })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('accepts explicit non-success operator notes', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'implement', terminalState: 'failed' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { kind: 'operator-note', note: 'FAIL remains under review' },
      },
    })

    expect(response.response.status).toBe(201)
    expect(fixture.repos.evidence.list(run.id)).toHaveLength(1)
  })

  it('rejects custom evidence without an allowed kind', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'implement' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { note: 'plain note without kind' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(response.json).toMatchObject({ error: expect.stringContaining('Invalid custom evidence kind') })
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('rejects success-looking custom prose evidence after run completion', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'done' })

    const response = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: {
        type: 'custom',
        payload: { note: 'PASS: reviewed in chat' },
      },
    })

    expect(response.response.status).toBe(400)
    expect(fixture.repos.evidence.list(run.id)).toEqual([])
  })

  it('keeps explicit external outcome evidence visible', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const run = createRun(fixture, task, builder.id, {
      stage: 'done',
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'external-outcome',
        outcome: 'done',
        reason: 'verified out-of-band',
        source: 'operator',
        requiresOperatorReview: true,
      },
    })

    expect(fixture.repos.evidence.list(run.id).map((item) => item.payload)).toContainEqual(expect.objectContaining({
      kind: 'external-outcome',
      outcome: 'done',
      reason: 'verified out-of-band',
      source: 'operator',
      requiresOperatorReview: true,
    }))
  })

  it('keeps integrity contradictions visible in the factory summary', async () => {
    fixture = await createFixture()
    const { task } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')

    expect(response.response.status).toBe(200)
    const brief = response.json as {
      queue: { integrityIssues: number }
      integrity: {
        readiness: string
        issueCount: number
        issuesTruncated: boolean
        taskModes: Record<string, number>
        issues: Array<{ scope: string; issueCode: string; taskName: string }>
      }
      recommendedActions: string[]
    }
    expect(brief.queue.integrityIssues).toBe(1)
    expect(brief.integrity.readiness).toBe('attention')
    expect(brief.integrity.issueCount).toBe(1)
    expect(brief.integrity.issuesTruncated).toBe(false)
    expect(brief.integrity.taskModes.inconsistent).toBe(1)
    expect(brief.integrity.issues[0]).toMatchObject({
      scope: 'task',
      issueCode: 'done_task_without_lineage_or_external_outcome',
      taskName: 'REST API',
    })
    expect(brief.recommendedActions.some((action) => action.includes('ductum repair'))).toBe(true)
    expect(brief.recommendedActions.some((action) => action.includes('done_task_without_lineage_or_external_outcome'))).toBe(true)
  })

  it('keeps external outcome records visible without making readiness attention', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')
    const run = createRun(fixture, task, builder.id, { stage: 'done' })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'external-outcome',
        outcome: 'done',
        reason: 'operator verified externally',
      },
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')

    expect(response.response.status).toBe(200)
    const brief = response.json as {
      queue: { integrityIssues: number }
      integrity: { readiness: string; issueCount: number; externalTaskCount: number; externalRunCount: number }
      recommendedActions: string[]
    }
    expect(brief.queue.integrityIssues).toBe(0)
    expect(brief.integrity.readiness).toBe('clear')
    expect(brief.integrity.issueCount).toBe(0)
    expect(brief.integrity.externalTaskCount + brief.integrity.externalRunCount).toBeGreaterThan(0)
    expect(brief.recommendedActions.some((action) => action.includes('externally recorded'))).toBe(true)
  })

  it('treats completed review-only runs with internal review evidence as orchestrated', async () => {
    fixture = await createFixture()
    const { spec, reviewer } = seedBase(fixture)
    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'review-rest-api',
      prompt: 'review P4',
      repos: ['packages/api'],
      assignedAgentId: reviewer.id,
      status: 'done',
      requiredRole: 'reviewer',
      verification: [],
    })
    const run = createRun(fixture, reviewTask, reviewer.id, {
      stage: 'done',
      sessionId: 'review-session-1',
      worktreePaths: ['/tmp/review-worktree'],
      commitSha: null,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: { kind: 'internal-review', verdict: 'warn', passed: false },
    })

    const response = await requestJson(fixture.app, '/api/factory/execution-integrity')

    expect(response.response.status).toBe(200)
    const report = response.json as {
      summary: { issueCount: number }
      tasks: Array<{ taskId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
      runs: Array<{ runId: string; executionMode: string; executionIssues: Array<{ code: string }> }>
    }
    expect(report.summary.issueCount).toBe(0)
    expect(report.tasks.find((item) => item.taskId === reviewTask.id)).toMatchObject({
      executionMode: 'orchestrated',
      executionIssues: [],
    })
    expect(report.runs.find((item) => item.runId === run.id)).toMatchObject({
      executionMode: 'orchestrated',
      executionIssues: [],
    })
  })

  it('adds task integrity fields to every task read surface', async () => {
    fixture = await createFixture()
    const { project, task } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'done')

    const projectTasksResponse = await requestJson(fixture.app, `/api/projects/${project.id}/tasks`)
    const specTasksResponse = await requestJson(fixture.app, `/api/specs/${task.specId}/tasks`)
    const taskResponse = await requestJson(fixture.app, `/api/tasks/${task.id}`)

    expect(projectTasksResponse.response.status).toBe(200)
    expect(specTasksResponse.response.status).toBe(200)
    expect(taskResponse.response.status).toBe(200)
    const assertTask = (item: unknown) => expect(item).toMatchObject({
      id: task.id,
      executionMode: 'inconsistent',
      executionIssues: [{ code: 'done_task_without_lineage_or_external_outcome', message: expect.any(String) }],
    })
    const projectTasks = projectTasksResponse.json as Array<{
      id: string
      executionMode: string
      executionIssues: Array<{ code: string }>
    }>
    const specTasks = specTasksResponse.json as Array<{ id: string }>
    assertTask(projectTasks.find((item) => item.id === task.id))
    assertTask(specTasks.find((item) => item.id === task.id))
    assertTask(taskResponse.json)
  })

  it('does not write external or bakeoff outcome evidence during reconcile dry-run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = createRun(fixture, task, builder.id, { stage: 'implement' })

    const response = await requestJson(fixture.app, '/api/runs/reconcile', {
      method: 'POST',
      body: { dryRun: true },
    })

    expect(response.response.status).toBe(200)
    expect(outcomeEvidenceKinds(fixture.repos.evidence.list(run.id))).toEqual([])
  })
})

function createRun(
  fixture: TestFixture,
  task: Task,
  agentId: Run['agentId'],
  overrides: Partial<Run> = {},
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

function outcomeEvidenceKinds(evidence: Array<{ payload: Record<string, unknown> }>): unknown[] {
  return evidence
    .map((item) => item.payload.kind)
    .filter((kind) => kind === 'external-outcome' || kind === 'bakeoff-candidate-outcome')
}
