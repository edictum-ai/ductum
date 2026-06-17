import type { Agent, Project, Spec, Target, Task, TaskDependency } from '@ductum/core'

import { formatStatusBadge, formatTable } from './format.js'
import type { CliContext } from './runtime.js'
import type { ImportedSpec } from './spec-import.js'
import type { DuctumApi } from './api-client.js'
import { recordImportedDecisionTraces } from './spec-import-decisions.js'
import { resolveImportedTaskScopes, type ImportedTaskScopeDefaults } from './spec-import-scope.js'

export interface SpecImportResult {
  project: Project
  spec: Spec
  tasks: Task[]
  dependencies: TaskDependency[]
  readyTaskIds: string[]
  depCount: number
  skipped: boolean
}

interface ApplyImportedSpecOptions {
  strictExistingSpecMetadata?: boolean
  defaultScope?: ImportedTaskScopeDefaults
  onMessage?: (message: string) => void
}

/**
 * Execute a spec import: create spec, tasks, wire dependencies, evaluate DAG.
 * Separated from admin.ts to keep files under 300 LOC.
 */
export async function executeSpecImport(
  ctx: CliContext,
  imported: ImportedSpec,
  options: { defaultScope?: ImportedTaskScopeDefaults } = {},
) {
  const messages: string[] = []
  const onMessage = (message: string) => {
    messages.push(message)
    if (!ctx.json) ctx.writeText(message)
  }

  let result: SpecImportResult
  try {
    result = await applyImportedSpec(ctx.api, imported, { onMessage, defaultScope: options.defaultScope })
  } catch (error) {
    if (ctx.json && messages.length > 0) ctx.write({ messages }, '')
    throw error
  }

  if (result.skipped) {
    if (ctx.json) {
      ctx.write({
        specId: result.spec.id,
        skipped: true,
        messages,
      }, '')
    }
    return
  }

  const statusTable = formatTable(
    [
      { key: 'name', label: 'TASK' },
      { key: 'status', label: 'STATUS' },
      { key: 'deps', label: 'DEPS', align: 'right' as const },
    ],
    result.tasks.map((t) => ({
      name: t.name,
      status: formatStatusBadge(t.status),
      deps: result.dependencies.filter((d) => d.taskId === t.id).length,
    })),
  )

  ctx.write(
    {
      specId: result.spec.id,
      tasks: result.tasks,
      dependencies: result.dependencies,
      ready: result.readyTaskIds,
      messages,
    },
    `\n${statusTable}\n\nImported ${result.tasks.length} tasks, ${result.depCount} dependencies. ${result.readyTaskIds.length} ready.`,
  )
}

