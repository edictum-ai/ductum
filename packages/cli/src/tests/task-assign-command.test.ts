import { describe, expect, it, vi } from 'vitest'

import { agent, createMockApi, readyTask, runCommand } from './helpers.js'

describe('task assign command', () => {
  it('retargets a task by agent name', async () => {
    const api = createMockApi({
      assignTaskAgent: vi.fn().mockResolvedValue({ ...readyTask, assignedAgentId: agent.id }),
    })

    const result = await runCommand(['task', 'assign', readyTask.id, agent.name], api)

    expect(result.code).toBe(0)
    expect(api.assignTaskAgent).toHaveBeenCalledWith(readyTask.id, agent.id)
    expect(result.text).toContain(`Assigned task ${readyTask.name} to ${agent.name}`)
  })

  it('accepts task ids that start with a dash after option parsing terminator', async () => {
    const taskId = '-task-ready'
    const api = createMockApi({
      assignTaskAgent: vi.fn().mockResolvedValue({ ...readyTask, id: taskId, assignedAgentId: agent.id }),
    })

    const result = await runCommand(['task', 'assign', '--', taskId, agent.name], api)

    expect(result.code).toBe(0)
    expect(api.assignTaskAgent).toHaveBeenCalledWith(taskId, agent.id)
    expect(result.text).toContain(`Assigned task ${readyTask.name} to ${agent.name}`)
  })
})
