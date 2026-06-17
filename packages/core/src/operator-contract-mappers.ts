import type {
  Agent,
  Project,
  Spec,
  Task,
} from './types.js'
import type { Component, ConfigResource, Repository, Target } from './resource-types.js'
import { repositoryFromTarget } from './repository-model.js'
import { operatorAttemptFromRun } from './attempt-facade.js'
import type {
  OperatorAgent,
  OperatorComponent,
  OperatorHarness,
  OperatorModel,
  OperatorProject,
  OperatorRepository,
  OperatorSpec,
  OperatorTask,
  OperatorWorkflow,
} from './operator-contract-types.js'

export function operatorProjectFromProject(
  project: Project,
  repositories: OperatorRepository[] = [],
): OperatorProject {
  return {
    recordType: 'Project',
    id: project.id,
    name: project.name,
    repositoryCount: repositories.length || project.repos.length,
    status: 'ok',
    workflowName: project.config.workflowProfile ?? project.config.workflowPath,
  }
}

export function operatorRepositoryFromTarget(target: Target): OperatorRepository {
  return operatorRepositoryFromRepository(repositoryFromTarget(target))
}

export function operatorRepositoryFromRepository(repository: Repository): OperatorRepository {
  return {
    recordType: 'Repository',
    id: repository.id,
    projectId: repository.projectId,
    name: repository.name,
    localPath: repository.spec.localPath,
    remoteUrl: repository.spec.remoteUrl,
    identity: repository.identity,
    portable: repository.portable,
    readiness: repository.readiness,
  }
}

export function operatorComponentFromComponent(component: Component, repository: Repository): OperatorComponent {
  return {
    recordType: 'Component',
    id: component.id,
    name: component.name,
    repositoryId: repository.id,
    repositoryName: repository.name,
    path: component.spec.path,
  }
}

export function operatorSpecFromSpec(spec: Spec, taskCount?: number): OperatorSpec {
  return {
    recordType: 'Spec',
    id: spec.id,
    projectId: spec.projectId,
    name: spec.name,
    status: spec.status,
    strategy: spec.strategy,
    strategyConfig: spec.strategyConfig,
    document: spec.document,
    taskCount,
  }
}

export function operatorTaskFromTask(
  task: Task,
  scope: { repositoryName?: string; componentName?: string } = {},
): OperatorTask {
  return {
    recordType: 'Task',
    id: task.id,
    specId: task.specId,
    name: task.name,
    repositoryId: task.repositoryId,
    componentId: task.componentId,
    repositoryName: scope.repositoryName ?? task.repos[0] ?? 'unknown',
    componentName: scope.componentName,
    status: task.status,
    strategyRole: task.strategyRole,
    strategyGroup: task.strategyGroup,
    prompt: task.prompt,
    verification: task.verification,
    assignedAgentId: task.assignedAgentId,
    requiredRole: task.requiredRole,
    complexity: task.complexity,
  }
}

export function operatorAgentFromAgent(agent: Agent): OperatorAgent {
  return {
    recordType: 'Agent',
    id: agent.id,
    name: agent.name,
    modelRef: agent.resourceRefs?.modelRef ?? agent.model,
    harnessRef: agent.resourceRefs?.harnessRef ?? agent.harness,
    capabilities: agent.capabilities,
    effort: agent.effort,
  }
}

export function operatorModelFromResource(resource: ConfigResource): OperatorModel | null {
  if (resource.kind !== 'Model') return null
  const spec = resource.spec as { provider?: string; modelId?: string; supportedHarnesses?: string[] }
  return {
    recordType: 'Model',
    id: resource.id,
    name: resource.name,
    providerName: spec.provider ?? 'unknown',
    providerModelId: spec.modelId ?? resource.name,
    supportedHarnesses: spec.supportedHarnesses,
  }
}

export function operatorHarnessFromResource(resource: ConfigResource): OperatorHarness | null {
  if (resource.kind !== 'Harness') return null
  const spec = resource.spec as { type?: string; supportedSandboxes?: string[] }
  return {
    recordType: 'Harness',
    id: resource.id,
    name: resource.name,
    type: spec.type ?? resource.name,
    supportedSandboxes: spec.supportedSandboxes,
  }
}

export function operatorWorkflowFromResource(resource: ConfigResource): OperatorWorkflow | null {
  if (resource.kind !== 'WorkflowProfile') return null
  const spec = resource.spec as { path?: string; description?: string }
  return {
    recordType: 'Workflow',
    id: resource.id,
    name: resource.name,
    path: spec.path ?? resource.name,
    description: spec.description,
  }
}

export { operatorAttemptFromRun }
