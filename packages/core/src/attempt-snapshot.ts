import { hostname } from 'node:os'

import type { AgentRuntimeResolution } from './agent-runtime-resolution.js'
import { resolveModelEntry } from './model-registry.js'
import type { Component, ModelSpec, Repository } from './resource-types.js'
import type { AttemptRuntimeSnapshot } from './attempt-types.js'
import type { Agent, Project, RunWorkflowProfileSnapshot, Spec, Task } from './types.js'

export interface BuildAttemptSnapshotInput {
  task: Task
  spec: Spec
  project: Project
  agent: Agent
  runtime: AgentRuntimeResolution<Agent>
  workflow: RunWorkflowProfileSnapshot | null
  repository?: Repository | null
  component?: Component | null
  workingDir?: string
  worktreePaths?: string[] | null
  branch?: string | null
  capturedAt: string
  hostId?: string
}

export function buildAttemptSnapshot(input: BuildAttemptSnapshotInput): AttemptRuntimeSnapshot {
  const runtimeAgent = input.runtime.agent
  const modelSpec = input.runtime.modelResource?.spec as Partial<ModelSpec> | undefined
  const registryModel = resolveModelEntry(runtimeAgent.model)
  const providerId = modelSpec?.provider ?? registryModel?.provider ?? 'unknown'
  const providerModelId = modelSpec?.modelId ?? runtimeAgent.model
  const harnessAdapter = input.runtime.harnessSnapshot?.type ?? runtimeAgent.harness
  const repositorySpec = input.repository?.spec

  return {
    capturedAt: input.capturedAt,
    spec: { id: input.spec.id, name: input.spec.name },
    task: { id: input.task.id, name: input.task.name },
    project: { id: input.project.id, name: input.project.name, config: input.project.config },
    ...(input.repository == null ? {} : { repository: {
      id: input.repository.id,
      projectId: input.repository.projectId,
      name: input.repository.name,
      localPath: repositorySpec?.localPath,
      remoteUrl: repositorySpec?.remoteUrl,
      defaultBranch: repositorySpec?.defaultBranch,
      branchPrefix: repositorySpec?.branchPrefix,
      readiness: input.repository.readiness,
    } }),
    ...(input.component === undefined ? {} : { component: input.component == null ? null : {
      id: input.component.id,
      repositoryId: input.component.repositoryId,
      name: input.component.name,
      path: input.component.spec.path,
    } }),
    agent: {
      id: runtimeAgent.id,
      name: runtimeAgent.name,
      model: runtimeAgent.model,
      harness: runtimeAgent.harness,
      resourceRefs: runtimeAgent.resourceRefs,
      capabilities: [...runtimeAgent.capabilities],
      effort: runtimeAgent.effort ?? null,
      costTier: runtimeAgent.costTier,
      spawnConfig: { ...runtimeAgent.spawnConfig },
      pricing: runtimeAgent.pricing ?? null,
      role: input.task.requiredRole,
      systemPromptRef: runtimeAgent.resourceRefs?.systemPromptRef,
    },
    provider: { providerId },
    model: {
      modelId: input.runtime.modelResource?.name ?? runtimeAgent.model,
      providerModelId,
      resourceId: input.runtime.modelResource?.id,
      resourceName: input.runtime.modelResource?.name,
    },
    harness: {
      harnessId: input.runtime.harnessResource?.name ?? runtimeAgent.harness,
      adapterKey: harnessAdapter,
      resourceId: input.runtime.harnessResource?.id,
      resourceName: input.runtime.harnessResource?.name,
    },
    workflow: input.workflow,
    sandboxProfile: input.runtime.sandboxProfile,
    execution: {
      hostId: input.hostId ?? hostname(),
      workingDir: input.workingDir,
      worktreePaths: input.worktreePaths ?? undefined,
      branch: input.branch ?? null,
      defaultBranch: repositorySpec?.defaultBranch,
      branchPrefix: repositorySpec?.branchPrefix,
    },
  }
}
