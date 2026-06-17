import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Spec, Task } from '@ductum/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockApi, project, runCommand, spec } from './helpers.js'
import { makeTask } from './spec-resource-apply-helpers.js'

describe('spec import operator visibility', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ductum-import-visibility-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('streams created task messages before a later task creation failure', async () => {
    const file = join(tmpDir, 'spec.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: visibility',
      '  status: approved',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan',
      '  - name: build',
      '    prompt: Build',
      '',
    ].join('\n'), 'utf8')
    const createdSpec = { ...spec, id: 'spec-visibility' as Spec['id'], name: 'visibility' }
    const plan = makeTask('task-plan', createdSpec.id, 'plan')
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue(createdSpec),
      createTask: vi.fn()
        .mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(new Error('task API failed')),
    })

    const result = await runCommand(['spec', 'import', file, '--waive-contract'], api)

    expect(result.code).toBe(1)
    expect(result.text).toContain(`Project: ${project.name} (${project.id})`)
    expect(result.text).toContain('Spec created: visibility (spec-visibility)')
    expect(result.text).toContain('Task: plan (task-plan)')
    expect(result.errorText).toContain('task API failed')
  })

  it('keeps spec import --json parseable while reporting progress', async () => {
    const file = join(tmpDir, 'spec.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: visibility-json',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan',
      '',
    ].join('\n'), 'utf8')
    const createdSpec = { ...spec, id: 'spec-json' as Spec['id'], name: 'visibility-json' }
    const plan = makeTask('task-plan', createdSpec.id, 'plan')
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue(createdSpec),
      createTask: vi.fn().mockResolvedValue(plan),
      listTasks: vi.fn().mockResolvedValue([plan]),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
      evaluateDAG: vi.fn().mockResolvedValue({ readyTaskIds: [plan.id] }),
    })

    const result = await runCommand(['--json', 'spec', 'import', file, '--waive-contract'], api)

    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout) as { messages: string[]; tasks: Task[]; ready: string[] }
    expect(payload.messages).toContain(`Project: ${project.name} (${project.id})`)
    expect(payload.messages).toContain('Spec created: visibility-json (spec-json)')
    expect(payload.messages).toContain('  DAG evaluated')
    expect(payload.tasks.map((task) => task.id)).toEqual([plan.id])
    expect(payload.ready).toEqual([plan.id])
  })

  it('keeps spec import --json parseable after a partial failure', async () => {
    const file = join(tmpDir, 'spec.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: visibility-json-failure',
      'tasks:',
      '  - name: plan',
      '    prompt: Plan',
      '  - name: build',
      '    prompt: Build',
      '',
    ].join('\n'), 'utf8')
    const createdSpec = { ...spec, id: 'spec-json-failure' as Spec['id'], name: 'visibility-json-failure' }
    const plan = makeTask('task-plan', createdSpec.id, 'plan')
    const api = createMockApi({
      listSpecs: vi.fn().mockResolvedValue([]),
      createSpec: vi.fn().mockResolvedValue(createdSpec),
      createTask: vi.fn()
        .mockResolvedValueOnce(plan)
        .mockRejectedValueOnce(new Error('task API failed')),
    })

    const result = await runCommand(['--json', 'spec', 'import', file, '--waive-contract'], api)

    expect(result.code).toBe(1)
    const payload = JSON.parse(result.stdout) as { messages: string[] }
    expect(payload.messages).toContain(`Project: ${project.name} (${project.id})`)
    expect(payload.messages).toContain('Spec created: visibility-json-failure (spec-json-failure)')
    expect(payload.messages).toContain('  Task: plan (task-plan)')
    expect(result.errorText).toContain('task API failed')
  })

  it.each([
    {
      name: 'invalid status',
      lines: ['  status: aproved', 'tasks:', '  - name: plan', '    prompt: Plan'],
      error: 'spec.status must be one of',
    },
    {
      name: 'invalid maxFixIterations',
      lines: ['  maxFixIterations: 0', 'tasks:', '  - name: plan', '    prompt: Plan'],
      error: 'spec.maxFixIterations must be a positive integer',
    },
  ])('rejects malformed legacy spec import fields before writes: $name', async ({ lines, error }) => {
    const file = join(tmpDir, 'spec.yaml')
    await writeFile(file, [
      'project: ductum',
      'spec:',
      '  name: invalid-import',
      ...lines,
      '',
    ].join('\n'), 'utf8')
    const api = createMockApi()

    const result = await runCommand(['spec', 'import', file], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain(error)
    expect(api.createSpec).not.toHaveBeenCalled()
    expect(api.createTask).not.toHaveBeenCalled()
  })
})
