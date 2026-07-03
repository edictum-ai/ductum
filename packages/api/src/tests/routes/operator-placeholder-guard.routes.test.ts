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

// Focused regression for the #243 residual: an empty watcher placeholder child
// (no session, no worktree, parent_run_id set, parent-matching PR metadata)
// must not become the latest run for operator retry/redirect. The watcher
// manager retires such placeholders by cancelling them; the latest-run guard
// in packages/api/src/lib/operator-run-guards.ts skips cancelled placeholders
// so the real parent run can be retried/redirected.

describe('API routes - operator latest-run guard skips empty watcher placeholders', () => {
  it('POST /api/runs/:id/retry is not blocked by a newer empty watcher placeholder child', async () => {
    let taskId: string | undefined
    const cycleDispatcher = vi.fn(async () => {
      if (taskId != null) fixture?.repos.tasks.updateStatus(taskId as never, 'active')
      return { tasksEvaluated: 1, tasksDispatched: taskId == null ? [] : [taskId as never], errors: [] }
    })
    fixture = await createFixture({ cycleDispatcher })
    const { task, builder } = seedBase(fixture)
    taskId = task.id
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const parent = fixture.repos.runs.create(parentRow(task.id, builder.id))
    fixture.repos.runs.create(placeholderRow(task.id, builder.id, parent.id))

    const result = await requestJson(fixture.app, `/api/runs/${parent.id}/retry`, { method: 'POST' })

    expect(result.response.status).toBe(200)
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    expect(fixture.repos.tasks.get(task.id)?.retryCount).toBe(0)
    expect(fixture.repos.tasks.get(task.id)?.retryAfter).toBeNull()
  })

  it('POST /api/runs/:id/redirect is not blocked by a newer empty watcher placeholder child', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const parent = fixture.repos.runs.create(activeParentRow(task.id, builder.id))
    fixture.repos.runs.create(placeholderRow(task.id, builder.id, parent.id))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${parent.id}/redirect`, {
      method: 'POST',
      body: { agentId: reviewer.id, reason: 'reviewer should finish this slice' },
    })

    expect(response.status).toBe(200)
    expect(killRun).toHaveBeenCalledWith(parent.id, 'cancelled')
    expect(json).toMatchObject({
      ok: true,
      runId: parent.id,
      taskId: task.id,
      fromAgentId: builder.id,
      toAgentId: reviewer.id,
    })
    expect(fixture.repos.runs.get(parent.id)?.terminalState).toBe('cancelled')
  })
})

type RunRow = Omit<
  Run,
  'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness'
    | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'attemptSnapshot' | 'verifyRetries'
>

function parentRow(taskId: string, agentId: string): RunRow {
  return {
    id: createId<'RunId'>(),
    taskId: taskId as never,
    agentId: agentId as never,
    parentRunId: null,
    stage: 'ship',
    terminalState: 'failed',
    resetCount: 0,
    completedStages: ['understand', 'implement', 'verify', 'review'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'parent-session',
    branch: 'feat/p1',
    commitSha: 'parent-sha',
    prNumber: 251,
    prUrl: 'https://github.com/acartag7/ductum/pull/251',
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: 'approval rejected: needs work',
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  }
}

function activeParentRow(taskId: string, agentId: string): RunRow {
  return {
    ...parentRow(taskId, agentId),
    terminalState: null,
    failReason: null,
    pendingApproval: false,
  }
}

function placeholderRow(taskId: string, agentId: string, parentRunId: string): RunRow {
  return {
    id: createId<'RunId'>(),
    taskId: taskId as never,
    agentId: agentId as never,
    parentRunId: parentRunId as never,
    stage: 'understand',
    terminalState: 'cancelled',
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: 'feat/p1',
    commitSha: 'parent-sha',
    prNumber: 251,
    prUrl: 'https://github.com/acartag7/ductum/pull/251',
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: 'Parent run awaiting approval',
    recoverable: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 60,
  }
}
