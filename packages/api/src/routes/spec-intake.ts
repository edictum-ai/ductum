import {
  assertSpecIntakeContainsNoAttempts,
  createId,
  operatorSpecFromSpec,
  operatorTaskFromTask,
  type Component,
  type Repository,
  type SpecIntake,
  type SpecIntakeComponent,
  type SpecIntakeRepository,
  type SpecIntakeTask,
} from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { readJson } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'
import { repositoryLegacyRef } from '../lib/repositories.js'

interface ScopedIntakeTask {
  task: SpecIntakeTask
  repository: Repository
  component: Component | null
}

export function registerSpecIntakeRoutes(app: Hono, context: ApiContext) {
  app.post('/api/spec-intake', async (c) => {
    const body = await readJson<unknown>(c)
    assertSpecIntakeContainsNoAttempts(body)
    const intake = body as SpecIntake
    if (intake.schemaVersion !== 'ductum.spec-intake.v1') {
      throw new ValidationError('schemaVersion must be ductum.spec-intake.v1')
    }

    const project = intake.project.id == null
      ? context.repos.projects.getByName(intake.project.name)
      : context.repos.projects.get(intake.project.id as never)
    if (project == null) throw new NotFoundError(`Project not found: ${intake.project.id ?? intake.project.name}`)

    const scopedTasks = collectTasks(context, project.id as never, intake.repositories)
    validateTaskNames(scopedTasks)
    const agents = resolveAgents(context, scopedTasks)
    const targetIds = resolveTargets(context, project.id as never, intake.repositories, scopedTasks)

    const spec = context.repos.specs.create({
      id: createId<'SpecId'>(),
      projectId: project.id,
      name: intake.spec.name,
      status: intake.spec.status ?? 'approved',
      document: intake.spec.document ?? '',
      maxFixIterations: intake.spec.maxFixIterations ?? null,
    })

    const taskNameToId = new Map<string, string>()
    const createdTasks = scopedTasks.map((entry) => {
      const targetKey = entry.task.targetRef
        ?? findSourceTargetRef(intake.repositories, entry.repository, entry.component)
      const created = context.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        targetId: targetKey == null ? null : targetIds.get(targetKey) as never,
        repositoryId: entry.repository.id,
        componentId: entry.component?.id ?? null,
        name: entry.task.name,
        prompt: entry.task.prompt,
        repos: [repositoryLegacyRef(entry.repository)],
        assignedAgentId: entry.task.assignedAgent == null
          ? null
          : agents.get(entry.task.assignedAgent) as never,
        requiredRole: entry.task.requiredRole ?? null,
        complexity: entry.task.complexity ?? null,
        status: entry.task.status ?? 'pending',
        verification: entry.task.verification ?? [],
      })
      taskNameToId.set(entry.task.name, created.id)
      return { task: created, repository: entry.repository, component: entry.component }
    })

    let dependencyCount = 0
    for (const entry of scopedTasks) {
      const taskId = taskNameToId.get(entry.task.name)
      if (taskId == null) continue
      for (const dependency of entry.task.dependsOn ?? []) {
        const dependsOnId = taskNameToId.get(dependency)
        if (dependsOnId == null) throw new ValidationError(`Task ${entry.task.name} depends on unknown Task ${dependency}`)
        context.repos.taskDependencies.add({ taskId: taskId as never, dependsOnId: dependsOnId as never })
        dependencyCount++
      }
    }

    context.dag.evaluateTaskDAG(spec.id)
    const finalTasks = context.repos.tasks.list(spec.id)
    const finalById = new Map(finalTasks.map((task) => [task.id, task]))

    return c.json(publicOutput({
      recordType: 'SpecIntake',
      spec: operatorSpecFromSpec(spec, finalTasks.length),
      tasks: createdTasks.map((entry) => operatorTaskFromTask(
        finalById.get(entry.task.id) ?? entry.task,
        { repositoryName: entry.repository.name, componentName: entry.component?.name },
      )),
      taskCount: finalTasks.length,
      dependencyCount,
    }), 201)
  })
}

