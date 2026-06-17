import type { Agent, Project, Spec, Target, Task, TaskDependency } from '@ductum/core'

import type { DuctumApi } from './api-client.js'
import { recordImportedDecisionTraces } from './spec-import-decisions.js'
import type { ImportedSpec } from './spec-import-types.js'

export interface SyncedImportedSpec {
  project: Project
  spec: Spec
  tasks: Task[]
  dependencies: TaskDependency[]
  createdSpec: boolean
  createdTaskCount: number
  createdDependencyCount: number
  decisionTraceCount: number
}

export async function ensureImportedSpecStructure(
  api: DuctumApi,
  imported: ImportedSpec,
  options: { initialSpecStatus?: Spec['status'] } = {},
): Promise<SyncedImportedSpec> {
  const project = await requireProject(api, imported.project)
  const existingSpec = (await api.listSpecs(project.id)).find((item) => item.name === imported.spec.name) ?? null
  const spec = existingSpec ?? await api.createSpec(project.id, {
    name: imported.spec.name,
    status: options.initialSpecStatus ?? 'draft',
    document: imported.spec.document ?? '',
    ...(imported.spec.maxFixIterations == null ? {} : { maxFixIterations: imported.spec.maxFixIterations }),
  })
  const existingTasks = await api.listTasks(spec.id)
  const targetByRef = await resolveTargetRefs(api, project.id, imported)
  const agentByName = await resolveAgentRefs(api, imported)
  const byName = new Map(existingTasks.map((task) => [task.name, task]))

  let createdTaskCount = 0
  for (const importedTask of imported.tasks) {
    if (byName.has(importedTask.name)) continue
    const target = importedTask.target == null ? null : targetByRef.get(importedTask.target) ?? null
    const assignedAgentId = importedTask.assignedAgent == null ? undefined : agentByName.get(importedTask.assignedAgent)
    const created = await api.createTask(spec.id, {
      name: importedTask.name,
      ...(target == null ? {} : { targetId: target.id }),
      prompt: importedTask.prompt,
      repos: importedTask.repos.length === 0 && target != null ? repoScopeFromTarget(target) : importedTask.repos,
      verification: importedTask.verification,
      ...(assignedAgentId == null ? {} : { assignedAgentId }),
      ...(importedTask.complexity == null ? {} : { complexity: importedTask.complexity }),
      ...(importedTask.requiredRole == null ? {} : { requiredRole: importedTask.requiredRole }),
    })
    byName.set(created.name, created)
    createdTaskCount += 1
  }

  let createdDependencyCount = 0
  for (const importedTask of imported.tasks) {
    const task = byName.get(importedTask.name)
    if (task == null) throw new Error(`Task "${importedTask.name}" was not created`)
    const existing = new Set((await api.listTaskDependencies(task.id)).map((dep) => dep.dependsOnId))
    for (const depName of importedTask.dependsOn) {
      const dependsOn = byName.get(depName)
      if (dependsOn == null) {
        throw new Error(`Task "${importedTask.name}" depends on "${depName}" which was not created`)
      }
      if (existing.has(dependsOn.id)) continue
      await api.addTaskDependency(task.id, dependsOn.id)
      existing.add(dependsOn.id)
      createdDependencyCount += 1
    }
  }

  await api.evaluateDAG(spec.id)
  const tasks = await api.listTasks(spec.id)
  const dependencies = (await Promise.all(tasks.map((task) => api.listTaskDependencies(task.id)))).flat()
  const decisionTraceCount = await recordImportedDecisionTraces(api, spec, imported, tasks)
  return {
    project,
    spec,
    tasks,
    dependencies,
    createdSpec: existingSpec == null,
    createdTaskCount,
    createdDependencyCount,
    decisionTraceCount,
  }
}

async function requireProject(api: DuctumApi, projectName: string) {
  const project = (await api.listProjects()).find((item) => item.name === projectName)
  if (project == null) throw new Error(`Project not found: ${projectName}`)
  return project
}

async function resolveTargetRefs(api: DuctumApi, projectId: string, imported: ImportedSpec): Promise<Map<string, Target>> {
  const refs = [...new Set(imported.tasks.map((task) => task.target).filter((ref): ref is string => ref != null))]
  if (refs.length === 0) return new Map()
  const targets = await api.listTargets(projectId)
  const byRef = new Map<string, Target>()
  for (const target of targets) {
    byRef.set(target.id, target)
    byRef.set(target.name, target)
  }
  for (const ref of refs) {
    if (!byRef.has(ref)) throw new Error(`Target "${ref}" not found in project ${projectId}`)
  }
  return byRef
}

async function resolveAgentRefs(api: DuctumApi, imported: ImportedSpec): Promise<Map<string, Agent['id']>> {
  const refs = [...new Set(imported.tasks.map((task) => task.assignedAgent).filter((ref): ref is string => ref != null))]
  if (refs.length === 0) return new Map()
  const agents = await api.listAgents()
  const byName = new Map(agents.map((agent) => [agent.name, agent.id]))
  for (const ref of refs) {
    if (!byName.has(ref)) throw new Error(`Agent "${ref}" not found. Available: ${[...byName.keys()].join(', ')}`)
  }
  return byName
}

function repoScopeFromTarget(target: Target): string[] {
  const source = target.spec.source
  const scope = source.localPath ?? source.repo ?? source.package ?? source.subdirectory
  return scope == null ? [] : [scope]
}
