import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('factory summary Attempt lineage', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('counts only the live retry leaf when earlier lineage attempts stalled', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const retryTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: 'fix-settings-r3',
      prompt: 'cleanup responsive settings picker',
      repos: ['packages/dashboard'],
      assignedAgentId: builder.id,
      status: 'active',
      verification: [],
    })

    const parent = createRun(task, builder.id)
    const stalled = createRun(retryTask, builder.id, {
      parentRunId: parent.id,
      terminalState: 'stalled',
    })
    createRun(retryTask, builder.id, {
      parentRunId: stalled.id,
      stage: 'implement',
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.activeRuns).toBe(1)
    expect(brief.queue.needsOperator).toBe(0)
  })

  it('counts only the latest failed attempt for an active task', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder.id, {
      id: 'aaa-older-failed' as Run['id'],
      terminalState: 'failed',
      updatedAt: '2026-04-25T04:00:00Z',
    })
    createRun(task, builder.id, {
      id: 'zzz-latest-failed' as Run['id'],
      terminalState: 'failed',
      updatedAt: '2026-04-25T04:10:00Z',
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.needsOperator).toBe(1)
  })

  it('does not count an older failed attempt when a newer run is awaiting approval', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder.id, {
      id: 'aaa-older-failed' as Run['id'],
      terminalState: 'failed',
      updatedAt: '2026-04-25T04:00:00Z',
    })
    createRun(task, builder.id, {
      id: 'zzz-latest-approval' as Run['id'],
      stage: 'ship',
      pendingApproval: true,
      updatedAt: '2026-04-25T04:10:00Z',
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.approvalsWaiting).toBe(1)
    expect(brief.queue.needsOperator).toBe(0)
  })

  it('does not call the factory idle while live runs are active', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder.id)

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { recommendedActions: string[] }

    expect(brief.recommendedActions.some((action) => action.includes('active Attempt'))).toBe(true)
    expect(brief.recommendedActions.some((action) => action.includes('Factory is idle'))).toBe(false)
  })

  it('does not count a parent implementation run as active when a fix task is ready', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    createRun(task, builder.id)
    fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `fix-${task.name}-r1`,
      prompt: 'address review findings',
      repos: task.repos,
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'ready',
      verification: [],
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number>; recommendedActions: string[] }

    expect(brief.queue.activeRuns).toBe(0)
    expect(brief.queue.readyTasks).toBe(1)
    expect(brief.recommendedActions.some((action) => action.includes('1 ready Task'))).toBe(true)
  })

  it('still counts an active review run when its lineage has an open fix task', async () => {
    fixture = await createFixture()
    const { spec, task, builder, reviewer } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const fixTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `fix-${task.name}-r1`,
      prompt: 'address review findings',
      repos: task.repos,
      assignedAgentId: builder.id,
      requiredRole: 'builder',
      status: 'active',
      verification: [],
    })
    const reviewTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      name: `review-${task.name}-r2`,
      prompt: 'review fix',
      repos: task.repos,
      assignedAgentId: reviewer.id,
      requiredRole: 'reviewer',
      status: 'active',
      verification: [],
    })
    const fixRun = createRun(fixTask, builder.id)
    createRun(reviewTask, reviewer.id, { parentRunId: fixRun.id })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number> }

    expect(brief.queue.activeRuns).toBe(1)
    expect(brief.queue.readyTasks).toBe(0)
  })

  it('counts ready fix work even when the parent spec is failed', async () => {
    fixture = await createFixture()
    const { spec } = seedBase(fixture)
    fixture.repos.specs.updateStatus(spec.id, 'failed')

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { queue: Record<string, number>; recommendedActions: string[] }

    expect(brief.queue.readyTasks).toBe(1)
    expect(brief.recommendedActions.some((action) => action.includes('1 ready Task'))).toBe(true)
  })

  it('uses deployment-neutral guidance when dispatcher support is disabled', async () => {
    fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: 2,
        lastCycleAt: null,
        enabled: false,
        adapterCount: 0,
        adapters: [],
        reason: 'dispatch disabled: operator requested maintenance',
      }),
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { recommendedActions: string[] }

    const dispatcherAction = brief.recommendedActions.find((action) => action.includes('Dispatcher is disabled'))
    expect(dispatcherAction).toContain('restart the Ductum API with dispatch enabled')
    expect(dispatcherAction).not.toContain('pnpm serve')
  })

  it('uses deployment-neutral guidance when dispatcher is enabled but stopped', async () => {
    fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: 2,
        lastCycleAt: null,
        enabled: true,
        adapterCount: 1,
        adapters: ['codex-sdk'],
        reason: 'test dispatcher stopped',
      }),
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { recommendedActions: string[] }

    const dispatcherAction = brief.recommendedActions.find((action) =>
      action.includes('Dispatcher is enabled but not running'),
    )
    expect(dispatcherAction).toContain('restart the Ductum API to resume auto-dispatch')
    expect(dispatcherAction).not.toContain('pnpm serve')
  })

  it('surfaces the stale-slot auto-close counter', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    createRun(task, builder.id, {
      terminalState: 'stalled',
      failReason: 'stale_slot_gc',
    })

    const response = await requestJson(fixture.app, '/api/factory/operator-brief')
    expect(response.response.status).toBe(200)
    const brief = response.json as { staleSlotsAutoClosed: number }

    expect(brief.staleSlotsAutoClosed).toBe(1)
  })

  function createRun(
    task: Task,
    agentId: Run['agentId'],
    overrides: Partial<Run> = {},
  ): Run {
    return fixture!.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId,
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
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
      ...overrides,
    })
  }
})
