import type { Project, Spec, Task } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import { createMockApi, dependencies, project, readyTask, runCommand, spec } from './helpers.js'

describe('task spec reference commands', () => {
  it('resolves task dag by spec name', async () => {
    const api = createMockApi()

    const result = await runCommand(['task', 'dag', spec.name], api)

    expect(result.code).toBe(0)
    expect(api.listTasks).toHaveBeenCalledWith(spec.id)
    expect(result.text).toContain('Ready Task [task-ready]')
  })

  it('resolves task list by spec name', async () => {
    const api = createMockApi()

    const result = await runCommand(['task', 'list', spec.name], api)

    expect(result.code).toBe(0)
    expect(api.listTasks).toHaveBeenCalledWith(spec.id)
    expect(result.text).toContain(readyTask.name)
  })

  it('explains when task list receives a project name instead of a spec', async () => {
    const api = createMockApi()

    const result = await runCommand(['task', 'list', project.name], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain(`"${project.name}" is a Project, not a Spec`)
    expect(result.errorText).toContain(`ductum spec list ${project.name}`)
    expect(result.errorText).toContain(`ductum task list <spec-id-or-name> --project ${project.name}`)
    expect(result.errorText).toContain(`${spec.name} [${spec.id}]`)
  })

  it('fails loudly when a spec name is ambiguous across projects', async () => {
    const otherProject: Project = {
      ...project,
      id: 'project-2' as Project['id'],
      name: 'other-project',
    }
    const otherSpec: Spec = {
      ...spec,
      id: 'spec-2' as Spec['id'],
      projectId: otherProject.id,
    }
    const otherTask: Task = {
      ...readyTask,
      id: 'task-other' as Task['id'],
      specId: otherSpec.id,
      name: 'Other Ready Task',
    }
    const api = createMockApi({
      listProjects: vi.fn().mockResolvedValue([project, otherProject]),
      listSpecs: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === project.id) return [spec]
        if (projectId === otherProject.id) return [otherSpec]
        return []
      }),
      listTasks: vi.fn().mockImplementation(async (specId: string) => {
        if (specId === spec.id) return [readyTask]
        if (specId === otherSpec.id) return [otherTask]
        return []
      }),
      listTaskDependencies: vi.fn().mockImplementation(async (taskId: string) =>
        dependencies.filter((item) => item.taskId === taskId),
      ),
    })

    const result = await runCommand(['task', 'dag', spec.name], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain(`Ambiguous spec "${spec.name}"`)
    expect(result.errorText).toContain(`${project.name}/${spec.name} [${spec.id}]`)
    expect(result.errorText).toContain(`${otherProject.name}/${otherSpec.name} [${otherSpec.id}]`)
    expect(api.listTasks).not.toHaveBeenCalled()
  })

  it('uses --project to disambiguate a spec name', async () => {
    const otherProject: Project = {
      ...project,
      id: 'project-2' as Project['id'],
      name: 'other-project',
    }
    const otherSpec: Spec = {
      ...spec,
      id: 'spec-2' as Spec['id'],
      projectId: otherProject.id,
    }
    const otherTask: Task = {
      ...readyTask,
      id: 'task-other' as Task['id'],
      specId: otherSpec.id,
      name: 'Other Ready Task',
    }
    const api = createMockApi({
      listProjects: vi.fn().mockResolvedValue([project, otherProject]),
      listSpecs: vi.fn().mockImplementation(async (projectId: string) => {
        if (projectId === project.id) return [spec]
        if (projectId === otherProject.id) return [otherSpec]
        return []
      }),
      listTasks: vi.fn().mockImplementation(async (specId: string) => {
        if (specId === spec.id) return [readyTask]
        if (specId === otherSpec.id) return [otherTask]
        return []
      }),
      listTaskDependencies: vi.fn().mockResolvedValue([]),
    })

    const result = await runCommand(['task', 'dag', spec.name, '--project', otherProject.name], api)

    expect(result.code).toBe(0)
    expect(api.listTasks).toHaveBeenCalledWith(otherSpec.id)
    expect(result.text).toContain('Other Ready Task [task-other]')
  })
})
