import type { Run } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import {
  activeRun,
  activeTask,
  agent,
  createMockApi,
  project,
  readyTask,
  runCommand,
  spec,
} from './helpers.js'

describe('ductum CLI normal surface', () => {
  it('does not call the old API factory initializer from ductum init', async () => {
    const api = createMockApi()
    const result = await runCommand(['init'], api)

    expect(result.code).toBe(1)
    expect(api.initFactory).not.toHaveBeenCalled()
    expect(JSON.parse(result.text).data.code).toBe('init_missing_arg')
  })

  it('supports project create, list, show, and delete', async () => {
    const api = createMockApi()

    const repoPath = process.cwd()
    const created = await runCommand(['project', 'create', 'ductum', '--repo', repoPath, '--merge-mode', 'human'], api)
    const listed = await runCommand(['project', 'list'], api)
    const shown = await runCommand(['project', 'show', project.name], api)
    const deleted = await runCommand(['project', 'delete', project.name], api)

    expect(created.code).toBe(0)
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'ductum',
      repositories: [expect.objectContaining({ localPath: repoPath })],
      config: { mergeMode: 'human' },
    }))
    expect(listed.text).toContain(project.name)
    expect(shown.text).toContain(spec.name)
    expect(api.deleteProject).toHaveBeenCalledWith(project.id)
    expect(deleted.text).toContain(`Deleted project ${project.name}`)
  })

  it('supports spec and task commands without status hacking', async () => {
    const api = createMockApi()

    const specCreated = await runCommand(['spec', 'create', project.name, 'New Spec', '--document', 'Ship it'], api)
    const specListed = await runCommand(['spec', 'list', project.name], api)
    const specApproved = await runCommand(['spec', 'approve', spec.id], api)
    const taskListed = await runCommand(['task', 'list', spec.id], api)
    const taskCreated = await runCommand(['task', 'create', spec.id, 'New Task', '--agent', agent.name], api, 'do the thing')
    const taskAssigned = await runCommand(['task', 'assign', readyTask.id, agent.name], api)
    const taskDag = await runCommand(['task', 'dag', spec.id], api)

    expect(specCreated.code).toBe(0)
    expect(api.createSpec).toHaveBeenCalledWith(project.id, {
      name: 'New Spec',
      document: 'Ship it',
    })
    expect(specListed.text).toContain(spec.name)
    expect(specApproved.text).toContain(`Approved spec ${spec.id}`)
    expect(taskListed.text).toContain(readyTask.name)
    expect(api.createTask).toHaveBeenCalledWith(spec.id, expect.objectContaining({
      name: 'New Task',
      assignedAgentId: agent.id,
    }))
    expect(taskCreated.text).toContain(readyTask.id)
    expect(taskAssigned.text).toContain(agent.name)
    expect(taskDag.text).toContain(readyTask.name)
  })

  it('shows status overview and Attempt detail', async () => {
    const overview = await runCommand(['status'])
    const detail = await runCommand(['status', activeRun.id])

    expect(overview.code).toBe(0)
    expect(overview.text).toContain('Projects')
    expect(overview.text).toContain('Factory Activity')
    expect(overview.text).toContain('Next Operator Actions')
    expect(detail.code).toBe(0)
    expect(detail.text).toContain('Attempt History')
    expect(detail.text).toContain('Gate Checks')
  })

  it('shows unmeasured cost instead of fake zero dollars', async () => {
    const unmeasuredRun = {
      ...activeRun,
      stage: 'done' as const,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      ui: { cost: { usd: 0, label: 'unmeasured', state: 'unmeasured' } },
    } as Run & { ui: { cost: { usd: number; label: string; state: string } } }
    const api = createMockApi({ getRun: vi.fn().mockResolvedValue(unmeasuredRun) })
    const detail = await runCommand(['status', activeRun.id], api)

    expect(detail.code).toBe(0)
    expect(detail.text).toContain('costUsd: unmeasured')
    expect(detail.text).not.toContain('costUsd: $0.00')
  })

  it('starts an Attempt through the Attempt command', async () => {
    const doneRun: Run = { ...activeRun, stage: 'done' as const }
    const api = createMockApi({
      dispatch: vi.fn().mockResolvedValue(activeRun),
      getRun: vi.fn().mockResolvedValue(doneRun),
    })

    const result = await runCommand(['attempt', 'start', readyTask.id, '--agent', agent.name, '--project', project.name], api)

    expect(result.code).toBe(0)
    expect(api.dispatch).toHaveBeenCalledWith(readyTask.id, agent.id)
    expect(result.text).toContain('Starting Attempt')
    expect(result.text).toContain('finished: Done')
  })

  it('stops waiting when an implementation hands off to a review task', async () => {
    const implRun: Run = { ...activeRun, taskId: activeTask.id, stage: 'implement' as const }
    const reviewTask = {
      ...readyTask,
      id: 'task-review' as typeof readyTask.id,
      specId: activeTask.specId,
      name: `review-${activeTask.name}`,
      requiredRole: 'reviewer' as const,
      assignedAgentId: agent.id,
      status: 'ready' as const,
    }
    const api = createMockApi({
      dispatch: vi.fn().mockResolvedValue(implRun),
      getRun: vi.fn().mockResolvedValue(implRun),
      listTasks: vi.fn().mockResolvedValue([activeTask, reviewTask]),
      listTaskRuns: vi.fn().mockImplementation(async (taskId: string) =>
        taskId === activeTask.id ? [implRun] : [],
      ),
    })

    const result = await runCommand(['attempt', 'start', activeTask.id, '--agent', agent.name, '--project', project.name], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain(`handed off to ${reviewTask.name} (ready)`)
    expect(result.text).toContain(`ductum attempt start ${reviewTask.id} --agent ${agent.name} --project ${project.name}`)
  })

  it('removed top-level command groups are not callable', async () => {
    for (const command of ['agent', 'run', 'queue', 'config', 'resource', 'target', 'debug', 'legacy', 'serve']) {
      const result = await runCommand([command])
      expect(result.code).not.toBe(0)
      expect(result.errorText).toMatch(/unknown command/i)
    }
  })
})
