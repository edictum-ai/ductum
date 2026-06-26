import { AgentRuntimeResolutionError, resolveConfigRef, type ConfigResourceLookup } from './agent-runtime-resolution.js'
import type { ConfigResource, WorkflowProfileSpec } from './resource-types.js'
import type { Agent, ProjectId, RunWorkflowProfileSnapshot } from './types.js'

type AgentWorkflowProfileShape = Pick<Agent, 'name' | 'resourceRefs'>

export interface WorkflowProfileRuntimeData {
  renderedWorkflow: string
  setupCommands: string[]
  verifyCommands: string[]
  push?: RunWorkflowProfileSnapshot['push']
  unattended?: RunWorkflowProfileSnapshot['unattended']
}

export type MaterializedRunWorkflowProfileSnapshot = RunWorkflowProfileSnapshot & {
  renderedWorkflow: string
  setupCommands: string[]
  verifyCommands: string[]
}

export function resolveAgentWorkflowProfile(
  agent: AgentWorkflowProfileShape,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
): RunWorkflowProfileSnapshot | null {
  const ref = agent.resourceRefs?.workflowProfileRef
  if (ref == null) return null
  const resource = resolveConfigRef(agent, 'workflowProfileRef', 'WorkflowProfile', ref, projectId, resources)
  return workflowProfileSnapshotFromResource(agent, ref, resource)
}

export function applyWorkflowProfileRuntimeData(
  profile: RunWorkflowProfileSnapshot,
  data: WorkflowProfileRuntimeData | null | undefined,
): RunWorkflowProfileSnapshot {
  if (data == null) {
    throw new AgentRuntimeResolutionError(
      `WorkflowProfile ${profile.name} did not return materialized runtime data`,
      'resource_malformed',
    )
  }
  const setupCommands = Array.isArray(data.setupCommands) ? [...data.setupCommands] : data.setupCommands
  const verifyCommands = Array.isArray(data.verifyCommands) ? [...data.verifyCommands] : data.verifyCommands
  return requireMaterializedWorkflowProfile({
    ...profile,
    renderedWorkflow: data.renderedWorkflow,
    setupCommands,
    verifyCommands,
    push: data.push ?? profile.push,
    unattended: data.unattended ?? profile.unattended,
  })
}

export function requireMaterializedWorkflowProfile(
  profile: RunWorkflowProfileSnapshot,
): MaterializedRunWorkflowProfileSnapshot {
  if (typeof profile.renderedWorkflow !== 'string' || profile.renderedWorkflow.trim() === '') {
    throw new AgentRuntimeResolutionError(
      `WorkflowProfile ${profile.name} snapshot is missing materialized renderedWorkflow`,
      'resource_malformed',
    )
  }
  if (!isStringArray(profile.setupCommands)) {
    throw new AgentRuntimeResolutionError(
      `WorkflowProfile ${profile.name} snapshot is missing materialized setupCommands`,
      'resource_malformed',
    )
  }
  if (!isStringArray(profile.verifyCommands)) {
    throw new AgentRuntimeResolutionError(
      `WorkflowProfile ${profile.name} snapshot is missing materialized verifyCommands`,
      'resource_malformed',
    )
  }
  if (profile.verifyCommands.length === 0) {
    throw new AgentRuntimeResolutionError(
      `WorkflowProfile ${profile.name} snapshot has empty materialized verifyCommands`,
      'resource_malformed',
    )
  }
  return profile as MaterializedRunWorkflowProfileSnapshot
}

function workflowProfileSnapshotFromResource(
  agent: Pick<Agent, 'name'>,
  ref: string,
  resource: ConfigResource,
): RunWorkflowProfileSnapshot {
  const spec = normalizeWorkflowProfileSpec(agent, ref, resource.name, resource.spec)
  return {
    id: resource.id,
    name: resource.name,
    projectId: resource.projectId,
    path: spec.path,
    ...(spec.description == null ? {} : { description: spec.description }),
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function normalizeWorkflowProfileSpec(
  agent: Pick<Agent, 'name'>,
  ref: string,
  resourceName: string,
  value: unknown,
): WorkflowProfileSpec {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} workflowProfileRef "${ref}" resolved to WorkflowProfile ${resourceName} without an object spec`, 'resource_malformed')
  }
  const spec = value as Partial<WorkflowProfileSpec>
  if (typeof spec.path !== 'string' || spec.path.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} workflowProfileRef "${ref}" resolved to WorkflowProfile ${resourceName} without spec.path`, 'resource_malformed')
  }
  if (spec.description != null && typeof spec.description !== 'string') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} workflowProfileRef "${ref}" resolved to WorkflowProfile ${resourceName} with non-string spec.description`, 'resource_malformed')
  }
  const description = spec.description?.trim()
  return {
    path: spec.path.trim(),
    ...(description == null || description === '' ? {} : { description }),
  }
}