export async function applyImportedSpec(
  api: DuctumApi,
  imported: ImportedSpec,
  options: ApplyImportedSpecOptions = {},
): Promise<SpecImportResult> {
  const emit = (message: string) => {
    options.onMessage?.(message)
  }
  const projects = await api.listProjects()
  const project = projects.find((p) => p.name === imported.project)
  if (project == null) {
    throw new Error(`Project not found: ${imported.project}`)
  }
  emit(`Project: ${project.name} (${project.id})`)

  const existingSpecs = await api.listSpecs(project.id)
  let specRecord = existingSpecs.find((s) => s.name === imported.spec.name)

  if (specRecord != null) {
    if (options.strictExistingSpecMetadata === true && hasSpecMetadataInput(imported.spec)) {
      throw new Error(
        `Spec "${specRecord.name}" already exists; spec import cannot update spec status, document, or maxFixIterations`,
      )
    }
    const existingTasks = await api.listTasks(specRecord.id)
    if (existingTasks.length > 0) {
      const decisionCount = await recordImportedDecisionTraces(api, specRecord, imported, existingTasks)
      if (decisionCount > 0) emit(`  ${decisionCount} decision trace records created`)
      emit(
        `Spec "${specRecord.name}" already has ${existingTasks.length} tasks. Delete the spec first to reimport.`,
      )
      return {
        project,
        spec: specRecord,
        tasks: existingTasks,
        dependencies: [],
        readyTaskIds: [],
        depCount: 0,
        skipped: true,
      }
    }
    emit(`Spec exists: ${specRecord.name} (${specRecord.id})`)
  }

  const targetByRef = await resolveTargetRefs(api, project.id, imported)
  const agentByName = await resolveAgentRefs(api, imported)
  const scopeByTaskName = await resolveImportedTaskScopes(api, project.id, imported, options.defaultScope)

  if (specRecord == null) {
    specRecord = await api.createSpec(project.id, {
      name: imported.spec.name,
      status: imported.spec.status ?? 'approved',
      document: imported.spec.document ?? '',
      ...(imported.spec.maxFixIterations != null
        ? { maxFixIterations: imported.spec.maxFixIterations }
        : {}),
    })
    emit(`Spec created: ${specRecord.name} (${specRecord.id})`)
  }

  const taskNameToId = new Map<string, string>()
  for (const importedTask of imported.tasks) {
    let assignedAgentId: Agent['id'] | null = null
    if (importedTask.assignedAgent) {
      const resolved = agentByName.get(importedTask.assignedAgent)
      if (resolved == null) throw new Error(`Agent "${importedTask.assignedAgent}" not found for task "${importedTask.name}"`)
      assignedAgentId = resolved
    }

    const target = importedTask.target == null ? null : targetByRef.get(importedTask.target) ?? null
    const taskScope = scopeByTaskName.get(importedTask.name)
    const created = await api.createTask(specRecord.id, {
      name: importedTask.name,
      ...(target == null ? {} : { targetId: target.id }),
      ...(taskScope?.repositoryId == null ? {} : { repositoryId: taskScope.repositoryId as Task['repositoryId'] }),
      ...(taskScope?.componentId == null ? {} : { componentId: taskScope.componentId as Task['componentId'] }),
      prompt: importedTask.prompt,
      repos: importedTask.repos.length === 0 && target != null ? repoScopeFromTarget(target) : importedTask.repos,
      verification: importedTask.verification,
      assignedAgentId,
      ...(importedTask.complexity != null ? { complexity: importedTask.complexity } : {}),
      ...(importedTask.requiredRole != null ? { requiredRole: importedTask.requiredRole } : {}),
      ...(importedTask.status != null ? { status: importedTask.status } : {}),
    })
    taskNameToId.set(importedTask.name, created.id)
    const targetLabel = importedTask.target == null ? '' : ` <${importedTask.target}>`
    emit(`  Task: ${importedTask.name}${targetLabel} (${created.id})${importedTask.assignedAgent ? ` [${importedTask.assignedAgent}]` : ''}`)
  }

  let depCount = 0
  for (const importedTask of imported.tasks) {
    if (importedTask.dependsOn.length === 0) continue
    const taskId = taskNameToId.get(importedTask.name)
    if (taskId == null) throw new Error(`Task "${importedTask.name}" was not created`)
    for (const depName of importedTask.dependsOn) {
      const depId = taskNameToId.get(depName)
      if (depId == null) {
        throw new Error(`Task "${importedTask.name}" depends on "${depName}" which was not created`)
      }
      await api.addTaskDependency(taskId, depId)
      depCount++
    }
  }
  if (depCount > 0) emit(`  ${depCount} dependencies wired`)

  const dagResult = await api.evaluateDAG(specRecord.id)
  emit('  DAG evaluated')

  const finalTasks = await api.listTasks(specRecord.id)
  const decisionCount = await recordImportedDecisionTraces(api, specRecord, imported, finalTasks)
  if (decisionCount > 0) emit(`  ${decisionCount} decision trace records created`)
  const finalDeps = await listTaskDependencies(api, finalTasks)
  const readyTaskIds = [
    ...new Set([
      ...dagResult.readyTaskIds,
      ...finalTasks.filter((task) => task.status === 'ready').map((task) => task.id),
    ]),
  ]
  return {
    project,
    spec: specRecord,
    tasks: finalTasks,
    dependencies: finalDeps,
    readyTaskIds,
    depCount,
    skipped: false,
  }
}

function hasSpecMetadataInput(spec: ImportedSpec['spec']) {
  return spec.status != null || spec.document != null || spec.maxFixIterations != null
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
    if (!byRef.has(ref)) {
      throw new Error(`Target "${ref}" not found in project ${projectId}`)
    }
  }
  return byRef
}

async function resolveAgentRefs(api: DuctumApi, imported: ImportedSpec): Promise<Map<string, Agent['id']>> {
  const refs = [...new Set(imported.tasks.map((task) => task.assignedAgent).filter((ref): ref is string => ref != null))]
  if (refs.length === 0) return new Map()
  const agents = await api.listAgents()
  const byName = new Map(agents.map((agent) => [agent.name, agent.id]))
  for (const ref of refs) {
    if (!byName.has(ref)) {
      throw new Error(`Agent "${ref}" not found. Available: ${[...byName.keys()].join(', ')}`)
    }
  }
  return byName
}

async function listTaskDependencies(api: DuctumApi, tasks: Task[]) {
  return (await Promise.all(tasks.map((t) => api.listTaskDependencies(t.id)))).flat()
}

function repoScopeFromTarget(target: Target): string[] {
  const source = target.spec.source
  const scope = source.localPath ?? source.repo ?? source.package ?? source.subdirectory
  return scope == null ? [] : [scope]
}
