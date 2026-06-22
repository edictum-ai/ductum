import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  vi,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - operator pause/resume', () => {
  it('pauses an active latest run and preserves it as a resumable terminal state', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/pause`, {
      method: 'POST',
      body: { reason: 'operator needs to inspect partial output' },
    })

    expect(response.status).toBe(200)
    expect(killRun).toHaveBeenCalledWith(run.id, 'killed')
    expect((json as { terminalState?: string; recoverable?: boolean; ui?: { status?: { key?: string } } })).toMatchObject({
      terminalState: 'paused',
      recoverable: true,
      ui: { status: { key: 'paused' } },
    })
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toContain('operator paused run')
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator-note',
      operation: 'run.pause',
      reason: 'operator needs to inspect partial output',
    })
  })

  it('resumes a paused run by returning its task to the ready queue', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
      terminalState: 'paused',
      failReason: 'operator paused: inspect partial output',
      recoverable: true,
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/resume`, {
      method: 'POST',
      body: { reason: 'inspection complete' },
    })

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      runId: run.id,
      taskId: task.id,
      taskStatus: 'ready',
      failReason: 'operator paused: inspect partial output',
    })
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('ready')
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator-note',
      operation: 'run.resume',
      reason: 'inspection complete',
    })
  })

  it('refuses to resume a non-paused run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
      terminalState: 'frozen',
      failReason: 'cost_budget_paused: cap hit',
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/resume`, {
      method: 'POST',
      body: { reason: 'try generic resume' },
    })

    expect(response.status).toBe(400)
    expect((json as { error?: string }).error).toContain('is not paused')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
  })

  it('refuses to resume the same paused run twice', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
      terminalState: 'paused',
      failReason: 'operator paused: inspect partial output',
      recoverable: true,
    }))

    const first = await requestJson(fixture.app, `/api/runs/${run.id}/resume`, {
      method: 'POST',
      body: { reason: 'inspection complete' },
    })
    const second = await requestJson(fixture.app, `/api/runs/${run.id}/resume`, {
      method: 'POST',
      body: { reason: 'clicked again' },
    })

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(409)
    expect((second.json as { error?: string }).error).toContain('no longer resumable')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('ready')
  })
})

function runRow(overrides: Partial<Run>): Omit<
  Run,
  'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness'
  | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'
> {
  return {
    id: createId<'RunId'>(),
    taskId: createId<'TaskId'>(),
    agentId: createId<'AgentId'>(),
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand'],
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
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  }
}
