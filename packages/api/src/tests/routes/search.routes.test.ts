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

type NewRun = Omit<
  Run,
  'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness'
  | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'
>

function run(overrides: Partial<NewRun>): NewRun {
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

describe('API routes — search', () => {
  it('finds runs by task, spec, project, agent, and model context', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const created = fixture.repos.runs.create(run({
      taskId: task.id,
      agentId: builder.id,
      stage: 'implement',
    }))

    const { json, response } = await requestJson(fixture.app, '/api/search?q=ductum%20P4%20mimi')

    expect(response.status).toBe(200)
    expect(json).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run', id: created.id, name: expect.stringContaining('REST API') }),
    ]))
  })

  it('finds agents by model, not only by agent name', async () => {
    fixture = await createFixture()
    const { reviewer } = seedBase(fixture)

    const { json, response } = await requestJson(fixture.app, '/api/search?q=gpt-5.4')

    expect(response.status).toBe(200)
    expect(json).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent', id: reviewer.id, subtitle: 'gpt-5.4' }),
    ]))
  })

  it('supports multi-word project/spec/task searches', async () => {
    fixture = await createFixture()
    const { task } = seedBase(fixture)

    const { json, response } = await requestJson(fixture.app, '/api/search?q=ductum%20REST')

    expect(response.status).toBe(200)
    expect(json).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task', id: task.id, name: 'REST API' }),
    ]))
  })
})
