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
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - dispatcher kicks for ready work', () => {
  it('kicks the dispatcher after creating a ready task', async () => {
    const cycleDispatcher = dispatcherCycle()
    fixture = await createFixture({ cycleDispatcher })
    const { spec, builder } = seedBase(fixture)

    const response = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: {
        name: 'P6 retry',
        prompt: 'finish the retry',
        assignedAgentId: builder.id,
        status: 'ready',
      },
    })

    expect(response.response.status).toBe(201)
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
  })

  it('kicks the dispatcher after assigning a ready task', async () => {
    const cycleDispatcher = dispatcherCycle()
    fixture = await createFixture({ cycleDispatcher })
    const { spec, builder } = seedBase(fixture)
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'P6 r2',
      prompt: 'resume explicitly assigned work',
      repos: ['.'],
      assignedAgentId: null,
      status: 'ready',
      verification: [],
    })

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/agent`, {
      method: 'PUT',
      body: { agentId: builder.id },
    })

    expect(response.response.status).toBe(200)
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
  })

  it('kicks the dispatcher when task completion releases a dependent task', async () => {
    const cycleDispatcher = dispatcherCycle()
    fixture = await createFixture({ cycleDispatcher })
    const { spec, task, builder } = seedBase(fixture)
    const dependent = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'follow-up',
      prompt: 'continue after parent',
      repos: ['.'],
      assignedAgentId: builder.id,
      status: 'pending',
      verification: [],
    })
    fixture.repos.taskDependencies.add({ taskId: dependent.id, dependsOnId: task.id })

    const response = await requestJson(fixture.app, `/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: { reason: 'parent finished' },
    })

    expect(response.response.status).toBe(200)
    expect(fixture.repos.tasks.get(dependent.id)?.status).toBe('ready')
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
  })

  it('kicks the dispatcher after creating a bakeoff with ready candidates', async () => {
    const cycleDispatcher = dispatcherCycle()
    fixture = await createFixture({ cycleDispatcher })
    const { project, builder, reviewer } = seedBase(fixture)
    const secondBuilder = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'glm-builder',
      model: 'glm-5.2',
      harness: 'codex-sdk',
      capabilities: ['build', 'test'],
      costTier: 40,
      spawnConfig: {},
    })
    fixture.repos.projectAgents.assign({ projectId: project.id, agentId: secondBuilder.id, role: 'builder' })

    const response = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Dispatch wake bakeoff',
        prompt: 'prove candidates dispatch promptly',
        builderAgentIds: [builder.id, secondBuilder.id],
        reviewerAgentId: reviewer.id,
      },
    })

    expect(response.response.status).toBe(201)
    expect(cycleDispatcher).toHaveBeenCalledTimes(1)
  })
})

function dispatcherCycle() {
  return vi.fn(async () => ({ tasksEvaluated: 1, tasksDispatched: [], errors: [] }))
}
