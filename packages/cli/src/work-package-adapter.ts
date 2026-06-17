import {
  assertSpecIntakeContainsNoAttempts,
  publicContractError,
  publicContractIssue,
  type PublicContractIssue,
  type SpecIntake,
  type SpecIntakeComponent,
  type SpecIntakeRepository,
  type SpecIntakeTask,
  type WorkPackage,
} from '@ductum/core'

import type { ImportedSpec, ImportedTask } from './spec-import-types.js'

interface ScopedTask {
  task: SpecIntakeTask
  path: string
  repository: SpecIntakeRepository
  component?: SpecIntakeComponent
}

export function adaptWorkPackageToImportedSpec(input: WorkPackage): ImportedSpec {
  return adaptSpecIntakeToImportedSpec(input)
}

export function adaptSpecIntakeToImportedSpec(input: SpecIntake): ImportedSpec {
  assertSpecIntakeContainsNoAttempts(input)
  const scopedTasks = collectScopedTasks(input)
  validateTaskReferences(scopedTasks)
  return {
    project: input.project.name,
    spec: {
      name: input.spec.name,
      status: input.spec.status,
      document: input.spec.document,
      ...(input.spec.maxFixIterations == null ? {} : { maxFixIterations: input.spec.maxFixIterations }),
    },
    tasks: scopedTasks.map(toImportedTask),
  }
}

function collectScopedTasks(input: SpecIntake): ScopedTask[] {
  const tasks: ScopedTask[] = []
  input.repositories.forEach((repository, repositoryIndex) => {
    repository.tasks?.forEach((task, taskIndex) => {
      tasks.push({
        task,
        repository,
        path: `repositories[${repositoryIndex}].tasks[${taskIndex}]`,
      })
    })
    repository.components?.forEach((component, componentIndex) => {
      component.tasks?.forEach((task, taskIndex) => {
        tasks.push({
          task,
          repository,
          component,
          path: `repositories[${repositoryIndex}].components[${componentIndex}].tasks[${taskIndex}]`,
        })
      })
    })
  })
  if (tasks.length === 0) {
    throw publicContractError('SpecIntake must include at least one Task', [
      publicContractIssue({
        recordType: 'SpecIntake',
        recordName: input.spec.name,
        fieldPath: 'repositories',
        humanLabel: 'Tasks',
        suggestedAction: 'Add at least one Task under a Repository or Component.',
      }),
    ])
  }
  return tasks
}

function validateTaskReferences(scopedTasks: ScopedTask[]): void {
  const byName = new Map<string, ScopedTask>()
  const issues: PublicContractIssue[] = []

  for (const scoped of scopedTasks) {
    const existing = byName.get(scoped.task.name)
    if (existing != null) {
      issues.push(publicContractIssue({
        recordType: 'Task',
        recordName: scoped.task.name,
        fieldPath: `${scoped.path}.name`,
        humanLabel: 'Task name',
        invalidValue: scoped.task.name,
        suggestedAction: `Rename this Task or the duplicate at ${existing.path}.`,
      }))
      continue
    }
    byName.set(scoped.task.name, scoped)
  }

  for (const scoped of scopedTasks) {
    scoped.task.dependsOn?.forEach((dependency, dependencyIndex) => {
      if (byName.has(dependency)) return
      issues.push(publicContractIssue({
        recordType: 'Task',
        recordName: scoped.task.name,
        fieldPath: `${scoped.path}.dependsOn[${dependencyIndex}]`,
        humanLabel: 'Task dependency',
        invalidValue: dependency,
        missingDependency: { recordType: 'Task', idOrName: dependency },
        suggestedAction: `Add a Task named "${dependency}" or remove the dependency.`,
      }))
    })
  }

  if (issues.length > 0) {
    throw publicContractError('SpecIntake task references are invalid', issues)
  }
}

function toImportedTask(scoped: ScopedTask): ImportedTask {
  const { task, repository, component } = scoped
  const target = task.targetRef ?? component?.targetRef ?? repository.targetRef
  return {
    name: task.name,
    prompt: task.prompt,
    repos: [repository.localPath ?? repository.remoteUrl ?? repository.name],
    verification: task.verification ?? [],
    dependsOn: task.dependsOn ?? [],
    ...(target == null ? {} : { target }),
    repository: repository.id ?? repository.name,
    ...(component == null ? {} : { component: component.name }),
    assignedAgent: task.assignedAgent,
    complexity: task.complexity,
    requiredRole: task.requiredRole,
    status: task.status,
  }
}
