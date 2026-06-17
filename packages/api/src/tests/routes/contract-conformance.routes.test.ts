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

/**
 * D163 §7 — Route DTO conformance gates.
 *
 * Mutating run endpoints must return a UI-decorated run (the canonical
 * `RunUiContract` payload), not a raw domain row. Each test below pins
 * one mutating endpoint that previously returned (or could regress to
 * returning) an undecorated `Run`. If the route forgets to call
 * `decorateRunWithUi`, the dashboard would have to re-derive
 * status/cost client-side — exactly the drift D163 §§1-3 collapsed.
 */

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

type BaseRun = Omit<
  Run,
  'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness'
  | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'
>

function newRun(overrides: Partial<BaseRun>): BaseRun {
  return {
    id: createId<'RunId'>(),
    taskId: createId<'TaskId'>(),
    agentId: createId<'AgentId'>(),
    parentRunId: null,
    stage: 'implement',
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
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  }
}

interface UiPayload {
  schemaVersion: string
  status: { key: string; label: string; tone: string; terminal: boolean; needsAttention: boolean }
  cost: { usd: number; label: string; state: string }
  href: string | null
}

function expectCanonicalUi(ui: unknown): asserts ui is UiPayload {
  expect(ui).toMatchObject({
    schemaVersion: 'ductum.ui.run.v1',
    status: {
      key: expect.any(String),
      label: expect.any(String),
      tone: expect.any(String),
      terminal: expect.any(Boolean),
      needsAttention: expect.any(Boolean),
    },
    cost: { state: expect.stringMatching(/^(measured|pending|unmeasured)$/) },
  })
}

describe('contract conformance — mutating run endpoints decorate with canonical ui', () => {
  it('POST /api/runs/:id/reject returns a UI-decorated run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create(newRun({
      taskId: task.id,
      agentId: builder.id,
      stage: 'ship',
      blockedReason: 'waiting for approval',
      pendingApproval: true,
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/reject`, {
      method: 'POST',
      body: { reason: 'needs another pass' },
    })

    expect(response.status).toBe(200)
    const payload = json as { ui?: unknown }
    expectCanonicalUi(payload.ui)
    expect(payload.ui.status.key).toBe('failed')
  })

  it('POST /api/runs/:id/cancel envelopes a UI-decorated run', async () => {
    const killRun = vi.fn(async () => undefined)
    fixture = await createFixture({ killRun })
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create(newRun({
      taskId: task.id,
      agentId: builder.id,
      stage: 'implement',
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/cancel`, {
      method: 'POST',
      body: { reason: 'operator chose another path' },
    })

    expect(response.status).toBe(200)
    const envelope = json as { data: { run: { ui?: unknown } } }
    expectCanonicalUi(envelope.data.run.ui)
    expect(envelope.data.run.ui.status.key).toBe('cancelled')
  })

  it('POST /api/runs/:id/fail returns a UI-decorated run', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create(newRun({
      taskId: task.id,
      agentId: builder.id,
      stage: 'implement',
    }))

    const { json, response } = await requestJson(fixture.app, `/api/runs/${run.id}/fail`, {
      method: 'POST',
      body: { reason: 'conformance', recoverable: false },
    })

    expect(response.status).toBe(200)
    const payload = json as { ui?: unknown }
    expectCanonicalUi(payload.ui)
    expect(payload.ui.status.key).toBe('failed')
    expect(payload.ui.status.terminal).toBe(true)
  })
})
