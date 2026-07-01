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

  it('uses display fallbacks and id-backed routes for redacted search hits', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: '[redacted] migrated issue',
      status: 'approved',
      document: '# [redacted]',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: '[redacted] implementation task',
      prompt: 'implement',
      repos: [],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: [],
    })
    const created = fixture.repos.runs.create(run({
      taskId: task.id,
      agentId: builder.id,
      stage: 'implement',
    }))

    const { json, response } = await requestJson(fixture.app, '/api/search?q=redacted')

    expect(response.status).toBe(200)
    expect(JSON.stringify(json)).not.toContain('[redacted]')
    expect(json).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'spec',
        id: spec.id,
        name: `Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}`,
      }),
      expect.objectContaining({
        type: 'task',
        id: task.id,
        name: `Task ${task.id.slice(0, 6)}`,
        subtitle: `ductum · Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}/${encodeURIComponent(task.id)}`,
      }),
      expect.objectContaining({
        type: 'run',
        id: created.id,
        name: expect.stringContaining(`Task ${task.id.slice(0, 6)}`),
        subtitle: `ductum · Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}/${encodeURIComponent(task.id)}/${created.id.slice(0, 6)}`,
      }),
    ]))
  })

  it('uses id-backed routes before public redaction for raw secret-bearing search hits', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const rawSpecName = 'fix token auth OPENAI_API_KEY=sk-searchsecret123'
    const rawTaskName = 'rotate ghp_searchsecret456 token'
    const spec = fixture.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: rawSpecName,
      status: 'approved',
      document: '# raw secret fixture',
    })
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: rawTaskName,
      prompt: 'implement',
      repos: [],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: [],
    })
    const created = fixture.repos.runs.create(run({
      taskId: task.id,
      agentId: builder.id,
      stage: 'implement',
    }))

    const { json, response } = await requestJson(fixture.app, '/api/search?q=token')
    const text = JSON.stringify(json)

    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-searchsecret123')
    expect(text).not.toContain('ghp_searchsecret456')
    expect(text).not.toContain('[redacted]')
    expect(json).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'spec',
        id: spec.id,
        name: `Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}`,
      }),
      expect.objectContaining({
        type: 'task',
        id: task.id,
        name: `Task ${task.id.slice(0, 6)}`,
        subtitle: `ductum · Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}/${encodeURIComponent(task.id)}`,
      }),
      expect.objectContaining({
        type: 'run',
        id: created.id,
        name: expect.stringContaining(`Task ${task.id.slice(0, 6)}`),
        subtitle: `ductum · Spec ${spec.id.slice(0, 6)}`,
        url: `/ductum/${encodeURIComponent(spec.id)}/${encodeURIComponent(task.id)}/${created.id.slice(0, 6)}`,
      }),
    ]))
  })
})
