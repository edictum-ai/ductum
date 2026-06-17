import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Spec, Task } from '@ductum/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseYamlContent } from '../spec-import.js'
import { createMockApi, project, runCommand, spec, target } from './helpers.js'

describe('spec import target fanOut', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ductum-fanout-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('expands spec fanOut targets into target-scoped tasks', () => {
    const result = parseYamlContent(`
project: ductum
spec:
  name: rollout
  status: approved
  fanOut:
    targets:
      - targetRef: ductum
        taskName: rollout-ductum
        prompt: |
          Decision Trace: 053, 060, 063.
          Implement the target slice.
        verification:
          - pnpm test
`)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({
      name: 'rollout-ductum',
      target: 'ductum',
      repos: [],
      verification: ['pnpm test'],
    })
  })

  it('resolves fanOut target refs while importing YAML', async () => {
    const yamlPath = join(tmpDir, 'fanout.yaml')
    await writeFile(yamlPath, `
project: ductum
spec:
  name: fanout-spec
  status: approved
  fanOut:
    targets:
      - targetRef: ductum
        taskName: fanout-ductum
        prompt: |
          Decision Trace: 053, 060, 063.
          Do target work.
        verification:
          - pnpm test
`)

    const createdTasks: Task[] = []
    const api = createMockApi({
      createSpec: vi.fn().mockImplementation(async (_projectId, input) => ({
        ...spec,
        id: 'spec-fanout' as Spec['id'],
        name: input.name,
      })),
      listSpecs: vi.fn().mockResolvedValue([]),
      createTask: vi.fn().mockImplementation(async (_specId, input) => {
        const task: Task = {
          id: 'fanout-task-1' as Task['id'],
          specId: 'spec-fanout' as Spec['id'],
          targetId: input.targetId ?? null,
          name: input.name,
          prompt: input.prompt,
          repos: input.repos ?? [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: input.complexity ?? null,
          status: 'pending',
          strategyRole: 'normal',
          strategyGroup: null,
          verification: input.verification ?? [],
          retryCount: 0,
          retryAfter: null,
          budgetExtraUsd: 0,
          turnExtraCount: 0,
          createdAt: '2026-04-05T00:00:00Z',
          updatedAt: '2026-04-05T00:00:00Z',
        }
        createdTasks.push(task)
        return task
      }),
      listTasks: vi.fn().mockImplementation(async () => createdTasks),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: ['fanout-task-1'] }),
    })

    const result = await runCommand(['spec', 'import', yamlPath, '--waive-contract'], api)

    expect(result.code).toBe(0)
    expect(api.listTargets).toHaveBeenCalledWith(project.id)
    expect(api.createTask).toHaveBeenCalledWith(
      'spec-fanout',
      expect.objectContaining({
        name: 'fanout-ductum',
        targetId: target.id,
        repos: [target.spec.source.localPath],
      }),
    )
    expect(result.text).toContain('fanout-ductum <ductum>')
  })
})
