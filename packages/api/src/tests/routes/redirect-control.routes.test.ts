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

describe('API routes - operator redirect', () => {
  it('redirects an active latest run to another agent and returns the task to ready', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateRetry(task.id, 3, '2026-06-19T12:00:00.000Z')
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({ taskId: task.id, agentId: builder.id }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/redirect`, {
      method: 'POST',
      body: { agentId: reviewer.id, reason: 'reviewer should finish this slice' },
    })

    expect(response.status).toBe(200)
    expect(killRun).toHaveBeenCalledWith(run.id, 'cancelled')
    expect(json).toMatchObject({
      ok: true,
      runId: run.id,
      taskId: task.id,
      taskStatus: 'ready',
      fromAgentId: builder.id,
      toAgentId: reviewer.id,
      toAgentName: reviewer.name,
      failReason: null,
    })
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBe('cancelled')
    expect(fixture.repos.tasks.get(task.id)).toMatchObject({
      assignedAgentId: reviewer.id,
      status: 'ready',
      retryCount: 0,
      retryAfter: null,
    })
    expect(fixture.repos.evidence.list(run.id).at(-1)?.payload).toMatchObject({
      kind: 'operator-note',
      operation: 'run.redirect',
      reason: 'reviewer should finish this slice',
      from_agent_id: builder.id,
      to_agent_id: reviewer.id,
    })
    expect(fixture.repos.runUpdates.list(run.id).at(-1)?.message).toContain('operator redirected run')
  })

  it('refuses to redirect to the current run agent', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({ taskId: task.id, agentId: builder.id }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/redirect`, {
      method: 'POST',
      body: { agentId: builder.id, reason: 'same agent is not a redirect' },
    })

    expect(response.status).toBe(400)
    expect((json as { error?: string }).error).toContain('already assigned')
    expect(killRun).not.toHaveBeenCalled()
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
  })

  it('refuses to redirect a non-latest run', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const oldRun = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
      terminalState: 'failed',
      failReason: 'superseded by newer run',
      recoverable: true,
    }))
    fixture.repos.runs.create(runRow({ taskId: task.id, agentId: reviewer.id }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${oldRun.id}/redirect`, {
      method: 'POST',
      body: { agentId: reviewer.id, reason: 'old run should not move task' },
    })

    expect(response.status).toBe(409)
    expect((json as { error?: string }).error).toContain('already moved to newer run')
    expect(killRun).not.toHaveBeenCalled()
    expect(fixture.repos.runs.get(oldRun.id)?.terminalState).toBe('failed')
  })

  it('refuses to redirect an already terminal run', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create(runRow({
      taskId: task.id,
      agentId: builder.id,
      terminalState: 'paused',
      failReason: 'operator paused',
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/redirect`, {
      method: 'POST',
      body: { agentId: reviewer.id, reason: 'terminal state should survive' },
    })

    expect(response.status).toBe(409)
    expect((json as { error?: string }).error).toContain('already paused')
    expect(killRun).not.toHaveBeenCalled()
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBe('paused')
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
