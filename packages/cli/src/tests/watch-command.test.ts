import type { Task } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import { activeRun, activeTask, agent, createMockApi, project, runCommand, spec } from './helpers.js'

describe('ductum watch', () => {
  it('prints the Factory Activity snapshot and exits with --once', async () => {
    const api = createMockApi()
    const openEventStream = vi.fn()

    const result = await runCommand(['watch', '--once'], api, '', { openEventStream })

    expect(result.code).toBe(0)
    expect(openEventStream).not.toHaveBeenCalled()
    expect(result.text).toContain('Factory Activity')
    expect(result.text).toContain('Ready tasks: 1')
    expect(result.text).toContain('Action needed: 1')
    expect(result.text).toContain('Active attempts: 1')
    expect(result.text).toContain('attempt start task-ready --agent mimi --project ductum')
    expect(result.text).not.toContain('run task-ready --agent')
    expect(result.text).not.toContain('run "Ready Task" --agent')
  })

  it('does not count a parent implementation run as active when a fix task is ready', async () => {
    const fixTask: Task = {
      ...activeTask,
      id: 'task-fix' as Task['id'],
      name: 'fix-Active Task-r1',
      requiredRole: 'builder',
      status: 'ready',
    }
    const api = createMockApi({
      listTasks: vi.fn().mockResolvedValue([activeTask, fixTask]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) =>
        taskId === activeTask.id ? [activeRun] : [],
      ),
    })

    const result = await runCommand(['watch', '--once'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Active attempts: 0')
    expect(result.text).toContain('Ready tasks: 1')
    expect(result.text).toContain('fix-Active Task-r1')
    expect(result.text).not.toContain('Active Task/run-active -> status run-active')
  })

  it('keeps an active review run visible when its lineage has an open fix task', async () => {
    const fixTask: Task = {
      ...activeTask,
      id: 'task-fix' as Task['id'],
      name: 'fix-Active Task-r1',
      requiredRole: 'builder',
      status: 'active',
    }
    const reviewTask: Task = {
      ...activeTask,
      id: 'task-review' as Task['id'],
      name: 'review-Active Task-r2',
      requiredRole: 'reviewer',
      status: 'active',
    }
    const fixRun = { ...activeRun, id: 'run-fix' as typeof activeRun.id, taskId: fixTask.id }
    const reviewRun = {
      ...activeRun,
      id: 'run-review' as typeof activeRun.id,
      taskId: reviewTask.id,
      parentRunId: fixRun.id,
      agentId: agent.id,
    }
    const api = createMockApi({
      listTasks: vi.fn().mockResolvedValue([activeTask, fixTask, reviewTask]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) => {
        if (taskId === activeTask.id) return [activeRun]
        if (taskId === fixTask.id) return [fixRun]
        if (taskId === reviewTask.id) return [reviewRun]
        return []
      }),
    })

    const result = await runCommand(['watch', '--once'], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Active attempts: 1')
    expect(result.text).toContain('ductum/review-Active Task-r2/run-re -> status run-review')
    expect(result.text).not.toContain('Active Task/run-active -> status run-active')
    expect(result.text).not.toContain('fix-Active Task-r1/run-fix -> status run-fix')
  })

  it('prints a run snapshot and streams filtered events for that run', async () => {
    const api = createMockApi()
    const openEventStream = vi.fn().mockImplementation(async function* ({ url }: { url: string }) {
      expect(url).toContain(`runId=${encodeURIComponent(activeRun.id)}`)
      expect(url).toContain(`projectId=${encodeURIComponent(project.id)}`)
      expect(url).toContain(`specId=${encodeURIComponent(spec.id)}`)
      expect(url).toContain(`taskId=${encodeURIComponent(activeTask.id)}`)
      yield {
        event: 'run.stage_changed',
        data: JSON.stringify({ type: 'run.stage_changed', runId: activeRun.id, from: 'understand', to: 'implement' }),
      }
      yield {
        event: 'gate.evaluated',
        data: JSON.stringify({ type: 'gate.evaluated', runId: activeRun.id, gateType: 'ship', result: 'allowed' }),
      }
    })

    const result = await runCommand([
      'watch',
      activeRun.id,
      '--project',
      project.id,
      '--spec',
      spec.id,
      '--task',
      activeTask.id,
    ], api, '', { openEventStream })

    expect(result.code).toBe(0)
    expect(result.text).toContain('Attempt Status')
    expect(result.text).toContain(`attemptId: ${activeRun.id}`)
    expect(result.text).toContain('Understanding -> In progress')
    expect(result.text).toContain('gate Awaiting approval -> Allowed')
  })

  it('emits compact json lines for the snapshot and streamed events', async () => {
    const api = createMockApi()
    const openEventStream = vi.fn().mockImplementation(async function* () {
      yield {
        event: 'approval.requested',
        data: JSON.stringify({ type: 'approval.requested', runId: activeRun.id }),
      }
      yield {
        event: 'workflow.advanced',
        data: JSON.stringify({ type: 'workflow.advanced', runId: activeRun.id, fromStage: 'implement', events: [{ type: 'gate.evaluated' }] }),
      }
    })

    const result = await runCommand(['--json', 'watch'], api, '', { openEventStream })

    expect(result.code).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(3)
    const snapshot = JSON.parse(lines[0]!)
    const firstEvent = JSON.parse(lines[1]!)
    const secondEvent = JSON.parse(lines[2]!)
    expect(snapshot.kind).toBe('snapshot')
    expect(snapshot.scope).toBe('factory_activity')
    expect(firstEvent).toMatchObject({
      kind: 'event',
      event: 'approval.requested',
      data: { runId: activeRun.id },
    })
    expect(secondEvent).toMatchObject({
      kind: 'event',
      event: 'workflow.advanced',
      data: { fromStage: 'implement' },
    })
  })

  it('authenticates the event stream with the operator token header', async () => {
    const api = createMockApi()
    const openEventStream = vi.fn().mockImplementation(async function* ({
      headers,
      url,
    }: {
      headers?: Record<string, string>
      url: string
    }) {
      expect(headers).toMatchObject({ 'x-ductum-operator-token': 'real-token' })
      expect(url).not.toContain('real-token')
    })

    const result = await runCommand(['watch'], api, '', {
      env: { DUCTUM_OPERATOR_TOKEN: 'real-token' },
      openEventStream,
    })

    expect(result.code).toBe(0)
    expect(openEventStream).toHaveBeenCalledTimes(1)
  })

  it('stops streaming when the timeout expires', async () => {
    const api = createMockApi()
    const openEventStream = vi.fn().mockImplementation(({ signal }: { signal: AbortSignal }) => ({
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }))

    const result = await runCommand(['watch', '--timeout', '0.01'], api, '', { openEventStream })

    expect(result.code).toBe(0)
    expect(result.text).toContain('Factory Activity')
    expect(openEventStream).toHaveBeenCalledTimes(1)
  })
})