function collectTasks(
  context: ApiContext,
  projectId: Parameters<ApiContext['repos']['repositories']['list']>[0],
  repositories: SpecIntakeRepository[],
): ScopedIntakeTask[] {
  const tasks: ScopedIntakeTask[] = []
  for (const repositoryInput of repositories) {
    const repository = resolveRepository(context, projectId, repositoryInput)
    for (const task of repositoryInput.tasks ?? []) tasks.push({ task, repository, component: null })
    for (const componentInput of repositoryInput.components ?? []) {
      const component = resolveComponent(context, repository, componentInput)
      for (const task of componentInput.tasks ?? []) tasks.push({ task, repository, component })
    }
  }
  if (tasks.length === 0) throw new ValidationError('SpecIntake must include at least one Task')
  return tasks
}

function resolveRepository(
  context: ApiContext,
  projectId: Parameters<ApiContext['repos']['repositories']['list']>[0],
  input: SpecIntakeRepository,
): Repository {
  const byId = input.id == null ? null : context.repos.repositories.get(input.id as never)
  const repository = byId ?? context.repos.repositories.list(projectId).find((candidate) =>
    candidate.name === input.name
    || candidate.spec.localPath === input.localPath
    || candidate.spec.remoteUrl === input.remoteUrl
  ) ?? null
  if (repository == null) throw new NotFoundError(`Repository not found: ${input.id ?? input.name}`)
  if (repository.projectId !== projectId) throw new ValidationError('SpecIntake repository must belong to the project')
  return repository
}

function resolveComponent(context: ApiContext, repository: Repository, input: SpecIntakeComponent): Component {
  const component = context.repos.components.list(repository.id).find((candidate) =>
    candidate.name === input.name || candidate.spec.path === input.path
  ) ?? null
  if (component == null) throw new NotFoundError(`Component not found: ${input.name}`)
  if (component.repositoryId !== repository.id) throw new ValidationError('SpecIntake component must belong to its Repository')
  return component
}

function validateTaskNames(scopedTasks: ScopedIntakeTask[]): void {
  const names = new Set<string>()
  for (const entry of scopedTasks) {
    if (names.has(entry.task.name)) throw new ValidationError(`Duplicate Task name in SpecIntake: ${entry.task.name}`)
    names.add(entry.task.name)
  }
}

function resolveAgents(context: ApiContext, scopedTasks: ScopedIntakeTask[]): Map<string, string> {
  const refs = [...new Set(scopedTasks.map((entry) => entry.task.assignedAgent).filter((ref): ref is string => ref != null))]
  const agents = context.repos.agents.list()
  const byRef = new Map(agents.flatMap((agent) => [[agent.id, agent.id], [agent.name, agent.id]]))
  for (const ref of refs) if (!byRef.has(ref)) throw new NotFoundError(`Agent not found: ${ref}`)
  return byRef
}

function resolveTargets(
  context: ApiContext,
  projectId: Parameters<ApiContext['repos']['targets']['list']>[0],
  repositories: SpecIntakeRepository[],
  scopedTasks: ScopedIntakeTask[],
): Map<string, string> {
  const refs = new Set<string>()
  for (const repository of repositories) if (repository.targetRef != null) refs.add(repository.targetRef)
  for (const repository of repositories) {
    for (const component of repository.components ?? []) if (component.targetRef != null) refs.add(component.targetRef)
  }
  for (const entry of scopedTasks) if (entry.task.targetRef != null) refs.add(entry.task.targetRef)
  if (refs.size === 0) return new Map()
  const targets = context.repos.targets.list(projectId)
  const byRef = new Map(targets.flatMap((target) => [[target.id, target.id], [target.name, target.id]]))
  for (const ref of refs) if (!byRef.has(ref)) throw new NotFoundError(`Target not found: ${ref}`)
  return byRef
}

function findSourceTargetRef(
  repositories: SpecIntakeRepository[],
  repository: Repository,
  component: Component | null,
): string | undefined {
  const repositoryInput = repositories.find((entry) => entry.id === repository.id || entry.name === repository.name)
  if (component == null) return repositoryInput?.targetRef
  return repositoryInput?.components?.find((entry) => entry.name === component.name)?.targetRef ?? repositoryInput?.targetRef
}
