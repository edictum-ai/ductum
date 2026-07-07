import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { AgentRuntimeResolutionError, resolveConfigRef, type ConfigResourceLookup } from './agent-runtime-resolution.js'
import type { ConfigResource, WorkflowProfileSpec } from './resource-types.js'
import type { Agent, ConfigResourceId, ProjectId, RunWorkflowProfileSnapshot } from './types.js'
import { createId } from './types.js'
import type { WorkspacePreflightConfig } from './workspace-preflight-types.js'

type AgentWorkflowProfileShape = Pick<Agent, 'name' | 'resourceRefs'>

/**
 * Issue #243: live legacy project shape has config
 * `{ mergeMode, workflowPath }` and no agent/project profile ref. Fall
 * back to repo `.edictum/workflow-profile.yaml` so runtime dispatch
 * materializes it before setup commands. Returns null when the project
 * already has a workflowProfileRef/workflowProfile (handled via the
 * normal resource path) or when no repo profile exists.
 */
export function resolveRepoWorkflowProfile(
  baseWorkingDir: string | undefined,
  projectConfig: { workflowProfileRef?: string; workflowProfile?: string } | null,
): RunWorkflowProfileSnapshot | null {
  if (projectConfig != null && hasProjectWorkflowProfileRef(projectConfig)) return null
  if (baseWorkingDir == null) return null
  const repoProfilePath = resolve(baseWorkingDir, '.edictum/workflow-profile.yaml')
  if (!existsSync(repoProfilePath)) return null
  return {
    id: createId<'ConfigResourceId'>(),
    name: 'repo-coding-guard',
    projectId: null,
    path: repoProfilePath,
  }
}

/**
 * Repoint a `coding-guard` profile path at the repo's
 * `.edictum/workflow-profile.yaml` if it exists, otherwise resolve the
 * declared path against the worktree base. Other profiles pass through
 * unchanged.
 */
export function resolveWorkflowProfilePathForWorktree(
  profile: RunWorkflowProfileSnapshot,
  baseWorkingDir: string | undefined,
): RunWorkflowProfileSnapshot {
  if (baseWorkingDir == null || isAbsolute(profile.path) || !isFactoryCodingGuardProfile(profile)) return profile
  const repoProfile = resolve(baseWorkingDir, '.edictum/workflow-profile.yaml')
  if (existsSync(repoProfile)) {
    return { ...profile, path: repoProfile }
  }
  return { ...profile, path: resolve(baseWorkingDir, profile.path) }
}

function isFactoryCodingGuardProfile(profile: RunWorkflowProfileSnapshot): boolean {
  return profile.projectId == null && profile.name === 'coding-guard'
}

function hasProjectWorkflowProfileRef(config: { workflowProfileRef?: string; workflowProfile?: string }): boolean {
  const ref = config.workflowProfileRef?.trim()
  if (ref != null && ref !== '') return true
  const legacy = config.workflowProfile?.trim()
  return legacy != null && legacy !== ''
}

export interface WorkflowProfileRuntimeData {
  renderedWorkflow: string
  setupCommands: string[]
  verifyCommands: string[]
  unattended?: RunWorkflowProfileSnapshot['unattended']
  /**
   * Issue #281: optional declarative preflight this workflow expects the
   * dispatcher to run before the implementation prompt reaches the harness.
   * Undefined when the workflow does not configure a preflight (the
   * dispatcher treats that as a no-op success).
   */
  preflight?: WorkspacePreflightConfig
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
    unattended: data.unattended ?? profile.unattended,
    ...(data.preflight == null ? {} : { preflight: data.preflight }),
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
