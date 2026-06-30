import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('run UI contract routes', () => {
  it('includes stable UI status, cost, and href fields on run read endpoints', async () => {
    fixture = await createFixture()
    const { project, task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'ship', 'done'],
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
    } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)

    const { json: listJson } = await requestJson(fixture.app, '/api/runs?limit=10')
    const rows = listJson as Array<{ id: string; ui?: unknown }>
    const row = rows.find((item) => item.id === run.id) as {
      id: string
      ui: {
        schemaVersion: string
        status: { key: string; label: string; tone: string; terminal: boolean; needsAttention: boolean }
        cost: { usd: number; label: string; state: string }
        href: string
      }
    }
    const { json: detailJson } = await requestJson(fixture.app, `/api/runs/${run.id}`)
    const detail = detailJson as typeof row
    const { json: taskRunsJson } = await requestJson(fixture.app, `/api/tasks/${task.id}/runs`)
    const taskRows = taskRunsJson as Array<typeof row>
    const taskRow = taskRows.find((item) => item.id === run.id)!

    const expectedUi = {
      schemaVersion: 'ductum.ui.run.v1',
      status: {
        key: 'done',
        label: 'Done',
        tone: 'ok',
        terminal: true,
        needsAttention: false,
      },
      cost: {
        usd: 0,
        label: 'missing usage',
        state: 'unmeasured',
      },
      href: `/${project.name}/P4/REST%20API/${run.id.slice(0, 6)}`,
    }
    expect(row.ui).toEqual(expectedUi)
    expect(detail.ui).toEqual(expectedUi)
    expect(taskRow.ui).toEqual(expectedUi)

    const { json: resolvedJson } = await requestJson(fixture.app, `/api/resolve/runs/${run.id}`)
    expect((resolvedJson as { run: typeof row }).run.ui).toEqual(expectedUi)

    const { json: heartbeatJson } = await requestJson(fixture.app, `/api/runs/${run.id}/heartbeat`, { method: 'POST' })
    expect((heartbeatJson as typeof row).ui).toEqual(expectedUi)
  })

  it('surfaces unpriced (not $0) for a run with tokens but no priceable model', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'ship', 'done'],
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
      tokensIn: 5000,
      tokensOut: 1200,
      costUsd: 0,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)

    const { json } = await requestJson(fixture.app, `/api/runs/${run.id}`)
    // Tokens present but $0 cost ⇒ usage is known, the model just has no
    // rate. The wire contract must say "missing price" — never "$0"/"free".
    expect((json as { ui?: { cost?: { usd: number; label: string; state: string } } }).ui?.cost)
      .toEqual({ usd: 0, label: 'missing price', state: 'unpriced' })
  })

  it('labels completed implementation handoff as awaiting review', async () => {
    fixture = await createFixture()
    const { task, builder, reviewer, spec } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'completed-session',
      branch: 'ductum/rest-api',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum-rest-api'],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)
    fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `review-${task.name}`,
      prompt: 'review the implementation',
      repos: task.repos,
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'ready',
      verification: [],
    })

    const { json: detailJson } = await requestJson(fixture.app, `/api/runs/${run.id}`)
    const { json: listJson } = await requestJson(fixture.app, '/api/runs?limit=10')
    const listRow = (listJson as Array<{ id: string; ui?: { status?: { key?: string; label?: string } } }>)
      .find((item) => item.id === run.id)!

    expect((detailJson as { ui?: { status?: { key?: string; label?: string } } }).ui?.status).toMatchObject({
      key: 'awaiting_review',
      label: 'Awaiting review',
    })
    expect(listRow.ui?.status).toMatchObject({
      key: 'awaiting_review',
      label: 'Awaiting review',
    })
  })

  it('labels implementation handoff with an open fix task as awaiting fix', async () => {
    fixture = await createFixture()
    const { task, builder, spec } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'completed-session',
      branch: 'ductum/rest-api',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/ductum-rest-api'],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)
    fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `fix-${task.name}-r1`,
      prompt: 'fix review findings',
      repos: task.repos,
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'ready',
      verification: [],
    })

    const { json: detailJson } = await requestJson(fixture.app, `/api/runs/${run.id}`)
    const { json: listJson } = await requestJson(fixture.app, '/api/runs?limit=10')
    const listRow = (listJson as Array<{ id: string; ui?: { status?: { key?: string; label?: string } } }>)
      .find((item) => item.id === run.id)!

    expect((detailJson as { ui?: { status?: { key?: string; label?: string } } }).ui?.status).toMatchObject({
      key: 'awaiting_review',
      label: 'Awaiting fix',
    })
    expect(listRow.ui?.status).toMatchObject({
      key: 'awaiting_review',
      label: 'Awaiting fix',
    })
  })

  it('includes UI contract fields on mutating run endpoints that return runs', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
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
    } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)

    const { json } = await requestJson(fixture.app, `/api/runs/${run.id}/fail`, {
      method: 'POST',
      body: { reason: 'contract test', recoverable: false },
    })

    expect((json as { ui?: { schemaVersion?: string; status?: { key?: string } } }).ui).toMatchObject({
      schemaVersion: 'ductum.ui.run.v1',
      status: { key: 'failed' },
    })
  })
})
