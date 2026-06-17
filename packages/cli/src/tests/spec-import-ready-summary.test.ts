import { describe, expect, it, vi } from 'vitest'

import type { Spec, Task } from '@ductum/core'
import { applyImportedSpec } from '../import-handler.js'
import { createMockApi, project, spec } from './helpers.js'

describe('spec import ready summary', () => {
  it('reports tasks that are already ready after DAG evaluation', async () => {
    const readyTask: Task = {
      id: 'task-ready-after-dag' as Task['id'],
      specId: 'spec-ready-summary' as Spec['id'],
      targetId: null,
      name: 'root-task',
      prompt: 'Decision Trace: 060',
      repos: [],
      assignedAgentId: null,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      strategyRole: 'normal',
      strategyGroup: null,
      verification: [],
      retryCount: 0,
      retryAfter: null,
      budgetExtraUsd: 0,
      turnExtraCount: 0,
      createdAt: '2026-04-30T00:00:00Z',
      updatedAt: '2026-04-30T00:00:00Z',
    }
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue({
        ...spec,
        id: 'spec-ready-summary' as Spec['id'],
        name: 'ready-summary',
      }),
      createTask: vi.fn().mockResolvedValue(readyTask),
      listTasks: vi.fn().mockResolvedValue([readyTask]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: [] }),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      listDecisions: vi.fn().mockResolvedValue([]),
    })

    const result = await applyImportedSpec(api, {
      project: project.name,
      spec: { name: 'ready-summary' },
      tasks: [{ name: 'root-task', prompt: 'Decision Trace: 060', repos: [], verification: [], dependsOn: [] }],
    })

    expect(result.readyTaskIds).toEqual([readyTask.id])
  })
})
